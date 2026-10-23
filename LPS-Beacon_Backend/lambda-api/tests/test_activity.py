"""Tests for the activity log (activity.py) and the bell's routes (GET /activity, POST /activity/seen), with the
routes that write to it. Run from lambda-api/:  python -m unittest discover -s tests"""
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.dont_write_bytecode = True

import activity  # noqa: E402

MINUTE = 60 * 1000


class FakeTable:
    """Just enough of a DynamoDB table: get_item, put_item, and the activity query (newest SK first)."""

    def __init__(self):
        self.items = {}

    def get_item(self, Key):
        item = self.items.get((Key["PK"], Key["SK"]))
        return {"Item": dict(item)} if item else {}

    def put_item(self, Item):
        self.items[(Item["PK"], Item["SK"])] = dict(Item)

    def query(self, KeyConditionExpression=None, ScanIndexForward=True, Limit=None, **_):
        rows = sorted((i for (pk, sk), i in self.items.items() if pk == "ACTIVITY" and sk.startswith("EVT#")),
                      key=lambda i: i["SK"], reverse=not ScanIndexForward)
        return {"Items": [dict(i) for i in rows[:Limit]]}


def iso(ms):
    return "t%d" % ms


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.t = FakeTable()

    def feed(self, user="u2", now=10_000 * MINUTE):
        return activity.feed(self.t, user, iso, now=now)

    def test_files_of_one_upload_are_one_entry(self):
        for i, name in enumerate(["rp.xlsx", "ql.xlsx", "rp.xlsx"]):
            activity.record(self.t, "u1", "a@lps.com", "upload", detail=name, group="upload#b1",
                            extra={"review": True}, now=1000 * MINUTE + i)
        activity.record(self.t, "u1", "a@lps.com", "upload", detail="x.xlsx", group="upload#b2",
                        extra={"review": False}, now=1001 * MINUTE)
        events = self.feed()["events"]
        self.assertEqual([e["text"] for e in events],
                         ["uploaded 1 file without a review", "uploaded 2 files for review"],
                         "newest first; the same file again isn't counted twice")
        self.assertEqual(events[1]["details"], ["ql.xlsx", "rp.xlsx"])
        self.assertEqual((events[0]["email"], events[0]["area"]), ("a@lps.com", "Upload"))

    def test_plan_changes_fold_within_the_window(self):
        rec = lambda row, col, v, at: activity.record(  # noqa: E731
            self.t, "u1", "a@lps.com", "plan_edit", detail=activity.cell_detail(row, col, v), group="plan",
            fold_ms=activity.FOLD_MINUTES * MINUTE, now=at)
        rec("joiners:b7", "Nov'26", 3, 1000 * MINUTE)
        rec("billable-ur:b6", "Dec'26", 0.874, 1005 * MINUTE)
        rec("joiners:b7", "Nov'26", 4, 1010 * MINUTE)        # same cell again: replaced, not counted
        rec("revenue", "Jan'27", 7_500_000, 1040 * MINUTE)   # 30 minutes later: a new entry
        events = self.feed()["events"]
        self.assertEqual([e["text"] for e in events],
                         ["changed 1 cell in the capacity plan", "changed 2 cells in the capacity plan"])
        self.assertEqual(events[1]["details"], ["Billable UR · Band 6 · Dec'26: 87.4%", "Joiners · Band 7 · Nov'26: 4"])
        self.assertEqual(events[0]["details"], ["Revenue · Jan'27: $7.50M"])
        self.assertEqual(activity.cell_detail("joiners:b7", "Nov'26", None),
                         "Joiners · Band 7 · Nov'26: reset to the worked-out value")

    def test_red_dot_counts_other_peoples_new_entries_only(self):
        activity.record(self.t, "u1", "a@lps.com", "stored_review", now=1000 * MINUTE)
        activity.record(self.t, "u2", "b@lps.com", "plan_clear", extra={"cleared": 2}, now=1001 * MINUTE)
        body = self.feed()
        self.assertEqual(body["unseen"], 1, "your own actions never light the dot")
        self.assertEqual([e["mine"] for e in body["events"]], [True, False])
        self.assertEqual(body["events"][0]["text"], "cleared 2 of their changed cells in the capacity plan")
        activity.mark_seen(self.t, "u2", now=1002 * MINUTE)
        self.assertEqual(self.feed()["unseen"], 0)
        activity.record(self.t, "u1", "a@lps.com", "matching", extra={"filled": 10, "reassigned": 2, "unfilled": 1},
                        now=1003 * MINUTE)
        body = self.feed()
        self.assertEqual(body["unseen"], 1)
        self.assertEqual(body["events"][0]["text"], "confirmed the matching: 10 lines filled (2 reassigned), "
                                                    "1 line left unfilled. This publishes a new forecast")

    def test_expired_entries_are_hidden(self):
        activity.record(self.t, "u1", "a@lps.com", "stored_review", now=0)
        self.assertEqual(self.feed(now=(activity.ACTIVITY_DAYS + 1) * 24 * 60 * MINUTE)["events"], [])

    def test_a_broken_table_never_breaks_the_action(self):
        broken = mock.Mock()
        broken.put_item.side_effect = RuntimeError("throttled")
        broken.get_item.return_value = {}
        activity.record(broken, "u1", "a@lps.com", "upload", detail="f", group="upload#b1")  # no exception


ENV = {"DATA_BUCKET": "b", "BUCKET_REGION": "ap-southeast-1", "CHAT_TABLE": "t", "CHAT_MODEL_ID": "m",
       "GUARDRAIL_ID": "g", "GUARDRAIL_VERSION": "1", "AWS_DEFAULT_REGION": "ap-southeast-1"}


class RouteTests(unittest.TestCase):
    """The routes write the entries; the bell reads them."""

    @classmethod
    def setUpClass(cls):
        os.environ.update(ENV)
        import lambda_function
        cls.L = lambda_function

    def setUp(self):
        self.objects = {}
        self.L._read_s3 = lambda key: (self.objects[key], None) if key in self.objects else None
        self.L.s3 = mock.Mock()
        self.L.s3.put_object.side_effect = lambda **kw: self.objects.__setitem__(kw["Key"], kw["Body"])
        self.L.s3.generate_presigned_url.return_value = "https://upload"
        self.L.lambda_client = mock.Mock()
        self.L.table = FakeTable()
        clock = iter(range(1_800_000_000_000, 1_900_000_000_000, 1000))   # one second per action
        patcher = mock.patch.object(activity, "_now_ms", lambda: next(clock))
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, route, body=None, user="u1", email="a@lps.com", params=None, group="finance_hr"):
        event = {"routeKey": route, "body": json.dumps(body) if body is not None else None, "pathParameters": params,
                 "requestContext": {"authorizer": {"jwt": {"claims": {
                     "sub": user, "email": email, "cognito:groups": "[%s]" % group}}}}}
        r = self.L.lambda_handler(event, None)
        return r["statusCode"], json.loads(r["body"]) if r.get("body") else None

    def test_upload_and_matching_reach_the_bell(self):
        batch = "0123456789abcdef"
        for name in ("Resource_Plan.xlsx", "Quote_Line.xlsx"):
            self.assertEqual(self.call("POST /upload-url", {"fileName": name, "batchId": batch,
                                                            "contentType": "application/octet-stream"})[0], 200)
        status, body = self.call("POST /pipeline/reviews", {"batchId": "fedcba9876543210"})
        prefix = "results/uploads/u1/%s/%s/" % (body["date"], batch)
        self.objects[prefix + "status.json"] = json.dumps({"run": {"state": "awaiting_review",
                                                                   "step": "matching"}}).encode()
        self.objects[prefix + "review/matching.json"] = json.dumps({
            "lines": [{"id": "L1"}, {"id": "L2"}, {"id": "L3"}],
            "assignment": {"L1": "P1", "L2": "P2", "L3": None}}).encode()
        decisions = {"decisions": {"L1": "accepted", "L2": "accepted", "L3": "accepted"},
                     "assignment": {"L1": "P1", "L2": "P9", "L3": None}}
        status, _ = self.call("POST /pipeline/uploads/{date}/{batchId}/review/{step}", {"decisions": decisions},
                              params={"date": body["date"], "batchId": batch, "step": "matching"})
        self.assertEqual(status, 202)

        status, feed = self.call("GET /activity", user="u2", email="b@lps.com")
        self.assertEqual(status, 200)
        self.assertEqual([e["text"] for e in feed["events"]], [
            "confirmed the matching: 2 lines filled (1 reassigned), 1 line left unfilled. This publishes a new forecast",
            "started a review of the stored data",
            "uploaded 2 files for review"])
        self.assertEqual((feed["unseen"], feed["events"][0]["email"]), (3, "a@lps.com"))
        self.assertEqual(self.call("POST /activity/seen", user="u2", email="b@lps.com")[0], 200)
        self.assertEqual(self.call("GET /activity", user="u2", email="b@lps.com")[1]["unseen"], 0)

    def test_restricted_accounts_get_no_bell(self):
        self.assertEqual(self.call("GET /activity", group="restricted")[0], 403)


if __name__ == "__main__":
    unittest.main()

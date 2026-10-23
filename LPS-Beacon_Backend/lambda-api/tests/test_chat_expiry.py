"""A chat in use keeps all its messages: each new message moves the older ones to the chat's new expiry.
Run from lambda-api/:  python -m unittest discover -s tests"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.dont_write_bytecode = True

ENV = {"DATA_BUCKET": "b", "BUCKET_REGION": "ap-southeast-1", "CHAT_TABLE": "t", "CHAT_MODEL_ID": "m",
       "GUARDRAIL_ID": "g", "GUARDRAIL_VERSION": "1", "AWS_DEFAULT_REGION": "ap-southeast-1"}
DAY = 24 * 3600


class ChatExpiryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.update(ENV)
        import lambda_function
        cls.L = lambda_function

    def test_older_messages_move_to_the_new_expiry(self):
        new = 1_900_000_000
        pk = self.L.messages_pk("u1", "s1")
        table = mock.Mock()
        table.query.return_value = {"Items": [
            {"PK": pk, "SK": "MSG#1", "expiresAt": new - 80 * DAY},   # an old question: moved
            {"PK": pk, "SK": "MSG#2", "expiresAt": new - 2 * DAY},    # two days behind: moved
            {"PK": pk, "SK": "MSG#3", "expiresAt": new - 3600},       # less than a day behind: left alone
        ]}
        with mock.patch.object(self.L, "table", table):
            self.L.extend_chat_expiry("u1", "s1", new)
        moved = [c.kwargs["Key"]["SK"] for c in table.update_item.call_args_list]
        self.assertEqual(moved, ["MSG#1", "MSG#2"])
        self.assertEqual(table.update_item.call_args.kwargs["ExpressionAttributeValues"], {":e": new})

    def test_a_failure_does_not_stop_the_answer(self):
        table = mock.Mock()
        table.query.side_effect = RuntimeError("throttled")
        with mock.patch.object(self.L, "table", table):
            self.L.extend_chat_expiry("u1", "s1", 1_900_000_000)   # no exception

    def test_retention_defaults_to_90_days(self):
        self.assertEqual(self.L.RETENTION_SECONDS, 90 * DAY)


if __name__ == "__main__":
    unittest.main()

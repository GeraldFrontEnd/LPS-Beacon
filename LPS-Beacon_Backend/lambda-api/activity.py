"""
Activity log for the bell on the top bar: who uploaded files, went through a review step or changed the capacity
plan, and when. Only Finance/HR accounts see it (they are the only ones who can do any of this).

Items live in the chat table (CHAT_TABLE), next to the chat history:
  Event  PK = ACTIVITY        SK = EVT#{start ms, 13 digits}#{random}  kind, by, email, count, details, atMs, ...
  Open   PK = ACTIVITY        SK = OPEN#{user}#{group}  evt (the event's SK), atMs
         Folds related actions of one person into one event: every file of one upload, and capacity plan
         changes made less than FOLD_MINUTES apart. Without it, typing 12 cells would be 12 bell entries.
  Seen   PK = USER#{sub}      SK = META#activity-seen  atMs   (when this person last opened the bell)
Events expire after ACTIVITY_DAYS (DynamoDB TTL on expiresAt, the same setting the chats use).

Logging never stops the action it describes: record() catches its own errors and only prints them.
Two people acting in the same instant can lose one count in a folded event (last write wins), which is fine
for a log that says "who did what".
"""
import time
import uuid

ACTIVITY_PK = "ACTIVITY"
ACTIVITY_DAYS = 90
FOLD_MINUTES = 15
MAX_DETAILS = 20          # detail lines kept per event (the count keeps going)
FEED_SIZE = 50            # events the bell shows

# Rows of the capacity plan, as the Analysis page names them (src/analysis/capacityPlanLayout.ts).
SECTION_LABELS = {
    "current-hc": "Current HC", "joiners": "Joiners", "leavers": "Leavers", "revenue": "Revenue",
    "billable-ur": "Billable UR", "working-days": "Working days",
}

AREAS = {"upload": "Upload", "stored_review": "Review", "conflicts": "Review", "forecast": "Review",
         "forecast_redo": "Review", "forecast_rejected": "Review", "matching": "Review",
         "matching_rejected": "Review", "plan_edit": "Analysis", "plan_clear": "Analysis"}


def _now_ms():
    return int(time.time() * 1000)


def _plural(n, word):
    return "%d %s%s" % (n, word, "" if n == 1 else "s")


def cell_detail(row_id, column, value):
    """'Joiners · Band 7 · Nov'26: 3' for one changed cell (value None = put back to the worked-out value)."""
    section, _, band = row_id.partition(":")
    parts = [SECTION_LABELS.get(section, section)]
    if band:
        parts.append("Band " + band[1:])
    parts.append(column)
    if value is None:
        shown = "reset to the worked-out value"
    elif section == "billable-ur":
        shown = "%.1f%%" % (value * 100)
    elif section == "revenue":
        shown = "$%.2fM" % (value / 1e6)
    else:
        shown = "%g" % value
    return "%s: %s" % (" · ".join(parts), shown)


def text(item):
    """What the bell says after the person's email."""
    kind, n, x = item.get("kind"), int(item.get("count", 1)), item.get("extra") or {}
    num = lambda k: int(x.get(k, 0))  # noqa: E731
    if kind == "upload":
        return "uploaded %s %s" % (_plural(n, "file"), "for review" if x.get("review", True) else "without a review")
    if kind == "stored_review":
        return "started a review of the stored data"
    if kind == "conflicts":
        return "resolved %s in the review" % _plural(num("conflicts"), "data conflict")
    if kind in ("forecast", "forecast_redo"):
        lead = "went back and changed the opportunity forecast" if kind == "forecast_redo" \
            else "confirmed the opportunity forecast"
        return "%s: %d accepted, %d rejected" % (lead, num("accepted"), num("rejected"))
    if kind == "forecast_rejected":
        return "rejected the opportunity forecast (matching uses current project demand only)"
    if kind == "matching":
        changed = " (%d reassigned)" % num("reassigned") if num("reassigned") else ""
        return ("confirmed the matching: %s filled%s, %s left unfilled. This publishes a new forecast"
                % (_plural(num("filled"), "line"), changed, _plural(num("unfilled"), "line")))
    if kind == "matching_rejected":
        return "rejected the matching, so nothing was published"
    if kind == "plan_edit":
        return "changed %s in the capacity plan" % _plural(n, "cell")
    if kind == "plan_clear":
        return "cleared %s in the capacity plan" % _plural(num("cleared"), "of their changed cell")
    return str(kind or "did something")


def record(table, user_id, email, kind, detail=None, group=None, fold_ms=None, extra=None, now=None):
    """Adds an event, or folds it into the person's open event for `group` (fold_ms None = no time limit)."""
    try:
        ms = now if now is not None else _now_ms()
        expires = ms // 1000 + ACTIVITY_DAYS * 24 * 3600
        event = None
        if group:
            open_key = {"PK": ACTIVITY_PK, "SK": "OPEN#%s#%s" % (user_id, group)}
            pointer = table.get_item(Key=open_key).get("Item")
            if pointer and (fold_ms is None or ms - int(pointer["atMs"]) <= fold_ms):
                event = table.get_item(Key={"PK": ACTIVITY_PK, "SK": pointer["evt"]}).get("Item")
        if event:
            details = list(event.get("details") or [])
            repeat = False
            if detail:
                # The same cell (or file) again replaces its line instead of adding one, and isn't counted twice.
                label = detail.split(": ", 1)[0]
                repeat = any(d.split(": ", 1)[0] == label for d in details)
                details = ([d for d in details if d.split(": ", 1)[0] != label] + [detail])[-MAX_DETAILS:]
            event["count"] = int(event.get("count", 1)) + (0 if repeat else 1)
            event.update(details=details, atMs=ms, expiresAt=expires)
            if extra:
                event["extra"] = {**(event.get("extra") or {}), **extra}
        else:
            event = {"PK": ACTIVITY_PK, "SK": "EVT#%013d#%s" % (ms, uuid.uuid4().hex[:6]), "kind": kind,
                     "by": user_id, "email": email or "", "count": 1, "details": [detail] if detail else [],
                     "atMs": ms, "expiresAt": expires}
            if extra:
                event["extra"] = extra
        table.put_item(Item=event)
        if group:
            table.put_item(Item={"PK": ACTIVITY_PK, "SK": "OPEN#%s#%s" % (user_id, group), "evt": event["SK"],
                                 "atMs": ms, "expiresAt": expires})
    except Exception as e:  # the log must never break the upload, review or edit it describes
        print("Activity log failed for", kind, "-", type(e).__name__, e)


def seen_key(user_id):
    return {"PK": "USER#" + user_id, "SK": "META#activity-seen"}


def feed(table, user_id, iso, now=None):
    """The bell's list, newest first, and how many of the entries by other people this person hasn't seen."""
    ms = now if now is not None else _now_ms()
    page = table.query(KeyConditionExpression=_key_condition(), ScanIndexForward=False, Limit=FEED_SIZE + 10)
    items = [i for i in page.get("Items", []) if int(i.get("expiresAt", 0)) >= ms // 1000]
    items.sort(key=lambda i: int(i["atMs"]), reverse=True)
    items = items[:FEED_SIZE]
    seen = table.get_item(Key=seen_key(user_id)).get("Item")
    seen_ms = int(seen["atMs"]) if seen else 0
    events = [{
        "id": i["SK"][len("EVT#"):], "email": i.get("email") or "someone", "mine": i.get("by") == user_id,
        "area": AREAS.get(i.get("kind"), "Other"), "text": text(i), "details": list(i.get("details") or []),
        "count": int(i.get("count", 1)), "at": iso(int(i["atMs"])), "new": i.get("by") != user_id
        and int(i["atMs"]) > seen_ms,
    } for i in items]
    return {"events": events, "seenAt": iso(seen_ms) if seen_ms else None,
            "unseen": sum(1 for e in events if e["new"])}


def mark_seen(table, user_id, now=None):
    ms = now if now is not None else _now_ms()
    table.put_item(Item={**seen_key(user_id), "atMs": ms})
    return ms


def _key_condition():
    from boto3.dynamodb.conditions import Key
    return Key("PK").eq(ACTIVITY_PK) & Key("SK").begins_with("EVT#")

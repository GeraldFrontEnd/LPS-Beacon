"""
LPS-Beacon API Lambda (router)

One function behind every API Gateway route. API Gateway checks the login token (JWT authorizer) before this code
runs; this code decides WHO may do WHAT, because the authorizer does not look at Cognito groups.

Routes (API Gateway route key -> handler). Unbuilt routes answer 501 so the frontend gets a clear message.
  POST   /upload-url                 finance_hr   pre-signed S3 upload link            (built)
  POST   /chat                       signed in    question -> answer, saved to history (built; placeholder answer
                                                  until Bedrock is connected)
  GET    /sessions                   signed in    the caller's chats, newest first     (built)
  GET    /sessions/{id}/messages     signed in    one chat's messages (own chats only) (built)
  PATCH  /sessions/{id}              signed in    rename / move a chat (own chats only)(built)
  DELETE /sessions/{id}              signed in    delete a chat and its messages       (built)
  GET    /analysis                   finance_hr   capacity plan                        (501)
  PATCH  /analysis                   finance_hr   edit one cell, return the whole plan (501)
  GET    /dashboard                  finance_hr   headcount breakdown                  (501)
  POST   /runs/runForecast           finance_hr   start a forecast run                 (501)
  GET    /runs/{id}                  finance_hr   run status                           (501)

Settings: Lambda > Configuration > Environment variables
  DATA_BUCKET     the bucket NAME, for example  lps-beacon-data   (not the ARN)
  BUCKET_REGION   the region the BUCKET is in, for example  ap-southeast-1
  CHAT_TABLE      the DynamoDB table NAME, for example  lps-beacon-chat
  CHAT_RETENTION_DAYS   optional, how long an unused chat is kept (default 90)

API Gateway integration: payload format version 2.0 (the code reads requestContext.authorizer.jwt.claims).
Permissions needed on the function's role:
  s3:PutObject  on  arn:aws:s3:::lps-beacon-data/raw/*
  dynamodb:GetItem, PutItem, UpdateItem, DeleteItem, Query, BatchWriteItem  on the CHAT_TABLE table only

Chat history keys (see "Chat history model" in the root README). The user id is inside every key, so a user can only
ever reach their own chats: someone else's chat id simply finds nothing.
  Session   PK = USER#{sub}               SK = SESSION#{id}
  Message   PK = USER#{sub}#SESSION#{id}  SK = MSG#{milliseconds}#{random}
Runtime: Python 3.12.  Handler: lambda_function.lambda_handler
"""

import datetime
import json
import os
import re
import traceback
import uuid

import time

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

BUCKET = os.environ["DATA_BUCKET"]
REGION = os.environ["BUCKET_REGION"]
CHAT_TABLE = os.environ["CHAT_TABLE"]
RETENTION_SECONDS = int(os.environ.get("CHAT_RETENTION_DAYS", "90")) * 24 * 3600

MAX_MESSAGE_CHARS = 4000
MAX_TITLE_CHARS = 100

FINANCE_HR = "finance_hr"       # may use every route
RESTRICTED = "restricted"       # chat and their own chat history only
KNOWN_GROUPS = {FINANCE_HR, RESTRICTED}

LINK_LIFETIME_SECONDS = 300     # an upload link works for 5 minutes

# Spreadsheet and delimited-text files that Excel, SAP and HR / finance systems export.
ALLOWED_EXTENSIONS = {".csv", ".tsv", ".txt", ".xlsx", ".xlsm", ".xlsb", ".xls", ".ods"}

# The browser reports a file type; the link only works if the upload sends exactly the same one.
# Browsers report different types for the same file, so the common variants are listed.
ALLOWED_TYPES = {
    "application/octet-stream",
    "text/csv", "application/csv", "text/x-csv", "application/x-csv", "text/comma-separated-values",
    "text/tab-separated-values", "text/plain",
    "application/vnd.ms-excel", "application/msexcel", "application/x-msexcel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
    "application/vnd.oasis.opendocument.spreadsheet",
}

# Sign for the BUCKET's region (a link for the wrong region is redirected and the browser upload fails).
_options = {"region_name": REGION, "signature_version": "s3v4", "s3": {"addressing_style": "virtual"}}
try:
    # Newer boto3 adds a checksum a browser cannot produce; this turns it off.
    _config = Config(request_checksum_calculation="when_required", **_options)
except TypeError:
    _config = Config(**_options)  # older boto3 does not have (or need) that setting
s3 = boto3.client("s3", config=_config)
table = boto3.resource("dynamodb", region_name=REGION).Table(CHAT_TABLE)


# ---------- small helpers ----------

class HttpError(Exception):
    """Raise this anywhere to stop and answer the browser with a status code and message."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def reply(status, message_or_body=None):
    if status == 204:
        return {"statusCode": 204, "headers": {"Cache-Control": "no-store"}}
    body = message_or_body if isinstance(message_or_body, (dict, list)) else {"message": message_or_body}
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body),
    }


class Caller:
    """Who is asking, taken ONLY from the token API Gateway has already verified. Never from the request body."""

    def __init__(self, event):
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        self.user_id = str(claims.get("sub", ""))
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", self.user_id):
            raise HttpError(401, "Not signed in")
        # HTTP APIs pass the group list as text, for example "[finance_hr restricted]".
        self.groups = set(re.findall(r"[a-z_]+", str(claims.get("cognito:groups", "")).lower())) & KNOWN_GROUPS
        if not self.groups:
            raise HttpError(403, "Your account is not in a group yet. Ask an administrator to add you to one.")

    @property
    def is_finance_hr(self):
        return FINANCE_HR in self.groups

    def require_finance_hr(self):
        if not self.is_finance_hr:
            raise HttpError(403, "Your role is not allowed to use this feature")


def json_body(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except ValueError:
        raise HttpError(400, "The request body must be JSON")
    if not isinstance(body, dict):
        raise HttpError(400, "The request body must be a JSON object")
    return body


def path_id(event):
    """The {id} part of /sessions/{id} or /runs/{id}, checked so it can be used safely as a key."""
    value = str((event.get("pathParameters") or {}).get("id", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
        raise HttpError(400, "Invalid id")
    return value


def not_built(what):
    raise HttpError(501, "%s is not available yet" % what)


# ---------- chat history storage (DynamoDB) ----------

ID_PATTERN = r"[A-Za-z0-9_-]{1,64}"


def now_ms():
    return int(time.time() * 1000)


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def session_key(user_id, session_id):
    return {"PK": "USER#" + user_id, "SK": "SESSION#" + session_id}


def messages_pk(user_id, session_id):
    return "USER#%s#SESSION#%s" % (user_id, session_id)


def title_from(text):
    """Sidebar title from the first question, the same rule the web app uses."""
    one_line = " ".join(text.split())
    return one_line if len(one_line) <= 60 else one_line[:57] + "\u2026"


def session_json(item):
    """The shape the web app's sidebar uses (Chat in src/chats/useChatHistory.ts, without the messages)."""
    return {
        "id": item["SK"][len("SESSION#"):],
        "title": item.get("title", "New chat"),
        "projectId": item.get("projectId"),
        "createdAt": int(item.get("createdAt", 0)),
        "updatedAt": int(item.get("updatedAt", 0)),
    }


def message_json(item):
    """The shape the web app's chat window uses (ChatMessage in src/api/types.ts)."""
    return {
        "id": item["SK"][len("MSG#"):],
        "sender": item["sender"],
        "text": item["text"],
        "timestamp": iso(int(item["createdAt"])),
    }


def get_own_session(user_id, session_id):
    """The caller's session, or 404. Another user's session with the same id is never found."""
    item = table.get_item(Key=session_key(user_id, session_id)).get("Item")
    if not item or int(item.get("expiresAt", 0)) < time.time():
        raise HttpError(404, "Chat not found")
    return item


def save_message(user_id, session_id, sender, text, ms):
    message_id = "%013d#%s" % (ms, uuid.uuid4().hex[:6])
    table.put_item(Item={
        "PK": messages_pk(user_id, session_id),
        "SK": "MSG#" + message_id,
        "sender": sender,
        "text": text,
        "createdAt": ms,
        "expiresAt": ms // 1000 + RETENTION_SECONDS,
    })


def query_all(**kwargs):
    """Runs a DynamoDB query and follows the pages until every item is read."""
    items = []
    while True:
        page = table.query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def answer(caller, session_id, message):
    """The assistant's reply. Placeholder until the Bedrock step replaces this function."""
    # TODO (Bedrock step): offer cost and margin tools only when caller.is_finance_hr.
    return "Beacon is not connected to the AI model yet, so this is a placeholder reply. Your question was saved."


# ---------- route handlers ----------

def upload_url(event, caller):
    caller.require_finance_hr()

    body = json_body(event)
    file_name = str(body.get("fileName", ""))
    content_type = str(body.get("contentType") or "application/octet-stream")

    name = os.path.basename(file_name.replace("\\", "/")).strip()
    stem, extension = os.path.splitext(name)
    extension = extension.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HttpError(400, "File type not allowed. Allowed: " + ", ".join(sorted(ALLOWED_EXTENSIONS)))
    if content_type not in ALLOWED_TYPES:
        raise HttpError(400, "File type %r is not allowed" % content_type)

    # The file will be stored as raw/<user id>/<date>/<random>-<name>
    safe_stem = re.sub(r"[^\w.-]+", "_", stem).strip("._")[:100] or "file"
    key = "raw/%s/%s/%s-%s%s" % (
        caller.user_id, datetime.date.today().isoformat(), uuid.uuid4().hex[:8], safe_stem, extension)
    link = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=LINK_LIFETIME_SECONDS,
    )
    print("Upload link issued for user", caller.user_id, "type", extension)
    return reply(200, {"uploadUrl": link, "key": key})


def chat(event, caller):
    body = json_body(event)
    session_id = str(body.get("sessionId", ""))
    message = str(body.get("message", "")).strip()
    if not re.fullmatch(ID_PATTERN, session_id):
        raise HttpError(400, "Send a valid sessionId")
    if not message or len(message) > MAX_MESSAGE_CHARS:
        raise HttpError(400, "Send a message between 1 and %d characters" % MAX_MESSAGE_CHARS)

    # There is no POST /sessions: the first message with a new chat id creates the chat, under THIS user's key.
    # If another user happens to use the same id, they get their own separate chat; nothing is shared.
    asked_at = now_ms()
    try:
        table.put_item(
            Item=dict(session_key(caller.user_id, session_id), title=title_from(message), projectId=None,
                      createdAt=asked_at, updatedAt=asked_at, expiresAt=asked_at // 1000 + RETENTION_SECONDS),
            ConditionExpression="attribute_not_exists(PK)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # The chat already exists: carry on adding to it.

    save_message(caller.user_id, session_id, "user", message, asked_at)
    reply_text = answer(caller, session_id, message)
    replied_at = max(now_ms(), asked_at + 1)   # keeps the reply after the question
    save_message(caller.user_id, session_id, "assistant", reply_text, replied_at)

    table.update_item(
        Key=session_key(caller.user_id, session_id),
        UpdateExpression="SET updatedAt = :u, expiresAt = :e",
        ExpressionAttributeValues={":u": replied_at, ":e": replied_at // 1000 + RETENTION_SECONDS},
    )
    return reply(200, {"reply": reply_text})


def list_sessions(event, caller):
    items = query_all(
        KeyConditionExpression=Key("PK").eq("USER#" + caller.user_id) & Key("SK").begins_with("SESSION#"))
    now = time.time()
    sessions = [session_json(i) for i in items if int(i.get("expiresAt", 0)) >= now]  # TTL deletes lazily
    sessions.sort(key=lambda s: s["updatedAt"], reverse=True)
    return reply(200, {"sessions": sessions})


def get_session_messages(event, caller):
    session_id = path_id(event)
    session = get_own_session(caller.user_id, session_id)
    items = query_all(KeyConditionExpression=Key("PK").eq(messages_pk(caller.user_id, session_id)),
                      ScanIndexForward=True)  # oldest first
    return reply(200, {"session": session_json(session), "messages": [message_json(i) for i in items]})


def update_session(event, caller):
    session_id = path_id(event)
    body = json_body(event)
    names, values, parts = {}, {":u": now_ms()}, ["updatedAt = :u"]

    if "title" in body:
        title = " ".join(str(body.get("title") or "").split())
        if not title or len(title) > MAX_TITLE_CHARS:
            raise HttpError(400, "Send a title between 1 and %d characters" % MAX_TITLE_CHARS)
        parts.append("title = :t")
        values[":t"] = title
    if "projectId" in body:
        project_id = body.get("projectId")
        if project_id is not None and not re.fullmatch(ID_PATTERN, str(project_id)):
            raise HttpError(400, "Invalid projectId")
        parts.append("projectId = :p")
        values[":p"] = None if project_id is None else str(project_id)
    if len(parts) == 1:
        raise HttpError(400, "Send a title or a projectId to change")

    try:
        result = table.update_item(
            Key=session_key(caller.user_id, session_id),
            UpdateExpression="SET " + ", ".join(parts),
            ConditionExpression="attribute_exists(PK)",   # never creates a chat by accident
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
            **({"ExpressionAttributeNames": names} if names else {}),
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HttpError(404, "Chat not found")
        raise
    return reply(200, session_json(result["Attributes"]))


def delete_session(event, caller):
    session_id = path_id(event)
    get_own_session(caller.user_id, session_id)
    keys = query_all(KeyConditionExpression=Key("PK").eq(messages_pk(caller.user_id, session_id)),
                     ProjectionExpression="PK, SK")
    with table.batch_writer() as batch:   # deletes in groups of 25 and retries what DynamoDB pushes back
        for k in keys:
            batch.delete_item(Key={"PK": k["PK"], "SK": k["SK"]})
    table.delete_item(Key=session_key(caller.user_id, session_id))
    return reply(204)


def get_analysis(event, caller):
    caller.require_finance_hr()
    not_built("The capacity plan")


def edit_analysis(event, caller):
    caller.require_finance_hr()
    not_built("Editing the capacity plan")


def get_dashboard(event, caller):
    caller.require_finance_hr()
    not_built("The headcount breakdown")


def run_forecast(event, caller):
    caller.require_finance_hr()
    not_built("Forecast runs")


def get_run(event, caller):
    caller.require_finance_hr()
    path_id(event)
    not_built("Run status")


# API Gateway route key -> handler. The keys must match the routes in API Gateway exactly.
ROUTES = {
    "POST /upload-url": upload_url,
    "POST /chat": chat,
    "GET /sessions": list_sessions,
    "GET /sessions/{id}/messages": get_session_messages,
    "PATCH /sessions/{id}": update_session,
    "DELETE /sessions/{id}": delete_session,
    "GET /analysis": get_analysis,
    "PATCH /analysis": edit_analysis,
    "GET /dashboard": get_dashboard,
    "POST /runs/runForecast": run_forecast,
    "GET /runs/{id}": get_run,
}


def lambda_handler(event, context):
    route_key = str(event.get("routeKey", ""))
    try:
        handler = ROUTES.get(route_key)
        if handler is None:
            print("No route for routeKey=%r rawPath=%r" % (route_key, event.get("rawPath")))
            return reply(404, "Not found")
        caller = Caller(event)   # every route needs a signed-in user in a known group
        return handler(event, caller)
    except HttpError as e:
        if e.status >= 500 or e.status in (401, 403):
            print("Refused %s with %d: %s" % (route_key, e.status, e.message))
        return reply(e.status, e.message)
    except Exception:
        print("ERROR", traceback.format_exc())  # the details appear in CloudWatch Logs, never in the browser
        return reply(500, "Something went wrong")

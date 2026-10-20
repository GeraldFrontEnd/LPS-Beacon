"""
LPS-Beacon API Lambda (router)

One function behind every API Gateway route. API Gateway checks the login token (JWT authorizer) before this code
runs; this code decides WHO may do WHAT, because the authorizer does not look at Cognito groups.

Routes (API Gateway route key -> handler). Unbuilt routes answer 501 so the frontend gets a clear message.
  POST   /upload-url                 finance_hr   pre-signed S3 upload link            (built)
  POST   /chat                       signed in    question -> answer                   (501, next: Bedrock)
  GET    /sessions                   signed in    the caller's chats                   (501, next: DynamoDB)
  GET    /sessions/{id}/messages     signed in    one chat's messages (owner only)     (501)
  PATCH  /sessions/{id}              signed in    rename / move a chat (owner only)    (501)
  DELETE /sessions/{id}              signed in    delete a chat (owner only)           (501)
  GET    /analysis                   finance_hr   capacity plan                        (501)
  PATCH  /analysis                   finance_hr   edit one cell, return the whole plan (501)
  GET    /dashboard                  finance_hr   headcount breakdown                  (501)
  POST   /runs/runForecast           finance_hr   start a forecast run                 (501)
  GET    /runs/{id}                  finance_hr   run status                           (501)

Settings: Lambda > Configuration > Environment variables
  DATA_BUCKET     the bucket NAME, for example  lps-beacon-data   (not the ARN)
  BUCKET_REGION   the region the BUCKET is in, for example  ap-southeast-1

API Gateway integration: payload format version 2.0 (the code reads requestContext.authorizer.jwt.claims).
Permission needed on the function's role:  s3:PutObject  on  arn:aws:s3:::lps-beacon-data/raw/*
Runtime: Python 3.12.  Handler: lambda_function.lambda_handler
"""

import datetime
import json
import os
import re
import traceback
import uuid

import boto3
from botocore.config import Config

BUCKET = os.environ["DATA_BUCKET"]
REGION = os.environ["BUCKET_REGION"]

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
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", session_id):
        raise HttpError(400, "Send a valid sessionId")
    if not message or len(message) > 4000:
        raise HttpError(400, "Send a message between 1 and 4000 characters")
    # TODO (DynamoDB step): if this session exists and belongs to someone else, answer 404 (not 403, so ids
    #   cannot be probed); if it does not exist, create it for caller.user_id.
    # TODO (Bedrock step): offer cost and margin tools only when caller.is_finance_hr.
    not_built("Chat")


def list_sessions(event, caller):
    not_built("Chat history")


def get_session_messages(event, caller):
    path_id(event)
    not_built("Chat history")   # must only return the session if it belongs to caller.user_id


def update_session(event, caller):
    path_id(event)
    not_built("Renaming chats")  # owner only


def delete_session(event, caller):
    path_id(event)
    not_built("Deleting chats")  # owner only


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

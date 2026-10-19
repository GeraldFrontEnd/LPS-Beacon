"""
LPS-Beacon upload Lambda (simple version)

What it does
------------
The website asks  POST /api/upload-url  and this function answers with a temporary link (a "pre-signed URL")
that lets the browser put ONE file straight into the S3 bucket. The file itself never goes through this function.

Settings: Lambda > Configuration > Environment variables
---------------------------------------------------------
  DATA_BUCKET     the bucket NAME, for example  lps-beacon-data   (not the ARN)
  BUCKET_REGION   the region the BUCKET is in, for example  ap-southeast-1

Permission needed on the function's role:  s3:PutObject  on  arn:aws:s3:::lps-beacon-data/raw/*
Runtime: Python 3.12.  Timeout: 10 seconds.  Handler: lambda_function.lambda_handler
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

ALLOWED_GROUPS = {"finance_hr"}        # Cognito groups that may upload (restricted accounts may not)
LINK_LIFETIME_SECONDS = 300             # a link works for 5 minutes

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


def reply(status, message_or_body):
    body = message_or_body if isinstance(message_or_body, dict) else {"message": message_or_body}
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body),
    }


def handle(event):
    # 1) Is this the upload-link request? (Works for a console test event and for a real API Gateway request.)
    http = event.get("requestContext", {}).get("http", {})
    route_key = str(event.get("routeKey", ""))
    method = (http.get("method") or route_key.split(" ")[0]).upper()
    path = str(event.get("rawPath") or route_key)
    if method != "POST" or not path.rstrip("/").endswith("/upload-url"):
        print("No route for routeKey=%r rawPath=%r" % (route_key, event.get("rawPath")))  # shows what arrived
        return reply(404, "Not found")

    # 2) Who is asking? API Gateway has already checked the login token; these are its details.
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    user_id = str(claims.get("sub", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", user_id):
        return reply(401, "Not signed in")
    groups = set(re.findall(r"[a-z_]+", str(claims.get("cognito:groups", "")).lower()))  # e.g. "[finance hr]"
    if not groups & ALLOWED_GROUPS:
        return reply(403, "Your role is not allowed to upload files")

    # 3) What do they want to upload?
    try:
        body = json.loads(event.get("body") or "{}")
        file_name = str(body.get("fileName", ""))
        content_type = str(body.get("contentType") or "application/octet-stream")
    except (ValueError, AttributeError):
        return reply(400, "Send a JSON body with fileName and contentType")

    name = os.path.basename(file_name.replace("\\", "/")).strip()
    stem, extension = os.path.splitext(name)
    extension = extension.lower()
    if extension not in ALLOWED_EXTENSIONS:
        return reply(400, "File type not allowed. Allowed: " + ", ".join(sorted(ALLOWED_EXTENSIONS)))
    if content_type not in ALLOWED_TYPES:
        return reply(400, "File type %r is not allowed" % content_type)

    # 4) Make the link. The file will be stored as raw/<user id>/<date>/<random>-<name>
    safe_stem = re.sub(r"[^\w.-]+", "_", stem).strip("._")[:100] or "file"
    key = "raw/%s/%s/%s-%s%s" % (user_id, datetime.date.today().isoformat(), uuid.uuid4().hex[:8], safe_stem, extension)
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=LINK_LIFETIME_SECONDS,
    )
    print("Upload link issued for user", user_id, "type", extension)
    return reply(200, {"uploadUrl": upload_url, "key": key})


def lambda_handler(event, context):
    try:
        return handle(event)
    except Exception:
        print("ERROR", traceback.format_exc())  # the details appear in CloudWatch Logs, never in the browser
        return reply(500, "Something went wrong")

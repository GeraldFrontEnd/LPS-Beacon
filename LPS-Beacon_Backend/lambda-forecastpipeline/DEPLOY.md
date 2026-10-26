# lambda-forecastpipeline: AWS configuration, step by step

Region: **ap-southeast-1**. Bucket: **lps-beacon-data**. Everything is in the AWS console
except building the image (Step 4), which needs Docker Desktop on your PC.

## What starts the pipeline, and what runs

| Started by | Event | What runs |
|---|---|---|
| **End-user upload** under `raw/` | S3 event notification | validate → clean each file; after the **last file of the upload**: match → forecast → publish |
| On demand (console test only; see the warning below) | `{"mode": "full", "requestedBy": "<email>"}` | match → forecast → publish on the latest cleaned files, **without the review** |
| Monthly schedule `lps-beacon-monthly-forecast` (Step 10) | `{"mode": "dashboard_data"}` | rebuilds `results/capacity/inputs.json` and the Dashboard insights only |
| Review decision (API Lambda) | `{"mode": "review", "batchId": "...", "step": "...", "decisions": {...}}` | the next review step |
| Review of the stored data (API Lambda, `POST /pipeline/reviews`) | `{"mode": "review_start", "batchId": "..."}` | the same review on the latest `clean/` data |
| Partial re-run (console/API) | `{"mode": "full", "stages": ["forecast", "publish"]}` | only those stages; the planning date of the reused matching run is kept |
| Re-clean files | `{"mode": "file", "keys": ["raw/..."], "autoRun": true}` | validate → clean, then the run |
| Deployment check | `{"mode": "selfcheck"}` | checks only, no data changed |

Optional on any run: `"asOf": "2026-09-01"` (planning date). Without it: `AS_OF_DATE`, else the
1st of the current month. A partial run keeps the reused stage's planning date, and refuses
an `asOf` that differs from it (include `"match"` to rerun for a new date).

> **Never schedule `{"mode": "full"}`, and don't run it against the live bucket.** It publishes without the review,
> overwrites `results/latest.json` and resets the capacity plan's joiners to 0 (a run without a review has no
> hiring gap).

### How an upload becomes a review page

1. The upload page PUTs all files of one upload into one folder, using pre-signed URLs from the API
   Lambda's `POST /upload-url`:
   `raw/<user id (Cognito sub)>/<yyyy-mm-dd>/<batchId>/<original file name>`
   (`batchId` = a UUID the page generates per upload). For an "upload without review" the API
   Lambda also writes `raw/.../<batchId>/_batch.json` with `{"review": false}`. The pipeline also
   accepts `{"expectedFiles": n}` there.
2. Each file starts one invocation (one S3 event each). Every invocation cleans its file and
   updates `results/uploads/<user>/<date>/<batchId>/status.json`.
3. The invocation that finds no unprocessed file left in the folder (after
   `UPLOAD_SETTLE_SECONDS` without new files, or `expectedFiles` reached) starts
   the review (`REVIEW_ON_UPLOAD=true`) or, without it, runs match → forecast → publish. Exactly
   one run per upload.
4. The page polls the status file until `run.state` is `published`, then reads
   `run.resultsPrefix` (`summary/`, `detail/`, `manifest.json`) for the review page.
   `run.kpis` and `run.warnings` are in the status file too, for the summary panel.

`run.state` values: `waiting_for_files`, `waiting_for_inputs` (no resource plan or quote line
cleaned yet), `not_run` (every file rejected; `files[].reason` says why), `disabled`
(`AUTO_RUN_ON_UPLOAD=false`), `running`, `published`, `failed` (`message` has the error;
fix the cause and upload again).

Uploads with the older key layout `raw/<user>/<date>/<id>-<n>.csv` still work, but every
upload by that user on that day is then one batch. The API Lambda already uses the folder
layout above.

Upload only the **inputs**: Project Resource Plan, Quote Line and Position Name Mapping for the
matching; SFDC pipeline, ABCD and SL x RP for the opportunity forecast; the BU UR report and the
staff list for the capacity plan and Dashboard; optionally a rates file (`Grade`, `Daily Rate`,
`Daily Cost`). `matching_result_new.xlsx` is
an output; uploading it is rejected to `quarantine/` (the rest of the upload still runs).

### Folders written in `lps-beacon-data`

```
raw/...                              uploads, never changed (written by the upload page only)
quarantine/...                       rejected uploads + <file>.reason.json (write-only)
clean/<dataset>/latest_wide.json.gz, latest_long.json.gz, latest.quality.json, history/...
clean/position_mapping/latest.xlsx   the mapping workbook, for the matching script
curated/matching|forecast|finance/<run_id>/ and latest/   (+ run.json with the planning date)
results/<run_id>/summary/            aggregates, no person names (dashboard + chatbot)
results/<run_id>/detail/             matching sheets (contain names) - unrestricted roles only
results/<run_id>/finance/            revenue, cost, P&L - finance group only
results/<run_id>/manifest.json       trigger, batch, planning date, parameters, warnings, data gaps
results/uploads/<user>/<date>/<batchId>/status.json   per-upload progress for the upload page
results/latest.json                  pointer to the newest run (written last)
results/capacity/inputs.json         capacity plan inputs (Analysis page, Dashboard)
results/dashboard/                   Dashboard insights
plan/edits.json                      shared capacity plan edits (written by the API Lambda)
```

**Do not empty this bucket.** `clean/`, `curated/`, `results/` and `plan/` are live state. `results/latest/`
is an old CSV fallback: always resolve `results/latest.json` instead.

---

## Step 1: SNS topic for emails (optional, not set up)

The current deployment has no topic and no `ALERT_TOPIC_ARN`, so no emails are sent. Do this step
only if you want published / failed emails.

1. SNS → Topics → **Create topic** → Standard → Name `lps-beacon-pipeline-alerts` → Create.
2. **Create subscription** → Protocol **Email** → your address → Create, then confirm it from the email.
3. Copy the **topic ARN**.

## Step 2: IAM role for the pipeline

1. IAM → Roles → **Create role** → AWS service → **Lambda** → attach **AWSLambdaBasicExecutionRole**
   → name `lps-beacon-pipeline-role` → Create (or edit the existing role).
2. **Add permissions → Create inline policy → JSON** (replace `<topic-arn>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadInputsAndOwnOutputs", "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": ["arn:aws:s3:::lps-beacon-data/raw/*",
                   "arn:aws:s3:::lps-beacon-data/clean/*",
                   "arn:aws:s3:::lps-beacon-data/curated/*",
                   "arn:aws:s3:::lps-beacon-data/results/*"] },
    { "Sid": "WriteOutputs", "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": ["arn:aws:s3:::lps-beacon-data/clean/*",
                   "arn:aws:s3:::lps-beacon-data/curated/*",
                   "arn:aws:s3:::lps-beacon-data/results/*",
                   "arn:aws:s3:::lps-beacon-data/quarantine/*"] },
    { "Sid": "ListOwnPrefixes", "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::lps-beacon-data",
      "Condition": { "StringLike": { "s3:prefix": ["raw/*", "clean/*", "curated/*", "results/*"] } } },
    { "Sid": "SelfCheckReadOnly", "Effect": "Allow",
      "Action": ["s3:GetEncryptionConfiguration", "s3:GetBucketNotification"],
      "Resource": "arn:aws:s3:::lps-beacon-data" },
    { "Sid": "Email", "Effect": "Allow", "Action": "sns:Publish", "Resource": "<topic-arn>" }
  ]
}
```

What changed from the previous version: `raw/*` is listed (to see which files of an upload
are still unprocessed), `results/*` is read (the upload status files), and two read-only
bucket settings for the self-check. Still no delete permission: the pipeline never deletes.

3. **Only if the bucket's default encryption is SSE-KMS** (S3 → bucket → Properties → Default
   encryption), add, with the key ARN shown there:

```json
{ "Sid": "BucketKmsKey", "Effect": "Allow",
  "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
  "Resource": "arn:aws:kms:ap-southeast-1:<account>:key/<key-id>" }
```

   The API Lambda's role then also needs `kms:Decrypt` on that key to read `results/`.
   The self-check (Step 11) tells you which encryption the bucket uses.

## Step 3: ECR repository

ECR → **Create repository** → Private → name `lambda-forecastpipeline` → Create.

## Step 4: build and push the image (on your PC)

Install Docker Desktop and the AWS CLI (signed in to the account), then in PowerShell in this folder:

```
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
.\build.ps1 -Push -Account <12-digit account id>
```

It runs the tests, builds the image (`--platform linux/amd64 --provenance=false`, both needed
for Lambda) and pushes it with a date-time tag. Re-run it after every code change.

Why an image and not a zip: `matching_python_script.py` needs scipy and scikit-learn as well
as pandas; together they exceed the 250 MB limit of a zip package with layers.

## Step 5: create the function

Lambda → **Create function** → **Container image**:

| Field | Value |
|---|---|
| Function name | `lambda-forecastpipeline` |
| Container image URI | **Browse images** → `lambda-forecastpipeline` → the tag just pushed |
| Architecture | x86_64 |
| Execution role | existing → `lps-beacon-pipeline-role` |

A function created from a zip cannot be switched to an image. If the zip version already
exists: note its settings, delete it and create it again with the same name (then redo
Steps 6-10), or create the image version under a new name and point the trigger, schedule
and API Lambda at it.

Later updates: Lambda → function → **Image** → **Deploy new image** → choose the new tag.

## Step 6: general configuration

| Setting | Value | Why |
|---|---|---|
| Memory | **3008 MB** | pandas + scipy get more CPU with more memory |
| Timeout | **5 min 0 s** | an upload run takes about 20-40 s plus up to `UPLOAD_SETTLE_SECONDS` |
| Ephemeral storage | 512 MB | matching uses `/tmp` and cleans it every run |

## Step 7: environment variables

| Key | Value |
|---|---|
| `DATA_BUCKET` | `lps-beacon-data` (the name, never the ARN) |
| `BUCKET_REGION` | `ap-southeast-1` |
| `ALERT_TOPIC_ARN` | topic ARN from Step 1 (not set in the current deployment, so no emails) |
| `MATCHING_SCRIPT` | `matching_script.py` |
| `AUTO_RUN_ON_UPLOAD` | `true` (run match → forecast → publish after each upload) |
| `UPLOAD_SETTLE_SECONDS` | `15` (how long the folder must be quiet before the run starts) |
| `S3_SSE` | **leave empty** = the bucket's default encryption applies (works for SSE-S3 and SSE-KMS). Set `aws:kms` only if a bucket policy demands the header, `AES256` only if it demands SSE-S3 |
| `S3_KMS_KEY_ID` | only with `S3_SSE=aws:kms` and a customer-managed key |
| `WINDOW_MONTHS` | `12` |
| `GRADE_TOLERANCE` | `1` |
| `MAX_IDLE_MONTHS` | `6` |
| `SKILL_THRESHOLD` | `0.15` |
| `RENEWAL_RATE` | `0.8` |
| `RP_FULL_MONTH_MDS` | `18` |
| `QL_FULL_MONTH_MDS` | `18.5` |
| `MAX_UPLOAD_MB` | `20` |
| `ALLOW_MACRO_FILES` | `false` |
| `AS_OF_DATE` | empty (= 1st of the current month) |
| `REVIEW_ON_UPLOAD` | `true` = after an upload, pause for the user's review (conflicts, opportunity forecast, matching) before publishing. `false` = run straight through as before |
| `FORECAST_STAGES` | `O1,O2,O3,O4,O5` (SFDC stages whose opportunities get a resource forecast; Closed Won is left out because won work is already in the quote lines) |
| `SIMILARITY_THRESHOLD` | `0.6` (0-1; how alike an ABCD project must be to be offered as a similar project) |

## Step 8: concurrency and retries

1. Configuration → **Concurrency** → **Reserve concurrency** = `1`. Invocations run one at a
   time, so the files of an upload are processed in turn and two runs never write `results/`
   together. Events that arrive meanwhile wait in Lambda's queue.
2. Configuration → **Asynchronous invocation** → Retry attempts `1`, Maximum age of event `1 hour`.

## Step 9: S3 trigger

S3 → `lps-beacon-data` → **Properties** → **Event notifications** → **Create event notification**
(or edit the existing `raw-upload` one):

| Field | Value |
|---|---|
| Event name | `raw-upload` |
| Prefix | `raw/` |
| Event types | **All object create events** (`s3:ObjectCreated:*`) |
| Destination | Lambda function → `lambda-forecastpipeline` |

"All object create events" also covers multipart uploads (`CompleteMultipartUpload`), which
browser upload libraries use for larger files; "Put" alone silently misses those.
Never add a trigger on `clean/`, `curated/`, `results/` or `quarantine/`: the function writes
there and would start itself in a loop.

## Step 10: monthly schedule

EventBridge → **Scheduler** → **Create schedule**: name `lps-beacon-monthly-forecast`, Recurring,
cron `0 9 1 * ? *`, time zone Asia/Singapore, flexible window off, target Lambda
`lambda-forecastpipeline`, payload `{"mode": "dashboard_data"}`. This only rebuilds
`results/capacity/inputs.json` and the Dashboard insights.

**Never schedule `{"mode": "full"}`.** It publishes without the review, overwrites
`results/latest.json` and resets the capacity plan's joiners to 0. There is no quarterly schedule.

## Step 11: self-check

Lambda → **Test** → event `{"mode": "selfcheck"}`. Every check should show `"ok": true`:

| Check | If it fails |
|---|---|
| `python` | the image is missing a package: rebuild with `build.ps1` |
| `matching` | `matching_script.py` / `matching_python_script.py` missing from the image |
| `storage` | the inline policy (Step 2) lacks a prefix, or KMS permissions are missing |
| `encryption` | `S3_SSE` conflicts with the bucket default; the note says whether KMS rights are needed |
| `trigger` | no `raw/` notification, or it is "Put" only: fix Step 9 |
| `alerts` | `ALERT_TOPIC_ARN` empty (`null` = not an error, just no emails) |

## Step 12: API Lambda routes for the upload page

In API Gateway `9dpaon3lz7`, add these routes with the existing JWT authorizer, integrated
with `lps-beacon-apilambda`:

**Upload (built):** `POST /upload-url` generates keys as
`raw/<user id>/<yyyy-mm-dd>/<batchId>/<file name>` with one `batchId` per upload, and returns
the `batchId` and the date to the page.

**`GET /pipeline/uploads/{date}/{batchId}`** - the upload's progress (built; the sketch below shows the idea):

```python
key = f"results/uploads/{user_id}/{date}/{batch_id}/status.json"   # only the caller's own uploads
try:
    body = s3.get_object(Bucket="lps-beacon-data", Key=key)["Body"].read()
    return {"statusCode": 200, "body": body.decode()}
except s3.exceptions.NoSuchKey:
    return {"statusCode": 200, "body": json.dumps({"run": {"state": "waiting_for_files"}})}
```

(`NoSuchKey` needs `s3:ListBucket` on `results/*` for the API role; without it S3 answers 403.)

**`POST /pipeline/run`** - **not built.** A "Run forecast" button was planned; the API Lambda's
`POST /runs/runForecast` answers 501. If it is built, remember that `full` mode skips the review. The browser must
not wait for the run (API Gateway stops after 30 s), so invoke asynchronously:

```python
boto3.client("lambda").invoke(
    FunctionName="lambda-forecastpipeline", InvocationType="Event",
    Payload=json.dumps({"mode": "full", "requestedBy": email}).encode())
return {"statusCode": 202, "body": json.dumps({"status": "started"})}
```

Then poll `results/latest.json` (via a GET route) until `runId` changes.

**`GET /pipeline/results/{runId}/{part}/{table}`** - **not built.** The chat tools, `/analysis` and
`/dashboard` read `results/` inside the API Lambda instead. The idea was to serve `summary/` to hr and finance,
`detail/` to unrestricted roles only, `finance/` to the finance group only.

The API Lambda's role needs `s3:GetObject` on `arn:aws:s3:::lps-beacon-data/results/*`,
`lambda:InvokeFunction` on the pipeline function, and `kms:Decrypt` if the bucket uses KMS.

### Review routes (built in the API Lambda)

The API Lambda already has these; add them in API Gateway with the JWT authorizer:

* `GET /pipeline/uploads/{date}/{batchId}` - the upload's status file
* `GET /pipeline/uploads/{date}/{batchId}/review/{step}` - what the review page shows for a step
* `POST /pipeline/uploads/{date}/{batchId}/review/{step}` - the user's decisions; the API Lambda invokes this
  function asynchronously with `{"mode": "review", ...}`
* `POST /pipeline/reviews` - review the data already uploaded, without new files (`{"mode": "review_start", ...}`)

API Lambda: environment variable `PIPELINE_FUNCTION` = this function's name, and `lambda:InvokeFunction` on it.

## Step 13: test end to end

1. Upload the resource plan, quote line and Position Name Mapping through the app
   (one upload). In S3, watch `results/uploads/<you>/<date>/<batchId>/status.json`
   go from `waiting_for_files` to `published`.
2. CloudWatch → `/aws/lambda/lambda-forecastpipeline`: one `cleaned` line per file,
   `run_started` with `"trigger": "upload"`, `stage_done` per stage, `run_finished`.
3. Open `results/latest.json` → `results/<runId>/manifest.json` (warnings, data gaps) and
   `summary/kpis.json`. With the sample files and `asOf` 2026-09-01, `matching_python_script.py`
   gives **70 matched, 1180 unmatched resources, 18 unmatched projects**.
4. Console tests, **on a test bucket only** (on `lps-beacon-data` they publish without the review
   and reset the joiners): `{"mode": "full", "asOf": "2026-09-01"}`, then
   `{"mode": "full", "stages": ["forecast", "publish"]}` (keeps 2026-09-01).

## Step 14: alarms (recommended)

CloudWatch → Alarms: Lambda `lambda-forecastpipeline` **Errors** Sum ≥ 1 over 5 minutes, and
**Duration** ≥ 240000 ms, both notifying `lps-beacon-pipeline-alerts` (needs the Step 1 topic). Upload-triggered runs
that fail do not count as Lambda errors (so S3 does not retry and re-clean every file); they
send the FAILED email (when Step 1 is set up) and set the status file to `failed` instead.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Upload status stays `waiting_for_files` | A file of the folder never produced an event: trigger missing or "Put" only (Step 9), or `_batch.json` expects more files than were sent. |
| `waiting_for_inputs` | No resource plan or quote line has ever been cleaned; upload both. |
| `not_run` | Every file of the upload was rejected; `files[].reason` in the status file says why. |
| Two runs for one upload | The files of one upload went to different folders, or arrived more than `UPLOAD_SETTLE_SECONDS` apart: raise it, or send `_batch.json`. |
| `asOf ... differs from the saved matching run` | Partial run with a new date: include `"match"` in stages. |
| `stages [...] skip a step` | Choose consecutive stages (e.g. forecast + publish, not match + publish). |
| `no Position Name Mapping has been uploaded yet` | The matching needs the mapping workbook once; upload it. |
| `AccessDenied` on PutObject / KMS errors | Step 2 policy prefix missing, or SSE-KMS bucket without the KMS statement; run the self-check. |
| `No module named ...` | The function runs an old image or a zip; deploy the image from `build.ps1`. |
| `Task timed out after 300 seconds` | Raise memory first, then the timeout. |
| April shows "no data" | The resource-plan export has no `Apr` column. Supply for April is left empty (not zero) and out of averages; fix the export query to include April. |

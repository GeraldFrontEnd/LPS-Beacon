"""Run the pipeline on your laptop, with a local folder standing in for S3.

    python run_local.py --data-dir .\\localdata --as-of 2026-09-01 ^
        "Project Resource Plan.csv" "Quoteline.csv" "Position Name Mapping.xlsx"

Behaves like the deployed Lambda: the files are "uploaded" into one batch folder
<data-dir>/raw/local/<today>/<batch>/, and each file gets its own FILE-mode invocation,
like one S3 event per upload. The last one starts match -> forecast -> publish on its own.

    --no-auto              only clean the files (like AUTO_RUN_ON_UPLOAD=false)
    --stages forecast,publish   no upload; an on-demand run of those stages
No AWS account is used.
"""
import argparse
import datetime as dt
import json
import os
import shutil
import sys
import uuid
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="*", help="files to upload (one batch)")
    parser.add_argument("--data-dir", default="localdata")
    parser.add_argument("--as-of", default="")
    parser.add_argument("--script", default="matching_script.py")
    parser.add_argument("--stages", default="", help="on-demand run of these stages instead of an upload")
    parser.add_argument("--no-auto", action="store_true", help="clean only; do not run the forecast")
    args = parser.parse_args()

    os.environ["LOCAL_DATA_DIR"] = str(Path(args.data_dir).resolve())
    os.environ["MATCHING_SCRIPT"] = str(Path(args.script).resolve())
    os.environ.setdefault("UPLOAD_SETTLE_SECONDS", "0")   # files are copied before the first event
    import lambda_function  # imported after the settings above

    batch = f"local/{dt.date.today().isoformat()}/{uuid.uuid4().hex[:8]}"
    keys = []
    for file in args.files:
        key = f"raw/{batch}/{Path(file).name}"
        target = Path(args.data_dir) / key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
        keys.append(key)

    for key in keys:                                  # one invocation per file, like S3 events
        event = {"mode": "file", "key": key, "autoRun": not args.no_auto}
        if args.as_of:
            event["asOf"] = args.as_of
        print(json.dumps(lambda_function.lambda_handler(event), indent=1, default=str))
    if keys:
        status = Path(args.data_dir) / "results" / "uploads" / batch / "status.json"
        print(f"\nUpload status file: {status}")

    if args.stages:
        event = {"mode": "full", "stages": args.stages.split(","), "requestedBy": "local"}
        if args.as_of:
            event["asOf"] = args.as_of
        print(json.dumps(lambda_function.lambda_handler(event), indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

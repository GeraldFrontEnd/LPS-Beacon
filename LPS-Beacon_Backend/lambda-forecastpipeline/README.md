# lambda-forecastpipeline

One Lambda that runs the LPS-Beacon data pipeline. It now runs end to end **when an
end-user uploads files**, as well as on demand ("Run forecast") and on a schedule:

```
upload (S3 event per file)   validate -> clean, and after the LAST file of the upload:
                             match -> forecast -> publish   (one run per upload)
on demand / schedule         match -> forecast -> publish   (or only the stages asked for)
```

| File | Stage | What it does |
|---|---|---|
| `lambda_function.py` | router | Picks the mode, runs stages in order, starts the run after an upload, keeps planning dates consistent |
| `pipeline/batch.py` | - | Which uploads belong together; `results/uploads/<batchId>/status.json` for the upload page |
| `pipeline/config.py` | - | Reads and checks the environment variables |
| `pipeline/s3io.py` | - | S3 read/write (or a local folder for testing); encryption follows the bucket default unless `S3_SSE` is set |
| `pipeline/fiscal.py` | - | April-March fiscal year, quarters, halves |
| `pipeline/validate.py` | 1 | Extension, real size, real content, zip-bomb and macro checks; quarantine |
| `pipeline/clean.py` | 2 | Recognises resource plan / quote line / position mapping / rates; records missing month columns |
| `pipeline/matching.py` | 3 | Runs the matching script on the original uploads; turns its errors and warnings into run messages |
| `matching_script.py` | 3 | Adapter: calls `matching_python_script.py` like its `main()` does, adds the position and availability-forecast sheets |
| `matching_python_script.py` | 3 | **Your matching logic, unchanged** |
| `pipeline/forecast.py` | 4 | Supply vs demand by role and month, renewals, project variance, fiscal roll-ups, optional P&L; months missing from a source are "no data", not zero |
| `pipeline/publish.py` | 5 | `results/` JSON (summary / detail / finance), Excel download, `results/latest.json`, SNS email |
| `pipeline/selfcheck.py` | - | `{"mode": "selfcheck"}`: packages, permissions, encryption, S3 trigger |
| `Dockerfile`, `requirements.txt`, `build.ps1` | - | Container image (scipy + scikit-learn do not fit in layers) |
| `run_local.py` | - | The whole flow on your PC, with a local folder instead of S3 |
| `tests/test_pipeline.py` | - | `python -m unittest discover -s tests -v` |
| `DEPLOY.md` | - | AWS setup, step by step |

Quick start on Windows:

```
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
python run_local.py --as-of 2026-09-01 "C:\data\rp.csv" "C:\data\ql.csv" "C:\data\Position Name Mapping.xlsx"
.\build.ps1 -Push -Account <account id>
```

`run_local.py` copies the files into one upload folder and sends one event per file, like S3;
the last one runs the forecast. It prints where the upload status file is. Then follow `DEPLOY.md`.

To change the matching logic, edit `matching_python_script.py` as before (it still runs on its
own from the command line). Keep the function names the adapter calls: `load_taxonomy`,
`read_table`, `standardise`, `line_table`, `run_match`, `assemble`, `clean_output`.

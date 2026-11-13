# CI/CD one-time setup

`.github/workflows/ci-cd.yml` runs `docs/deploy-steps.txt` automatically on every push to `main`,
deploying only the parts that changed. GitHub logs in to AWS with OIDC, so no access keys are stored.

Run this once, in the same WSL terminal you use for manual deploys (after step 0 of deploy-steps.txt).

## 1. Create the OIDC provider and deploy role

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=GeraldFrontEnd/LPS-Beacon
# GitHub may send the repo with its numeric IDs ("owner@id/repo@id"), so the role accepts both forms.
# IDs from: https://api.github.com/repos/GeraldFrontEnd/LPS-Beacon (owner.id, id)
REPO_IDS=GeraldFrontEnd@104344360/LPS-Beacon@1409645821

# Skip if it already exists (error "EntityAlreadyExists" is fine)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com

cat > /tmp/trust.json <<EOF
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": ["repo:$REPO:ref:refs/heads/main",
                                                   "repo:$REPO_IDS:ref:refs/heads/main"]
    } } }] }
EOF

cat > /tmp/perms.json <<EOF
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
  { "Effect": "Allow", "Action": ["ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload","ecr:PutImage","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"],
    "Resource": "arn:aws:ecr:ap-southeast-1:$ACCOUNT:repository/lambda-forecastpipeline" },
  { "Effect": "Allow", "Action": ["lambda:UpdateFunctionCode","lambda:GetFunction","lambda:GetFunctionConfiguration","lambda:InvokeFunction"],
    "Resource": ["arn:aws:lambda:ap-southeast-1:$ACCOUNT:function:lambda-forecastpipeline",
                 "arn:aws:lambda:ap-southeast-1:$ACCOUNT:function:lps-beacon-apilambda"] },
  { "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::lps-beacon-data/results/capacity/*" },
  { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::lps-beacon-frontend" },
  { "Effect": "Allow", "Action": ["s3:PutObject","s3:DeleteObject","s3:GetObject"], "Resource": "arn:aws:s3:::lps-beacon-frontend/*" },
  { "Effect": "Allow", "Action": ["cloudfront:CreateInvalidation","cloudfront:GetDistribution"],
    "Resource": "arn:aws:cloudfront::$ACCOUNT:distribution/E2AFF4J4V920FW" }
] }
EOF

aws iam create-role --role-name github-deploy-lps-beacon --assume-role-policy-document file:///tmp/trust.json
aws iam put-role-policy --role-name github-deploy-lps-beacon --policy-name deploy --policy-document file:///tmp/perms.json
echo "AWS_DEPLOY_ROLE_ARN = arn:aws:iam::$ACCOUNT:role/github-deploy-lps-beacon"
```

Only pushes to `main` can assume this role, and it can only touch the resources listed above.

## 2. Add GitHub repository variables

GitHub repo -> Settings -> Secrets and variables -> Actions -> **Variables** tab:

| Name | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | printed by the last command above |
| `VITE_API_URL` | same as in `LPS-Beacon-Frontend/.env.local` |
| `VITE_COGNITO_USER_POOL_ID` | same as `.env.local` |
| `VITE_COGNITO_CLIENT_ID` | same as `.env.local` |
| `VITE_USE_MOCK`, `VITE_USE_MOCK_AUTH`, `VITE_USE_SAMPLE_PLAN`, `VITE_USE_SAMPLE_REVIEW` | optional; default `false` |

These are variables, not secrets: the `VITE_*` values end up in the public JS bundle anyway.

## 3. Use it

1. Commit with a message starting `feat:` or `fix:` (see section 5), then push (or merge a PR) to `main`.
2. Actions tab -> **Deploy** starts automatically and deploys only what changed:
   pipeline -> rebuild -> API -> frontend.
3. Watch it go green, then do the visual check in step 5 of deploy-steps.txt.

Test without touching live: Actions -> Deploy -> **Run workflow** (branch `main`) with **Dry run** ticked
(the default). It logs in to AWS and builds everything but changes nothing. Untick Dry run for a full real deploy.

Still manual: new API Gateway routes (9dpaon3lz7).

## 4. Releases and versioning (automatic)

After a **successful real deploy from a push** that changed the pipeline Lambda, the API Lambda or the
frontend, the `release` job tags the commit and publishes a GitHub Release (repo home page -> **Releases**).

| Push changes | Release? |
|---|---|
| Pipeline image files: `Dockerfile`, `.dockerignore`, `requirements.txt`, `lambda_function.py`, `matching_script.py`, `matching_python_script.py`, `pipeline/**` | Yes (deploy steps 1+2) |
| API code: `lambda-api/*.py` | Yes (step 3) |
| Frontend build inputs: `src/**`, `public/**`, `index.html`, `LPSLogo.avif`, `package*.json`, `vite.config.ts`, `tsconfig*.json` | Yes (step 4) |
| Tests, READMEs, `DEPLOY.md`, `build.ps1`, `run_local.py`, `requirements-dev.txt`, `eslint.config.js`, `scripts/`, docs, `.github/`, `release-notes.json`, `tools/` | No deploy, no release (new release-note entries go out with the next release) |
| Deploy failed, or manual "Run workflow" (incl. dry run) | No |

The same list decides what deploys (`changes` job in `ci-cd.yml`). If a new file starts shipping
(e.g. the Dockerfile copies a new script), add it to the `pipeline` filter there.

Each release is titled with its version, the size of the change and the newest commit message, e.g.
`LPS-Beacon v1.5.0 (minor feature): feat: add period dropdown to Analysis page` (`major feature`,
`minor feature` or `bug fixes`). It lists which components were deployed and every commit since the previous
release, with a **Full Changelog** link to GitHub's compare page (changed files, removed lines red, added green). Minor commits that land without a release are included in the next one.

Nothing to set up: the job uses the built-in `GITHUB_TOKEN`.
To fix a release's notes afterwards: Releases -> the release -> **Edit**.

## 5. Release notes and commit messages (set the version number)

**First choice: `release-notes.json`.** The `release` job compares the file with the one at the last `v*` tag.
The biggest new entry sets the bump (`major` → `v2.0.0`, `minor` → `v1.1.0`, `fix` → `v1.0.1`), and the new
entries open the release notes (What's new, then Platform team for `"audience": "platform"`). The `changes` job runs
`python3 tools/release_notes.py check` first, so a broken file or an edited released entry stops the run before
anything deploys. Field rules are in the
[README](../README.md#release-notes-set-the-version-number).

**Fallback: commit prefixes**, used only when no entries were added since the last release.
What deploys is detected automatically from the changed files. You only choose one of **two prefixes**
at the start of the commit message (first release is always `v1.0.0`).

| Prefix | Use it when | Version |
|---|---|---|
| `fix:` | Something was broken or not working, and now it is | `v1.4.2` -> `v1.4.3` |
| `feat:` | Anything new or changed: features, pipeline, API or frontend changes | `v1.4.2` -> `v1.5.0` |

Not sure? Use `feat:` if you added or changed something, `fix:` if you repaired something.

### Examples

| Change | Commit message |
|---|---|
| Dashboard blank on an empty month | `fix: dashboard blank when month has no data` |
| Wrong total on capacity plan | `fix: headcount total double-counts joiners` |
| API returns an error | `fix: API error when agency is missing` |
| Layout broken on small screens | `fix: sidebar overlaps table on mobile` |
| New column in agencies table | `feat: add ADR column to agencies table` |
| New dropdown on Analysis page | `feat: add period dropdown to Analysis page` |
| New or changed API endpoint | `feat: add activity endpoint for bell notifications` |
| Pipeline change | `feat: add byMonth to capacity inputs` |
| New page or restyled page | `feat: add password reset page` |

### Example: how the version moves

| # | Commits in the push to `main` | Deploys | Release |
|---|---|---|---|
| 1 | `fix: analysis page totals` | frontend | **v1.0.0** (first is always 1.0.0) |
| 2 | `fix: dashboard blank on empty month` | frontend | **v1.0.1** |
| 3 | `fix: typo in setup guide` (docs only) | nothing | none |
| 4 | `feat: add ADR column` + `fix: align table headers` | frontend + API | **v1.1.0** (`feat` wins; push 3's commit is listed too) |
| 5 | `fix: wrong ADR rounding` | API | **v1.1.1** |

### Good to know

- **One bump per release**: if any commit since the last release is `feat:`, it's a `feat` release;
  otherwise it's a `fix` release.
- **Forgot the prefix?** Nothing breaks; it counts as `fix:`.
- **Squash and merge** on GitHub: the squash commit's message is the one read, so start it with `feat:` or `fix:`.
  With the normal **Merge** button, the branch's own commit messages are read.
- **Don't create `v*` tags by hand**: the next release always continues from the highest tag.

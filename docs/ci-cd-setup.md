# CI/CD one-time setup

`.github/workflows/deploy.yml` runs `docs/deploy-steps.txt` automatically on every push to `main`,
deploying only the parts that changed. GitHub logs in to AWS with OIDC, so no access keys are stored.

Run this once, in the same WSL terminal you use for manual deploys (after step 0 of deploy-steps.txt).

## 1. Create the OIDC provider and deploy role

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=GeraldFrontEnd/LPS-Beacon

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
      "token.actions.githubusercontent.com:sub": "repo:$REPO:ref:refs/heads/main"
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

## 3. Approval gate: `production` environment

Settings -> Environments -> **New environment** -> name `production` (exact spelling):
- **Required reviewers**: add Gerald and Derek (either one can approve). Tick **Prevent self-review** if
  the person who merged should not also approve the deploy.
- **Deployment branches and tags** -> Selected branches -> add `main`.

Every deploy run now pauses at the `approve` job until one of you clicks **Review deployments -> Approve and deploy**.
GitHub emails/notifies the reviewers. Unapproved runs time out after 30 days and deploy nothing.

## 4. Protect `main`: changes need a reviewed PR

1. Put the real GitHub usernames in `.github/CODEOWNERS`.
2. Settings -> Rules -> Rulesets -> **New branch ruleset**: name `main`, Enforcement **Active**,
   Target branches -> **Include default branch**, then tick:
   - Restrict deletions, Block force pushes
   - Require a pull request before merging -> Required approvals **1**, **Require review from Code Owners**,
     Dismiss stale approvals when new commits are pushed
3. Leave the bypass list empty so nobody can push straight to `main`.

A PR author cannot approve their own PR, so Gerald's PRs need Derek and Derek's PRs need Gerald.

## 5. Use it

1. Work on a branch -> open a PR to `main` -> the other person reviews and approves -> merge.
2. The Deploy workflow starts, works out what changed, then waits for approval.
3. Actions tab -> the run -> **Review deployments** -> tick `production` -> **Approve and deploy**.
4. Changed parts deploy in order: pipeline -> rebuild -> API -> frontend.

Manual full deploy: Actions -> Deploy -> **Run workflow** (branch `main`); it still waits for approval.
Still manual: new API Gateway routes (9dpaon3lz7), and the visual check in step 5 of deploy-steps.txt.

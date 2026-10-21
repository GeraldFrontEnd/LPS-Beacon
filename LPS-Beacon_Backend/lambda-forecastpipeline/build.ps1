# Builds the Lambda container image and (with -Push) pushes it to Amazon ECR.
# Run in PowerShell, in this folder, with Docker Desktop running and the AWS CLI signed in.
#   .\build.ps1                         run tests, build the image locally
#   .\build.ps1 -Push -Account 123456789012
#   .\build.ps1 -Push -Account 123456789012 -SkipTests
param(
    [switch]$Push,
    [switch]$SkipTests,
    [string]$Account = "",
    [string]$Region = "ap-southeast-1",
    [string]$Repo = "lambda-forecastpipeline",
    [string]$Tag = (Get-Date -Format "yyyyMMdd-HHmmss")
)
$ErrorActionPreference = "Stop"

foreach ($f in "lambda_function.py", "matching_script.py", "matching_python_script.py", "Dockerfile") {
    if (-not (Test-Path $f)) { throw "$f not found in this folder." }
}
if (-not $SkipTests) {
    python -m unittest discover -s tests
    if ($LASTEXITCODE -ne 0) { throw "Tests failed; nothing was built." }
}

# --provenance=false: Lambda cannot use the multi-manifest images Docker builds by default.
docker build --platform linux/amd64 --provenance=false -t "${Repo}:${Tag}" .
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
Write-Host "Built ${Repo}:${Tag}"

if ($Push) {
    if (-not $Account) { throw "Pass -Account <12-digit AWS account id> with -Push." }
    $registry = "$Account.dkr.ecr.$Region.amazonaws.com"
    aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $registry
    if ($LASTEXITCODE -ne 0) { throw "ECR login failed" }
    docker tag "${Repo}:${Tag}" "$registry/${Repo}:${Tag}"
    docker push "$registry/${Repo}:${Tag}"
    if ($LASTEXITCODE -ne 0) { throw "docker push failed" }
    Write-Host ""
    Write-Host "Pushed $registry/${Repo}:${Tag}"
    Write-Host "Lambda > lambda-forecastpipeline > Image > Deploy new image > choose this tag."
}

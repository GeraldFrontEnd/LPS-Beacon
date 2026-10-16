// scripts/deploy.mjs
// Builds the web app, uploads it to S3, then clears the CloudFront cache.
//
// The bucket and distribution are read from environment variables, or from a git-ignored
// ".env.deploy" file in the web folder (see ".env.deploy.example"), so nothing about your
// AWS account is stored in the repository.
//
//   node scripts/deploy.mjs             run for real  (this is what "npm run deploy" does)
//   node scripts/deploy.mjs --dry-run   print the commands without running them
//
// Needs the AWS CLI installed and signed in (aws configure, or aws sso login).

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

// Load .env.deploy (one KEY=VALUE per line). Variables already set in the shell win.
const envFile = resolve(root, ".env.deploy");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const bucket = process.env.FRONTEND_BUCKET;
const distribution = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const region = process.env.AWS_REGION || "ap-southeast-1";

// Check the values before they are used in a command, so a typo (or a hostile value) cannot
// change what runs.
const problems = [];
if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
  problems.push("FRONTEND_BUCKET is missing or is not a valid S3 bucket name.");
}
if (!distribution || !/^[A-Z0-9]{8,20}$/.test(distribution)) {
  problems.push("CLOUDFRONT_DISTRIBUTION_ID is missing or is not a valid distribution ID.");
}
if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
  problems.push("AWS_REGION is not a valid region name (for example ap-southeast-1).");
}
if (problems.length > 0) {
  console.error("Cannot deploy:\n  - " + problems.join("\n  - "));
  console.error('\nCopy ".env.deploy.example" to ".env.deploy" and fill it in, or set the variables in your shell.');
  process.exit(1);
}

const steps = [
  ["Build", "npm run build"],
  ["Upload to S3", `aws s3 sync dist s3://${bucket} --delete --region ${region}`],
  // The quotes stop the shell from expanding /* into a list of folders.
  ["Clear the CloudFront cache", `aws cloudfront create-invalidation --distribution-id ${distribution} --paths "/*"`],
];

for (const [label, command] of steps) {
  console.log(`\n> ${label}: ${command}`);
  if (dryRun) continue;
  const result = spawnSync(command, { cwd: root, shell: true, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n"${label}" failed. Nothing after this step was run.`);
    process.exit(result.status ?? 1);
  }
}

console.log(dryRun ? "\nDry run only. Nothing was executed." : "\nDeployed.");

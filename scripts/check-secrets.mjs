import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const MAX_BYTES = 1024 * 1024;
const IGNORED_PATH_SEGMENTS = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);
const PATTERNS = [
  ["private key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["Stripe live secret", /\bsk_live_[A-Za-z0-9]{16,}\b/],
  [
    "hard-coded credential assignment",
    /\b(?:api[-_]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\r\n]{16,}["']/i,
  ],
];

const findings = [];
for (const file of listVersionedAndUntrackedFiles()) {
  if (isIgnored(file)) {
    continue;
  }

  const path = resolve(ROOT, file);
  if (statSync(path).size > MAX_BYTES) {
    continue;
  }

  const contents = readFileSync(path, "utf8");
  if (contents.includes("\0")) {
    continue;
  }

  for (const [name, pattern] of PATTERNS) {
    const match = contents.match(pattern);
    if (match) {
      const line = contents.slice(0, match.index).split(/\r?\n/).length;
      findings.push(`${file}:${line}: possible ${name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Secret scan failed. Remove the credential, rotate it if real, and use environment configuration instead.");
  for (const finding of findings) {
    console.error(`  ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log("Secret scan passed.");
}

function listVersionedAndUntrackedFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8" },
  );

  return output.split("\0").filter(Boolean);
}

function isIgnored(file) {
  const segments = file.split("/");
  if (segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment))) {
    return true;
  }

  return file.endsWith(".lock") || file.endsWith(".map");
}

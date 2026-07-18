import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);
const IGNORED_PATH_SEGMENTS = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);
const CHECKED_ROOTS = new Set(["apps", "docs", "prisma", "scripts", ".github"]);
const CHECKED_ROOT_FILES = new Set(["package.json", "tsconfig.json"]);

const files = listVersionedAndUntrackedFiles()
  .filter(isCheckedTextFile)
  .filter((file) => existsSync(resolve(ROOT, file)));
const violations = [];

for (const file of files) {
  const contents = readFileSync(resolve(ROOT, file), "utf8");
  const lines = contents.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (/[\t ]+$/.test(lines[index])) {
      violations.push(`${file}:${index + 1}: trailing whitespace`);
    }
  }

  if (contents.length > 0 && !/\r?\n$/.test(contents)) {
    violations.push(`${file}: file must end with a newline`);
  }
}

if (violations.length > 0) {
  console.error("Formatting checks failed:");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Formatting checks passed for ${files.length} text files.`);
}

function listVersionedAndUntrackedFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8" },
  );

  return output.split("\0").filter(Boolean);
}

function isCheckedTextFile(file) {
  const segments = file.split("/");
  if (segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment))) {
    return false;
  }

  if (!CHECKED_ROOTS.has(segments[0]) && !CHECKED_ROOT_FILES.has(file)) {
    return false;
  }

  return TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")).toLowerCase());
}

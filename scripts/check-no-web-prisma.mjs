import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

const ROOT = process.cwd();
const WEB_ROOT = resolve(ROOT, "apps/web");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_SEGMENTS = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);
const NON_PRODUCTION_SEGMENTS = new Set([
  "__mocks__",
  "__tests__",
  "dev",
  "fixtures",
  "mocks",
  "stories",
  "test",
  "tests",
]);
const NON_PRODUCTION_FILE_MARKERS = [".spec.", ".stories.", ".test."];
const LOCAL_IMPORT_PATTERN = /(?:import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?|export\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?|require\s*\(|import\s*\()\s*["']([^"']+)["']/g;
const PRISMA_PACKAGE_PATTERN = /(?:from\s*["']@prisma\/client["']|require\s*\(\s*["']@prisma\/client["']\s*\)|import\s*\(\s*["']@prisma\/client["']\s*\))/;
// Temporary, exact baseline for the pre-UP-04 web data boundary. Do not add to
// this list: each entry is a known migration target and must disappear as that
// package moves operational access behind NestJS /api/v1.
const BASELINE_OFFENDING_PATHS = new Set([
  "apps/web/app/(workspace)/billing/page.tsx -> apps/web/components/workspace/billing-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/dashboard/page.tsx -> apps/web/components/workspace/dashboard-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/layout.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/my-schedule/page.tsx -> apps/web/components/workspace/my-schedule-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/patients/[id]/page.tsx -> apps/web/components/workspace/patient-detail-page.tsx -> apps/web/components/workspace/appointment-booking-modal.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/patients/page.tsx -> apps/web/components/workspace/patients-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/reservations/page.tsx -> apps/web/components/workspace/reservations-page.tsx -> apps/web/components/workspace/appointment-booking-modal.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/settings/page.tsx -> apps/web/components/workspace/settings-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/(workspace)/staff/page.tsx -> apps/web/components/workspace/staff-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/api/auth/login/route.ts -> apps/web/lib/auth.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/api/auth/me/route.ts -> apps/web/lib/auth.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/api/communications/route.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/api/customers/route.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/api/followups/[id]/route.ts -> apps/web/lib/prisma.ts",
  "apps/web/app/api/system/status/route.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/appointment-booking-modal.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/billing-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/dashboard-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/my-schedule-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/patient-detail-page.tsx -> apps/web/components/workspace/appointment-booking-modal.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/patients-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/reservations-page.tsx -> apps/web/components/workspace/appointment-booking-modal.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/settings-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/staff-page.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/workspace-root.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/components/workspace/workspace-shell.tsx -> apps/web/components/workspace/app-state.tsx -> apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/lib/auth.ts -> apps/web/lib/prisma.ts",
  "apps/web/lib/database-data.ts -> apps/web/lib/prisma.ts",
  "apps/web/lib/prisma.ts",
]);

const sourceFiles = listVersionedAndUntrackedFiles()
  .map((file) => resolve(ROOT, file))
  .filter((file) => existsSync(file))
  .filter(isProductionWebSource);
const prismaSources = new Set(
  sourceFiles.filter((file) => PRISMA_PACKAGE_PATTERN.test(readFileSync(file, "utf8"))),
);
const imports = new Map(sourceFiles.map((file) => [file, localImports(file)]));
const offenders = [];

for (const sourceFile of sourceFiles) {
  const pathToPrisma = findPathToPrisma(sourceFile, []);
  if (pathToPrisma) {
    offenders.push(pathToPrisma);
  }
}

const unexpectedOffenders = offenders.filter(
  (path) => !BASELINE_OFFENDING_PATHS.has(displayImportPath(path)),
);

if (unexpectedOffenders.length > 0) {
  console.error("Production Next.js code introduced a Prisma dependency outside the approved migration baseline.");
  console.error("Migrate operational access to NestJS /api/v1 instead of extending the temporary baseline.");
  for (const path of unexpectedOffenders) {
    console.error(`  ${path.map(displayPath).join(" -> ")}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Next.js Prisma boundary regression check passed (${offenders.length} known UP-04 migration paths remain).`,
  );
}

function findPathToPrisma(sourceFile, visited) {
  if (visited.includes(sourceFile)) {
    return null;
  }

  if (prismaSources.has(sourceFile)) {
    return [...visited, sourceFile];
  }

  for (const importedFile of imports.get(sourceFile) ?? []) {
    const found = findPathToPrisma(importedFile, [...visited, sourceFile]);
    if (found) {
      return found;
    }
  }

  return null;
}

function localImports(sourceFile) {
  const source = readFileSync(sourceFile, "utf8");
  const results = [];
  let match;

  while ((match = LOCAL_IMPORT_PATTERN.exec(source)) !== null) {
    const resolved = resolveLocalImport(sourceFile, match[1]);
    if (resolved && isProductionWebSource(resolved)) {
      results.push(resolved);
    }
  }

  return results;
}

function resolveLocalImport(sourceFile, specifier) {
  let basePath;
  if (specifier.startsWith("@/")) {
    basePath = resolve(WEB_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    basePath = resolve(dirname(sourceFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    basePath,
    ...SOURCE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(basePath, `index${extension}`)),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isProductionWebSource(file) {
  const normalized = normalize(file);
  if (!normalized.startsWith(`${WEB_ROOT}${normalize("/")}`)) {
    return false;
  }

  if (!SOURCE_EXTENSIONS.includes(extname(normalized))) {
    return false;
  }

  const relativePath = relative(WEB_ROOT, normalized);
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment) || NON_PRODUCTION_SEGMENTS.has(segment))) {
    return false;
  }

  return !NON_PRODUCTION_FILE_MARKERS.some((marker) => relativePath.includes(marker));
}

function listVersionedAndUntrackedFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8" },
  );

  return output.split("\0").filter(Boolean);
}

function displayPath(file) {
  return relative(ROOT, file).replaceAll("\\", "/");
}

function displayImportPath(path) {
  return path.map(displayPath).join(" -> ");
}

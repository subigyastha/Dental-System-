import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findWorkspaceRoot() {
  const candidates = [
    resolve(process.cwd()),
    resolve(__dirname, "..", "..", ".."),
  ];

  for (const start of candidates) {
    let current = start;
    while (true) {
      const hasPackage = existsSync(join(current, "package.json"));
      const hasPrisma = existsSync(join(current, "prisma", "schema.prisma"));
      if (hasPackage && hasPrisma) {
        return current;
      }

      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return resolve(__dirname, "..", "..", "..");
}

/** Repository root (`Workflow System/`) whether the process starts from root or `apps/api`. */
export const monorepoRoot = findWorkspaceRoot();

export function loadMonorepoEnv() {
  const envPath = join(monorepoRoot, ".env");
  const envLocalPath = join(monorepoRoot, ".env.local");

  if (existsSync(envPath)) {
    config({ path: envPath });
  }
  if (existsSync(envLocalPath)) {
    config({ path: envLocalPath, override: true });
  }

  normalizeDatabaseUrl();
}

function normalizeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }

  const isSupabaseDirect =
    databaseUrl.includes("supabase.co:5432") && !databaseUrl.includes("sslmode=");

  if (isSupabaseDirect) {
    process.env.DATABASE_URL = `${databaseUrl}${
      databaseUrl.includes("?") ? "&" : "?"
    }sslmode=require`;
  }
}

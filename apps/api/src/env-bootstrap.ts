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
  const isProductionRuntime =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RENDER) ||
    Boolean(process.env.VERCEL);

  if (existsSync(envPath) && !isProductionRuntime) {
    config({ path: envPath });
  }
  if (existsSync(envLocalPath) && !isProductionRuntime) {
    config({ path: envLocalPath, override: true });
  }

  normalizeDatabaseUrl();
}

export function normalizeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }

  try {
    const url = new URL(databaseUrl);
    const isSupabase =
      url.hostname.endsWith(".supabase.co") ||
      url.hostname.endsWith(".supabase.com");

    // Supabase requires TLS for both direct connections (5432) and poolers
    // (6543). `.env.local` intentionally overrides `.env`, so normalize either.
    if (isSupabase && !url.searchParams.has("sslmode")) {
      url.searchParams.set("sslmode", "require");
    }

    const isSupabasePooler = url.hostname.includes(".pooler.supabase.com");
    const configuredConnectionLimit = process.env.PRISMA_CONNECTION_LIMIT?.trim();
    const connectionLimit = configuredConnectionLimit
      ? Number(configuredConnectionLimit)
      : 5;
    if (
      configuredConnectionLimit &&
      (!Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 20)
    ) {
      throw new Error(
        `Invalid PRISMA_CONNECTION_LIMIT "${process.env.PRISMA_CONNECTION_LIMIT}". Expected an integer from 1 to 20.`,
      );
    }
    let requestedPoolMode = "transaction";
    if (isSupabasePooler) {
      requestedPoolMode = (process.env.SUPABASE_POOL_MODE ?? "transaction")
        .trim()
        .toLowerCase();
      if (!["transaction", "session"].includes(requestedPoolMode)) {
        throw new Error(
          `Invalid SUPABASE_POOL_MODE "${process.env.SUPABASE_POOL_MODE}". Expected "transaction" or "session".`,
        );
      }
    }

    // Port 5432 is frequently unavailable on IPv4/firewall-constrained clinic
    // networks. Keep a supplied Transaction Mode URL on 6543 by default and
    // configure Prisma for PgBouncer semantics below. Deployments with a
    // reliably reachable Session Mode pool may explicitly opt into `session`.
    if (
      isSupabasePooler &&
      url.port === "6543" &&
      requestedPoolMode === "session"
    ) {
      url.port = "5432";
      url.searchParams.delete("pgbouncer");
    }

    // Supabase's transaction pooler reuses server connections. Tell Prisma to
    // avoid named prepared statements there, otherwise the pooler can return
    // Postgres error 42P05 (for example, `prepared statement "s0" already
    // exists`) when a connection is handed to another Prisma request.
    if (isSupabasePooler && url.port === "6543") {
      if (!url.searchParams.has("pgbouncer")) {
        url.searchParams.set("pgbouncer", "true");
      }
      if (!url.searchParams.has("connection_limit")) {
        // Nest is a long-running process, not one serverless invocation per
        // request. A single connection serialized independent page reads and
        // turned the database RTT into a multi-second queue. Keep the pool
        // deliberately small, but allow route read models to run concurrently.
        url.searchParams.set("connection_limit", String(connectionLimit));
      }
    } else if (isSupabasePooler && !url.searchParams.has("connection_limit")) {
      // Keep a small, bounded client pool for a single long-lived Nest
      // process. Supavisor owns the server-side pool.
      url.searchParams.set("connection_limit", String(connectionLimit));
    }

    process.env.DATABASE_URL = url.toString();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Invalid SUPABASE_POOL_MODE") ||
        error.message.startsWith("Invalid PRISMA_CONNECTION_LIMIT"))
    ) {
      throw error;
    }
    // Prisma will report the malformed datasource with its own actionable error.
  }
}

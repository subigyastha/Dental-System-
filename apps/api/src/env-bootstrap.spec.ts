import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { normalizeDatabaseUrl } from "./env-bootstrap";

describe("normalizeDatabaseUrl", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPoolMode = process.env.SUPABASE_POOL_MODE;
  const originalConnectionLimit = process.env.PRISMA_CONNECTION_LIMIT;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalPoolMode === undefined) {
      delete process.env.SUPABASE_POOL_MODE;
    } else {
      process.env.SUPABASE_POOL_MODE = originalPoolMode;
    }

    if (originalConnectionLimit === undefined) {
      delete process.env.PRISMA_CONNECTION_LIMIT;
    } else {
      process.env.PRISMA_CONNECTION_LIMIT = originalConnectionLimit;
    }
  });

  it("keeps the transaction pooler by default and applies Prisma pooler settings", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.example:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    delete process.env.SUPABASE_POOL_MODE;
    delete process.env.PRISMA_CONNECTION_LIMIT;

    normalizeDatabaseUrl();

    const normalized = new URL(process.env.DATABASE_URL!);
    assert.equal(normalized.port, "6543");
    assert.equal(normalized.searchParams.get("sslmode"), "require");
    assert.equal(normalized.searchParams.get("pgbouncer"), "true");
    assert.equal(normalized.searchParams.get("connection_limit"), "5");
  });

  it("accepts a bounded per-process Prisma connection limit", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.example:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    process.env.PRISMA_CONNECTION_LIMIT = "3";

    normalizeDatabaseUrl();

    assert.equal(
      new URL(process.env.DATABASE_URL!).searchParams.get("connection_limit"),
      "3",
    );
  });

  it("rejects an unsafe Prisma connection limit", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.example:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    process.env.PRISMA_CONNECTION_LIMIT = "100";

    assert.throws(
      () => normalizeDatabaseUrl(),
      /Invalid PRISMA_CONNECTION_LIMIT "100"/,
    );
  });

  it("normalizes an explicit session mode and switches the pooler to 5432", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.example:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
    process.env.SUPABASE_POOL_MODE = " Session ";

    normalizeDatabaseUrl();

    const normalized = new URL(process.env.DATABASE_URL!);
    assert.equal(normalized.port, "5432");
    assert.equal(normalized.searchParams.has("pgbouncer"), false);
    assert.equal(normalized.searchParams.get("connection_limit"), "5");
  });

  it("fails fast instead of silently changing ports for an invalid mode", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.example:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    process.env.SUPABASE_POOL_MODE = "transactoin";

    assert.throws(
      () => normalizeDatabaseUrl(),
      /Invalid SUPABASE_POOL_MODE "transactoin"/,
    );
  });

  it("ignores a stale Supabase pool mode for a non-Supabase database", () => {
    const localUrl =
      "postgresql://postgres:secret@localhost:5432/workflow_system?schema=public";
    process.env.DATABASE_URL = localUrl;
    process.env.SUPABASE_POOL_MODE = "stale-provider-setting";

    normalizeDatabaseUrl();

    assert.equal(process.env.DATABASE_URL, localUrl);
  });
});

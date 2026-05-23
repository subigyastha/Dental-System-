import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

const CONNECT_RETRIES = Number(process.env.DATABASE_CONNECT_RETRIES ?? 5);
const CONNECT_RETRY_MS = Number(process.env.DATABASE_CONNECT_RETRY_MS ?? 2500);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUnreachableError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientInitializationError &&
    (err.errorCode === "P1001" || err.message.includes("Can't reach database server"))
  );
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
      try {
        await this.$connect();
        return;
      } catch (err) {
        lastErr = err;
        const retryable = isUnreachableError(err);
        if (!retryable || attempt === CONNECT_RETRIES) {
          break;
        }
        console.warn(
          `[Prisma] Database unreachable (attempt ${attempt}/${CONNECT_RETRIES}), retrying in ${CONNECT_RETRY_MS}ms…`,
        );
        await sleep(CONNECT_RETRY_MS);
      }
    }

    console.error(`
[Prisma] Cannot connect to the database (P1001 / unreachable).

Checklist:
  • Supabase: open the project dashboard and resume the project if it is paused.
  • Connection string: append sslmode=require for direct Postgres, e.g. …?schema=public&sslmode=require
  • Firewalls often block port 5432; use Supabase "Transaction pooler" (port 6543) as DATABASE_URL for the app.
  • Confirm DATABASE_URL in the repo root .env matches the string from Supabase (Settings → Database).

Override retries: DATABASE_CONNECT_RETRIES / DATABASE_CONNECT_RETRY_MS
`);
    throw lastErr;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

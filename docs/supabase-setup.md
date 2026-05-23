# Supabase Setup

## Current State

The project is configured for Supabase Postgres through Prisma.

Local-only secret files:

- `.env.local` is used by Next.js.
- `.env` is used by Prisma CLI.
- Both are ignored by git.

Required variable:

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
```

## Commands

Validate schema:

```bash
npx prisma validate
```

Migration status:

```bash
npm run db:migrate:status
```

Create a local development migration:

```bash
npm run db:migrate:dev -- --name <change_name>
```

Deploy committed migrations:

```bash
npm run db:migrate:deploy
```

Legacy emergency-only schema sync:

```bash
npm run db:push
```

Seed operational data:

```bash
npm run db:seed
```

Generate Prisma Client:

```bash
npx prisma generate
```

## Product Persistence

The dashboard now reads operational records from the database on page load.

Implemented write-through actions:

- Create appointment
- Move appointment workflow state
- Log communication
- Close follow-up task

The client updates optimistically for speed and writes through to API routes backed by Prisma.

## Migration Notes

- Prefer Prisma migrations for every schema change; treat `db push` as a temporary repair tool, not the normal workflow.
- If the running app uses a Supabase pooler URL, keep `DATABASE_URL` for the app and use a direct Postgres connection for migration commands.
- For an existing database that started life on `db push`, create a baseline migration from the current live schema, mark it applied, and only then add forward migrations.
- After schema deploys, run:

```bash
npx prisma generate
npm run db:seed
```

## Next Hardening Step

After migrations are in place, add Supabase Row Level Security policies and move auth/session logic behind organization-aware permission boundaries.

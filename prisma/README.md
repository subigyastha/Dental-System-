## Prisma Workflow

This repository uses one shared Prisma schema for the monolith:

- `apps/web` reads and writes through Prisma-backed routes and Nest APIs
- `apps/api` uses the same generated client
- `prisma/schema.prisma` is the only schema source of truth

### Standard change flow

1. Update `prisma/schema.prisma`
2. Create a migration:

```bash
npm run db:migrate:dev -- --name <change_name>
```

3. Commit:
   - `prisma/schema.prisma`
   - `prisma/migrations/<timestamp>_<change_name>/migration.sql`
4. Deploy schema changes:

```bash
npm run db:migrate:deploy
```

5. Regenerate client and reseed when needed:

```bash
npx prisma generate
npm run db:seed
```

### Existing database note

This project originally used `prisma db push`, so a baseline migration must be created from the live database before future migrations become the normal path.

### Local/test migration rehearsal

Before a migration is promoted, rehearse the checked-in migration history against a disposable local database:

```powershell
npm run db:migrate:rehearse
```

The rehearsal runs `prisma migrate status`, `prisma migrate deploy`, and a final status check. It never calls `prisma db push` and refuses `APP_ENV` values for staging/production plus database URLs that are neither loopback-local nor an explicitly named test database in `APP_ENV=test`.

It emits `MIGRATION_REHEARSAL` key/value lines and one compact JSON report line so CI or a release record can retain the result without recording credentials. An optional anonymous health smoke check can run after an API is available:

```powershell
npm run db:migrate:rehearse -- -SmokeApiBaseUrl http://localhost:4000
```

If it fails, do not use `db push`, `migrate reset`, or a destructive rollback on shared data. Follow the forward-repair checklist in [`docs/15-environment-and-local-development-guide.md`](../docs/15-environment-and-local-development-guide.md).

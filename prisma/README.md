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

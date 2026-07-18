import assert from "node:assert/strict";
import test from "node:test";

/**
 * This test intentionally accepts only TEST_DATABASE_URL. It never falls back
 * to DATABASE_URL or an .env file, preventing accidental use of a developer
 * or deployed database. CI supplies its disposable PostgreSQL service.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skipReason = validateTestDatabase(testDatabaseUrl);

test(
  "Phase 1 HTTP containment denies anonymous and cross-tenant requests",
  { skip: skipReason ?? false },
  async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DIRECT_URL = testDatabaseUrl;
    process.env.AUTH_SECRET = "phase-one-http-test-secret";

    const [{ NestFactory }, { ValidationPipe }, { AppModule }, { PrismaService }, { AuthService }] =
      await Promise.all([
        import("@nestjs/core"),
        import("@nestjs/common"),
        import("../app.module.js"),
        import("../modules/prisma/prisma.service.js"),
        import("../modules/auth/auth.service.js"),
      ]);
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, "127.0.0.1");

    const prisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    const prefix = `p1-http-${Date.now()}`;
    const [organizationA, organizationB] = [`${prefix}-a`, `${prefix}-b`];
    const [userA, clientB, providerB, appointmentB, followupB] = ["user", "client", "provider", "appointment", "followup"].map((part) => `${prefix}-${part}`);

    try {
      await prisma.organization.createMany({ data: [{ id: organizationA, name: "Clinic A" }, { id: organizationB, name: "Clinic B" }] });
      await prisma.user.create({ data: { id: userA, organizationId: organizationA, name: "Clinic A Owner", email: `${prefix}@example.test`, role: "Owner", passwordHash: auth.hashPassword("test-password") } });
      await prisma.customer.create({ data: { id: clientB, organizationId: organizationB, fullName: "Clinic B Client", phone: `${prefix}-phone` } });
      await prisma.provider.create({ data: { id: providerB, organizationId: organizationB, displayName: "Clinic B Provider", roleLabel: "Dentist" } });
      const startsAt = new Date("2030-01-01T03:00:00.000Z");
      await prisma.appointment.create({ data: { id: appointmentB, organizationId: organizationB, customerId: clientB, providerId: providerB, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), durationMinutes: 30 } });
      await prisma.followUpTask.create({ data: { id: followupB, organizationId: organizationB, customerId: clientB, appointmentId: appointmentB, ownerId: providerB, type: "Reminder", priority: "Normal", dueAt: startsAt, summary: "Boundary test", nextAction: "No action" } });

      const login = await auth.login({ email: `${prefix}@example.test`, password: "test-password" });
      const headers = { authorization: `Bearer ${login.token}`, "content-type": "application/json" };
      const baseUrl = await app.getUrl();
      const call = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

      for (const [path, init] of [
        ["/api/operational-data", undefined], ["/api/system/status", undefined],
        [`/api/organizations/${organizationB}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Denied" }) }],
        ["/api/communications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appointmentId: appointmentB, customerId: clientB, channel: "SMS", direction: "Outbound", summary: "Denied" }) }],
        [`/api/followups/${followupB}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
      ] as const) {
        assert.equal((await call(path, init)).status, 401, `anonymous ${path} must be denied`);
      }

      assert.equal((await call(`/api/organizations/${organizationB}`, { method: "PATCH", headers, body: JSON.stringify({ name: "Denied" }) })).status, 404);
      assert.equal((await call("/api/communications", { method: "POST", headers, body: JSON.stringify({ appointmentId: appointmentB, customerId: clientB, channel: "SMS", direction: "Outbound", summary: "Denied" }) })).status, 404);
      assert.equal((await call(`/api/followups/${followupB}`, { method: "PATCH", headers, body: "{}" })).status, 404);

      const operational = await call("/api/operational-data", { headers });
      assert.equal(operational.status, 200);
      assert.equal((await operational.json() as { organization: { id: string } }).organization.id, organizationA);
      const system = await call("/api/system/status", { headers });
      assert.equal(system.status, 200);
      assert.equal((await system.json() as { organizationCount: number }).organizationCount, 1);
      assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: organizationB } })).name, "Clinic B");
      assert.equal((await prisma.followUpTask.findUniqueOrThrow({ where: { id: followupB } })).status, "Open");
      assert.equal(await prisma.communicationLog.count({ where: { appointmentId: appointmentB } }), 0);
    } finally {
      await prisma.organization.deleteMany({ where: { id: { in: [organizationA, organizationB] } } });
      await app.close();
    }
  },
);

function validateTestDatabase(value: string | undefined): string | undefined {
  if (!value) {
    return process.env.CI ? "TEST_DATABASE_URL is required in CI" : "Skipped: set TEST_DATABASE_URL to a disposable PostgreSQL test database";
  }
  try {
    const databaseName = new URL(value).pathname.replace(/^\//, "");
    return /(^|[_-])(test|testing|sandbox|ci)([_-]|$)/i.test(databaseName)
      ? undefined
      : "TEST_DATABASE_URL must name a disposable test, testing, sandbox, or CI database";
  } catch {
    return "TEST_DATABASE_URL must be a PostgreSQL URL";
  }
}

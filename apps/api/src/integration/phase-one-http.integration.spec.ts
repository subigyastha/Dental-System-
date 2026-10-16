import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

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

    // Nest 12 is ESM. Keep framework imports static so the CommonJS tsx test
    // runner does not create a second HttpException class identity.
    const [{ AppModule }, { PrismaService }, { AuthService }] = await Promise.all([
      import("../app.module.js"),
      import("../modules/prisma/prisma.service.js"),
      import("../modules/auth/auth.service.js"),
    ]);
    const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
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
      const testPassword = "test-password-passphrase";
      await prisma.user.create({ data: { id: userA, organizationId: organizationA, name: "Clinic A Owner", email: `${prefix}@example.test`, role: "Owner", passwordHash: await auth.hashPassword(testPassword) } });
      await prisma.customer.create({ data: { id: clientB, organizationId: organizationB, fullName: "Clinic B Client", phone: `${prefix}-phone` } });
      await prisma.provider.create({ data: { id: providerB, organizationId: organizationB, displayName: "Clinic B Provider", roleLabel: "Dentist" } });
      const startsAt = new Date("2030-01-01T03:00:00.000Z");
      await prisma.appointment.create({ data: { id: appointmentB, organizationId: organizationB, customerId: clientB, providerId: providerB, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), durationMinutes: 30 } });
      await prisma.followUpTask.create({ data: { id: followupB, organizationId: organizationB, customerId: clientB, appointmentId: appointmentB, ownerId: providerB, type: "Reminder", priority: "Normal", dueAt: startsAt, summary: "Boundary test", nextAction: "No action" } });

      const login = await auth.login({ email: `${prefix}@example.test`, password: testPassword });
      const headers = { authorization: `Bearer ${login.token}`, "content-type": "application/json" };
      const baseUrl = await app.getUrl();
      const call = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);
      type WorkQueue = { items: Array<{ id: string; nextAction: string; lastResponse: { note: string | null } | null }> };
      type WorkDetail = { task: { status: string; updatedAtIso: string }; history: Array<{ note: string | null; actor: string }> };
      const readQueue = async (path: string) => await (await call(path, { headers })).json() as WorkQueue;
      const readDetail = async (taskId: string) => await (await call(`/api/followups/${taskId}`, { headers })).json() as WorkDetail;

      for (const [path, init] of [
        ["/api/operational-data", undefined], ["/api/system/status", undefined],
        [`/api/organizations/${organizationB}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Denied" }) }],
        ["/api/communications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appointmentId: appointmentB, customerId: clientB, channel: "SMS", direction: "Outbound", summary: "Denied" }) }],
        [`/api/followups/${followupB}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }],
        ["/api/followups", undefined], [`/api/followups/${followupB}`, undefined],
        [`/api/followups/${followupB}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
      ] as const) {
        const response = await call(path, init);
        const responseBody = await response.text();
        assert.equal(response.status, 401, `anonymous ${path} must be denied: ${responseBody}`);
      }

      assert.equal((await call(`/api/organizations/${organizationB}`, { method: "PATCH", headers, body: JSON.stringify({ name: "Denied" }) })).status, 404);
      assert.equal((await call("/api/communications", { method: "POST", headers, body: JSON.stringify({ appointmentId: appointmentB, customerId: clientB, channel: "SMS", direction: "Outbound", summary: "Denied" }) })).status, 404);
      assert.equal((await call(`/api/followups/${followupB}`, { method: "PATCH", headers, body: "{}" })).status, 404);
      assert.equal((await call(`/api/followups/${followupB}`, { headers })).status, 404);
      assert.equal((await call(`/api/followups/${followupB}/responses`, { method: "POST", headers, body: JSON.stringify({ response: "reached", requestId: "cross-tenant", expectedUpdatedAtIso: startsAt.toISOString() }) })).status, 404);
      assert.deepEqual((await readQueue("/api/followups?view=upcoming")).items, []);

      // Exercise the complete workflow against real transactions, JSON audit
      // queries, DTO validation, and HTTP authorization, using only this fixture.
      const [clientA, providerA, appointmentA] = ["own-client", "own-provider", "own-visit"].map(part => `${prefix}-${part}`);
      await prisma.customer.create({ data: { id: clientA, organizationId: organizationA, fullName: "Follow-up test client", phone: `${prefix}-own-phone` } });
      await prisma.provider.create({ data: { id: providerA, organizationId: organizationA, displayName: "Follow-up test provider", roleLabel: "Dentist" } });
      await prisma.appointment.create({ data: { id: appointmentA, organizationId: organizationA, customerId: clientA, providerId: providerA, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), durationMinutes: 30, status: "CheckedIn", customProcedureName: "Test procedure" } });
      const completes = await Promise.all([1, 2].map(() => call(`/api/appointments/${appointmentA}/complete`, { method: "POST", headers, body: "{}" })));
      assert.deepEqual(completes.map(row => row.status), [201, 201]);
      const visitTasks = await prisma.followUpTask.findMany({ where: { organizationId: organizationA, appointmentId: appointmentA } });
      assert.equal(visitTasks.length, 0, "concurrent completion creates no automatic follow-up or recall");
      const contactAction = (clientId: string, body: unknown) => call(`/api/followups/clients/${clientId}/actions`, { method: "POST", headers, body: JSON.stringify(body) });
      const clientsUrl = `/api/followups/clients?customerId=${clientA}`;
      const getClients = async () => (await (await call(clientsUrl, { headers })).json()) as { items: Array<{ customerId: string; canManage: boolean; lastAttemptAtIso: string | null; lastReachedAtIso: string | null; nextContactAtIso: string | null }>; history: unknown[] };
      assert.equal((await getClients()).items[0].lastAttemptAtIso, null);
      assert.equal((await call("/api/followups/clients")).status, 401);
      assert.equal((await contactAction(clientB, { action: "log", result: "reached", requestId: "foreign-contact" })).status, 404);
      const attemptTime = new Date(Date.now() - 10 * 60_000).toISOString();
      const unscheduled = { action: "log", result: "no_answer", appointmentId: appointmentA, requestId: "unscheduled-attempt", channel: "call", occurredAtIso: attemptTime };
      assert.equal((await contactAction(clientA, unscheduled)).status, 201);
      assert.equal((await contactAction(clientA, unscheduled)).status, 201);
      assert.equal((await contactAction(clientA, { ...unscheduled, result: "reached" })).status, 409);
      let clientState = await getClients();
      assert.ok(clientState.items[0].lastAttemptAtIso); assert.equal(clientState.items[0].lastReachedAtIso, null);
      assert.equal(clientState.items[0].lastAttemptAtIso, attemptTime, "recency uses actual contact time");
      const attemptRecord = await prisma.communicationLog.findFirstOrThrow({ where: { organizationId: organizationA, customerId: clientA, purpose: "follow_up" } });
      assert.equal(attemptRecord.channel, "call"); assert.equal(attemptRecord.source, "manual"); assert.equal(attemptRecord.recordedByUserId, userA);
      assert.equal(attemptRecord.followUpTaskId, null); assert.equal(attemptRecord.responseText, null);
      assert.ok(attemptRecord.recordedAt > attemptRecord.occurredAt);
      assert.equal(await prisma.communicationLog.count({ where: { organizationId: organizationA, customerId: clientA, purpose: "follow_up" } }), 1, "retries create one contact record");
      assert.equal((await contactAction(clientA, { ...unscheduled, channel: "sms" })).status, 409);
      assert.equal((await contactAction(clientA, { ...unscheduled, requestId: "invalid-response", responseText: "Client says better" })).status, 400);
      assert.equal((await contactAction(clientA, { ...unscheduled, requestId: "invalid-channel", channel: "unsupported" })).status, 400);
      assert.equal((await contactAction(clientA, { ...unscheduled, requestId: "spoof-source", source: "integration" })).status, 201);
      assert.equal((await prisma.communicationLog.findFirstOrThrow({ where: { organizationId: organizationA, requestId: "spoof-source" } })).source, "manual", "source is server-owned; unknown request fields are stripped");
      const replyTime = new Date(Date.now() - 5 * 60_000).toISOString();
      const feedback = { action: "log", result: "reached", requestId: "client-feedback", appointmentId: appointmentA,
        channel: "whatsapp", direction: "inbound", responseText: " Feeling better ", occurredAtIso: replyTime };
      assert.equal((await contactAction(clientA, feedback)).status, 201);
      assert.equal((await contactAction(clientA, feedback)).status, 201);
      const feedbackRecord = await prisma.communicationLog.findFirstOrThrow({ where: { organizationId: organizationA, requestId: "client-feedback" } });
      assert.equal(feedbackRecord.responseText, "Feeling better"); assert.equal(feedbackRecord.channel, "whatsapp"); assert.equal(feedbackRecord.direction, "inbound");
      clientState = await getClients(); assert.equal(clientState.items[0].lastReachedAtIso, replyTime); assert.equal(clientState.items[0].lastAttemptAtIso, replyTime);
      const feedbackHistory = clientState.history as Array<{ id: string; responseText: string | null; channel: string | null }>;
      assert.equal(feedbackHistory.filter(row => row.id === feedbackRecord.id).length, 1, "audit and domain records display once");
      assert.equal(feedbackHistory.find(row => row.id === feedbackRecord.id)?.responseText, "Feeling better");
      assert.equal(feedbackHistory.find(row => row.id === feedbackRecord.id)?.channel, "whatsapp");
      const recordedFeedback = feedbackHistory.find(row => row.id === feedbackRecord.id) as unknown as { recordedAtIso: string };
      assert.equal(recordedFeedback.recordedAtIso, feedbackRecord.recordedAt.toISOString());
      // Simulate a future provider delivery record without sending any message.
      await prisma.communicationLog.create({ data: { organizationId: organizationA, customerId: clientA, appointmentId: appointmentA,
        purpose: "follow_up", source: "integration", channel: "whatsapp", direction: "outbound", result: null,
        summary: "Synthetic delivered message", metadata: { deliveryStatus: "delivered", providerMessageId: "synthetic-message" } } });
      const deliveryState = await getClients();
      assert.equal(deliveryState.items[0].lastReachedAtIso, replyTime, "message delivery is not a client response");
      assert.equal(deliveryState.items[0].lastAttemptAtIso, replyTime, "delivery-only records do not overwrite logged contact recency");
      assert.equal(clientState.items[0].nextContactAtIso, null);
      assert.equal(await prisma.followUpTask.count({ where: { organizationId: organizationA } }), 0);
      const beforeSchedule = clientState.items[0].lastAttemptAtIso;
      const manualSchedule = { action: "schedule", requestId: "staff-schedule", appointmentId: appointmentA, dueAtIso: new Date(Date.now() + 3600000).toISOString(), reason: "Doctor requested check-in" };
      const schedules = await Promise.all([1, 2].map(() => contactAction(clientA, manualSchedule)));
      assert.deepEqual(schedules.map(row => row.status), [201, 201]);
      clientState = await getClients(); assert.equal(clientState.items[0].lastAttemptAtIso, beforeSchedule, "scheduling is not a contact attempt");
      assert.equal((clientState.history as Array<{ label: string }>).filter(row => row.label === "Staff scheduled a follow-up").length, 1, "scheduling appears once on the client timeline");
      assert.ok(clientState.items[0].nextContactAtIso);
      const postVisit = await prisma.followUpTask.findFirstOrThrow({ where: { organizationId: organizationA, appointmentId: appointmentA } });
      assert.equal(await prisma.followUpTask.count({ where: { organizationId: organizationA } }), 1, "manual retry creates one reminder");
      assert.match(postVisit.summary, /Test procedure/);
      assert.equal((await readQueue(`/api/followups?view=upcoming&appointmentId=${appointmentA}&purpose=post_visit`)).items.length, 1, "Schedule shortcut keeps routine recall separate");
      const nextContactAtIso = new Date(Date.now() + 45 * 60_000).toISOString();
      const firstResponse = { response: "no_answer", requestId: "first-attempt", expectedUpdatedAtIso: postVisit.updatedAt.toISOString(), nextContactAtIso, note: "Retry later today" };
      const log = (body: unknown) => call(`/api/followups/${postVisit.id}/responses`, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal((await log(firstResponse)).status, 201);
      assert.equal((await log(firstResponse)).status, 201, "same request replays safely");
      assert.equal((await log({ ...firstResponse, note: "Changed" })).status, 409);
      assert.equal((await log({ ...firstResponse, requestId: "stale-attempt" })).status, 409);
      let detail = await readDetail(postVisit.id);
      assert.equal(detail.history.length, 1);
      assert.equal(detail.history[0].note, "Retry later today");
      assert.equal(detail.history[0].actor, "Clinic A Owner");
      assert.equal(detail.task.status, "Waiting");
      const upcoming = await readQueue(`/api/followups?view=upcoming&customerId=${clientA}`);
      assert.equal(upcoming.items.find(row => row.id === postVisit.id)?.lastResponse?.note, "Retry later today");
      assert.equal((await log({ ...firstResponse, requestId: "past-time", expectedUpdatedAtIso: detail.task.updatedAtIso, nextContactAtIso: "2020-01-01T00:00:00Z" })).status, 400);
      assert.equal((await log({ response: "provider_attention", requestId: "missing-note", expectedUpdatedAtIso: detail.task.updatedAtIso })).status, 400);
      assert.equal((await log({ response: "provider_attention", requestId: "provider-attempt", expectedUpdatedAtIso: detail.task.updatedAtIso, note: "Client asks to speak with provider" })).status, 201);
      detail = await readDetail(postVisit.id);
      assert.equal(detail.task.status, "Blocked");
      const attention = await readQueue(`/api/followups?view=attention&customerId=${clientA}`);
      assert.equal(attention.items.length, 1);
      assert.match(attention.items[0].nextAction, /Follow-up test provider/);
      const competing = await Promise.all(["finish-a", "finish-b"].map(requestId => log({ response: "reached", requestId, expectedUpdatedAtIso: detail.task.updatedAtIso, note: "No further action" })));
      assert.deepEqual(competing.map(row => row.status).sort(), [201, 409], "only one competing response commits");
      detail = await readDetail(postVisit.id);
      assert.equal(detail.history.length, 3);
      assert.equal(detail.task.status, "Done");
      assert.equal((await log({ response: "no_answer", requestId: "reopen", expectedUpdatedAtIso: detail.task.updatedAtIso, nextContactAtIso })).status, 409);
      assert.equal(await prisma.followUpTask.count({ where: { organizationId: organizationA, type: "Recall" } }), 0, "case completion does not create routine recalls");
      clientState = await getClients(); assert.ok(clientState.items[0].lastReachedAtIso);
      const existingRecall = await prisma.followUpTask.create({ data: { organizationId: organizationA, customerId: clientA, appointmentId: appointmentA, ownerId: providerA, type: "Recall", dueAt: new Date(), summary: "Previously scheduled recall", nextAction: "Call" } });
      assert.equal((await contactAction(clientA, { action: "log", result: "reached", requestId: "finish-old-recall", appointmentId: appointmentA, taskId: existingRecall.id, expectedUpdatedAtIso: existingRecall.updatedAt.toISOString() })).status, 201);
      assert.equal(await prisma.followUpTask.count({ where: { organizationId: organizationA, type: "Recall" } }), 1, "finishing an existing recall does not create its next occurrence");
      const lastContactBeforeBackdate = (await getClients()).items[0].lastAttemptAtIso;
      const backdatedReminder = await prisma.followUpTask.create({ data: { organizationId: organizationA, customerId: clientA, appointmentId: appointmentA,
        type: "Reminder", dueAt: new Date(Date.now() + 3600000), summary: "Backdated contact test", nextAction: "Check in", dateOnly: false } });
      assert.equal((await contactAction(clientA, { action: "log", result: "no_answer", requestId: "backdated-task-contact", appointmentId: appointmentA,
        taskId: backdatedReminder.id, expectedUpdatedAtIso: backdatedReminder.updatedAt.toISOString(), occurredAtIso: attemptTime })).status, 201);
      assert.equal((await getClients()).items[0].lastAttemptAtIso, lastContactBeforeBackdate, "the audit save time cannot overwrite a backdated contact time");
      assert.equal((await prisma.followUpTask.findUniqueOrThrow({ where: { id: backdatedReminder.id } })).status, "Open");

      const clinicDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const todayStart = new Date(clinicDay + "T00:00:00+05:45"); const tomorrowStart = new Date(todayStart.getTime() + 86400000);
      const [overdueTask, todayTask, futureTask] = await Promise.all([new Date(todayStart.getTime() - 1), new Date(tomorrowStart.getTime() - 1), tomorrowStart].map(dueAt => prisma.followUpTask.create({ data: {
        organizationId: organizationA, customerId: clientA, type: "Reminder", dueAt, summary: "Calendar boundary", nextAction: "Contact client", dateOnly: false,
      } })));
      const todayQueue = await readQueue("/api/followups?view=today"); const overdueQueue = await readQueue("/api/followups?view=overdue"); const futureQueue = await readQueue("/api/followups?view=future");
      assert.ok(todayQueue.items.some(row => row.id === todayTask.id), "Today includes later today");
      assert.ok(!todayQueue.items.some(row => row.id === overdueTask.id || row.id === futureTask.id));
      assert.ok(overdueQueue.items.some(row => row.id === overdueTask.id)); assert.ok(!overdueQueue.items.some(row => row.id === todayTask.id));
      assert.ok(futureQueue.items.some(row => row.id === futureTask.id)); assert.ok(!futureQueue.items.some(row => row.id === todayTask.id));
      const [neverContacted, oldContacted, failedContact] = ["never", "old", "failed"].map(name => `${prefix}-${name}`);
      await prisma.customer.createMany({ data: [neverContacted, oldContacted, failedContact].map(id => ({ id, organizationId: organizationA, fullName: id, phone: id })) });
      await prisma.communicationLog.createMany({ data: [
        { customerId: oldContacted, result: "reached", occurredAt: new Date(Date.now() - 40 * 86400000) },
        { customerId: failedContact, result: "no_answer", occurredAt: new Date() },
      ].map(row => ({ ...row, organizationId: organizationA, channel: "call", direction: "outbound", source: "manual", purpose: "follow_up", summary: "Filter fixture" })) });
      const contactFilter = async (days: number) => { const response = await call(`/api/followups/clients?view=not_contacted&uncontactedDays=${days}`, { headers }); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body as { items: Array<{ customerId: string }> }; };
      const uncontacted = (await contactFilter(30)).items.map(row => row.customerId);
      assert.ok(uncontacted.includes(neverContacted)); assert.ok(uncontacted.includes(oldContacted)); assert.ok(uncontacted.includes(failedContact));
      assert.ok(!uncontacted.includes(clientA)); assert.ok(!uncontacted.includes(clientB));
      assert.ok(!(await contactFilter(60)).items.some(row => row.customerId === oldContacted), "X is a staff-selected filter, not a reminder rule");
      assert.equal((await call("/api/followups/clients?view=not_contacted&uncontactedDays=0", { headers })).status, 400);
      assert.equal((await call(`/api/v1/finance/workspace?appointmentId=${appointmentB}`, { headers })).status, 404);

      await prisma.auditLog.createMany({ data: Array.from({ length: 51 }, (_, index) => ({
        organizationId: organizationA, actorId: userA, entityType: "follow_up", entityId: postVisit.id, action: "response_logged",
        createdAt: new Date(Date.UTC(2020, 0, 1, 0, index)), description: "Historical response fixture",
        newValue: { response: "no_answer", note: `Historical attempt ${index}` },
      })) });
      const clientTimeline = (await getClients()).history as Array<{ label: string; note: string | null }>;
      assert.ok(clientTimeline.some(row => row.label === "Historical response fixture" && row.note?.startsWith("Historical attempt")), "client timeline includes legacy task responses and staff notes");
      assert.equal(clientTimeline.length, 50, "client timeline remains bounded");
      type HistoryPage = { history: Array<{ id: string }>; hasOlderHistory: boolean; nextHistoryCursor: string | null };
      const recentHistory = await (await call(`/api/followups/${postVisit.id}`, { headers })).json() as HistoryPage;
      assert.equal(recentHistory.history.length, 50);
      assert.equal(recentHistory.hasOlderHistory, true);
      const olderHistory = await (await call(`/api/followups/${postVisit.id}?cursor=${recentHistory.nextHistoryCursor}`, { headers })).json() as HistoryPage;
      assert.equal(olderHistory.history.length, 4);
      assert.equal(olderHistory.hasOlderHistory, false);
      assert.equal(new Set([...recentHistory.history, ...olderHistory.history].map(row => row.id)).size, 54);
      const foreignHistory = await prisma.auditLog.create({ data: { organizationId: organizationB, entityType: "follow_up", entityId: followupB, action: "response_logged", description: "Foreign history fixture" } });
      assert.equal((await call(`/api/followups/${postVisit.id}?cursor=${foreignHistory.id}`, { headers })).status, 404);

      const operational = await call("/api/operational-data", { headers });
      assert.equal(operational.status, 200);
      assert.equal((await operational.json() as { organization: { id: string } }).organization.id, organizationA);
      const system = await call("/api/system/status", { headers });
      assert.equal(system.status, 200);
      assert.equal((await system.json() as { organizationCount: number }).organizationCount, 1);
      assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: organizationB } })).name, "Clinic B");
      assert.equal((await prisma.followUpTask.findUniqueOrThrow({ where: { id: followupB } })).status, "Open");
      assert.equal(await prisma.communicationLog.count({ where: { appointmentId: appointmentB } }), 0);
      await prisma.customer.update({ where: { id: clientA }, data: { archivedAt: new Date() } });
      const archivedContact = await getClients();
      assert.equal(archivedContact.items[0].canManage, false);
      assert.ok(archivedContact.history.length, "archived client contact history remains readable");
      assert.equal((await contactAction(clientA, { action: "log", result: "reached", requestId: "archived-contact" })).status, 404);
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

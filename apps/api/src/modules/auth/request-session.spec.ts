import assert from "node:assert/strict";
import test from "node:test";

import type { AuthSession } from "./auth.service";
import { sessionForService } from "./request-session";

const cookieSession: AuthSession = {
  id: "staff-cookie",
  organizationId: "clinic-cookie",
  name: "Cookie Staff",
  email: "cookie.staff@example.test",
  role: "Receptionist",
};

test("controller session bridge forwards the guard-attached cookie session over a header fallback", () => {
  const reference = sessionForService(
    { authSession: cookieSession },
    "Bearer temporary-compatibility-token",
  );

  assert.equal(reference as unknown, cookieSession);
});

test("controller session bridge uses the temporary bearer header only when the guard did not attach a session", () => {
  assert.equal(
    sessionForService({}, "Bearer temporary-compatibility-token"),
    "Bearer temporary-compatibility-token",
  );
});

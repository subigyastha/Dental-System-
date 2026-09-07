import assert from "node:assert/strict";
import test from "node:test";

import { signOutButtonLabel } from "./secure-sign-out";

test("sign-out controls expose clear pending and booking-blocked labels", () => {
  assert.equal(
    signOutButtonLabel({ isBlocked: false, isSigningOut: false }),
    "Sign out",
  );
  assert.equal(
    signOutButtonLabel({ isBlocked: false, isSigningOut: true }),
    "Signing out…",
  );
  assert.equal(
    signOutButtonLabel({ isBlocked: true, isSigningOut: false }),
    "Finishing booking…",
  );
});


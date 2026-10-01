# Slot hold timeout recovery

The browser previously stopped every API request after eight seconds. A hold
write can still commit on the server after its response is lost. Clearing its
pending request then generated a new idempotency key, so the next attempt saw
the original hold as occupied and the selected time disappeared from availability.

Hold creation now has a scoped 45-second deadline, including CSRF setup, and
one automatic retry using the exact original payload and idempotency key.
Network, timeout, response-body abort and server errors remain uncertain outcomes;
rejections such as HTTP 401 and 409 are not automatically retried.

If recovery still fails, the drawer preserves the pending request and offers
**Check selected time** even when that hold hides the slot from refreshed
availability. Provider, service, date and slot changes wait for reconciliation.
A recovered expired/released/consumed hold cannot advance the flow. Closing the
drawer attempts to reconcile and release an uncertain hold; if disconnected,
the existing three-minute server expiry remains the bounded fallback.

The authoritative scheduling recheck now uses the hold transaction's connection
and bypasses process caches. This avoids waiting for a second pooled connection
while the transaction is already holding one, and ensures the locked recheck
sees current scheduling data. Redundant preflight timing reads were removed;
the authoritative timing check remains inside the lock. Hold transactions have
a bounded 25-second timeout for remote database latency.

Other API requests keep the existing eight-second deadline. No mutation without
an idempotent contract receives an automatic retry. No schema change is needed.

## Verification

Regression tests cover lost-response recovery with identical payload/key,
bounded uncertainty retries, conflict/authorization rejection, persisted-hold
replay without another write, and fresh scheduling reads using only the
transaction connection even when a stale cache entry exists.

Manual acceptance should still check slow/mobile networks, double-tap Continue,
closing during an uncertain hold, expiry, and final confirmation with a clinic
account. API expiry and overlap checks remain authoritative.

Signed-in production acceptance also identified a Schedule handoff defect:
the desktop Day callback forwarded Provider/date but dropped the selected
timestamp. Schedule entry points now pass the booking callback directly so
the full launch context reaches the shared drawer. This is verified by opening
an actual Schedule cell; no duplicated launch adapter was introduced.

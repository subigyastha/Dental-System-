# Booking confirmation after an uncertain response

A confirmation can commit even when its response is lost. Timeout (408), network
failure, aborted response bodies and server failures now use one shared booking
write classifier. Slot holds retain the same classification through an alias.

An uncertain confirmation retains its original payload and idempotency key.
**Retry safely** sends exactly that request, even after the original hold expires.
The API checks for a durable confirmation receipt before validating a current
hold, so a committed booking is restored instead of created twice.

Until the outcome is known, booking cannot change the Client, clinic, service or
time. Back navigation restores the pending booking, and closing or attempting
to discard minimizes it with an attention action. The user can reopen and retry.
A successful receipt completes the flow; definitive rejections clear uncertainty
and permit correction or choosing another available time. No automatic retry is
added to the confirmation transport, and normal requests keep their deadlines.

Client-first booking also waits for service availability to finish updating
before it can advance with a previously selected time.

The mobile Schedule header wraps its view toggle when there is insufficient
width, keeping the date and controls inside a 320-pixel viewport.

## Verification

Focused regression tests cover transport failure classification, exact request
and key reuse, protection against edited uncertain payloads, settled attempt
changes, and server replay after a consumed hold's expiry. Existing PostgreSQL
integration coverage checks concurrent same-key confirmation, competing requests
for one slot, expired-hold rejection and transactional rollback. CI runs those
integration suites against disposable PostgreSQL, never clinic data.

Manual acceptance should cover phone-sized Schedule handoff, incompatible service
duration recovery, expiry and reselection. Physical-device checks, forced slow
network UI acceptance and final confirmation against an isolated test clinic
remain separate evidence; no test appointment should be inserted into a live
clinic solely to claim that these checks are complete.

No schema changes, new infrastructure or browser-stored contact/clinical data are
introduced.

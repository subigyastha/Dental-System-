# Session expiry navigation

Protected workspace and platform requests now check for the session cookie on
the Next server before rendering. A missing or empty cookie redirects to
`/login` without waiting for Nest. This also handles browser removal of a
cookie after its absolute expiry, even when the API is starting or unavailable.

Cookie presence does not authenticate a request. Nest remains responsible for
validating expiry, inactivity, revocation, and account status. Its HTTP 401
response publishes the shared session-end event. The root redirect boundary
now subscribes through `subscribeToSessionEnd`, including validated cross-tab
messages; its previous event name no longer matched the publisher.

Network errors and API failures still leave an authenticated workspace
retryable. They must not be interpreted as proof that a session has expired.
An invalid login does not publish session expiry to other tabs. Clearing the
workspace cache also invalidates in-flight responses so an old request cannot
restore an identity or detach a newer request.

## Verification

- Web TypeScript checks pass.
- Existing session lifecycle and workspace gate tests pass, including expired
  session handling, validated peer-tab messages, and genuine outage behavior.
- A production build running locally with the API stopped returned HTTP 307
  to `/login` for Dashboard, Schedule, Client detail, Settings, and Platform
  without a cookie, and for Dashboard with an empty cookie. Browser navigation
  from Dashboard reached the sign-in form.
- Regression tests cover failed login/outage isolation, bounded request
  deadlines, and clearing a workspace session during an in-flight response.
- API rejection of present but expired/revoked cookies remains covered by
  the existing server session tests; physical-device acceptance remains open.

No schema migration or session-cookie format change is required.

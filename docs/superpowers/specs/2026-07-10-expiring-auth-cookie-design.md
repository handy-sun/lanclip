# Expiring Authentication Cookie Design

## Summary

Replace the frontend's permanent `localStorage.auth` credential with a backend-managed HttpOnly cookie. Users can keep authentication for the current browser session or explicitly remember it for 1, 3, 7, or 30 days. The existing HTTP Bearer authentication and legacy WebSocket query authentication remain compatible.

This change improves browser credential lifetime and prevents the updated frontend from retaining the authentication code in JavaScript-accessible storage or placing it in WebSocket URLs. The code exists in Vue state only while the user submits the login form.

## Goals

- Do not retain the authentication code permanently by default.
- Make an unchecked "remember password" option last for the browser session.
- Offer fixed, non-sliding remembered lifetimes of 1, 3, 7, and 30 days, defaulting to 7 days.
- Store browser authentication in an HttpOnly, SameSite cookie.
- Authenticate same-origin HTTP and WebSocket traffic with that cookie.
- Preserve existing `Authorization: Bearer` HTTP clients.
- Preserve legacy `?auth=` WebSocket clients during the compatibility period.
- Work at the domain root and under `server.prefix`.
- Work behind the nginx and FRP HTTPS termination described by the deployment setup.

## Non-goals

- Replacing the configured shared authentication code with user accounts.
- Adding roles, per-room passwords, or per-device sessions.
- Changing the existing public-file URL behavior.
- Building a persistent server-side session database.
- Automatically extending a remembered lifetime when the user reconnects.

## User Interface

The existing authentication dialog remains the entry point and gains:

- a password-type text field;
- a `v-checkbox` labelled "记住密码", unchecked by default;
- a `v-select` labelled "有效期" shown only when remembering is enabled;
- duration choices of 1 day, 3 days, 7 days, and 30 days;
- a default remembered duration of 7 days;
- a loading state while credentials are submitted;
- inline or toast feedback when the password is rejected;
- Enter-key submission when the password is non-empty.

The navigation drawer gains a "退出认证" action while server authentication is enabled. It calls the logout endpoint, closes the WebSocket, clears client authentication state, and reopens the authentication dialog.

The password remains in Vue state only while the dialog is being submitted. It is cleared after a successful login and is never read back from the HttpOnly cookie.

## Authentication API

All routes inherit `server.prefix`.

### `POST /auth`

Accept JSON:

```json
{
    "password": "shared authentication code",
    "rememberDays": 7
}
```

`rememberDays` is `null` when "记住密码" is unchecked. Otherwise it must be exactly `1`, `3`, `7`, or `30`. Unknown fields are ignored, but invalid field types or duration values return HTTP 400.

When the password is wrong, return HTTP 403 without setting a cookie. When it is correct, set the authentication cookie and return the existing JSON response envelope with HTTP 200.

Failed login attempts are limited per client IP to 10 attempts in 15 minutes. Further attempts return HTTP 429 until the window expires. A successful login clears the client's failure record. This limiter is process-local and intentionally does not add a persistent database.

### `DELETE /auth`

Clear the authentication cookie using the same name, path, and relevant attributes used when setting it. This endpoint does not require existing authentication so an invalid or stale cookie can always be removed.

### `GET /server`

Keep the existing fields and add `authenticated`:

```json
{
    "server": "ws://clip.example.com/push",
    "auth": true,
    "authenticated": true
}
```

When authentication is disabled, `authenticated` is always `true`. When it is enabled, the value reflects whether the current cookie contains the configured authentication code.

This field is additive, so older frontends continue to work.

## Cookie Rules

Use a cookie named `lanclip_auth` with:

- `HttpOnly` enabled;
- `SameSite=Strict`;
- `Secure` when the externally observed request is HTTPS;
- a `Path` matching `server.prefix` and ending in `/`, or `/` at the root;
- no `Domain` attribute, keeping it host-only;
- no `Max-Age` or `Expires` when remembering is disabled;
- `Max-Age` matching the selected fixed duration when remembering is enabled.

The cookie contains the shared authentication code encoded through Koa's cookie handling. This avoids a new session store, survives server restarts while the configured code remains unchanged, and keeps the code inaccessible to frontend JavaScript. It remains a bearer credential and must only be transported over HTTPS for public deployments.

Changing `server.auth` immediately invalidates existing cookies because the cookie value no longer matches the configured code.

Some browsers can restore session cookies when configured to restore the previous browser session. This browser-controlled behavior is documented but not overridden by application code.

## Server Authentication

Create shared helpers for:

- comparing a supplied credential with `config.server.auth`;
- reading and writing the authentication cookie;
- deciding whether an HTTP request is authenticated;
- deciding whether a WebSocket upgrade is authenticated.

Protected HTTP routes accept either:

1. `Authorization: Bearer <code>`; or
2. a valid `lanclip_auth` cookie.

WebSocket authentication accepts either:

1. a valid `lanclip_auth` cookie; or
2. the existing `?auth=<code>` query parameter for backward compatibility.

The updated frontend uses only the cookie. Consequently, its authentication code no longer appears in `/push` URLs or default nginx access logs.

Koa proxy awareness is enabled so `X-Forwarded-Proto: https` makes `ctx.secure` accurate and causes Secure cookies to be issued through nginx/FRP. Deployment documentation must state that the backend should bind to loopback, a private container network, or otherwise accept forwarded headers only from the trusted proxy path.

## Frontend Connection Flow

1. On startup or reconnect, request `GET server`.
2. If `auth` is false, connect immediately.
3. If `auth` and `authenticated` are true, connect immediately without an auth query parameter.
4. Otherwise open the authentication dialog.
5. Submit the password and selected lifetime to `POST auth`.
6. On success, clear the password from Vue state, close the dialog, and connect the WebSocket.
7. On HTTP 400, show a validation error. On 403, keep the dialog open and show "密码错误". On 429, report that too many attempts were made and keep the dialog open.
8. If a WebSocket still emits `forbidden`, call `DELETE auth`, clear connection state, and reopen the dialog.

Axios no longer injects the browser password into `Authorization`. Same-origin requests carry the HttpOnly cookie automatically. External HTTP API clients continue to provide Bearer authorization themselves.

## Migration

On startup, unconditionally remove the legacy `localStorage.auth` value. It has no timestamp, so it cannot be assigned a trustworthy expiry and must not be silently migrated into a new persistent credential.

Users authenticate once after upgrading. Other local preferences, including theme colors and dark-mode settings, are unchanged.

## Error Handling

- Malformed or missing login input returns HTTP 400 with a generic Chinese message.
- Wrong credentials return HTTP 403 without echoing or logging the supplied password.
- Rate-limited requests return HTTP 429.
- Login UI errors do not close the dialog or start reconnect loops.
- Logout is idempotent and succeeds even when the cookie is absent.
- Cookie parsing failures are treated as unauthenticated and can be cleared through logout.
- Server logs may record the client IP and result, but never the credential or Cookie header.

## Compatibility and Security Boundaries

- The HTTP Bearer API remains supported.
- Legacy WebSocket query authentication remains supported but is no longer emitted by the maintained frontend.
- Cookie authentication is same-origin and does not add CORS support.
- `SameSite=Strict` reduces cross-site request and WebSocket credential exposure.
- The shared code remains the only authorization boundary; rooms are selectors, not separate security realms.
- File download authorization remains unchanged and is outside this change.
- Operators exposing LanClip publicly should use HTTPS, a non-trivial fixed authentication code, and firewall the backend so only frpc or the trusted reverse-proxy path can reach it.

## Verification

Backend verification covers:

- wrong login returns 403 and no `Set-Cookie`;
- unsupported duration returns 400;
- the eleventh failed attempt in a 15-minute window returns 429;
- session login sets HttpOnly and SameSite without persistent lifetime attributes;
- each remembered duration sets the corresponding fixed lifetime;
- HTTPS proxy requests set Secure;
- a valid cookie authorizes protected HTTP routes;
- Bearer authentication remains valid;
- cookie and legacy query authentication both authorize WebSocket connections;
- logout expires the cookie;
- changing or supplying an invalid cookie reports `authenticated: false`.

Frontend verification covers:

- the production build succeeds;
- remember is unchecked by default;
- the duration selector appears only when remember is checked and defaults to 7 days;
- all four durations are selectable;
- wrong-password and rate-limit feedback remains in the dialog;
- successful authentication clears the in-memory password and connects WebSocket;
- logout clears authentication and returns to the dialog;
- no maintained frontend request or WebSocket URL contains the authentication code;
- the legacy `localStorage.auth` key is removed.

Run a browser smoke test through an HTTPS reverse proxy to confirm the Secure cookie, WebSocket upgrade, page reload, logout, and remembered/session behavior.

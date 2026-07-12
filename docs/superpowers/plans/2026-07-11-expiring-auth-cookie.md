# Expiring Authentication Cookie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace permanent frontend password storage with session or fixed-duration HttpOnly authentication cookies while retaining Bearer HTTP and query-parameter WebSocket compatibility.

**Architecture:** A focused `createAuthService()` module owns credential comparison, cookie attributes, remembered durations, and process-local login throttling. Koa HTTP and WebSocket routers consume the same interface, while the Vue mixin treats `/server.authenticated` and `POST /auth` as the browser login protocol. The maintained frontend never reads the cookie or adds the password to request URLs.

**Tech Stack:** Node.js 22, Koa 3, `@koa/router`, Node's built-in test runner, Vue 2.7, Vuetify 2, Axios, Chrome browser smoke testing.

---

## File Map

- Create `server-node/app/auth.js`: pure authentication-service factory, cookie rules, credential checks, and login throttling.
- Create `server-node/test/auth.test.js`: deterministic unit tests for authentication and cookie behavior.
- Create `server-node/test/http-auth.test.js`: production-style HTTP integration tests against a spawned server.
- Modify `server-node/package.json`: add the built-in Node test command.
- Modify `server-node/main.js`: trust the configured reverse-proxy path so external HTTPS is visible to Koa.
- Modify `server-node/app/http-router.js`: add login/logout/status endpoints and accept cookie or Bearer authentication.
- Modify `server-node/app/ws-router.js`: accept cookie authentication while retaining legacy query authentication.
- Modify `client/src/websocket.js`: implement cookie-based login, status checks, reconnect, and logout.
- Modify `client/src/main.js`: remove the legacy Axios Bearer injection and delete stale local storage.
- Modify `client/src/App.vue`: add remember controls, fixed durations, password visibility behavior, loading state, and logout action.
- Modify `README.md`: document cookie lifetime and trusted reverse-proxy behavior.
- Modify `AGENT.md`: keep runtime/authentication architecture and verification guidance current.

### Task 1: Authentication service with deterministic tests

**Files:**
- Create: `server-node/test/auth.test.js`
- Create: `server-node/app/auth.js`
- Modify: `server-node/package.json`

- [ ] **Step 1: Add the test command and failing unit tests**

Add this script to `server-node/package.json`:

```json
"test": "node --test"
```

Create tests that import `createAuthService` and assert:

```js
const service = createAuthService({auth: 'secret', prefix: '/lanclip'}, {now: () => now});
assert.equal(service.isAllowedRememberDays(null), true);
assert.equal(service.isAllowedRememberDays(7), true);
assert.equal(service.isAllowedRememberDays(2), false);
assert.equal(service.matchesCredential('secret'), true);
assert.equal(service.matchesCredential('wrong'), false);
```

Use a mock Koa context with `secure`, `headers`, `query`, and a cookie map to verify session cookies omit `maxAge`, remembered cookies use `days * 86400000`, all cookies are HttpOnly/SameSite Strict/path-scoped, and forwarded HTTPS produces `secure: true` through `ctx.secure`.

Use an injected clock to record ten failures and verify the eleventh request is rate-limited with a positive retry delay, then advance beyond 15 minutes and verify the record expires.

- [ ] **Step 2: Run the unit test to verify RED**

Run:

```bash
cd server-node && npm test -- test/auth.test.js
```

Expected: FAIL because `app/auth.js` does not exist.

- [ ] **Step 3: Implement `createAuthService()`**

Export the allowed duration list and a factory with this interface:

```js
export const AUTH_REMEMBER_DAYS = Object.freeze([1, 3, 7, 30]);

export const createAuthService = (serverConfig, {now = Date.now} = {}) => ({
    isAllowedRememberDays,
    matchesCredential,
    isRequestAuthenticated,
    setCookie,
    clearCookie,
    getRetryAfter,
    recordFailure,
    clearFailures,
});
```

Use `crypto.timingSafeEqual` after checking equal buffer lengths. Read Bearer and unsigned `lanclip_auth` credentials. Set cookies with `signed: false`, `httpOnly: true`, `sameSite: 'strict'`, `overwrite: true`, host-only scope, the normalized prefix path, and conditional `secure`/`maxAge`. Keep failure timestamps in a per-IP `Map` with a 10-attempt/15-minute window.

- [ ] **Step 4: Run unit tests to verify GREEN**

Run:

```bash
cd server-node && npm test -- test/auth.test.js
```

Expected: all authentication-service tests pass.

### Task 2: HTTP cookie authentication and compatibility

**Files:**
- Create: `server-node/test/http-auth.test.js`
- Modify: `server-node/app/http-router.js`
- Modify: `server-node/main.js`

- [ ] **Step 1: Write failing HTTP integration tests**

Spawn `node main.js <temporary-config.json>` on an unused loopback port with `auth: "test-secret"`, isolated history/storage paths, and no static dependency. Exercise with Node `fetch()` and assert:

```js
assert.equal((await fetch(`${base}/server`)).status, 200);
assert.equal((await serverResponse.json()).authenticated, false);
assert.equal((await login({password: 'wrong', rememberDays: 7})).status, 403);
assert.equal((await login({password: 'test-secret', rememberDays: 2})).status, 400);
```

For a successful session login, require `HttpOnly`, `SameSite=Strict`, `Path=/`, and no `Max-Age`. For a seven-day login sent with `X-Forwarded-Proto: https`, require `Secure` and `Max-Age=604800`. Send the returned cookie to `POST /text` and require 200; separately require Bearer authentication still returns 200. Logout must expire the cookie.

- [ ] **Step 2: Run the HTTP test to verify RED**

Run:

```bash
cd server-node && npm test -- test/http-auth.test.js
```

Expected: FAIL because `/auth`, `authenticated`, and cookie authorization are absent.

- [ ] **Step 3: Implement HTTP authentication routes**

Instantiate one auth service in `http-router.js`. Replace the old Bearer-only middleware with `authService.isRequestAuthenticated(ctx)`. Add:

```js
router.post('/auth', koaBody({multipart: false, urlencoded: false, text: false, json: true, jsonLimit: 1024}), loginHandler);
router.delete('/auth', logoutHandler);
```

Validate `password` as a non-empty string and `rememberDays` against the exported allowed values. Return 400 for invalid input, 403 for a mismatch, and 429 plus `Retry-After` after ten failed attempts in 15 minutes. Never log the password, Authorization header, or Cookie header. Add `authenticated` to `/server`.

Set `app.proxy = true` immediately after creating the Koa application in `main.js`, allowing `ctx.secure` to follow nginx's `X-Forwarded-Proto`.

- [ ] **Step 4: Run HTTP and unit tests to verify GREEN**

Run:

```bash
cd server-node && npm test
```

Expected: unit and HTTP integration tests pass with no leaked credential in output.

### Task 3: WebSocket cookie authentication

**Files:**
- Modify: `server-node/test/auth.test.js`
- Modify: `server-node/app/ws-router.js`

- [ ] **Step 1: Add failing request-authentication cases**

Extend unit coverage to prove `isRequestAuthenticated(ctx, {allowQuery: true})` accepts a valid cookie or legacy query code, rejects both when invalid, and does not accept query authentication when `allowQuery` is omitted.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
cd server-node && npm test -- test/auth.test.js
```

Expected: the new query-compatibility assertion fails because the request helper does not yet support `allowQuery`.

- [ ] **Step 3: Wire the WebSocket router**

Extend the service so `isRequestAuthenticated(ctx, {allowQuery: true})` checks `ctx.query.auth` after Bearer and cookie credentials. Instantiate the service in `ws-router.js` and replace direct query comparison with:

```js
if (config.server.auth && !authService.isRequestAuthenticated(ctx, {allowQuery: true})) {
    // send forbidden and close
}
```

Retain the `forbidden` event for old clients, but remove logging of `ctx.query.auth`; log only client address and a generic authentication failure.

- [ ] **Step 4: Run all backend tests**

Run:

```bash
cd server-node && npm test
```

Expected: all tests pass.

### Task 4: Vue authentication flow and controls

**Files:**
- Modify: `client/src/websocket.js`
- Modify: `client/src/main.js`
- Modify: `client/src/App.vue`

- [ ] **Step 1: Refactor the connection mixin around server authentication state**

Initialize transient state only:

```js
authCode: '',
authCodeDialog: false,
authRemember: false,
authRememberDays: 7,
authSubmitting: false,
serverRequiresAuth: false,
```

Make `connect()` fetch `/server`, set `serverRequiresAuth`, and open the dialog without starting a retry loop when `auth && !authenticated`. Remove all `localStorage.auth` reads/writes and all `?auth=` WebSocket parameters.

Add `login()` to POST `{password: authCode, rememberDays: authRemember ? authRememberDays : null}`, clear the password after success, close the dialog, and connect. Keep the dialog open for 400/403/429 with specific feedback. Add `logout()` to DELETE `/auth`, disconnect, clear transient state, and reopen the dialog.

- [ ] **Step 2: Remove browser Bearer injection and legacy storage**

Delete the Axios interceptor that injects `app.authCode`. At startup execute:

```js
localStorage.removeItem('auth');
```

Same-origin Axios requests then carry the HttpOnly cookie automatically.

- [ ] **Step 3: Build the Vuetify UI**

Change the password field to `type="password"`, submit on Enter, and add:

```vue
<v-checkbox v-model="$root.authRemember" label="记住密码"></v-checkbox>
<v-select
    v-if="$root.authRemember"
    v-model="$root.authRememberDays"
    :items="[{text: '1 天', value: 1}, {text: '3 天', value: 3}, {text: '7 天', value: 7}, {text: '30 天', value: 30}]"
    label="有效期"
></v-select>
```

Bind the submit button's loading/disabled state and call `$root.login()`. Add a navigation item with `mdiLogout` that is visible when `$root.serverRequiresAuth` and calls `$root.logout()`.

- [ ] **Step 4: Build the frontend**

Run:

```bash
cd client && npm run build
```

Expected: Vue production and modern builds complete successfully, then static assets are copied into both server static directories.

### Task 5: Documentation, runtime smoke tests, and final review

**Files:**
- Modify: `README.md`
- Modify: `AGENT.md`

- [ ] **Step 1: Document behavior and deployment requirements**

Explain session versus 1/3/7/30-day cookies, fixed non-sliding expiry, Bearer API compatibility, removal of browser query credentials, `X-Forwarded-Proto`, and the requirement to restrict direct backend access when trusting proxy headers. Update `AGENT.md` authentication flow and test commands.

- [ ] **Step 2: Run complete automated verification**

Run:

```bash
cd server-node && npm test
cd ../client && npm run build
git diff --check
```

Expected: all backend tests pass, both frontend builds pass, and Git reports no whitespace errors.

- [ ] **Step 3: Run a browser smoke test**

Start the authenticated backend with a temporary config and inspect in Chrome:

- initial authentication dialog;
- remember unchecked and 7-day default when checked;
- all four durations;
- wrong-password feedback;
- successful WebSocket connection;
- `lanclip_auth` flags and lifetime in DevTools;
- reload without another prompt;
- logout returning to the prompt;
- no password in WebSocket URL, console, local storage, or network request URLs.

- [ ] **Step 4: Review the complete diff**

Review security, compatibility, API behavior, UI state transitions, error handling, and scope. Confirm no generated `config.json`, history, storage, `node_modules`, `dist`, or static artifacts are staged.

- [ ] **Step 5: Commit the implementation**

```bash
git add server-node client README.md AGENT.md
git commit -m "feat: add expiring authentication cookies"
```

Expected: one implementation commit containing code, tests, and synchronized documentation, separate from the design and implementation-plan commits.

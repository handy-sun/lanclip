# Lanclip Project Notes

This file is persistent context for coding agents working in this repository. Keep it current when commands, architecture, or conventions change.

## Project Summary

Lanclip is a self-hosted web clipboard for sharing text and files across devices on a LAN or small private deployment. The upstream project name in source/docs is `cloud-clipboard`.

The maintained runtime path is:

- Frontend: Vue 2.7 + Vue CLI 5 + Vuetify 2 in `client/`
- Backend: Node.js ESM + Koa + koa-websocket in `server-node/`
- Static assets: built from `client/` and copied into `server-node/static/`

There is also a legacy PHP/Swoole backend in `server/`. README marks the Swoole version as no longer maintained; treat it as archived unless a task explicitly targets it.

## Repository Layout

- `client/`: Vue 2 SPA.
  - `src/main.js`: root Vue instance, shared state, axios auth interceptor, filters.
  - `src/App.vue`: shell, navigation drawer, auth dialog, room dialog, clear-all action, theme color persistence.
  - `src/websocket.js`: WebSocket connection lifecycle, auth handling, room switching, received/device event handlers.
  - `src/views/Home.vue`: main clipboard view; desktop send panels and mobile fullscreen send dialog.
  - `src/components/SendText.vue`: text send form, posts `text/plain` to `/text`.
  - `src/components/SendFile.vue`: file picker, drag/drop, paste screenshots, chunked upload flow.
  - `src/components/received-item/`: text/file message cards with copy, preview, download, delete.
  - `vue.config.js`: dev server on port `1210`, proxying to backend `http://localhost:9501/`.
  - `after-build.js`: gzip/brotli-compresses built assets and copies `dist` to both `server/static` and `server-node/static`.
- `server-node/`: current backend.
  - `main.js`: Koa app setup, static hosting, HTTP/WS routers, HTTP/HTTPS/UDS listeners, startup logging.
  - `app/config.js`: reads `config.json`, creates a default config if absent, normalizes auth/prefix.
  - `app/http-router.js`: `/server`, `/text`, `/upload`, chunked upload, `/file`, `/content`, revoke APIs, history persistence.
  - `app/ws-router.js`: `/push` WebSocket endpoint, auth, device tracking, config/history replay.
  - `app/uploaded-file.js`: temp storage, file metadata, chunk append, expiry cleanup.
  - `app/message.js`: in-memory bounded message queue.
  - `app/util.js`: JSON response helper, WebSocket broadcast, MurmurHash, thumbnails via `sharp`.
- `server/`: archived PHP/Swoole implementation and PHAR support.
- `.github/workflows/ci.yml`: builds Windows and Ubuntu caxa executables and frontend static artifacts on pushes to `master`.
- `Dockerfile`: builds frontend in one Node 22 Alpine stage, copies static files into `server-node/static`, then runs `node main.js`.
- `flake.nix`: Nix package and development shell. The default package builds the Node backend with frontend static assets embedded.
- `build-phar.php`: legacy PHAR packager for the PHP/Swoole backend.

## Common Commands

The Node projects use npm lock files. Use `npm ci` for reproducible installs when a lock file is present; use `npm install` only when intentionally updating dependency versions.

Frontend:

```bash
cd client
npm ci
npm run serve
```

Frontend build:

```bash
cd client
npm ci
npm run build
```

The build uses Vue CLI `--modern`, then runs `after-build.js`.

Node backend:

```bash
cd server-node
npm ci
npm run dev
```

Production-style local backend:

```bash
cd server-node
npm ci
npm start
```

Full source run from a clean checkout:

```bash
cd client
npm ci
npm run build
cd ../server-node
npm ci
node main.js
```

Docker:

```bash
docker image build -t lanclip .
docker container run -d -p 9501:9501 lanclip
```

Nix:

```bash
nix develop
nix build
nix run
```

The default flake package builds the Vue frontend first, embeds the resulting static files into the Node backend package, and exposes `bin/lanclip`.

Legacy PHP/Swoole backend, only when explicitly needed:

```bash
cd client
npm install
npm run build
cd ../server
composer install --no-dev
php main.php
```

## Runtime Configuration

For `server-node`, config is loaded from:

- `server-node/config.json` when running from `server-node/`, or more generally `process.cwd()/config.json`
- A command-line override: `node main.js /path/to/config.json`

If no config exists and no override is passed, `server-node/app/config.js` writes a default `config.json` in the current working directory.

Important config fields:

- `server.host`: array of hosts, or empty/absent to listen on all interfaces.
- `server.port`: default `9501`; falsy disables TCP port listening.
- `server.uds`: optional UNIX domain socket path, supports `path:perm`.
- `server.prefix`: URL prefix for reverse-proxy subpath deployments.
- `server.key` and `server.cert`: enable HTTPS/WSS when both are set.
- `server.auth`: `false` disables auth, `true` generates a random six-character code, string uses a fixed code.
- `server.history`: max in-memory message history.
- `server.historyFile`: optional persistent history JSON path, default `history.json` in cwd.
- `server.storageDir`: optional uploaded file storage dir, default OS temp `.cloud-clipboard-storage`.
- `text.limit`: max text length.
- `file.expire`, `file.chunk`, `file.limit`: upload expiry, chunk size, and total file limit.

Generated runtime files such as `config.json`, `history.json`, storage directories, `node_modules`, static build output, and PHAR archives should not be mixed into unrelated changes. Keep `package-lock.json` files committed so installs are reproducible.

## API And Data Flow

Main HTTP APIs:

- `GET /server`: returns WebSocket endpoint and auth requirement.
- `POST /text`: accepts `Content-Type: text/plain`; stores HTML-escaped text and broadcasts a `receive` event.
- `POST /upload`: multipart single-file upload for small files.
- `POST /upload/chunk`: starts a chunked upload and returns `uuid`.
- `POST /upload/chunk/:uuid`: appends one binary chunk.
- `POST /upload/finish/:uuid`: finalizes chunked upload, queues message, broadcasts.
- `GET /file/:uuid/:filename?`: streams file; supports range responses for common audio/video extensions.
- `DELETE /file/:uuid`: removes stored file.
- `GET /content/:id`: returns raw text or redirects to file content.
- `DELETE /revoke/:id`: removes one message and broadcasts `revoke`.
- `DELETE /revoke/all`: removes all messages in current room.

Rooms are selected with the `room` query parameter. Messages are filtered by exact room string, with empty string as the global room. Auth uses `Authorization: Bearer <code>` for HTTP and `?auth=<code>` for WebSocket.

WebSocket events:

- Server to client: `config`, `receive`, `receiveMulti`, `revoke`, `connect`, `disconnect`, `forbidden`.
- Client sends empty heartbeat frames every 30 seconds.
- `wsBoardcast` sends to clients whose `client.room` matches the target room, plus clients where `client.room` is undefined.

## Frontend State Model

The root Vue instance in `client/src/main.js` owns shared mutable state:

- `config`: server-provided limits and version.
- `send.text` and `send.files`: current outbound payload.
- `received`: message list.
- `device`: connected device list.
- `dark`: persisted dark mode mode.
- WebSocket/auth/room state is mixed in from `client/src/websocket.js`.

Most components read/write through `$root`. Preserve that pattern unless doing an intentional refactor across the app.

Axios is installed through `vue-axios`. The global request interceptor adds `Authorization: Bearer ...` when `$root.authCode` is set.

## Coding Conventions

- JavaScript is currently plain JS, not TypeScript.
- Node backend uses ESM (`"type": "module"` in `server-node/package.json`).
- Frontend uses Vue 2 options API and single-file components.
- Use four-space indentation in existing JS/Vue/PHP files.
- Keep semicolons; existing code uses them.
- Prefer existing Vuetify 2 patterns and Material Design Icons from `@mdi/js`.
- Do not introduce Vue 3, Vite, TypeScript, Pinia, or a new UI framework unless explicitly requested.
- Keep changes scoped. The PHP/Swoole backend is archived, so do not mirror Node changes into PHP unless the task asks for it.

## Testing And Verification

No automated test suite is present in this checkout.

Practical verification for backend/API changes:

```bash
cd server-node
npm ci
npm start
```

Then exercise:

```bash
curl -H "Content-Type: text/plain" --data-binary "hello" http://localhost:9501/text
curl http://localhost:9501/content/0
```

Practical verification for frontend changes:

```bash
cd client
npm ci
npm run build
```

For interactive UI changes, run backend on `9501` and frontend dev server on `1210`, then test in a browser. The frontend dev server proxies API calls to the backend.

## Known Risks And Gotchas

- npm lock files are committed for the Node projects; update them deliberately with `npm install` when changing dependencies.
- The frontend build chain is on Vue CLI 5 / webpack 5, so it should not require `NODE_OPTIONS=--openssl-legacy-provider` on modern Node.
- `server-node/app/config.js` writes `config.json` automatically in the current working directory. Avoid accidentally committing generated local config.
- Text messages are HTML-escaped before storage and unescaped in `/content/:id`; received cards render escaped HTML with `v-html` plus linkification.
- File deletion is split between message revocation and physical file deletion. UI code often does both; backend endpoints do not automatically remove file storage when a file message is revoked.
- `history.json` persistence is synchronous at call sites through `saveHistory()` calls that return promises but are not always awaited; be careful when changing shutdown or persistence behavior.
- Thumbnail generation uses `sharp` only for files up to 32 MiB and silently ignores thumbnail errors.
- Chunked upload starts without a room; room is applied at finish time.
- `document.onpaste` is assigned by `SendFile.vue`, so multiple mounted instances can overwrite the handler.
- `copyLink()` in received components builds URLs without `config.server.prefix`; verify prefix deployments if touching link generation.
- Device IDs in Node backend are MurmurHash of IP plus user-agent with a process-random seed, so IDs are stable only within one process lifetime.

## Git Notes

- Current default branch is `master`.
- Remote observed during initialization: `origin git@github.com:handy-sun/lanclip.git`.
- Keep unrelated generated artifacts and local runtime files out of commits.

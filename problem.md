# Delete History Race Condition

## Symptom

Deleting a message causes the UI to show it removed, but after refreshing the page the deleted message reappears and a different message may be missing instead.

## Root Cause

`saveHistory()` in `server-node/app/http-router.js` is an async function (`fs.promises.writeFile`) that is **never awaited** at any call site. When multiple operations (delete, new message, another delete) happen in quick succession, concurrent `writeFile` calls interleave and the last-to-finish write overwrites with potentially stale data.

### Call Sites (all unawaited)

- `DELETE /revoke/:id` — single message delete
- `DELETE /revoke/all` — clear all messages
- `POST /text` — send text
- `POST /upload` — upload file
- `POST /upload/finish/:uuid` — chunked upload finish

### Race Scenario

1. Queue: [A, B, C]
2. Delete B → server splices queue to [A, C] → `saveHistory()` starts writing [A, C]
3. Before that write completes, a new message D arrives → queue becomes [A, C, D] → another `saveHistory()` starts writing [A, C, D]
4. The second writeFile finishes first, then the first writeFile finishes and **overwrites** with the older snapshot [A, C]
5. `history.json` now has [A, C] — D is lost
6. On server restart, history restores [A, C]; D is permanently gone despite never being deleted

### Why the UI Shows "Deleted" Initially

The in-memory queue is always correct — `splice()` is synchronous. The WS `revoke` event correctly removes the item from the client's `received` array. The problem only manifests when `history.json` is the source of truth (server restart), or if the stale write corrupts state that a subsequent operation depends on.

## Fix

Serialize `saveHistory()` calls through a Promise chain so writes execute sequentially in call order:

```js
let saveHistoryPromise = Promise.resolve();
const saveHistory = () => {
    saveHistoryPromise = saveHistoryPromise.catch(() => {}).then(() => fs.promises.writeFile(...));
    return saveHistoryPromise;
};
```

- Each call chains onto the previous promise, guaranteeing order
- `.catch(() => {})` prevents a failed write from blocking subsequent writes
- Returns the promise so callers can optionally `await` it (e.g., before process exit)

## Related Code Paths

- `server-node/app/http-router.js` — `saveHistory()` definition and all call sites
- `server-node/app/message.js` — `enqueue()` / `dequeue()` (in-memory queue, unaffected)
- `server-node/app/ws-router.js` — `receiveMulti` on WS connect (sends current queue, unaffected)
- `client/src/websocket.js` — `revoke` handler (removes by id, unaffected)

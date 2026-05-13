# reference-backend

A minimal, **agent-less** remote backend that demonstrates mode 2 of web-companion's
v0.3 control surface:

```
                                              ┌─────────────────────────┐
   ┌──────────────────┐    HTTP /mcp          │  reference-backend      │       ws /ws
   │ desktop MCP host │ ◀────────────────────▶│                         │ ◀────────────▶ page sdk
   │ (claude code,    │  Authorization:       │  • SessionRegistry      │  ?token=<JWT>   (Sidecar)
   │  claw, etc.)     │  Bearer <JWT>         │  • McpHttpRouter        │
   └──────────────────┘                       │  • JWT verify           │
                                              └─────────────────────────┘
```

**No LLM lives here.** The desktop MCP client *is* the agent. The backend's
job is two things only:

1. Verify a HS256 JWT for each connection (page side via `?token=`, MCP side
   via `Authorization: Bearer …`).
2. Route `tools/call` and `resources/read` from the MCP client over to the
   page sdk for the **same `userId`**, and return the result.

It's reference-quality: in-memory `Map`s, one ws session per user, no
clustering, no rate limits, no audit log. Treat it as the skeleton you'd
copy into your own agent backend.

---

## Quickstart

### 1. Install + boot

```sh
pnpm install              # from the repo root
cd examples/reference-backend
pnpm dev                  # listens on 127.0.0.1:3001
```

Boot output:

```
[reference-backend] listening on http://127.0.0.1:3001
[reference-backend]   ws://127.0.0.1:3001/ws?token=<JWT>  (sdk connects here)
[reference-backend]   http://127.0.0.1:3001/mcp           (MCP Streamable HTTP; Authorization: Bearer JWT)
[reference-backend]   http://127.0.0.1:3001/health        (debug)
```

`GET /health` returns the connected users for quick debugging — fine to curl
during development, **don't** expose it on a real deployment.

### 2. Mint a token

```sh
pnpm sign-token alice            # prints a HS256 JWT to stdout
pnpm sign-token alice --exp 7d   # default lifetime is 1d
```

The token is the only routing identity the backend cares about. Both the
page sdk *and* the desktop MCP client must present a token containing the
**same `userId`** to be routed to each other.

> **Set `REFERENCE_BACKEND_SECRET`** in any environment that isn't your
> laptop. The default is a placeholder secret and `sign-token` logs a
> warning when it falls back to it.

### 3. Bring up a page sdk in mode 2

The included `examples/coffee-shop` switches to mode 2 when **both** of these
env vars are present at build/dev time:

```sh
cd ../coffee-shop
VITE_BACKEND_URL=ws://127.0.0.1:3001/ws \
VITE_USER_TOKEN=$(cd ../reference-backend && pnpm -s sign-token alice) \
pnpm dev
```

When both are set, `App.tsx` mounts the headless
[`<Sidecar/>` from `@web-companion/sidecar/react`][sidecar] instead of the
in-page [`<Companion/>`][companion] sidebar. The page now waits for an
external agent to drive it — there is no chat panel any more.

### 4. Drive it from `claude code` (or any other MCP host)

`~/.config/claude/claude_desktop_config.json` (Claude Code Desktop) — or
the equivalent for your MCP client:

```json
{
  "mcpServers": {
    "web-companion": {
      "transport": "http",
      "url": "http://127.0.0.1:3001/mcp",
      "headers": {
        "Authorization": "Bearer <paste the alice JWT here>"
      }
    }
  }
}
```

After restart, `claude code` will see these tools (assuming the coffee-shop
page is open in a browser with `VITE_USER_TOKEN=alice`):

```
alice:add_to_cart       Add an item to the cart
alice:remove_from_cart  Remove an item from the cart
alice:checkout          Place the order
alice:search            Search the menu
alice:read_cart         Read resource: cart contents
alice:read_menu         Read resource: full menu
alice:read_search_results  …
```

Calling `alice:add_to_cart` with `{"id": "mocha"}` will:

1. The MCP client POSTs `tools/call` to `/mcp`.
2. The backend verifies the bearer JWT (userId=`alice`), looks up alice's
   ws session, forwards `{type: 'tools/call', id: N, name: 'add_to_cart',
   input: {id: 'mocha'}}` to the page.
3. The page sdk runs the `click` step, the visible cursor flies to the
   mocha button, native React onClick fires, the cart updates.
4. The page sends back `{type: 'tools/call/result', id: N, result: {...}}`,
   which the backend hands back to the MCP client as the JSON-RPC reply.

---

## Multi-user demo

Mint two tokens, open two browsers (or two private windows), point each at
the same backend but with its own user token:

```sh
# terminal 1 — backend
pnpm dev

# terminal 2 — alice's coffee shop
VITE_BACKEND_URL=ws://127.0.0.1:3001/ws \
VITE_USER_TOKEN=$(cd ../reference-backend && pnpm -s sign-token alice) \
pnpm --filter coffee-shop dev --port 5173

# terminal 3 — bob's coffee shop (separate browser profile / private window)
VITE_BACKEND_URL=ws://127.0.0.1:3001/ws \
VITE_USER_TOKEN=$(cd ../reference-backend && pnpm -s sign-token bob) \
pnpm --filter coffee-shop dev --port 5174
```

Two `claude code` MCP entries — one bearer per user — see disjoint tool
namespaces (`alice:*` vs `bob:*`) and cannot reach across. Re-using
alice's `mcp-session-id` with bob's bearer returns **403**.

---

## Wire protocol

The ws side is unchanged from local-bridge / sidecar — same handshake,
same `tools/call` / `resources/read` request-id pattern. See
[packages/sdk][sdk-readme] for the full message schemas.

The HTTP side speaks vanilla MCP Streamable HTTP (`@modelcontextprotocol/sdk`'s
`StreamableHTTPServerTransport`). Each MCP session is generated server-side
on `initialize` and stamped to the bearer's userId; subsequent requests
must keep the bearer in sync with the `Mcp-Session-Id` header or the
backend returns 403 (cross-tenant) / 404 (unknown session).

Tool naming surfaced to the MCP client:

| Surface | Pattern |
| --- | --- |
| Tool | `<userId>:<toolName>` |
| Resource | `<userId>:read_<resourceName>` — modeled as a side-effect-free tool so MCP clients without `resources/*` still see it |

---

## What this is **not**

- ❌ Not production. No DB, no rate limit, no audit, no SSL termination.
  Stick it behind nginx/Caddy + a real session store before pointing it at
  real users.
- ❌ Not an agent. There is no LLM call here. If you want the backend to
  *think*, write your own `tools/call` handler on top of the
  `SessionRegistry` — see `src/mcp-server.ts` for the shape.
- ❌ Not the only way. For desktop-only use, `@web-companion/local-bridge`
  is simpler (no JWT, single-user, npm i -g and forget). Use this when you
  need multi-user routing via your own backend.

---

## File map

```
src/
  auth.ts        HS256 JWT verify (single function, reads REFERENCE_BACKEND_SECRET).
  sessions.ts    In-memory SessionRegistry — one UserSession per userId, pending
                 request id table, 30s timeout.
  server.ts      HTTP + ws bootstrap; /health, /mcp, /ws upgrade.
  mcp-server.ts  McpHttpRouter — one MCP Server per (userId, mcp-session-id),
                 surfaces namespaced tools + dispatches via SessionRegistry.request().
  sign-token.ts  CLI: `pnpm sign-token <userId> [--exp 1d]`.
```

[sidecar]: ../../packages/sidecar
[companion]: ../../packages/react
[sdk-readme]: ../../packages/sdk

# Self-hosting over HTTP

**How-to guide** · [Documentation](../README.md) · [The MCP server](mcp.md) · [Tools](mcp-tools.md)

> Usually your agent starts the server on your own computer. You can also run one server for a
> whole team, on a machine of your own, and point everyone's agent at its web address. That server
> builds transactions but never signs them, keeps nothing on disk, and lets in whoever reaches it,
> so you put your own login in front of it.

This page is for whoever runs that machine. It needs the `sauce` command installed there
([Install](cli.md#install)), a host the team can reach, and a reverse proxy, such as nginx or
Caddy, that checks a token before it forwards a request. Each person then connects their agent, as
[Connect an agent to it](#connect-an-agent-to-it) shows.

## Run it

```sh
sauce mcp --http 3000
```

This serves Streamable HTTP, MCP's transport over plain HTTP, at `http://127.0.0.1:3000/mcp`. Check
it is up by listing its tools:

```sh
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The answer is one JSON object whose `result.tools` lists 17 tools, from `sauce_chains` to
`sauce_install_skills`. A server over HTTP has no wallet tools and no store tools
([Every tool](mcp-tools.md#every-tool)).

The server is stateless: every POST gets a server of its own, answered as JSON, with no session, so
any replica can answer any request. A GET or DELETE is refused (405).

- **No environment, and no key.** The server reads no environment variable. Its RPC endpoints are
  the `--config` file's ([Use your own endpoints](mcp.md#use-your-own-endpoints) has the format),
  and the built-in public ones for a chain the file does not name. It holds no key: nothing it
  builds is signed. `--wallets` and the password flags are refused over HTTP, and the wallet tools
  are not registered there. It keeps nothing on disk either: it has no Pot store and none of its
  tools.
- **It authenticates no one.** Bound to loopback (`127.0.0.1`), the default, it answers only
  requests whose `Host`, and `Origin` when one is sent, is a loopback name. That keeps a web page
  from reaching it through DNS rebinding, a trick that points a web page's own domain at your
  machine.
- **Off loopback it needs `--allowed-host`.** For a deployment others reach, name the host it is
  served as with `--allowed-host` (repeatable). It refuses to start off loopback without one.
  `--allowed-host '*'` answers any `Host`, for a proxy that checks it itself.

## Put your login in front of it

The server checks no token, so a reverse proxy must, and should rate-limit too: every chain read
spends your endpoints' quota, and the public endpoints' limits are shared by every caller. Choose a
long random token, keep it in your secret store, and give it to each person who may connect.

Keep the server on loopback, behind the proxy, and name the public host it is served as:

```sh
sauce mcp --http 3000 --allowed-host mcp.example.com --config rpc.json
```

A sketch of the proxy in nginx, which checks the token and passes the `Host` on:

```nginx
location /mcp {
  if ($http_authorization != "Bearer <token>") { return 401; }
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
}
```

Serve it over TLS, and add your own rate limit (`limit_req` in nginx). A server on another machine
than its proxy binds with `--host 0.0.0.0` instead, and must then be reachable by the proxy alone.

## Guard what callers send

Over HTTP, a caller's `rpcUrl` is chosen by whoever calls, so the server reaches it only through a
guard:

- It takes `https:` only.
- It resolves the host and refuses any address that is loopback, private or local to a network:
  the private ranges of RFC 1918 and their IPv6 counterpart (ULA), link-local addresses, the
  carrier-grade NAT range (CGNAT), reserved ranges and a cloud metadata service.
- It resolves and checks the host again at every connection, so a name that changes to a private
  address after the check (DNS rebinding) is refused when used.
- It follows no redirect, and times out.
- It bounds what it sends and what it reads back.

`--allow-private-rpc` lets callers reach `http:` and private addresses, for a deployment inside a
private network. Link-local and metadata addresses stay refused. Over stdio there is no guard: the
server is the user's own process, reached by the user's own agent, so an endpoint it names (a local
node included) is one the user can already reach.

A request body over `--max-body` bytes (2 MiB by default) is refused with 413 before it is read.
Each tool bounds its own inputs as well: 256 KiB of program, 32 modules, 64 arguments, defines or
accounts, and 1 MiB of hex.

**Everyone's `rpcUrl` passes through your server.** Tell your team: a key in a URL they pass is
one they share with you. A URL is never returned, logged or quoted.

## Connect an agent to it

Each person adds the server by its address and the token. The same lines connect an agent to any
Sauce server someone else runs at `https://<host>/mcp`, behind a token:

```sh
claude mcp add --transport http sauce https://<host>/mcp --header "Authorization: Bearer <token>"
codex mcp add sauce --url https://<host>/mcp --bearer-token-env-var SAUCE_MCP_TOKEN
copilot mcp add --transport http --header "Authorization: Bearer <token>" sauce https://<host>/mcp
```

The same in each agent's file:

- **Claude Code:** `{ "type": "http", "url": …, "headers": { … } }` in `.mcp.json`.
- **Cursor:** `{ "url": …, "headers": { "Authorization": "Bearer ${env:SAUCE_MCP_TOKEN}" } }`.
- **VS Code:** `{ "type": "http", "url": …, "headers": { … } }` under `servers`.
- **Gemini CLI:** `{ "httpUrl": …, "headers": { … } }`. Its `url` means SSE, an older transport,
  which this server does not serve.

Then ask the agent to list the `sauce_` tools: it names the same 25.

## Next

- Sign what a shared server builds, with each person's own wallet:
  [Sign with your wallet's MCP server](wallet-mcp.md).
- Every tool and its inputs: [The MCP server's tools](mcp-tools.md).

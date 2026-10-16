# Self-hosting over HTTP

**How-to guide** · [Documentation](../README.md) · [The MCP server](mcp.md) · [Tools](mcp-tools.md)

> Usually your agent starts the server on your own computer. You can also run one server for a
> whole team, on a machine of your own, and point everyone's agent at its web address. That server
> builds transactions but never signs them, keeps nothing on disk, and lets in whoever reaches it,
> so you put your own login in front of it.

## Run it

```sh
sauce mcp --http 3000
```

This serves Streamable HTTP at `http://127.0.0.1:3000/mcp`. The server is stateless: every POST
gets a server of its own, answered as JSON, with no session, so any replica can answer any request.
A GET or DELETE is refused (405).

- **No environment, and no key.** The server reads no environment variable. Its RPC endpoints are
  the `--config` file's, and the built-in public ones for a chain the file does not name; it holds
  no key: nothing it builds is signed. `--wallets` and the password flags are refused over HTTP,
  and the wallet tools are not registered there. It keeps nothing on disk either: it has no Pot
  store and no intent store, none of their tools, and no `intentHash`.
- **It authenticates no one.** Bound to loopback, the default, it answers only requests whose
  `Host`, and `Origin` when one is sent, is a loopback name. That keeps a web page from reaching it
  through DNS rebinding.
- **Off loopback it needs `--allowed-host`.** For a deployment others reach, bind it with `--host`
  and name the host it is served as with `--allowed-host` (repeatable). It refuses to start
  without one. `--allowed-host '*'` answers any `Host`, for a proxy that checks it itself.
- **Put your own authentication in front.** Use a reverse proxy that checks a token (or OAuth)
  before forwarding to it, and that rate-limits, since every chain read spends your endpoints'
  quota (and the public endpoints' limits are shared by every caller).

```sh
sauce mcp --http 3000 --host 0.0.0.0 --allowed-host mcp.example.com \
  --config rpc.json
```

**Callers' endpoints are guarded.** Over HTTP, a caller's `rpcUrl` is chosen by whoever calls, so
the server reaches it only through a guard:

- It takes `https:` only.
- It resolves the host and refuses any address that is loopback, private (RFC 1918, ULA),
  link-local, CGNAT, reserved or a cloud metadata service.
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

## Connect an agent to it

Each agent adds a remote server by its address and a token: [A remote server](mcp.md#a-remote-server)
has the line for each.

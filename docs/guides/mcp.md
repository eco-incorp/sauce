# The Sauce MCP server

[Documentation](../README.md) · [The sauce command](cli.md) · [Agent skills](cli.md#agent-skills)

`sauce mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server. A coding agent
gets the read-only half of the [`sauce` command](cli.md) as tools, and the package's agent skills
as tools and resources. The server compiles programs and action documents and lists a chain's
names. It builds three kinds of unsigned transaction: the cook, the Pot's deployment and an
intent's publish transactions. It also rehearses a cook and takes calls apart.

**It never signs, and never asks for a key.** Every transaction comes back unsigned, for a wallet
the user holds. That lets the server run anywhere: on the agent's machine over stdio, or on a host
of your own over Streamable HTTP. Either way, transactions are signed and sent by local means: a
wallet, `cast send`, or `sauce run` with the user's own keystore.

## Run it

One command, through npx. Node.js 24 or newer:

```sh
npx -y @eco-incorp/sauce mcp                                   # stdio: what an agent launches
npx -y @eco-incorp/sauce mcp --http 3000 --config rpc.json     # self-hosted, Streamable HTTP
```

In a project that depends on the package, `npx sauce mcp` runs the project's own version.
`npx sauce mcp --help` lists every flag. The server is loaded only when `sauce mcp` runs, so no
other command pays for it.

Over stdio the server writes nothing but the protocol to stdout. A message larger than `--max-body`
(2 MiB by default) closes the connection.

## Endpoints

A tool that reads a chain takes **`rpcUrl`**, an endpoint for that one call. It looks for an
endpoint in this order:

1. the call's own `rpcUrl`;
2. the server's endpoint for the chain, from `--config <file>` (the
   [`sauce` command's format](cli.md#endpoints-and-signers)):

   ```json
   { "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
   ```

3. if neither has one, a plain error naming the chain and saying to pass `rpcUrl`.

The server ships no endpoint and reads no environment variable.

A provider URL usually carries a key, so no URL is ever returned, logged or quoted, from the call
or from the file. That covers results and errors, including an upstream error that repeats the URL.
The file's path is never shown either. The file is checked when the server starts: a malformed
entry, a `<…>` placeholder or a URL that is not http(s) stops it there. `sauce_chains` says which
chains have a server endpoint.

**A server someone else runs sees every `rpcUrl` you pass it.** Pass only keys you are willing to
share with its operator. Otherwise run the server yourself with `npx -y @eco-incorp/sauce mcp`,
where your URL never leaves your machine.

What works with no endpoint at all:

- compiling a program or an action document;
- a chain's names and a price conversion;
- the EVM cook, given its `value`;
- the Pot's address and deployment, and an intent's publish transactions;
- taking calldata apart, and reading the skills.

What needs one: `sauce_simulate`, a publish dry run, anything given a transaction hash, a Solana cook
(its blockhash and fee), and reading the Kitchen's fee or whether a Pot exists.

## Add it to a coding agent

`sauce mcp setup` writes the project configuration each agent documents. The server it configures
is launched as `npx -y @eco-incorp/sauce@<this version> mcp`:

```sh
npx sauce mcp setup                                # every agent below
npx sauce mcp setup --agent claude,cursor          # only these
npx sauce mcp setup --config rpc.json              # launch it with --config
```

| Agent                    | File                    | Under                 | Documentation                                                                     |
| ------------------------ | ----------------------- | --------------------- | --------------------------------------------------------------------------------- |
| Claude Code              | `.mcp.json`             | `mcpServers`          | [MCP](https://code.claude.com/docs/en/mcp)                                        |
| OpenAI Codex             | `.codex/config.toml`    | `[mcp_servers.sauce]` | [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)                      |
| Cursor                   | `.cursor/mcp.json`      | `mcpServers`          | [MCP](https://cursor.com/docs/mcp)                                                |
| GitHub Copilot (VS Code) | `.vscode/mcp.json`      | `servers`             | [MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) |
| Gemini CLI               | `.gemini/settings.json` | `mcpServers`          | [MCP servers](https://geminicli.com/docs/tools/mcp-server/)                       |

How setup treats files that already exist:

- It keeps everything else in a file.
- It writes nothing when the entry is already there.
- It leaves a `sauce` entry that differs alone, unless you pass `--force`.
- It leaves a file that is not plain JSON (one with comments) alone too, and prints the entry to
  add.

Each agent asks before it runs a server a project names:

- Claude Code asks you to approve a project server.
- Codex reads `.codex/config.toml` only in a project it trusts.
- VS Code applies Workspace Trust.
- Gemini CLI, with its Trusted Folders setting on, ignores an untrusted folder's settings.

Or add it by hand, with each agent's own command, per its documentation:

```sh
claude mcp add --scope project sauce -- npx -y @eco-incorp/sauce mcp
codex mcp add sauce -- npx -y @eco-incorp/sauce mcp
copilot mcp add sauce -- npx -y @eco-incorp/sauce mcp
```

`codex mcp add` and `copilot mcp add` (the Copilot CLI) write the user's configuration, not the
project's. Cursor has no add command, so write `.cursor/mcp.json`. The entry, for a stdio server:

```json
{
  "mcpServers": {
    "sauce": { "type": "stdio", "command": "npx", "args": ["-y", "@eco-incorp/sauce", "mcp"] }
  }
}
```

```toml
[mcp_servers.sauce]
command = "npx"
args = ["-y", "@eco-incorp/sauce", "mcp"]
```

VS Code's `.vscode/mcp.json` has the same entry under `servers`. Gemini CLI's
`.gemini/settings.json` has it under `mcpServers`, without `type`. An agent can also ask the
server itself: `sauce_install_skills` returns these for the agent it names.

### A remote server

For a server someone runs at `https://<host>/mcp`, behind a token:

```sh
claude mcp add --transport http sauce https://<host>/mcp --header "Authorization: Bearer <token>"
codex mcp add sauce --url https://<host>/mcp --bearer-token-env-var SAUCE_MCP_TOKEN
copilot mcp add --transport http --header "Authorization: Bearer <token>" sauce https://<host>/mcp
```

The same in each agent's file:

- **Claude Code:** `{ "type": "http", "url": …, "headers": { … } }` in `.mcp.json`.
- **Cursor:** `{ "url": …, "headers": { "Authorization": "Bearer ${env:SAUCE_MCP_TOKEN}" } }`.
- **VS Code:** `{ "type": "http", "url": …, "headers": { … } }` under `servers`.
- **Gemini CLI:** `{ "httpUrl": …, "headers": { … } }`. Its `url` means SSE, which this server
  does not serve.

## Tools

Each tool is the `sauce` command named beside it, called with the same inputs: the server calls the
very functions the command does. Each returns its JSON as the tool's structured content, with the
same JSON as text. Where there are `notes`, they say what must be true for a transaction to land.

| Tool                   | Like             | Returns                                                                                                                                          |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sauce_skills`         | —                | Every agent skill with when to use it, and the package version                                                                                   |
| `sauce_skill`          | —                | One skill's `SKILL.md`, or a file under its `references/` or `examples/`                                                                         |
| `sauce_dev`            | —                | For TypeScript against the SDK: the TypeScript skill and the package's guides, API pages and examples for a topic or a question                  |
| `sauce_install_skills` | `sauce skills`   | For one agent: the commands that install, update and check the latest skills, where it reads them, and its MCP configuration                     |
| `sauce_chains`         | —                | Every chain: slug, id, name, kind, aliases, and whether the server has its own endpoint for it                                                   |
| `sauce_globals`        | `sauce globals`  | The chain's token symbols, protocol namespaces and contracts (with `protocol`, its methods), chain names, defines and `@sauce/token` functions   |
| `sauce_price`          | `sauce price`    | A pair's price as the pool's `sqrtPriceX96` (also the swap's limit) and each direction's `minAvgPrice`, or a `sqrtPriceX96` read back as a price |
| `sauce_compile`        | `sauce compile`  | `bytecode`, `size`, `entryParams`, `entryEncoding`, `entrySchema`, the `defines` given, `compiler`, `engine`, and on Solana the `manifest`       |
| `sauce_actions`        | —                | An action program (JSON) as its generated `source`, `compile` (as `sauce_compile`), and, given a Pot, the unsigned cook `transaction`            |
| `sauce_tx`             | `sauce tx`       | EVM `{ chainId, to, data, value }`, the cook on the Pot; Solana `{ chain, feePayer, pot, fee, transaction }`, base64 and signed by no one        |
| `sauce_pot`            | `sauce pot`      | The Pot's address, its unsigned deployment (EVM `Kitchen.deployPot`; Solana `create_pot`), and `deployed` (null with no endpoint)                |
| `sauce_simulate`       | `sauce simulate` | `ok`, the `path` taken, gas, what `main` returns, transfers, approvals and net balance changes; or the `stage` and `reason` it reverts           |
| `sauce_publish`        | `sauce publish`  | Each fixed intent's `intentHash` and its unsigned `transactions` (reward approvals, `Portal.publishAndFund`); with `dryRun`, their status        |
| `sauce_inspect`        | `sauce inspect`  | A cook, Kitchen, Portal or ERC-20 call, or a program, taken apart; with `source`, the arguments decoded against `main`                           |
| `sauce_verify`         | `sauce verify`   | `valid` with the settle's tokens, `minOut` and recipient, or `valid: false` with the rejection `code`                                            |

A revert and a rejected settle are results (`ok: false`, `valid: false`), not errors. An error is a
call that could not be answered: a program that does not compile, an input that is wrong, a chain
that cannot be read. Every input is described in the tool's schema, which `tools/list` returns. An
unknown field is refused, which is how a misspelt one is caught.

The compiling tools take the program as text:

| Input                                                   | Meaning                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `source`                                                | The program, the whole text of a `.sauce.ts` file (at most 256 KiB)                                                                |
| `file`                                                  | Its name, for messages and relative imports (default `program.sauce.ts`)                                                           |
| `modules`                                               | Files it imports by relative path, as path → text from the directory of `file`. Nothing is read from the server's disk             |
| `chain`, `target`                                       | The chain, by slug, alias or id; or a `// @chain` header line in the program. `target: "svm"` alone is Solana                      |
| `defines`                                               | Compile-time values by name: an integer in base units (decimal or `0x` hex), an address, `true` or `false`; a base58 key on Solana |
| `compactArgs`                                           | Encode `main`'s arguments as compact-v1                                                                                            |
| `intentDeadline`, `intentCreator`, `intentExecutionFee` | For intents the program opens: Unix seconds, a `0x` address, wei                                                                   |

A cook (`sauce_tx`, `sauce_simulate`, `sauce_actions`) adds these inputs:

- the Pot: `owner` and `salt` (a label, hashed) or `saltHex` (the salt itself). On an EVM chain the
  Pot can be named by its address as `pot` instead.
- `value` in wei, on an EVM chain. The default is the Kitchen's fee, read from the chain.
- `args`: `main`'s arguments as JSON values, in order. Integers are in base units, as decimal
  strings.
- `accounts`, on Solana: each account `main` takes, by name. Each is an address, `pot` or `owner`.
- `rpcUrl`.

`sauce_simulate` also takes:

- `assumeBalance`, such as `["USDC:2", "ETH:0.1"]`: balances the Pot holds for the rehearsal only;
- `fund`, `fundMode` and `sweep`, which rehearse [`sauce run --fund`](cli.md#funding-a-run---fund).
  The Pot is credited what the pulls would bring.

A token amount is whole units (`USDC:1.5`) or base units ending in `n` (`USDC:1500000n`).
`sauce_publish` takes `from` (the wallet that funds the reward), `dryRun`, `assumeBalance` and
`rpcUrl`. `sauce_actions` takes the document as `program`, an object or its JSON text, validated
against the [action-program schema](../../actions/action-program.schema.json), also served as
`sauce://actions/schema.json`. It lowers the document with the same function the `sauce` command
does, then compiles it.

Error messages are the `sauce` command's, so they name its flags. Each flag is the tool input of
the same name in camelCase (`--salt-hex` is `saltHex`), and `--args` and `--args-json` are `args`.
A message that names a flag says so.

### Signing what it builds

The server's transactions are for the user's own wallet. On an EVM chain, `sauce_tx` returns what
any wallet signs. Send it from the Pot's owner, since `cook()` is the owner's alone. From a terminal:

```sh
cast send <to> <data> --value <value> --rpc-url <url> --keystore <keystore>
```

The other transactions:

- `sauce_pot`'s deployment can be sent from any account.
- `sauce_publish`'s transactions go in order, from the wallet that funds the reward.
- On Solana, `sauce_tx`'s `transaction` is base64, for the owner to sign and send. Its blockhash
  expires in about a minute.

## Skills, documents and prompts

The [agent skills](cli.md#agent-skills) the package ships are the same files `sauce skills install`
copies into a project. They are served two ways, because many clients call tools but never read
resources:

- as tools. `sauce_skills` lists them. `sauce_skill` returns a `SKILL.md`, or a file it links, by
  skill and path; only shipped files are served. `sauce_dev` returns the TypeScript skill and the
  package's own guides, API pages and examples for a topic or a free-text question.
  `sauce_install_skills` says how to install the latest skills locally for an agent.
- as resources. `sauce://skills/index` lists every skill and its files.
  `sauce://skills/<skill>/SKILL.md` is a skill, and its `references/…` and `examples/…` sit beside
  it.

When a client connects, the server's instructions tell it three things: the server never signs,
start from `sauce_skills`, and how `rpcUrl` works. Two prompts walk the main tasks through the
tools, with the skill they start from embedded:

- `sauce_write_program` (`task`, `chain`) writes, compiles, rehearses and builds a program.
- `sauce_open_intent` (`task`, `source`, `destination`) opens a cross-chain intent and builds its
  publish transactions.

## Self-hosting

```sh
npx -y @eco-incorp/sauce mcp --http 3000 --config rpc.json
```

This serves Streamable HTTP at `http://127.0.0.1:3000/mcp`. The server is stateless: every POST
gets a server of its own, answered as JSON, with no session, so any replica can answer any request.
A GET or DELETE is refused (405).

- **No environment, and no key.** The server reads no environment variable. Its RPC endpoints are
  the `--config` file's alone, and it holds no key: nothing it builds is signed.
- **It authenticates no one.** Bound to loopback, the default, it answers only requests whose
  `Host`, and `Origin` when one is sent, is a loopback name. That keeps a web page from reaching it
  through DNS rebinding.
- **Off loopback it needs `--allowed-host`.** For a deployment others reach, bind it with `--host`
  and name the host it is served as with `--allowed-host` (repeatable). It refuses to start
  without one. `--allowed-host '*'` answers any `Host`, for a proxy that checks it itself.
- **Put your own authentication in front.** Use a reverse proxy that checks a token (or OAuth)
  before forwarding to it, and that rate-limits, since every chain read spends your endpoints'
  quota.

```sh
npx -y @eco-incorp/sauce mcp --http 3000 --host 0.0.0.0 --allowed-host mcp.example.com \
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

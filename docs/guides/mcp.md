# The Sauce MCP server

[Documentation](../README.md) · [The sauce command](cli.md) · [Agent skills](cli.md#agent-skills)

`@eco-incorp/sauce` installs a second command, `sauce-mcp`: a [Model Context
Protocol](https://modelcontextprotocol.io) server that gives a coding agent the read-only half of
the [`sauce` command](cli.md) as tools, and the package's agent skills as resources. It compiles
programs, lists a chain's names, builds the unsigned cook, the Pot's deployment and an intent's
publish transactions, rehearses a cook, and takes calls apart.

**It never signs, and never asks for a key.** Every transaction comes back unsigned, for a wallet
the user holds. That is what lets the server run anywhere: on the agent's machine over stdio, or
on a remote host over Streamable HTTP, while transactions are signed and sent by local means — a
wallet, `cast send`, or `sauce run` with the user's own keystore.

## Run it

```sh
npm install @eco-incorp/sauce
npx sauce-mcp --help
```

Node.js 24 or newer. An agent launches the server itself, over stdio:

```sh
npx sauce-mcp                              # in a project that depends on the package
npx -y -p @eco-incorp/sauce sauce-mcp      # anywhere, without one
npx sauce-mcp --config sauce.config.json   # with RPC endpoints (below)
```

Over stdio it writes nothing but the protocol to stdout. A message larger than `--max-body`
(2 MiB by default) closes the connection.

## Endpoints

The server ships no RPC URL and reads no environment variable. The chains it reads come from
`--config <file>`, the [`sauce` command's format](cli.md#endpoints-and-signers):

```json
{ "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
```

The file is checked when the server starts, so a malformed one, or a `<…>` placeholder left in it,
stops it there rather than failing a tool call later. No tool result, error or log line ever
contains a URL from it, nor its path: provider URLs carry keys, and on a remote server the file is
the operator's. `sauce_chains` says which chains have an endpoint.

Without `--config` every tool that needs a chain says so plainly, naming the chain and the entry it
would need. What still works with no endpoint: compiling, the chain's names, the EVM cook (given
its `value`), the Pot's address and deployment, an intent's publish transactions, and taking
calldata apart. What needs one: `sauce_simulate`, a publish dry run, anything given a transaction
hash, a Solana cook (its blockhash and fee), and reading the Kitchen's fee or whether a Pot exists.

## Add it to a coding agent

`sauce-mcp setup` writes the project configuration each agent documents, with the server launched
as `npx -y -p @eco-incorp/sauce@<this version> sauce-mcp`:

```sh
npx sauce-mcp setup                                # every agent below
npx sauce-mcp setup --agent claude,cursor          # only these
npx sauce-mcp setup --config sauce.config.json     # launch it with --config
```

| Agent                    | File                    | Under                 | Documentation                                                                     |
| ------------------------ | ----------------------- | --------------------- | --------------------------------------------------------------------------------- |
| Claude Code              | `.mcp.json`             | `mcpServers`          | [MCP](https://code.claude.com/docs/en/mcp)                                        |
| OpenAI Codex             | `.codex/config.toml`    | `[mcp_servers.sauce]` | [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)                      |
| Cursor                   | `.cursor/mcp.json`      | `mcpServers`          | [MCP](https://cursor.com/docs/mcp)                                                |
| GitHub Copilot (VS Code) | `.vscode/mcp.json`      | `servers`             | [MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) |
| Gemini CLI               | `.gemini/settings.json` | `mcpServers`          | [MCP servers](https://geminicli.com/docs/tools/mcp-server/)                       |

It keeps everything else in a file, writes nothing when the entry is already there, and leaves a
`sauce` entry that differs alone unless you pass `--force`. A file that is not plain JSON (one with
comments) is left alone too, with the entry to add printed instead. Each agent asks before it runs a
server a project names: Claude Code asks you to approve a project server, Codex reads
`.codex/config.toml` only in a project it trusts, VS Code applies Workspace Trust, and Gemini CLI,
with its Trusted Folders setting on, ignores an untrusted folder's settings.

Or add it by hand. Each agent's own command, per its documentation:

```sh
claude mcp add --scope project sauce -- npx -y -p @eco-incorp/sauce sauce-mcp
codex mcp add sauce -- npx -y -p @eco-incorp/sauce sauce-mcp
copilot mcp add sauce -- npx -y -p @eco-incorp/sauce sauce-mcp
```

`codex mcp add` and `copilot mcp add` (the Copilot CLI) write the user's configuration, not the
project's. Cursor has no add command: write `.cursor/mcp.json`. The shapes, for a stdio server:

```json
{
  "mcpServers": {
    "sauce": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "@eco-incorp/sauce", "sauce-mcp"]
    }
  }
}
```

```toml
[mcp_servers.sauce]
command = "npx"
args = ["-y", "-p", "@eco-incorp/sauce", "sauce-mcp"]
```

VS Code's `.vscode/mcp.json` has the same entry under `servers`, and Gemini CLI's
`.gemini/settings.json` under `mcpServers`, without `type`.

### A remote server

For a server someone else runs at `https://<host>/mcp`, behind a token:

```sh
claude mcp add --transport http sauce https://<host>/mcp --header "Authorization: Bearer <token>"
codex mcp add sauce --url https://<host>/mcp --bearer-token-env-var SAUCE_MCP_TOKEN
copilot mcp add --transport http --header "Authorization: Bearer <token>" sauce https://<host>/mcp
```

In the files: Claude Code `{ "type": "http", "url": …, "headers": { … } }` in `.mcp.json`; Cursor
`{ "url": …, "headers": { "Authorization": "Bearer ${env:SAUCE_MCP_TOKEN}" } }`; VS Code
`{ "type": "http", "url": …, "headers": { … } }` under `servers`; Gemini CLI
`{ "httpUrl": …, "headers": { … } }` (its `url` means SSE, which this server does not serve).

## Tools

Each tool is the `sauce` command named beside it, called with the same inputs — the server calls
the very functions the command does — and returns its JSON as the tool's structured content, with
the same JSON as text. `notes`, where there are any, are what must be true for a transaction to
land.

| Tool             | Like             | Returns                                                                                                                                                                    |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sauce_chains`   | —                | Every chain: slug, id, name, kind, aliases, and whether this server has an endpoint for it                                                                                 |
| `sauce_globals`  | `sauce globals`  | The chain's token symbols, protocol namespaces and contracts (with `protocol`, its methods), chain names, defines and `@sauce/token` functions                             |
| `sauce_price`    | `sauce price`    | A pair's price as the pool's `sqrtPriceX96` (also the swap's limit) and each direction's `minAvgPrice`; or a `sqrtPriceX96` read back as a price                           |
| `sauce_compile`  | `sauce compile`  | `bytecode`, `size`, `entryParams`, `entryEncoding`, `entrySchema` (with `compactArgs`), the `defines` given, `compiler`, `engine`, and on Solana the account `manifest`    |
| `sauce_tx`       | `sauce tx`       | EVM `{ chainId, to, data, value }`, the cook on the Pot; Solana `{ chain, feePayer, pot, fee, transaction }`, base64 and signed by no one                                  |
| `sauce_pot`      | `sauce pot`      | The Pot's address and its unsigned deployment (EVM `Kitchen.deployPot` `{ to, data, value }`; Solana the `create_pot` instruction), and `deployed` (null with no endpoint) |
| `sauce_simulate` | `sauce simulate` | `ok`, the `path` it took, gas, what `main` returns, the transfers and approvals, native transfers and net balance changes; or the `stage` and `reason` it reverts          |
| `sauce_publish`  | `sauce publish`  | Each fixed intent's `intentHash` and its `transactions`: the reward approvals and `Portal.publishAndFund`, unsigned; or with `dryRun`, each one's rehearsed status         |
| `sauce_inspect`  | `sauce inspect`  | A cook, Kitchen, Portal or ERC-20 call, or a program, taken apart; with `source`, the arguments decoded against `main`                                                     |
| `sauce_verify`   | `sauce verify`   | `valid` with the settle's tokens, `minOut` and recipient, or `valid: false` with the rejection `code`                                                                      |

A revert and a rejected settle are results (`ok: false`, `valid: false`), not errors. An error is
a call that could not be answered: a program that does not compile, an input that is wrong, a chain
the server cannot read. Every input is described in the tool's schema, which `tools/list` returns;
an unknown field is refused, which is how a misspelt one is caught.

The compiling tools take the program as text:

| Input                                                   | Meaning                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `source`                                                | The program, the whole text of a `.sauce.ts` file (at most 256 KiB)                                                  |
| `file`                                                  | Its name, for messages and relative imports (default `program.sauce.ts`)                                             |
| `modules`                                               | Files it imports by relative path, by path from the same directory as `file`. Nothing is read from the server's disk |
| `chain`, `target`                                       | The chain, by slug, alias or id; or a `// @chain` header line in the program. `target: "svm"` alone is Solana        |
| `defines`                                               | Compile-time values by name: an address, an integer (decimal or `0x` hex, a string past 2^53), `true` or `false`     |
| `compactArgs`                                           | Encode `main`'s arguments as compact-v1                                                                              |
| `intentDeadline`, `intentCreator`, `intentExecutionFee` | For intents the program opens                                                                                        |

A cook (`sauce_tx`, `sauce_simulate`) adds the Pot and `main`'s arguments: `owner` and `salt` (a
label, hashed) or `saltHex` (the salt itself), or on an EVM chain the Pot's address as `pot`;
`value` in wei on an EVM chain (default: the Kitchen's fee, read from the chain); `args`, `main`'s
arguments as JSON values in order; and on Solana `accounts`, each account `main` takes by name — an
address, `pot` or `owner`. `sauce_simulate` also takes `assumeBalance` (`["USDC:2", "ETH:0.1"]`:
balances the Pot holds for the rehearsal only), and `fund`, `fundMode` and `sweep`, which rehearse
[`sauce run --fund`](cli.md#funding-a-run---fund) with the Pot credited what the pulls would bring.
`sauce_publish` takes `from` (the wallet that funds the reward), `dryRun` and `assumeBalance`.

Error messages are the `sauce` command's, so they name its flags: each is the tool input of the same
name in camelCase (`--salt-hex` is `saltHex`), and `--args` and `--args-json` are `args`. Such a
message says so.

### Signing what it builds

The server's transactions are for the user's own wallet. On an EVM chain, `sauce_tx` returns what
any wallet signs; from a terminal:

```sh
cast send <to> <data> --value <value> --rpc-url <url> --keystore <keystore>
```

sent from the Pot's owner, since `cook()` is the owner's alone. `sauce_pot`'s deployment can be sent
from any account, `sauce_publish`'s transactions in order from the wallet that funds the reward. On
Solana, `sauce_tx`'s `transaction` is base64, for the owner to sign and send; its blockhash expires
in about a minute.

## Resources and prompts

The [agent skills](cli.md#agent-skills) the package ships are resources, read from the package as
they are — the same files `sauce skills install` copies into a project:

- `sauce://skills/index`: every skill, what it is for, and its files. Read it first.
- `sauce://skills/<skill>/SKILL.md`, named after the skill and described by its frontmatter.
- `sauce://skills/<skill>/references/…` and `sauce://skills/<skill>/examples/…`: the files a
  `SKILL.md` links, at the path it links them by.

The server's instructions, sent when a client connects, say that it never signs and to read the
index before writing a program. Two prompts walk the main tasks through the tools, with the skill
they start from embedded: `sauce_write_program` (`task`, `chain`) writes, compiles, rehearses and
builds a program; `sauce_open_intent` (`task`, `source`, `destination`) opens a cross-chain intent
and builds its publish transactions.

## Serving it remotely

```sh
npx sauce-mcp --http 3000 --config sauce.config.json
```

serves Streamable HTTP at `http://127.0.0.1:3000/mcp`. It is stateless: every POST gets a server of
its own, answered as JSON, with no session, so any replica can answer any request. A GET or DELETE
is refused (405).

**It authenticates no one.** Bound to loopback — the default — it answers only requests whose
`Host`, and `Origin` when one is sent, is a loopback name, which keeps a web page from reaching it
through DNS rebinding. A deployment others reach goes behind your own authentication: a reverse
proxy that checks a token (or OAuth) before it forwards to the server, and that rate-limits, since
every chain read spends your endpoints' quota. Bind it with `--host`, and name the host it is served
as with `--allowed-host` (repeatable), so it still refuses any other:

```sh
npx sauce-mcp --http 3000 --host 0.0.0.0 --allowed-host mcp.example.com --config sauce.config.json
```

Without `--allowed-host`, a server bound beyond loopback answers any `Host`, and says so when it
starts. A request body over `--max-body` bytes (2 MiB by default) is refused with 413 before it is
read, and each tool bounds its own inputs besides: 256 KiB of program, 32 modules, 64 arguments,
defines or accounts, 1 MiB of hex.

# The Sauce MCP server

[Documentation](../README.md) · [The sauce command](cli.md) · [Agent skills](skills.md)

`sauce mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server. A coding agent
gets the building half of the [`sauce` command](cli.md) as tools, and the package's agent skills
as tools and resources. The server compiles programs and action documents and lists a chain's
names. It builds unsigned transactions: the cook, the Pot's deployment, an intent's publish
transactions and each step of its life after. It also rehearses a cook and takes calls apart.

## Quick start

You don't run the server yourself. Your coding agent starts it on your machine, as `sauce mcp`,
from its MCP configuration, whenever it needs it. Install the command once (Node.js 24 or newer):

```sh
npm i -g @eco-incorp/sauce
sauce runtime install
```

`npm i -g @eco-incorp/sauce@latest` upgrades it. The server's own packages, the MCP SDK and zod, are
not part of that install: `sauce runtime install` puts them in `~/.sauce/runtime/` once per version,
so an agent's first start of the server does not wait for them
([Runtime packages](cli.md#runtime-packages)). Then add the server to your agent.

### Claude Code

```sh
claude mcp add sauce -- sauce mcp
```

This adds it for you, in the current project (stored in `~/.claude.json`). Add `--scope user`
before `sauce` for every project. `--scope project` writes `.mcp.json` in the project root instead,
to share through version control; Claude Code asks each person to approve a project's server.

### OpenAI Codex

```sh
codex mcp add sauce -- sauce mcp
```

This adds it to `~/.codex/config.toml`, for every project. A project Codex trusts can carry the
same entry in its own `.codex/config.toml`:

```toml
[mcp_servers.sauce]
command = "sauce"
args = ["mcp"]
```

### Gemini CLI

```sh
gemini mcp add sauce sauce mcp
```

This writes the project's `.gemini/settings.json`; `--scope user` after `add` writes
`~/.gemini/settings.json`, for every folder. With its Trusted Folders setting on, Gemini CLI ignores
an untrusted folder's settings.

### Claude Desktop

Open Settings, then Developer, then Edit Config. That opens `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server under `mcpServers`, keeping any others there, then quit Claude Desktop and start it
again:

```json
{
  "mcpServers": {
    "sauce": { "command": "sauce", "args": ["mcp"] }
  }
}
```

### Cursor

The same `mcpServers` entry, in `.cursor/mcp.json` in the project or `~/.cursor/mcp.json` for every
project.

### VS Code (GitHub Copilot)

```sh
code --add-mcp "{\"name\":\"sauce\",\"command\":\"sauce\",\"args\":[\"mcp\"]}"
```

This adds it to your user profile. For one workspace, put it in `.vscode/mcp.json`, under
`servers`:

```json
{
  "servers": {
    "sauce": { "type": "stdio", "command": "sauce", "args": ["mcp"] }
  }
}
```

### Every project file at once

```sh
sauce mcp setup
```

This writes the project file of each agent above that reads one (`.mcp.json`, `.codex/config.toml`,
`.cursor/mcp.json`, `.vscode/mcp.json` and `.gemini/settings.json`), pinned to the version that
wrote it, so the files work on any machine that clones the project
([Project files](#project-files)).

### Check it worked

- **Claude Code:** `claude mcp list` lists `sauce` as connected; inside a session, `/mcp`. A project
  server stays pending until you approve it in a session.
- **OpenAI Codex:** `codex mcp list`; in a session, `/mcp`.
- **Gemini CLI:** `gemini mcp list` lists `sauce` as connected; in a session, `/mcp`.
- **Claude Desktop:** the "+" button in the message box, then Connectors, lists `sauce`.
- **VS Code:** the MCP: List Servers command shows its status.
- **Any agent:** ask it to list the `sauce_` tools. It names `sauce_compile`, `sauce_globals`,
  `sauce_tx` and the rest.

**If a desktop client cannot start it.** A desktop or GUI client may not see your shell's `PATH`,
so it may not find a `sauce` installed under nvm or another version manager. Give it the absolute
path `which sauce` prints as the command, or let it run the package with no install: command `npx`,
args `["-y", "@eco-incorp/sauce", "mcp"]`.

### No configuration needed

The server reads each chain through built-in public endpoints, so there is nothing to configure.
Your own endpoint is optional and faster ([Your own endpoints](#your-own-endpoints)).

## Chains and signing

For the initial release the server builds transactions only on **Ethereum**, **Base** and
**Solana**. Every other chain is a [preview chain](#supported-and-preview-chains): an agent can
compile, simulate and rehearse any protocol on it, and the tools that would return a transaction
there return `refused` instead, with how to request the chain.

**The local stdio server signs only with wallets in its wallet directory, unlocked by the password
source it was started with; the HTTP server never signs.** Neither ever asks for a key or a
password. Without [agent wallets](#agent-wallets), every transaction comes back unsigned, for a
wallet the user holds. That lets the server run anywhere: on the agent's machine over stdio, or on
a host of your own over Streamable HTTP. Transactions it does not send are signed and sent by local
means: a wallet, `cast send`, or `sauce run` with the user's own keystore.

## The command

```sh
sauce mcp                                                  # stdio: what an agent launches
sauce mcp --wallets --password-env SAUCE_WALLET_PASSWORD   # stdio, signing
sauce mcp --http 3000                                      # self-hosted, Streamable HTTP
```

`sauce mcp --help` lists every flag. The server is loaded only when `sauce mcp` runs, so no other
command pays for it.

Over stdio the server writes nothing but the protocol to stdout. A message larger than `--max-body`
(2 MiB by default) closes the connection.

### A newer version

The server prints no update notice. Instead, the first tool result of its life carries one note, in
`notes` and in the result's text, when the `sauce` command's update cache names a newer release
([The update notice](cli.md#the-update-notice)): which version is out, which one the server runs,
and how to move to it. `sauce_skills` returns that version as `latest`, beside the `version` the
server runs, on every call. `sauce update` updates the command, or says how for the way it was
installed. A project's MCP entry pins its version, so
`npx -y @eco-incorp/sauce@latest mcp setup --force` rewrites it. The new version serves once the
agent restarts the server.

The server reads that cache when it starts, and refreshes a cache a day old the way the command
does, in a process of its own, so neither starting nor answering waits for the registry. Over HTTP
the note is said once for the process, in whichever request is first. `--no-update-check`, or
`"updateCheck": false` in the `--config` file, turns it off.

## Endpoints

A tool that reads a chain needs no endpoint from you or the server's operator: it reads the chain
through a built-in public endpoint — one to three keyless ones per chain, the next taking over when
one cannot be reached, refuses, rate-limits or fails — and a result read that way says so in its
`notes`. Public endpoints can be slow or rate-limited. Kava, ZetaChain and Evmos have none.

### Your own endpoints

Optional, and faster. A tool takes **`rpcUrl`**, an endpoint for that one call, and looks for an
endpoint in this order:

1. the call's own `rpcUrl`;
2. the server's endpoint for the chain, from `--config <file>` (the
   [`sauce` command's format](cli.md#your-own-endpoints)):

   ```json
   { "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
   ```

3. the built-in public endpoint for the chain, unless the server was started with `--offline`;
4. if none has one, a plain error naming the chain and saying to pass `rpcUrl`.

The server reads no environment variable. `sauce mcp --offline` reaches no network of its own: no
public endpoint, and no install of its packages, which must already be in place.

A provider URL usually carries a key, so no URL of yours is ever returned, logged or quoted, from
the call or from the file. That covers results and errors, including an upstream error that
repeats the URL. The file's path is never shown either. The file is checked when the server
starts: a malformed entry, a `<…>` placeholder or a URL that is not http(s) stops it there.
`sauce_chains` says where the server reads each chain: `config`, `public` or `none`.

**A server someone else runs sees every `rpcUrl` you pass it.** Pass only keys you are willing to
share with its operator. Otherwise run the server yourself with `sauce mcp`,
where your URL never leaves your machine.

On a chain the server cannot read — no `rpcUrl`, no `--config` entry, no public endpoint — this
still works:

- compiling a program or an action document;
- a chain's names and a price conversion;
- the EVM cook, given its `value`, on a supported chain;
- the Pot's address, and on a supported chain its deployment and an intent's publish transactions;
- taking calldata apart, and reading the skills.

What needs an endpoint: `sauce_simulate`, a publish dry run, anything given a transaction hash, a
Solana cook (its blockhash and fee), and reading the Kitchen's fee or whether a Pot exists.

## Project files

`sauce mcp setup` writes the project configuration each agent documents. The server it configures
is launched as `npx -y @eco-incorp/sauce@<this version> mcp`, not as `sauce mcp`: a project file is
shared, so it names no command a machine has to have installed, and it runs the version whose skills
the project installed.

```sh
sauce mcp setup                         # every agent below
sauce mcp setup --agent claude,cursor   # only these
sauce mcp setup --config rpc.json       # launch it with your own endpoints
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

The GitHub Copilot CLI adds the server to its user configuration with
`copilot mcp add sauce -- sauce mcp`. An agent can also ask the server itself:
`sauce_install_skills` returns the commands and the entry for the agent it names.

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

| Tool                   | Like                   | Returns                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sauce_skills`         | —                      | Every agent skill with when to use it and its files' sizes, the package version, and `latest` when a newer one is published                                                                                                                                                                                                    |
| `sauce_skill`          | —                      | One skill's `SKILL.md`, or a file under its `references/` or `examples/`; with `section` or `query`, only that part                                                                                                                                                                                                            |
| `sauce_dev`            | —                      | For TypeScript against the SDK: the TypeScript skill and the package's guides, API pages and examples for a topic or a question                                                                                                                                                                                                |
| `sauce_install_skills` | `sauce skills`         | For one agent, pinned to the server's version: the commands that add the package and install, update and check the skills, where it reads them, and its MCP configuration                                                                                                                                                      |
| `sauce_chains`         | —                      | Every chain: slug, id, name, kind, aliases, `support` (`supported` or `preview`) and where the server reads it (`endpoint`: `config`, `public` or `none`); `supported`, the supported slugs; `requestChain`, the chain-support request form                                                                                    |
| `sauce_globals`        | `sauce globals`        | The chain's token symbols, protocol namespaces and contracts (with `protocol`, its methods), chain names, defines and `@sauce/token` functions; `stocks` and `search` for its tokenized stocks, 200 tokens a page (`offset`)                                                                                                   |
| `sauce_price`          | `sauce price`          | A pair's price as the pool's `sqrtPriceX96` (also the swap's limit) and, each direction, the distributed swap's `maxPrice` and `maxAvgPrice` (input per output) and a single swap's `minAvgPrice` (output per input); from `price`, `sqrtPriceX96` or a `pool` read now; with `slippageBps`, the `limits`                      |
| `sauce_pools`          | `sauce pools`          | A pair's price-limit pools on the chain at one `block`, deepest first: venue, contract, address or V4 key, fee, liquidity, `sqrtPriceX96`, and each direction's price before and with the fee, the distributed swap's `maxPrice` and the depth to a 1% move; `empty`, the pools with no liquidity                              |
| `sauce_compile`        | `sauce compile`        | `bytecode`, `size`, `entryParams`, `entryEncoding`, `entrySchema`, each define it reads and where it came from, the `contracts` it calls, `compiler`, `engine`, on Solana the `manifest`; with `args` the `payload`, and with `rpcUrls` each intent's Pot checked                                                              |
| `sauce_actions`        | `sauce actions`        | An actions document (JSON) compiled for a chain: `sauce_compile`'s report with the generated `source`, its `parameters` and bindings, and, given a Pot, the unsigned cook `transaction` (on a preview chain, `refused` instead)                                                                                                |
| `sauce_tx`             | `sauce tx`             | EVM `{ chainId, to, data, value }`, the cook on the Pot, with `from` (who signs) and the `kitchenFee` read — or, while the Pot has no code, `{ chainId, pot, transactions }`, its deployment then the cook; Solana `{ chain, via, feePayer, pot, fee, maxExecutionFee, createsPot, transaction }`, base64 and signed by no one |
| `sauce_pot`            | `sauce pot`            | The Pot's address, its unsigned deployment (EVM `Kitchen.deployPot`; Solana `create_pot`; on a preview chain, `refused` instead), `deployed` (null with no endpoint), and with an endpoint what it holds and the Kitchen's fee                                                                                                 |
| `sauce_simulate`       | `sauce simulate`       | `ok`, then `leftInPot` (what the Pot holds after the cook of what it moved, with a note when that is anything), the `path` taken, each transaction's gas (`transactions`), what `main` returns, `moves` by role, transfers, approvals and net balance changes; or the `stage` and `reason` it reverts                          |
| `sauce_intent_publish` | `sauce intent publish` | The unsigned cook on `owner`'s Pot that publishes the program's intents, as `sauce_tx` builds it; with `dryRun`, the cook rehearsed, as `sauce_simulate` does, and each intent it publishes: its `intentHash`, `destination` and `record` (what the other intent tools take)                                                   |
| `sauce_intent_fill`    | `sauce intent fill`    | For the solver `from`, its unsigned fill on the destination: approvals, then `fulfillAndProve` (the prover's fee in its value) or `fulfill`; with `dryRun`, the fill rehearsed: the calls and gas, what moved, or the decoded `reason`                                                                                         |
| `sauce_intent_import`  | `sauce intent import`  | The intents a source transaction published, each its `record`, vault, block, whether it was funded, and the transaction's `explorer` and `trace` links                                                                                                                                                                         |
| `sauce_intent_status`  | `sauce intent status`  | `state`, both sides as read, the deadlines, the prover, and `can`: whether fill, prove, claim, refund and cancel can happen now, why not, and from when                                                                                                                                                                        |
| `sauce_intent_prove`   | `sauce intent prove`   | The unsigned `Portal.prove` for one or more fills or cancellations, its bridge fee in its value                                                                                                                                                                                                                                |
| `sauce_intent_claim`   | `sauce intent claim`   | The unsigned `withdraw` (`batchWithdraw` for several) that pays each proven intent's claimant                                                                                                                                                                                                                                  |
| `sauce_intent_refund`  | `sauce intent refund`  | The unsigned `refund` that returns the reward to its creator                                                                                                                                                                                                                                                                   |
| `sauce_intent_cancel`  | `sauce intent cancel`  | The unsigned `cancel` (or, with `prove`, `cancelAndProve`) that stops an unfilled intent after its route's deadline                                                                                                                                                                                                            |
| `sauce_inspect`        | `sauce inspect`        | A cook, Kitchen, Portal or ERC-20 call, or a program, taken apart; with `source`, the arguments decoded against `main`                                                                                                                                                                                                         |
| `sauce_verify`         | `sauce verify`         | `valid` with the settle's tokens, `minOut` and recipient, or `valid: false` with the rejection `code`                                                                                                                                                                                                                          |
| `sauce_wallet_create`  | `sauce wallet new`     | Over stdio with `--wallets` only: a new wallet's `name`, `kind` (`evm` or `solana`), `address` and `policy` (null: none), never its key                                                                                                                                                                                        |
| `sauce_wallet_list`    | `sauce wallet list`    | Over stdio with `--wallets` only: each wallet's name, kind, address and policy                                                                                                                                                                                                                                                 |
| `sauce_wallet_send`    | —                      | Over stdio with `--wallets` only: another tool's result (or a transaction, or a list) rehearsed, held to the wallet's policy, signed and sent; each one's `hash`, `status`, `explorer` and `trace`, and for a cook `moves`, `leftInPot` and `summary`; or the refusal                                                          |

### The command's flags as inputs

A skill or a note may name a `sauce` command line. `sauce <command>` is the tool
`sauce_<command>` (`sauce intent status` is `sauce_intent_status`); a program file is `source`, its
text, or over stdio `path`, the file; every result is the command's `--json`; and a tool that reads
several chains takes `rpcUrls`, one endpoint per chain. Each flag is the input beside it, as the
server's instructions also list:

| Flag                       | Input                  |
| -------------------------- | ---------------------- |
| `--args`, `--args-json`    | `args`                 |
| `--assume-balance`         | `assumeBalance`        |
| `--fund-mode`              | `fundMode`             |
| `--fund`                   | `fund`                 |
| `--sweep`                  | `sweep`                |
| `--salt-hex`               | `saltHex`              |
| `--salt`                   | `salt`                 |
| `--owner`                  | `owner`                |
| `--pot`                    | `pot`                  |
| `--value`                  | `value`                |
| `--account`, `--accounts`  | `accounts`             |
| `--intent-deadline`        | `intentDeadline`       |
| `--intent-execution-fee`   | `intentExecutionFee`   |
| `--intent-fund-via`        | `intentFundVia`        |
| `--intent-reward-deadline` | `intentRewardDeadline` |
| `--intent-prover`          | `intentProver`         |
| `--intent-salt`            | `intentSalt`           |
| `--no-prove`               | `prove: false`         |
| `--max-execution-fee`      | `maxExecutionFee`      |
| `--lookup-table`           | `lookupTables`         |
| `--via`                    | `via`                  |
| `--compact-args`           | `compactArgs`          |
| `--chain`                  | `chain`                |
| `--target`                 | `target`               |
| `--rpc-url`                | `rpcUrl`               |
| `--block`                  | `block`                |
| `--from`, `--solver`       | `from`                 |
| `--claimant`               | `claimant`             |
| `--dry-run`                | `dryRun`               |
| `--pin`                    | `pins`                 |
| `--engine`                 | `engines`              |
| `--min-out`                | `minOut`               |
| `--spl-count`              | `splCount`             |
| `--protocol`               | `protocol`             |
| `--stocks`                 | `stocks`               |
| `--search`                 | `search`               |
| `--sqrt-price-x96`         | `sqrtPriceX96`         |
| `--pool`                   | `pool`                 |
| `--v4-key`                 | `v4Pools`              |
| `--pay`                    | `pay`                  |
| `--max-price`              | `maxPrice`             |
| `--per-venue`              | `perVenue`             |
| `--slots`                  | `slots`                |
| `--expect-revert`          | `expectRevert`         |

Over stdio, `sauce_compile`, `sauce_simulate` and `sauce_tx` take `path` instead of `source`: a
program file on the same machine, relative to the directory the server runs in, read with its
relative imports beside it. A server over HTTP reads no file and refuses `path`. Each of the three
returns `sourceSha256`, the sha256 of the program's text, which ties a rehearsal to the file it
came from. `sauce_compile` with `omitBytecode` leaves the bytecode out; `sauce_simulate` with
`scenarios` rehearses one program with several sets of `args` and `assumeBalance` at one
block, and with `summary` returns only `ok` or the revert reason, what `main` returned,
`leftInPot`, the balance changes, the transfers, each transaction's gas and the block. A rehearsal
that leaves anything in the Pot adds a note saying so, for the agent to pass on to the user: what
stays in the Pot is not in the owner's wallet
([Where a program's results end](../concepts/kitchen-pot-cook.md#where-a-programs-results-end)).

### Supported and preview chains

For the initial release the server builds transactions only on the chains the release supports:
Ethereum, Base and Solana. Every other chain is a preview chain; [Chains](../reference/chains.md) has
the policy and every chain. `sauce_chains` gives each chain's `support`, `"supported"` or
`"preview"`.

On a preview chain these work as they do everywhere: `sauce_compile`, `sauce_actions`' report,
`sauce_simulate`, `sauce_globals`, `sauce_price`, `sauce_pools`, `sauce_inspect`, `sauce_verify`,
the dry runs (`sauce_intent_publish` and `sauce_intent_fill` with `dryRun`), `sauce_pot`'s
prediction and reads, `sauce_intent_status` and `sauce_intent_import`. So an agent can prototype
any protocol on any chain.

These are refused there, before any endpoint is reached:

- `sauce_tx`, when the program's chain, or the destination of any intent it opens, is a preview
  chain;
- `sauce_intent_publish` without `dryRun`, unless its source and every destination it opens are
  supported (a cascade's later levels are not checked: keep them on supported chains);
- `sauce_intent_fill` without `dryRun`, `sauce_intent_prove` and `sauce_intent_cancel`, by the
  intent's destination; `sauce_intent_claim` and `sauce_intent_refund`, by its source. An intent
  named by `txHash` is read from its source first, then refused by its destination where that is
  the chain the step is sent on.

A refused call is an error result (`isError: true`) whose structured content is the refusal, also
given as its text:

```json
{
  "refused": {
    "code": "preview-chain",
    "action": "building the cook transaction",
    "message": "building the cook transaction is refused: it involves arbitrum (Arbitrum One, chain id 42161), a preview chain. …",
    "supportedChains": [
      { "slug": "ethereum", "id": 1, "name": "Ethereum" },
      { "slug": "base", "id": 8453, "name": "Base" },
      { "slug": "solana", "id": 1399811149, "name": "Solana" }
    ],
    "previewChains": [
      {
        "slug": "arbitrum",
        "id": 42161,
        "name": "Arbitrum One",
        "request": {
          "chain": { "name": "Arbitrum One", "id": 42161, "slug": "arbitrum" },
          "title": "Chain support: Arbitrum One (42161)",
          "searchUrl": "https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Arbitrum+One%22",
          "newIssueUrl": "https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Arbitrum+One+%2842161%29&chain=Arbitrum+One&chain-id=42161",
          "body": "### Chain\n\nArbitrum One\n\n### Chain id\n\n42161\n\n### What you want to run there\n\n…",
          "comment": "Another use case for Arbitrum One (42161):\n\n- What you want to run there: …"
        }
      }
    ]
  }
}
```

`searchUrl` finds the chain-support requests already filed for the chain; `newIssueUrl` opens the
issue form with its title and chain filled in. `body` is the issue as the form would write it, and
`comment` adds one use case to an existing request, each with `<placeholders>` for what the agent
does not know, to post through the user's own GitHub access. The server's instructions tell an
agent to tell the user, offer to find or open that request, and not to build the transaction
another way.

`sauce_pot` on a preview chain returns its prediction (and, with an endpoint, its reads) with
`refused` in place of the deployment's `to`, `data` and `value`. `sauce_actions` given a Pot on a
preview chain returns its report with `refused` in place of `transaction`. Neither is an error.

A revert and a rejected settle are results (`ok: false`, `valid: false`), not errors. An error is a
call that could not be answered: a program that does not compile, an input that is wrong, a chain
that cannot be read. Every input is described in the tool's schema, which `tools/list` returns. An
unknown field is refused, which is how a misspelt one is caught.

The compiling tools take the program as text:

| Input                                  | Meaning                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `source`                               | The program, the whole text of a `.sauce.ts` file (at most 256 KiB)                                                    |
| `file`                                 | Its name, for messages and relative imports (default `program.sauce.ts`)                                               |
| `modules`                              | Files it imports by relative path, as path → text from the directory of `file`. Nothing is read from the server's disk |
| `chain`, `target`                      | The chain, by slug, alias or id; or a `// @chain` header line in the program. `target: "svm"` alone is Solana          |
| `compactArgs`                          | Encode `main`'s arguments as compact-v1                                                                                |
| `intentDeadline`, `intentExecutionFee` | For intents the program opens: Unix seconds, wei                                                                       |
| `intentFundVia`                        | How their reward reaches the vault: `transfer` (default: paid into it, then `publish`) or `publishAndFund`             |

`sauce_compile` also takes a cook's `args` and `accounts`, to size the payload and, on Solana, the
cook's transaction (with `via`, the Kitchen's or the engine's direct one); and `rpcUrls`, each intent destination's endpoint by chain, to check that the
Pot an intent's cook runs on is deployed there.

A cook (`sauce_tx`, `sauce_simulate`, `sauce_actions`) adds these inputs:

- the Pot: `owner` and `salt` (a label, hashed) or `saltHex` (the salt itself). On an EVM chain the
  Pot can be named by its address as `pot` instead.
- `value` in wei, on an EVM chain. The default is the Kitchen's fee, read from the chain.
- `args`: `main`'s arguments as JSON values, in order. Integers are in base units, as decimal
  strings.
- `accounts`, on Solana: each account `main` takes, by name. Each is an address, `pot` or `owner`.
- `via`, on Solana: `kitchen` (the default), the Kitchen's cook on the owner's Pot, or `engine`,
  the engine's own paid cook with no Kitchen and no Pot: the owner signs as the authority the
  program acts with and pays the fee, and the program's own calls get one more level of CPI depth
  ([Solana guide](solana.md#two-ways-to-run-a-program)).
- `maxExecutionFee` in lamports, on Solana: a cook whose execution fee, read from the cluster, is
  above it is refused before anything is built.
- `lookupTables`, on Solana: address lookup tables holding the cook's accounts, each one byte in the
  transaction instead of 32.
- `rpcUrl`.

`sauce_simulate` also takes:

- `assumeBalance`, such as `["USDC:2", "ETH:0.1"]`: balances the Pot holds for the rehearsal only.
  On Solana, as for a cook too large for one transaction, the rehearsal then runs in a local copy
  of the accounts the cook names ([the sauce command](cli.md#solana)), its program staged as
  `sauce run` stages it;
- `fund`, `fundMode` and `sweep`, which rehearse [`sauce run --fund`](cli.md#funding-a-run---fund).
  The Pot is credited what the pulls would bring.

A token amount is in whole tokens: `USDC:1.5` is 1.5 USDC, exact through the token's decimals, and
`USDC:1500000` is 1.5 million USDC, which the result's `notes` point out. For base units, end it in
`n`, as a JavaScript bigint is written: `USDC:1500000n` is 1.5 USDC.

`sauce_pot` reads what a cook needs: on an EVM chain the Kitchen's fee (the least
a cook's `value` can be) and the Pot's balance of the native currency and of each token the chain
registers but its tokenized stocks (`null` where a token cannot be read there); on Solana the Pot's
associated token account for each registered mint but the tokenized stocks, whether it exists, and
its balance. `balances: false` skips those reads.

`sauce_price` takes the price one of three ways: `price` (a decimal), `sqrtPriceX96`, or `pool`, a
Uniswap V3-style pool of the pair read through an endpoint (its `slot0` price, liquidity and fee).
With `slippageBps`, `limits` gives each direction's `sqrtPriceLimitX96` that far from the price,
and a `minAvgPrice` that also pays the pool's fee (`feePpm`, or the pool's own). A token the chain
does not register is `<address>:<decimals>`, or the address alone: its decimals are read from the
token.

`sauce_pools` takes `chain`, `tokenA` and `tokenB` (each a registered symbol or an address, whose
decimals and symbol are then read from the token), `v4Pools` (more hookless Uniswap V4 keys to
try, each `"<fee>:<tickSpacing>"`), and `rpcUrl`. It returns what
[`sauce pools --json`](cli.md#sauce-pools) prints: `pools`, the ones with liquidity, deepest first,
each with two `sides` (paying `tokenA` for `tokenB`, then the reverse); `empty`; and `checked`,
the tiers, tick spacings and keys each venue was asked for.

`sauce_intent_publish` takes `owner` (whose Pot publishes, with `salt` to name another of theirs),
`dryRun`, `fund` and `assumeBalance` (with `dryRun`), `value`, `rpcUrl`, `args`, and the program
inputs, `intentFundVia` among them. The program inputs also take the
reward's deadline and prover: `intentRewardDeadline`
(Unix seconds; the intent's deadline by default) and `intentProver` (the registry's for the pair by
default).

### An intent's life

The server keeps no intents: each call names one, by its `record` — the JSON
`sauce_intent_publish`, `sauce_intent_import` and `sauce_intent_status` return, checked against its
own hash before anything is built from it — or by the transaction that published it, `txHash` with
its source `chain` (and `index` when it published several). With `dryRun`, `sauce_intent_fill`
also takes the program itself, with the same inputs as `sauce_intent_publish`, as a preview: its
intents are rebuilt by a rehearsal, so their hashes are not the ones a wallet publishes.

1. `sauce_intent_publish`: with `dryRun`, each intent's `record`, read from the rehearsal's log;
   without, the unsigned cook on the creator's Pot. Once it lands, `sauce_intent_import` with its
   `txHash` reads the records from the receipt, as it does for an intent published elsewhere.
2. `sauce_intent_status`: where it stands, and `can`, what can happen next and from when.
3. `sauce_intent_fill` with `from`, the solver: its transactions on the destination. With `dryRun`,
   the same fill rehearsed, from any solver. A fill that proves itself (`fulfillAndProve`) needs no
   step 4.
4. `sauce_intent_prove`: the proof of fills or cancellations, sent from the destination; the
   bridge delivers it to the source's prover.
5. `sauce_intent_claim`: the reward paid to each proven fill's claimant, on the source.

The creator's way back:

- `sauce_intent_refund` returns the reward from the reward's deadline when no one proved a fill, or
  earlier once a proven cancellation is recorded on the source. A source Portal that cannot refuse
  to pay a cancellation is never refunded early.
- `sauce_intent_cancel` stops an unfilled intent after its route's deadline. Anyone may send it,
  and only a destination Portal that can cancel takes it. Prove the cancellation with
  `sauce_intent_prove` once the block it landed in is final (give that block in `cancelledIn`), then
  refund. `prove: true` sends the proof at once, before finality, and the result warns.

For an intent to Solana, the destination's steps — fill, prove and cancel — come back as Solana
transactions: `feePayer` and `transaction`, a base64 wire transaction with every signature in but
the fee payer's. Pass the Solana key that pays and signs as `from`; a fill also needs `claimant`,
the address on the EVM source the reward pays. Sign each with that key, last, and send it within
about a minute, before its blockhash expires. `dryRun` rehearses an EVM destination's fill only;
a Solana fill is rehearsed as it is built. Claim and refund stay on the EVM source.

A step that cannot happen yet is a result, `ready: false` with `why`, not an error. Each tool reads
the chains it needs through the server's endpoints, or through `rpcUrls`, each chain's endpoint by
slug or id; `rpcUrl` is the endpoint of the chain the tool names (the source for import, claim and
refund, the destination for fill, prove and cancel). The server's endpoints fill the gaps.

`sauce_actions` takes the document as `program`, an object or its JSON text, validated against the
[action-program schema](../../actions/action-program.schema.json), also served as
`sauce://actions/schema.json`, and `chain` for a document without a `chainId`. It calls the
function `sauce actions` runs, so its names (tokens by symbol, contracts by namespace) resolve on
that chain as they do for the command.

Error messages and notes are the `sauce` command's, in the tools' words: a flag is named as the
tool input (`--salt-hex` as `saltHex`, `--args` as `args`), and a command line as the tool
(`sauce pot --deploy …` as `sauce_pot`).

### Signing what it builds

The server's transactions are for the user's own wallet, or, on a server started with
`--wallets`, for [`sauce_wallet_send`](#agent-wallets). On an EVM chain, `sauce_tx` returns what
any wallet signs. Send it from the Pot's owner, since `cook()` is the owner's alone. From a terminal:

```sh
cast send <to> <data> --value <value> --rpc-url <url> --keystore <keystore>
```

A Pot with no code yet needs no step of its own: `sauce_tx` returns its deployment as the first
entry of `transactions` (marked `deploysPot`), with a note, then the cook. Send them in that order:
any account may send the first, only the owner the second. `sauce_wallet_send` sends such a plan
whole, rehearsing both together and holding them to the wallet's policy before it sends either. On
Solana the same transaction creates the Pot ahead of the cook (`createsPot`).

A program that sends a remote message to another chain (`@sauce/remote`) needs the owner's Pot
there ready first. `sauce_tx` reads it and lists what is missing ahead of the cook, each entry with
that chain's `chainId`: the Pot's deployment, the bridge's receiver installed by an owner's cook,
and the Kitchen's fee for each message and each answer's quoted fee sent to the Pot (`quoted` says
how much of it is quoted). `sauce_wallet_send` sends a plan on several chains chain by chain, in its
order, each chain's part rehearsed and held to the policy on that chain, and stops at the first that
fails.

The other transactions:

- `sauce_pot`'s deployment, by hand, can be sent from any account.
- `sauce_intent_publish`'s cook goes from the Pot's owner, whose Pot must hold the reward when it
  lands: it pays each reward into its vault and publishes the intent.
- `sauce_intent_fill`'s go in order from the solver it names (`from`): the Portal pulls what the
  route delivers from the account that calls `fulfill`.
- On Solana, each transaction is signed last by its `feePayer`, the `from` the call named.
- The proof, claim, refund and cancellation can be sent from any account. Each `transactions`
  entry names its `chainId`; the sender pays the gas and the value, and the reward goes to the
  claimant or the creator, never the sender.
- On Solana, `sauce_tx`'s `transaction` is base64, for the owner to sign and send. Its blockhash
  expires in about a minute.

## Agent wallets

Over stdio, the server can send what it builds, from wallets of its own. Start it with the wallet
directory, `--wallets [<dir>]` (`~/.sauce/wallets` when no directory is given), and the source of
their password, as [`sauce wallet`](cli.md#agent-wallets) takes one: `--password-env <NAME>`,
`--password-file <path>` or `--password-command "<command>"`. There is no prompt: over stdio,
stdin is the protocol's. The server reads the password once, before it serves anything, so a
source that does not work stops it at start. The password is never a tool's input and never in a
result, so it stays out of the model's context.

The agent's password lives in its `.env` or its secret store, and the client's configuration passes
it to the server in the entry's `env` block, by reference, never by value:

```json
{
  "mcpServers": {
    "sauce": {
      "type": "stdio",
      "command": "sauce",
      "args": ["mcp", "--wallets", "--password-env", "SAUCE_WALLET_PASSWORD"],
      "env": { "SAUCE_WALLET_PASSWORD": "${SAUCE_WALLET_PASSWORD}" }
    }
  }
}
```

Each client fills that reference its own way: Claude Code expands `${SAUCE_WALLET_PASSWORD}` from
the environment it runs in, and VS Code also reads an `envFile` (the project's `.env`). Keep the
`.env` out of git.

The wallet tools, besides every other tool:

- `sauce_wallet_create` `{ name, kind }` makes a wallet (`kind` `evm`, the default, or `solana`),
  encrypted under the server's password (8 characters at least, as for `sauce wallet new`), and
  returns its address. Its key never leaves the wallet's file except to sign, in the server's
  process.
- `sauce_wallet_list` names each wallet with its kind, address and policy.
- `sauce_wallet_send` `{ wallet, transaction, chain?, rpcUrl? }` sends. `transaction` is the
  whole result of `sauce_tx`, `sauce_pot`, `sauce_actions` (with an owner), `sauce_intent_publish`
  or any `sauce_intent_*` step, or a transaction, or a list of them. It rehearses them first: on an
  EVM chain all together in one `eth_simulateV1` block from the wallet, on Solana each as signed.
  If any would revert, it refuses and sends nothing. It holds them to the wallet's
  [policy](cli.md#a-wallets-policy) and refuses, naming the limit, what the policy does not allow.
  Then it sends each in order, through the same path `sauce run` uses, and stops at the first that
  does not succeed. A plan on several chains is sent the same way chain by chain, in its order;
  each entry it returns names its `chain`. It returns each one's `hash` (on Solana, its signature) and `status`, with
  `explorer` and `trace` beside it: the chain's explorer page and the transaction's trace on
  BlockSec's Phalcon explorer (calls, balance changes and fund flow), links for the user to open.
  For a cook on an EVM chain it adds what its receipt shows: `moves`, in order and by role,
  `leftInPot`, and `summary`, the lines `sauce run` prints.

So an agent goes: `sauce_wallet_create`, fund the address, build with the wallet's address as
`owner` or `from` (`sauce_pot`, `sauce_tx`, `sauce_intent_fill`, …), rehearse with
`sauce_simulate`, and pass the building tool's result to `sauce_wallet_send`. Each tool that builds
a transaction says, on a server with wallets, that `sauce_wallet_send` sends it. There is no export
tool: `sauce wallet export` shows a key only at a terminal.

These are hot wallets: keep small balances in them, and give each a policy. Wallet sends hold to
the [supported chains](#supported-and-preview-chains) too. Over HTTP there are no wallets:
`--wallets` is refused, and the wallet tools are not registered.

## Skills, documents and prompts

The [agent skills](skills.md) the package ships are the same files `sauce skills install`
copies into a project. They are served two ways, because many clients call tools but never read
resources:

- as tools. `sauce_skills` lists them. `sauce_skill` returns a `SKILL.md`, or a file it links, by
  skill and path; only shipped files are served. `sauce_dev` returns the TypeScript skill and the
  package's own guides, API pages and examples for a topic or a free-text question.
  `sauce_install_skills` says how to install the skills locally for an agent, at the server's
  own version.
- as resources. `sauce://skills/index` lists every skill and its files.
  `sauce://skills/<skill>/SKILL.md` is a skill, and its `references/…` and `examples/…` sit beside
  it.

When a client connects, the server's instructions tell it five things: whether the server signs
(only with its wallets, over stdio with `--wallets`), start from `sauce_skills`, the steps from `sauce_globals` to `sauce_tx`, which chains it builds
transactions on and what to do with a refusal, and how `rpcUrl` works. Two prompts walk the main tasks through the
tools, with the skill they start from embedded:

- `sauce_write_program` (`task`, `chain`) writes, compiles, rehearses and builds a program.
- `sauce_open_intent` (`task`, `source`, `destination`) opens a cross-chain intent and builds its
  publish transactions.

## Self-hosting

```sh
sauce mcp --http 3000
```

This serves Streamable HTTP at `http://127.0.0.1:3000/mcp`. The server is stateless: every POST
gets a server of its own, answered as JSON, with no session, so any replica can answer any request.
A GET or DELETE is refused (405).

- **No environment, and no key.** The server reads no environment variable. Its RPC endpoints are
  the `--config` file's, and the built-in public ones for a chain the file does not name; it holds
  no key: nothing it builds is signed. `--wallets` is
  refused over HTTP, and the wallet tools are not registered there.
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

# The MCP server

**How-to guide** · [Documentation](../README.md) · [Tools](mcp-tools.md) · [What a local server keeps](mcp-local.md)

> A coding agent, such as Claude Code, Codex or Cursor, can use Sauce for you. `sauce mcp` is a
> plugin that gives the agent Sauce's commands as tools: compile a program, try it, build the
> transaction. It runs on your computer, and your agent starts it whenever it needs it.

The server speaks the [Model Context Protocol](https://modelcontextprotocol.io), which coding agents
use to call tools. Through it an agent gets the `sauce` command's building half, compile, simulate
and build transactions, and the package's agent skills, which teach it to write Sauce programs.

## Set it up

You don't run the server yourself. Your coding agent starts it on your computer, as `sauce mcp`,
whenever it needs it. Install the command once (Node.js 24 or newer):

```sh
npm i -g @eco-incorp/sauce
sauce runtime install
```

`sauce runtime install` installs the server's own packages once, so your agent's first start does
not wait for them. Then add the server to your agent.

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

That is all: the server reads each chain through built-in public endpoints, so there is nothing to
configure. Your own endpoint is optional, and faster ([Your own endpoints](#your-own-endpoints)).

## What your agent gets

- **The tools.** Compile a program, simulate it, build its transaction, publish and follow an
  intent, look up a chain's names and pools, take a transaction apart: each is the `sauce` command
  of the same name. [Tools](mcp-tools.md) lists them.
- **The skills.** The package's agent skills, as tools and resources, so the agent learns to write
  Sauce programs ([Agent skills](skills.md)).
- **Transactions for your wallet to sign.** Everything comes back unsigned, ready for your
  wallet's own MCP server, such as Coinbase's or Phantom's, to sign as it is:
  [Sign with your wallet's MCP server](wallet-mcp.md).
- **Wallets for trying things out.** On your computer the server can also keep wallets for your
  agent and send from them, under a spending limit. They are handy for experiments with small
  amounts: [What a local server keeps](mcp-local.md).

It builds transactions on **Ethereum**, **Base** and **Solana**. On every other chain an agent can
still compile and simulate, and a tool that would build a transaction says so instead.

The server can also run for a team, over HTTP, on a host of your own. It then never signs and keeps
nothing: [Self-hosting over HTTP](mcp-http.md).

## Details

### The command

```sh
sauce mcp                                       # stdio: what an agent launches, with its wallets
sauce mcp --password-env SAUCE_WALLET_PASSWORD  # stdio, its wallets enabled from the start
sauce mcp --no-wallets                          # stdio, with no wallet: nothing signs
sauce mcp --no-stores                           # stdio, keeping nothing on disk: no wallet, no Pot store
sauce mcp --http 3000                           # self-hosted, Streamable HTTP
```

`sauce mcp --help` lists every flag ([Command reference](../reference/cli.md#sauce-mcp)). The server is loaded only when `sauce mcp` runs, so no other
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

### Endpoints

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

### Project files

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

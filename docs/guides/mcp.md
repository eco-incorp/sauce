# The MCP server

**How-to guide** · [Documentation](../README.md) · [Tools](mcp-tools.md) · [What a local server keeps](mcp-local.md)

> A coding agent, such as Claude Code, Codex or Cursor, can use Sauce for you. `sauce mcp` is a
> plugin that gives the agent Sauce's commands as tools: compile a program, try it, build the
> transaction. It runs on your computer, and your agent starts it whenever it needs it.

This page adds the server to your agent and covers what you may change afterwards: endpoints,
project files and updates. It needs the `sauce` command, from the [Quick start](quick-start.md).
For a first session, step by step, follow [Your first agent session](agent-quick-start.md).

The server speaks the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), which
coding agents use to call tools. An agent gets the `sauce` command's building half through it:
compile, simulate and build transactions. It also gets the package's agent skills, which teach it
to write Sauce programs.

## Add the server to your agent

You don't run the server yourself. Your coding agent starts it on your computer, as `sauce mcp`,
whenever it needs it. Install the command once (Node.js 24 or newer):

```sh
npm i -g @eco-incorp/sauce
sauce runtime install
```

`sauce runtime install` is optional. The server loads two packages, the MCP SDK and `zod`, which
its first start installs otherwise; installing them now means your agent's first start does not
wait ([Runtime packages](cli.md#runtime-packages)). Then add the server to your agent.

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

The GitHub Copilot CLI adds it to its user configuration with `copilot mcp add sauce -- sauce mcp`.

### Check it worked

- **Claude Code:** `claude mcp list` lists `sauce` as connected; inside a session, `/mcp`. A project
  server stays pending until you approve it in a session.
- **OpenAI Codex:** `codex mcp list`; in a session, `/mcp`.
- **Gemini CLI:** `gemini mcp list` lists `sauce` as connected; in a session, `/mcp`.
- **Claude Desktop:** the "+" button in the message box, then Connectors, lists `sauce`.
- **VS Code:** the MCP: List Servers command shows its status.
- **Any agent:** ask it to list the `sauce_` tools. It names `sauce_compile`, `sauce_globals`,
  `sauce_tx` and the rest, 25 in all.

**If a desktop client cannot start it.** A desktop or GUI client may not see your shell's `PATH`,
so it may not find a `sauce` installed under nvm or another version manager. Give it the absolute
path `which sauce` prints as the command, or let it run the package with no install: command `npx`,
args `["-y", "@eco-incorp/sauce", "mcp"]`.

That is all: the server reads each chain through built-in public endpoints, so there is nothing to
configure. Your own endpoint is optional, and faster ([Use your own endpoints](#use-your-own-endpoints)).

## What your agent gets

- **The tools.** Compile a program, simulate it, build its transaction, look up a chain's names and
  pools, take a transaction apart: each is the `sauce` command of the same name.
  [Tools](mcp-tools.md) lists them.
- **The skills.** The package's agent skills, as tools and resources, so the agent learns to write
  Sauce programs ([Agent skills](skills.md)).
- **Transactions for your wallet to sign.** Everything comes back unsigned, ready for your
  wallet's own MCP server, such as Coinbase's or Phantom's, to sign as it is:
  [Sign with your wallet's MCP server](wallet-mcp.md).
- **Wallets for trying things out.** On your computer the server can also keep wallets for your
  agent and send from them, each under a policy, a spending limit you set. They are handy for
  experiments with small amounts: [What a local server keeps](mcp-local.md).

It builds transactions only on the supported chains. On a preview chain it compiles and reads, but
it cannot simulate there, and it refuses to build ([Supported and preview chains](mcp-tools.md#supported-and-preview-chains)).

## Share the setup with your project

```sh
sauce mcp setup
```

This writes the project file of each agent that reads one, so the setup travels with the project
through version control. The server it configures is launched as
`npx -y @eco-incorp/sauce@<this version> mcp`, not as `sauce mcp`: a project file is shared, so it
names no command a machine has to have installed, and it runs the version whose skills the project
installed.

```sh
sauce mcp setup                         # every agent below
sauce mcp setup --agent claude,cursor   # only these
sauce mcp setup --config rpc.json       # launch it with your own endpoints
```

### Project files

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

An agent can also ask the server itself: `sauce_install_skills` returns the commands and the entry
for the agent it names.

## Use your own endpoints

A tool that reads a chain needs no endpoint from you. It reads the chain through a built-in public
endpoint: one to three keyless ones per chain, the next taking over when one cannot be reached,
refuses, rate-limits or fails. A result read that way says so in its `notes`. Public endpoints can
be slow or rate-limited, and Kava, ZetaChain and Evmos have none.

Your own endpoint is optional, and faster. Give the server a file of endpoints when it starts, in
the [`sauce` command's format](cli.md#your-own-endpoints):

```json
{ "rpcUrls": { "1": "https://…", "8453": "https://…", "1399811149": "https://…" } }
```

```sh
sauce mcp --config rpc.json
```

In an agent's configuration that is `"args": ["mcp", "--config", "rpc.json"]`. A tool also takes
**`rpcUrl`**, an endpoint for that one call. The server looks for an endpoint in this order:

1. the call's own `rpcUrl`;
2. the server's endpoint for the chain, from `--config <file>`;
3. the built-in public endpoint for the chain, unless the server was started with `--offline`;
4. if none has one, a plain error naming the chain and saying to pass `rpcUrl`.

`sauce_chains` says where the server reads each chain: `config`, `public` or `none`. The server
reads no environment variable. `sauce mcp --offline` reaches no network of its own: no public
endpoint, and no install of its packages, which must already be in place.

A provider URL usually carries a key, so no URL of yours is ever returned, logged or quoted, from
the call or from the file. That covers results and errors, including an upstream error that
repeats the URL. The file's path is never shown either. The file is checked when the server
starts: a malformed entry, a `<…>` placeholder or a URL that is not http(s) stops it there.

**A server someone else runs sees every `rpcUrl` you pass it.** Pass only keys you are willing to
share with its operator. Otherwise run the server yourself with `sauce mcp`, where your URL never
leaves your machine.

[What needs an endpoint](mcp-tools.md#what-needs-an-endpoint) lists which tools work on a chain the
server cannot read.

## Keep it up to date

### A newer version

The server prints no update notice. Instead, the first tool result of its life carries one note, in
`notes` and in the result's text, when the `sauce` command's update cache names a newer release
([The update notice](upgrading.md#the-update-notice)): which version is out, which one the server runs,
and how to move to it. `sauce_skills` returns that version as `latest`, beside the `version` the
server runs, on every call.

To move to it:

1. `sauce update` updates the command, or says how for the way it was installed.
2. A project's MCP entry pins its version, so `npx -y @eco-incorp/sauce@latest mcp setup --force`
   rewrites it.
3. Restart the server from your agent (in most agents, restart the session). The new version serves
   from then on.

The server reads that cache when it starts, and refreshes a cache a day old the way the command
does, in a process of its own, so neither starting nor answering waits for the registry. Over HTTP
the note is said once for the process, in whichever request is first. `--no-update-check`, or
`"updateCheck": false` in the `--config` file, turns it off. [Upgrading](upgrading.md) covers the
skills and the rest of a project.

## Run it for a team

The server can also run on a host of your own, over HTTP, for a whole team. It then never signs and
keeps nothing: [Self-hosting over HTTP](mcp-http.md) runs it. To use a server someone else runs,
add it by its address and token as
[Connect an agent to it](mcp-http.md#connect-an-agent-to-it) shows.

The default is [stdio](../concepts/glossary.md#coding-agents): the agent starts the server and
talks to it through its standard input and output. Over stdio the server writes nothing but the
protocol to stdout, and a message larger than `--max-body` (2 MiB by default) closes the
connection. Every flag is in the
[command reference](../reference/cli.md#sauce-mcp).

## Next

- A first session, step by step: [Your first agent session](agent-quick-start.md).
- Every tool, its inputs and what it returns: [The MCP server's tools](mcp-tools.md).
- Sign what the server builds with a wallet that keeps its key: [Sign with your wallet's MCP server](wallet-mcp.md).

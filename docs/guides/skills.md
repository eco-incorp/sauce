# Agent skills

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [The MCP server](mcp.md)

> Agent skills are handbooks written for coding agents, not for people. Put them in your project and
> your agent learns to write and run Sauce programs. This manual is the people's version of the same
> ground.

This page is for you if a coding agent works in your project. It needs the `sauce` command
([Install](cli.md#install)). Once the skills are installed, your agent can write a Sauce program for
a task, look up a chain's tokens and protocols by name, compile and simulate the program, and build
the transaction for you to sign, all without you pasting documentation into the chat.

The package ships agent skills: directories in the
[Agent Skills](https://agentskills.io/specification) format, each a `SKILL.md` with the examples and
references it links, that teach a coding agent to write Sauce programs and run them. They are
written for the agent; this manual is written for you. Parts are shared word for word: the chains,
tokens and protocols in the [reference](../reference/chains.md) are rendered from the same
registries, by the same generator, as the skills' own references, and the
[SauceScript reference](../reference/saucescript.md) is the `sauce-script` skill's.

Each stands alone. An agent with only the skills, served by the MCP server with nothing installed,
finds every fact it needs in them, and nothing in this manual sends you into a skill's files. Each
fact has one owning skill, which the others point to, and every skill has the same shape: when to
load it, its model, its body, the mistakes to avoid, and its files.

## The skills

| Skill                           | What it teaches the agent                                                                                                                                         | The same ground in this manual                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sauce-overview`                | Start here: what Sauce is, the Pot, the cook and the Kitchen, how to work with a user, the rules, which chains take transactions, and the map of the other skills | [What Sauce is](../concepts/what-is-sauce.md), [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md), [Architecture](../concepts/architecture.md)          |
| `sauce-script`                  | The language: program forms, the header, values, calling contracts, helpers, failure, gas, compile errors, and every type, statement and builtin                  | [SauceScript](../concepts/saucescript.md), [SauceScript reference](../reference/saucescript.md)                                                               |
| `sauce-globals`                 | The names a program uses with no import: token symbols and their methods, tokenized stocks, `Token(address)`, protocol namespaces, `available(...)`               | [Names and registries](../concepts/names-and-registries.md), [Protocols and tokens](protocols-and-tokens.md), [Tokens](../reference/tokens.md)                |
| `sauce-chains`                  | What each chain makes of the names, every chain's facts and addresses, and the Sauce deployment, in one file                                                      | [Chains](../reference/chains.md)                                                                                                                              |
| `sauce-protocols`               | Choosing and calling a protocol: every protocol by category, its deployments and names in a program, its ABI and its pitfalls                                     | [Protocols](../reference/protocols.md)                                                                                                                        |
| `sauce-swaps`                   | Swapping with `@sauce/router` on EVM chains and Solana: one function per venue, price limits and partial fills, how each venue is paid                            | [`@sauce/router`](../api/router.md)                                                                                                                           |
| `sauce-distributed-swap`        | One exact-input order over several price-limited pools on an EVM chain: the method, its arithmetic, and the program                                               | [`sauce pools`](cli-lookup.md#a-pairs-pools-sauce-pools) and [`sauce price`](cli-lookup.md#prices-for-a-swap-sauce-price), which give it its pools and limits |
| `sauce-solana-distributed-swap` | The same limit order on Solana: pools found by key in loops over the keys, every venue whose swap stops at a price limit, what fits in one cook                   | [The distributed swap on Solana](solana-distributed-swap.md), [`sauce pools`](cli-lookup.md#a-pairs-pools-sauce-pools)                                        |
| `sauce-intents`                 | Cross-chain intents: the intent file, publishing and funding, every step after, cascades, and simulating both sides                                               | [Cross-chain intents](../concepts/cross-chain-intents.md), [Create an intent](intents.md), [Nested intents](nested-intents.md)                                |
| `sauce-solana`                  | Everything Solana changes: accounts and their roles, derived accounts, SPL Token and Token-2022, transaction size, running                                        | [How Sauce runs on Solana](../concepts/solana-model.md), [Solana](solana.md)                                                                                  |
| `sauce-actions`                 | A program as a JSON actions document: swaps, bridges, wraps, staking, lending and token moves as data                                                             | [Actions](actions.md)                                                                                                                                         |
| `sauce-cli`                     | The `sauce` command: endpoints, signers and wallets, the run in order, transactions for other signers, and each command's MCP tool                                | [The sauce command](cli.md)                                                                                                                                   |
| `sauce-typescript`              | The same from application code: compiling, arguments, cooks, Pots, the raw compiler, actions, verification, Solana, testing                                       | [Sauce from TypeScript](typescript-quick-start.md), [API reference](../api/README.md), [Compiling programs](compiling.md)                                     |
| `sauce-examples`                | The cookbook of complete programs, and an index of every example in every skill with the chains each is checked on                                                | [Examples](../examples/README.md)                                                                                                                             |

## Install them in a project

`sauce skills install` copies the skills of the `sauce` command that runs it to where coding agents
read them, in the project it runs in (`--dir <project>` names another):

```sh
npm i -g @eco-incorp/sauce
sauce skills install
```

That writes `.claude/skills/` and `.agents/skills/`, which between them reach the five agents below.
Check it worked: `sauce skills status` reports each directory as up to date. Then ask your agent
what Sauce skills it has; it names `sauce-overview` and the rest.

In a project that pins the package, `npx sauce skills install` installs that version's skills, and a
global `sauce skills status` there reports skills installed from another version than its own
([Install](cli.md#install)). `sauce init my-app` scaffolds a new project and installs them in it.

### Pick the agents

Each agent reads skills from these directories, per its vendor's documentation:

| Agent          | Reads project skills from                                         | Documentation                                                                                                                 |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Claude Code    | `.claude/skills/`, and nothing under `.agents/`                   | [Skills](https://code.claude.com/docs/en/skills), [memory](https://code.claude.com/docs/en/memory)                            |
| OpenAI Codex   | `.agents/skills/`, from the working directory up to the repo root | [Build skills](https://learn.chatgpt.com/docs/build-skills)                                                                   |
| Cursor         | `.agents/skills/`, `.cursor/skills/`, and `.claude/skills/` too   | [Skills](https://cursor.com/docs/skills)                                                                                      |
| GitHub Copilot | `.github/skills/`, `.claude/skills/` or `.agents/skills/`         | [Add skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) |
| Gemini CLI     | `.gemini/skills/`, or its `.agents/skills/` alias (which wins)    | [Skills](https://geminicli.com/docs/cli/skills/)                                                                              |

So two directories reach all five natively: `.claude/skills/` for Claude Code and `.agents/skills/`
for the other four. Those two are what `sauce skills install` writes by default, and what
`--agent all` means. `--agent claude`, `codex`, `cursor`, `copilot` or `gemini` alone writes only
the directory that agent reads:

```sh
sauce skills install --agent codex            # only the directory Codex reads
```

Cursor and Copilot also read `.claude/skills/`, so they see the same skill, with the same files, in
both.

### Add an index to `AGENTS.md`

`--agent agents-md` is opt-in, for a tool that reads [`AGENTS.md`](https://agents.md/) but no
skills directory. It writes `.agents/skills/` and an index of the skills into `AGENTS.md`:

```sh
sauce skills install --agent all,agents-md    # both directories, and the AGENTS.md index
```

The index is a block between `<!-- sauce-skills:begin … -->` and `<!-- sauce-skills:end -->`
markers listing each skill and its `SKILL.md`. The command owns that block and nothing else in the
file. Every packaged skill follows the [Agent Skills specification](https://agentskills.io/specification):
a `name` that is its directory's, lowercase letters, digits and hyphens, at most 64 characters, and
a `description` of at most 1024.

`sauce init` writes the project's instructions to `AGENTS.md`, which Codex, Cursor, Copilot and
Gemini CLI read, and the one-line pointers to it that the other two document: `CLAUDE.md` holding
`@AGENTS.md` (Claude Code reads `AGENTS.md` only when there is no `CLAUDE.md`) and `GEMINI.md`
holding `@./AGENTS.md` ([GEMINI.md imports](https://geminicli.com/docs/cli/gemini-md)).

## Keep them current

```sh
sauce skills status                           # exit 1 while any target is outdated or not installed
sauce skills update                           # after upgrading the package
```

- **`install`** is the first install. It never overwrites. Run again, it says the skills are up to
  date, or, after a package upgrade, that they are outdated (installed from one version, while the
  package has another) and to run `sauce skills update`. A file already there that it did not
  write is left alone.
- **`update`** brings each installed target to the package: it adds new skill files, replaces
  changed ones and removes retired ones. A file edited since it was installed is kept, with a short
  diff of what differs, unless you pass `--force`. It prints, per target,
  `added N, updated N, removed N, kept N modified`. In `AGENTS.md` it rewrites only its own block.
- **`status`** reports each target as up to date, outdated or modified, listing the files. It exits
  1 while any target is outdated or not installed: put it in CI to notice an upgrade the skills
  have not followed.

[Upgrading](upgrading.md) puts this beside the other steps of moving a project to a new version.

### How an upgrade is told apart from an edit

Beside the skills, each directory gets `tsconfig.json`, which types their example programs in an
editor ([In an editor](cli-programs.md#in-an-editor)); it is installed, recorded, updated and
reported like a skill file. Each skills directory records what it was given in `.sauce-skills.json`:
the package, its version, and the sha256 of each file as written. The `AGENTS.md` block records the
same in its opening marker. That record is how a package upgrade (a file still as installed) is told
apart from an edit (a file that is not). Skills of your own in the same directories are never
touched.

## Without installing them: the MCP server

An agent connected to the [MCP server](mcp.md) reads the same skills from it, at the server's
version, with nothing installed in the project: as tools, because many clients call tools but never
read resources, and as resources. [Skills, documents and prompts](mcp-tools.md#skills-documents-and-prompts)
lists both, and the prompts that start from a skill.

## From TypeScript

The per-protocol documents in `sauce-protocols` are also the `/skills` export's text:
`getProtocolSkill(slug)`, `getProtocolIndex()` and `listSkillSlugs()`
([Protocol resources](../api/README.md#protocol-resources)). Each protocol's page in the
[reference](../reference/protocols.md) carries the same document.

## Next

- Have your agent write and simulate a first program: [Your first agent session](agent-quick-start.md).
- Give it Sauce's tools as well: [The MCP server](mcp.md).

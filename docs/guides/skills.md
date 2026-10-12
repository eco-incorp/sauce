# Agent skills

[Documentation](../README.md) · [The sauce command](cli.md) · [The MCP server](mcp.md)

The package ships agent skills: directories in the
[Agent Skills](https://agentskills.io/specification) format, each a `SKILL.md` with the examples and
references it links, that teach a coding agent to write Sauce programs and run them. They are
written for the agent; this manual is written for you. The two carry the same facts: the chains,
tokens and protocols in the [reference](../reference/chains.md) are rendered from the same
registries, by the same generator, as the skills' own references, and the
[SauceScript reference](../reference/saucescript.md) is the `sauce-script` skill's, word for word.

Each stands alone. An agent with only the skills, served by the MCP server with nothing installed,
finds every fact it needs in them, and nothing in this manual sends you into a skill's files.

## The skills

| Skill                           | What it teaches the agent                                                                                                                               | The same ground in this manual                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `sauce-overview`                | What Sauce is, what a Pot, a cook and the Kitchen are, the path from a program file to a transaction, the rules every program follows, which skill next | [Documentation](../README.md), [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md), [Architecture](../concepts/architecture.md) |
| `sauce-script`                  | The language: the two program forms, `main`'s inputs, compile errors, and every type, statement and builtin                                             | [Writing SauceScript](../concepts/saucescript.md), [SauceScript reference](../reference/saucescript.md)                              |
| `sauce-globals`                 | The names a program uses with no import: token symbols and tokenized stocks, `Token(address)`, namespaces                                               | [Protocols and tokens](protocols-and-tokens.md), [Tokens](../reference/tokens.md)                                                    |
| `sauce-chains`                  | Each chain: its support, ids, native coin, intents, tokens, and every protocol's addresses; and the Sauce deployment, in one file                       | [Chains](../reference/chains.md)                                                                                                     |
| `sauce-protocols`               | Every protocol by category: how to choose, its deployments and names in a program, its ABI and its pitfalls                                             | [Protocols](../reference/protocols.md)                                                                                               |
| `sauce-swaps`                   | Swapping with `@sauce/router`: one function per venue, price limits and partial fills, how each venue is paid                                           | [`@sauce/router`](../api/router.md)                                                                                                  |
| `sauce-distributed-swap`        | One exact-input swap over several price-limited pools: a limit order that never pays past its maximum price                                             | [`sauce pools`](cli.md#sauce-pools) and [`sauce price`](cli.md#sauce-price), which give it its pools and limits                      |
| `sauce-solana-distributed-swap` | The same limit order on Solana: pools as account slots, every venue whose swap stops at a price limit                                                   | [The distributed swap on Solana](solana-distributed-swap.md), [`sauce pools`](cli.md#sauce-pools)                                    |
| `sauce-intents`                 | Cross-chain intents written in Sauce: a file that is the intent, rewards, cascades, and every step after                                                | [Create an intent](intents.md), [Nested intents](nested-intents.md)                                                                  |
| `sauce-async`                   | Promises: a request answered later, `.then` when the protocol calls back, combinators, timeouts and deferreds                                           | [Waiting for a callback](async.md)                                                                                                   |
| `sauce-oracle`                  | An answer from a Chainlink CRE workflow, delivered to a `.then` on the Pot: the request, the report, who may answer, installing it                      | [Waiting for a callback](async.md#oracles-sauceoracle)                                                                               |
| `sauce-random`                  | Randomness: Chainlink VRF and Pyth Entropy requests whose `.then` runs with the random number                                                           | [Randomness](async.md#randomness-saucerandom)                                                                                        |
| `sauce-zk`                      | Proven answers: a SQL query over chain data (Space and Time) or a RISC Zero program (Boundless), its proven result handed to `.then`                    | [Proofs: `@sauce/zk`](async.md#proofs-saucezk)                                                                                       |
| `sauce-signed`                  | Owner-signed programs: a program the owner signs once that anyone submits to the Pot, and the Pot as an EIP-1271 signer                                 | [Owner-signed programs](async.md#owner-signed-programs-saucesigned)                                                                  |
| `sauce-remote`                  | Code run on your own Pot on another chain over a bridge, its answer back, and the handlers both Pots install                                            | [Messages across chains](async.md#messages-across-chains-sauceremote)                                                                |
| `sauce-solana`                  | Programs for Solana: accounts and their roles, the account manifest, SPL Token and Token-2022, the Kitchen                                              | [Solana](solana.md)                                                                                                                  |
| `sauce-actions`                 | A program as a JSON actions document: swaps, bridges, wraps, staking, lending and token moves as data                                                   | [Actions](actions.md)                                                                                                                |
| `sauce-cli`                     | The `sauce` command: names, the Pot, funding, rehearsing, signing and sending, and publishing intents                                                   | [The sauce command](cli.md)                                                                                                          |
| `sauce-typescript`              | The same from application code: compiling, arguments, cooks, Pots, the raw compiler, actions, verification                                              | [API reference](../api/README.md), [Compiling programs](compiling.md)                                                                |
| `sauce-examples`                | An index of every example program and runner, with the chains each is checked on                                                                        | [Examples](../examples/README.md)                                                                                                    |

Before the package is published, every program in them is compiled through the `sauce` command on
the chains it names, every command line they show is held to the command's flags, and every
generated reference is held to the registries.

## Install them in a project

`sauce skills install` copies the skills of the `sauce` command that runs it to where coding agents
read them, in the project it runs in (`--dir <project>` names another):

```sh
npm i -g @eco-incorp/sauce
sauce skills install                          # .claude/skills and .agents/skills
sauce skills install --agent codex            # only the directory Codex reads
sauce skills install --agent all,agents-md    # and the AGENTS.md index
```

In a project that pins the package, `npx sauce skills install` installs that version's skills, and a
global `sauce skills status` there reports skills installed from another version than its own
([Install](cli.md#install)). `sauce init my-app` scaffolds a new project and installs them in it.
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
the directory that agent reads. Cursor and Copilot also read `.claude/skills/`, so they see the
same skill, with the same files, in both.

`--agent agents-md` is opt-in, for a tool that reads [`AGENTS.md`](https://agents.md/) but no
skills directory: it writes `.agents/skills/` and an index of the skills into `AGENTS.md`, a block
between `<!-- sauce-skills:begin … -->` and `<!-- sauce-skills:end -->` markers listing each skill
and its `SKILL.md`. The command owns that block and nothing else in the file. Every packaged skill
follows the [Agent Skills specification](https://agentskills.io/specification): a `name` that is
its directory's, lowercase letters, digits and hyphens, at most 64 characters, and a `description`
of at most 1024.

`sauce init` writes the project's instructions to `AGENTS.md`, which Codex, Cursor, Copilot and
Gemini CLI read, and the one-line pointers to it that the other two document: `CLAUDE.md` holding
`@AGENTS.md` (Claude Code reads `AGENTS.md` only when there is no `CLAUDE.md`) and `GEMINI.md`
holding `@./AGENTS.md` ([GEMINI.md imports](https://geminicli.com/docs/cli/gemini-md)).

## Keep them current

```sh
sauce skills status                           # exit 1 while any target is outdated
sauce skills update                           # after upgrading the package
```

- **`install`** is the first install. It never overwrites. Run again, it says the skills are up to
  date, or, after a package upgrade, that they are outdated — installed from one version, the
  package has another — and to run `sauce skills update`. A file already there that it did not
  write is left alone.
- **`update`** brings each installed target to the package: it adds new skill files, replaces
  changed ones and removes retired ones. A file edited since it was installed is kept, with a short
  diff of what differs, unless you pass `--force`. It prints, per target,
  `added N, updated N, removed N, kept N modified`. In `AGENTS.md` it rewrites only its own block.
- **`status`** reports each target as up to date, outdated or modified, listing the files, and
  exits 1 while any is outdated: put it in CI to notice an upgrade the skills have not followed.

Beside the skills, each directory gets `tsconfig.json`, which types their example programs in an
editor ([In an editor](cli.md#in-an-editor)); it is installed, recorded, updated and reported like a
skill file. Each skills directory records what it was given in `.sauce-skills.json` — the package,
its version, and the sha256 of each file as written — and the `AGENTS.md` block records the same in
its opening marker. That record is how a package upgrade (a file still as installed) is told apart from an edit
(a file that is not). Skills of your own in the same directories are never touched.

## Without installing them: the MCP server

An agent connected to the [MCP server](mcp.md) reads the same skills from it, at the server's
version, with nothing installed in the project: as tools, because many clients call tools but never
read resources, and as resources. [Skills, documents and prompts](mcp.md#skills-documents-and-prompts)
lists both, and the prompts that start from a skill.

## From TypeScript

The per-protocol documents in `sauce-protocols` are also the `/skills` export's text:
`getProtocolSkill(slug)`, `getProtocolIndex()` and `listSkillSlugs()`
([Protocol resources](../api/README.md#protocol-resources)). Each protocol's page in the
[reference](../reference/protocols.md) carries the same document.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The current consumer manual starts at [docs/README.md](docs/README.md). Compiler integration is in
[docs/api/compiler.md](docs/api/compiler.md). Keep that manual focused on external SDK users;
repository maintenance instructions belong here.

The manual is written for people and the skills for agents. It is in four parts, Diátaxis's:
**Tutorials** (learn by doing), **How-to guides** (one task a page), **Concepts** (explanation: what
a Pot is, why atomic) and **Reference** (flags, API, the generated pages, the changelog).
`docs/README.md` is the map: every page is listed under exactly one of its four `##` sections, and
says which on its breadcrumb line (`**How-to guide** · ` before its links); `docs:check` holds both.
The part is the index's and the breadcrumb's, never the folder's: a tutorial lives in `docs/guides/`
beside the how-tos, and a page keeps its path when it changes part. A page stays in its mode: a
how-to does not wander into a concept essay, a concept page lists no flags, and a fact has one
owning page that the others link instead of repeating. No history or changelog prose, except in
`docs/changelog.md`, which is the one page for it: each SDK 0.99.x release, its SauceScript
changes, and the compiler and engine changes it shipped. Every page
then opens with a short plain-words intro in a blockquote: a few short sentences and an everyday
analogy, any Sauce word in it explained on the spot (the [glossary](docs/concepts/glossary.md) maps
each to a familiar one). The real content follows it, examples before rules, edge cases in a section
at the end. Say "simulate", never "rehearse".

**The learning path.** The tutorials take a reader who knows TypeScript, a wallet, a transaction and
a token, but not Sauce, from nothing to proficient, read in this order, which is the order
`docs/README.md` lists them under `## Tutorials`:

1. `docs/guides/quick-start.md`, "Quick start" (on `docs/examples/pay.sauce.ts`)
2. `docs/guides/write-your-first-program.md`, "Write your first program"
3. `docs/guides/swap-by-name.md`, "Swap by name"
4. `docs/guides/solana-quick-start.md`, "Solana quick start"
5. `docs/guides/typescript-quick-start.md`, "Sauce from TypeScript"
6. `docs/guides/test-your-first-program.md`, "Test your first program"
7. `docs/guides/agent-quick-start.md`, "Your first agent session"

A tutorial runs an example `docs/examples/` already has and a suite already executes; it does not
add a program of its own. A tutorial that builds a program up step by step ends on such an example,
quoted whole, and adds no other program: its steps are versions on the way to it. Every
hand-written page follows one shape: its title; its breadcrumb (`**Tutorial** · `,
`**How-to guide** · `, `**Concept** · ` or `**Reference** · `, then its links, copied from a page
of the same part); the blockquote intro; near the top, who the page is for and what it needs, each
prerequisite linked to the page that covers it; and at the end `## Next`, linking the next step of
the path or the closest related page. A tutorial also has a "You will need" list (real funds, when
it spends them, said first) and a "You will have" outcome, follows one path with no choices, shows
a result at each step, and its `## Next` names the next tutorial and the concept that explains what
it just did. `docs:check` fails a page listed under `## Tutorials` with no `## Next` heading.

## What this repo is

**Sauce** — the developer-facing package for the **Sauce protocol**, whose on-chain bytecode engines
execute atomic scripts in EVM and Solana transactions. This is the whole `sauce`
repo (`eco-incorp/sauce`, **renamed from `eco-incorp/sauce-sdk`** — the old name still redirects). The
runtime **engine** it _targets_ lives in the separate private **`eco-incorp/v12`** repo (**renamed
from `eco-incorp/sauce`**; the engine, not this package, is what took the `v12` name — often checked
out at `../v12`).

A **pnpm monorepo** of four workspace packages (`pnpm-workspace.yaml`: `dev-tools`, `sdk`,
`actions`, `mcp`), all `private: true`, bundled and published as a **single npm package
`@eco-incorp/sauce`** via subpath exports and bins — only the root `package.json` publishes. This
bundling is the key mental model: code lives in four packages for development, consumers import
everything from one name.

**What the root manifest depends on is held to what the code imports.** Its `dependencies` are
exactly what a library import loads. The packages only one command of the `sauce` bin loads are
OPTIONAL PEER dependencies: `@modelcontextprotocol/sdk` and `zod` (`sauce mcp`, i.e. `mcp/dist`) and
`litesvm` (a Solana rehearsal, `cli/svm-fork.ts`). No install of the package brings them, with no
flag. They are declared at any version (`*`). npm refuses (ERESOLVE) to install a package whose
optional peer range a project's own copy misses, and zod is common, so never narrow those ranges.
The pins are the root's devDependencies. The command takes, in this order
(`cli/optional.ts#provide`): the user's own copies where the package's modules resolve them, when
each is exactly the pin; else `~/.sauce/runtime/<version>`; else it installs that folder first. The
install is `npm ci
--ignore-scripts` on the lockfile the package ships, `sdk/runtime/package{,-lock}.json`
(`cli/runtime.ts`), run in a 0700 mkdtemp beside the folder with `--workspaces=false` (npm adopts
an ancestor workspace root otherwise; never `--prefix`, which moves npm's global config away) and
renamed into place, after which older
versions' folders are pruned but the newest of them. A newer version's folder is never pruned: a
project's older pinned copy runs beside a newer global one. `optional.ts#assertPrivate` refuses to
install into or load from a folder, or one above it up to `~/.sauce` (symlinks resolved), that
another user owns or anyone else can write, and a version folder that is not 0700, because the
process may hold a wallet password. The packages then load from the
folder through a `module.registerHooks` resolve hook, limited to the package's own modules' imports.
Only `main.ts` gives the process the installer (`useRuntime`), so an in-process `runCli` (every
test, the skills checker) never runs npm and refuses with `sauce runtime install` instead. In this
repository the workspaces' own copies are the pins, so nothing installs. `sauce runtime
[status|install]` reports and installs; `sauce mcp setup` installs up front; and `sauce update` has
the new binary run `sauce runtime install` where the replaced version had a folder. `sauce mcp
--offline` makes the whole process install nothing (`useRuntime({ offline: true })`), a tool's
later Solana rehearsal included.

`sdk/scripts/gen-runtime-lock.mjs` (`pnpm --filter './sdk' gen-runtime-lock`, which reaches the
registry) writes `sdk/runtime/` from those pins. `optional-dependencies.test.ts` fails while
the lock is stale or incomplete, and also walks every export's module graph: every package it loads
is a dependency, and none reaches the command. Every pin is three places that test holds equal: the
root's devDependencies, the workspace that imports the package, and `sdk/runtime/`.

TypeScript is a devDependency only: the editor plugin gets the editor's TypeScript, and `sauce init`
writes our devDependency's range into the new project's devDependencies.
`check-packed-package.mjs` proves all of this on the tarball, every `sauce` it runs with a
temporary HOME:

- a plain install is slim, and every export loads;
- the first `sauce mcp` and the first rehearsal install the folder, including the platform's LiteSVM
  binary;
- a second start works with npm off PATH;
- a mismatched user MCP SDK is passed over;
- `--offline`, no npm and an unreachable registry each refuse on one line, leaving nothing;
- `mcp setup` installs the folder.

Never add a runtime dependency that no export loads. A new CLI-only package becomes an optional
peer, joins an `Extra` in `optional.ts` and goes through `provide`, and `gen-runtime-lock` then
regenerates `sdk/runtime/`.

| Workspace    | Internal name                 | Published as                                                                                                                                          | Role                                                                                                      |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `sdk/`       | `@eco-incorp/sauce-source`    | `.` and most subpaths (`/compiler`, `/protocols/*`, `/chains`, `/recipes`, `/skills`, `/svm*`, `/evm/engine`, `/verify`, `/deployments`); bin `sauce` | 134-protocol registry, chains, recipes, SVM/EVM engine clients, the `/skills` loader, the `sauce` command |
| `actions/`   | `@eco-incorp/sauce-actions`   | `/actions`, `/actions/action-program.schema.json`                                                                                                     | JSON action programs → SauceScript; `sauce actions` lowers them                                           |
| `mcp/`       | `@eco-incorp/sauce-mcp`       | `sauce mcp` (loaded by the `sauce` bin)                                                                                                               | The Sauce MCP server: the `sauce` command's building tools (and, over stdio, wallets), the agent skills   |
| `dev-tools/` | `@eco-incorp/sauce-dev-tools` | `/testing` (from `dev-tools/dist/testing`)                                                                                                            | The testing kit (`src/testing`); the dev harness: local node scripts, compile helpers, SVM Kitchen runner |

This repo was **extracted from the engine repo** (now `eco-incorp/v12`, checked out at `../v12`),
which may still carry older copies of these packages. The packages here are **siblings, not
generations**: `dev-tools` is a dev harness, not a legacy `sdk`.

## Build, test, lint

Use Node.js **24 or newer**, matching the Solana dependencies and CI.

Run from the repo root. `build` is `pnpm -r --filter './sdk' --filter './actions' --filter
'./mcp' --filter './dev-tools' build`, and **`actions`, `mcp` and `dev-tools` read the SDK's
`dist/`**: `actions/src/registry.ts` and
`compose.ts` import `../../sdk/dist/...` by relative path, the one spelling that resolves both in the repo and in the
published tarball (where `actions/dist` and `sdk/dist` are siblings; the workspace name
`@eco-incorp/sauce-source` is not published). `mcp/src/sdk.ts` does the same, the one module
through which the MCP server reaches the SDK, and so does `dev-tools/src/testing/sdk.ts` for the
testing kit. So build the SDK before typechecking, building or
testing `actions` or `mcp`. `pnpm build` orders them — both declare `@eco-incorp/sauce-source` as a
workspace devDependency for exactly that — and CI builds the SDK first. The compiler is an ordinary
npm dependency, already built; nothing in this repo builds it.

```sh
pnpm install
pnpm build          # sdk + actions + mcp + dev-tools (the testing kit)
pnpm typecheck      # all workspaces, their tests included (jest and tsx check no types)
pnpm test           # all workspaces
pnpm lint           # eslint, whole repo
pnpm lint:fix       # ...with --fix
pnpm format         # prettier --write, whole repo
pnpm format:check   # prettier --check, what CI runs
pnpm docs:check     # manual links and shape, README snippet, executable examples, executed.json; build first
pnpm skills:check   # the agent skills: programs, command lines, runners, wording; build first
```

`sdk/scripts/sizes/` holds the tools a compiler bump is held with, run by hand against a built tree
(its README): every example and recipe's bytecode size against a baseline (`sizes.mjs`, `diff.mjs`),
a hash of every output and refusal for proving a change alters none (`bytes.mjs`, `refusals.mjs`),
and compile time (`times.mjs`, `ab.mjs`, `profile.mjs`, and recordings any build replays).

`lint` and `format:check` gate every PR (`.github/workflows/lint.yml`) and both run over the
WHOLE tree, so there is no backlog to work around — a new file has to be clean. Prettier and
ESLint are pinned to exact versions rather than caret ranges: a formatter that drifts between
minors would start failing CI on a PR that changed nothing.

**What the two tools deliberately do not see.** ESLint ignores SauceScript (`**/*.sauce.ts`,
`dev-tools/sauce`, `dev-tools/test/fixtures`, `sdk/src/std`) because every finding there is a false
positive: `main` is the entry point the Sauce compiler calls, so `no-unused-vars` fires on every
program, and `require(cond)` is SauceScript's ASSERTION, which `no-require-imports` reads as a
module import. Prettier's list is different and narrower — generated output (`**/*.generated.ts`,
the two `settle.sauce.ts` recipes) and captured fixtures. Everything else, SauceScript included, is
formatted; `.prettierrc.json` names the `typescript` parser for `sdk/src/std`, whose `.js` files
carry type annotations Prettier's default parser rejects.

**SauceScript in an editor.** The root `tsconfig.json` builds nothing: it is the project an editor
opens every `*.sauce.ts` of the repository in — skills, docs, recipes, fixtures — the project
`sauce init` writes into `programs/` (`sauceScriptTsconfig` in `sdk/src/cli/skills.ts`), with the
declarations from `sdk/dist/sauce-script` (so build first) and the plugin from the SDK workspace,
which pnpm links into `node_modules/.pnpm/node_modules` beside the workspace TypeScript. The plugin
loads only when the editor runs that TypeScript (VS Code: "Use Workspace Version"); without it the
types still apply and the false positives it drops show. `sdk/tsconfig.json` excludes
`src/**/*.sauce.ts`, and tsserver (TypeScript 5.6 and later) goes on up to the root project for a
file its nearest tsconfig does not include; the runners and the docs' `.ts` examples keep their
inferred project. `pnpm docs:check` asks tsserver for each tracked program's project and
diagnostics (`checkRepositoryEditor` in `sdk/scripts/check-editor.mjs`), and
`sdk/test/sauce-script.test.ts` holds every program the root tsconfig lists to the declarations
built from source. `sauce skills install` writes the same project, naming the installed package,
beside the skills (`packaged` in `skills.ts`), and the packed check opens the installed programs
in tsserver there.

Per-workspace (`--filter`):

```sh
pnpm --filter './sdk' test               # SDK tests, including protocol SauceScript compilation
pnpm --filter './actions' test:unit      # no mainnet state
pnpm --filter './actions' test:mainnet   # real mainnet contracts, replayed locally
pnpm --filter './sdk' gen-route-globals  # regenerate the per-chain named exports
pnpm --filter './sdk' gen-source-globals # regenerate the contract table and both languages' types
```

Single test file: jest (sdk) → `pnpm --filter './sdk' test -- routes-void-main.test.ts`.
Actions and dev-tools use the **node test runner**, not jest → `pnpm --filter './actions' exec tsx
--test tests/split-swap.unit.test.ts`.

Actions test layout: `*.unit.test.ts` need nothing; `*.exec.test.ts` EXECUTE programs on a local
anvil through the released engine and a real Kitchen-minted Pot (`tests/anvil.ts`) — they are in
`test:unit`, skip locally without the engine artifact and throw under `CI`. `calldata.exec` runs
every action against contracts that log the call they receive and compares the calldata with an
independent viem encoding. `actions.mainnet` (every action type, and it fails if one did not run),
`quote.mainnet` and `split-swap.mainnet` (`test:mainnet`) run against real Ethereum contracts on a
LOCAL anvil booted from mainnet state captured at a pinned block — no RPC, no secret, and they run
in CI. See "Mainnet state" below. An action type that cannot execute there does not ship. The
`swap*.mainnet` suites (also `test:mainnet`) execute `@sauce/router` on Ethereum, Base and
Avalanche state — each venue called with literal arguments, with run-time `main` arguments and
through its action, and each `try` form beside its plain function, with every skip path held to
the Pot's and the pool's balances (`tests/swap-venues.ts`; PancakeSwap Infinity's CL and bin pools
on Base) — and `traderJoeLBSwap`/`woofiSwap`, whose venues Ethereum lacks, run there;
`actions.mainnet` counts them as executed elsewhere. `quote.mainnet` deploys the stack too:
the Router quotes `uniswapV3Swap`/`uniswapV4Swap`, and is held to Uniswap's own quoters.
`names.unit` compiles documents by token symbol, namespace and pool key for two chains through the
real compiler, and every refusal of a name a chain lacks; `cli.unit` drives `sauce actions` and an
actions document through `compile`/`tx` via the built bin's `runCli` (here, not in `sdk/test`,
because the command loads `actions/dist`, which CI builds after the SDK's tests).
`names.mainnet` (`test:mainnet`) executes one chain-agnostic document — symbols, namespaces, pools by
key — on Ethereum, Base and Avalanche state, against the same trade by address, and through
`sauce run`. `holdings.mainnet` (`test:mainnet`) runs the `sauce-chains` skill's
`holdings.sauce.ts` as its header's `sauce simulate` line says, on Ethereum and Base state, and
holds what it returns to each chain's own pool and the balances the Pot was given.
`docs-examples.mainnet` (`test:mainnet`) executes the manual's router, venue and README examples
(`docs/examples/router-route`, `router-swap`, `venue-where-deployed`) as their runners build them,
IMPORTING the runners for their exact bytes, and runs the `sauce run` usage line of each that has
one as written, through `runCli`, on Ethereum, Base and OP Mainnet state; each output is held to
the venues' own quotes. Importing a runner is why `actions/tsconfig.json` sets
`rootDir: ".."`: the runners import `@eco-incorp/sauce` by its own name, a self-reference
TypeScript resolves only with a root; `tsconfig.build.json` pins its own `rootDir` to `src`, so the
build's output does not move.
`examples-cookbook.mainnet` (`test:mainnet`) runs every EVM program of the `sauce-examples`
skill's own cookbook through `sauce simulate` and `sauce run` on Ethereum and Base state, its
results held to Uniswap's QuoterV2, the feed, Aave's account data and the recipients' balances.
The cookbook's Solana program runs in `sdk/test/examples-cookbook-solana.e2e.test.ts`.
`official-examples.mainnet` (`test:mainnet`) runs the protocols' own Solidity examples ported to
Sauce (each header's `Ported from` line names the official file at a pinned commit; the generator's
`PORTED_EXAMPLES` lists them for the manual's `docs/guides/solidity-examples.md`) through `sauce
simulate` and `sauce run` on Ethereum state, each result held to the protocol's own quoter or
accounts and to the balances it moved.
After changing an action's fields in `actions/src/spec.ts`, run `pnpm --filter './actions'
gen-schema`; `program.unit.test.ts` fails while `actions/action-program.schema.json` is stale.

## Toolchain gotchas (why a fresh clone may fail)

- **There is no engine git dep.** Every v12 artifact comes from a RELEASE of the private
  `eco-incorp/v12` repo, pinned in `sdk/src/deployments/releases.json` by version **and** by a
  sha256/keccak digest committed there — the one place every release-dependent value is written. The
  digest is the guarantee — a git tag is movable on GitHub — and there is deliberately no commit pin,
  because FOUR components release independently:
  `v12-svm` (engine + wire artifact), `v12-evm` (runtime creation code), `kitchen-svm` (kitchen
  program + Anchor IDL) and `kitchen-evm` (the Solidity ABIs). Do not look for `abis.json`,
  `kitchen.so` or `kitchen-idl.json` under a `v12-*` tag — they moved to the `kitchen-*` releases.
  The tags MAY be cut from different commits (`v12-evm-v0.4.0` and `v12-svm-v0.5.0` were), so a
  shared commit is not a property to rely on even while all four happen to share one after a
  coordinated re-release. **`releases.json` has one row per COMPILER version**, naming the four
  releases that compiler's output pairs with: compiler output and engines are compatible by exact
  package version (2.6.1 uses v12-evm 1.3.0 / v12-svm 1.4.0; 2.5.0 uses EVM 1.2.0 / SVM 1.3.0).
  An ISA label is not a compatibility check. `sync-engine-artifacts.mjs` syncs the row of the INSTALLED compiler and records it as
  `V12Deployments.json`'s `compiler`; `deployments/releases.ts#assertEngineRunsCompiler` reads the
  same rows, and every SDK builder that names an engine (`v12Pot.encodeCook`, the SVM engine and
  Kitchen cook instructions) refuses an engine no row explicitly pairs with that compiler. To bump: edit the row's versions,
  run the sync, paste the digests, engine ids and the kitchen-evm pin's `kitchen` and
  `potInitCodeHash` it reports — a row with a `null` digest, engine id, Kitchen or hash is a release
  not out yet, and the sync refuses it and writes nothing. The Kitchen and hash are what the `sauce`
  command tells a Pot's release from (`cli/pots.ts`), so every row keeps its own after a newer
  release moves the hash; the sync checks the installed row's against its `addresses.json`. Then `pnpm build`: the
  release's addresses are written in docs and skills ONLY in the generated
  `docs/reference/deployments.md` and `skills/sauce-chains/references/deployments.json` (see "One
  place per release" under "Agent skills"), so those two files are the bump's whole docs/skills
  diff.
  **Fetching needs no PAT.** Each release publishes its assets as a PRIVATE npm package on GitHub
  Packages (`@eco-incorp/<package>` at `npm.pkg.github.com`, one per independently-released
  component). Read access is granted per package to the CONSUMING REPOSITORY (package settings ->
  Manage Actions access -> add `eco-incorp/sauce`, Read), so CI authenticates with the `GITHUB_TOKEN`
  every workflow already has and a developer with whatever `gh` is logged in as. Nothing is published
  publicly. There is deliberately **no `gh release` or REST fallback**: a fallback would let a
  developer and CI fetch by different routes, so the route CI depends on could rot unseen.

  The sync fetches the packument and tarball **straight from the registry** rather than declaring a
  dependency, DELIBERATELY. Installing would need an `@eco-incorp` scope mapping in `.npmrc`, and a
  scope registry governs PUBLISHING as well as resolution — the hazard the Publishing section below
  records. Do not "simplify" this into a devDependency.

  The release tag maps to the package as `<package>-v<version>` -> `@eco-incorp/<package>@<version>`,
  files land under `package/` in the tarball, and the committed digest is still the guarantee — this
  changed the TRANSPORT, not the trust model. A failed `curl` must never have its own message
  surfaced: `execFileSync` puts the command line in it and these commands carry the credential, which
  printed a live token into output before this was fixed.

  **If this repository is ever made public**, note that granting a public repository access to a
  private package lets FORKS of it read that package.

- **Foundry is required only to RUN things, never to build artifacts.** The sync no longer compiles
  anything: the ABIs arrive as a release asset. What still needs Foundry is `anvil` on `PATH` for
  `sdk/test/std/token/evm.e2e.test.ts` and other EVM execution suites. They deploy the pinned creation
  code and run through real Kitchen-created Pots; CI no longer derives a runtime with `cast` for
  tests to etch at another address. **A tree where the
  sync has not run is not green**: with no `sdk/{src,dist}/artifacts/`, the tests that import
  `./artifacts/*.json` fail. Run `pnpm --filter './sdk' sync-engine-artifacts`.
  **Every anvil in `sdk/test`, `mcp/test` and `actions/tests` starts through
  `sdk/test/anvil-process.ts#spawnAnvil`** (the actions harness and its mainnet replay included)
  on a port the OS hands out: `startChain(slug)` and `startPoolsChain()` take no port, and a suite
  that builds its clients at module load takes `freePortSync()`. `anvil-process.test.ts` fails a
  direct `spawn("anvil", …)` in any of the three, and any fixed port in `sdk/test`, `mcp/test` or `actions/tests` (a
  number, a `--port` literal, a range by `JEST_WORKER_ID`). Two suites once took overlapping
  `N + JEST_WORKER_ID` ranges and met on 9701: one attached to the other's orphaned anvil and
  asserted against its stale chain. `spawnAnvil` also REFUSES a port that already answers, naming
  its holder (netstat, ss, else lsof), answers only once its own anvil does, and starts a detached
  watchdog that SIGKILLs the anvil once the jest worker is gone. A suite's own exit or signal
  handler cannot: jest hands a suite a copy of `process` whose listeners the real process never
  calls.
- **Mainnet state (`actions/tests/state/*.genesis.json.gz`)** — no test forks a live chain. The
  actions mainnet suites replay a chain at its pinned block (`CHAINS` in `actions/tests/mainnet.ts`:
  Ethereum at `PINNED_BLOCK` 26,070,000, Base at 51,966,000, Avalanche C-Chain at 96,424,000, OP
  Mainnet at 157,600,000) from
  one gzipped anvil genesis per suite: every account and storage slot that suite read, at their
  values in that block. Replay pins the block number, its timestamp, the chain id and the chain's
  block interval (12 s on Ethereum, 2 s elsewhere — WOOFi's oracle goes stale 120 s
  after its last post), refuses to fork, and makes any non-loopback `fetch` throw, so a suite that
  starts reading something new FAILS (a missing slot reads as zero) rather than reaching the
  network. Blob sizes at capture: actions ~680 KB, quote ~270 KB, split-swap ~80 KB, the swap
  venue suites `swap` (Ethereum) ~135 KB, `swap-base` ~165 KB, `swap-avalanche` ~30 KB, and the names
  suite's three (one per chain, `names-{ethereum,base,avalanche}`) ~45, ~65 and ~40 KB,
  `holdings-{ethereum,base}` ~30 KB each, the docs examples suite's three (`docs-examples`,
  `-base`, `-optimism`) ~80, ~35 and ~25 KB, the cookbook's two
  (`cookbook-{ethereum,base}`) ~135 KB each, and the ported examples' `official-ethereum` ~630 KB.

  **Recapture** only when a suite needs state it does not have — a new test, a new venue, or a moved
  pinned block (then recapture every suite on that chain, and revisit every pinned figure: pools,
  strategy ids, the live Rocket Pool deposit pool, expected outputs). The RPC comes from one file,
  `sdk/rpc.config.json` (gitignored; chain id -> URL, the file `capture-registry-abi.mjs` reads),
  never from the environment, and it must serve state at the pinned block; public RPCs that did at
  capture time: `eth.drpc.org`, `mainnet.base.org`, `api.avax.network/ext/bc/C/rpc`,
  `mainnet.optimism.io`.

  ```sh
  pnpm --filter './actions' capture-mainnet                      # every suite
  RECAPTURE_ANVIL_STATE=1 pnpm --filter './actions' exec tsx --test tests/swap-base.mainnet.test.ts
  ```

  Capture forks at the pinned block through a local recording proxy (`tests/mainnet-recorder.mjs`,
  its own process, retrying an upstream request that hangs or is rate-limited) and rewrites each
  suite's blob from what it answered. Anvil's own mechanisms cannot do this: a fork's
  `anvil_dumpState` holds only locally modified accounts, and Foundry's RPC cache drops whatever was
  fetched after a snapshot when the suite reverts it. Capture a WHOLE suite — a
  `--test-name-pattern` run writes a blob with only those tests' state. Never print the RPC; `stop()`
  refuses to write a blob that mentions it, and grep the blobs for the host before committing anyway.

- **`SAUCE_ENGINE_SO` / `SAUCE_RUST_ENGINE_SO`** — the path to the Solana engine, fetched by
  `pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines`, which digest-verifies it against
  the pin and prints `SAUCE_RUST_ENGINE_SO=<path>`. **The tests read these variables; the SDK never
  does.** Each `svm/engine-artifacts.ts` resolver takes an optional explicit path
  (`svmEnginePath(cluster, path)`, `svmKitchenPath(path)`, `svmKitchenIdlPath(path)`) and otherwise
  returns the packaged binary; `sdk/test/svm/engine-harness.ts` and `dev-tools/test/svm-local.test.ts`
  read CI's `SAUCE_*` paths and pass them in. Shipped code reads no environment — but for the `sauce`
  command's one deliberate read, of the variable `--password-env <NAME>` or the MCP server's
  `sauce_wallet_enable { env }` names (see "Agent wallets" below): configuration is passed by the
  developer, and a browser has no `process.env`. **Nothing about the engine is
  source-controlled.**
  There used to be a vendored `artifacts/svm/engine.so` — a `release/beta` build predating every
  v12-svm release, with no `JUMP`/`JUMP_I` — and it was the DEFAULT, so anything with control flow was
  rejected with `InvalidInstructionData` while straight-line programs ran, silently, just from not
  setting a variable. It is deleted, along with the staging surface only it could run
  (`init_buffer`/`write_buffer`/`finalize_buffer`/`execute_and_close`, `client.stageBuffer`), which no
  released engine implements. Staging is the kitchen's now (`kitchen.ts`). The engine-gated suites
  skip locally when the variable is unset and hard-fail in CI.

- **`SAUCE_V12_RUNTIME_CREATION_HEX`** — a file containing the pinned EVM runtime's **creation**
  hex, printed by `sync-engine-artifacts --fetch-v12-engines` and exported into CI's environment.
  The EVM execution suites deploy that creation code directly. The constructor embeds the engine's
  own address, which `EVAL` uses: copying deployed runtime to another address leaves a dangling
  self-reference. Do not reintroduce the old deploy/read/etch flow. Some tests accept the old
  `SAUCE_RUST_V12_RUNTIME` variable as a fallback name, but the current input is creation code.
  Released engines also enforce the Kitchen/Pot gate: use `sdk/test/evm/gated-engine.ts` (the actions
  suites use it too; its deployment is `src/evm/release-stack.ts`, which the testing kit shares), not
  direct engine calls. `ctx.self()` and token ownership refer to the Pot.
  **That harness deploys the whole stack from creation code AT ITS RELEASE ADDRESSES** — engine,
  Router, Kitchen implementation, Kitchen proxy (initialized, owned by the harness account) — by
  installing CreateX's 8-byte CREATE3 proxy child (`363d3d37363d34f0`) at each release salt's
  CREATE2 address and sending it the creation code, so each contract CREATEs at the address
  `V12Deployments.json` records with its real constructor. Nothing of the stack is etched, and
  `v12EngineAddress()`/`v12RouterAddress()` are live on the anvil. It reads the Kitchen's era off its
  ABI (a Router constructor argument up to kitchen-evm 1.0.0; `setRouter` after), as v12's deploy
  tooling does.

- **EVM engine artifacts** (`sdk/{src,dist}/artifacts/` — `Router`, `ISauceRouter`, `V12Pot`,
  `V12Kitchen`, `V12KitchenProxy`, `V12RuntimeBytecode`, `V12EngineGate`, `V12Deployments`, `IERC20`,
  `IUniswapV3Pool`) ship to downstream SDK consumers,
  which read them for local tests/deploys. **Nothing is tracked** — an `artifacts/` directory at any
  depth is gitignored, as is every `dist/` — so they exist only where a sync has run, and `tsc` does
  not emit them: **after any repin run `pnpm --filter './sdk' sync-engine-artifacts`**. Five ABIs
  come from the `kitchen-evm` release's `abis.json`, `IERC20` is declared in the script (the ERC-20 standard is
  never v12's), `IUniswapV3Pool` comes from `@uniswap/v3-core`, and `V12RuntimeBytecode` wraps the
  release's creation code. `V12EngineGate` records the released engine's Kitchen/Pot gate anchors —
  the Kitchen and the Pot init-code hash, and not the Router, which no Pot hash derives from.
  CI asserts all 10 landed, so a broken generation fails there rather than
  shipping an empty dir. No generated file is committed and drift-checked any more:
  `engine-abi.generated.ts` went with the engine that produced it.
  The RELEASE ADDRESSES ship too: the sync assembles `V12Deployments.json` from the `addresses.json`
  each of the four releases publishes (EVM engine/router/kitchen/impl + Pot derivation, SVM engine/kitchen
  program ids), and `src/deployments/v12-addresses.ts` reads it at runtime behind the `./deployments`
  export (`v12EngineAddress()`, `v12KitchenAddress()`, `v12SvmEngineProgramId()`, …). These are the
  deterministic (CREATE3 / fixed-keypair) addresses — chain/cluster-independent, so they are ADDRESSES,
  not liveness; verify live code separately. There is no chain roster any more: the hand-maintained
  `v12.generated.ts` and its `isV12Live`/`v12ChainSlug`/`v12Deployment` helpers described the
  pre-`cook` deployment generation and were deleted. A chain's identity (slug, kind) is
  `chains/canonical.ts`'s. Which releases are pinned is `releases.json`'s row for the installed
  compiler; `V12Deployments.json.releases` records each source commit/version.
- **`V12RuntimeBytecode.json` comes from a pinned release asset.**
  The engine deleted its committed `engine-v12/snapshots/` copy (`chore(v12): compile the runtime
at deploy time`) because a second source of truth rotted — six changed `.huff` handlers once
  shipped with a snapshot built from pre-change source, through green CI.
  `sync-engine-artifacts.mjs` wraps the pinned EVM release's `runtime.creation.hex` in the JSON
  shape consumers already read. No Huff toolchain is involved in producing it.
- **A tag is not a pin.** A GitHub tag is movable, so each asset is checked against a digest
  committed in `releases.json` (`keccak256` of the _decoded_ creation code; `sha256` of the
  `.so`), cross-checked against the release manifest's `creationCodeKeccak`/`soSha256`, **and**
  against `manifest.commit`. A moved tag throws rather than silently supplying a different engine.
  Assets cache under `node_modules/.cache/sauce-engine-releases/<tag>/`, so a warm tree needs no
  network, and a corrupt cache is caught by re-hashing and refetched.
- **`hnc` (the Huff compiler) is no longer needed.** The suites that compiled `v12/Runtime.huff`
  themselves lived in the deleted `compiler/` workspace, and nothing in this repository calls it.

## Architecture

**SauceScript** is compiled by the published Rust/wasm compiler `@eco-incorp/sauce-compiler`,
aliased to the short name `sauce-compiler` in every `package.json`. **There is no in-repo
compiler**: the `compiler/` workspace was deleted, and `sdk/src/compiler.ts` re-exports the
published one as the `./compiler` subpath (through `sdk/src/wasm-compiler.ts`, a plain ESM import
that lets the package's `node`/`browser` conditions pick its build).

The compiler entry point is one function — source text in, bytecode out, no opcode-level builder, no
`Saucer`/`CompilerContext`/`OPS`:

```ts
compile(options: CompileOptions): CompileResult
```

`target` (`'evm' | 'svm'`) and `resolve` are required; `entry` (default `"main.js"`),
`resolvePackage`, `contracts`, `inlineContracts`, `ambient`, `defines`, `optimize` (default
`true`), `cache` (default `true`), `chain`, `chainProfiles`, `entryKind` and scalar `args` are optional.
All four manifests pin the compiler exactly to **2.6.1**, matching the lockfile.
`CompileResult` contains `bytecode: Uint8Array`, `isaRevision: "stack-v3"`,
`entryEncoding: "abi-v1"`, `entryParams`, `entrySignature`, nested `programs` reports, and optional
`manifest: AccountManifest`. `manifest` is the SVM account contract, absent on EVM.
Compile-time values affect bytecode; runtime entry arguments are encoded and appended separately.
Use `routes.encodeEntryArguments` for SDK programs; raw `entryParams` can mark top-level fixed-size
tuples `indirect: true`, which an encoder must honor. Pair the artifact with an engine by exact
version (`releases.json`, above). `entryKind: "closure"` accepts function-expression source text;
raw scalar `args` binds inputs at compile time. The SDK owns its SVM layout types (`sdk/src/svm/layout.ts`).

SVM settlement execution verification defaults to `wireFormat: "gated-v1"`: raw engine CPI
data with the 65-byte owner/salt/bump gate header and the full accounts including the trailing Pot
(and leading code account when staged). `legacy-ungated` is explicit historical inspection only.
Kitchen cook envelopes need separate decoding. A `genuine` result verifies program identity under
the caller's staged-pin evidence; it does not validate the gate, callee, account roles, or execution success.
Compile and resolution failures throw JavaScript errors. Frontend diagnostics usually carry source
locations; resolver and target-capability errors need not contain a source span.

The route adapter is a separate contract: `compileSauceRoute` returns one program in
`compiled.bytecode: Uint8Array[]`, an empty `warnings` array, rewritten source, and encoded calls.
It retains the runtime entry metadata needed by SDK argument encoding; use the raw `/compiler`
export for the complete compile report. Both `/compiler` and route compilation run in Node and in a browser
through one code path, `sdk/src/wasm-compiler.ts`: in a browser `await ready()` (from the root or
`/compiler`, forwarding to the compiler's `/ready`) before compiling; in Node nothing needs it.
Nothing browser-facing reads the filesystem. The std sources, recipe programs, protocol ABI twins
and skill docs the SDK reads are embedded at build time by `scripts/gen-embedded-sources.mjs` into
the gitignored `src/embedded/*.generated.ts` (regenerated by `build`, `typecheck` and `test`;
`embedded-sources.test.ts` fails when they are stale) and served by `src/embedded/resolve.ts`. Do
not add a `node:*` import or `Buffer` to shipped code: `svm/engine-artifacts` (file paths for a
local LiteSVM harness) is the one Node-only module, on its own subpath and in no barrel. CI bundles
every export for the browser and compiles in headless Chromium, so a regression fails there.

**There is no cross-chain intent surface**: no Portal encoders, no intent commands, no intent tools.
A chain export is a plain namespace object, so a program that calls one (`Base(() => …)`) fails to
compile.

**The authoritative description of that surface is the package's own typings**
(`node_modules/sauce-compiler/node/sauce_wasm.d.ts`), which document each option in detail —
`ambient` precedence, `defines` precedence and their program-wide scope, the resolver contract
(returning `undefined` means "nothing here" and falls back; a throw propagates). Read them rather
than a paraphrase. Compiler _behavior_ — language features, constant folding, per-target lowering —
must be verified against the pinned compiler implementation and executable probes; the runtime
repository's documentation is not an independent correctness check.

**The language reference is held to the compiler, and there is one.**
`skills/sauce-script/references/builtins.md` (the SauceScript reference) and its `builtins.json`
(every builtin, with an example program per target and the error on a target that lacks it) are the
`sauce-script` skill's reference and the manual's: the build renders `builtins.md` byte for byte,
under its plain-words intro, as `docs/reference/saucescript.md` (see "The manual renders the same
facts" below), so edit the skill's.
`pnpm skills:check` (`sdk/scripts/skills-check/builtins.mjs`) holds them: every builtin example
compiles on each target it lists, every table example compiles on each target its row claims, and
every error the page quotes (`…` and `N` as wildcards) is produced by a rejected program — a
builtin's `unavailable` entry or a program in `skills-check/builtins-rejections.mjs`. A new example
or quoted error needs a program behind it, and a compiler bump that changes a message fails there
first. Keep the page version-free, free of engine internals and free of placeholder addresses (the
skills' wording rules).

Compiler migration inventories and implementation plans have been removed. Git history retains
those investigations; do not add them back to the public SDK manual. What a release changed is
`docs/changelog.md`'s alone (see "Publishing").

**`sdk/`** — registries plus executable SDK logic. `src/protocols/<slug>/` holds per-protocol `info`,
`addresses`, `abis` as-const, and `functions` SauceScript templates; `src/protocols/index.ts` is the
query registry. `src/routes/` implements namespace rewrites and compiler integration;
token/deposit builders and EVM/SVM clients construct executable programs, account plans, and
transactions. `src/skills/loader.ts` is the `/skills` export, which serves the
per-protocol documents; those documents are the `sauce-protocols` agent skill's
`skills/sauce-protocols/references/*.md` (see "Agent skills" below), embedded at build time. `src/chains/`, `src/recipes/`, `src/core/types.ts` hold shared
chain and recipe definitions. **SDK tests compile every protocol's
`sauceFunctions` through the real compiler**, which is the installed npm package — there is nothing
to build first, but the suites that import `./artifacts/*.json` need `sync-engine-artifacts` to have
run (see the Foundry gotcha above).

**Every route rewrite parses with `src/routes/parse.ts`**: acorn extended by
`@sveltejs/acorn-typescript`, both pinned exactly (the plugin extends acorn's parser class). A route
source is SauceScript, annotations included, so the rewrites must take what the compiler takes; a
JavaScript-only parse rejected every typed helper. `ast-walk.ts#walk` steps over annotations and
type-only declarations, so no rewrite reads a type name as a value. Do not add a second parser, and
do not reintroduce a "rewrites cannot parse annotations" workaround. `main`'s signature, its return
type and its void are the compiler's (`entrySignature`, `entryParams`, `args`): nothing reads `main`
out of the program's text but `mainSignature`, for the `--fund` wrapper.

**A chain's names are a module the compiler is handed, and `checkNames` guards its zeros.**
`routes/chain-module.ts` writes, per chain, the ambient module `@sauce/chain`: every protocol
namespace (family aliases included) as an object literal holding every contract the namespace has
on ANY chain, bound (`ABI.at(address)`, the same bytes as the binding written by hand) where this
chain has it, its address where the registry has no ABI, and `0` where it lacks it. The chain's own
tokens, `chainId` and the `<Ns>_<Contract>` keys stay defines. A token symbol some chain registers
and this one lacks is zero too, but no module declares it: `checkNames` reports each test of one
(`zeros`) and `withoutDead` writes it `0` where it stands, so a read the check did not see is the
compiler's undeclared name. Declaring the ~1,800 of them cost about 2 ms on every compile (a
trivial `main` on Base, mean of 199 after the first, median of three runs: 3.45 ms with them,
1.50 ms without, against 0.88 ms before the module). The module's text depends only on the chain
and the namespaces the caller binds (`chainNames`): the plain module is every compile's, and one a
compile's options make is kept per options, a bounded few, so the compiler's module cache reads
each once. A name the caller binds is its own everywhere (`defined`): its defines, its contract
keys, and each registry name its ambient modules export, which `ambientNamesOf` asks the compiler
for (`bindableNames`). A program that names a chain (`Base.UniswapV3.Factory`) gets that chain's
module too. Modules and ABIs are served from memory, never a disk, and only to the SDK's own
installation: the compile hands them to the compiler as
ambient modules under a specifier drawn once per process (`INSTALLED_CHAIN_MODULE`), which no
program or module can write; `rs-compile.ts` serves a names module only at the absolute path that
specifier resolves to (the compiler refuses an absolute import), refuses a relative path into the
root, and refuses a caller `resolvePackage` that maps any specifier there, located at the import.
Imported, a name the chain lacks would be the program's own and escape the check; `checkNames`
still names the import, normalized as the compiler reads it, for the nicer message. The compiler
decides a test of a zero (`if (X)`, `!X`, `X != 0`, `?:`, `&&`, `||`) and does not compile the
branch it rules out; that is the whole presence mechanism, and `available(X)` is gone. 2.6.0 has no
zero that is unusable at run time, so `routes/absent-names.ts#checkNames` reads the program (and
every module the caller's resolver serves) before any rewrite and refuses, located and naming the
chain, every use of a name the chain lacks outside a branch a test of it rules out, a `require`
such a name makes false, a registry name no chain has, a method a registry contract's ABI lacks
(naming the contract and its methods), and the Pot's balance of an absent token. Code a test rules
out is read too, as on a chain that takes the branch: only a name this chain lacks is let be there,
and a misspelt contract, a protocol used as a contract or a method the ABI lacks is refused on every
chain, so a program that passes on the chain without the venue does not break on the one with it.
There it also refuses a balance read of an address the text declares (`user: Address`, the Pot) by
a name no chain registers as a token, and reports (`unknown`) each name nothing it knows gives
meaning to — not the program's in scope, the caller's, this chain's define, any chain's registry
name or the language's (`LANGUAGE_NAMES`: `builtins.json`'s roots, generated as `BUILTIN_GLOBALS`,
with the reference's `undefined` for a missing static member, `pot` and `Token`); `compileForChain`
drops those another chain's defines give, asks the compiler (`ambientNamesOf`, and the SDK's own
packages for the other target) about the rest, and refuses the first left, in the live arm's words
(`unknownNameError`). A module's are asked once its compile ends, never from inside a `resolve`.
A field of a value whose type the text does not show stays the compiler's, where the branch runs.
It also reports the code a test rules out (`dead`: an `if` arm, a `?:` arm, the right side of a
decided `&&`/`||`, the rest of a block after a decided `if` that always exits, its functions,
exports, types and module declarations kept and checked as if they ran), and each side of a
`&&`/`||` whose whole is a value, or a side of one through a `?:` arm or a nested `&&`/`||`
(`wrap`), that is, or may be, a contract binding (`bindingSides`): the language gives a bool, but
2.6.0 hands a binding back as the whole — measured, a names-module contract, a record field holding
`<Abi>.at(…)`, an inline `<Abi>.at(…)`, and a `const`/`let` alias of one through any chain of
aliases, resolved per scope by `lexical-bindings.ts`; a local initialized to `<Abi>.at(…)`, a `?:`,
a call or a parameter give a bool, and an import or another module's export is taken as one.
`compileForChain` applies all three in one pass (`withoutDead`: dead code blanked in place, spaces,
newlines kept, an `if` arm `{ }`, an expression `0`; a binding side written `!!(…)`, which is the
bool, the same bytes for a constant; a tested absent token `0`) before every rewrite, so the token,
venue, account and accessor passes never lower ruled-out code — on Solana they would add its
accounts and checks to `main`, which `available(X)`, removing the branch from the source, never
did. A module the caller serves gets the same `withoutDead` pass, returned by the `checkModule` hook
and served by `rs-compile.ts#makeResolve` in place of its text; no other rewrite reads it.
Its scopes are `lexical-scope.ts`'s, the compiler's: the module's names (a type-only import binds
none) and a function's parameters everywhere in them, a block's `let`/`const` from its declarator
on, a loop's or `catch` clause's binding in it — a function-wide shadow set once let a use after an
inner block reach the zero. What a module cannot hold stays a rewrite in `protocol-rewrite.ts`: an
interface bound to an address, `.at(address)`, a protocol's default-contract call, and `.address`
before a scalar method (`.toBytesBe`) on a binding or a local holding one through any chain of
locals, which 2.6.0 takes only on an address; it reads a namespace as the program's only where the
program declares it in scope, and as the caller's where the compile binds it. On Solana the module
holds no EVM contract, and the Solana lowering never sees an absent token: `checkNames` refuses a
live `pot.<TOKEN>` of one and `withoutDead` has blanked a ruled-out one.

**Every registry ABI is pinned against the deployed contract, offline.** `test/registry-abi.test.ts`
checks each function, event and custom error of each `abis.ts` export against
`test/fixtures/registry-abi/evidence.json`: the
deployed code must dispatch its selector (after resolving EIP-1167 clones, EIP-1967/beacon/legacy
proxy slots, `implementation()` getters, and diamond or selector routers), and where a verified ABI
exists, its outputs, mutability and struct field names must match. An event's topic and an
error's selector must be carried by the deployed code (a PUSH32 before its LOG, a constant before
its REVERT), an event's `indexed` flags must match the verified ABI, and each event's captured real
log (`logs` in the fixture, where a deployment has emitted one) must decode, strictly, with the
registry's own declaration. `targets.json` beside it is the
hand-written half: which deployments evidence which export (`roles` from `addresses.ts`, narrowed
by `chains` where one role's deployments run different releases, or representative `instances` for
interface ABIs), `probes` (extra signatures to ask a selector router about), and every exception
with its reason — `exempt` (a deployment that legitimately differs),
`unverified` (no verified source on any keyless source; the selector is still checked) and
`unverifiable`. An
exception that stops applying fails the test. `required` names an overload a consumer binds (with
the consumer): the registry need not declare every overload a contract has, but it must keep
declaring those, and removing one fails the test. So does a new export with no target, a deployment
of a targeted role the evidence does not cover (an `addresses.ts` edit not yet recaptured, or one
no export's `chains` includes), and a `<X>ABI.json` twin that is missing or no longer matches
`abis.ts` (regenerate with `bun run scripts/generate-abi-json.ts`, then prettier). The widened-type workaround the registry
used to carry (`uint32` for `uint24`, `uint256` for `bytes32`/`int*`) is gone: the pinned compiler
takes every ABI type, so declare the deployed one.

A target may name a protocol this tree does not have yet (one another branch adds): the suite skips
it and the capture carries its evidence over untouched, so the evidence can land before the
protocol does. Deployments whose address is not a 20-byte EVM address (Solana program ids) are not
captured: no EVM ABI applies to them.

Recapture only on explicit request — it reads live chains: `pnpm --filter './sdk' build` (the script
reads `dist/`), then
`node scripts/capture-registry-abi.mjs --recapture --rpc-config rpc.config.json [--chains <id>,…] [slug ...]`
from `sdk/`, with no slugs for everything (about 540 deployments; responses cache under
`node_modules/.cache/registry-abi/`, and `--no-cache` bypasses that). Without `--recapture` it
refuses to run. `--chains` narrows the run to those chains' deployments and keeps every other
chain's evidence as captured. RPC endpoints come only from the `--rpc-config` file, a JSON object of
chain id to URL. Keep yours at `sdk/rpc.config.json`, which is gitignored, starting from the
committed `sdk/rpc.config.example.json`, which holds `<…>` placeholders and never a real URL. The
script reads nothing from the environment and has no public fallback: before its first request it
fails, listing each chain id the selected deployments need that the file does not give. Verified
ABIs come from Sourcify, Blockscout and keyless Etherscan-compatible APIs. The fixture must never hold an endpoint
or key; the suite greps it. Review the fixture diff before committing it: a changed selector map is
a contract upgrade to look at, not noise.

**Every token-registry row is pinned to the chain, offline, and the stock tokens come from their
issuers.** `test/token-registry-evidence.test.ts` checks each EVM row of `TOKEN_REGISTRY` against
`test/fixtures/token-registry/evidence.json`: code at the address, `symbol()` and `decimals()`; and
each mainnet-beta mint of `SVM_TOKEN_REGISTRY`, under Solana's chain id 1399811149: its owner is the
row's `tokenProgram`, it is initialized, has the row's decimals and its metadata symbol (the mint's
own TokenMetadata, else Metaplex's), a checked transfer of it is refused for nothing
(`resolveSvmToken`'s `transferRefusals`: no hook program, no pause, no frozen default), and it
charges a transfer fee exactly when its issuer's `STOCK_ISSUERS` entry says `transferFee`.
`node scripts/capture-token-registry.mjs --recapture --rpc-config rpc.config.json [--chains <id>,…]`
(from `sdk/`, no build needed) writes it, reading endpoints only from that file, as the registry-ABI
capture does. A row added without recapturing fails the test. The tokenized stocks (Backed's
xStocks and bTokens, Ondo's and Mt Pelerin's MPS on Ethereum, Coinbase's on Base) are
`src/routes/stock-tokens.generated.ts`, written by `pnpm --filter './sdk' sync-stock-tokens` from
each issuer's own list (`STOCK_ISSUERS` in `stock-tokens.ts`, never an aggregator), and merged into
`TOKEN_REGISTRY` as rows with `stock`. Sync, then recapture, and review the address diff. A stock's symbol is its issuer's ticker with "." as "_"
(`TSLAx`, `bTSLA`, `BRK_Bx`), so it is not always uppercase: the registry keeps symbols unique per
chain without regard to case, and the CLI looks them up that way. Coinbase's are B20 tokens,
precompiles of the Base node whose account holds the single byte `0xef`: anvil cannot run them
(`OpcodeNotFound`), so no execution suite may depend on one; the evidence reads them through
`eth_call` on the live chain, and `--assume-balance` refuses one by that code. Ondo's rows are the
registry page's that Ondo's app lists (`app.ondo.finance/api/v2/assets`), which leaves out a token
not launched yet. On Solana the stocks are Token-2022 mints (`SVM_STOCK_TOKENS`, merged into
`SVM_TOKEN_REGISTRY["mainnet-beta"]` with `tokenProgram` Token-2022): Backed's Solana list, Ondo's
`solAddr` column, Backpack's `<ticker>.US` assets it takes deposits of (its list carries mints it
has not opened; the evidence holds each copied one to a supply above zero) and PreStocks' product
page. Backpack's symbol is `NVDA_US` while the mint's metadata says `NVDA` (the row's ticker, which
the evidence checks); PreStocks' mints charge a transfer fee. Superstate is left out (allowlisted
holders only). `sauce globals` and `sauce_globals` count a chain's stocks by default;
`--stocks`/`stocks` lists them and `--search`/`search` finds one. `sauce pot` on Solana reads the
Pot's account for every registered mint but the stocks. Every compile hands the chain's token map to
the compiler as defines, so a chain with a thousand stocks costs about 2 ms more per compile (Ethereum
and Solana alike); that goes away with the compiler's lazy `declare` (v12 #550), and the SDK does not
scan program text to trim it.

`src/std/` is the SauceScript **standard library** — source shipped for the compiler to consume, not
TypeScript. `src/std/token/` is `@sauce/token` (an ERC20/SPL token interface behind one import), and
**the SDK owns it**: this directory is the source of truth, edited here like any other source. The
engine (`v12`) repo has a package of the same name under its compiler's test fixtures, but that is
v12's own INTEGRATION fixture — independent, not kept in sync, and not a reference for this one. Do
not port changes from it or treat a difference between the two as drift. It used to be the other
way round (this was a byte-identical copy, left unformatted to stay one); it no longer is.

The EVM arm's writes are OpenZeppelin `SafeERC20`: a raw `evm.call`, then empty returndata accepted
only from an address with code and anything else decoded as a word that must equal 1, with `approve`
as `forceApprove` (read the allowance, reset a non-zero one first). **Every token write the SDK
offers has these semantics** — a standing rule, not a default. The route-body syntax (`<Sym>.transfer(...)`,
`Token(addr).transfer(...)`, see below) compiles to calls into this library, and the registry
templates (`protocols/{erc20,gho,frax,crvusd,cbeth,liquity-v2}/functions.ts`) import it;
`compile.test.ts` fails any template that issues an ERC-20 write through a typed `.at(...)` binding.
The ONE unchecked spelling is an `IERC20.at(addr).transfer(...)` a user writes explicitly: the raw
ABI call, which decodes the declared `bool` — reverting on USDT, accepting `false` — kept as the
escape hatch and documented as not `SafeERC20`. `src/token/safe.ts` emits the
same semantics INLINE into routes, deliberately not as calls into this library: the settle recipe
is compiled by partners whose resolver serves only `./artifacts/IERC20.json`. What keeps every
spelling on one behaviour is `test/std/token/evm.e2e.test.ts`, which runs OpenZeppelin's own
`SafeERC20`, this library, `safe.ts` and the three route-body spellings (each through
`compileSauceRoute`) over one matrix of tokens (false, empty, no code, a word of 2, 1/31/64-byte
returns, USDT's standing allowance, honest refusals) and requires identical outcomes, with the raw
`IERC20.at` binding beside them as the contrast.
CI also pins what a wrong digit would break silently: `test/std/token/compile.test.ts` derives the
two token program ids the SVM arm guards on (SPL Token and Token-2022) from their base58 addresses,
and each selector the EVM writes spell out by hand from `keccak256` of its signature, and counts them
in the emitted bytecode. It has two per-target arms (`token.evm.js`, `token.svm.js`) and
**deliberately no neutral `token.js`**: a token program is inherently target-specific, and a neutral
file would turn a missing arm into a confusing missing-EXPORT error instead of a clear failure to
import the package (`package.json`'s `main` names the neutral BASE the compiler suffixes per target).
The per-arm signatures genuinely differ where the account models force it — SVM `totalSupply`/
`decimals` take the mint as an `Account` while the EVM takes an `Address`, and the SVM writes take
6 args to the EVM's 3–4.

**The SVM arm takes SPL Token and Token-2022.** Every read (`balanceOf`, `ownerOf`, `allowance`,
`totalSupply`, `decimals`) accepts an account owned by either program; a Token-2022 one is held to
its base layout and, where it carries extensions, its account-type byte (byte 165: 1 mint, 2
account), never the multisig's 355 bytes. The CHECKED writes, `transferChecked` and `approveChecked`
(the mint as an `Account` and its decimals; SVM-only, no EVM arm), CPI `TransferChecked`/
`ApproveChecked` into whichever program owns the source, destination and mint, require it to be one
of the two, require the mint to be the named token and the decimals the mint's, and refuse
(`"transfer hook"`) a mint whose TransferHook names a program — its ExtraAccountMetaList accounts
cannot ride in a fixed account list, and Token-2022 would otherwise fail with an opaque missing
account. A hook with no program, transfer fees (a program measures balance deltas), scaled UI
amounts (raw only), pauses and frozen accounts are the token program's to apply. **The legacy
`transfer`/`transferFrom`/`approve` are unchanged and SPL-Token-only, byte for byte**:
`compile.test.ts` compiles them against `test/std/token/fixtures/legacy-token.svm.sauce.ts`, the arm
as it was before, and requires identical bytecode — "you can't break existing sdk". Taking
Token-2022 grew the reads (a first read is about 260 bytes where it was 135; a program that moves a
Token-2022 token and measures what arrived needs staging), so mind transaction size when adding a
check here. The SDK side: `svm/token-accounts.ts` (`resolveSvmToken`: a mint's program by its owner,
decimals, extensions, transfer refusals; `svmTokenAccount` derives an ATA under the mint's program;
`svmTokenReceived`/`svmTokenToSend` net fees with `token-extensions.ts`), the registry's per-row
`tokenProgram`, and the CLI's `program:<token>`/`mint:<token>` account forms.

Verified in `sdk/test/std/token/`: `compile.test.ts` (both targets, all seven shared methods plus
the SVM-only `ownerOf`, `transferChecked` and `approveChecked`, the SVM account manifest, the legacy
writes byte for byte, and the no-neutral-arm packaging invariant — always runs, no engine needed)
plus `svm.e2e.test.ts`/`svm-token-2022.e2e.test.ts`/`evm.e2e.test.ts`, which EXECUTE the compiled
bytecode against real SPL accounts, real Token-2022 accounts created by the real ATA program (two
real tokenized-stock mints and PYUSD as mainnet holds them, and a mint per extension), and a real
deployed ERC20 — see `SAUCE_RUST_ENGINE_SO`/`SAUCE_V12_RUNTIME_CREATION_HEX` above for why those are
gated. `src/std/token` **ships** two ways: embedded in
`src/embedded/sources.generated.ts`, which is what the SDK's own compiles resolve (see the next
paragraph), and as files under `dist/std/token` (`copy-verify-assets.mjs`) for a consumer that
resolves it off disk.

`src/std/router/` is **`@sauce/router`**, the SauceScript swap library, SDK-owned and shipped the
same two ways (embedded, and `dist/std/router` via `copy-verify-assets.mjs`); `resolveSdkPackage`
maps it like `@sauce/token`, so every SDK compile — route bodies, programs, actions — resolves it
with no option. It has two arms and, like `@sauce/token`, no neutral `router.js`: no venue is on
both targets, so a function one arm lacks fails at its import, naming it ("`woofi` is not exported
by module" on Solana). The EVM arm (`router.evm.js`) is THE one implementation of a swap at its eleven venues: one exported function
per venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, `dodoV2`, `traderJoeLB`,
`woofi`, `maverickV2`, `infinityCL`, `infinityBin`), every argument a RUN-TIME value, in one order —
`venue(pool, tokenIn, tokenOut, amountIn, ...venueFacts, minOut, recipient)` — returning the amount
the recipient received; plus a `try` form of each that returns `0n` having moved nothing, while a
swap that ran returns at least 1, so a `0n` ALWAYS means nothing moved (sauce-recipes' EcoSwap
executor drops a venue that returns 0 and re-offers its input). Every `try` form first skips a
pool, Vault or PoolManager with no code (`ctx.codeSize`): a call to no code succeeds with empty
data, which a catch does not see, so without it Curve's fails its own `out > 0` check, Balancer's
decode reverts outside the catch, and V2's and LB's views revert. Then three mechanisms: a check
before anything moves (`tryUniswapV2` the reserves, `tryTraderJoeLB` `getSwapOut`, `tryDodoV2`
`querySellBase`/`querySellQuote`, `tryWoofi` WooPPV2's `query` — never its `tryQuery`, which prices
past the reserve; DODO's and WOOFi's views are caught, V2's and LB's return several words and are
read uncaught, so a contract with code that is no pair reverts those two), a caught pool call that
resets its approval (`tryCurve`, `tryBalancerV2`), or a caught Router call (`tryUniswapV3`,
`tryUniswapV4`, `tryMaverickV2`, `tryInfinityCL`, `tryInfinityBin`). A `try` form still reverts on
arguments that contradict each other, as its plain function does (a pay-first venue's same token in
and out, DODO/LB tokens other than the named pair). The generation-4 Router takes no floor, so a
caught Router call that ran is held afterwards to `minOut` and at least 1 and reverts below it (an
input the pool keeps as its fee cannot be undone), except that one that moved nothing either way —
the Router's `amountInUsed` and
the recipient's `tokenOut` gain both 0, a pool with no liquidity in range — returns `0n`. The
compiler carries only a scalar through `.catch()`, so the try forms call the Router through
`sauce-router-paid.abi.json`, its methods declaring `amountInUsed` alone. An empty pool with no
price limit costs a full tick walk (~10M gas measured) before it is skipped.
The `swap*.mainnet` suites execute every function and its `try` form on real pools (Infinity on
Base), each skip path with the Pot's and the pool's balances held unchanged. The pay-first venues
call the pool directly; V3/V4/Maverick/Infinity call the Pot's Router (`ctx.self()`). Token writes are `@sauce/token`'s
(it imports the package). Orientation is checked from the arguments at run time (V2/V4 sort order,
DODO base/quote, LB X/Y); `minOut` is uniform (`0n` none; WOOFi requires it). The pool and Router
ABI fragments live beside it (`*.abi.json`, each `$comment` naming its verified source), pinned by
`test/std/router/compile.test.ts` (deployed selectors, the released `ISauceRouter`, the registry
twins), which also holds the export list to the documented API and refuses a module-level `const` —
a program-wide define would replace it. Keep its functions FLAT: an internal helper call costs a
frame (measured ~1–4k gas each on the engine), so each exported function is self-contained.

The SVM arm (`router.svm.js`) is the Solana distributed swap's per-pool code, extracted, and a
limit-order swap at each Solana venue whose swap stops at a price limit, in four forms. Unlike the
EVM arm there is no `try`/plain pair: each slot function is ONE function with the `try` behaviour,
returning `0` having moved nothing where the pool cannot trade (below) and reverting below `minOut`.
AT A PRICE: one function per venue of the distributed swap (`raydiumClmm`, `pancakeswapClmm`,
`byreal`, `stabbleClmm`, `orcaWhirlpool`, `cropper`, `defituna`, `crema`, `phoenix`), all
`(slot: Account[], trader: Account[], amountIn, priceLimit, minOut, recipient: Account)` — arrays
because a non-`main` function keeps ~16 values — `priceLimit` fee-inclusive in the skill's units,
each function working out the pool's own sqrt limit (or Phoenix ticks). There is no all-venue
`swap`: a program names each pool's venue. AT THE POOL'S OWN LIMIT: `<venue>AtLimit` for those nine and Invariant and
OpenBook v2 (`(…, priceLots, orders, minOut, recipient)`), and Manifest's `manifest` (no limit: its
swap has none; Invariant's program does NOT stop at its limit — a swap reaching it with input left
fails `0x1778` and aborts the transaction, measured at 1,000 USDC on the fixture's window — so there
the input must fit), taking the pool-native limit a caller computed (Q64.64 sqrt; Invariant's 1e24
root; Phoenix ticks; OpenBook price lots; 0 = none where the venue takes it): no fee read and no root, so adaptive-fee Orca and Byreal's own-fee pools trade here, and
`minOut` rides in the venue's own floor field where its instruction has one (the others' recipient is
measured). THE INSTRUCTION ALONE: `<venue>Cpi(program, accounts, source, amountIn, …[, aToB | xToY |
paysBase])` takes the CPI's accounts in the venue's own order, checks the program only, reads only
`source` before and after, and returns what it paid (`debit` if more than `amountIn`). ITS DATA:
`<venue>Data(amountIn, …)` (Orca: `orcaWhirlpoolData` for the classic `swap`, `orcaWhirlpoolV2Data`;
Phoenix/OpenBook take the market's lot sizes) returns the instruction's bytes, checking only that a
field can carry its value (`minOut past 64 bits`, a sqrt price limit's `limit past 128 bits` — cut to its 16 bytes 2^128 would be 0, which the CL venues read as NO limit, reproduced on the real Raydium program by review — Phoenix's `limit past 64 bits`, OpenBook's `limit
past its field`); the at-limit forms build their data with it. The at-price forms (`swap<Venue>`)
write it INLINE and UNCHECKED from `clmmOrder`'s 32 order bytes: their floor
is 0 and their limit is under 2^128 by construction, and the range checks, Raydium's 17-account
bitmap list and Orca's classic `swap` cost the distributed swap ~1.7 KB when they rode on that path
(8,006 bytes where #102's was 6,319; `compile.test.ts` holds `swap` to carrying none of the
range checks' reasons and one `swap` per venue code). `…Cpi` writes the same bytes INLINE (measured: calling `…Data` from `…Cpi` cost it ~2k CU — +8.7k vs +6.7k on DefiTuna
— so b1aeaf48's routing was reverted for `…Cpi` in a later commit; Phoenix's alone stays on
`phoenixData`, which measured 1.6k cheaper than its inline copy). Every form is held byte for byte
to the recipes' templates by the at-limit e2e, so the two copies cannot drift unseen. `…Data` is the
CU-minimal form (eco-incorp/sauce-recipes' served swaps: `svm.call(program, [accounts…],
<venue>Data(…))`): +3.2–4.0k CU over the recipes' hand-built CPI on the CLMMs, `…Cpi` +6.8–9.9k,
`…AtLimit` ~+81–97k (measured in `svm-at-limit.e2e.test.ts`). The gap between `…Data` and `…Cpi`
is MOSTLY THE ACCOUNT ARRAY (measured, DefiTuna's 14 accounts): a literal list written into
`svm.call` costs ~100 CU, the same list passed to a function ~4.4k (~300 an account, built as an
array first), which an `Account[]` parameter always forces — and `main` cannot take an `Account[]`.
A 3-argument data function costs ~1.1k over the same code inline, a `bool` direction ~700 more.
Reading an account out of an array costs ~2k CU, a hex literal ~1.6k, `toBytesLe` ~3–5k — so each
venue's data is ONE packed word written with one `toBytesLe`, each field its low bytes. `@eco-incorp/sauce/svm`'s
`routerSvmAccountOrder(venue, { aToB, v2?, adaptive?, bitmapExtension?, tickArrays? })` (Orca's `swap_v2` oracle ALWAYS writable — a read-only one is ConstraintMut 2000 on the real program; the classic `swap`'s only for `adaptive`) names each
instruction account in order with its writable/signer flags, `routerSvmAccounts(…, refs)` builds the
list from a value per name, and `ROUTER_SVM_VENUES` gives each venue's program and `…Data`/`…Cpi`
names (`sdk/src/svm/router-accounts.ts`; `test/svm/router-accounts.test.ts` holds it account for
account and flag for flag to the recipes' templates). `routerSvmDataTemplate(venue, options)`
(`sdk/src/svm/router-data.ts`) writes the data around the amount in TypeScript —
`prefix ‖ u64le(amountIn / divisor) ‖ suffix`, the recipes' own template shape, zero on-chain
encoding cost — and throws at codegen for a field past its slot, because the compiler does NOT
fold `…Data`'s range checks for a literal argument (measured: the guard and its reason string stay
in the bytecode and cost ~600 CU each, even for a literal, even for an always-failing 2^128 limit;
`test/svm/router-data.test.ts` holds its bytes to every template). A slot's accounts past its nine (`more`, at a limit only — at a price a slot is
its nine): Raydium-layout pools' tick-array bitmap
extension (17 accounts, more values than a function holds, so that list is FILLED IN PLACE from a
literal of one repeated value — a literal of 17 distinct values does not compile in a non-`main`
function), Invariant's program authority, OpenBook's oracles; Crema and Invariant pass their slot's
leading tick arrays only (a System program ends them), each count its own `svm.call` site (an
account array has a fixed element count). At a limit Orca's builder sends the classic `swap` when both mints
are SPL Token's, `swap_v2` otherwise; at a price always `swap_v2` (so its oracle must be writable
there). A slot function can only CHECK before the swap (a failed CPI aborts the
whole transaction): `0` having moved nothing for a missing slot, no input, swaps off,
paused/closed, empty, past the limit, dust (an input that buys under one unit at the pool's price
after its fee, `dust`; at a limit judged at the base fee), under one lot, an order that filled
nothing (told by the paying account's balance, `settled`), and at a price a fee that is not one rate
and a Phoenix limit past 64 bits; a swap that paid returns at least 1, held to `minOut`. A wrong
pair, a slot whose program is not the pool's owner, a pool of another venue or of none, and a limit
an order cannot carry revert (caller mistakes, never 0); only the System program itself as the pool
is a missing slot. Each EXPORTED venue function checks its own program id, so a call never signs a
CPI into a program the caller names. Unlike the EVM arm, Solana is SIZE-bound, so its code is
shared through internal functions
(each venue's `…Data`, `cpi<Venue>` laying out a slot, `swap<Venue>`, `clmmOrder` — which reads
the pool at its venue's offsets, ~250 bytes smaller and ~5k CU a pool dearer than reading at
each call site — `clmmCan`, `settled`): a program carries only the venues it calls (one venue's
function ~0.9–1.7 KB, its `…Cpi` ~0.4–0.5 KB, its `…Data` ~0.2–0.4 KB; the distributed swap, its
pools found by key in loops over Orca's spacings and Raydium's fees, 3,955 bytes and 46 accounts
named, cooks two trading pools and two keys with none in about 535,000 CU). `compile.test.ts` pins its exports, each family's argument order, each venue's
program id (from the SDK's base58 ids) and instruction discriminators counted per function, and its
revert reasons; `svm.e2e.test.ts` executes every price-limited function on the venues' own programs
in LiteSVM against `fixtures/inline-trade.svm.sauce.ts`, the helper as the skill carried it, from
the same state; `svm-at-limit.e2e.test.ts` executes the other three forms, holding each venue's CPI —
read back from the transaction's inner instructions — byte for byte to
`fixtures/recipes-swap-templates.json`, the swaps eco-incorp/sauce-recipes builds for the fixture's
pools (`scripts/recipes-swap-templates.mjs --recipes <checkout>` regenerates it, run with that
checkout's `tsx`), and prints a CU table. The venue fixture gained Invariant, Manifest, OpenBook v2,
an adaptive-fee Orca pool and the Raydium-layout pools' bitmap extensions through
`dump-svm-venues.mjs --add`, which dumps only what the fixture lacks and moves nothing it holds (each
pool it adds records its own `slot`); `restoreVenues` gives a kept wrapped-SOL token account that
recorded no lamports its amount on top of rent, as the token program expects.

The SVM arm's EXACT INPUT section (the end of `router.svm.js`) is the rest of the Solana venues, in
three forms each, as the limit venues' instruction forms are: `<venue>Data(amountIn, …, minOut,
<direction>)` (the instruction's data alone; the caller sends it), `<venue>Cpi(program, accounts,
source, amountIn, …, minOut, <direction>)` (the data inline, sent on the caller's list, returning
what `source` paid), and `<venue>(slot, trader, amountIn, minOut, recipient)`, which reads the
direction from the slot, builds its data with `<venue>Data`, and returns `0` having moved nothing
for what it can see first (a missing slot, no input, the venue's own skips). In `…Data`/`…Cpi`
`minOut` is written as given and the direction (`aToB`/`paysBase`/`xToY`) is a literal argument
where the data says it; the slot forms write `minOut` at least 1. Every exact-in venue is in
`sdk/src/svm/router-accounts.ts` (`ROUTER_SVM_VENUES` by the recipes' venue names,
`routerSvmAccountOrder`/`routerSvmAccounts`), tested account by account against the recipes'
instructions (`test/svm/router-accounts-exact-in.test.ts`), and in `router-data.ts`'s `EXACT_IN`
table (`routerSvmDataTemplate`: `prefix ‖ u64le(amountIn) ‖ suffix`, divisor 1, its options the
account order's `aToB`, `minOut` and the venue's own fields), held byte for byte to every vector
(`test/svm/router-data-exact-in.test.ts`). Two historical measurements shaped these forms,
on compiler 2.5.0 and the then-released engine (not remeasured for compiler 2.6.0 / v12-svm 1.4.0):
a function other than `main` cannot build an account-array literal of more than 16 elements ("keeps too many values in use at once"; `new
Array(n)` holds only numbers, a function cannot return accounts, and account arrays cannot be
concatenated), so a venue whose swap takes more accounts has only its `Cpi` and `Data` forms; and
each account read out of an array argument and passed to `svm.call` costs ~1.4k compute units more
than one of `main`'s own parameters. `svm-exact-in.e2e.test.ts` runs every form, and the recipes'
template by hand, on the venue's own mainnet program (`test/fixtures/svm-exact-in-programs/`,
gzipped `solana program dump`s with their sha256 in `manifest.json`) and pool accounts, both
directions, and holds each instruction to the one sauce-recipes builds
(`fixtures/exact-in-vectors.json`, generated there by `resolveSvmSpecSlot` and the ladder's
`buildSwapV2`, each account with the recipes' role) and each trade to the recipes' real-program
pins; it logs each form's compute units. A Pot cannot create a PumpSwap buy's volume accumulator
(the System program moves no lamports out of an account with data), so the suite creates it first
with another payer. A venue that reads the time is booted at its vector's own: a case's `atSlot`/
`atEpoch` set the Clock and the EpochSchedule (Voltr's withdrawal and the liquid-unstake vault fail
or overflow at the default clock), and the boot keeps each fixture account's recorded `lamports`
(the liquid-unstake vault prices off its SOL vault's). Sanctum Infinity's stake-pool calculators
read their stake pool program's ProgramData, which loading the program replaces with LiteSVM's own:
its case's `fabricate` writes the captured header back with the program's ELF behind it. A venue
`@sauce/router` has no function for (One Intro, BisonFi, the Sanctum stake pools and the three
native-SOL curves, and Quantum, Obsidian and AlphaQ, which admit only routers on their list: a Pot
cannot swap there; WOOFi, Metric: no provable swap) has `data`/`cpi` null in `ROUTER_SVM_VENUES`,
and where its
instruction lands, the suite's `WALLET_ONLY` cases send it from a wallet, built from
`routerSvmAccounts` and `routerSvmDataTemplate` alone. WOOFi's `swap` returns success and moves
nothing when `from_amount <= min_swap_amount` (a u128 at its pool's offset 155): a WOOFi fixture
with those bytes patched swaps nothing and still succeeds, which is not a swap.

`@sauce/token` is the **default ambient MODULE** of a program. `manifest.json`'s `ambient`
list (`["@sauce/token"]`) is handed by `chainAmbient()` to every `compileSauceProgram` compile, so
its exported functions (`approve`/`transfer`/`balanceOf`/…) are callable in any program compiled
that way with **zero import**. `compileSauceProgram` and no further: it is the one compile that
calls `chainAmbient` (`source-globals.ts` reads it only to list a chain's names), and
`compileSauceRoute` passes its caller's `ambient` straight through without merging this list in —
so a direct `compileSauceRoute(..., {})` gets no ambient module at all. This resolves because
`embedded/resolve.ts`'s `resolveSdkPackage` maps the bare
`@sauce/token` specifier to the embedded copy of `src/std/token`, ahead of any caller
`resolvePackage` — an ambient module the compile can't resolve makes EVERY route throw, so that
list must only ever name modules the SDK resolves itself. Two DISTINCT mechanisms
share the word "ambient": ambient **DEFINES** (`chainDefines` — chain-scoped SCALARS: chainId,
protocol addresses, token symbols) vs ambient **MODULES** (this — whole library exports).
`compileSauceProgram` passes its chain's ambient defines as `RouteScope.chainDefines` beside the
options rather than in `compile.defines`, so its `defines` stay the caller's; `compileScopedRoute`
takes the scope and `compileSauceRoute` is that with an empty one.

The **`Token(addr)` global wrapper** (`Token(addr).approve(spender, amt)` / `const t = Token(addr);
t.approve(...)`, zero import) and the **`<Sym>.transfer(...)` symbol syntax** are TEXTUAL rewrites in
`token-rewrite.ts`, run in `compileSauceRoute` before the compiler, and both lower a WRITE
(`transfer`/`approve`/`transferFrom`) to the `@sauce/token` function of the same name with the
token first: `USDC.transfer(to, amt)` → `__sauce_transfer(USDC, to, amt)`, with
`import { transfer as __sauce_transfer } from "@sauce/token"` prepended (`tokenImportLines`). So a
write has ONE implementation however it is spelled, and it is the library's SafeERC20 one. The import
is ALIASED (the pinned compiler, 2.6.1, accepts `import { a as b }`), which keeps a program's own
`transfer`/`approve` from colliding; the `__sauce_<method>` names are reserved
and a program declaring one is refused by name. It is an explicit import, not the ambient module,
because `compileSauceRoute` never merges `chainAmbient()` in. A READ (`balanceOf`, and any other
method on `Token(...)`) stays on the typed `IERC20.at(...)` binding — a `uint256` is always there.
A write returns nothing, so one whose result is read (`const ok = USDC.transfer(...)`) is refused,
and the source-global and `TokenBinding` types declare the writes `void`. A bound `Token(...)` is
lowered only when the name is declared once in the whole program, never reassigned and only ever
called as `t.<method>(...)`: the binding then holds the ADDRESS and each call is lowered by name.
Any other `Token(...)` — an argument, a value, a reassigned or passed binding — is REFUSED with an
error naming the safe spellings, never passed through as the typed call (which would be the
unchecked write again). Both rewrites are shadow-safe and svm-rejected: a program that binds
`Token` anywhere owns the name everywhere, and one that binds a symbol owns it where that binding is
in scope, as the compiler scopes it (`routes/lexical-scope.ts`: a module's names and a function's
parameters everywhere in them, a block's `let`/`const` from its declarator to the block's end, a
loop's or a `catch` clause's binding in the loop or the clause; probed on the pinned compiler). The
SVM arm's writes need SPL account slots the sugar has nowhere to put.
The compiler therefore never sees a method call on a `Token(...)` result, and no compiler feature is
needed — the earlier "`Token(addr)` needs a compiler feature" framing only applied to making
`@sauce/token` _export_ a real `Token` value (blocked by the M1 subset).

**The balance shorthand `<holder>.<TOKEN>` is `<TOKEN>.balanceOf(<holder>)`, to the byte**
(`token-rewrite.ts#collectBalanceSites`; on Solana `svm-token-rewrite.ts`). It emits the symbol, not
its address, so a define reaches both spellings, and takes any address-valued holder: the holder's
text stays in place for the accessor pass after it (`UniswapV4.PoolManager.WETH`,
`UniswapV4.StateView.poolManager().USDC`), `X.at(a)` (`.view`, `.lib`) on a contract type — a
registry contract or interface, an ABI imported from a `.json` module, a name the program does not
declare; never a name it binds to a value, which shadows an import of that name — and
`<Ns>.<Interface>(a)` unwrap to `a` (on a bound contract `.at(…)` is its own method), a
token's own contract is one (`WETH.balance`; on Solana a mint, its token accounts derived off its
key), a `pot` the program does not declare where it is read (`lexical-scope.ts`), nor the compile
binds (a `defines` key or a `contracts` binding), or `ctx.self()`, is the Pot (as on Solana, and
for the accessor pass's bare `pot`, which becomes `ctx.self()`; on Solana the lowering consumes
every such `pot` itself, as the Pot slot's key, or its account where an `Account` is expected); a
`pot` the program declares or imports by name, a `defines` key or a `contracts` binding is an
ordinary variable. A `pot` that only a caller's ambient module exports, read with no import, is
neither: it is refused where it is read (`pot-sugar.ts#ambientPotRefusal`), so no module's export
stands in for the Pot with no word in the program (an ambient `self` stays the caller's value). The
SDK never works out an ambient module's exports itself: `rs-compile.ts#ambientNamesOf` asks the
compiler, compiling the program's own imports, as written, before a `main` that reads nothing and
an uncalled closure (so the compiler loads the modules the compile does and lowers nothing; the
closure's function is named apart from every define, contract and name the program writes), with
the compile's own options and one more ambient module exporting the names asked about that the
program or a module the compiler loads mentions (recorded as the probe's `resolve` serves them,
identifier escapes decoded, so `L\u0069do` is `Lido`; the
compiler loads the probe's module last), and reads each name the compiler refuses as exported
twice; any other refusal is no answer:
the names stay free, the compile reports its own refusal, and the probe's is thrown where the
compile succeeds or a rewrite reading the answer refuses; both read the caller's options as
`sauce-route.ts#readCompileInputs` read them once when the compile began, lists and records
copied, so a callback changing the caller's objects reaches neither, and the caller's resolvers
through one snapshot per compile, `firstAnswers`; nothing of it is remembered between compiles,
the compiler's own caches keep it cheap. `.<SYMBOL>` is always a registered token; the chain's
native coin is `<holder>.balance`:
`ctx.selfBalance()`/`ctx.balance(h)` on an EVM chain, `ctx.balance(<account>.address)` on Solana,
so on Arc `pot.USDC` is the 6-decimal token and `pot.balance` the coin. `.balance` on a record, a
list or a contract call's result (`market.userCollateral(a, b).balance`), `X.at(a).balance()` and a
namespace's own member keep their meaning. The retired spellings (an undeclared `self`,
`self.<TOKEN>`, `<holder>.<native symbol>`, `Solana.self`) are refused naming the new one
(`routes/pot-sugar.ts`). Being textual it sees no types, so it refuses by name what the program's
text says is not an address — a record or a list (`balance-holder.ts`), an interface with no
address — and a misspelled symbol is named once the compile fails, from the compiler's byte span
(`unknown-global.ts#unknownBalanceError`). A struct a contract call returns is not seen: a field of
one named like a token would be read as a balance. `balance` is the other way round
(`balance-holder.ts#readsField`): on a contract call's result, a value imported from a module or a
record field the declaration does not type, `.balance` is left as the field it may be, and only
where the registry records the result as an address (`contract-results.ts`) is it the native coin;
`x.balance` the compiler then finds no field of names `ctx.balance(x)`.

**On Solana the token methods and the venue namespaces add their accounts to `main`.**
`USDC.transfer(to, amount)`, `approve`, `transferFrom`, `balanceOf`, `pot.USDC`, `Token(mint)`,
`<Protocol>.<Program>.swap(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut)` (the nine
price-limit venues, protocol then program as on an EVM chain: `Raydium.CLMM`, `Pancakeswap.CLMM`,
`Byreal.CLMM`, `Stabble.CLMM`, `Orca.Whirlpool`, `Cropper.Whirlpool`, `Defituna.Fusion`,
`Crema.CLMM`, `Phoenix.Market`; ONE swap, and a `try` spelling is refused; there is no chain-level
`Solana.swap`; and `Meteora.DLMM.swap(pool, tokenIn, tokenOut, amountIn, minOut)`, the venue's own
exact input with no `priceLimit`, lowered to the router's `meteoraDlmm`, a slot form laying out
seventeen accounts in place — its first two bin arrays for `swap`, the first for a Token-2022 mint's
`swap2` — which `svm-dlmm.e2e.test.ts` holds to the venue's own swap of the same amount) with its
pool found by key, `<Protocol>.<Program>.pool(tokenA, tokenB, key)`, as an
EVM factory's `getPool` (`svm/pool-keys.ts`: the PDA of the pair, lower key first, and a tick
spacing for Orca/Cropper/DefiTuna/Crema or a fee for the Raydium-code four, each fee its `AmmConfig`s
from a table of every config the four programs keep, pinned to
`test/fixtures/svm-pool-keys/amm-configs.json`, which `scripts/dump-amm-configs.mjs --redump|--check
--rpc-config <file>` reads from mainnet; a fee two configs charge (Raydium's and PancakeSwap's 0.01%
and 0.05%) names a pool under each, the cook taking the one there and refusing two, naming each, for
the tick spacing to follow the fee, `pool(USDC, WSOL, 100, 1)`; Phoenix has no `pool`), written as the
swap's pool with its key a literal or a `for…of` variable over literal keys, which
`unrollPoolKeyLoops` writes out once per key (`if (true) { const k = 4; … }`; a loop that `continue`s
stays a one-key loop; `break` and a label are refused), are lowered by `routes/svm-lowering.ts`, one
engine with a collector per syntax (`svm-token-rewrite.ts`, `svm-venue-methods.ts`): each call
becomes its library function (`@sauce/token`'s SVM arm; for a namespace the venue's OWN
`@sauce/router` function, `orcaWhirlpool`) and every account it takes is appended to `main` as an
`Account` parameter, with how it is derived written as an `--account` value in
`CompiledSauceProgram.derivedAccounts` (`pot:USDC` where the program names `pot` in any form, else
`authority:USDC`; `@to:USDC`, `mint:USDC`, a program id,
`slot:@pool:USDC.vaultA`, `slot:Orca.Whirlpool(USDC,WSOL,4):USDC.vaultA`, where a key with no pool,
or an account at its address the venue does not own, resolves to an empty slot of nine System
programs). The CLI's `prepare` refuses a cook naming more than the 64 accounts a transaction locks,
naming the pool each key found. ONE resolver,
`svm/account-names.ts#resolveSvmAccountName`, turns a value into an address from the cook (owner,
Pot, `via`, main's arguments, a mint program reader that FAILS CLOSED, an account loader for a
pool's slot, `svm/pool-slot.ts`, shared with `sauce pools`); the CLI's `prepare` fills every derived
slot with it under `--account`, so the CLI and MCP share it. SPL Token mints take the legacy writes
(224 bytes and an account smaller), Token-2022 mints the checked writes with the registry's
decimals, an argument's mint the checked write with its decimals read on chain. Every holder's token
account is checked on chain after the write (owner bytes 32–64), so a builder cannot redirect it; an
explicit `Account` in a holder's place is paid as attached, unchecked (documented). Holders, mints
and pools must be known at build time (`pot`/`ctx.self()`, an `Address` parameter, a 32-byte key);
anything else is refused. A site in a top-level function takes the accounts as a trailing
`__sauce_accounts: Account[]`, passed at each call (`svm-lowering.ts#threadHelpers`); a script is
wrapped in the `main` they are added to (`scriptAsMain`). A site in a function inside another, and
a helper used other than by calling it by name, are refused, as is a helper `main` never reaches
that would add accounts. A program that names `pot` anywhere derives its accounts from `pot`, and
one that does not from `authority` (`CompiledSauceProgram.potMention` is where; `--via engine`
refuses the first, naming it). `pot.owner`, read and not called, is the Pot's owner and no mention
of the Pot (`pot-sugar.ts#potOwners`): the owner's account on Solana, and on an EVM chain the Pot's
`owner()`, through a binding the compile adds (`pot-owner.ts`, lowered before the token pass). A
bare `pot` is `Account<Signer>`, the slot `Solana.self` was; the
engine checks a signature where the program uses one, not at the entry
(`svm/direct-engine.e2e.test.ts` measures it). The cook commands refuse any `--account` given for a
slot derived from a cook role (`pot`, `owner`, `authority`, their token accounts and the addresses
they seed: `svmCookRoles`, `cli/solana.ts#refuseSubstitutedRole`) that is not the account its
derivation gives. `compileSauceRoute` refuses derived
accounts: a route's `execution.accounts` precede the compile. Executed in
`cli-solana-token-methods.e2e.test.ts` and `cli-solana-venues.e2e.test.ts`.

**The host surface and compiled-source declarations are separate — and only one of them is
global.** The HOST surface is IMPORTS ONLY: `routes/chain-exports.generated.ts` exports one named
value per canonical chain (`Base`, `Solana`, …) plus `chain` and `Token`, re-exported from the
package root, each composed in `routes/composed.ts` (a plain namespace object: `.chain` + the lazy
contract tree, + the svm venue tree on an svm chain). **Importing the SDK touches nothing on
`globalThis`**; `installRouteGlobals()`/`uninstallRouteGlobals()` (`routes/globals.ts`) remain as an
opt-in for a host that wants the bare-name spelling at run time, hand out the SAME memoised objects,
and install no types. `routeGlobals` is a live view of the last install, empty until one happens.
Globals are a SAUCESCRIPT concept: the generated `routes/source-globals.generated.ts` declares bare
token symbols and protocol namespaces such as `USDC` and `Uniswap` for TypeScript route closures.
Those are **type-only declarations**: no host `USDC` or `Uniswap` runtime object is installed. They describe source the
SDK extracts with `Function.prototype.toString`; the closure is never invoked and captures no
outer JavaScript values. Use `compile.defines` for external scalar values.

`pnpm --filter './sdk' gen-source-globals` generates every protocol namespace from the registry:
`descriptors/contracts.generated.ts` (the contract table the descriptors are built from, and the
host `ChainContracts` type) and these declarations. A contract is a role from `addresses.ts`, bound
to an ABI exactly as `test/fixtures/registry-abi/targets.json` binds it for the evidence — there is
no hand-kept link table. It evaluates the registry modules from `src` (`scripts/lib/load-ts.mjs`),
so it needs no build. Regenerate after changing a registry ABI, role, binding or token symbol; do
not hand-edit the generated files. Type declarations describe known names and call shapes across
the registry, not availability on every chain. Compilation still enforces the selected chain's
deployments, the SauceScript subset, and ABI fidelity. The public root type graph must keep the
generated ambient declaration import so downstream typed closures see the same declarations.

The language's own builtins (`ctx`, `crypto.keccak256`, `hex`, `Math.mulDiv`, `require(c, msg)`,
value methods, …) are declared beside them in `routes/builtins.generated.ts`, generated by
`pnpm --filter './sdk' gen-builtins` from the reference's `builtins.json` — its data, not a
second list — with each builtin's root as a run-time list, `BUILTIN_GLOBALS`, which the names
check reads. `crypto`, `Math`, `require` and `eval` are host names: the builtins MERGE into the
host's declarations (DOM `Crypto`, Node's `webcrypto.Crypto` and `NodeJS.Require`, lib `Math`)
rather than redeclaring them, which would clash under Node. `routes-builtins-types.test.ts`
typechecks a closure using every builtin with DOM, Node, both and neither.

**`actions/`** — JSON action programs (`{ version, chainId?, actions }`) lowered to one SauceScript
program. A token field takes a registry symbol (`"USDC"`) and a contract field a namespace reference
(`"UniswapV3.Factory"`) beside an address (`spec.ts`'s `token`/`contract`/`tokenContract` kinds,
spelling checked by `program.ts`); the generated source carries the NAME, so a document with no
`chainId` compiles for any chain where its names exist. Every compile is for one chain
(`options.chain`, else the document's `chainId`; a document with one compiles for that chain only)
through `routes.compileSauceProgram`, which resolves the names; `names.ts` checks each name on that
chain first (`routes.sourceGlobals`, the compile's own list) so a missing one is a located
`ProgramError` naming the chain, and resolves them to addresses for the rules that compare tokens
and for `to-quote.ts`, which builds calldata itself. A swap may give its pool by KEY instead of by
address (`spec.ts`'s `oneOf` alternatives, which the schema expresses as `oneOf`): `uniswapV2Swap`
`factory` (getPair), `uniswapV3Swap` `factory` + `fee` or + `tickSpacing` (Slipstream),
`traderJoeLBSwap` `factory` + `binStep` (its X/Y read from the pair when left out); the program
reads the pool on chain and reverts on the zero address. `quoteAction` and `compileSplitSwap` refuse
a key (a quote is an `eth_call` at the pool). `programSource` (`compose.ts`, not exported from the
index) is what `sauce actions` lowers with. The public surface is deliberately small — `parseProgram`, `serializeProgram`,
`programSchema`, `compileProgram`, `quoteAction`, `compileSplitSwap`,
`ProgramError` and the types — and the types ARE the JSON (no per-action chain, one `amount`, one
`amountOutMin`, `recipient` everywhere); keep it that way rather than adding parallel entry points.
`spec.ts` is the single field table: `program.ts` parses/validates against it (located issues,
canonical serialization, no defaults filled in), `schema.ts` generates the committed JSON Schema from
it, and `tests/docs.unit.test.ts` holds the guide's action list and outputs to it; `semantics.ts`
holds the cross-action rules. `to-sauce.ts` emits every protocol call as an ABI binding
(`IBinding.at(addr).method(...)`) from the catalogue in `abis.ts` — except a swap at one of
`@sauce/router`'s venues, which is a call into that library (`uniswapV2Swap` -> `uniswapV2(...)`,
the nine `RouterSwapAction`s), imported by the generated program and resolved from memory by
the SDK's resolver, so actions and SauceScript share one swap implementation; a binding takes the
registry ABI wherever the registry declares the function exactly (same canonical signature, so same
selector), and a method declares an output ONLY when an action reads it: compiler 2.3.0 decodes
declared outputs even when discarded, and decoding empty return data reverts (3pool-era Curve). A
local fragment, with its reason, remains only for a contract or method the registry does not carry
(`abis.unit.test.ts` fails if one ever appears there). ERC-20 `approve`/`transfer` are not
bindings: they go through the SDK's `token/safe` (USDT returns no `bool`; `SafeERC20` semantics, with
`forceApprove`'s reset), the lowering every SDK token write uses — one path, so do not add a second. Native-value calls stay raw
`evm.call` because a binding cannot attach value; the Stargate and Hyperlane fees are quoted by a
`view` binding (a STATICCALL) just before. Actions **chain**: output feeds the next implicitly (no
amount) or via `saveOutputAs`/`amountRef`; an output is what the action delivered to the Pot (a
return value or a balance delta) or its own amount, per `spec.ts`. The Pot is `"pot"` in a document
(`"self"` is refused, naming it), and the lowering names it `pot`/`pot.balance`, which the chain's
program compile reads; a split swap with no `chain` compiles raw, so its emitter names it
`ctx.self()` (`emit.ts#PotNames`). `compose.ts` compiles standalone
programs with ABI-v1 runtime arguments. `to-quote.ts`
builds the `eth_call`
quotes and, for the split swap, the same quoter calls as SauceScript over fixed amount offsets.
`AMM_SWAP_INTERFACES.md` is third-party interface reference; only its sections marked Verified have
been checked.

**The `sauce` bin** (`sdk/src/cli/`, built to `sdk/dist/cli/main.js`) is the package's one
executable: `compile`, `actions`, `simulate`, `run`, `wallet <verb>`, `tx`, `pot`, `globals`,
`inspect`, `verify`, `init` and `skills install|update|status`, on EVM chains and (`solana.ts`)
Solana. `run.ts` dispatches `wallet <verb>` (`WALLET_VERBS`: new, list, address, import, export)
and `pot <verb>` (`POT_VERBS`: list, import; `sauce pot` with no verb predicts and deploys) as
commands of their own (`VERBS`), each with its own flags and `--help`; the skills checker reads the
verbs from each command's `--help`. `pot-store.ts` is the Pot store, `~/.sauce/pots`
(`--pots <dir>`): one owner-only `<chainId>/<pot>.json` per Pot, linked into place once, nothing
read and written back; it imports only Node's modules, so `cli-pot-store.test.ts` runs it in
child processes. A Pot's identity is its chain id AND, on Solana, its
cluster (by genesis hash, `pots.ts#clusterOf`; filed as `<chainId>-<cluster>` off mainnet), since
the Kitchen's id, and so a Pot's address, is the same on every cluster. A second deployment of one
Pot address (a fork with the chain's id, or a Solana Pot closed and created again) is kept beside
the first as `<pot>@<tx>.json` and said, never dropped; an EVM record keeps its block's hash. Its records are not written by the commands: the two
places every send lands, `chain.ts#landed` and `solana.ts#svmLanded`, read what a transaction
deployed from the chain (the Kitchen's `PotDeployed` in a receipt that succeeded, its `create_pot`
in a Solana transaction that succeeded; `pots.ts`, which tells each Pot's release from its address
under every `releases.json` Kitchen and hash), put it on `Sent.pots`/`SvmSent.pots` (so every JSON
that reports a sent transaction carries `pots`), and hand the transaction to `keep.ts#keepLanded`.
That is the ONE hook a store a landed transaction feeds attaches to (`LocalStores`, the Pot store
its one member): it gives the transaction to each store of the current scope, which `runCli` sets
per command and the local MCP server per tool call (`AsyncLocalStorage`, so scopes keep apart).
Only the executable gives the
Pot store's directory (`main.ts`'s `potsDir`, like `publicRpcs`), so a test records nothing unless
it passes `--pots` or `CliIo.potsDir`. `sauce pot list` and `sauce pot import` (`POT_VERBS`,
`pot-commands.ts`) read and add to it; `cli-pots.e2e.test.ts` and `cli-solana.e2e.test.ts` hold
every path that deploys a Pot to its record. jest
(`moduleNameMapper`) and `sdk/tsconfig.test.json` (`paths`) map `@eco-incorp/sauce`, `/svm` and
`/protocols/*` to `src`, so a suite may import a manual example, which imports the package by its
name, with no `dist`. The manual's quick start program, `docs/examples/pay.sauce.ts`, runs as its
header's lines say in `cli-examples.e2e.test.ts` (Base, from the wallet `me` the page makes) and
`cli-solana-token-methods.e2e.test.ts` (Solana, from `me-solana`).
The Solana distributed swap's suites (`svm/distributed-swap.e2e.test.ts`,
`cli-solana-distributed-swap.e2e.test.ts`) and `@sauce/router`'s SVM arm's
(`std/router/svm.e2e.test.ts`) run nine venues' mainnet programs from a pinned dump: the
programs and the manifest in `test/fixtures/svm-venue-programs/`, every account the pools' swaps
take beside the other venue fixtures in `test/svm/fixtures/<venue>/`, as `{ address, owner,
lamports, base64Data }` (`scripts/dump-svm-venues.mjs --redump|--check --rpc-config <file>`, the
layout in `scripts/lib/svm-venue-fixture.mjs`). A redump refreshes a fixture file already holding
an account rather than adding a second, so `raydium-clmm/` and `orca-whirlpool/`'s SOL/USDC pools
are that snapshot's, read at one slot with every other venue's: the swap's split is only real
when every pool's price is one moment's. The CLI suite runs its cluster at mainnet's rent and
Kitchen fee, which a rehearsal's local copy must take from the cluster.
`actions.ts` takes an actions document as a program operand: `sauce actions` prints what it lowers
to, and `compile`/`tx`/`simulate`/`run` accept one wherever they take a file, as an ordinary
`ProgramInput` (the generated source, plus its ABI bindings in `contracts`). It loads
`actions/dist/compose.js` at run time by a path relative to itself — the SDK builds first, so it
cannot import a package not yet built — and `actionsCommand` is also what the MCP server's
`sauce_actions` tool calls. It adds no
compile path of its own — `compileSauceProgram` (the compile half of `compileSauceRoute`, with the
chain bundle: `chainAmbient`'s modules and the chain's names as a `RouteScope`) — and no encoder or
decoder: the cook is
`buildSauceEvmCall`, the Pot `v12PredictPot`/`potSalt`/`sauceEvmDeployPotCall`, arguments
`encodeEntryArguments`/`decodeEntryArguments`, names `sourceGlobals`, settles
`validateSettleProgram`/`verifySvmSettleExecution`, and Solana cooks `createSauceSvmClient`
(`cookTransaction`). It is Node-only and deliberately in no `exports` entry and no barrel
(`cli.test.ts` fails if a barrel exports it), reads no environment but the variable `--password-env`
(or, in `sauce mcp`, `sauce_wallet_enable`'s `env`) names, reaches a network only through
`--rpc-url`, a `--config` file's entry for the chain, or
else the built-in public endpoints (none with `--offline`) — and the npm registry, its one other
network access, named and read in `npm-registry.ts` alone, by `sauce update` when it runs and by
the update check, and npm itself, with the user's npm configuration, where the command runs it
(`init --install`, `sauce update`'s package managers, and `runtime.ts`'s `npm ci`; with the update
check's refresh, the four modules that may spawn) — and signs only with
`--wallet`, `--keystore`, `--private-key` or `--keypair`, scrubbing any key or password it was given
from everything it prints. **The public endpoints are the one exception to "the package ships no
RPC URL"** (the user's call: nobody should need a config to run the CLI or the MCP server). They
live in exactly one module, `sdk/src/cli/public-rpcs.ts` (1–3 keyless endpoints per canonical chain,
each flagged for `eth_simulateV1`, with the date they were checked), and nothing outside
`sdk/src/cli/` may import it; `no-embedded-rpc.test.ts` allows that file alone and fails an import
from anywhere else or an export that reaches `cli/`, so it never reaches a browser.
`public-endpoints.ts` hands each chain to the command's clients as one loopback URL (like the MCP
guard's forwarder) that falls back through the list on a network error, a timeout, 401, 403, 429 or
5xx, keeps to the endpoint that answered, and sends `eth_simulateV1` only where it runs. A request
gets 8 s, under viem's 10 s; an endpoint may set its own `timeoutMs`, on a Solana chain only (its
clients have no timeout): Solana testnet's single endpoint, slow to read accounts, waits 120 s. The
executable (`main.ts`) creates it and puts it on `CliIo.publicRpcs`; an in-process `runCli` without
it (every test, the skills checker) reads no chain it is not given, so CI stays offline.
`sdk/scripts/check-public-rpcs.mjs` re-verifies the list live, by hand, never in CI.
**The update check** (`update-check.ts`, the user's call, replacing "no automatic update check")
prints one line on stderr after a command when its cache, `~/.sauce/update-check.json` (the last
check's time, the latest version seen, the version that checked), names a newer release (a
prerelease only to a prerelease). The command reads the cache synchronously and never waits on the
registry: a cache a day old is refreshed by `update-refresh.ts`, a script `startDetached` runs in a
detached, unref'd Node process with stdio ignored. It records the attempt first, so a failing
registry is asked again a day later, and writes the cache 0600 in a 0700 `~/.sauce`, renamed into
place. An in-process request could not do this: it either holds a short command open (the DNS
lookup included) or dies with it unanswered. It is off with `--offline`, `--no-update-check` (on
every command's `HELP` flags, and accepted before the command name for an alias) or the `--config`
file's `"updateCheck": false`, and is silent on any failure. `sauce mcp` prints nothing; it adds one
note to the first tool result of the process (`mcp/src/update-note.ts`, wrapping `registerTool`,
shared by HTTP's per-request servers). Only `main.ts` creates the check, so an in-process `runCli`
(every test, the skills checker) reads no registry, and the bin-spawning checks
(`transports.test.ts`, the packed check) pass `--no-update-check`. `no-embedded-rpc.test.ts` holds
the registry's name to `npm-registry.ts`, and its importers and the check's to the command's own
modules. **No one deploys a Pot as a step of their own**: what a cook needs sent first is a
`SetupStep` (`approvals.ts`: an action, a reason, a gas estimate, its plan entry and its send), and
`approveAll` asks ONE question for every step (`[deploy/cancel]`; `-y`/`--yes`, the new name of
`--auto-approve`, approves each and says so; no terminal or `--json` refuses, naming each). `sauce
run` puts the Pot's deployment (`commands.ts#potDeployStep`) first, sent through `sendAndWait`;
`sauce tx` and `sauce_tx` list the same steps unsigned as `{ chainId, pot, transactions }` ahead
of the cook, with no top-level `to`/`data` so a wallet sends the whole plan; `RunInput.setup` and
`TxInput.setup` take a command's further steps (another chain's setup) into the same question and
plan rather than a second prompt; each gets a `SetupReach` — the cook's chain, and `on(chain)` for
any other through the command's own endpoint finder (`endpointOf`: `--config`, the public ones;
MCP's reach) and signer, its `send` going through `sendAndWait` — so a step opens no transport
and touches no key of its own. On Solana `create_pot` rides in the cook's own transaction when
the two fit in one, and falls back to a step otherwise. A wallet policy's `to` counts the
released Kitchen's `deployPot` of the wallet's own Pot, with no value, as a transaction to that
Pot (`policy.ts#ownPotDeployed`). `run --fund` (`funding.ts`)
wraps the file's source before that compile — a new `main` with the same signature that pulls
through `@sauce/token` (`permitTransferFrom`, `permit`, `transferFrom`), calls the original
renamed, and sweeps; in a script, the pulls after its imports and the sweeps after its last
statement — signing Permit2 or EIP-2612 locally; `cli-funding.e2e.test.ts` runs every
mode against canonical Permit2's runtime (`test/fixtures/cli/Permit2.json`). `cli.e2e.test.ts` runs the
EVM commands against anvils with the released gated stack (and one `cast send` line verbatim);
`cli-solana.e2e.test.ts` runs the Solana ones against the released Kitchen and engine in LiteSVM
through a JSON-RPC shim; the packed check runs the installed bin through `npx`. The agent skills
`sauce skills` installs (to `.claude/skills/` and `.agents/skills/`) live in the top-level
`skills/<name>/` and ship in the package (see "Agent skills" below).

What a command's input MEANS — the chain a program runs on, whether its defines reach it, the Pot
a cook names, its funding and assumed balances — lives in `inputs.ts`, taking plain values, so a
second front end applies the same rules: `run.ts` reads flags into it, and the MCP server reads
tool arguments into it.

**`sauce mcp`** is the MCP server (`mcp/`, built to `mcp/dist`). It is a CLI command, not a bin
of its own, so `npx -y @eco-incorp/sauce mcp` self-hosts it in one command. `sdk/src/cli/mcp.ts`
owns its flags and imports `mcp/dist/entry.js` LAZILY, by a specifier TypeScript does not follow
(so the SDK builds before `mcp/`), and only when the command runs (so no other command loads the
MCP SDK, an optional peer dependency, as zod is: `optional.ts#provide` finds or installs them first);
`entry.ts` exports `mcpEntry` typed by the CLI's `McpEntry`, so the two cannot drift.
Its tools are the `sauce` command's building half — `sauce_compile`, `sauce_actions`, `sauce_tx`,
`sauce_pot`, `sauce_simulate`, `sauce_inspect`, `sauce_verify`, `sauce_globals`,
`sauce_price`, `sauce_chains` — plus the skills as tools (`sauce_skills`, `sauce_skill`,
`sauce_dev`, `sauce_install_skills`), because many clients never read resources. Each command tool
calls the function the matching command calls (`compileCommand`, `txCommand`, `simulateCommand`, …)
and returns its JSON as structured content, so a change to a command reaches its tool with no edit
in `mcp/`; do not reimplement command logic there. `sauce_actions` calls `actions.ts`'s
`actionsCommand` (and `actionsProgram` for its cook), what `sauce actions` and the program commands
use.

Over stdio the server is the command for an agent with no shell, so it keeps the command's stores
as the command does, in the same directories, BY DEFAULT: `McpServeOptions.stores` (`McpStores`,
built by `mcp.ts#storesOf`; `--pots <dir>` for another directory, `--no-stores` for none) becomes
the server's `LocalStores`, which the tool registrar scopes each
call over (`keep.ts`), saying what it kept in the call's notes. So a Pot a `sauce_send` or
`sauce_wallet_send` deploys is recorded as `sauce` records it, and `sauce_pot_list`/
`sauce_pot_import` (`mcp/src/pots.ts`, on a server that keeps the Pot store) call
`potListCommand`/`potImportCommand`. Over HTTP there are no stores, the flags are refused, and
`createSauceServer` refuses stores beside a guard (`pots.e2e.test.ts`, `transports.test.ts`).

No tool takes a key or a password under any name (`tools.test.ts` and `wallets.test.ts` fail a tool
input that looks like one, nested fields included), and the server reads the environment only
through the CLI's one read: over stdio, the variable `--password-env` or `sauce_wallet_enable`'s
`env` names; over HTTP, none. It signs
only over stdio, where it serves the wallet tools by default (`--no-wallets` turns them off, and
`--no-stores` with the other stores: the directory is `McpStores.wallets`), and
only once the wallets are enabled (`mcp/src/wallets.ts`, see "Agent wallets"); over HTTP it never
signs and serves no wallet tool. A tool reads a chain through the call's own `rpcUrl`, else the
`--config` endpoint, else the public endpoints `sauce mcp` hands it (`Endpoints.public`, saying so in
the result's notes), else refuses (`reach.ts`); a caller's URL is a secret for that call only, and
the server's are registered with `signer.ts#secret` at start — all scrubbed from every result,
error and log (`secrets.test.ts`). Over HTTP a caller's URL goes only through `guard.ts`: https,
no private/ULA/link-local/CGNAT/metadata address, checked again at each connection (rebinding),
no redirects, bounded; `--allow-private-rpc` relaxes it. Over stdio there is no guard. A program's
relative imports are served only from the call's `modules`, never from the server's disk; skill
files only by exact match against what `skills/` ships. Nothing in `mcp/` names a particular skill
except the prompts and `sauce_dev` (sauce-typescript), which degrade when it is missing. `sauce mcp
setup` writes each coding agent's documented project config (`.mcp.json`, `.codex/config.toml`,
`.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json`). Its tests use the node test runner
(`pnpm --filter './mcp' test`, which builds `mcp/dist` first, since `transports.test.ts` runs the
built `sauce mcp`); `chain.e2e.test.ts` runs the tools against an anvil with the released stack
through `sdk/test/cli-anvil.ts`, gated on `SAUCE_V12_RUNTIME_CREATION_HEX` like the CLI's chain
suites. The consumer guide is `docs/guides/mcp.md`.

**Agent wallets.** `sauce wallet new|list|address|import|export` and `--wallet <name>` on every
command that signs (`sdk/src/cli/wallets.ts`, `wallet-commands.ts`, `password.ts`, `policy.ts`,
`wallet-send.ts`; all CLI, nothing else in `sdk/src` and no package export). A wallet is one file in
`~/.sauce/wallets` (`--wallets <dir>`; `CliIo.walletsDir` in tests), `<name>.json`, created 0600 by
a temporary file LINKED into place (never overwritten) in a directory created 0700. An EVM wallet is
a Web3 Secret Storage v3 keystore exactly as geth and `cast wallet` write it: noble scrypt (geth's
standard N=2^18, r=8, p=1), AES-128-CTR and a keccak MAC, in `signer.ts#encryptKeystore`. So
`--keystore` and `cast` read it; `cli-wallet.test.ts` holds it to the definition's scrypt test
vector byte for byte and decrypts a fresh one with OpenSSL's primitives and with `cast` (present in
CI). A
Solana wallet is the same envelope around the keypair's 64 bytes, marked `"kind": "solana"`, which
`--keystore` refuses. The address is in the clear, so `list`, `address` and `signerAddress` need no
password. `export` writes the key to `/dev/tty` itself (`terminal.ts#writeToTerminal`), past
stdout and the scrubbing, after the user types the wallet's name; there is no MCP twin. That keeps
it out of pipes and logs only: a program that runs `export` in a pseudo-terminal answers the prompt
and reads the key.

A password comes from exactly one source (`password.ts`): `--password-env <NAME>`,
`--password-file` (refused when its mode lets group or others in: `chmod 600`), `--password-command`
(run through the shell with no stdin; a failure reports its exit status, never its output), else
the prompt (asked twice for a new wallet; 8 characters at least). `--keystore` takes the same
sources, so a password file a test passes must be 0600 (`cli-anvil.ts#KEYSTORE_PASSWORD_FILE` copies
the committed fixture). There is no `--password <value>`. `nodeIo().readEnv` is THE COMMAND'S ONE
READ OF THE ENVIRONMENT, and `no-embedded-rpc.test.ts` allows exactly that line
(`DELIBERATE_ENV_READ`) and no other; do not add a second. Two things name its variable:
`--password-env <NAME>`, and over stdio an agent's `sauce_wallet_enable { env }` (below), which may
name any variable the server's environment holds; the value is used only as a password.

A wallet unlocked is GUARDED (`policy.ts#guardWallet`, by address, called only from
`wallet-commands.ts#openWallet`: `--wallet` and the MCP server's wallet tools; `--keystore`,
`--private-key` and `--keypair` register no guard, even on a wallet's own file, so no policy applies
to them): `chain.ts#sendAndWait` and
`solana.ts`'s `sendAndConfirm` — the two places every send of the command passes — consult
`guardOf(sender)` before sending. The guard calls the release gate (`requireSupported("sending from
a wallet", …)`) and, when `<name>.policy.json` exists, MEASURES what the transaction moves out of the
wallet and the Pot it cooks on — EVM from an `eth_simulateV1` rehearsal's Transfer/Approval logs and
traced native transfers, Solana from a simulation reporting its writable accounts (`svm-effects.ts`)
— and holds it to the policy's `chains`, `to`, `native` and `tokens` limits, per transaction and per
24 hours from `<name>.ledger.jsonl` (reserve, then sent or released, under a lock file). What cannot
be measured where a limit needs it is refused. Each native movement counts once:
`evm/effects.ts#nativeOnce`, which the simulate and run reports read through too, folds what Arc
reports of its native USDC (its own EIP-7708 Transfer logs from `0xff…fe`, the trace's, its ERC-20's)
into one, and on Arc that movement is held to `native` and to the `USDC` token limit both (a
base-unit cap in the ERC-20's 6 decimals: `limitDecimals`). The policy file is parsed strictly (an
unknown field is an error) and refused when others may write it.

**The MCP server's wallets.** `sauce mcp` over stdio serves the wallet tools by DEFAULT, on the
CLI's own directory (`--wallets <dir>` names another; a bare `--wallets`, as the server once had to
be started with, is the default; `--no-wallets` serves none), always REGISTERED rather than added
when enabled (not every client handles `tools/list_changed`): `sauce_wallet_enable`,
`sauce_wallet_create`, `sauce_wallet_import`, `sauce_wallet_list`, `sauce_wallet_address`,
`sauce_wallet_send` and `sauce_sign` (`create` is `sauce wallet new`'s twin; the names predate the
parity). List and
address need no password. Create, import and send need the wallets ENABLED, else they refuse naming
`sauce_wallet_enable` and its four sources. A password flag at start (`--password-env|-file|
-command`, no longer needing `--wallets`) enables them: `sdk/src/cli/mcp.ts` reads it once, before
the server loads, from a source that is not the prompt (stdin is the protocol's), and passes it as
`McpServeOptions.wallets.start`; that source is the operator's, and the tool refuses to replace it.
Otherwise the agent calls `sauce_wallet_enable` with a SOURCE, never a value: `env` (a variable of
the server's environment, read through `McpWallets.read`, a closure over the CLI's `PasswordIo`, so
`DELIBERATE_ENV_READ` stays the one read), `file` and `dotenv` + `variable` (`password.ts`, by
`"tool"`: owner-only and a REGULAR file, `dotenvEntry` reading as dotenv does), or `generate`
(`wallets.ts#generatePasswordFile`: 32 random bytes as base64url, written once 0600 by the same
link-into-place as a wallet; `true` is `<dir>.password`, beside the directory and never in it,
`~/.sauce/wallets.password` by default; a path inside a git work tree is noted). Never a command: a
command the model chose would be a shell for it. The password lives in the server's
`WalletSession`, in memory, for the process; calling the tool again replaces it.
`sauce_wallet_import` takes a key file by PATH (the tool never sees the key; a key given as the
path is refused unechoed), refuses one others can read, and reads it with `readImport`, so a
keystore must open with the enabled password, as the CLI's import does. `--wallets` and the
password flags are refused with `--http`, and `createSauceServer` registers the wallet tools only
when given wallets, which only the stdio path gives. `sauce_wallet_send` normalizes another tool's whole result (`plannedTransactions`, in
`wallet-send.ts`), rehearses an EVM plan in one `eth_simulateV1` block and preflights the policy
before sending any, then sends each through `sendAndWait`; a Solana one through `sendPlannedSvm`.
Its output schema is `refusable(...)`, like every tool the release gate can refuse. Tests: `cli-wallet.test.ts`, `cli-policy.test.ts`, `cli-wallet.e2e.test.ts`
(anvil, released gated stack), `cli-wallet-solana.e2e.test.ts` (LiteSVM), `mcp/test/wallets.test.ts`
and `wallets.e2e.test.ts` (each source an agent names, then a send); `transports.test.ts` runs the
bare `sauce mcp` over stdio with a `HOME` of its own (wallet tools listed, `{ generate: true }`,
then a wallet), an agent-named `env`, a start flag and `--no-wallets`, and checks the HTTP server
has no wallet tool. Every password and key in them is generated and thrown away.

**Hand-offs to a wallet's own MCP server.** Every unsigned EVM transaction a command or tool
returns is itself what a wallet's send-transaction tool takes: `{ chainId, to, data, value, gas? }`
beside labels (`what`, `deploysPot`), `value` and `gas` hex quantities (`handoff.ts#hexQuantity`),
the input of Phantom MCP's `evm_send`, whose schema refuses a decimal value, takes a numeric chain
id and drops the labels. Each producer writes them so (`commands.ts`'s `tx`/`pot` and the Pot's
planned deployment); reports — what was sent, a
simulation's `transactions` with their `status` — keep decimal amounts, and so do Solana's
lamports. Readers parse either (`BigInt`, `wallet-send.ts#valueOf`). `sendCalls` on a result is the
input of Coinbase Wallet MCP's `send_calls` (`{ chain, calls: [{ to, value, data }] }`, one atomic
batch), placed on the outermost part whose transactions are one chain's by `handoff.ts#handoff`,
which reads a result the way `plannedTransactions` does and is applied at the two output
boundaries: the MCP registrar for every tool whose description carries `UNSIGNED`, and the CLI's
`render()` for commands marked `unsigned`. Nothing
sent (`hash`), simulated (`status`), not ready, or a Pot already deployed gets one. Solana
transactions are left as they are: base64, the fee payer first and its signature the only empty
one, is already Phantom's `solana_send` input. `mcp/test/wallet-mcp-schemas.ts` copies both
servers' input schemas, cited by package version and commit (update it, then the outputs, when
either server changes); `handoff.e2e.test.ts` runs `sendCalls` through a contract wallet with
Coinbase Smart Wallet's `executeBatch` shape (`sdk/test/evm/fixtures/BatchWallet.sol`), which owns
the Pot one batch deploys and cooks on, and each transaction as eth_sendTransaction, on the
released stack. Phantom's server registers its tools by command path (`evm_send`, `solana_send`):
the `send_*_transaction` names its documentation uses are not what it lists.

**Signed cooks.** kitchen-evm 1.3.0's Pot takes `cookSigned(engine, program, maxExecutionFee,
nonce, deadline, submitter, signature)`: the owner signs an EIP-712 `Cook` (domain `Sauce Pot` /
`1` / chain id / the Pot) and any account submits it with exactly the signed value; the Pot pays
the Kitchen's fee from its balance, up to `maxExecutionFee`. These are the Pot's own methods: the
old #134's `@sauce/signed` handlers, Router fallback and `--signed-salt` are gone and must not come
back. The helpers are the block between `v12Pot` and `v12Kitchen` in `sdk/src/evm/engine.ts`
(`signedCookTypedData`/`Json`/`Digest`, `encodeCookSigned`, `encodeInvalidateNonces`, the nonce
helpers, `verifySignedCook` with the Pot's ecrecover rules and ERC-1271 through a client, and
`checkSignedCookPot`, which reads a pre-1.3.0 Pot off the pinned init-code hash). `sauce sign`
(`sdk/src/cli/sign.ts`) signs with a signer or prints the typed data for one (`--signature`
verifies and builds `cook`), and `--cancel <nonce>` sends or prints `invalidateNonces`; it is
gated as "signing a cook" and refuses Solana. **A wallet whose policy sets `native` or `tokens`
limits refuses to sign** (`chains` and `to`, the Pot, are checked statically): a signed cook runs
when and as its submitter sends it, on that moment's state, so a simulation at signing bounds
nothing and the ledger cannot count a cook that may never land; the policy's own rule is to refuse
what it cannot measure. MCP: `sauce_signed_cook` (pure, stdio and HTTP) and the wallet tool
`sauce_sign`; `sauce_wallet_send` accepts their `cook` and cancellations. Tests:
`sdk/test/evm/signed-cook*.test.ts` (the helpers against the released Pot on anvil) and
`sdk/test/cli-sign*.test.ts`; the manual's guide is `docs/guides/signed-cooks.md`, and
`docs/examples/signed-cook.ts` signs and encodes one offline.

**Which chains execute.** The `sauce` command's policy, and the CLI's alone: nothing outside
`sdk/src/cli/` changes for it, and the package exports none of it — the registry keeps every chain
and the SDK's builders take any. `sdk/src/cli/support.ts` holds the list of the chains the command
builds transactions on — Ethereum, Base, Arc and Solana, then the testnets Arc Testnet, Base
Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet, kept in their own
`SUPPORTED_TESTNET_SLUGS` so one line takes them out
(`SUPPORTED_CHAIN_SLUGS`, and `supportedChainNames()` names the testnets apart); every other
canonical chain is a PREVIEW chain — the chain-support request (`chainSupportRequest`: the GitHub
search, the prefilled issue-form URL, the title, body and comment), and the ONE gate,
`requireSupported`. The MCP server imports them from there (`mcp/src/sdk.ts`), and the skills'
generator and checker read the built `cli/support.js`. The gate is called from the command
functions both front ends share (`txCommand`, `runCommand`, `potDeployCommand` and `potCommand`'s
deployment, the Solana cook and Pot creation) and again wherever `run.ts` or a tool
reaches a network or a key first, so the refusal always comes before either. A cook is refused by
its own chain. Compiling, simulating and reads are never gated, and no flag lifts the gate. A
refusal is `PreviewChainError` with a `PreviewChainRefusal`: exit 1 from the command, `{ refused }`
from a tool (`refusedResult`), whose output schema is `refusable(...)` — every field optional
beside `refused`, because a client validates an error's structured content too. The issue form is
`.github/ISSUE_TEMPLATE/chain-support.yml`, its field ids held to `CHAIN_SUPPORT_FIELDS` by
`cli-chain-support.test.ts`; `cli-support.test.ts` and `mcp/test/support.test.ts` hold every gated
path to its refusal before any request. To support a chain, add its slug, rebuild (the skills'
chain references and the manual's `docs/reference/chains.md` regenerate from the list), and update
the README, the manual's pages and the skills that name the four (`git grep "Ethereum, Base"`). A
testnet is added only where the release's stack is live at its addresses: EVM checks the engine,
Router, Kitchen proxy, its EIP-1967 implementation slot and `router()`; Solana checks the engine
and Kitchen release builds. Ethereum Sepolia (`sepolia`), Solana Devnet (`solana-devnet`) and
Solana Testnet (`solana-testnet`) are supported in `SUPPORTED_TESTNET_SLUGS`. Devnet and testnet
are canonical chains of their own: their symbols are their cluster's mints
(`token-registry.ts#svmClusterOf`; testnet registers only WSOL, as Circle publishes no testnet
USDC), they have no venue (`svm-venue-methods.ts#svmVenuesOn`), an endpoint must serve the chain's
cluster by genesis hash (`pots.ts#requireChainCluster`), and a cook there is still held to the
release's builds by `solana-release.ts#requireSolanaRelease`; their Pot records share
`1399811149-devnet`/`1399811149-testnet` with those a `--chain solana` against that cluster's
endpoint wrote. Devnet's registry id, 1399811150, is its engine's CHAIN_ID. Testnet runs the
devnet build, so its engine reports 1399811150 too, while its registry key is 1399811151:
`routes/ambient.ts#programChainId` is the one place a chain's compiled `chainId` is chosen (the
engine's id for the chain's cluster, from `svm/clusters.ts`), and nothing hands a program
`chain.id` directly. A test that builds or sends a transaction
through the CLI or MCP uses a supported chain.

## Agent skills

`skills/` holds the Agent Skills (agentskills.io) the package ships and `sauce skills install`
copies into a project: `sauce-overview` (the entry point), `sauce-script`, `sauce-globals`,
`sauce-chains`, `sauce-protocols`, `sauce-swaps`, `sauce-distributed-swap`,
`sauce-solana-distributed-swap`, `sauce-solana`, `sauce-cli`, `sauce-actions`,
`sauce-typescript` and the `sauce-examples` index: thirteen. Each is a `SKILL.md` plus `examples/`
(`.sauce.ts` programs, `.json` actions documents — or a contract ABI, a JSON array, that a program
beside it imports — and `.mts` runners) and, for six of them (`sauce-actions`, `sauce-chains`,
`sauce-globals`, `sauce-protocols`, `sauce-script`,
`sauce-solana-distributed-swap`), `references/`.

- **One shape, one owner per fact.** Every `SKILL.md` opens with a scope paragraph saying what the
  skill owns, then `## When to use` (a table: this skill, or which neighbour instead) and
  `## Core model`, then its body (decision tables, numbered steps with exact commands, API tables),
  and ends with `## Pitfalls` (mistake, then what to do) and `## Files` (each example and reference,
  and what it pins). Each fact has one owning skill, and the others point at it rather than repeat
  it: which chains take transactions and the chain-support request links are `sauce-overview`'s,
  the program header `sauce-script`'s, Solana's accounts and running `sauce-solana`'s, namespace
  members, aliases and a name a chain lacks (zero there; a test of it, `if (X)`, decided while
  compiling and its ruled-out branch not compiled; any other use refused at the use, naming the
  chain) `sauce-globals`'s, the units of each flag `sauce-cli`'s.
  `sauce-overview` is the router: the model, the protocol with a user,
  the rules, the chain policy, and the skill map in layers (Start, Write, Build, Compose, Target,
  Run, Index) with routes by need. `skills:check` holds the first two and last two sections of
  every `SKILL.md` (`TEMPLATE_FIRST`, `TEMPLATE_LAST`) and fails any skill but `sauce-overview` that
  links the chain-support requests (`CHAIN_POLICY_SKILL`). The directory names are stable: the MCP
  prompts, the generators, the tests and the manual name them, so a change of ownership moves
  prose, not directories.
- **One set of protocol documents.** `skills/sauce-protocols/references/*.md` is the only copy of
  the per-protocol documents. `gen-embedded-sources.mjs` embeds them (top-level `*.md` only) for
  `src/skills/loader.ts`, so the `/skills` export (`getProtocolSkill`, unchanged API) returns
  exactly what an agent reads. Edit them there; `skills-loader.test.ts` pins the count. Every
  document whose protocol swaps (a `dex` or `aggregator`, or a template named for a swap) opens
  with the one line `SWAP_POINTER` in `check-skills.mjs`, leading a Sauce program to `sauce-swaps`,
  and a zero price limit in one must say the minimum output is then the only bound; the checker
  requires both.
- **The registry views are generated, by one generator.** `sdk/scripts/gen-skills-references.mjs`
  writes, at the end of every SDK `build`: the globals index
  (`sauce-globals/references/{tokens,protocols,chains}.md`: the NAMES a program uses, no addresses,
  from `routes.sourceGlobals`, the function `sauce globals` prints); `sauce-chains/references/`
  (an index and one file per chain: ids, native coin, CCTP domain, tokens with
  addresses, and every protocol deployment with how a program names it; and `deployments.json`, the
  Sauce release's addresses, which no chain file repeats); and `sauce-protocols/references/index.md` (every protocol by category, with the
  hand-written "Choosing between them" prose that lives in the generator) plus
  `sauce-protocols/references/registry/<slug>.md` (deployments per chain, namespace or ABI-import
  spelling, ABI functions). A deployment role's ABI export comes from the registry's own evidence
  map, `test/fixtures/registry-abi/targets.json`, offered only where the compile serves the export
  as `./protocols/<slug>/<Export>.json`. The files are committed and prettier-ignored, and each
  carries compiled examples; CI fails when the build changed `skills/`, and `skills:check` fails a
  stale or orphaned generated file, so commit the regenerated files with any registry change
  (`pnpm --filter './sdk' gen-skills-references`). Change their prose in the generator.
- **The manual renders the same facts, and never links the skills.** The same generator, from the
  same data, writes `docs/reference/` for a human reader: `chains.md` (the release's support and
  every chain) and `chains/<chain>.md`/`<chain>-stocks.md`, `deployments.md` (the release: its
  versions and addresses, listed in the index), `protocols.md` (by category, the family
  aliases, the interfaces) and `protocols/<slug>.md` (the registry facts with the protocol's
  hand-written document folded in, its `Category` and `Deployments and ABI` sections left out),
  `tokens.md` (every chain's tokens, `sauce-globals`' "Tokenized stocks" section, the stocks by
  issuer, the token functions) and `saucescript.md` (`sauce-script/references/builtins.md`, byte for
  byte); and, outside it, `docs/guides/distributed-swap.md`, the `sauce-distributed-swap` skill
  rendered as a guide, `docs/guides/solana-distributed-swap.md`, the
  `sauce-solana-distributed-swap` skill and its venues reference rendered the same way (each
  example's whole file in place of the code the skill quotes, and the agent-only sections, When to
  use and Files, left out: `AGENT_SECTIONS`), and `docs/guides/solidity-examples.md`, the ported
  examples (`PORTED_EXAMPLES`) with their sources and line counts. The two
  renderings differ only in links: a skill names a skill (`sauce-swaps`), and the
  manual links the page covering it (`DOCS_FOR_SKILL`), so a fact has one source and a reader is
  never sent into `skills/`, nor an agent into `docs/`. And each manual page opens with the
  plain-words intro every page of the manual has, which the generator writes (`docsIntros`) and
  only the manual's rendering carries. `docs/reference/` is generated whole (a page
  written there by hand is removed: hand-written reference pages belong in `docs/api/`), committed,
  prettier-ignored, and held like the skills' references: CI fails when the build changed it, and
  `docs:check` when it is stale. `docs:check` also holds the manual's shape: no link or path from the
  README or `docs/` into `skills/`; every page a list entry of `docs/README.md` (its link, then one line)
  exactly once (the per-chain and per-protocol pages are reached from their indexes); no page other
  than an index or the command reference (`docs/reference/cli.md`) with more than 3 links per 100
  words; every page, generated or not, opening with a
  plain-words intro (a blockquote after its title and breadcrumb); and `docs/guides/skills.md`'s
  table naming exactly the skills on disk. A fact an agent needs goes in a skill (or the generator), and the
  manual renders it; a fact only a reader of the manual needs (TypeScript, the MCP server's
  operation) is written once, in the manual.
- **One place per release.** The release's addresses (EVM engine, Routers, Kitchen and its
  implementation, the Pot init-code hash, the Solana programs in base58 and
  as keys, and every engine `V12_RELEASE_SETS` names) are the same on every chain, so each audience
  writes them in one generated file: `docs/reference/deployments.md` and
  `skills/sauce-chains/references/deployments.json` (prettier-ignored; the MCP server serves it like
  any skill file, and `mcp/test/deployments.test.ts` reads it through the server). A chain's file
  points at it; a hand-written page, skill, example or runner points at it or reads the SDK's
  `/deployments` helpers. `docs/scripts/release-addresses.mjs` is the rule, applied by `docs:check`
  (README and every file under `docs/`) and `skills:check` (every file under `skills/`), comments
  included; it takes the addresses from the SDK, so there is no second list. A skill sends its
  reader to a key of the file (`svm.kitchen.programId`), and a usage line passes a
  `<placeholder>` for it.
- **The actions reference is generated too.** `sdk/scripts/gen-skills-actions.mjs` renders
  `skills/sauce-actions/references/actions.md` (every action and field) from the committed
  `actions/action-program.schema.json`, in the same `build` step; regenerate the schema after a
  `spec.ts` change, then rebuild and commit both. Committed, prettier-ignored, and held the same way.
- **The checker.** `pnpm skills:check` (`sdk/scripts/check-skills.mjs`, build SDK and actions
  first) runs in CI after `docs:check`, and the packed check reruns it (`--skills <dir>`) on the
  copy `sauce skills install` writes into a project from the tarball — a project, because Node does
  not strip TypeScript from a runner under `node_modules`. It holds: the frontmatter to the spec; the `sauce-examples` index
  to the example files on disk, both ways; the `sauce-overview` skill map (one
  ``### `sauce-<name>` `` entry each under "The skill map") to the skill directories, both ways,
  so a new or renamed skill fails until the map says what it holds and when to load it; every
  program compiled through the `sauce` bin (in-process `runCli`) on each chain its index row
  names, running the `//   sauce …` usage line in its header offline (`compile`, then `tx` with `main`'s arguments sampled from its declared types);
  every actions document (`.json`, no `chainId`) lowered through `sauce actions` on each chain its
  row names, its cook built by `tx`, and ` ```json chain=a,b ` blocks lowered (` ```json fails `
  refused);
  every `sauce …` command line in a skill to the flags that command's `--help` lists; ` ```sauce
chain=a,b [define=X,Y] ` blocks compiled the same way, ` ```sauce fails ` refused;
  ` ```ts ` blocks and runners typechecked, and runners executed with
  `skills-check/offline-guard.mjs` preloaded, importing nothing but the package, viem and `node:*`
  (`RUNNER_PACKAGES`: pnpm does not hoist the package's own dependencies, so a project the skills
  are installed in resolves only its own — `sauce init` writes the package, viem at the version
  installed beside it, and `@types/node` — which the packed check proves in a project of exactly
  what `init` wrote, with a probe that must not resolve `@solana/kit`; re-export what a runner
  needs from a subpath, as `svm/kit.ts` does); the globals index fresh, compilable and covering
  every name a program uses; the SauceScript reference
  (`sauce-script/references/builtins.{md,json}`, with `skills-check/builtins*.mjs`) to the
  compiler; every ```sauce block in a skill's `references/` compiled like its own; every relative
  link resolving to a file inside the skills directory; every example program either executed by a
  suite CI runs or listed as compile-only, with why, in `skills-check/executed.json` (the rules are
  `docs/scripts/example-programs.mjs`'s, shared with `docs:check`, which holds
  `docs/examples/executed.json` to them with no compile-only list; both skip on the installed
  package, where the suites are absent); every example program, in the skills and in
  `docs/examples`, writing what the registry names by its name — no `0x` literal of a token or
  contract address `routes.sourceGlobals` names on any EVM chain, and no hand-built `hex` selector
  of a function a namespace binding, interface or registry ABI declares (comments are exempt, so a
  usage line may show an address; a deliberately low-level call is a `LOW_LEVEL_CALLS` entry, per
  example and selector, with its reason); every value an example program reads having a visible
  source — a name it never declares must be the registry's (`routes.sourceGlobals` on any chain),
  the language's (a builtin root from `builtins.json`, or `Token`, `pot`), an import,
  a local or a parameter, so an input is a `main` parameter given with `--args` and never an
  undeclared define, which is the SDK's mechanism and not a user's (an exception is an
  `INPUT_EXCEPTIONS` entry, per example and name, with its reason); and the wording rules below.
  Its exceptions
  live in the checker, never as markers in a
  shipped skill (they mean nothing to the agent reading it): a name inline code may use although
  the package never declares it (an external contract's function) is an `UNDECLARED_NAMES` entry,
  per skill and with its reason, and an entry the skill no longer needs fails the check.
- **Wording rules, enforced.** No version numbers or release talk; no agent's name, install path or
  instructions file (the skills reach every agent); no engine internals (opcodes, mnemonics, stack
  effects, bytecode bytes); no placeholder or unrecorded address (every `0x` address must be one the
  SDK records; developer inputs are `<placeholders>`); no RPC endpoint; no Portal or prover; Sauce
  never described as a multicall; no call to `available`, which is removed (a program tests the
  name itself, `if (X)`), outside a runner that compiles it to pin its refusal; no pointer into the
  package's docs (`node_modules/@eco-incorp/sauce/...`, `docs/guides/...`) outside
  `sauce-typescript`, because a skill carries every fact it needs in its `SKILL.md` and
  `references/` (an agent may have only the skills, served by the MCP server). The protocol
  documents are third-party facts and are exempt from the address, Portal and multicall rules only.
- **Simulate, never rehearse, enforced.** What runs with no key and sends nothing —
  `sauce simulate` — is a simulation, in everything a user or
  an agent reads. `docs/scripts/simulate-wording.mjs` is the rule; `skills:check` applies it to every
  file of the skills, comments included, `docs:check` to the README, `docs/` and the examples, and
  `sdk/test/simulate-wording.test.ts` to every string literal in `sdk/src`, `mcp/src` and
  `actions/src` (the `sauce` command's `--help` and output, the MCP server's tools and
  instructions). Code comments, identifiers and file names (`rehearse.ts`) are not held to it.
- **Plain integers, enforced.** SauceScript a reader sees writes `3000`, never `3000n`: the
  compiler reads a literal from its text as a 256-bit integer, so both are the same program
  (`sdk/test/integer-literals.test.ts`, both targets), and agents copy whichever they are shown.
  `docs/scripts/integer-literals.mjs` is the rule; `skills:check` applies it to the example
  programs, ` ```sauce ` blocks, references (generated ones included), `builtins.json`'s programs
  and the protocol documents' ` ```typescript ` templates, and `docs:check` to
  `docs/examples/*.sauce.ts`, the manual's ` ```js ` fences and every fence of a page generated
  from the skills (`docs/reference/`, which renders SauceScript as ` ```ts `). TypeScript host
  code (runners, ` ```ts ` blocks, a closure in a `.ts` file) keeps the `n`: there tsc types the
  literal. An exception is a checker's `INTEGER_EXCEPTIONS`, with its reason. A quoted compiler
  message keeps its words (``write `i += 1n` ``). What the SDK writes for a reader is plain too:
  the lowering `sauce actions` prints (with `token/safe`'s
  checked writes, which the settle recipe quotes). The command's token amounts (`--fund`,
  `--assume-balance`, a wallet policy, MCP `fund`/`assumeBalance`) are the other way round from a
  program: whole tokens (`USDC:1.5`), a bare integer included, and base units only with a trailing
  `n` (`USDC:1500000n`). A bare integer at or above 10^decimals (`USDC:1500000`) is said to be 1.5
  million in a note, which names the `n` spelling (`funding.ts#baseUnits`, `policy.ts#amountOf`).
- **Execution-agnostic.** Not every agent has the SDK installed: some have only the `sauce` CLI, or a
  remote compiler, and sign by local means. Every skill but `sauce-cli` (the CLI) and
  `sauce-typescript` (the SDK) teaches the program, what compiling for a chain produces (bytecode,
  and the cook transaction: `to`, `data`, `value`), the CLI as one way to compile and send, and
  `sauce tx`'s unsigned JSON as the hand-off to any signer. Runners may use the SDK to pin facts;
  the `SKILL.md` must not depend on them.
- **Program conventions.** A program names no chain (`--chain <chain>` in its usage line, no
  `// @chain` header), and every input it takes is a typed `main(...)` parameter passed with
  `--args` (`compileSauceProgram`'s `args`, the compiler's own). A
  compile-time define is
  the SDK's own mechanism: `--define`/`--defines` stay as the low-level flags `--help` lists apart,
  and no skill, doc, example or usage line teaches them.
- **They describe this tree, and their runners pin it.** Where the SDK's behaviour shapes how a
  skill tells agents to write something, a runner asserts that behaviour, so the change that moves
  it fails `skills:check` and the skill is rewritten with it. Today that covers, among others: that
  a program for a
  chain compiles as written — annotations anywhere, `interface`, a script's helpers and imports
  (`sauce-script/examples/saucescript.mts`). A runner may read its own skill's `SKILL.md` (and
  nothing else outside `examples/` and `references/`) to pin a value the skill states:
  `distributed-swap.mts` holds the selectors, the worked prices and the commands' arguments to the
  arithmetic.
- **Execution is verified outside the checker.** `skills:check` runs offline, so what a skill says
  about running a program (the distributed swap's per-pool limits, a `main` return coming back from
  the cook) was verified on anvil against real Uniswap V3/V4 contracts through the gated engine
  (`sdk/test/evm/gated-engine.ts`) before it was written. Re-verify the same way when changing it.

**`dev-tools/`** — the **testing kit**, published as `@eco-incorp/sauce/testing`, and the dev
harness for developing the SDK (local node scripts, compile helpers, the SVM Kitchen runner), which
does not ship. The kit is `src/testing/`, built by `tsconfig.build.json` (strict; only that
directory) to `dev-tools/dist/testing`, which alone is in the root `files`; `recorder.mjs` is copied
beside it by the build. It is Node-only (`check-browser-bundles.mjs`' `NODE_ONLY`), needs anvil on
`PATH` for an EVM chain, and reads no environment: the RPC, block and state file are arguments.
`fork(chain, { block, state, rpcUrl, mode })` replays a recorded state file, records one, or forks
live (`state.ts`): record and replay are `actions/tests/mainnet.ts`' mechanism generalized — a
recording proxy in its own process (`recorder.mjs`, configured over stdin, never env or argv),
`--no-storage-caching` for anvil (no RPC cache, read or written), dev accounts' code cleared, the
genesis written
with the pinned block's own header in a gzipped `{ sauce: {...}, genesis }` file that must not
mention the RPC. A replay runs on the node its recording ran on: what anvil's `--init` does not take
from a genesis is in the header (version 2) and set again — the gas limit
and the hardfork (which a fork infers from the block: Ethereum at 20M forks as Cancun) as flags,
and the next block's base fee and the dev accounts' nonces once the node is up. `record.test.ts`
holds a Uniswap V3 swap recorded and replayed to the same transaction hash, gas, balances, base
fees and block spacing. Block hashes and PREVRANDAO are not reproduced. A version 1 file, recorded
before, replays at its genesis's gas limit alone (`test/testing/state/base.json.gz` is one, until it
is recorded again). `local()` is an empty chain (Base's id by default). `stack.ts` uses a chain's live
release or deploys it at the release addresses through `sdk/src/evm/release-stack.ts#deployReleaseStack`
— the one CREATE3 deployment, which `sdk/test/evm/gated-engine.ts` calls too; it reads no file, so
each caller passes the artifacts (the kit from `sdk/dist/artifacts`). `chain.ts`'s `TestChain` funds through `sdk/src/evm/balance-slot.ts` (the slot
finder `--assume-balance` uses, moved out of `cli/` so the kit never imports the command), compiles
through `compileSauceProgram` afresh on every call (a program is its whole import graph, so
nothing is kept), decodes returns with `routes/returned.ts` by `main`'s declared type (a string stays
a string) and effects with `evm/effects.ts` (both moved out of `cli/` for the same reason). `run`
reports the transaction it mined: only the gas is estimated first (the block's limit when that
reverts, so the cook is sent anyway), for the pending block, and `returned` or the revert comes
from `debug_traceTransaction` of that transaction, never from a rehearsal on the block before; a
revert that carries no reason takes the failure of the call it passed on (a Pot passes on the
engine's out-of-gas as an empty revert, so the trace's top frame alone says only "reverted");
`simulate` is the rehearsal. A Sauce `require`'s revert data is the message's own bytes, not
`Error(string)`; `program.ts#reasonOf` reads both, and a called contract's `Error`/`Panic` comes
back through the cook unchanged. `node.ts` starts anvil as `sdk/test/anvil-process.ts` does (a
copy: the published kit cannot import a test, nor `sdk/src` hold `node:child_process`): a port that
already answers is refused, naming its holder, and a node is handed back only once its own anvil
answers, and only when the process listening on its port is that anvil (another can take the port
between `freePort()` and the bind). Every process the kit starts is stopped when the process that
started it exits or is ended by SIGINT, SIGTERM or SIGHUP (`stopWithProcess`). `node.ts` (anvil) and `state.ts` (the recorder) are the only shipped modules beside the
command's that start a process, which `no-embedded-rpc.test.ts` lists;
`optional-dependencies.test.ts` walks `/testing`'s graph with the other exports. The kit's suites
(`test/testing/`, node:test) are `node.test.ts`, `program.test.ts` (no chain), `local.test.ts`,
`record.test.ts` (records from an anvil on the machine, then replays with it stopped) and Base
replayed from `test/testing/state/base.json.gz`; record that again as the actions suites do
(`RECAPTURE_ANVIL_STATE=1`, RPC from `sdk/rpc.config.json`). The package script gives each test
and hook `--test-timeout`, as the guide tells consumers to.
The packed check imports `/testing` from the tarball and cooks on `local()` where anvil is present.
The consumer guide is `docs/guides/testing.md`.

**Solana in the kit** (`solana*.ts`): `fork("solana", { state, rpcUrl, mode })` and
`local({ chain: "solana" })` give a `SolanaTestChain` over a LiteSVM bank (`solana-bank.ts`) with
the packaged `engine-mainnet.so` and `kitchen.so` at the release ids. LiteSVM is the project's own,
an optional peer at the `sdk/runtime` pin exactly (the guide's `npm i -D litesvm@…` line is held to
it by `docs:check`), imported dynamically by `solana-bank.ts` alone, which `optional-dependencies.test.ts`
allows; no litesvm type reaches a `.d.ts` (the bank keeps them private), so an EVM-only consumer's
typecheck never needs it. There is no anvil-style lazy fork: a transaction names every account it
touches, so the bank reads each the first time a message (or a name the cook resolves) names it —
from the cluster (`clusterSource`, a hundred to a request, a program's code from its program data,
errors scrubbed of the URL), from a state file (`stateSource`), or nowhere (`local`). A Solana node
serves accounts only as they are now, so a recording pins the slot it read at (the Clock, Rent and
EpochSchedule sysvars go in its header) and has no `block` option. The file is gzipped
`{ sauce: { version: 1, chain, clock, rent, epochSchedule }, accounts, programs }`, sorted, so the
same reads record the same bytes, and must not mention the RPC. A replayed key the file lacks reads
as missing and is noted on the `CookReverted` (or a missing mint's error). LiteSVM has no snapshots:
the bank snapshots every account it ever read or wrote, plus the clock, and puts back each key read
since a snapshot as it was first read. Cooks (`solana-cook.ts`) are `sauce run`'s, rebuilt without
importing the command: names resolved by `svm/account-names.ts#resolveSvmAccountName` over the
compile's `derivedAccounts`, missing token accounts created first (owner pays), inline when it fits,
else staged (code buffer at the first free nonce, closed after) and through a lookup table the bank
writes in place, as `sauce simulate`'s copy does. `simulate` is a snapshot, the same cook, a revert
(the Pot it creates is kept, as on EVM). Test accounts come from fixed seeds so recordings replay.
`solana-local.test.ts`, `solana-record.test.ts` (records from the SDK's pinned mainnet dumps served
by `sdk/scripts/solana-rpc-stub.mjs` on loopback — `solana-support.ts#pinnedCluster` — then replays
with it closed) and `solana-examples.test.ts`, which runs the skills' and the manual's Solana examples (listed in
`skills-check/executed.json` and `docs/examples/executed.json`; `example-programs.mjs` counts a suite in dev-tools' `test` script as
one CI runs) from `test/testing/state/solana-examples.json.gz`. Record that again with
`RECAPTURE_SOLANA_STATE=1`, from the pinned dumps, with no RPC; the packed check runs a Solana cook,
staged too, from a clean install with LiteSVM beside it, and checks the error naming LiteSVM
without it.

`start:local`/`start:fork` start anvil (a fork keeps its chain id; an empty node takes Base's, since
the `sauce` command refuses an unknown one) and run `scripts/deploy.ts`, which sets the stack up
through the kit's `setUpStack`, mints anvil's first account a Pot under the default salt and clears
an EIP-7702 delegation a fork carries on that account (Base has one, and it breaks permit and
Permit2 signatures). The result is `dev-tools/.deployment.json`, which `stop` and `sync-price` read;
programs run there with the `sauce` command (`--rpc-url`). `src/runner.ts#compileScript` is the raw
compiler with defines and appended arguments, kept for its tests. `dev-tools` typechecks with
`strictNullChecks` (viem's types need it) and the kit with full `strict`. Current SVM local
execution uses `dev-tools/src/svm-local.ts`. The retired `SauceRouter` harness (Hardhat, its
`test:e2e`, `sync-artifacts` into `dev-tools/artifacts`, the `pnpm sauce` runner) is gone: the kit
and `sauce run` replace it.

## The swap Router

Lives in the **private engine repo**, not here, but programs target it (its `Router` artifact is
what a Pot's swaps call back through). Its ABIs are synced into `sdk/{src,dist}/artifacts`
(`Router`, `ISauceRouter`). **There is no `SauceRouter` artifact any more**: it came from the engine
repo's Solidity tree and no v12 release publishes it.

**The execution Router (Kitchen 1.3.0)** is content-addressed and has one exact-input method per callback venue family:
`swapV3`, `swapV4`, `swapMaverickV2`, `swapInfinityCL`, `swapInfinityBin`. All take unsigned
`amountIn`, pay from the Pot, and return `(amountInUsed, amountOut)`. There is no payer argument,
unified `swap`, exact-output mode, or quote method. `flash(callback, swap)` wraps the calldata of
one of those five methods to execute a program during its authenticated callback.

`@sauce/router` keeps its source-level API; its V3/V4/Maverick functions call the new signatures,
and `infinityCL`/`infinityBin` call the two Infinity methods. The library checks V3 and Maverick
token pairs before the swap. V4 and Infinity build the sorted pool key and pass the input token
explicitly. V2, Curve, Balancer V2, DODO V2, Trader Joe LB and WOOFi are
paid first and called directly by the program; their paths do not call the Router.

**Quoting remains on generation 3**, pinned separately as `quoteRouter` in `releases.json` and
synced from the private kitchen-evm 1.1.0 package into `V12QuoteRouter.json`. Actions' existing
`QuoteOptions.router` accepts `v12QuoteRouterAddress()`, never `v12RouterAddress()` (the execution Router).
The quote service simulates and reverts V3/V4 swaps without funds, so it does not depend on the Pot's
engine or execution Router. Captured-mainnet tests compare its quotes against execution Router swaps.
No chain deployment is implied by these release addresses.

## Publishing

Tag-driven (`.github/workflows/publish.yml`): `git tag v1.2.3 && git push origin v1.2.3` (or manual
`workflow_dispatch`). Builds all areas, fetches the SVM engine binaries, stamps the **root**
`package.json` version, and publishes the single `@eco-incorp/sauce` to **public npmjs.com only**
(`NPM_TOKEN`). GitHub Packages was dropped deliberately — `publish.yml:12` records why. Only the root
version is published; workspace packages stay `private`.

The package ships `docs/**/*.md` and `docs/examples/*.ts`. README and scaffold links are **relative
paths**, so one spelling renders in the repository, on the npm page and inside the published
tarball. They were absolute version-pinned UNPKG URLs while the repository was private — the only
way to serve docs to consumers who could not see the repo — but UNPKG returns raw Markdown, and
that reason ends when the repository goes public with the official release. `docs:check` resolves
each link against the file that contains it and checks any `#fragment` against that file's
headings; `check-packed-package.mjs` reruns the same checks and examples on the installed tarball,
which is what proves the relative targets also ship. An absolute
`github.com/eco-incorp/sauce/blob/…/docs/…` URL is rejected: it pins a branch and breaks in the
tarball. New public doc links must target files shipped in the package.

**Every release is in the changelog.** `docs/changelog.md` (Reference, in the index) records each
SDK 0.99.x release: what changed in SauceScript, the language, and what the compiler and engine
releases it shipped changed. It does not record component releases on their own, nor anything
before SDK 0.99.0. Each SDK release puts its pinned set in the table under
`## Which versions work together` and adds a `## SDK <version> — <date>` entry, newest first. The
entry opens with one line naming the set it ships, in prose (`Compiler 2.5.0, v12-evm 1.2.0, …`),
and what moved (`New since 0.99.8: …` or `Same compiler and engines as 0.99.N.`).
`### SauceScript` follows: **Added**, **Changed**,
**Now refused**, **Removed** and **Fixed** bullets, each written for a program author and marked
EVM, Solana or both, or `No language change.` A change to the SDK's names, `@sauce/token`,
`@sauce/router` or the way it compiles a program counts; a fix to a TypeScript function, a command
or the MCP server does not. Every SauceScript example compiles with the release it is listed under.
When a component moved, `### Compiler and engines` has one bullet per moved component
(`**Compiler 2.4.0 → 2.5.0:**`) saying what that release changes for someone using the SDK
release: pairing, the compiler's JavaScript API, what a cook can notice of the engines (gas,
limits, refusals), Pot addresses, the Kitchen's fee and Router, Solana accounts and wire. It points
at the SauceScript bullets rather than repeating them, and leaves out internals no SDK user acts
on. A breaking change outside the language (a removed export, a renamed command, the chain gate)
is one closing `**Also breaking:**` line, named tersely. `docs:check` reads
`releases.json` and fails while the table has no row whose Compiler, v12-evm, kitchen-evm, v12-svm
and kitchen-svm cells are a released row's versions; while a table row whose SDK cell is a version
has no `## SDK <version>` heading (a row whose SDK cell is `Unreleased` needs none); and while the
`quoteRouter` pin's version is not written as `kitchen-evm <version>` outside code fences. It skips
a whole row with a `null` digest, engine id, Kitchen or hash (a release not out yet, which the sync
refuses too), and compares only the cells of the components a row gives a version; the installed
package ships no `releases.json`, so the packed check skips all three. The changelog is checked
like every other page (links, fragments, plain integers, no define taught), and it is the only page
where release history belongs.

**The root `publishConfig.registry` pin (npmjs.com) is kept as a defensive, explicit anchor.** It used to be load-bearing: a committed root `.npmrc` mapped the whole `@eco-incorp` scope to `https://npm.pkg.github.com` (to fetch the `@eco-incorp/sauce-compiler-wasm` devDependency), and a scope registry governs PUBLISHING as well as resolution — so without the pin this repo's own `@eco-incorp/sauce` could have published to GitHub Packages instead of npmjs.com. That `.npmrc` is now GONE, and the wasm compiler is a public npmjs package (`@eco-incorp/sauce-compiler`, imported as `sauce-compiler`) resolved from the default registry — so the pin is no longer strictly required, but it is kept as an explicit npmjs.com anchor. If a scoped `@eco-incorp` registry mapping is ever reintroduced, this pin becomes load-bearing again.

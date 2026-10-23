# Upgrading

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Changelog](../changelog.md)

> A new release of Sauce can bring a new `sauce` command, new agent skills, and a new compiler with
> the engine its programs run on. This page shows how to move each one forward, and what to check
> so that programs you compiled before keep running.

This page is for anyone who already uses the `sauce` command or the SDK, and sees that a newer
version is out. It needs the command installed ([Install](cli.md#install)). The
[changelog](../changelog.md) has an entry for each SDK release: what changed in SauceScript, and
what the compiler and engine releases it shipped changed. Read the entries from your version up to
the one you move to first.

## Check which version you run

```sh
sauce --version
sauce update --check
```

`sauce update --check` says which version is installed and which an update would install, and
installs nothing. It reads the npm registry when you run it.

### The update notice

After a command, one line on stderr says when a newer release is out:

```text
sauce 0.99.12 → 0.99.13 is available: run `sauce update`
```

It never slows a command down. The line comes from a cache, `~/.sauce/update-check.json`
(owner-only), which `sauce` refreshes from the npm registry at most once a day, in a process of its
own that no command waits for. So the first command after a release may say nothing yet. The
registry is the only host it reads. The line goes to stderr only, so `--json` output and anything
piped from stdout stay as they are. It names a newer release only, and a prerelease only to a
prerelease.

Nothing is shown, and nothing read, with `--offline`. To turn it off:

- pass `--no-update-check`. Every command takes it, and so does `sauce` before the command, so a
  shell alias can carry it: `alias sauce='sauce --no-update-check'`;
- or add `"updateCheck": false` to the `--config` file a command is given
  (`{ "rpcUrls": { … }, "updateCheck": false }`).

`sauce mcp` prints no notice: it puts one note in its first tool result instead
([A newer version](mcp.md#a-newer-version)).

## Update the command

```sh
sauce update
```

`sauce update` installs the latest release, or the one `--version <version>` names, the way the
command you ran was installed:

| Installed as     | What `sauce update` does                                                     |
| ---------------- | ---------------------------------------------------------------------------- |
| A global install | npm, pnpm, yarn or bun installs the new version globally, and it says so     |
| A project's copy | Prints the command the project's package manager takes, pinned; runs nothing |
| npx's cache      | Prints the `npx -y` command that runs the latest                             |
| Anything else    | Refuses, and prints npm's global install of it                               |

After a global update, the new `sauce` updates the agent skills installed in the current directory,
and prints what changed. Where the version it replaced had its runtime packages installed, the new
version installs its own.

## Update a project's pinned copy

A project made with `sauce init`, or one that ran `npm i -D -E @eco-incorp/sauce`, pins the package
to one exact version, so every machine and CI job runs the same command and compiler. Update it
like any other dependency, with the command `sauce update` prints there, for example:

```sh
npm install -D -E @eco-incorp/sauce@<version>
```

Then update the skills (next section), and simulate your programs again on the new version before
you run them with funds.

## Update the agent skills

The skills a project's coding agents read are copied from one version of the package, so they go
out of date when the package moves.

```sh
sauce skills status    # exit 1 while any target is outdated
sauce skills update    # after upgrading the package
```

`update` adds new skill files, replaces changed ones and removes retired ones. A file you edited
since it was installed is kept, with a short diff, unless you pass `--force`. Put `sauce skills
status` in CI to notice an upgrade the skills have not followed. [Agent skills](skills.md#keep-them-current)
covers each verb.

## Update the runtime packages

`sauce mcp` and Solana simulations in a local copy load packages that each version installs for
itself, into `~/.sauce/runtime/<version>` ([Runtime packages](cli.md#runtime-packages)). A new
version installs its own folder on first use, or at once with `sauce runtime install`; after a
global `sauce update` it does so where the old version had one. Older versions' folders are then
removed, except the newest of them. A newer version's folder is never touched.

## Update the MCP server

A project's MCP entry pins one version of the package. After an upgrade, rewrite it with
`npx -y @eco-incorp/sauce@latest mcp setup --force`, then restart the server from your agent (in
most agents, restart the session). The server tells the agent when a newer release is out
([A newer version](mcp.md#a-newer-version)).

## Know how the compiler and the engine pair

A Sauce program is compiled by one compiler version and run by an **engine**, the on-chain code
that carries it out. Compiler output and engines pair by exact version, in both directions: a
compiler's programs run only on the engine releases paired with it, and an engine runs only the
output of the compiler paired with it. A new compiler can emit different instructions for the same
source, so an older engine can misread its programs, and an older compiler's programs can fail on a
newer engine.

The package pins one compiler and ships the engines that compiler pairs with
([Deployments](../reference/deployments.md) lists them). This is what it means for you:

- **Recompile after you upgrade.** Bytecode compiled by the previous version is for the previous
  engine. Don't store compiled programs and send them later through a new version; compile again
  with the version that sends them. The `sauce` command always compiles the file you give it.
- **Rebuild unsigned transactions.** A cook printed by `sauce tx` before the upgrade names the old
  engine. Build it again with the new version.
- **Know which release made each Pot.** `sauce pot list` shows the release each recorded Pot was
  created under. The changelog entry for the SDK release that ships a new Kitchen or engine says,
  under **Compiler and engines**, what changes for existing Pots.
- **In TypeScript**, every SDK builder that names an engine checks the pairing first and throws for
  an engine paired with another compiler, naming the one it needs
  ([Which engine runs a program](../api/compiler.md#which-engine-runs-a-program)).

## Moving from compiler 2.5 to 2.6

This SDK moves the complete pair: compiler **2.6.0**, EVM engine/Kitchen **1.3.0**,
SVM engine **1.4.0**, SVM Kitchen **1.1.0**.

1. **Recompile every stored program and rebuild every transaction.** Inputs are ABI-v1 only.
   Remove `compactArgs`, `--compact-args`, `entrySchema`, compact codec imports and `scalarWidth`
   options. Use `routes.encodeEntryArguments` for SDK programs. A raw compile now supplies
   `entryParams`; honor `indirect: true` for top-level fixed-size tuple parameters.
2. **Migrate signed values.** Negative literals, `Math.signExtend` and ABI `intN` outputs are
   `Int256`. Replace the removed `Math.sDiv`, `sMod`, `sShr`, `sLt`, `sGt`, `sLte`, `sGte` with
   ordinary signed operators. Give signed helpers `: Int256` returns.
   - `Uint256` and `Int256` are reserved type names: rename locals, parameters, constants,
     imports and functions that used either name.
   - Negative literals cannot initialize a `Uint256`: write `const delta: Int256 = -10`,
     not `const delta: Uint256 = -10`. Change unsigned negation `-amount` to `-Int256(amount)`.
   - At a signed ABI input, use signed values: for an `int256` argument write `-1`, not the
     unsigned word `~0`. A two's-complement word such as `2 ** 256 - 10` is not signed `-10`;
     write `-10` or, for an intentional runtime bit reinterpretation, `Int256.fromBits(word)`.
     Raw compiler `args` is a separate word-based API ([Compiler API](../api/compiler.md#closure-entries-and-bound-arguments)).
   - Containers must match their ABI integer kinds: `Int256[]` for `intN[]`, `Uint256[]` for
     `uintN[]`, and matching signed/unsigned tuple fields. Converting a scalar does not convert
     an entire container.
   - `Int256(value)` and `Uint256(value)` are checked numeric conversions. Assigning a negative
     `Int256` or `Math.signExtend` result to `Uint256` reverts; so does `Uint256(-1)`.
     Use `.fromBits(value)` only when preserving the bit pattern rather than its numeric value.
     Mixed arithmetic needs an explicit conversion. Narrow ABI inputs and read outputs are
     range-checked; dirty/out-of-range words now fail.
3. **Review discarded contract-call results.** A result nothing reads now skips all output decode
   and validation, even in an unused variable. A successful empty/malformed reply or no-code target
   can pass. Check `ctx.isContract` where required and keep checked SDK token writes. Reading any
   part still decodes all declared outputs. An explicit `abi.decode` remains checked.
4. **Choose recovery boundaries deliberately.** Multi-statement EVM `try` rolls back its whole
   block before running `catch`; assignments roll back too, unlike JavaScript. A sole-call `try`
   or `.catch` catches only that external call's failure, not successful-return decoding.
   Error bytes may be empty/truncated (256-byte cap); validate before decoding them. SVM has no
   catch support.
5. **Keep old funds on their old pairing until you move them.** New EVM Pots have new addresses;
   the new engine refuses old Pots. Use the earlier SDK/compiler/engine to manage an old Pot,
   and review the destination before moving funds. An upgrade never migrates balances.
   Signed cooks are new: only newly created Pots support the exposed `cookSigned` and
   `invalidateNonces` ABI methods; old Pots do not acquire them. There is no high-level SDK
   signed-cook helper. See [signed cooks](../concepts/kitchen-pot-cook.md#signed-cooks).
   For Router comparisons use `v12RouterAddress()`; `v12RouterGeneration()` is removed.
   The quote Router remains separate.
6. **Rebuild Solana cooks with the new SDK.** The engine program id and Kitchen instruction
   format changed. Do not replay serialized old cook/staged-cook instructions. High-level builders
   keep the same call shape; they supply the release's required account derivations.
7. **Remove intent integrations.** Programs run on one chain; chain namespaces such as `Base`
   and `Solana` are no longer callable, and `.route`, `.reward` and `.nest` are removed.
   Remove `EcoRoutes`, intent/Portal/vault helpers and types, `programIntent`, the transfer
   recipes, `/protocols/eco-routes`, SVM intent-route/Portal exports, and the
   `…SettleFromIntent` extractors. `compileSauceProgram` no longer accepts `intents`.
   Settlement codecs, `…FromCalls` extractors, the settle recipe and execution verification remain.
   The [SDK removals](../changelog.md#sdk-removals) list names by import path.
8. **Update renamed imports; there are no aliases.** Replace `SAUCE_INTENT_POT_SALT` with
   `DEFAULT_POT_SALT` (the default zero bytes32 salt), and `destinationExecutionFee` with
   `kitchenExecutionFee` (the Kitchen fee read for a cook).
9. **Update CLI and MCP callers.** `sauce intent` and all its verbs, every `--intent-*` flag,
   `--store` on `run`/`send`/`mcp`, and the `~/.sauce/intents` store are removed.
   `inspect` drops `--args`/`--args-json` and intent/Portal reports; `compile --json` drops
   `intentPots`. `verify` no longer accepts a Portal publish or returns `callIndex`/`target`.
   MCP removes all ten `sauce_intent_*` tools, `sauce_open_intent`, `intent*` inputs,
   `sauce_compile.rpcUrls`, `sauce_inspect.args` and Portal input to `sauce_verify`.
   Use the [current command reference](../reference/cli.md) and
   [MCP tool reference](mcp-tools.md) when updating automation. Run `sauce skills update` to
   remove the retired `sauce-intents` skill; locally edited files are kept unless forced.

The [language reference](../reference/saucescript.md) documents the new language forms, and the
[compiler API](../api/compiler.md) covers closure entries, scalar argument binding,
`entrySignature`, nested `programs` reports and diagnostic `code`.

**Compiler 2.6 limitation:** statement-form `.catch()` on a bound method with narrow integer
outputs, such as `uint128`, can be refused during compilation. For a method with one scalar
output, use the value form and read its result: `const value = call.catch(() => { return 0; });`.
Successful-return decoding remains outside that single-call catch. Use a general `try` block
when recovery needs to cover a multi-step operation instead.

## Check settlement pins

If your application verifies settlement programs, a compiler upgrade can change a program's bytes
without changing a line of its source. An upgrade is then the moment to check two things: which
program version your application now produces, and which versions it still accepts. Import the
SDK's pins rather than copying their values, and keep an older pin only for a version you have
decided to accept (`sauce verify --pin <hash:bytes>` on the command line).
[Verifying settlement programs](verification.md#compiler-upgrades-and-historical-pins) lists the
historical pins.

Compiler 2.6 recompiles the bundled settlement program to 410 bytes with a new hash. The default
validator accepts that new pin only. To keep accepting a 2.4/2.5 payload, add its 435-byte
`{ hash, bytes }` record explicitly; do not weaken hash validation.

## Next

- What changed in SauceScript, and in the compiler and engines, in each SDK release: the [changelog](../changelog.md).
- Before running the upgraded version with funds: the [production checklist](production-checklist.md).
- When something stopped working after the update: [Troubleshooting](troubleshooting.md).

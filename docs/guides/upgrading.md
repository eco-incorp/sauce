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

## Check settlement pins

If your application verifies settlement programs, a compiler upgrade can change a program's bytes
without changing a line of its source. An upgrade is then the moment to check two things: which
program version your application now produces, and which versions it still accepts. Import the
SDK's pins rather than copying their values, and keep an older pin only for a version you have
decided to accept (`sauce verify --pin <hash:bytes>` on the command line).
[Verifying settlement programs](verification.md#compiler-upgrades-and-historical-pins) lists the
historical pins.

## Next

- What changed in SauceScript, and in the compiler and engines, in each SDK release: the [changelog](../changelog.md).
- Before running the upgraded version with funds: the [production checklist](production-checklist.md).
- When something stopped working after the update: [Troubleshooting](troubleshooting.md).

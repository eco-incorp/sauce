# Changelog

**Reference** · [Documentation](README.md) · [Deployments](reference/deployments.md)

> What changed in each release of Sauce: the SDK you install, and the compiler, engines and
> Kitchens it pins. Newest first. Read the **Breaking** items before you upgrade.

This page is for anyone who upgrades a project, or who wants to know which releases made a Pot or a
program they already have. It assumes you know what a Pot, a cook, the Kitchen and the engine are;
the [glossary](concepts/glossary.md) defines each one.

## How Sauce is versioned

Sauce ships as six packages, and each has its own version number:

- **The SDK**, `@eco-incorp/sauce`: the TypeScript package, the `sauce` command and the MCP server.
  It is the one you install.
- **The compiler**, `@eco-incorp/sauce-compiler`, which turns SauceScript into bytecode.
- **v12-evm** and **v12-svm**, the engines that run that bytecode on EVM chains and on Solana.
- **kitchen-evm** and **kitchen-svm**, the Kitchens that make Pots and run cooks. kitchen-evm also
  holds the EVM Pot and Router contracts.

The five packages under the SDK are released separately. A change to one does not bump the others,
and there is no combined version number.

Each SDK release pins exactly one release of each of the five, in a table with one row per
compiler version. The SDK refuses to build a cook for an engine that its row does not pair with its
compiler. Compiler output and engines pair by exact version: two engines can report the same
instruction-set label and still disagree, so match versions, never labels.

While a package was below 1.0, a breaking change raised its minor version. From 1.0 on, a breaking
change raises the major version. At 1.0 each package said what it promises:

- the compiler, its JavaScript API (`CompileOptions`, `CompileResult` and the resolver contract);
- v12-evm, its instruction set and what each instruction does;
- v12-svm, its published wire contract: the instruction encoding, the account order and the
  instruction semantics;
- kitchen-evm, its ABIs and how their addresses are derived;
- kitchen-svm, its Anchor IDL.

No package promises the bytecode a program compiles to, or an address derived from a version.
kitchen-evm 1.1.0 and 1.2.0 moved the Pot address family as documented exceptions inside 1.x, so a
version number alone does not tell you whether Pot addresses moved. Derive Pot addresses with the
SDK rather than from a version.

Every engine release up to v12-evm 1.2.0 and v12-svm 1.3.0 sits at an address that follows its
version. A cook names its engine, so an existing Pot keeps cooking on the engine it was made for,
and nothing migrates. [Deployments](reference/deployments.md) lists the addresses of the release
the SDK pins.

The SDK is still below 1.0, and it has made breaking changes in patch releases. Read each release's
**Breaking** items before you upgrade, even for a patch.

## Which versions work together

Each SDK release and the five releases it pins:

| SDK     | Compiler | v12-evm | kitchen-evm | v12-svm | kitchen-svm |
| ------- | -------- | ------- | ----------- | ------- | ----------- |
| 0.99.14 | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.13 | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.12 | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.11 | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.10 | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.9  | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.8  | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.7  | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.6  | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.5  | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.4  | 2.3.0    | 1.0.1   | 1.0.0       | 1.2.0   | 1.0.0       |
| 0.99.3  | 2.3.0    | 1.0.1   | 1.0.0       | 1.1.0   | 1.0.0       |
| 0.99.2  | 2.3.0    | 1.0.1   | 1.0.0       | 1.0.1   | 1.0.0       |
| 0.99.1  | 2.2.1    | 1.0.0   | 1.0.0       | 1.0.0   | 1.0.0       |
| 0.99.0  | 2.2.0    | 0.8.0   | 0.5.0       | 0.8.0   | 0.4.0       |

From 0.99.9 on, the SDK also pins kitchen-evm 1.1.0's Router, for Uniswap V3 and V4 quotes only:
the 1.2.0 Router has no quote method. 0.99.0 and 0.99.1 named the compiler by range (`^2.2.0` and
`^2.2.1`); every later release pins it exactly.

## Unreleased

These changes are on the SDK's main branch and in no published release yet; the newest SDK on npm
is 0.99.14. Compiler, engine and Kitchen changes are listed here once they are released. Items
marked **Breaking** change behaviour that code written for 0.99.14 relies on.

### Solana swaps by venue name

- **Breaking:** A Solana swap is named by protocol and program, with one `swap` each:
  `Orca.Whirlpool`, `Raydium.CLMM`, `Pancakeswap.CLMM`, `Byreal.CLMM`, `Stabble.CLMM`,
  `Cropper.Whirlpool`, `Defituna.Fusion`, `Crema.CLMM` and `Phoenix.Market` each take
  `swap(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut)`. The `try<Venue>` functions and
  `Solana.trySwap` become plain names that return 0 instead of reverting, and the all-venue `swap`
  and `Solana.swap` are removed with no alias.
- **Breaking:** On Solana, `maxPrice` is renamed `priceLimit` everywhere: the router's functions,
  the generated types, `sauce pools` (`--max-price` becomes `--price-limit`) and MCP `sauce_pools`.
  There is no alias.
- **Added:** A program finds a Solana pool by key, as an EVM program does with Uniswap's fee tiers:
  `Orca.Whirlpool.pool(USDC, WSOL, 4)`, `Raydium.CLMM.pool(USDC, WSOL, 400)`.
  `sauce pools --chain solana` prints the spelling that finds each pool.
- **Added:** `Meteora.DLMM.swap(pool, tokenIn, tokenOut, amountIn, minOut)`, an exact-input swap
  with no price limit, and a match limit for Phoenix orders.
- **Added:** Where a concentrated-liquidity pool's walk would run the cook past Solana's compute
  budget, the `sauce` command holds that pool to a tighter limit. Where no such limit applies, the
  program compiles to the same bytes as before.
- **Fixed:** Far-priced pools on Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble no longer fail
  with `MissingTickArrayBitmapExtensionAccount`, and a swap at a price stops inside the tick arrays
  it was given instead of aborting the whole cook.

### `priceLimit` on EVM chains

- **Breaking:** `sauce price` and `sauce pools` on EVM chains, and MCP `sauce_price` and
  `sauce_pools`, return `priceLimit` instead of `maxPrice`, with no alias. `sqrtPriceLimitX96`,
  `maxAvgPrice` and `minAvgPrice` are unchanged.
- **Breaking:** The EVM distributed-swap example's `main` takes `priceLimit` instead of `maxPrice`,
  drops `refundTo`, and names its tokens in the program instead of taking them as arguments.
- **Fixed:** The sqrt-price-limit note on `compile` and `simulate` appears only for a parameter
  whose name says sqrt or X96, not for one named `priceLimit`.

### Signing somewhere else

- **Breaking:** `value` and `gas` of every unsigned EVM transaction are hex quantities instead of
  decimal strings, because wallet MCP servers take hex. Reports of sent and simulated transactions,
  and Solana lamports, stay decimal.
- **Added:** Every unsigned EVM result carries `chainId` on each transaction, and a `sendCalls`
  batch that a wallet can approve in one go.
- **Added:** `sauce tx --fund <token>:<amount>` (MCP `fund`) puts owner-to-Pot transfers in the
  plan, between the Pot's deployment and the cook, so deploying, funding and cooking is one approval
  in a smart wallet. Each planned transaction carries a `gas` limit from simulating the plan.
- **Added:** `sauce send` (MCP `sauce_send`) broadcasts transactions signed elsewhere, such as by a
  key management service, a hardware wallet or another wallet's MCP server, and reports what each
  did. A Solana cook that needs several transactions comes back as a plan of steps.
- **Added:** `sauce mcp` over stdio serves wallet tools by default from `~/.sauce/wallets`, and
  `--no-wallets` turns them off. The command keeps a record of every Pot it deploys
  (`sauce pot list`, `sauce pot import`).
- **Changed:** A Solana intent transaction that another key has already signed carries `signedBy`.
  Sign it as it is: a wallet that rebuilds it drops that signature.

### Solana accounts written as expressions

- **Added:** A Solana program writes the accounts it uses as expressions:
  `Solana.pda(program, [seeds])`, `Solana.account(key)`, `Solana.self`, `Solana.owner`, the
  well-known programs, and `<Sym>.accountOf(holder)`, `<Sym>.mint` and `<Sym>.tokenProgram`, with
  `.writable()` and `.signer()`. The `sauce` command derives and checks each one, so a run needs no
  `--account`.
- **Added:** Every Solana key input takes hex or base58, and a Solana `Address` argument takes a
  token by symbol or as `mint:<token>`.
- **Added:** A cook missing `Account` arguments is refused before anything is read from the
  cluster, with what each needs; `sauce compile --json` reports them as `accountsToGive`.
- **Added:** `sauce simulate` of a Solana cook lists what the first run pays (rent and setup fees)
  and the owner's total. The TypeScript client creates or reuses an address lookup table for a
  cook too wide for one transaction.
- **Added:** `sauce reclaim --chain solana` (MCP `sauce_reclaim`) lists and closes the code buffers
  and lookup tables a Solana cook left open.
- **Changed:** `@solana/kit` moves to 8.5 and the `@solana-program/*` clients to their current
  versions, so a project on today's Kit can install the package.

### Intents to and from Solana

- **Added:** An intent to Solana is written like any other,
  `Solana(() => { USDC.transfer(recipient, amount) }).reward(...)`, and published from an EVM
  chain. A body that runs a program is filled through an address lookup table.
- **Added:** An intent can start on Solana: the reward waits in Solana's eco-routes Portal, the
  fill and proof happen on an EVM chain, and `sauce intent claim` or `sauce intent refund` pays out
  on Solana.
- **Added:** `sauce simulate` of a program that opens an intent lists the intents it publishes. The
  local MCP server shares the command's intent store, so the CLI and the server see each other's
  intents.
- **Fixed:** `sauce intent status` reports a refunded cancellation as refunded.

### Testing programs offline

- **Added:** `@eco-incorp/sauce/testing` (Node only) tests Sauce programs with `node:test` on a
  forked chain. The first run records the state the tests read, and every later run, CI included,
  replays it with no RPC. It covers EVM chains (with anvil) and Solana (with LiteSVM).
- **Added:** A test chain has funded accounts with Pots, `fund`, `balanceOf`, `impersonate`,
  `snapshot` and `revert`, time controls, and `compile` and `run`. `run` reports the returned
  value, the revert reason and the balance changes. [Testing](guides/testing.md) shows it in use.

### Shorter names in SauceScript

- **Added:** `<holder>.<TOKEN>` reads a balance: `self.USDC`, `recipient.TSLAx`, `self.ETH`, and on
  Solana `self.SOL`. It compiles to the same bytes as the long form.
- **Added:** A registry function that returns a contract's address can be called on directly:
  `UniswapV3.Factory.getPool(USDC, WETH, 500).liquidity()`.

### Smaller changes

- **Breaking:** The `balancerV2BatchSwap` action refuses an `amountOutMin` above 2^255, and a batch
  that lists the same token twice in `assets`.
- **Added:** `sauce -v`, `sauce -V` and `sauce version` print the version.
- **Changed:** Every message of the command and the MCP server uses the words "simulate" and
  "simulation".
- **Changed:** This manual is reorganised into tutorials, how-to guides, concepts and reference,
  with a command reference generated from the command's own help.
- **Fixed:** `balancerV2BatchSwap` puts its `amountOutMin` floor on the action's output asset.

## The SDK (@eco-incorp/sauce)

The SDK is [`@eco-incorp/sauce` on npm](https://www.npmjs.com/package/@eco-incorp/sauce): the
TypeScript package, the `sauce` command and the MCP server. Each release starts with the five
releases it pins. 0.99.0 to 0.99.4 had no published release notes; their entries are reconstructed
from the code history.

### SDK 0.99.14 — 2026-10-11

Uses compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Added:** When a cook is about to run on a Pot that does not exist yet, `sauce run` deploys the
  Pot first, after asking for approval with the gas and cost estimate.
- **Added:** `-y` (`--yes`) approves without asking: the Pot's deployment and `--fund`'s
  approvals. It is the new name of `--auto-approve`, which still works.
- **Added:** MCP `sauce_tx` returns the same two-step plan, and `sauce_wallet_send` simulates both
  transactions together and sends them in order.
- **Changed:** With no terminal, or with `--json`, and without `--yes`, nothing is sent: the
  message names what needs approving. `--json` never prompts.
- **Changed:** `sauce tx` returns a plan when the Pot has no code: the deployment, then the cook.
  `--format cast` prints two lines.
- **Changed:** On Solana, creating the Pot goes into the cook's own transaction, so nothing is
  asked.
- **Changed:** In a wallet policy, deploying your own Pot counts as a transaction to that Pot, so a
  `to` list that names the Pot allows its deployment.

### SDK 0.99.13 — 2026-10-09

Uses compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Added:** `sauce runtime` says where each command's packages come from, and
  `sauce runtime install` installs them ahead of time.
- **Added:** The first time a command needs `@modelcontextprotocol/sdk`, `zod` or `litesvm`,
  `sauce` installs the pinned versions itself into `~/.sauce/runtime/<version>`, checked by
  integrity hash and with your own npm configuration. `sauce mcp setup` installs them up front.
- **Added:** After a command, one line on stderr says when a newer version is published. It never
  slows a command and stays out of `--json`. `--offline`, `--no-update-check` or
  `"updateCheck": false` in the `--config` file turns it off. `sauce mcp` adds it once, to its first
  tool result.
- **Changed:** Installing the package pulls 67 packages (149 MiB) instead of 226 (253 MiB).
  `@modelcontextprotocol/sdk`, `zod` and `litesvm` are optional peer dependencies.
- **Changed:** `--offline` installs nothing. The runtime folder must be owner-only, and `sauce`
  refuses to load it otherwise, naming the `chmod` that fixes it.
- **Changed:** `sauce update` updates the command the way it was installed. After a global update,
  the new version also updates the skills installed in the current directory.
- **Removed:** `typescript` and `dotenv` are no longer dependencies. `sauce init` adds TypeScript to
  a new project's devDependencies.

### SDK 0.99.12 — 2026-10-08

Uses compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Breaking:** The WOOFi Solana venue module no longer exports `OFF_POOL_RESERVE`.
- **Added:** A simulation or a sent cook lists what stays in the Pot instead of reaching the owner's
  wallet, why, and how to deliver it instead.
- **Added:** Every sent transaction comes back with its explorer link, a trace link and a summary of
  its receipt, in the CLI and in the MCP tools.
- **Added:** `@sauce/router` on Solana: each price-limit venue's swap comes in four forms, at a
  price, at the pool's own limit (`try<Venue>AtLimit`), the instruction alone (`<venue>Cpi`) and the
  instruction's data (`<venue>Data`). Invariant, Manifest and OpenBook join the price-limit venues.
- **Added:** Exact-input swaps on about sixty more Solana venues (constant-product and stable
  pools, Meteora and Saros DLMM, market makers, bonding curves, staking and vault venues), and
  instruction-only templates for a few more.
- **Changed:** Simulation and send output lists transfers in order, each labelled by role (wallet,
  Pot, Kitchen, recipient), instead of a flat list.
- **Fixed:** Crema swaps work with fewer than three tick arrays. WOOFi on Solana reads
  `min_swap_amount` correctly, and a swap at or below it moves nothing.

### SDK 0.99.11 — 2026-10-07

Uses compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Added:** `@sauce/router` on Solana, with a `try` form and a plain form for each price-limit
  venue: Raydium CLMM, PancakeSwap CLMM, Byreal, Stabble CLMM, Orca Whirlpools, Cropper, DefiTuna,
  Crema and Phoenix, named like `tryRaydiumClmm` and `raydiumClmm`.
- **Added:** `trySwap` and `swap` take a pool at any of those venues and find the venue from the
  pool's program. A program that knows its venue should call that venue's function, which is about
  a third of the size.
- **Added:** Every Solana router function takes
  `(slot, trader, amountIn, maxPrice, minOut, recipient)` and returns what the recipient received.
  A `try` form checks before anything moves, because a failed call into another program cannot be
  caught on Solana, and a skip returns 0.
- **Changed:** The Solana distributed swap calls the library and is smaller, and a remainder too
  small to trade is refunded.

### SDK 0.99.10 — 2026-10-07

Uses compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Breaking:** `sauce simulate` exits 1 when the simulated cook reverts, and its first line says so
  (`The cook reverts: <reason>`; in JSON, `reverted: true`). MCP `sauce_simulate` returns a revert
  as an error.
- **Added:** A distributed swap on Solana: one order split across price-limit pools, as a limit
  order that never pays past its maximum price.
- **Added:** `sauce pools` on Solana picks pools (`--pay`, `--max-price`, `--per-venue`, `--slots`)
  and prints their accounts.
- **Added:** `sauce simulate` runs a Solana cook locally, in LiteSVM, on a copy of the accounts it
  reads. `sauce run` on Solana creates missing Pot and owner token accounts, and uses an address
  lookup table when the accounts do not fit.
- **Added:** `--expect-revert <text>` (MCP `expectRevert`) checks that a guard reverts with that
  reason.
- **Added:** Every EVM `@sauce/router` venue has a `try` form (`tryUniswapV3`, `tryUniswapV4`,
  `tryMaverickV2`, `tryDodoV2`, `tryWoofi`), and PancakeSwap Infinity CL and bin pools are supported
  (`infinityCL`, `infinityBin` and their `try` forms).
- **Changed:** With no price limit, the new Router-routed `try` forms walk an empty pool fully
  (about 10M gas) before they skip it. Pass a `sqrtPriceLimitX96` to bound the walk.

### SDK 0.99.9 — 2026-10-07

Uses compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0, and
kitchen-evm 1.1.0's Router for quotes.

- **Breaking:** Pot addresses change with the 1.2.0 Kitchen. A Pot created under 0.99.8 keeps
  running its older engine, and the SDK's defaults now point at the 1.2.0 release, deployed on
  Ethereum and Base. Derive Pot addresses with the SDK.
- **Added:** The command and the MCP server read chains with no RPC configuration, through built-in
  keyless public endpoints. `--rpc-url` and `--config` still come first, and `--offline` reads no
  chain.
- **Added:** `sauce update` updates the copy of `sauce` you run, the way it was installed.
- **Added:** Intent files take their inputs as typed `main` arguments: `sauce intent publish`,
  `sauce intent fill` and `sauce inspect` take `--args`, and the MCP tools take `args`.
- **Added:** Intents take their default prover and `nativeAmount` from the registry; `contracts`
  accepts viem's `parseAbi` output; Tether's USDT0 is registered as `USDT0` on 10 chains; and editor
  types cover every `.sauce.ts` file.
- **Changed:** Uniswap V3, V4 and Maverick swaps go through the 1.2.0 Router. V3 and V4 quotes use
  the 1.1.0 Router (`v12QuoteRouterAddress()`), because the 1.2.0 Router has no quote method.
- **Changed:** `sauce actions` output and the manual's programs write plain integers. A bare-integer
  amount such as `USDC:1500000` gets a note that it means 1.5 million tokens; base units take a
  trailing `n`.
- **Fixed:** `sauce simulate --fund` runs the approvals and transfers that `sauce run` sends first,
  and `sauce init` adds viem, at the version beside the package.

### SDK 0.99.8 — 2026-10-02

Uses compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Added:** 1,799 Solana stock and ETF tokens are named globals, such as `TSLAx`, `TSLAon`,
  `NVDA_US` and `SPACEX`, from xStocks by Backed, Ondo, Backpack Securities and PreStocks. Each
  address comes from its issuer's own list.
- **Added:** They work in programs, in `sauce globals --stocks` and `--search`, and in MCP
  `sauce_globals`. They are Token-2022 mints, so they move through `@sauce/token`'s
  `transferChecked` and `approveChecked`. PreStocks' mints charge a transfer fee, so measure what
  arrives.
- **Changed:** Compiling for Solana takes about 3.5 ms instead of 1.4 ms, because the chain's token
  names are passed to every compile.
- **Fixed:** `sauce pot` with an endpoint, and MCP `sauce_pot`, no longer read a balance for every
  registered token, stock tokens included.

### SDK 0.99.7 — 2026-10-02

Uses compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Breaking:** The `sauce` command and the MCP server build and send transactions only on
  Ethereum, Base and Solana. Every other chain is a preview chain: programs compile and simulate
  there, but no transaction is built or sent. The TypeScript SDK is not limited this way.
- **Breaking:** Renames and removals. The `sauce-dev-tools` bin is gone; use `sauce`. The
  `sauce-run` skill is now `sauce-cli` (`sauce skills update` migrates it). Intent commands live
  under `sauce intent <verb>`, and `--yes` became `--auto-approve`. Solana token rows need
  `tokenProgram`. The `swap` namespace, `swapThenDepositSource` and several swap action kinds are
  removed in favour of `@sauce/router`. Some protocol names change: `CompoundV3.CometUSDC` becomes
  `CUSDCv3`, and `Erc4626.ERC4626Vault` becomes `Erc4626.Vault`.
- **Breaking:** The chain roster leaves `@eco-incorp/sauce/deployments`: `V12_EVM_CHAINS`,
  `isV12Live`, `v12ChainSlug`, `v12Deployment`, `requireV12Deployment` and the other per-chain
  helpers are removed. The subpath keeps the release's addresses (`v12EngineAddress()`,
  `v12KitchenAddress()` and the rest), which are the same on every chain and do not say where code
  is deployed: check for code on the chain before relying on one.
- **Breaking:** Intents target eco-routes' Portal 2.12: BNB Smart Chain, Sonic, Celo and Ink no
  longer take intents, and Monad does. By default an intent the SDK funds is paid into its vault and
  then published; `fundVia: "publishAndFund"` keeps the old path. Intent hashes change where a token
  named by symbol used to resolve on the wrong chain.
- **Added:** The `sauce` command: `compile`, `actions`, `simulate`, `run`, `tx`, `pot`, `globals`,
  `inspect`, `verify`, `init` and `skills`, on EVM chains and Solana. `sauce run --fund` and
  `--sweep` move a program's tokens into and out of its Pot in the same cook, and `sauce simulate`
  needs no key and no deployed Pot.
- **Added:** The `sauce intent` lifecycle (`publish`, `fill`, `prove`, `claim`, `refund`, `cancel`,
  `status`, `list`, `show`, `import`), the MCP server (`sauce mcp`) with the command's tools and the
  intent tools, and wallets (`sauce wallet`) with optional spending policies. The HTTP server never
  signs.
- **Added:** `@sauce/router`, one swap function per venue; tokenized stock and ETF tokens on
  Ethereum and Base; Token-2022 in `@sauce/token`, with `transferChecked` and `approveChecked`;
  `sauce pools` and `sauce price`; every registry protocol as a namespace, with `available(<name>)`;
  actions documents that name tokens and contracts; and the agent skills, installed with
  `sauce skills install`.
- **Changed:** The SDK pairs the compiler and the engines by release, one row per compiler version,
  and its cook builders refuse an engine that no row pairs with the compiler. Names in an intent
  resolve per level: the body on the destination chain, the reward on the source chain.
- **Fixed:** A `main` parameter that is a tuple of fixed-size fields is passed the way the compiler
  reads it, and Uniswap V4 legs with `amountIn: "balance"` work for non-zero balances.

### SDK 0.99.6 — 2026-09-30

Uses compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Breaking:** A token write returns nothing, so `const ok = USDC.transfer(...)` no longer
  compiles. Any use of `Token(...)` other than a direct write call, or a `const t = Token(x)`
  binding called as `t.<method>(...)`, is a compile error that names the safe spellings.
- **Breaking:** Program hashes change for programs built from the token shorthand, the templates or
  the recipes, and for token-only intent routes that approve; the settle program is unchanged.
  Callers of `rewriteTokenMembers` must prepend `tokenImportLines(result)`. The `crvusd` and `frax`
  templates' `transfer` and `approve` return `1`.
- **Added:** The `USDC.transferFrom(...)` shorthand, and `tokenImportLines` exported from `routes`.
- **Changed:** Every token write the SDK offers follows OpenZeppelin's `SafeERC20`: a missing return
  value is accepted only from a token with code, anything returned must decode to `true`, and
  `approve` first resets a standing allowance to zero. This costs more gas: about 4.9k more per
  transfer, 6.9k per `transferFrom` and 12.5k per `approve`.
- **Changed:** Token-only intent bodies call `approve(spender, 0)` before
  `approve(spender, amount)`. An explicit `IERC20.at(x).transfer(...)` stays the raw, unchecked
  call.
- **Fixed:** `USDC.transfer(...)`, `USDC.approve(...)` and `Token(x)` writes work with tokens that
  return nothing, such as USDT, and no longer accept a `false` return.

### SDK 0.99.5 — 2026-09-30

Uses compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0.

- **Breaking:** Upgrade the SDK and the engines together: compiler 2.4.0 output does not run on the
  1.0.x EVM engines or on Solana engines before 1.3.0, nor the reverse. Pot addresses change with
  kitchen-evm 1.1.0; derive them with the SDK.
- **Breaking:** No RPC endpoints ship: `Chain.rpcUrls` is removed, the Solana client needs an
  explicit `rpcUrl`, and the SDK reads no environment variables.
- **Breaking:** Chain accessors are named imports (`import { Base } from "@eco-incorp/sauce"`), not
  globals installed on import; `installRouteGlobals()` stays as an opt-in. `baseDirs` is removed:
  pass `resolve` and `resolvePackage`, or use `resolveSdkModule` and `resolveSdkPackage`. The
  earlier actions entry points are removed with no aliases.
- **Breaking:** The Solana artifact helpers (`svmEnginePath`, `svmKitchenPath`,
  `svmKitchenIdlPath`, `svmEngineArtifacts`) leave `@eco-incorp/sauce/svm` for the Node-only
  `@eco-incorp/sauce/svm/engine-artifacts` subpath, and read no `SAUCE_*` variable: pass a path as
  the argument, or leave it out for the packaged binary.
- **Breaking:** The settle program grows from 356 to 435 bytes, with a new hash, and its sweep
  follows `SafeERC20`. Its length is where the argument tail starts, so recompile, and pass an
  older payload's `{ hash, bytes }` pin, such as 0.99.4's 356-byte program, to
  `validateSettleProgram` to keep verifying it.
- **Added:** A program can open a cross-chain intent with `Base(() => …).reward(…)`, with
  amounts measured at run time.
- **Added:** JSON action programs at `@eco-incorp/sauce/actions` (`parseProgram`,
  `compileProgram`, `programIntent`, `quoteAction` and more), and Arc as a chain.
- **Added:** The compiler, routes, builders, recipes and actions run in a browser. Call
  `await ready()` before compiling there.
- **Fixed:** Registry ABIs and addresses match the deployed contracts, checked against captured
  on-chain evidence: 126 methods corrected, 19 that do not exist removed, 29 added, and 20
  addresses corrected.

### SDK 0.99.4 — 2026-09-25

Uses compiler 2.3.0, v12-evm 1.0.1, kitchen-evm 1.0.0, v12-svm 1.2.0 and kitchen-svm 1.0.0.

- **Changed:** The pinned Solana engine moves from v12-svm 1.1.0 to 1.2.0, for both clusters.
- **Changed:** The SDK recognises the engine's new pinned paid-cook instruction but adds no builder
  for it: execution still goes through the Kitchen.

### SDK 0.99.3 — 2026-09-25

Uses compiler 2.3.0, v12-evm 1.0.1, kitchen-evm 1.0.0, v12-svm 1.1.0 and kitchen-svm 1.0.0.

- **Changed:** The pinned Solana engine moves from v12-svm 1.0.1 to 1.1.0, for both clusters.
- **Changed:** The SDK recognises the engine's two new paid-cook instructions but adds no builders
  for them: execution still goes through the Kitchen.

### SDK 0.99.2 — 2026-09-24

Uses compiler 2.3.0, v12-evm 1.0.1, kitchen-evm 1.0.0, v12-svm 1.0.1 and kitchen-svm 1.0.0.

- **Breaking:** The package needs Node.js 24 or newer.
- **Breaking:** `IntentOptions` needs either an explicit `execution`, or both `pot` and `engine`.
- **Breaking:** The settle program shrinks from 362 to 356 bytes and has a new hash, so re-pin it.
  Existing 362-byte payloads still verify with their `{ hash, bytes }` pin.
- **Added:** The package ships this manual, its runnable examples, and its licence.
- **Added:** Token and protocol names such as `USDC` and `Uniswap` are declared for TypeScript, so
  typed route callbacks typecheck. They are types only and install nothing on `globalThis`.
- **Changed:** The compiler is pinned exactly to 2.3.0.
- **Fixed:** The Solana venue adapters `carrot`, `obric-v2` and `woofi` drop an account with an
  out-of-range price exponent cleanly. Nested intent fee budgets, deployment lookups, WETH balance
  sizing and other route and intent edge cases are fixed.

### SDK 0.99.1 — 2026-09-17

Uses compiler 2.2.1, v12-evm 1.0.0, kitchen-evm 1.0.0, v12-svm 1.0.0 and kitchen-svm 1.0.0.

- **Added:** `@eco-incorp/sauce/deployments` exports the release's addresses (`v12EngineAddress`,
  `v12RouterAddress`, `v12KitchenAddress`, `v12SvmEngineProgramId`, `v12SvmKitchenProgramId` and
  more). They are release addresses, not proof that a chain has the contracts.
- **Changed:** The 1.0.0 engines sit at new addresses, because an engine's version is part of its
  address. Read them from `@eco-incorp/sauce/deployments` instead of hard-coding them. The settle
  program is unchanged.

### SDK 0.99.0 — 2026-09-17

Uses compiler 2.2.0, v12-evm 0.8.0, kitchen-evm 0.5.0, v12-svm 0.8.0 and kitchen-svm 0.4.0. The
first release of `@eco-incorp/sauce` on npm.

- **Breaking:** `createSauceSvmClient` needs a `kitchen` address, because the released Solana engine
  refuses any call that does not come through a Kitchen cook. Pass `maxExecutionFee` too when the
  Kitchen charges a fee.
- **Breaking:** `buildCookInstruction` and `buildCookFromAccountInstruction` need `pot`,
  `feeConfig` and `maxExecutionFee`.
- **Breaking:** The settle program changes from 363 to 362 bytes, with a new hash; re-pin it with
  the SDK. Intents published against the old hash still verify when you pass that hash to
  `validateSettleProgram`.
- **Added:** `encodeCompactArguments` and `decodeCompactArguments`, from
  `@eco-incorp/sauce/compiler`.
- **Added:** Solana Kitchen builders for the execution fee, and `potSalt` and `maxExecutionFee` on
  `createSauceSvmClient`.
- **Changed:** Every Solana execution goes through the Kitchen's `cook` or `cook_from_account` and
  pays the quoted fee.

## The compiler (@eco-incorp/sauce-compiler)

The compiler is
[`@eco-incorp/sauce-compiler` on npm](https://www.npmjs.com/package/@eco-incorp/sauce-compiler).
From 1.0.0 on, each release names the engines and Kitchens the SDK paired it with. Earlier releases
came before the SDK pinned engines, so they name none. The first two releases, 0.1.0 and 0.2.0,
were published as `@eco-incorp/sauce-compiler-wasm` on GitHub Packages; the name
`@eco-incorp/sauce-compiler` starts at 0.3.0.

### Compiler 2.5.0 — 2026-10-06

Pairs with v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0, in SDK 0.99.9 to
0.99.14.

- **Added:** EVM-only block and transaction reads: `ctx.txOrigin()`, `ctx.coinbase()`,
  `ctx.prevrandao()`, `ctx.blockGasLimit()`, `ctx.baseFee()`, `ctx.gasPrice()`, `ctx.blockHash(n)`
  and `ctx.blobHash(i)`. They are compile errors on Solana.
- **Added:** EVM-only contract creation, `evm.create`, `evm.create2` and `evm.create3`, and the
  address predictions `evm.createAddress`, `evm.create2Address` and `evm.create3Address`. A failed
  `evm.create` or `evm.create2` returns address 0 and the program goes on; a failed `evm.create3`
  reverts.
- **Added:** EVM-only `ctx.blobBaseFee()`. Older engines answer a constant instead of the real fee;
  v12-evm 1.2.0 answers the real one. It halts the cook on some networks, such as Arbitrum and
  Polygon, so give those chains a profile that marks it unsupported.
- **Added:** The `compile` options `chain` and `chainProfiles`. A chain profile can mark a builtin
  `"unsupported"`, which makes a use of it a compile error naming the chain, or give a read that
  takes no arguments a constant to fold into the program.
- **Added:** Errors thrown by `compile` carry a `diagnostics` array that places each problem in its
  module, so a tool no longer parses the message text.
- **Changed:** Every compile message is worded in SauceScript's own terms, not the compiler's
  internals. Anything that matches on message text needs updating.
- **Changed:** The paired engine, v12-evm 1.2.0, makes `eval` run as the Pot and moves the Pot
  address family; see that release.

### Compiler 2.4.0 — 2026-09-30

Pairs with v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0, in SDK 0.99.5 to
0.99.8.

- **Breaking:** Output from 2.4.0 needs v12-evm 1.1.0 and v12-svm 1.3.0. On an older Solana engine
  it fails loudly at the first spilled stack slot. Programs compiled by an earlier compiler must
  keep running on the engine they were compiled for. The instruction-set label does not change, so
  pair by exact version.
- **Changed:** EVM `abi.encode` and external-call arguments are compiled with a type list from the
  compiler, so nested tuples that mix scalars and pointers work at any depth. A nested tuple over
  255 fields, and a void field in `abi.encode`, are compile errors. `abi.encode` nests at most 146
  levels deep, down from 204.
- **Changed:** Solana output is smaller and cheaper to run, because the engine no longer needs a
  cast after a spill, a reload or `new Array(n)`. `main` boxes a scalar return, and hand-written
  Solana bytecode that ends on a bare number fails with `InvalidDescriptor`.
- **Fixed:** On EVM, a scalar inside a tuple, a call's argument list or a multi-value `abi.encode`
  is no longer mistaken for an internal pointer. For some large values this made a cook run out of
  gas or gave the callee a wrong argument. Recompile EVM programs.
- **Fixed:** On Solana, tuple field reads, compact entry arguments, object-literal fields and tuple
  returns no longer misread some scalars as internal pointers, which could change arithmetic,
  comparisons, hashes and call arguments.

### Compiler 2.3.0 — 2026-09-23

Pairs with v12-evm 1.0.1, kitchen-evm 1.0.0, kitchen-svm 1.0.0 and v12-svm 1.0.1, 1.1.0 or 1.2.0,
in SDK 0.99.2 to 0.99.4.

- **Breaking:** Raw EVM `Uint256[]` returns hold contiguous 32-byte values instead of boxed ones.
  Anything that decodes such a return off chain must read them that way. Programs built by earlier
  compilers keep the old shape until you recompile them.
- **Added:** On EVM, a call that returns one scalar can catch its failure with a constant fallback,
  `.catch(() => { return 0 })`, and keep its successful result. One call replaces the
  probe-then-repeat pattern for quotes.
- **Added:** Solana-only `acct.dataLen`, an account's data length, so a token library can check a
  mint before reading it. It needs v12-svm 1.0.1 or later.
- **Changed:** Optimisations cut EVM gas and Solana compute units: small scalar helpers are inlined
  when that pays, repeated expressions and tuple reads are computed once, `x + 0` and `x * 1` fold
  to `x`, and EVM scalar array literals are packed. Inlining alone cut about 24% of EVM gas and 33%
  of Solana compute units on an arithmetic benchmark.
- **Fixed:** On EVM, `abi.encode` of a scalar array could mis-encode an element whose value looked
  like an internal tag, returning output of the wrong length or content without reverting. EVM
  programs compiled by 0.3.0 through 2.2.1 are affected, so upgrade and recompile them. Solana is
  not affected. The same flaw in the scalar fields of a tuple is fixed in 2.4.0.
- **Fixed:** Heap pointers no longer leak through raw array returns on EVM.

### Compiler 2.2.1 — 2026-09-17

Pairs with v12-evm 1.0.0, kitchen-evm 1.0.0, v12-svm 1.0.0 and kitchen-svm 1.0.0, in SDK 0.99.1.

- **Fixed:** An object literal passed for a fixed-size array parameter (`T[N]`) of an external call
  has every element type-checked, not only the first. A mismatch at a later position used to
  compile to the wrong layout without reverting.
- **Fixed:** A fixed-size array parameter with N of 256 or more, or with the wrong number of
  elements, is a compile error instead of being silently encoded as a dynamic array.

### Compiler 2.2.0 — 2026-09-16

Pairs with v12-evm 0.8.0, kitchen-evm 0.5.0, v12-svm 0.8.0 and kitchen-svm 0.4.0, in SDK 0.99.0.

- **Breaking:** This compiler and the engines released with it, v12-evm 0.8.0 and v12-svm 0.8.0,
  write array and tuple elements with three operands. 2.1.0 output does not run on those engines,
  and 2.2.0 output does not run on older ones. Pair compiler and engine by exact release.
- **Added:** The `compactArgs` compile option (off by default) encodes entry arguments in the
  compact-v1 encoding instead of the ABI, on EVM and Solana. `CompileResult` gains `isaRevision`,
  `entryEncoding` and, with `compactArgs`, `entrySchema`; encode arguments with that schema.
- **Changed:** Array and tuple element writes are checked on both engines before they write, and
  the engines run with less overhead.
- **Changed:** Both engines run only through the Kitchen and a Pot, and each cook pays the Kitchen's
  flat fee. Call programs through the Kitchen and your Pot, never the engine directly. This is an
  engine change, not a compiler one.

### Compiler 2.1.0 — 2026-09-15

The SDK paired it with v12-evm 0.7.0, kitchen-evm 0.4.0, v12-svm 0.7.0 and kitchen-svm 0.3.0,
before 0.99.

- **Changed:** The compiled write needs an engine with the checked element write, first in v12-evm
  0.7.0. Recompile programs that write to array elements or struct fields.
- **Changed:** Only a change to the compiler's syntax or API can now produce a major version. This
  corrects how 2.0.0 was numbered.
- **Fixed:** On EVM, writing a value into an array element or struct field (`a[i] = v`,
  `t.f = v`) stores it the way reads expect. Before, some large values were read back as a pointer,
  which ran out of gas or returned a wrong or empty value without reverting. Solana is unchanged.

### Compiler 2.0.0 — 2026-09-15

The SDK paired it with v12-evm 0.6.0, kitchen-evm 0.3.0, v12-svm 0.7.0 and kitchen-svm 0.3.0,
before 0.99.

- **Changed:** 2.0.0 has no breaking language change. Its major version came from an EVM Kitchen
  change, a new Kitchen and Pot address family (see kitchen-evm 0.3.0). Nothing a 1.0.0 user
  writes or calls changed.
- **Fixed:** Programs larger than 64 KiB compile: jump targets widen when needed instead of failing
  with "the compiled program is too large to jump within". A program that fits in 64 KiB compiles
  to the same bytes as before.

### Compiler 1.0.0 — 2026-09-11

The SDK paired it with v12-evm 0.6.0, kitchen-evm 0.2.0, v12-svm 0.7.0 and kitchen-svm 0.2.0,
before 0.99.

- **Breaking:** ABI types keep their width both ways. An `address` output, or
  `abi.decode(d, ["Address"])`, is masked to 20 bytes, and `uintN` to N bytes, so `["Address"]`
  and `["Uint256"]` no longer compile to the same bytecode. Recompile programs that decode
  addresses or small integers.
- **Breaking:** A `bytesN` argument (N below 32) to an external call sits at the high end of its
  ABI slot, as Solidity expects, and must be written at the call site. Reading a method's `bytesN`
  output gives its N bytes at the low end, and a `bytesN` inside a tuple or array output no longer
  compiles.
- **Breaking:** A local, a parameter or a contract handle named after one of the module's
  contracts no longer compiles. Rename the binding.
- **Added:** The compiler's JavaScript API (`CompileOptions`, `CompileResult` and the resolver
  contract) follows semantic versioning from 1.0.0. A change to the bytecode a program compiles to
  is a compiler change, not an API change, so look for it in this changelog, not in the version
  number. Treat a move from any 0.x compiler to 1.0.0 as a major change.
- **Changed:** Each of the five packages under the SDK now states what its 1.x will commit to (see
  [How Sauce is versioned](#how-sauce-is-versioned)).
- **Fixed:** Errors thrown by `compile` no longer include the compiler's own source paths and line
  numbers.

### Compiler 0.7.0 — 2026-09-09

- **Breaking:** On EVM, `Pot.cook(engine, program)` replaces `Pot.cook(program)`. The caller names
  the engine, which is no longer part of the Pot's creation data, and callers must encode
  `cook(address,bytes)`.
- **Breaking:** On Solana, `create_pot` takes the engine program, and `cook` and
  `cook_from_account` take the engine as an account. A write needs the signature of the account
  being written, so a program that writes storage declares the account as
  `Account<Writable, Signer>`, and `cook` is no longer open to anyone.
- **Added:** `crypto.findPDA(programId, seeds)` derives a Solana program address and bump on both
  targets; destructure it as `const [address, bump] = ...`. `account.address` reads an attached
  account's own public key.
- **Added:** The Solana Kitchen takes bytecode inline in the instruction or staged in a code
  buffer. A v12-svm release carries the Kitchen IDL, a wire description of the engine per cluster,
  and separate devnet and mainnet engines.
- **Fixed:** A contract call with a fixed-size array input such as `uint256[2]` encoded it as a
  dynamic array, so the callee misread later arguments. It now follows the ABI, and contract-call
  arguments are type-checked against the declared inputs.
- **Fixed:** The EVM engine bounds every `abi.decode` read by its source, so a call to an address
  with no code, or a short return, no longer decodes to zero or garbage. It reverts on an unknown
  instruction, and `eval` gives the same answer on both engines.

### Compiler 0.6.0 — 2026-09-02

- **Added:** Scripts: top-level statements are the entry point, so a file with no `main` compiles
  to the same bytes as one wrapped in `function main(): void { ... }`.
- **Added:** A per-function cache that speeds up repeated compiles of one program, on by default
  and switched off with the `cache` option; `clearFunctionCache()` and `functionCacheStats()`
  manage it.
- **Changed:** Smaller bytecode: `!=`, `>=` and `<=` compile to one instruction, an `if` without
  `else` emits one branch, `&&` and `||` over a cheap right operand need no branch, and a wide
  constant read many times is no longer copied at every use. Nothing breaks.

### Compiler 0.5.0 — 2026-08-31

- **Breaking:** An import attribute other than `with { type: "json" }` is a compile error. The
  compiler's own command line no longer reads `sauce.toml`. `svm.sstore` on an `Account` parameter
  not declared writable no longer compiles; annotate it `Account<Writable>`. Solana engine faults
  return distinct error codes, so code that matched the old generic error must change.
- **Added:** The `defines`, `ambient` and `inlineContracts` compile options, and JSON data imports
  (`import cfg from "./cfg.json" with { type: "json" }`).
- **Added:** `interface` for named record types, `for (const x of xs)`, tuple destructuring such as
  `const [a, b] = call()`, `.catch(() => { ... })` on an EVM external call, `++` and `--`,
  `new Array(n)`, module-scope lookup tables, and `evm.tload` and `evm.tstore` for transient
  storage.
- **Added:** EVM reads `ctx.msgValue()`, `ctx.gasLeft()`, `ctx.codeSize(addr)`,
  `ctx.codeHash(addr)`, `ctx.isContract(addr)` and `ctx.isEOA(addr)`, and a portable
  `ctx.msgData()`. An `Account` parameter can declare its role as `Account<Writable>` or
  `Account<Signer>`, and entry parameters of any shape decode.
- **Changed:** Loops with constant bounds are unrolled and folded, and constant calls to small pure
  functions are folded.
- **Fixed:** An ambient export no longer wins over an import of the same name. Programs with more
  than 16 entry parameters no longer fail with "a local variable is 17 deep", and an `if` arm no
  longer fails with a false "branches leave different locals live".

### Compiler 0.4.1 — 2026-08-20

- **Changed:** The npm page has its own README, which matches the compiler.
- **Fixed:** The published TypeScript declarations for the account manifest listed a removed
  `program` kind and left out the `remaining` kind. They now match the compiler.

### Compiler 0.4.0 — 2026-08-20

- **Breaking:** `svm.call`'s callee is a declared `Account` instead of a literal public key, and
  every account known at compile time is a `main` parameter. The account manifest has no `program`
  entries, so callers pass the token program as an account and attach it.
- **Breaking:** Dynamic values have a new layout in the engines, so upgrade the compiler and the
  engines together.
- **Added:** `svm.remainingAccount(i)` and `svm.remainingAccounts()` read accounts attached after
  those `main` declares. `==` and `!=` on an `Account` compare identity, and `account.owner` reads
  the program that owns an account.
- **Changed:** Arrays and tuples built at run time are no longer capped at 255 elements.

### Compiler 0.3.0 — 2026-08-18

- **Breaking:** The npm package is renamed from `@eco-incorp/sauce-compiler-wasm` to
  `@eco-incorp/sauce-compiler`, on the public npm registry. Update the dependency and imports.
- **Breaking:** `bool` is its own type: a number where a `bool` is declared no longer compiles, nor
  the reverse. Convert with `cond ? 1 : 0`.
- **Breaking:** `abi`, `crypto`, `ctx`, `Math`, `evm` and `svm` can no longer name a variable,
  parameter or import. A struct passed to a contract call is matched to the ABI's fields by name,
  and a literal that names only some of them is an error.
- **Added:** A browser build beside the Node build (call `await init()` before `compile` in a
  browser), typed declarations, and a portable `eval(code, ...args)` on both targets.
- **Fixed:** `abi.decode` of a fixed-size array such as `uint256[3]` read every later output from
  the wrong offset. A struct passed to a contract call was encoded in source order rather than the
  ABI's order.

### Compiler 0.2.0 — 2026-08-17

Published as `@eco-incorp/sauce-compiler-wasm` on GitHub Packages.

- **Breaking:** The EVM Pot's entry point is `cook(bytes)` instead of `cook(bytes[])`; encode one
  program.
- **Breaking:** `abi.decode` no longer takes the shape word `"scalar"`: use `Uint256`, `Address`,
  `bool`, `bytes` and `string`. An unknown type annotation, a leading-zero integer literal, a
  function named `log`, and a literal index past the end of a fixed-size array in a store are
  compile errors. A function other than `main` that returns an array, tuple or `bytes` must
  annotate its return type.
- **Breaking:** A resolver says "nothing here" by returning `undefined` or `null`, not by throwing.
- **Added:** `cond ? a : b`, `**=`, `throw "msg"`, `abi.encode(a, b)`, tuple projection by index
  or output name, a portable `log(data, ...topics)`, module-scope `let` and `const`, and `bytes`,
  array and tuple parameters.
- **Changed:** `&&` and `||` short-circuit as in JavaScript, and only functions reachable from the
  entry point are emitted.
- **Fixed:** Wide expressions no longer fail with "a local variable is 17 deep", evaluation order
  holds when an operand can abort, stores into decoded arrays write the right value, nested static
  tuples encode inline, and scratch memory no longer overlaps live data.

### Compiler 0.1.0 — 2026-08-09

The first release, published as `@eco-incorp/sauce-compiler-wasm` on GitHub Packages.

- **Breaking:** `: void` is a real return type: a `: void` function that returns a value no longer
  compiles, and a `void` call cannot be used as a value.
- **Added:** A compiler for a checked TypeScript subset, producing bytecode for the EVM and Solana
  engines: integers, booleans, arithmetic, `if`, loops, functions, strings, bytes, arrays and
  structs written as object literals.
- **Added:** `abi.encode` and `abi.decode`, `ctx`, `crypto.keccak256` and `crypto.ecdsaVerify`,
  storage, `throw`, contract deployment, events, `eval`, `catch` on external calls, and raw calls.
- **Added:** Imports resolved from `node_modules`, checked type annotations, and `main` parameters
  read from the program's runtime input.
- **Added:** The Solana account model (an `Account` type, `svm.*` operations and an account
  manifest), and `@sauce/token`, one import that moves ERC-20 tokens on EVM and SPL tokens on
  Solana.
- **Fixed:** A `return` stops execution, and numeric literals keep full precision.

## The EVM engine (v12-evm)

The EVM engine runs compiled programs inside a Pot. Each release names the compiler it pairs with.

### v12-evm 1.2.0 — 2026-10-06

Pairs with compiler 2.5.0, in SDK 0.99.9 to 0.99.14.

- **Breaking:** The Pot's code changed, so every new Pot has a new address, and this engine refuses
  Pots made for earlier engines. Existing Pots keep cooking on the engine they were made for; a Pot
  names its engine on every cook, and nothing migrates. This shipped as a minor release under a
  documented exception.
- **Added:** Private and Shared Pots: a Private Pot has an owner, and anyone may cook on a Shared
  Pot. See kitchen-evm 1.2.0.
- **Added:** Router generation 4, with one exact-input method for each venue that calls back in the
  middle of a swap. See kitchen-evm 1.2.0.
- **Changed:** `eval` runs as the calling Pot, read-only, instead of as the engine, and nested
  `eval` works again.
- **Fixed:** `ctx.blobBaseFee()` returned a constant on every chain. It now returns each network's
  real blob base fee, and halts the cook on networks without it, such as Arbitrum and Polygon.
- **Fixed:** The engine no longer runs a program at its own address.
- **Removed:** The Router's unified `swap`, its exact-output mode, its quote method, and its
  wrappers for venues that are paid first (Uniswap V2, Curve, Balancer V2, DODO V2, Trader Joe LB,
  WOOFi). A program calls those venues directly.

### v12-evm 1.1.0 — 2026-09-30

Pairs with compiler 2.4.0, in SDK 0.99.5 to 0.99.8.

- **Breaking:** Router generation 3 changes the address of every new Pot, while the Kitchen stays
  at generation 2. This shipped as a minor release under a documented exception.
- **Breaking:** `abi.encode` and call arguments are encoded from a type list the compiler emits, so
  compiler and engine must come from paired releases.
- **Added:** The Kitchen keeps the Router in storage, with an owner-only `setRouter(address)`, and a
  Pot can move to a newer Router with its own `setRouter(address)`.
- **Added:** The Router accepts Synthra V3 and UnitFlow V3 callbacks, and bounded Maverick V2
  swaps and quotes take a tick limit.
- **Changed:** A Pot is created with no constructor arguments, so a later Router change does not
  move Pot addresses. Swap callbacks are single-use and capped at the swap's input.
- **Fixed:** A plain number inside a tuple could be mistaken for a pointer, which ran the cook out
  of gas or gave a callee the wrong argument. The engine is also 873 bytes smaller.

### v12-evm 1.0.1 — 2026-09-23

Pairs with compiler 2.3.0, in SDK 0.99.2 to 0.99.4.

- **Changed:** The engine is cheaper to run: about 5.8% less gas on a recursive benchmark, and 246
  bytes less engine code.
- **Changed:** The scalar-array fix released beside it is a compiler fix: upgrade the compiler to
  2.3.0, not the engine.

### v12-evm 1.0.0 — 2026-09-17

Pairs with compiler 2.2.1, in SDK 0.99.1.

- **Breaking:** Declares the engine stable. Runtime behaviour is the same as 0.8.0, so nothing
  needs to change. From here, removing or renumbering an instruction, an incompatible change to
  what one does, or breaking existing Pots needs a major version.
- **Fixed:** `crypto.findPDA` seeds are bounds-checked on the EVM. Compiler output was never
  affected.

### v12-evm 0.8.0 — 2026-09-16

Pairs with compiler 2.2.0, in SDK 0.99.0.

- **Breaking:** The checked element write takes three operands, so a compiler and an engine from
  different releases disagree on array and field writes. Pair them by exact version.
- **Added:** The engine runs only when called from a Pot the Kitchen made, and every `cook` charges
  the Kitchen's flat fee, whichever engine it names.
- **Added:** Element and field writes are checked before they write, and execution costs less.
- **Added:** Compact entry arguments, for the compiler's `compactArgs` option.
- **Changed:** Nested `eval` is not supported in this release; one level works.

### v12-evm 0.7.0 — 2026-09-15

The SDK paired it with compiler 2.1.0, before 0.99.

- **Breaking:** The Kitchen moves to a new address (Kitchen generation 2), so new Pots derive from
  the new Kitchen. Existing Pots stay where they are and keep working. See kitchen-evm 0.3.0.
- **Fixed:** Writing a large value into an array element or struct field (`a[i] = v`, `t.f = v`)
  could run the cook out of gas. Writes now store values the way reads expect; this needs compiler
  2.1.0.

### v12-evm 0.6.0 — 2026-09-11

The SDK paired it with compiler 1.0.0 and 2.0.0, before 0.99.

- **Breaking:** The Router moves to generation 2 and every Pot address derives from it, so a
  predicted Pot address differs from before. No Pot had been deployed at the old generation.
- **Breaking:** ABI-decoded `address` and `uintN` outputs are narrowed to their declared width.
  This needs the matching compiler, 1.0.0.
- **Changed:** Each package's 1.0 commitment is written into its release notes.

### v12-evm 0.5.0 — 2026-09-10

No SDK release pinned it. Compiler 0.7.0 was the newest compiler then.

- **Added:** The EVM Kitchen sits behind a proxy at a fixed address, so it can be upgraded without
  moving Pots. Each engine release is a new program at a new address, and a cook names its engine.
- **Changed:** The Kitchen has its own release line, kitchen-evm, starting at 0.1.0, so a change to
  the Kitchen alone no longer bumps the engine's version or moves its address.

### v12-evm 0.4.0 — 2026-09-09

No SDK release pinned it. Compiler 0.7.0 is the first compiler with its `cook(engine, program)` and
`crypto.findPDA` changes.

- **Breaking:** `Pot.cook(address engine, bytes program)` replaces `Pot.cook(bytes)`, and the
  engine leaves the Pot's creation code, so every Pot address changes. Use the SDK to build cook
  calldata and predict Pots.
- **Added:** `crypto.findPDA(programId, seeds)`, with the curve arithmetic done by the engine.
- **Changed:** The engine's main loop is slightly cheaper.
- **Fixed:** An instruction the engine does not implement, such as one from a newer compiler, now
  reverts instead of being skipped. A function that dropped its whole frame keeps its return
  address.
- **Fixed:** `abi.decode` reads are bounded by their source, so a typed call to an address with no
  code, or with short return data, reverts instead of decoding to zeros. A literal byte string read
  past the end of the program reverts, as on Solana.
- **Fixed:** `eval` gives the same answer on EVM and Solana.
- **Fixed:** Router quotes read Algebra-style pools (Camelot, QuickSwap V3), and DODO V2, Trader Joe
  LB and Maverick V2 swaps check both pool tokens and revert with `InvalidPool()` on a mismatch.

### v12-evm 0.3.0 — 2026-08-28

No SDK release pinned it. Compiler 0.5.0 is the first compiler with its matching tuple change.

- **Breaking:** A static tuple with more than 2,047 leaves built by `concat`, `slice` or
  `abi.decode` now reverts when encoded, as it already did when built by a literal.
- **Changed:** Building tuples is cheaper, most of all with hundreds of elements.
- **Fixed:** `abi.encode` inlines nested static tuples the same way however the tuple was made: a
  literal, `abi.decode`, `concat` or `slice`.

### v12-evm 0.2.0 — 2026-08-20

No SDK release pinned it. Compiler 0.4.0 is the first compiler with the same layout change.

- **Breaking:** Dynamic values (bytes, arrays and tuples) use a 32-bit pointer and length, so
  bytecode for 0.1.0 does not run correctly on this engine, nor the reverse. Use a compiler and an
  engine that belong together.
- **Added:** Arrays and tuples built or decoded at run time can hold more than 255 elements.
- **Changed:** Encoding a static tuple with more than 2,047 leaves still reverts, now explicitly.

### v12-evm 0.1.0 — 2026-08-17

No SDK release pinned it. Compiler 0.2.0 is the first compiler with its `cook(bytes)` entry point
and `log` builtin.

- **Breaking:** The Pot's entry point is `cook(bytes)` instead of `cook(bytes[])`, with a new
  selector. Use the SDK to encode it.
- **Added:** The Kitchen, Pot and Router are part of v12-evm again, under plain names without the
  `V12` prefix, so programs run inside a Pot the Kitchen makes.
- **Added:** The Router sells native ETH through Uniswap V4 pools, and a V4 pool key that does not
  match the token pair reverts with `InvalidPool()`. The engine runs the `log` builtin, with up to
  four topics.
- **Changed:** Inside a Pot, `eval` runs as the engine's account, not the Pot's, so it cannot read
  the Pot's storage or balance.
- **Fixed:** `eval` inside a Pot returned no data; it now runs the inner program.
- **Fixed:** No engine handler writes to a fixed memory address any more, which had silently
  corrupted live data in `crypto.ecdsaVerify`, `Math.mulDiv`, `slice`, `concat`, literals and
  ABI-typed calls. Events with three or four topics, predicted contract addresses and nested
  static structs in `abi.encode` are fixed too.

## The EVM Kitchen (kitchen-evm)

The EVM Kitchen makes Pots and runs cooks. This package also holds the Pot and Router contracts and
their ABIs. Each release names the compiler it pairs with.

### kitchen-evm 1.2.0 — 2026-10-06

Pairs with compiler 2.5.0 and v12-evm 1.2.0, in SDK 0.99.9 to 0.99.14. Those SDK releases also keep
kitchen-evm 1.1.0's Router for quotes.

- **Breaking:** The Pot's code changed, so every new Pot has a new address. The engine built for
  the new Pots refuses existing ones, and existing Pots keep working on the engine they were made
  for. Derive Pot addresses with the SDK. This shipped as a minor release under a documented
  exception.
- **Breaking:** The Router's interface changes (generation 4). Venues that are paid first (Uniswap
  V2, Curve, Balancer V2, DODO V2, Trader Joe LB, WOOFi) are called by the program directly.
  Callers of the generation-3 Router, `@sauce/router` included, must move to the new methods.
- **Added:** Private and Shared Pots. `Kitchen.deploySharedPot(salt)` makes a Pot with no owner and
  a fixed Router, which anyone may cook on (the Kitchen fee still applies);
  `deployPot(owner, salt, true)` makes a Private Pot with a fixed Router. Matching `predict…`
  functions give each address.
- **Added:** Router generation 4 has one exact-input method per venue that calls back mid-swap
  (`swapV3`, `swapV4`, `swapMaverickV2`, `swapInfinityCL`, `swapInfinityBin`), each returning
  `(amountInUsed, amountOut)`, and `flash(callback, swap)` runs a program inside a venue's callback.
  Only the Pot may call them.
- **Added:** `Pot.eval(bytes)` runs a nested `eval` as the Pot, read-only, for the engine that is
  running the cook.
- **Changed:** Router generation 4 is about a third of the size and uses roughly 4k to 15k less gas
  per swap leg. `Kitchen.setRouter` installs it for new Pots, existing Pot owners opt in with
  `Pot.setRouter`, and generation 3 stays deployed.
- **Changed:** Inside an `eval`, `ctx.self()`, storage and balance reads see the Pot, and nested
  `eval` works.
- **Removed:** From the Router: `swap(SwapParams)`, `SwapPoolType`, `SwapParams`, `QuoteParams`,
  `swapMaverickV2Bounded`, every `quote*` and `simulate*` function, and the handlers for the venues
  that are paid first.

### kitchen-evm 1.1.0 — 2026-09-30

Pairs with compiler 2.4.0 and v12-evm 1.1.0, in SDK 0.99.5 to 0.99.8.

- **Breaking:** The Pot is created with no constructor arguments, so every Pot made after the
  upgrade has a new address. Existing Pots keep their address, Router and engine. Use an engine
  built for the new Pots.
- **Breaking:** The Router moves to generation 3 while the Kitchen stays at generation 2, which also
  changes the address of new Pots. This shipped as a minor release under a documented exception to
  the major-version rule.
- **Breaking:** `abi.encode` takes a type list from the compiler, so bytecode that encodes or calls
  must come from the paired compiler.
- **Added:** `Kitchen.setRouter(address)`, owner only, sets the Router that new Pots start on and
  refuses an address with no code. `Pot.setRouter(address)` moves a Pot to another Router.
- **Added:** `swapMaverickV2Bounded` and `quoteMaverickV2Bounded` take a Maverick tick limit, and
  the Router accepts Synthra V3 and UnitFlow V3 callbacks.
- **Changed:** A Router upgrade no longer moves Pot addresses: it is a new Router generation plus
  `Kitchen.setRouter`. A release that changes only the Router reuses the deployed Kitchen.
- **Changed:** Swap callbacks are single-use and cannot be paid more than the swap's exact input.
- **Fixed:** A scalar inside a tuple could be mistaken for a pointer, which ran the cook out of gas
  or passed the wrong argument.

### kitchen-evm 1.0.0 — 2026-09-17

Pairs with compiler 2.2.1 and 2.3.0, in SDK 0.99.1 to 0.99.4.

- **Breaking:** Declares stability only: no ABI, address or behaviour changes, and nothing needs to
  change.
- **Changed:** From 1.0, a breaking ABI change needs a major version, unless the release notes
  state an exception.

### kitchen-evm 0.5.0 — 2026-09-16

Pairs with compiler 2.2.0 and v12-evm 0.8.0, in SDK 0.99.0.

- **Breaking:** The Pot's code changes, so every Pot made after this release has a new address,
  and the engine built for it refuses older Pots. Derive Pot addresses with the SDK.
- **Breaking:** `cook` reverts unless it sends at least `executionFee()`. Read the fee before each
  cook.
- **Breaking:** The element write takes three operands, so compiler and engine must be a matching
  pair.
- **Added:** `Kitchen.executionFee()`, a flat fee the owner sets and every cook pays, whichever
  engine it names, and an owner-only `withdrawExecutionFees(recipient, amount)`.
- **Added:** A Pot reads its owner and salt from the Kitchen while it is created, so every Pot
  shares one creation code. The engine built for this release runs only in such a Pot.
- **Added:** Checked element writes and compact entry arguments in the engine.
- **Removed:** The unchecked element write.

### kitchen-evm 0.4.0 — 2026-09-15

The SDK paired it with compiler 2.1.0, before 0.99.

- **Changed:** Only a change to a contract's ABI can produce a major kitchen-evm version. An address
  is where a contract is deployed, not what it offers.
- **Fixed:** A large value written into an array element or tuple field no longer reads back as a
  pointer and runs the cook out of gas. The fix is in the engine and the compiler.

### kitchen-evm 0.3.0 — 2026-09-15

The SDK paired it with compiler 2.0.0, before 0.99.

- **Breaking:** The Kitchen moves to a new proxy address (Kitchen generation 2), starting a new
  Kitchen and Pot address family. Existing Pots stay where they are and keep working. Anyone who
  pinned the Kitchen's address, or Pot addresses derived from it, must switch.
- **Added:** The Kitchen is UUPS-upgradeable with two-step ownership built in. Only the owner can
  authorise an upgrade, and `renounceOwnership` always reverts. `KitchenProxy` is an
  `ERC1967Proxy` that sets a non-zero owner when it is deployed.
- **Changed:** The separate proxy admin is gone. The Router and Pot code are byte for byte the same
  as 0.2.0, so the generation-2 Router keeps its address.

### kitchen-evm 0.2.0 — 2026-09-11

The SDK paired it with compiler 1.0.0, before 0.99.

- **Breaking:** The Router moves to generation 2, and every Pot address derives from it. No Pot had
  been deployed at generation 1, so nothing deployed moves; re-derive any address you recorded.
- **Changed:** The release notes state the package's commitment: semantic versioning covers its
  ABIs and the derivation of their addresses, not addresses derived per version, and not the
  bytecode a program compiles to.
- **Fixed:** Router quotes for Uniswap V4, PancakeSwap Infinity and `simulateSwap` check that the
  reported amounts match an exact-input swap, and revert with `QuoteDeltasNotExactInput` otherwise.
  The same check covers V3-family quotes, and a V3 quote through `simulateSwap` reports the real
  input.

### kitchen-evm 0.1.0 — 2026-09-10

No SDK release pinned it. Compiler 0.7.0 was the newest compiler then.

- **Breaking:** `cook` takes the engine as its first argument, `cook(engine, program)`, and only the
  Pot's owner or the Pot itself may call it. The engine leaves the Pot's address, so a Pot keeps
  its address across engine releases, but it still depends on the Router.
- **Added:** The first release on its own: the `Kitchen` that makes Pots, its upgradeable
  `KitchenProxy` at a fixed address, the `Pot` and the generation-1 `Router`. They used to ship in
  v12-evm releases.
- **Added:** Each release carries the contracts' ABIs, which the SDK reads.
- **Changed:** The Router's Uniswap V4 swap settles native-ETH pairs, and a V4 pool key that does
  not match the tokens reverts with `InvalidPool()`.
- **Fixed:** `eval` under a Pot's `cook` runs the nested program. Router quotes accept only a reply
  of the expected length and work on Algebra-style pools, and DODO V2, Trader Joe LB and Maverick
  V2 swaps check both pool tokens.

## The Solana engine (v12-svm)

The Solana engine runs compiled programs for a Pot on Solana. Each release names the compiler it
pairs with.

### v12-svm 1.3.0 — 2026-09-30

Pairs with compiler 2.4.0 and 2.5.0, in SDK 0.99.5 to 0.99.14.

- **Breaking:** Compiler output and engine must match: older compiler output fails with
  `InvalidOpcode` on this engine, and 2.4.0 output fails with `ExpectedDescriptor` on older
  engines. The 1.2.x engine keeps running older programs.
- **Breaking:** Hand-written Solana bytecode that ends on a bare number fails with
  `InvalidDescriptor`, so box any number you return. The stack holds 1,056 words instead of 1,024.
- **Changed:** Every stack slot is an untyped 32-byte word. Engine compute falls by 1.4% to 41%
  across the measured workloads, and the program binary is 27.7% smaller.
- **Fixed:** Some scalars, among them large 18-decimal amounts and u128 pool fields, were misread
  as internal pointers when read from a tuple, a compact argument or an object-literal field. That
  changed arithmetic, comparisons, hashes and call arguments.
- **Fixed:** Concatenation can no longer copy bytes from beyond the heap's allocation.

### v12-svm 1.2.0 — 2026-09-25

Pairs with compiler 2.3.0, in SDK 0.99.4.

- **Added:** `cookAndPayFromAccountPinned`, a direct staged cook that checks the SHA-256 of the
  whole code account, runtime arguments included, against an expected hash before it charges the
  fee or runs. A mismatch fails with `CodeHashMismatch`.
- **Changed:** The unpinned direct staged cook from 1.1.0 is unchanged. To get the content check,
  choose the pinned one and pass the hash on every cook.

### v12-svm 1.1.0 — 2026-09-24

Pairs with compiler 2.3.0, in SDK 0.99.3.

- **Added:** Direct paid cooks that skip the Kitchen's call frame, so a caller, the engine, a
  bridge, a venue and a token fit Solana's five-frame limit: `cook_and_pay` (inline bytecode) and
  `cook_and_pay_from_account` (staged code). Each takes `max_execution_fee`, refuses a higher
  configured fee before paying, and grants no Pot signature.
- **Added:** Fees for direct cooks use the Kitchen's fee configuration and withdrawal.
- **Changed:** A direct paid inline cook uses about 12,700 to 14,100 fewer compute units than a
  paid Kitchen cook, and every cook derives the Pot once, saving about 1,800 compute units.

### v12-svm 1.0.1 — 2026-09-23

Pairs with compiler 2.3.0, in SDK 0.99.2.

- **Added:** Solana-only `acct.dataLen`, an account's data length, so `@sauce/token` can check an
  SPL mint before reading its supply or decimals. Compiler output that uses it needs this engine.
- **Changed:** Stack operations are much cheaper: total compute fell 22% to 25% on the measured swap
  programs.
- **Fixed:** Mint reads in `@sauce/token` on Solana check the account's layout and initialisation
  instead of trusting its bytes.

### v12-svm 1.0.0 — 2026-09-17

Pairs with compiler 2.2.1, in SDK 0.99.1.

- **Breaking:** Declares the engine stable; runtime behaviour and the compiler version are
  unchanged. From here the wire contract (the instruction encoding, the account order a caller
  attaches and the instruction semantics) changes only in a major version. Program ids derived per
  version are not part of the promise.
- **Fixed:** On the EVM engine, `crypto.findPDA`'s seeds are bounds-checked at both ends; the
  Solana engine already refused bad seeds.

### v12-svm 0.8.0 — 2026-09-16

Pairs with compiler 2.2.0, in SDK 0.99.0.

- **Breaking:** The engine runs only for a Pot that a Kitchen `cook` signs, and a direct call to
  the engine is rejected. Every `cook` and `cook_from_account` pays the Kitchen's flat fee and must
  carry `max_execution_fee`. Clients that called the engine directly or built Kitchen instructions
  by hand must change.
- **Breaking:** Compiler output that changes arrays or tuples must be paired with this engine,
  because the element write takes three operands.
- **Added:** Checked element writes, and compact entry arguments for the compiler's `compactArgs`.
- **Changed:** The interpreter runs with less overhead.

### v12-svm 0.7.0 — 2026-09-11

The SDK paired it with compiler 1.0.0, 2.0.0 and 2.1.0, before 0.99.

- **Breaking:** No runtime change. The breaking marker only records what each package commits to
  from 1.0.
- **Changed:** v12-svm states that from 1.0 its published wire contract follows semantic
  versioning. Program ids derived per version, and the bytecode a program compiles to, are never
  promised.

### v12-svm 0.6.0 — 2026-09-10

No SDK release pinned it. Compiler 0.7.0 was the newest compiler then.

- **Changed:** The Solana Kitchen keeps one program id and is upgraded in place, so Pots and code
  buffers keep their addresses across Kitchen releases.
- **Changed:** Each engine release is a new program at a new id that follows its version, and a
  cook names its engine, so an old engine keeps working for anyone who names it.
- **Changed:** This is the last v12-svm release that carries the Kitchen; later Kitchens are
  kitchen-svm releases.

### v12-svm 0.5.0 — 2026-09-09

No SDK release pinned it. Compiler 0.7.0 is the first compiler with its `crypto.findPDA` and Pot
changes.

- **Breaking:** `cook` needs the Pot's authority to sign, and signs only the Pot its `pot_salt`
  names.
- **Breaking:** Pots are salted: a Pot is derived from its authority and a salt, so Pot addresses
  and the `create_pot` and `cook` arguments change. Re-derive Pots with the salt.
- **Breaking:** The engine is passed on each call: `create_pot`, `cook`, `cook_from_account` and
  `close_pot` take an engine account. There is one engine build per cluster (devnet and mainnet),
  because the chain id is compiled in.
- **Added:** `crypto.findPDA(programId, seeds)`, checked against Solana's own derivation.
- **Added:** A Pot is an account the engine owns, and one authority can hold several. `close_pot`
  reclaims a Pot's rent.
- **Added:** The Kitchen's `cook` takes bytecode inline, and the staged form is
  `cook_from_account`. Releases publish the Kitchen's Anchor IDL and a wire description of the
  engine for each cluster.
- **Changed:** A write to a Pot (`svm.sstore`) needs the account's signature, so declare it
  `Account<Writable, Signer>`. The staging instructions are renamed `*_code_buffer`.
- **Fixed:** `eval` returns the same shape of result on both engines.

### v12-svm 0.4.0 — 2026-08-28

No SDK release pinned it. Compiler 0.4.1 was the newest compiler then.

- **Breaking:** 21 engine faults that all surfaced as `InvalidInstructionData` now return their own
  `Custom(n)` code. Code that read `InvalidInstructionData` as "the engine failed" must match the
  new codes.
- **Added:** Each fault has its own code, grouped by kind (the program's own revert is 0), so a test
  can tell faults apart.

### v12-svm 0.3.0 — 2026-08-20

No SDK release pinned it. Compiler 0.4.0 is the first compiler with the same account and layout
changes.

- **Breaking:** `svm.call`'s callee is a declared `Account` instead of a literal program key. A
  Solana program that calls another program, and a client that builds its account list, must
  recompile with the matching compiler.
- **Breaking:** Dynamic values use a 32-bit pointer and length, lifting the 255-element cap.
  Programs and engines from before and after this change do not mix.
- **Added:** `account.owner` (the program that owns an account, which a caller cannot fake),
  `svm.remainingAccount(i)` and `svm.remainingAccounts()`, and identity comparison with `==` and
  `!=` on accounts.
- **Changed:** A program's account manifest is exactly `main`'s `Account` parameters.
  `@sauce/token`'s Solana functions take the token program as an `Account` and check an account's
  owner before trusting its bytes.

### v12-svm 0.2.0 — 2026-08-18

No SDK release pinned it. Compiler 0.3.0 is the first compiler with `eval` on Solana.

- **Breaking:** The compiler's npm package is renamed from `@eco-incorp/sauce-compiler-wasm` to
  `@eco-incorp/sauce-compiler`. This is not an engine change.
- **Added:** The engine runs a byte string as Sauce bytecode in a nested, read-only frame: the
  engine side of `eval`. The inner frame sees the caller's accounts but cannot write them.
- **Changed:** An inner `eval` gets the memory the outer program has not used, so the same `eval`
  can succeed early in a program and fail late in it. A failed inner `eval` fails the outer
  program.

### v12-svm 0.1.0 — 2026-08-17

No SDK release pinned it. Compiler 0.2.0 was the newest compiler then.

- **Added:** `main` can take number and boolean parameters, read from the program's runtime input
  on both engines. Arguments sit after the program and never run as code.
- **Added:** The Solana engine hands the program its whole instruction payload, which is how a
  compiled program reads those arguments.
- **Added:** Type annotations are checked: a mismatch is a compile error with a source location.

## The Solana Kitchen (kitchen-svm)

The Solana Kitchen makes Pots and runs cooks on Solana. Each release names the compiler it pairs
with.

### kitchen-svm 1.0.0 — 2026-09-17

Pairs with compiler 2.2.1, 2.3.0, 2.4.0 and 2.5.0, in SDK 0.99.1 to 0.99.14.

- **Breaking:** Declares stability only; runtime behaviour and the compiler version are unchanged.
- **Changed:** From 1.0 the Kitchen commits to its Anchor IDL: instruction names and arguments,
  account lists and roles, and the seeds a client derives addresses from. Changing it needs a major
  version. The program id is fixed and upgraded in place, so it is not a version promise.

### kitchen-svm 0.4.0 — 2026-09-16

Pairs with compiler 2.2.0 and v12-svm 0.8.0, in SDK 0.99.0.

- **Breaking:** A Kitchen cannot cook until it has a fee: `initialize_execution_fee` must run
  first, and every client must pass the fee configuration and `max_execution_fee`.
- **Breaking:** A Kitchen without an upgrade authority has a frozen fee and fees nobody can
  collect, because setting and withdrawing fees both need that authority.
- **Added:** Every `cook` and `cook_from_account` collects a flat fee in lamports before it runs the
  engine. `initialize_execution_fee` and `set_execution_fee` set it, callers quote it from the fee
  configuration, and a raised fee rejects a stale quote. `withdraw_execution_fees` collects the
  fees.
- **Added:** The Kitchen signs the Pot it cooks for, and the engine checks it.
- **Changed:** Every cook locks the Kitchen's fee configuration for writing, so cooks in one Kitchen
  run one after another. A failed engine run rolls back the fee.

### kitchen-svm 0.3.0 — 2026-09-15

The SDK paired it with compiler 2.0.0 and 2.1.0, before 0.99.

- **Changed:** A staged program can be up to 1 MiB instead of 65,535 bytes, so a program over
  64 KiB can be staged.
- **Changed:** Finalising a full 1 MiB buffer takes about 531,000 compute units, well within a
  transaction's budget, and staging one takes about 1,166 transactions.

### kitchen-svm 0.2.0 — 2026-09-11

The SDK paired it with compiler 1.0.0, before 0.99.

- **Breaking:** No runtime change; the marker only records the 1.0 commitment.
- **Changed:** From 1.0 the Kitchen's public surface is its Anchor IDL; its program id is fixed and
  is not a version promise.

### kitchen-svm 0.1.0 — 2026-09-10

No SDK release pinned it. Compiler 0.7.0 was the newest compiler then.

- **Breaking:** `cook` needs the authority's signature and takes `pot_salt`, because Pots are
  salted. Clients built for the unsalted form must change.
- **Breaking:** A cook names its engine: `create_pot`, `cook`, `cook_from_account` and `close_pot`
  take an `engine_program` account.
- **Added:** The first release on its own: an Anchor program with a published IDL and instructions
  to stage code (`create_code_buffer`, `write_code_buffer`, `grow_code_buffer`,
  `finalize_code_buffer`, `close_code_buffer`), manage Pots (`create_pot`, `close_pot`) and cook
  (`cook`, `cook_from_account`).
- **Added:** The Kitchen has one program id and is upgraded in place, so Pot and code-buffer
  addresses survive upgrades.
- **Changed:** A code buffer holds at most 65,535 bytes in this release.

## Before 0.99

Before 0.99.0, the SDK was published under another name, `@eco-incorp/sauce-sdk`, from 0.1.0 in
June 2026 to 0.13.1 in September 2026. That line took the compiler from npm from 0.4.1 on and
pinned no engines before 0.13.0. Its releases are not listed here: 0.99.0 is the first release of
`@eco-incorp/sauce`, and the entries above start there.

## Next

[Upgrading](guides/upgrading.md) walks through moving a project from one SDK release to the next,
using the **Breaking** items above.

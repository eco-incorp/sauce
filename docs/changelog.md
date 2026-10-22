# Changelog

**Reference** · [Documentation](README.md) · [Deployments](reference/deployments.md)

> What changed in each 0.99.x release of the SDK: in SauceScript, the language you write programs
> in, and in the compiler, engines and Kitchens that release shipped. Newest first. A program that
> compiled before can stop compiling, or behave differently, after an upgrade: the entries say
> where.

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
and there is no combined version number. Each SDK release pins exactly one release of each, and
compiler output and engines pair by exact version: two engines can report the same instruction-set
label and still disagree, so match versions, never labels. From 0.99.7 the SDK keeps its pins in one
table, one row per compiler version, and refuses to build a cook for an engine that a row pairs with
a different compiler.

SDK 0.99.0 and 0.99.1 named the compiler by range, `^2.2.0` and `^2.2.1`, so an install got the
newest 2.x compiler on npm that day: 2.2.1 from 2026-09-17, 2.3.0 from 2026-09-23, 2.4.0 from
2026-09-30 and 2.5.0 from 2026-10-06. Such an install compiles the language of that compiler, not
the one listed under its release, and its output is not paired with the engines that release pins.
From 0.99.2 on, every SDK release pins the compiler exactly.

At 1.0 each package said what it promises to keep stable, and from then on a breaking change to it
raises the major version; below 1.0 it raised the minor. The compiler promises its JavaScript API
(`CompileOptions`, `CompileResult` and the resolver contract), v12-evm its instruction set and what
each instruction does, v12-svm its wire contract (the instruction encoding, the account order and
the instruction semantics), kitchen-evm its ABIs and how their addresses are derived, and
kitchen-svm its Anchor IDL. No package promises the bytecode a program compiles to, or an address
derived from a version.

A version number alone does not tell you whether Pot addresses moved: kitchen-evm 1.1.0 and 1.2.0
changed the Pot address family as documented exceptions inside 1.x. Derive Pot addresses with the
SDK rather than from a version. A cook names its engine, so an existing Pot keeps cooking on the
engine it was made for, and nothing migrates. Every engine in the table below sits at an address
that follows its version. [Deployments](reference/deployments.md) lists the addresses of the release
the SDK pins.

The SDK is still below 1.0, and it has made breaking changes in patch releases. Read each release's
**Now refused**, **Removed** and **Also breaking** items before you upgrade, even for a patch.

## Which versions work together

Each SDK release and the five releases it pins:

| SDK        | Compiler | v12-evm | kitchen-evm | v12-svm | kitchen-svm |
| ---------- | -------- | ------- | ----------- | ------- | ----------- |
| Unreleased | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.15    | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.14    | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.13    | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.12    | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.11    | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.10    | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.9     | 2.5.0    | 1.2.0   | 1.2.0       | 1.3.0   | 1.0.0       |
| 0.99.8     | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.7     | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.6     | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.5     | 2.4.0    | 1.1.0   | 1.1.0       | 1.3.0   | 1.0.0       |
| 0.99.4     | 2.3.0    | 1.0.1   | 1.0.0       | 1.2.0   | 1.0.0       |
| 0.99.3     | 2.3.0    | 1.0.1   | 1.0.0       | 1.1.0   | 1.0.0       |
| 0.99.2     | 2.3.0    | 1.0.1   | 1.0.0       | 1.0.1   | 1.0.0       |
| 0.99.1     | 2.2.1    | 1.0.0   | 1.0.0       | 1.0.0   | 1.0.0       |
| 0.99.0     | 2.2.0    | 0.8.0   | 0.5.0       | 0.8.0   | 0.4.0       |

From 0.99.9 on, the SDK also pins kitchen-evm 1.1.0's Router, for Uniswap V3 and V4 quotes only:
the 1.2.0 Router has no quote method. For 0.99.0 and 0.99.1 the compiler column gives the version
each was built and tested with; an install could resolve a newer one, as
[How Sauce is versioned](#how-sauce-is-versioned) explains.

Each SDK entry below opens with the set it ships and what moved since the release before it.
**SauceScript** lists what changed for someone writing a program, marking each change EVM, Solana or
both. A change comes from the compiler or from the SDK: its token and protocol names, `@sauce/token`
and `@sauce/router`, and the way it compiles a program for a chain. **Compiler and engines** appears
when a component moved, and says for each one what the release changes for someone using that SDK
release: pairing, the compiler's JavaScript API, what a cook can notice of the engines, Pot
addresses, the Kitchen's fee and Router, and Solana accounts. Breaking changes outside the language
close an entry, under **Also breaking**.

Up to 0.99.6, a program compiled through the SDK could not carry type annotations (see 0.99.7).
The examples for those releases that use annotations compile with the compiler the release ships,
which the SDK exports as `@eco-incorp/sauce/compiler`.

## SDK Unreleased

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.15, so each change here comes from the SDK.

This release removes cross-chain intents from the SDK, the `sauce` command and the MCP server.
Bridging is not an intent and does not change: the `acrossBridge`, `stargateBridge`, `cctpBridge`
and `hyperlaneBridge` actions and the bridge and CCTP protocols in the registry stay.

### SauceScript

- **Removed** (EVM): A program can no longer open a cross-chain intent. `Base(() => { … })`, with
  `.reward({ … })` or `.nest()`, for any chain, no longer compiles, whether its body is token
  writes or a program; the error is the compiler's own.
- **Removed** (EVM): The `EcoRoutes` namespace, with `EcoRoutes.Portal`, `EcoRoutes.HyperProver` and
  `EcoRoutes.PolymerProver`, is no longer a name. The registry has 134 protocols and 313 contracts,
  where it had 135 and 316.
- **Fixed**: In an editor, a family alias on a chain (`Base.Uniswap`, `Ethereum.Aave` and the other
  eleven) is typed by the family's contracts. Its declaration named a type that did not exist, so
  an editor typed nothing on it.

**Also breaking:**

- The root and `routes`: the chain exports (`Base`, `Solana` and the rest) are plain namespaces,
  and calling one, or its `.route`, is removed. `openRoute`, `assembleIntent`, `hashIntent`,
  `routeHash`, `rewardHash`, the intent codecs, every Portal helper (`intentSourceTxs`,
  `publishTx`, `fulfillTx`, `proveTx`, `withdrawTx`, `refundTx`, `cancelTx`,
  `intentFromPublished`, `predictIntentVault`, `approvalTxs` and the rest), the vault helpers,
  `destinationPot`, the nest and dynamic-child helpers and the intent types are removed.
  `routes.compileSauceProgram` no longer takes an `intents` option.
- `SAUCE_INTENT_POT_SALT` is renamed `DEFAULT_POT_SALT`, with no alias. It is every owner's default
  Pot salt, the zero bytes32.
- `@eco-incorp/sauce/svm`: the Portal exports and the intent-route exports (`svmCookRoute`,
  `svmTransferRoute`, `SVM_INTENT_POT_SALT` and the rest) are removed.
- `@eco-incorp/sauce/verify` and `/svm/verify`: `extractEvmSettleFromIntent`, `IntentLike`,
  `extractSvmSettleFromIntent` and `SvmIntentLike` are removed. The settle codecs, the
  `…FromCalls` extractors, the Solana envelope and `verifySvmSettleExecution` stay.
- `@eco-incorp/sauce/recipes`: `buildCctpSplitTransfer`, `buildPlainTransfer`, `cctpSplitSource`,
  `plainTransferSource` and `CctpTransferParams` are removed. The settle recipe stays.
- `@eco-incorp/sauce/protocols/eco-routes` is removed.
- `@eco-incorp/sauce/actions`: `programIntent` and `ProgramIntentOptions` are removed.
- The `sauce` command: `sauce intent` is removed with every verb (`publish`, `fill`, `prove`,
  `claim`, `refund`, `cancel`, `status`, `list`, `show` and `import`), with every `--intent-*`
- `@eco-incorp/sauce/sauce-script`: the `SauceDelivery`, `SauceReward` and `SauceIntent` types are
  removed.
  flag, `--store` (on `run`, `send` and `mcp`) and the intent store under `~/.sauce/intents`.
  `inspect` no longer takes `--args` or `--args-json`, nor reports intents or Portal calls;
  `compile --json` no longer reports `intentPots`; `verify` no longer takes a Portal publish, and
  its result no longer has `callIndex` or `target`. A cook on a preview chain is refused by its own
  chain only.
- The MCP server: the ten `sauce_intent_*` tools, the `sauce_open_intent` prompt, the `intent*`
  inputs, `sauce_compile`'s `rpcUrls`, `sauce_inspect`'s `args` and `sauce_verify`'s Portal input
  are removed. Its tools are `sauce_chains`, `sauce_globals`, `sauce_price`, `sauce_pools`,
  `sauce_compile`, `sauce_actions`, `sauce_tx`, `sauce_pot`, `sauce_reclaim`, `sauce_simulate`,
  `sauce_inspect`, `sauce_verify`, `sauce_send`, `sauce_skills`, `sauce_skill`, `sauce_dev` and
  `sauce_install_skills`, and over stdio `sauce_wallet_enable`, `sauce_wallet_create`,
  `sauce_wallet_import`, `sauce_wallet_list`, `sauce_wallet_address`, `sauce_wallet_send`,
  `sauce_pot_list` and `sauce_pot_import`. Its one prompt is `sauce_write_program`.
- The agent skills: `sauce-intents` is removed, so `sauce skills install` writes 13 skills.

## SDK 0.99.15 — 2026-10-21

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.14, so each change here comes from the SDK.

### SauceScript

#### Solana swaps by venue name

- **Added** (Solana): A program swaps at a venue by its name. `Orca.Whirlpool`, `Raydium.CLMM`,
  `Pancakeswap.CLMM`, `Byreal.CLMM`, `Stabble.CLMM`, `Cropper.Whirlpool`, `Defituna.Fusion`,
  `Crema.CLMM` and `Phoenix.Market` each have
  `swap(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut)`. Compiling adds every account the
  swap needs to `main`, so none is passed by hand. The swap returns 0 having moved nothing when the
  pool cannot trade, and reverts below `minOut`.
- **Added** (Solana): `.pool(tokenA, tokenB, key)` finds a pool by key. Orca and Cropper key by
  tick spacing, with an optional fee-tier index; DefiTuna and Crema by tick spacing; Raydium,
  PancakeSwap, Byreal and Stabble by fee in millionths, with an optional tick spacing. Phoenix and
  Meteora DLMM take the pool as an address. The key must be a number written out, or the variable
  of a loop over numbers written out, and each key's pool gets its own accounts. A key read from a
  `main` argument is refused.
- **Added** (Solana): `Meteora.DLMM.swap(pool, tokenIn, tokenOut, amountIn, minOut)`, an
  exact-input swap with no price limit. `@sauce/router` exports it as
  `meteoraDlmm(slot, trader, amountIn, minOut, recipient)`.
- **Added** (Solana): `@sauce/router`'s
  `<venue>Stopped(slot, trader, amountIn, priceLimit, minOut, recipient, stop)`, for the eight
  concentrated-liquidity venues, stops a swap at a given tick. Where a pool's walk could run past
  the cook's compute budget, the `sauce` command compiles that pool's swap to its `Stopped` form and
  adds a `Uint256` stop parameter to `main`; otherwise the program compiles to the same bytes.
- **Changed** (Solana): `@sauce/router`'s plain venue functions (`raydiumClmm`, `orcaWhirlpool`,
  `gamma` and the rest, and the `…AtLimit` forms) return 0 having moved nothing where the pool
  cannot trade, instead of reverting with "nothing swapped". They still revert below `minOut`.
- **Changed** (Solana): The price argument of `@sauce/router`'s Solana swaps is named `priceLimit`
  instead of `maxPrice`. Calls pass it by position, so they compile unchanged.
- **Changed** (Solana): `phoenixData` takes a match limit, the most resting orders the match may
  touch, before `paysBase`: `phoenixData(amountIn, lot, ticks, orders, paysBase)`. An `orders` of 0
  gives the old bytes. The four-argument call no longer compiles.
- **Removed** (Solana): `@sauce/router`'s `trySwap`, `swap`, every `try<Venue>` function and every
  `try<Venue>AtLimit` function, 67 in all, with no alias. Call the venue's plain function, or
  `<Protocol>.<Program>.swap`.

```js
function main(to: Address, amountIn: Uint256, priceLimit: Uint256, minOut: Uint256): Uint256 {
  const got = Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, minOut);
  if (got > 0) WSOL.transfer(to, got);
  return got;
}
```

#### Solana accounts and tokens written in place

- **Added** (Solana): Token methods work as on an EVM chain, with every account derived and
  checked: `USDC.transfer(to, amount)`, `Token(mint).transfer(to, amount)`,
  `USDC.balanceOf(holder)`. One file can pay in USDC on Base and on Solana. Calling `@sauce/token`
  with the token accounts as `Account` parameters still compiles to the same bytes.
- **Added** (Solana): A program writes the other accounts it uses as expressions where it uses
  them: `Solana.pda(program, [seeds])`, `Solana.account(key)`, `Solana.self`, `Solana.owner`,
  `Solana.systemProgram`, `Solana.tokenProgram`, `Solana.token2022Program`,
  `Solana.associatedTokenProgram`, `Solana.memoProgram`, `USDC.accountOf(holder)`, `USDC.mint` and
  `USDC.tokenProgram`. `.writable()` and `.signer()` give an account its role. Compiling adds each
  one to `main`, and the program checks it when it starts, refusing a wrong one ("wrong account",
  "wrong program-derived address", "wrong holder account"). Every holder and seed must be known
  when the cook is built.

```js
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

#### Balances and chained calls

- **Added** (both): `<holder>.<TOKEN>` reads a balance for more holders: the native coin
  (`self.ETH`, `who.ETH`), `ctx.self().USDC`, a registry contract (`UniswapV4.PoolManager.WETH`), a
  bound contract (`UniswapV3.Pool(pool).USDC`), and on Solana `self.USDC`, `who.USDC`,
  `Solana.self.USDC` and `self.SOL`. On EVM chains each compiles to the same bytes as the long form.
  `self.USDC` and `<address>.<TOKEN>` on EVM chains are not new. A name the chain does not register
  is refused with a suggestion.
- **Added** (EVM): A registry function that returns a contract's address can be called on
  directly, and so can a `const` holding it. Token writes made this way are still `SafeERC20`.

```js
function main(vault: Address, to: Address, amount: Uint256): Uint256 {
  Erc4626.Vault(vault).asset().transfer(to, amount);
  return UniswapV3.Factory.getPool(USDC, WETH, 500).liquidity() + self.ETH + ctx.self().USDC;
}
```

#### Intents to and from Solana

- **Added** (EVM): A program on an EVM chain can open an intent whose body runs on Solana, as
  `Solana(() => { … }).reward({ … })`, with a body of token writes or a program. Every value the
  Solana body reads must be known when the intent is built: a number, a 32-byte key or a top-level
  constant written out, or one of `main`'s arguments bound when the file is published. A run-time
  value is refused. A Solana key for an `Address` argument may be given in base58.
- **Changed** (Solana): A program compiled for Solana still cannot open an intent. The error now
  says to publish the file from a wallet instead, with `sauce intent publish <file> --chain solana`.

```js
function main(recipient: Address, amount: Uint256) {
  Solana(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
```

It compiles when `recipient` and `amount` are bound with `--args` as the file is published.

#### MetaDAO on Solana

- **Fixed** (Solana): MetaDAO's futarchy pools are found and traded again after MetaDAO's program
  upgrade of 2026-10-20, which grew every Dao account from 1205 to 1264 bytes. The SDK refused every
  upgraded account, so those pools dropped out of Solana routing; quotes were never wrong and no
  swap reverted. A Dao shorter than the new layout is refused, and a longer one is accepted.

**Also breaking:** The package's Solana dependencies move to Solana Kit 8: `@solana/kit` ^8.5, with
`@solana-program/token` ^0.17, `system` ^0.15, `compute-budget` ^0.19 and `address-lookup-table`
^0.15. A project that installs the package beside Kit 6 and its program clients must move to Kit 8
with it. The SDK keeps Solana's 1232-byte transaction size limit itself, still exported from
`@eco-incorp/sauce/svm` as `TRANSACTION_SIZE_LIMIT`, because Kit 8 no longer exports it.

## SDK 0.99.14 — 2026-10-11

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.13.

### SauceScript

No language change.

## SDK 0.99.13 — 2026-10-09

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.12.

### SauceScript

No language change.

## SDK 0.99.12 — 2026-10-08

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.11.

### SauceScript

- **Added** (Solana): `@sauce/router` grows from 20 functions to 280, and no existing signature
  changes. Each price-limit venue gains an at-limit form, `try<Venue>AtLimit` and
  `<venue>AtLimit`, which trades to the pool's own limit, and Invariant and OpenBook v2 join those
  venues. Exact-input swaps, `(slot, trader, amountIn, minOut, recipient)` in a `try` and a plain
  form, cover about 45 more venues, Manifest and Gamma among them. `<venue>Cpi` sends the
  instruction alone and `<venue>Data` returns its bytes, for about 75 venues.
- **Changed** (Solana): A swap at a price writes its own instruction data, so the same program
  compiles about 64 bytes smaller.
- **Fixed** (Solana): A Crema pool with fewer than three tick arrays swaps instead of failing.

**Also breaking:** The WOOFi Solana venue module no longer exports `OFF_POOL_RESERVE`.

## SDK 0.99.11 — 2026-10-07

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.10.

### SauceScript

- **Added** (Solana): `@sauce/router` can be imported in a Solana program. Nine price-limit venues
  each have a `try` form and a plain form: `raydiumClmm`, `pancakeswapClmm`, `byreal`,
  `stabbleClmm`, `orcaWhirlpool`, `cropper`, `defituna`, `crema` and `phoenix` (`tryRaydiumClmm`
  and so on). `trySwap` and `swap` take a pool at any of them and find the venue from the pool's
  program. Each takes `(slot, trader, amountIn, maxPrice, minOut, recipient)` and returns what the
  recipient received. A `try` form returns 0 when it skips; the plain form reverts with "nothing
  swapped". `slot` and `trader` are arrays the program builds from its `Account` parameters,
  because `main` cannot take an array of accounts.

## SDK 0.99.10 — 2026-10-07

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.9.

### SauceScript

- **Added** (EVM): `@sauce/router` has a `try` form for every EVM venue: `tryUniswapV3`,
  `tryUniswapV4`, `tryMaverickV2`, `tryDodoV2` and `tryWoofi` join the four that existed. It adds
  PancakeSwap Infinity pools as `infinityCL`, `tryInfinityCL`, `infinityBin` and `tryInfinityBin`.
  A `try` form returns 0 having moved nothing, or at least 1 when the swap ran, and a swap that
  takes input and delivers nothing reverts. With no `sqrtPriceLimitX96`, a `try` form walks an
  empty pool fully, about 10M gas, before it skips it.

```js
import { tryUniswapV3, infinityCL } from "@sauce/router";

function main(pool: Address, vault: Address, manager: Address, amountIn: Uint256, recipient: Address): Uint256 {
  const got = tryUniswapV3(pool, USDC, WETH, amountIn, 0, 1, recipient);
  if (got > 0) return got;
  return infinityCL(vault, USDC, WETH, amountIn, manager, 500, 0, 0, 0, 1, recipient);
}
```

**Also breaking:** `sauce simulate` exits 1 when the simulated cook reverts, and MCP
`sauce_simulate` returns the revert as an error.

## SDK 0.99.9 — 2026-10-07

Compiler 2.5.0, v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. New since
0.99.8: compiler 2.5.0, v12-evm 1.2.0 and kitchen-evm 1.2.0.

### SauceScript

- **Added** (EVM): Block and transaction reads: `ctx.txOrigin()`, `ctx.coinbase()`,
  `ctx.prevrandao()`, `ctx.blockGasLimit()`, `ctx.baseFee()`, `ctx.gasPrice()`, `ctx.blockHash(n)`
  and `ctx.blobHash(i)`. Each is a compile error in a Solana program.
- **Added** (EVM): `ctx.blobBaseFee()`, the block's blob base fee. On a chain that does not
  implement that read, such as Arbitrum or Polygon, the cook halts, and the SDK still compiles it
  for those chains.
- **Added** (EVM): Contract creation from the Pot: `evm.create(initcode, value?)`,
  `evm.create2(initcode, salt, value?)` and `evm.create3(initcode, salt, value?)`, each returning
  the new address, and the predictions `evm.createAddress(deployer, nonce)`,
  `evm.create2Address(deployer, salt, initCodeHash)` and `evm.create3Address(salt)`. A failed
  `evm.create` or `evm.create2` returns address 0 and the program goes on; a failed `evm.create3`
  reverts.
- **Added** (EVM): `USDT0` is a token name on the 10 chains of Tether's USDT0 list: Optimism,
  Unichain, Polygon, Monad, Sei, Mantle, Plasma, Arbitrum One, Ink and Berachain.
- **Added** (EVM): An intent file published from a wallet can use `main`'s arguments in the intents
  it opens. The values given when it is published are bound in, so `main` then takes none. Each
  bound argument is one word: `Uint256`, `Address` or `bool`.
- **Changed** (both): Compile errors are worded in SauceScript's terms. An unsupported construct "is
  not supported in SauceScript"; a call to something that is not a function gets "this call does
  not name a function, builtin, or contract method in scope"; a function that keeps too many values
  in use at once is told to split into smaller functions. Anything that matches on message text
  needs updating.
- **Fixed** (EVM): A plain integer above 2^53 in an intent's reward, such as
  `amount: 1000000000000000001`, is read exactly. Before, only the `1000000000000000001n` spelling
  compiled there.

```js
function main(initcode: bytes, salt: Uint256): Address {
  require(ctx.txOrigin() != ctx.coinbase(), "same");
  const deployed = evm.create2(initcode, salt, 0);
  require(evm.create2Address(ctx.self(), salt, crypto.keccak256(initcode)) == deployed, "create2");
  return evm.create3(initcode, salt);
}
```

### Compiler and engines

- **Compiler 2.4.0 → 2.5.0:** Pairs with v12-evm 1.2.0 and kitchen-evm 1.2.0; v12-svm 1.3.0 and
  kitchen-svm 1.0.0 are unchanged. A direct caller of the compiler gets the `chain` and
  `chainProfiles` options: a chain's profile can mark a builtin `"unsupported"`, which makes a use
  of it a compile error naming the chain, or give a read that takes no arguments a constant to fold
  into the program. The SDK and the `sauce` command pass no profile, so their programs compile as
  before. Errors thrown by `compile` carry a `diagnostics` array that places each problem in its
  module, so a tool no longer parses the message text; an error with no source location, such as a
  builtin refused on Solana, carries an empty array. The reworded compile messages are listed under
  SauceScript.
- **v12-evm 1.1.0 → 1.2.0:** Pairs with compiler 2.5.0. The Pot's code changed, so every new Pot has
  a new address, and this engine refuses Pots made for earlier engines. Existing Pots keep cooking
  on the engine they were made for; a Pot names its engine on every cook, and nothing migrates. This
  shipped as a minor release under a documented exception. `eval` runs as the calling Pot,
  read-only, instead of as the engine, so `ctx.self()`, storage and balance reads inside it see the
  Pot, and nested `eval` works again; the engine no longer runs a program at its own address.
  `ctx.blobBaseFee()` returns each network's real blob base fee; earlier engines returned a constant
  on every chain.
- **kitchen-evm 1.1.0 → 1.2.0:** Pairs with v12-evm 1.2.0. Every new Pot has a new address, so
  derive Pot addresses with the SDK. `Kitchen.deploySharedPot(salt)` makes a Pot with no owner and a
  fixed Router, which anyone may cook on, and the Kitchen's fee still applies;
  `deployPot(owner, salt, true)` makes a Private Pot with a fixed Router; matching `predict…`
  functions give each address. The Router moves to generation 4, with one exact-input method for
  each venue family that calls back in the middle of a swap (`swapV3`, `swapV4`, `swapMaverickV2`,
  `swapInfinityCL` and `swapInfinityBin`), each returning `(amountInUsed, amountOut)`, and
  `flash(callback, swap)` runs a program inside a venue's callback. Only a Pot may call them. This
  Router is about a third the size and uses roughly 4k to 15k less gas per swap leg.
  `Kitchen.setRouter` installs it for new Pots, existing Pot owners opt in with `Pot.setRouter`, and
  generation 3 stays deployed. The unified `swap`, exact-output mode, `swapMaverickV2Bounded`, every
  quote method and the wrappers for venues that are paid first (Uniswap V2, Curve, Balancer V2, DODO
  V2, Trader Joe LB and WOOFi) are gone from it: a program calls those venues directly, and
  `@sauce/router` in this release does. Because the 1.2.0 Router has no quote method, the SDK also
  pins kitchen-evm 1.1.0's Router, for Uniswap V3 and V4 quotes only.

**Also breaking:** Pot addresses change with kitchen-evm 1.2.0; existing Pots keep their engine.

## SDK 0.99.8 — 2026-10-02

Compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.7.

### SauceScript

- **Added** (Solana): 1,799 tokenized stocks and ETFs are names, each standing for its mint: xStocks
  such as `TSLAx`, Ondo's such as `TSLAon`, Backpack's such as `NVDA_US`, and PreStocks'. They are
  Token-2022 mints, moved with `transferChecked` and `approveChecked`. PreStocks' mints charge a
  transfer fee, so measure what arrives.

```js
function main(tokenProgram: Account, from: Account<Writable>, mint: Account, to: Account<Writable>, owner: Account<Signer>, amount: Uint256): void {
  transferChecked(TSLAx, tokenProgram, from, mint, to, owner, amount, 8);
}
```

## SDK 0.99.7 — 2026-10-02

Compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.6.

### SauceScript

- **Added** (both): A program compiled through the SDK can carry type annotations: typed `main`
  parameters, which are the program's run-time arguments, return types, typed helper functions,
  `interface` declarations, and on Solana `Account` parameters. Before, any annotation was a parse
  error there, so such a program took no `main` arguments.
- **Added** (EVM): Every protocol in the registry is a namespace, 135 of them, plus family names
  such as `Balancer`, `Curve`, `Euler`, `Gmx` and `Yearn`: `Balancer.Vault`, `Curve.RouterNG`,
  `UniswapV4.StateView`.
- **Added** (EVM): An interface with no fixed address is called on an address you give, as
  `UniswapV3.Pool(pool).slot0()` or `UniswapV3.Pool.at(pool).slot0()`. The registry's AMMs have pool
  and pair interfaces, and `Erc4626.Vault(vault)` binds a vault.
- **Added** (EVM): `available(<name>)` tests at compile time whether the chain has a contract or
  token, so a branch can depend on the chain. A name no chain has is an error.
- **Added** (EVM): `@sauce/router`, a swap library with one function per venue: `uniswapV2`,
  `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, `dodoV2`, `traderJoeLB`, `woofi` and
  `maverickV2`, and `try` forms for Uniswap V2, Curve, Balancer V2 and Trader Joe LB. Each takes
  `(pool, tokenIn, tokenOut, amountIn, …venue details, minOut, recipient)` and returns the amount
  received. It is imported, and it is EVM only.
- **Added** (EVM): `@sauce/token`'s `permit(...)`, EIP-2612, checked by the owner's nonce moving by
  one, and `permitTransferFrom(...)`, through Permit2, pull tokens in on a signature.
- **Added** (EVM): Tokenized stocks and ETFs are token names with the same methods as `USDC`: 1,731
  on Ethereum, such as `TSLAx`, `TSLAon` and `bTSLA`, and 67 on Base, such as `TSLAc`.
- **Added** (Solana): `USDC`, `USDT`, `PYUSD` and `WSOL` are names, each standing for the mint's
  32-byte key.
- **Added** (Solana): `@sauce/token`'s reads accept Token-2022 accounts, and `ownerOf`,
  `transferChecked` and `approveChecked` are added. The checked writes take either token program
  and refuse a mint whose transfer hook names a program. The older writes revert with a reason, such
  as "wrong mint".
- **Changed** (EVM): Some protocol names change. `CompoundV3.CometUSDC`, `CometWETH` and `CometUSDT`
  (and the same under `Compound.`) become `CUSDCv3`, `CWETHv3` and `CUSDTv3`, and the address names
  `CompoundV3_CometUSDC` and so on become `CompoundV3_CUSDCv3` and so on. `Pancakeswap.Factory` is
  ambiguous now: write `PancakeswapV2.Factory` or `PancakeswapV3.Factory`. `Erc4626.ERC4626Vault`,
  which could not be called, becomes `Erc4626.Vault`.
- **Changed** (EVM): An intent a program opens funds its reward by moving it into the intent's
  vault and then publishing, instead of approving the Portal and publishing and funding in one call.
- **Changed** (EVM): As an intent destination, `Monad(() => …)` now compiles and `Sonic(() => …)` is
  refused.
- **Changed** (EVM): A token or protocol name the chain does not have is refused with an error that
  names the chain and suggests the nearest name.
- **Now refused** (EVM): On Arc, a reward that offers both native value and USDC, because USDC is
  Arc's native coin and the Portal would reject the reward.
- **Removed** (both): Source that returns at top level is no longer wrapped in `main`. Declare
  `function main(): Uint256 { … }` instead.
- **Fixed** (EVM): Names inside an intent a program opens resolve on the right chain: the body and
  its delivery on the destination, the reward on the chain the program runs on. Earlier releases
  could use one chain's token addresses throughout. Intent hashes change.
- **Fixed** (EVM): An intent whose values are all known when the program compiles, with no captured
  local, compiles. An intent body can call the file's own functions and use its imports.
- **Fixed** (EVM): An argument in a token-only intent body can be arithmetic, which makes the body
  compile as a program, or a plain integer above 2^53, which is now read exactly.

```js
import { uniswapV3 } from "@sauce/router";
function main(pool: Address, amountIn: Uint256, minOut: Uint256): Uint256 {
  return uniswapV3(pool, USDC, WETH, amountIn, 0, minOut, ctx.self());
}
```

```js
function main(tokenA: Address, tokenB: Address): Uint256 {
  if (available(UniswapV3.Factory)) {
    const pool = UniswapV3.Factory.getPool(tokenA, tokenB, 500);
    const [sqrtPriceX96] = UniswapV3.Pool(pool).slot0();
    return sqrtPriceX96;
  }
  return 0;
}
```

**Also breaking:** The `sauce` command and the MCP server build and send transactions only on
Ethereum, Base and Solana. The `sauce-dev-tools` bin is removed; the `sauce-run` skill is renamed
`sauce-cli`; intent commands move under `sauce intent <verb>`.
Solana token rows need `tokenProgram`. The `swap` namespace, `swapThenDepositSource` and several
swap action kinds are removed. The per-chain helpers leave `@eco-incorp/sauce/deployments`. Intents
target eco-routes' Portal 2.12.

## SDK 0.99.6 — 2026-09-30

Compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. Same compiler
and engines as 0.99.5.

### SauceScript

- **Added** (EVM): `USDC.transferFrom(from, to, amount)` is a token shorthand, with the same
  `SafeERC20` behaviour as the other writes.
- **Changed** (EVM): The token shorthand writes, `USDC.transfer`, `USDC.approve` and
  `Token(addr).transfer`, `.approve` and `.transferFrom`, go through `@sauce/token`'s `SafeERC20`
  writes. Tokens that return nothing, such as USDT, work, and a `false` return reverts. Programs
  built from them get new hashes. An explicit `IERC20.at(token).transfer(...)` stays the raw call.
- **Changed** (EVM): A use of `Token(addr)` other than as the receiver of a method call, or through
  one `const t = Token(addr)` only ever called as `t.method(...)`, is refused with an error that
  lists the forms that work. Such uses were already refused, by a less helpful error; reads such as
  `Token(x).balanceOf(w)` still compile.
- **Changed** (EVM): In an intent body made only of token writes, each `approve` first sets the
  allowance to zero and then to the amount. These calls run as plain route calls, without
  `SafeERC20`'s checks.
- **Now refused** (EVM): Using a token write's result, as in `const ok = USDC.transfer(to, amount)`.
  A write returns nothing.
- **Now refused** (EVM): A program that uses the token shorthand cannot declare a function named
  `__sauce_transfer`, `__sauce_approve` or `__sauce_transferFrom`. Its own `transfer` still works.

```js
function main() {
  USDC.transferFrom(ctx.msgSender(), ctx.self(), 1000000);
}
```

**Also breaking:** Callers of `rewriteTokenMembers` must prepend `tokenImportLines(result)`. The
`crvusd` and `frax` templates' `transfer` and `approve` return `1`.

## SDK 0.99.5 — 2026-09-30

Compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0. New since
0.99.4: compiler 2.4.0, v12-evm 1.1.0, kitchen-evm 1.1.0 and v12-svm 1.3.0.

### SauceScript

- **Added** (EVM): A program can open a cross-chain intent itself, with
  `Chain(() => { … }).reward({ tokens: [...] })`, and use its own locals in it. A body made only of
  token transfers and approves becomes route calls. Any other body is compiled for the destination
  and run there, given a delivery argument and an execution fee. Intents can nest.
- **Added** (EVM): Programs compile for Arc, where `USDC`, `EURC`, `USYC`, `WETH` and Arc's protocol
  contracts are names, and `Arc(() => …)` is an intent destination.
- **Changed** (both): Compiler 2.4.0 accepts and refuses the same programs as 2.3.0, but its output
  runs only on the engines this release pairs with, and the reverse. Recompile every program.
- **Changed** (EVM): `@sauce/token`'s `transfer`, `transferFrom` and `approve` behave like
  OpenZeppelin's `SafeERC20`. A token that returns nothing is accepted only if it has code, any
  return value must be `true`, and `approve` resets a non-zero allowance first. Before, each write
  decoded the `bool`, which reverted on tokens that return nothing and accepted `false`.
- **Changed** (EVM): Encoding a tuple of more than 255 fields is still refused, and the error now
  says the limit is the engine's and points at the source.
- **Fixed** (EVM): A plain number among a contract call's arguments, or in a multi-value
  `abi.encode`, is no longer at risk of being taken for an internal pointer. For some values that
  gave the callee a wrong argument or ran the cook out of gas.
- **Fixed** (EVM): Protocol calls take the arguments the deployed contracts take.
  `UniswapV3.SwapRouter02.exactInputSingle(...)` and its siblings compile with the deployed struct,
  which has no `deadline`; `UniswapV4.UniversalRouter.execute(commands, inputs)` needs no deadline;
  `Cctp.TokenMessenger.depositForBurn(...)` no longer decodes a return value the contract does not
  send, which made every call revert; 1inch `unoswap`'s fourth argument is a single word.

```js
function main() {
  const to = ctx.msgSender();
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(to, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
```

The intent's deadline and creator come from the compile options.

### Compiler and engines

- **Compiler 2.3.0 → 2.4.0:** Pairs with v12-evm 1.1.0, kitchen-evm 1.1.0 and v12-svm 1.3.0; the
  first Changed item above says what that means for your programs. On an older Solana engine, 2.4.0
  output fails loudly at the first spilled stack slot. The instruction-set label does not change, so
  pair by exact version. EVM `abi.encode` and external-call arguments are compiled with a type list
  from the compiler, so nested tuples that mix scalars and pointers work at any depth. The run-time
  nesting limit of `abi.encode` is 146 levels, down from 204, and the compiler does not check it.
  Solana output is smaller and cheaper to run.
- **v12-evm 1.0.1 → 1.1.0:** Pairs with compiler 2.4.0. `abi.encode` and call arguments are read
  from the compiler's type list, so a compiler and an engine from different releases disagree about
  them. A plain number inside a tuple is no longer mistaken for a pointer, which is the Fixed (EVM)
  item above. The Pot and Router changes that came with this engine are under kitchen-evm 1.1.0.
- **kitchen-evm 1.0.0 → 1.1.0:** Pairs with compiler 2.4.0 and v12-evm 1.1.0. Every Pot made after
  the upgrade has a new address, for two reasons: a Pot is created with no constructor arguments,
  and the Router moves to generation 3 while the Kitchen stays at generation 2. Both shipped as a
  minor release under a documented exception to the major-version rule. Existing Pots keep their
  address, Router and engine; use an engine built for the new Pots. A Router upgrade no longer moves
  Pot addresses: it is a new Router generation plus `Kitchen.setRouter(address)`, which is
  owner-only and refuses an address with no code, and `Pot.setRouter(address)` moves one Pot to
  another Router. The Router accepts Synthra V3 and UnitFlow V3 callbacks, bounded Maverick V2 swaps
  take a tick limit, and swap callbacks are single-use and cannot be paid more than the swap's exact
  input.
- **v12-svm 1.2.0 → 1.3.0:** Pairs with compiler 2.4.0. Compiler output and engine must match: older
  compiler output fails with `InvalidOpcode` on this engine, and 2.4.0 output fails with
  `ExpectedDescriptor` on older engines. The 1.2.x engine keeps running older programs. The stack
  holds 1,056 words instead of 1,024. Every stack slot is an untyped 32-byte word, so compute falls
  by 1.4% to 41% across the measured workloads and the program binary is 27.7% smaller. A program
  the compiler produces is unaffected by the new return rule; hand-written Solana bytecode that ends
  on a bare number fails with `InvalidDescriptor`, so box any number you return. Some scalars read
  from a tuple, a compact argument or an object-literal field were misread, which changed
  arithmetic, comparisons, hashes and call arguments; the engine fixes that, and programs compile to
  the same bytes. Concatenation can no longer copy bytes from beyond the heap's allocation.

**Also breaking:** Pot addresses change with kitchen-evm 1.1.0. No RPC endpoints ship
(`Chain.rpcUrls` is removed), and the SDK reads no environment variables. Chain accessors are named
imports, not globals; `baseDirs` and the earlier actions entry points are removed. The Solana
artifact helpers move to `@eco-incorp/sauce/svm/engine-artifacts`. The settle program grows from 356
to 435 bytes, with a new hash.

## SDK 0.99.4 — 2026-09-25

Compiler 2.3.0, v12-evm 1.0.1, kitchen-evm 1.0.0, v12-svm 1.2.0 and kitchen-svm 1.0.0. New since
0.99.3: v12-svm 1.2.0.

### SauceScript

No language change.

### Compiler and engines

- **v12-svm 1.1.0 → 1.2.0:** Adds `cookAndPayFromAccountPinned`, a direct staged cook that checks
  the SHA-256 of the whole code account, runtime arguments included, against an expected hash before
  it charges the fee or runs. A mismatch fails with `CodeHashMismatch`. The unpinned direct staged
  cook from 1.1.0 is unchanged: to get the content check, choose the pinned one and pass the hash on
  every cook.

## SDK 0.99.3 — 2026-09-25

Compiler 2.3.0, v12-evm 1.0.1, kitchen-evm 1.0.0, v12-svm 1.1.0 and kitchen-svm 1.0.0. New since
0.99.2: v12-svm 1.1.0.

### SauceScript

No language change.

### Compiler and engines

- **v12-svm 1.0.1 → 1.1.0:** Adds direct paid cooks that skip the Kitchen's call frame, so a caller,
  the engine, a bridge, a venue and a token fit Solana's five-frame limit: `cook_and_pay` for inline
  bytecode and `cook_and_pay_from_account` for staged code. Each takes `max_execution_fee`, refuses
  a higher configured fee before it pays, and grants no Pot signature. Their fees use the Kitchen's
  fee configuration and withdrawal. A direct paid inline cook uses about 12,700 to 14,100 fewer
  compute units than a paid Kitchen cook, and every cook derives the Pot once, saving about 1,800
  compute units.

## SDK 0.99.2 — 2026-09-24

Compiler 2.3.0, v12-evm 1.0.1, kitchen-evm 1.0.0, v12-svm 1.0.1 and kitchen-svm 1.0.0. New since
0.99.1: compiler 2.3.0, v12-evm 1.0.1 and v12-svm 1.0.1.

### SauceScript

- **Added** (EVM): A contract call that returns one value can keep its result and fall back to a
  constant when it fails, in a `const`, an assignment or a `return`. The fallback must be a constant
  that fits the declared result type. A raw `evm.call`, which returns bytes, cannot use it.
- **Added** (Solana): `acct.dataLen` reads an attached account's data length in bytes. It is
  read-only, and a compile error on EVM.
- **Changed** (both): Recompiling gives different, usually smaller bytecode, so a program's hash
  changes. What the program does is unchanged.
- **Changed** (EVM): According to the compiler's release notes, a raw `Uint256[]` return holds its
  values as contiguous 32-byte words instead of boxed ones, so an off-chain decoder of such a return
  must read it that way. Programs built by an earlier compiler keep the old shape until recompiled.
- **Changed** (Solana): `@sauce/token`'s `totalSupply(mint)` and `decimals(mint)` require an
  initialized SPL Token mint of 82 bytes. A token account or an uninitialized account passed as the
  mint reverts instead of returning a number read from the wrong bytes.
- **Now refused** (EVM): An `async` or generator function as a `.catch()` handler. A plain
  `() => { }` or `function () { }` handler is still accepted.
- **Fixed** (EVM): `abi.encode` of an array of numbers could mis-encode an element, without
  reverting. Recompile programs built by an earlier compiler.

Here `quoter.abi.json` is an ABI that declares `quote(uint256) returns (uint256)`:

```js
import Quoter from "./quoter.abi.json";
function main(q: Address, amountIn: Uint256): Uint256 {
  const out = Quoter.at(q).quote(amountIn).catch(() => {
    return 0;
  });
  return out;
}
```

```js
function main(mint: Account): Uint256 {
  require(mint.dataLen == 82);
  return mint.dataLen;
}
```

### Compiler and engines

- **Compiler 2.2.1 → 2.3.0:** Pairs with v12-evm 1.0.1, kitchen-evm 1.0.0 and v12-svm 1.0.1;
  `acct.dataLen` needs v12-svm 1.0.1 or later. Output is smaller and cheaper to run: small scalar
  helpers are inlined when that pays, repeated expressions and tuple reads are computed once,
  `x + 0` and `x * 1` fold to `x`, and EVM scalar array literals are packed. Inlining alone cut
  about 24% of EVM gas and 33% of Solana compute units on an arithmetic benchmark. The `abi.encode`
  fix listed under SauceScript concerns EVM programs compiled by compilers 0.3.0 through 2.2.1, so
  recompile those; Solana is not affected.
- **v12-evm 1.0.0 → 1.0.1:** The engine is cheaper to run: about 5.8% less gas on a recursive
  benchmark. The scalar-array fix released beside it is a compiler fix, not an engine one: upgrade
  the compiler.
- **v12-svm 1.0.0 → 1.0.1:** Adds `acct.dataLen`, an account's data length, which `@sauce/token`
  uses to check an SPL mint before it reads supply or decimals; compiler output that uses it needs
  this engine. Stack operations are much cheaper: total compute fell 22% to 25% on the measured swap
  programs.

**Also breaking:** The package needs Node.js 24 or newer. `IntentOptions` needs `execution`, or both
`pot` and `engine`. The settle program shrinks from 362 to 356 bytes, with a new hash.

## SDK 0.99.1 — 2026-09-17

Compiler 2.2.1, v12-evm 1.0.0, kitchen-evm 1.0.0, v12-svm 1.0.0 and kitchen-svm 1.0.0. New since
0.99.0: compiler 2.2.1 and the 1.0.0 releases of v12-evm, kitchen-evm, v12-svm and kitchen-svm.

### SauceScript

- **Now refused** (EVM): Calling a contract function whose ABI has a fixed-size array parameter of
  256 or more elements, such as `uint256[256]`, whatever is passed. Compiler 2.2.0 encoded the
  argument as a different ABI type than the callee expects. Declaring such a function in an
  imported ABI without calling it still compiles.
- **Fixed** (EVM): An object literal passed for a fixed-size array parameter (`T[N]`) of a contract
  call has every field type-checked, not only the first. A wrong type at a later position used to
  compile to the wrong layout; now it is a compile error. A wrong element count was already refused.

### Compiler and engines

- **Compiler 2.2.0 → 2.2.1:** Pairs with the 1.0.0 engines and Kitchens, which run what 2.2.0 output
  ran: no engine or API change. The two fixes are listed under SauceScript.
- **v12-evm 0.8.0 → 1.0.0:** Declares the instruction set stable. Runtime behaviour is the same as
  0.8.0, so nothing needs to change. `crypto.findPDA` seeds are bounds-checked on the EVM; compiler
  output was never affected. From here, an incompatible change to what an instruction does needs a
  major version.
- **kitchen-evm 0.5.0 → 1.0.0:** Declares the ABIs and the derivation of their addresses stable,
  with no ABI, address or behaviour change: Pot addresses are the same as in 0.99.0. From here a
  breaking ABI change needs a major version, unless the release notes state an exception.
- **v12-svm 0.8.0 → 1.0.0:** Declares the wire contract stable: the instruction encoding, the
  account order a caller attaches and the instruction semantics change only in a major version.
  Runtime behaviour is unchanged. Program ids derived per version are not part of the promise.
- **kitchen-svm 0.4.0 → 1.0.0:** Declares the Anchor IDL stable: instruction names and arguments,
  account lists and roles, and the seeds a client derives addresses from change only in a major
  version. Runtime behaviour is unchanged. The program id is fixed and upgraded in place, so it is
  not a version promise.

## SDK 0.99.0 — 2026-09-17

Compiler 2.2.0, v12-evm 0.8.0, kitchen-evm 0.5.0, v12-svm 0.8.0 and kitchen-svm 0.4.0.

### SauceScript

The first release of `@eco-incorp/sauce`. The language at this release:

- **Types:** `Uint256` (also `number` and `bigint`) and `Address` are one unsigned 256-bit
  integer; `bool` is kept apart from numbers; `bytes` and `string` are byte strings; `T[]` is an
  array; a record is `{ a: T }` or a top-level `interface`. An unannotated parameter is a number.
  `as`, unions, `Array<T>` and `T[N]` are refused.
- **Literals:** integers exact to 256 bits (`1n` is the same integer), `0x` hex, `_` separators,
  `hex` tagged byte strings, arrays and records. Decimals, `null` and template literals are refused.
- **Operators:** checked `+ - * / % **`, bitwise operators, unsigned comparisons, `==` and `!=`
  (and `===`, `!==`), `! && ||` and `?:`. Compound assignment works on plain variables, and
  `++` and `--` as statements. `>>>`, `??=`, `++` as a value and `a[i] += v` are refused. A
  constant that overflows is a compile error.
- **Control flow:** `if`/`else`, `while`, C-style `for`, `for…of` over an array, unlabelled
  `break` and `continue`, and `return`. `switch`, `try`/`catch`, labels, classes, optional
  chaining, nested functions and arrow functions outside `.catch()` are refused.
- **Functions:** top-level declarations, recursion allowed; a function not declared `: void` returns
  on every path. A file with no `main` is a script. Destructuring takes tuple values apart.
- **Modules and imports:** named imports of SauceScript modules; `import X from "./x.abi.json"`
  binds a contract ABI; `with { type: "json" }` reads JSON as constants. A top-level `const` is a
  compile-time constant, a `const` array a table read at a literal index, and a `let` scratch
  space for one run.
- **Builtins:** `require`, `revert`, `throw`, `log` and `eval`; `ctx.msgSender()`, `ctx.self()`,
  `ctx.chainId()`, `ctx.blockNumber()`, `ctx.timestamp()`, `ctx.selfBalance()`, `ctx.msgData()`
  and `ctx.balance(addr)`; `crypto.keccak256`, `crypto.ecdsaVerify` and `crypto.findPDA`;
  `Math.sqrt`, `Math.mulDiv` and modular and signed helpers; `.slice`, `.concat`, `.length`,
  `.toBytesBe(w)` and `.toBytesLe(w)`. `main` takes run-time arguments, ABI-encoded or compact.
- **EVM only:** `ctx.msgValue()`, `ctx.gasLeft()` and the code checks on an address; `abi.encode`
  and `abi.decode`; `evm.call`, `evm.static`, `evm.delegate` and storage, transient included;
  `log` with topics; contract bindings, `Abi.at(addr).method(...)`; `.catch(() => { … })` as a
  statement after a call. There is no contract creation.
- **Solana only:** `main`'s `Account` parameters, with `Writable` and `Signer` roles, are the
  program's accounts in order; `svm.sload`, `svm.sstore`, `svm.call` and the remaining accounts;
  `account.address`, `account.owner` and `==` on accounts.
- **What the SDK adds:** a program is a source string or a closure's text, wrapped in `main` when it
  has none. Type annotations are a parse error there, so such a program takes no `main` arguments.
  On EVM chains `USDC.transfer`, `USDC.approve`, `USDC.balanceOf` and `Token(addr).method(...)`
  are raw ERC-20 calls that decode the `bool`, not `SafeERC20`; `self.USDC` reads a balance and a
  bare `self` is `ctx.self()`. The names are 21 protocol namespaces (16 protocols, 5 family names)
  and `USDC`, `USDT`, `WETH`, `WPOL` and `WMON` on six chains, none on Solana. A program cannot
  open an intent, and on Solana the token shorthand is refused.

The [SauceScript reference](reference/saucescript.md) describes the language as it is today.

### Compiler and engines

- **Compiler 2.2.0:** Compiles for EVM and Solana. The `compactArgs` option, off by default, encodes
  entry arguments in the compact encoding instead of the ABI; `CompileResult` carries `isaRevision`,
  `entryEncoding` and, with `compactArgs`, `entrySchema`, and arguments are encoded with that
  schema. Its array and tuple element writes take three operands, so its output runs only on the
  engines released with it, v12-evm 0.8.0 and v12-svm 0.8.0. Pair by exact version.
- **v12-evm 0.8.0:** The engine runs only when called from a Pot the Kitchen made, so call programs
  through the Kitchen and your Pot, never the engine directly. Element and field writes are checked
  before they write, and execution costs less. It decodes compact entry arguments. Nested `eval` is
  not supported in this release; one level works.
- **kitchen-evm 0.5.0:** Every cook, whichever engine it names, pays the Kitchen's flat fee: `cook`
  reverts unless it sends at least `Kitchen.executionFee()`, so read the fee before each cook. Every
  Pot shares one creation code and reads its owner and salt from the Kitchen. Derive Pot addresses
  with the SDK.
- **v12-svm 0.8.0:** The engine runs only for a Pot that a Kitchen `cook` signs, and a direct call
  to it is rejected. Every `cook` and `cook_from_account` pays the Kitchen's flat fee and must carry
  `max_execution_fee`. Element writes are checked, and compact entry arguments decode.
- **kitchen-svm 0.4.0:** A Kitchen cannot cook until its fee is set with `initialize_execution_fee`,
  and every client passes the fee configuration and `max_execution_fee`. The fee is a flat amount of
  lamports, collected before the engine runs and rolled back if the engine run fails; a raised fee
  rejects a stale quote. A Kitchen without an upgrade authority has a frozen fee and fees nobody can
  collect. The Kitchen signs the Pot it cooks for, and the engine checks it. Cooks in one Kitchen
  run one after another.

**Also breaking**, for a project moving from `@eco-incorp/sauce-sdk` (see
[Before 0.99](#before-099)): `createSauceSvmClient` needs a `kitchen` address, and `maxExecutionFee`
where the Kitchen charges a fee. `buildCookInstruction` and `buildCookFromAccountInstruction` need
`pot`, `feeConfig` and `maxExecutionFee`. The settle program changes from 363 to 362 bytes, with a
new hash.

## Before 0.99

The compiler, the engines and the Kitchens each had releases before the first release of
`@eco-incorp/sauce`, and the SDK itself was published under another name, `@eco-incorp/sauce-sdk`.
This page does not record any of them: it starts at SDK 0.99.0.

## Next

[Upgrading](guides/upgrading.md) walks through moving a project from one SDK release to the next,
using the **Now refused**, **Removed** and **Also breaking** items above.

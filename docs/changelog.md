# Changelog

**Reference** · [Documentation](README.md) · [Deployments](reference/deployments.md)

> What changed in SauceScript, the language you write programs in, from one SDK release to the
> next, and below that what each release of the compiler, the engines and the Kitchens changed.
> Newest first. A program that compiled before can stop compiling, or behave differently, after an
> upgrade: the entries say where.

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

SDK 0.99.0 and 0.99.1 named the compiler by range, `^2.2.0` and `^2.2.1`, so an install got the
newest 2.x compiler on npm that day: 2.2.1 from 2026-09-17, 2.3.0 from 2026-09-23, 2.4.0 from
2026-09-30 and 2.5.0 from 2026-10-06. Such an install compiles the language of that compiler, not
the one listed under its release, and its output is not paired with the engines that release pins.
From 0.99.2 on, every SDK release pins the compiler exactly.

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
**Now refused**, **Removed** and **Also breaking** items before you upgrade, even for a patch.

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
the 1.2.0 Router has no quote method. For 0.99.0 and 0.99.1 the compiler column gives the version
each was built and tested with; an install could resolve a newer one, as
[How Sauce is versioned](#how-sauce-is-versioned) explains.

## Unreleased

These changes are on the SDK's main branch and in no published release yet; the newest SDK on npm
is 0.99.14. The compiler is still 2.5.0, so each change here comes from the SDK. Only changes to
the language are listed.

### Solana swaps by venue name

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

### Solana accounts and tokens written in place

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

### Balances and chained calls

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

### Intents to and from Solana

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

## SauceScript by SDK release

Each entry lists what changed for someone writing a program, newest first. It starts with the
compiler the release ships, and marks each change EVM, Solana or both. A change comes from the
compiler or from the SDK: its token and protocol names, `@sauce/token` and `@sauce/router`, and the
way it compiles a program for a chain. Breaking changes outside the language close an entry, under
**Also breaking**.

Up to 0.99.6, a program compiled through the SDK could not carry type annotations (see 0.99.7).
The examples for those releases that use annotations compile with the compiler the release ships,
which the SDK exports as `@eco-incorp/sauce/compiler`.

### SDK 0.99.14 — 2026-10-11

Compiler 2.5.0, unchanged.

No language change.

### SDK 0.99.13 — 2026-10-09

Compiler 2.5.0, unchanged.

No language change.

### SDK 0.99.12 — 2026-10-08

Compiler 2.5.0, unchanged.

- **Added** (Solana): `@sauce/router` grows from 20 functions to 280, and no existing signature
  changes. Each price-limit venue gains an at-limit form, `try<Venue>AtLimit` and
  `<venue>AtLimit`, which trades to the pool's own limit, and Invariant and OpenBook v2 join those
  venues. Exact-input swaps, `(slot, trader, amountIn, minOut, recipient)` in a `try` and a plain
  form, cover about 45 more venues, Manifest and Gamma among them. `<venue>Cpi` sends the
  instruction alone and `<venue>Data` returns its bytes, for about 75 venues.
- **Changed** (Solana): A swap at a price writes its own instruction data, so the same program
  compiles about 64 bytes smaller.
- **Fixed** (Solana): A Crema pool with fewer than three tick arrays swaps instead of failing.
- **Also breaking:** The WOOFi Solana venue module no longer exports `OFF_POOL_RESERVE`.

### SDK 0.99.11 — 2026-10-07

Compiler 2.5.0, unchanged.

- **Added** (Solana): `@sauce/router` can be imported in a Solana program. Nine price-limit venues
  each have a `try` form and a plain form: `raydiumClmm`, `pancakeswapClmm`, `byreal`,
  `stabbleClmm`, `orcaWhirlpool`, `cropper`, `defituna`, `crema` and `phoenix` (`tryRaydiumClmm`
  and so on). `trySwap` and `swap` take a pool at any of them and find the venue from the pool's
  program. Each takes `(slot, trader, amountIn, maxPrice, minOut, recipient)` and returns what the
  recipient received. A `try` form returns 0 when it skips; the plain form reverts with "nothing
  swapped". `slot` and `trader` are arrays the program builds from its `Account` parameters,
  because `main` cannot take an array of accounts.

### SDK 0.99.10 — 2026-10-07

Compiler 2.5.0, unchanged.

- **Added** (EVM): `@sauce/router` has a `try` form for every EVM venue: `tryUniswapV3`,
  `tryUniswapV4`, `tryMaverickV2`, `tryDodoV2` and `tryWoofi` join the four that existed. It adds
  PancakeSwap Infinity pools as `infinityCL`, `tryInfinityCL`, `infinityBin` and `tryInfinityBin`.
  A `try` form returns 0 having moved nothing, or at least 1 when the swap ran, and a swap that
  takes input and delivers nothing reverts. With no `sqrtPriceLimitX96`, a `try` form walks an
  empty pool fully, about 10M gas, before it skips it.
- **Also breaking:** `sauce simulate` exits 1 when the simulated cook reverts, and MCP
  `sauce_simulate` returns the revert as an error.

```js
import { tryUniswapV3, infinityCL } from "@sauce/router";

function main(pool: Address, vault: Address, manager: Address, amountIn: Uint256, recipient: Address): Uint256 {
  const got = tryUniswapV3(pool, USDC, WETH, amountIn, 0, 1, recipient);
  if (got > 0) return got;
  return infinityCL(vault, USDC, WETH, amountIn, manager, 500, 0, 0, 0, 1, recipient);
}
```

### SDK 0.99.9 — 2026-10-07

Compiler 2.5.0, new in this release.

- **Added** (EVM): Block and transaction reads: `ctx.txOrigin()`, `ctx.coinbase()`,
  `ctx.prevrandao()`, `ctx.blockGasLimit()`, `ctx.baseFee()`, `ctx.gasPrice()`, `ctx.blockHash(n)`
  and `ctx.blobHash(i)`. Each is a compile error in a Solana program.
- **Added** (EVM): `ctx.blobBaseFee()`, the block's blob base fee. On a chain with no blobs, such
  as Arbitrum or Polygon, the cook halts, and the SDK still compiles it for those chains.
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
- **Also breaking:** Pot addresses change with kitchen-evm 1.2.0; existing Pots keep their engine.

```js
function main(initcode: bytes, salt: Uint256): Address {
  require(ctx.txOrigin() != ctx.coinbase(), "same");
  const deployed = evm.create2(initcode, salt, 0);
  require(evm.create2Address(ctx.self(), salt, crypto.keccak256(initcode)) == deployed, "create2");
  return evm.create3(initcode, salt);
}
```

### SDK 0.99.8 — 2026-10-02

Compiler 2.4.0, unchanged.

- **Added** (Solana): 1,799 tokenized stocks and ETFs are names, each standing for its mint: xStocks
  such as `TSLAx`, Ondo's such as `TSLAon`, Backpack's such as `NVDA_US`, and PreStocks'. They are
  Token-2022 mints, moved with `transferChecked` and `approveChecked`. PreStocks' mints charge a
  transfer fee, so measure what arrives.

```js
function main(tokenProgram: Account, from: Account<Writable>, mint: Account, to: Account<Writable>, owner: Account<Signer>, amount: Uint256): void {
  transferChecked(TSLAx, tokenProgram, from, mint, to, owner, amount, 8);
}
```

### SDK 0.99.7 — 2026-10-02

Compiler 2.4.0, unchanged.

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
- **Also breaking:** The `sauce` command and the MCP server build and send transactions only on
  Ethereum, Base and Solana. The `sauce-dev-tools` bin is removed; the `sauce-run` skill is renamed
  `sauce-cli`; intent commands move under `sauce intent <verb>`, and `--yes` becomes
  `--auto-approve`. Solana token rows need `tokenProgram`. The `swap` namespace,
  `swapThenDepositSource` and several swap action kinds are removed. The per-chain helpers leave
  `@eco-incorp/sauce/deployments`. Intents target eco-routes' Portal 2.12.

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

### SDK 0.99.6 — 2026-09-30

Compiler 2.4.0, unchanged.

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
- **Also breaking:** Callers of `rewriteTokenMembers` must prepend `tokenImportLines(result)`. The
  `crvusd` and `frax` templates' `transfer` and `approve` return `1`.

```js
function main() {
  USDC.transferFrom(ctx.msgSender(), ctx.self(), 1000000);
}
```

### SDK 0.99.5 — 2026-09-30

Compiler 2.4.0, new in this release.

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
- **Also breaking:** Pot addresses change with kitchen-evm 1.1.0. No RPC endpoints ship
  (`Chain.rpcUrls` is removed), and the SDK reads no environment variables. Chain accessors are
  named imports, not globals; `baseDirs` and the earlier actions entry points are removed. The
  Solana artifact helpers move to `@eco-incorp/sauce/svm/engine-artifacts`. The settle program grows
  from 356 to 435 bytes, with a new hash.

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

### SDK 0.99.4 — 2026-09-25

Compiler 2.3.0, unchanged.

No language change.

### SDK 0.99.3 — 2026-09-25

Compiler 2.3.0, unchanged.

No language change.

### SDK 0.99.2 — 2026-09-24

Compiler 2.3.0, new in this release.

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
- **Also breaking:** The package needs Node.js 24 or newer. `IntentOptions` needs `execution`, or
  both `pot` and `engine`. The settle program shrinks from 362 to 356 bytes, with a new hash.

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

### SDK 0.99.1 — 2026-09-17

Compiler 2.2.1, new in this release.

- **Now refused** (EVM): Calling a contract function whose ABI has a fixed-size array parameter of
  256 or more elements, such as `uint256[256]`, whatever is passed. Compiler 2.2.0 encoded the
  argument as a different ABI type than the callee expects. Declaring such a function in an
  imported ABI without calling it still compiles.
- **Fixed** (EVM): An object literal passed for a fixed-size array parameter (`T[N]`) of a contract
  call has every field type-checked, not only the first. A wrong type at a later position used to
  compile to the wrong layout; now it is a compile error. A wrong element count was already refused.

### SDK 0.99.0 — 2026-09-17

Compiler 2.2.0, new in this release.

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

- **Also breaking:** `createSauceSvmClient` needs a `kitchen` address, and `maxExecutionFee` where
  the Kitchen charges a fee. `buildCookInstruction` and `buildCookFromAccountInstruction` need
  `pot`, `feeConfig` and `maxExecutionFee`. The settle program changes from 363 to 362 bytes, with
  a new hash.

## The compiler (@eco-incorp/sauce-compiler)

The compiler is
[`@eco-incorp/sauce-compiler` on npm](https://www.npmjs.com/package/@eco-incorp/sauce-compiler).
From 1.0.0 on, each release names the engines and Kitchens the SDK paired it with. Earlier releases
came before the SDK pinned engines, so they name none. The first two releases, 0.1.0 and 0.2.0,
were published as `@eco-incorp/sauce-compiler-wasm` on GitHub Packages; the name
`@eco-incorp/sauce-compiler` starts at 0.3.0.

The language changes of every compiler from 2.2.0 on are listed under the SDK release that first
shipped it, in [SauceScript by SDK release](#saucescript-by-sdk-release). The entries here keep
what that list does not: engine pairing and the compiler's JavaScript API. Releases before 2.2.0
came before any SDK release, and their entries list their language changes.

### Compiler 2.5.0 — 2026-10-06

Pairs with v12-evm 1.2.0, kitchen-evm 1.2.0, v12-svm 1.3.0 and kitchen-svm 1.0.0, in SDK 0.99.9 to
0.99.14. Published the day before [SDK 0.99.9](#sdk-0999--2026-10-07), which first shipped it and
lists its language changes; an install of SDK 0.99.0 or 0.99.1 made from this date resolved it.

- **Added:** The `compile` options `chain` and `chainProfiles`, for a direct caller of the
  compiler. A chain profile can mark a builtin `"unsupported"`, which makes a use of it a compile
  error naming the chain, or give a read that takes no arguments a constant to fold into the
  program. The SDK and the `sauce` command pass no profile, so their programs compile as before:
  `ctx.blobBaseFee()` compiles for Arbitrum, where it halts the cook.
- **Added:** Errors thrown by `compile` carry a `diagnostics` array that places each problem in its
  module, so a tool no longer parses the message text. An error with no source location, such as a
  builtin refused on Solana, carries an empty array.
- **Changed:** `ctx.blobBaseFee()` answers the real fee on v12-evm 1.2.0; older engines answer a
  constant. The paired engine also makes `eval` run as the Pot and moves the Pot address family;
  see that release.

### Compiler 2.4.0 — 2026-09-30

Pairs with v12-evm 1.1.0, kitchen-evm 1.1.0, v12-svm 1.3.0 and kitchen-svm 1.0.0, in SDK 0.99.5 to
0.99.8. First shipped in [SDK 0.99.5](#sdk-0995--2026-09-30), the same day, which lists its
language changes.

- **Breaking:** Output from 2.4.0 needs v12-evm 1.1.0 and v12-svm 1.3.0. On an older Solana engine
  it fails loudly at the first spilled stack slot. Programs compiled by an earlier compiler must
  keep running on the engine they were compiled for. The instruction-set label does not change, so
  pair by exact version.
- **Changed:** EVM `abi.encode` and external-call arguments are compiled with a type list from the
  compiler, so nested tuples that mix scalars and pointers work at any depth. The release notes give
  a run-time nesting limit for `abi.encode` of 146 levels, down from 204; the compiler does not
  check it.
- **Changed:** Solana output is smaller and cheaper to run, because the engine no longer needs a
  cast after a spill, a reload or `new Array(n)`. A compiled program that returns a number is
  unaffected; only hand-written Solana bytecode that ends on a bare number fails, with
  `InvalidDescriptor`, on v12-svm 1.3.0.
- **Changed:** The Solana scalar misreads that v12-svm 1.3.0 fixes are an engine fix: programs that
  read record fields, compact arguments or tuple returns compile to the same bytes as with 2.3.0.

### Compiler 2.3.0 — 2026-09-23

Pairs with v12-evm 1.0.1, kitchen-evm 1.0.0, kitchen-svm 1.0.0 and v12-svm 1.0.1, 1.1.0 or 1.2.0,
in SDK 0.99.2 to 0.99.4. Published the day before [SDK 0.99.2](#sdk-0992--2026-09-24), which first
shipped it and lists its language changes; an install of SDK 0.99.0 or 0.99.1 made from this date
resolved it.

- **Changed:** `acct.dataLen` needs v12-svm 1.0.1 or later.
- **Changed:** Small scalar helpers are inlined when that pays, repeated expressions and tuple reads
  are computed once, `x + 0` and `x * 1` fold to `x`, and EVM scalar array literals are packed.
  Inlining alone cut about 24% of EVM gas and 33% of Solana compute units on an arithmetic
  benchmark.
- **Fixed:** The `abi.encode` fix listed under SDK 0.99.2 concerns EVM programs compiled by 0.3.0
  through 2.2.1. Solana is not affected.
- **Fixed:** Heap pointers no longer leak through raw array returns on EVM.

### Compiler 2.2.1 — 2026-09-17

Pairs with v12-evm 1.0.0, kitchen-evm 1.0.0, v12-svm 1.0.0 and kitchen-svm 1.0.0, in SDK 0.99.1.
Published on 2026-09-17 between SDK 0.99.0 and 0.99.1. [SDK 0.99.1](#sdk-0991--2026-09-17) first
pinned it and lists its language changes; an install of SDK 0.99.0 made after it was published
resolved it.

### Compiler 2.2.0 — 2026-09-16

Pairs with v12-evm 0.8.0, kitchen-evm 0.5.0, v12-svm 0.8.0 and kitchen-svm 0.4.0, in SDK 0.99.0.
First shipped in [SDK 0.99.0](#sdk-0990--2026-09-17), which describes the language at that release.

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

- **Fixed:** On EVM, writing a value into an array element or struct field (`a[i] = v`,
  `t.f = v`) stores it the way reads expect. Before, some large values were read back as a pointer,
  which ran out of gas or returned a wrong or empty value without reverting. Solana is unchanged.
  It needs an engine with the checked element write, first in v12-evm 0.7.0.

### Compiler 2.0.0 — 2026-09-15

The SDK paired it with v12-evm 0.6.0, kitchen-evm 0.3.0, v12-svm 0.7.0 and kitchen-svm 0.3.0,
before 0.99.

- **Changed:** No language change. The major version came from an EVM Kitchen change, a new Kitchen
  and Pot address family (see kitchen-evm 0.3.0).
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

### Compiler 0.7.0 — 2026-09-09

- **Breaking:** On Solana, a write needs the signature of the account being written, so a program
  that writes storage declares the account as `Account<Writable, Signer>`.
- **Added:** `crypto.findPDA(programId, seeds)` derives a Solana program address and bump on both
  targets; destructure it as `const [address, bump] = ...`. `account.address` reads an attached
  account's own public key.
- **Fixed:** A contract call with a fixed-size array input such as `uint256[2]` encoded it as a
  dynamic array, so the callee misread later arguments. It now follows the ABI, and contract-call
  arguments are type-checked against the declared inputs.
- **Fixed:** On EVM, a typed call to an address with no code, or with a short return, reverts
  instead of decoding to zero or garbage, and `eval` gives the same answer on both engines.

### Compiler 0.6.0 — 2026-09-02

- **Added:** Scripts: top-level statements are the entry point, so a file with no `main` compiles
  to the same bytes as one wrapped in `function main(): void { ... }`.

### Compiler 0.5.0 — 2026-08-31

- **Breaking:** An import attribute other than `with { type: "json" }` is a compile error.
  `svm.sstore` on an `Account` parameter not declared writable no longer compiles; annotate it
  `Account<Writable>`.
- **Added:** JSON data imports (`import cfg from "./cfg.json" with { type: "json" }`).
- **Added:** `interface` for named record types, `for (const x of xs)`, tuple destructuring such as
  `const [a, b] = call()`, `.catch(() => { ... })` on an EVM external call, `++` and `--`,
  `new Array(n)`, module-scope lookup tables, and `evm.tload` and `evm.tstore` for transient
  storage.
- **Added:** EVM reads `ctx.msgValue()`, `ctx.gasLeft()`, `ctx.codeSize(addr)`,
  `ctx.codeHash(addr)`, `ctx.isContract(addr)` and `ctx.isEOA(addr)`, and a portable
  `ctx.msgData()`. An `Account` parameter can declare its role as `Account<Writable>` or
  `Account<Signer>`, and entry parameters of any shape decode.
- **Fixed:** An ambient export no longer wins over an import of the same name. Programs with more
  than 16 entry parameters no longer fail with "a local variable is 17 deep", and an `if` arm no
  longer fails with a false "branches leave different locals live".

### Compiler 0.4.1 — 2026-08-20

No language change: the release corrects the npm README and the published TypeScript declarations.

### Compiler 0.4.0 — 2026-08-20

- **Breaking:** `svm.call`'s callee is a declared `Account` instead of a literal public key, and
  every account known at compile time is a `main` parameter.
- **Added:** `svm.remainingAccount(i)` and `svm.remainingAccounts()` read accounts attached after
  those `main` declares. `==` and `!=` on an `Account` compare identity, and `account.owner` reads
  the program that owns an account.
- **Changed:** Arrays and tuples built at run time are no longer capped at 255 elements.

### Compiler 0.3.0 — 2026-08-18

- **Breaking:** `bool` is its own type: a number where a `bool` is declared no longer compiles, nor
  the reverse. Convert with `cond ? 1 : 0`.
- **Breaking:** `abi`, `crypto`, `ctx`, `Math`, `evm` and `svm` can no longer name a variable,
  parameter or import. A struct passed to a contract call is matched to the ABI's fields by name,
  and a literal that names only some of them is an error.
- **Added:** A portable `eval(code, ...args)` on both targets.
- **Fixed:** `abi.decode` of a fixed-size array such as `uint256[3]` read every later output from
  the wrong offset. A struct passed to a contract call was encoded in source order rather than the
  ABI's order.

### Compiler 0.2.0 — 2026-08-17

Published as `@eco-incorp/sauce-compiler-wasm` on GitHub Packages.

- **Breaking:** `abi.decode` no longer takes the shape word `"scalar"`: use `Uint256`, `Address`,
  `bool`, `bytes` and `string`. An unknown type annotation, a leading-zero integer literal, a
  function named `log`, and a literal index past the end of a fixed-size array in a store are
  compile errors. A function other than `main` that returns an array, tuple or `bytes` must
  annotate its return type.
- **Added:** `cond ? a : b`, `**=`, `throw "msg"`, `abi.encode(a, b)`, tuple projection by index
  or output name, a portable `log(data, ...topics)`, module-scope `let` and `const`, and `bytes`,
  array and tuple parameters.
- **Changed:** `&&` and `||` short-circuit as in JavaScript.
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

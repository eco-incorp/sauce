---
name: sauce-intents
description: Cross-chain intents written in Sauce — a file that is the intent, Base(() => { ... }).reward({ ... }) as top-level statements with no main and its values as defines, run from your Pot with sauce run or published from your wallet with sauce publish, carrying amounts measured on chain into it, nesting intents into multi-hop cascades, token-only bodies versus program bodies (Executor calls versus a Pot cook), the delivery argument, reward tokens, on which chain each name resolves, the shared destination Pot, Kitchen fees, and the deadline and creator every intent needs. Use when a program should continue on another chain, forward a swap or bridge output, build a cascade or multi-hop route, pay a solver, or when the user mentions intents, rewards, solvers, Portals, provers, Executors or Pots.
---

# Cross-chain intents in Sauce

An intent is an **offer**: run this on the destination chain, and the reward escrowed on this chain
is yours. An intent file is written as **top-level statements, with no `main`**: the chain name
called as a function opens the intent, and every value the file does not compute is a define, left
undeclared in the file and set with `--define NAME=VALUE` (`sauce-script`).

```sauce chain=base define=RECIPIENT,AMOUNT
Arbitrum(() => {
  Token(0xaf88d065e77c8cc2239327c5edb3a432268e5831n).transfer(RECIPIENT, AMOUNT); // Arbitrum USDC
}).reward({ tokens: [{ token: USDC, amount: AMOUNT }] });
```

Nothing about the fill is guaranteed: a solver decides whether the reward is worth it, and the
package prices nothing. Say an intent is _offered_, never that it _will execute_.

## Names resolve per chain

The file is compiled for the **source** chain, the one that pays the reward (`--chain`).

- **In `.reward(...)`**, names are the source chain's, which funds and escrows the reward: `USDC`
  there is the source chain's USDC. A reward token must be known when the file is compiled: a
  symbol, or a token's address on the source chain as a literal or a define. Its amount may be a
  measured value.
- **Inside the braces, and in the delivery argument**, the code runs on the destination. Protocol
  namespaces resolve there: `AaveV3.Pool` in an `Arbitrum(...)` body is Arbitrum's pool. A bare
  token symbol, `chainId` and a `Namespace_Contract` define resolve on the chain the file is
  compiled for, so name each destination token by **its address on the destination**, from the
  destination's file in `sauce-chains`
  ([../sauce-chains/references/arbitrum.md](../sauce-chains/references/arbitrum.md) for Arbitrum):
  `Token(0xaf88d065e77c8cc2239327c5edb3a432268e5831n)` is Arbitrum's USDC.

## Two ways to run the file

With [examples/cross-chain.sauce.ts](examples/cross-chain.sauce.ts), which measures its amount, and
the first file above saved as `pay-on-arbitrum.sauce.ts`, which does not:

```sh
npx sauce run cross-chain.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --define BENEFICIARY=<address> --intent-deadline <unix seconds> --intent-creator <address> \
  --intent-execution-fee <wei>
npx sauce publish pay-on-arbitrum.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --define RECIPIENT=<address> --define AMOUNT=1000000 \
  --intent-deadline <unix seconds> --intent-creator <address> --dry-run
```

- **Run it from your Pot** (`sauce run`): the file is a program cooked on your Pot on the source
  chain, and opening the intent is one of its steps; the Pot approves the source chain's Portal for
  the reward and publishes and funds the intent. Values measured while it runs can flow into the
  intent: in `const amount = USDC.balanceOf(ctx.self())`, `amount` does not exist until the program
  runs, and using it inside the braces, in the delivery or in the reward is enough. The package
  encodes the intent with a slot for it, and the program writes the measured value in before it
  publishes. Any one-word value can be carried this way.
- **Publish it from your wallet** (`sauce publish`): the intent is built before anything runs, and
  your wallet approves the reward to the Portal and calls `publishAndFund`. There is no Pot and
  nothing is measured, so every amount must be a literal or a define, and the file may do nothing
  but open intents; a file with a measured amount is refused, with `sauce run` named instead.
  `--dry-run` rehearses both transactions against the wallet's real balances and sends nothing, so
  it reverts unless the wallet already holds the reward.
- **Print the transactions for any wallet**: `--format json` (or `cast`) with `--from <address>` and
  no signer prints the approve and the `publishAndFund`, unsigned, for that wallet to send in order.
  With no endpoint it plans each approve without reading the standing allowance; with one, it reads
  it.

```sh
npx sauce publish pay-on-arbitrum.sauce.ts --chain base --from <address> --format json \
  --define RECIPIENT=<address> --define AMOUNT=1000000 \
  --intent-deadline <unix seconds> --intent-creator <address>
```

`sauce inspect <file> --chain <chain>` with the same defines and intent flags prints each intent
the file opens: its destination, the route's calls and the reward, with every measured value named.

## Two kinds of body

| The body is…                                                                                                | Lowers to                                                    | Needs                                                                  | Token writes                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| only `transfer`/`approve` calls on a symbol or `Token(address)`, with literal, define or captured arguments | plain calls the destination Portal's Executor makes          | nothing more: no Pot, no Kitchen fee                                   | USDT works and `approve` is reset to zero first, but a `false` return is **not** detected |
| anything else: a local, a balance read, a condition, a protocol call, `transferFrom`, a nested intent       | a program compiled for the destination and cooked on its Pot | the destination's Kitchen fee, and the delivery as the second argument | SafeERC20: a `false` return reverts the fulfilment                                        |

A program body must say what the solver delivers, because a balance read inside it reads what is
there, not what must be brought:

```sauce chain=base define=BENEFICIARY
const amount = USDC.balanceOf(ctx.self());
const delivered = amount - (amount * 10n) / 10000n;
Arbitrum(
  () => {
    Token(0xaf88d065e77c8cc2239327c5edb3a432268e5831n).approve(AaveV3.Pool, delivered);
    AaveV3.Pool.supply(0xaf88d065e77c8cc2239327c5edb3a432268e5831n, delivered, BENEFICIARY, 0n);
  },
  { tokens: [{ token: 0xaf88d065e77c8cc2239327c5edb3a432268e5831n, amount: delivered }] }
).reward({ tokens: [{ token: USDC, amount }] });
```

The gap between `delivered` (brought on Arbitrum) and `amount` (paid on Base) is the solver's
margin. Make it worth filling.

## A whole program as the body

The body can be any program for the destination, such as a complete swap:
[examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) runs the distributed swap
(`sauce-distributed-swap`) on Base for WETH a solver delivers there, and pays the solver in WETH on
the source chain. The body is written inside the braces, uses the file's defines as values, and
**imports nothing** (an intent file cannot import): it calls contracts by namespace
(`UniswapV3.Factory.getPool(...)`) or by selector, with `evm.static(address, data)` for a read and
`evm.call(address, value, data)` for a write, `data` being the selector bytes
`.concat(abi.encode(...))`. The swap Router is reached through the Pot itself,
`evm.call(ctx.self(), 0n, ...)`. Every unsold input and every output leaves the destination Pot
before the body ends, and a refund the body makes lands on the destination chain. The body runs on
the shared intent Pot, which holds nothing of anyone's between intents, so it may return a token's
whole balance there, as the refunds below do; a program on an owner's Pot returns only what is left
of its own amount instead (`sauce-distributed-swap`).

Inside a body, read a decoded result by position, `abi.decode(data, ["Address"])[0n]`: destructuring
it, `const [pool] = …`, is refused there ("Identifier 'pool' has already been declared"), though it
compiles anywhere else.

A venue with no namespace on the destination, such as PancakeSwap V3 or Aerodrome Slipstream on
Base, is therefore reached by selector, with its address as a define (the protocol's document in
`sauce-protocols` has it). The selectors the distributed swap needs:

| Call                                                                                                      | Selector                                 |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| a V3-style factory's `getPool(address,address,uint24)` (Uniswap V3, PancakeSwap V3)                       | `0x1698ee82`                             |
| a Slipstream factory's `getPool(address,address,int24)`                                                   | `0x28af8d0b`                             |
| a pool's `slot0()`, `liquidity()`, `fee()`                                                                | `0x3850c7bd`, `0x1a686502`, `0xddca3f43` |
| the V4 PoolManager's `extsload(bytes32)`                                                                  | `0x1e2eaeaf`                             |
| the Router's `swapV3(address,address,address,int256,uint160,address,address)`                             | `0xa5e2989d`                             |
| the Router's `swapV4(address,(address,address,uint24,int24,address),bool,int256,uint160,address,address)` | `0x7c9e9da3`                             |

```sauce chain=arbitrum define=SLIPSTREAM_FACTORY,AMOUNT_IN,REFUND_TO
Base(
  () => {
    const weth = 0x4200000000000000000000000000000000000006n; // Base WETH
    const usdc = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n; // Base USDC
    const getPool = hex`28af8d0b`; // getPool(address,address,int24)
    const call = getPool.concat(abi.encode(weth, usdc, 100n));
    const pool = abi.decode(evm.static(SLIPSTREAM_FACTORY, call), ["Address"])[0n];
    require(pool != 0n, "no WETH/USDC pool at tick spacing 100");
    Token(weth).transfer(REFUND_TO, Token(weth).balanceOf(ctx.self()));
  },
  { tokens: [{ token: 0x4200000000000000000000000000000000000006n, amount: AMOUNT_IN }] }
).reward({ tokens: [{ token: WETH, amount: AMOUNT_IN }] });
```

## Cascades

An intent's body can open the next one. Each level's amounts are measured at that level's own
execution and carried into the level below; no amount past the first exists when the user signs.

```sauce chain=base define=RECIPIENT
const amount = USDC.balanceOf(ctx.self());
Arbitrum(
  () => {
    const arrived = Token(0xaf88d065e77c8cc2239327c5edb3a432268e5831n).balanceOf(ctx.self());
    Optimism(() => {
      Token(0x0b2c639c533813f4aa9d7837caf62653d097ff85n).transfer(RECIPIENT, arrived);
    }).reward({ tokens: [{ token: 0xaf88d065e77c8cc2239327c5edb3a432268e5831n, amount: arrived }] });
  },
  { tokens: [{ token: 0xaf88d065e77c8cc2239327c5edb3a432268e5831n, amount }] }
).reward({ tokens: [{ token: USDC, amount }] });
```

Each level is a separate fulfilment by a solver, later, on its own chain: a failure on a later hop
does not undo an earlier one. The Arbitrum level pays the Optimism level's reward from Arbitrum, in
Arbitrum's USDC. Each level's deadline must be no earlier than its parent's.

## What the compile supplies, and what you pass

The Portal, the prover, the destination Pot and the encoding are looked up from the eco-routes
registry, which records each chain's Portal and a prover deployed on both sides. Each chain's file in
`sauce-chains` says whether it takes intents and gives its Portal, Executor and shared intent Pot
([../sauce-chains/references/index.md](../sauce-chains/references/index.md)). Three values are the
developer's:

- **`--intent-deadline <unix seconds>`**: when the intent must be filled by.
- **`--intent-creator <address>`**: who may reclaim an unearned reward. Never a Pot.
- **`--intent-execution-fee <wei>`** for a program body: the destination Kitchen's fee. It is
  mutable on chain and lives on the destination, so read it there just before sending: an
  `eth_call` of `executionFee()` on the destination's Kitchen (its address is in the chain's file in
  `sauce-chains`). An increase before the fill makes the cook, and the fulfilment, revert.

**What the solver pays.** The fee becomes the route's `nativeAmount`: the solver sends it, in the
destination's native coin, as the value of `fulfill`, and pays the destination gas too. Nothing in
the reward pays either back, so the margin (the reward minus what the solver delivers) must cover
both; a body that reads and swaps on many pools costs a lot of gas, so measure it in a rehearsal
(below). The deadline and the fee are part of the route, so changing either is a different intent
with a different hash: rebuild every transaction, including any unsigned one printed earlier.

Refused at compile time, never silently changed: a name that is neither a define nor a program
variable, a missing deadline, creator or fee, a chain with no eco-routes deployment, a pair with no
prover deployed on both sides.

## The destination Pot

A program body cooks on the destination Portal Executor's **shared Pot** (one per Executor, salt
zero); the destination's file in `sauce-chains` gives its address. The package derives it and
deploys nothing: **the Pot must exist before fulfilment, and no solver can fill a program body
until it does**. Deploying it is permissionless, and returns the existing Pot when there is one:
call the destination Kitchen's `deployPot(address owner, bytes32 salt)` with the Executor as
`owner` and a zero salt, from any account. Anything left in the Pot after the program, token or
allowance, belongs to the next intent through that Portal: approve exactly what is spent and move
every remainder out.

## Rehearse the body before a solver does

`sauce publish --dry-run` covers only the source side, the approve and `publishAndFund`; the body
first runs when a solver fulfils it. Run it yourself on a fork of the destination first, as a solver
would:

1. Fork the destination (`anvil --fork-url <destination endpoint>`).
2. Get the intent: `sauce inspect <file> --chain <source> --json`, with the same defines and intent
   flags, prints each intent's `intentHash`, `routeHash`, `rewardHash`, route and reward. The raw
   route bytes are the `route` argument of `publishAndFund` in
   `sauce publish <file> … --from <address> --format json` (their keccak-256 is `routeHash`).
3. Check that the shared Pot has code; if not, send the Kitchen's `deployPot(<Executor>, 0x0)`.
4. Deliver the route's tokens the way a solver does: hold the route's `tokens` in an account and
   approve the destination Portal for each; `fulfill` pulls them.
5. From that account, call the destination Portal's
   `fulfill(bytes32 intentHash, Route route, bytes32 rewardHash, bytes32 claimant)` with **value =
   the route's `nativeAmount`**, where `Route` is
   `(bytes32 salt, uint64 deadline, address portal, uint256 nativeAmount, (address token, uint256 amount)[] tokens, (address target, bytes data, uint256 value)[] calls)`,
   the route bytes decoded, and the claimant is the solver's address as 32 bytes. Less value
   reverts with `InsufficientNativeAmount(sent, required)` (`0x172f1184`), and a missing Pot with
   `CallToEOA(<Pot>)` (`0x2db59289`), the Executor's refusal to call an address with no code. The
   Portal's `getIntentHash(uint64 destination, bytes route, Reward reward)` returns the same three
   hashes, as a cross-check. The Portal's ABI, with its events and errors, is the registry's
   `eco-routes` `PortalABI` (`sauce-protocols`).
6. Read the outcome on the fork: what the recipient got, what was refunded, the gas, and that the
   Pot holds nothing.

The hashes are `routeHash = keccak256(route bytes)`, `rewardHash = keccak256(abi.encode(reward))`
and `intentHash = keccak256(abi.encodePacked(uint64 destination chain id, routeHash, rewardHash))`.

Solana destinations are not built this way (see `sauce-solana`). An application can also build an
intent from TypeScript around a program it compiles itself (`sauce-typescript`).

## Examples

- [examples/cross-chain.sauce.ts](examples/cross-chain.sauce.ts) forwards the Pot's USDC to Aave on
  Arbitrum. It measures its amount, so it runs from a Pot.
- [examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the distributed swap as the
  body of an intent to Base. Its amounts are defines, so it can be run from a Pot or published from a
  wallet.
- [examples/intents.mts](examples/intents.mts) compiles both, with the deadline, the creator, Base's
  and Arbitrum's fees and the recipient as developer inputs, and pins on which chain each name
  resolves, the fee requirement, the token-only case, the selectors above, and the rehearsal's
  transactions: the Pot's deploy and `fulfill` with the fee as its value.

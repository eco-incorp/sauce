---
name: sauce-protocols
description: Choosing and calling a DeFi protocol from a Sauce program, from the SDK's registry. An index of every protocol by category with how to choose between them (a lending market against another, a concentrated-liquidity pool against a V2 pair or a stable pool, an aggregator, a bridge), a generated registry file per protocol (its deployments on every chain, how a program names each contract there, its ABI functions), and a document per protocol (what it is for, its pitfalls for a program, a compiled example, its templates). Covers reaching a protocol through its namespace or an ABI import, a chain that may lack it, factories and pool lookups, address-only factories, Solidity idioms in SauceScript, and checking a recorded address has code. Use when a program must call a protocol (Aave, Morpho, Lido, Curve, Balancer, PancakeSwap V3, Aerodrome Slipstream, Camelot, CCTP, …), when the user asks which protocols or pools exist on a chain or which to use, needs a factory or router address, or wants a protocol's pitfalls.
---

# Protocols

Every protocol the SDK registers, and how a program reaches it. This skill owns choosing a
protocol and the per-protocol facts: the index by category, a registry file and a document per
protocol. How a call is written is `sauce-script`'s; what a namespace member is, `sauce-globals`'s;
a swap, `sauce-swaps`'s.

## When to use

| Task                                                       | Here | Elsewhere                                                             |
| ---------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| Pick a protocol for a job (lend, stake, bridge, a pool)    | yes  |                                                                       |
| A protocol's deployments, contract names and ABI functions | yes  | one chain's every protocol: `sauce-chains`                            |
| A protocol's pitfalls before calling it                    | yes  |                                                                       |
| A swap                                                     |      | `sauce-swaps` (a program never swaps through a protocol's own router) |

## Core model

Each protocol has three files under [references/](references/index.md):

| File                                                                                  | Generated | Gives                                                                                      |
| ------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| [references/index.md](references/index.md)                                            | yes       | every protocol by category, each category with "Choosing between them"                     |
| `references/registry/<slug>.md`, e.g. [uniswap-v3](references/registry/uniswap-v3.md) | yes       | its deployments on every chain, how a program names each contract there, its ABI functions |
| `references/<slug>.md`, e.g. [aave-v3](references/aave-v3.md)                         | no        | what it is for, its pitfalls for a program, a compiled example, its templates and notes    |

A program reaches a protocol through its **registry namespace**, with no import: address and ABI
come from the registry for the chain it is compiled for (`AaveV3.Pool.supply(...)`). Where the
chain has no namespace for it, through the protocol's **ABI import**,
`./protocols/<slug>/<Export>.json`, bound with `.at(address)` to an address passed as a `main`
input. Namespace members (deployed contract, address only, interface) are `sauce-globals`'s.

## Choosing

| Question                     | Answer                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Which protocol for a job     | the category's "Choosing between them" in [references/index.md](references/index.md)                     |
| How to name a contract       | the registry file's "In a program" column for your chain                                                 |
| A chain may lack it          | `if (Namespace.Contract) { … }`: zero where the chain lacks it (`sauce-globals`)                         |
| A pool, not a fixed contract | look it up at run time through the factory (`getPool`, `getPair`), which returns `0` where there is none |
| An address-only factory      | discover the pool off chain and pass its address as a `main` input                                       |
| A swap                       | a `@sauce/router` function for the venue (`sauce-swaps`)                                                 |

## Calling a protocol

1. **Find it**: its category in [references/index.md](references/index.md), then its registry file:
   is it deployed on the program's chain, and how does a program name the contract there?
2. **Read its document's pitfalls** (`references/<slug>.md`) before writing the call: approvals,
   who receives the output, caps and pauses, rebasing receipts.
3. **Write the call** through the namespace, deciding who receives the output (`sauce-script`).
   A program meant also for a chain without the protocol tests the name, `if (X) { … }`: a name
   the chain lacks is zero there, the test is decided when the program compiles, and the branch it
   rules out is not compiled. Any other use of an absent name is refused, naming the chain:

```sauce chain=base,arbitrum,optimism
function main(fee: Uint256) {
  const uni = UniswapV3.Factory.getPool(WETH, USDC, fee);
  let pancake = 0;
  if (PancakeswapV3.Factory) {
    pancake = PancakeswapV3.Factory.getPool(WETH, USDC, fee);
  }
  require(uni != 0 || pancake != 0, "no WETH/USDC pool at that fee");
}
```

4. **Compile, simulate and run it** (`sauce-cli`). With that program in `pools.sauce.ts`, a run on
   Base passes nothing but the fee, in millionths (`500` is the 0.05% tier):

```sh
sauce run pools.sauce.ts --chain base --keystore <keystore> \
  --args 500
```

## Reading a protocol document

- **Its templates are typed programs for the raw compiler**: their
  `import { PoolABI as IPool } from "./abis"` is served by the template's caller. In a program for
  a chain, use the namespace instead.
- **Its Solidity idioms have SauceScript spellings**:

| Solidity            | SauceScript       |
| ------------------- | ----------------- |
| `msg.sender`        | `ctx.msgSender()` |
| `address(this)`     | `pot`             |
| `type(uint256).max` | `~0`              |

- **"The caller", `address(this)` or "this contract" is the Pot**, `pot`, in a Sauce program: what
  lands there stays in the Pot, not in the user's wallet, until another cook moves it.

## Porting a protocol's own example

A protocol's Solidity example is a contract its user deploys, funds and calls; a Sauce program is
that contract's functions, cooked on the user's Pot with nothing deployed. The Pot plays the
contract's part: it holds the tokens, receives what the protocol pays its caller, and keeps what
the protocol mints it, a Uniswap V3 position's NFT included. A Pot is cooked by its owner alone, so
the records and checks a contract keeps of who may call it fall away. Each Solidity function becomes
a function of the program and `main` picks one; `msg.sender`'s tokens are already in the Pot, and
an address the example hardcodes is the registry's name for it. Each ported example's header names
the file it ports, pinned to a commit, and says what changed and why. One encoding differs:
Solidity's `abi.encode(s)` of a struct that holds a dynamic field (`bytes`, an array) is that struct
as one value, behind an offset, while `abi.encode` encodes a record as its fields; write
`abi.encode({ s: record })` for the Solidity bytes.

[examples/uniswap-v3-liquidity-examples.sauce.ts](examples/uniswap-v3-liquidity-examples.sauce.ts)
ports Uniswap's `LiquidityExamples`: a full-range DAI/USDC position minted to the Pot, its fees
collected, half its liquidity taken out, liquidity added and its NFT handed back.

[examples/aave-v3-credit-delegation.sauce.ts](examples/aave-v3-credit-delegation.sauce.ts) ports
Aave's own credit delegation example onto `AaveV3.Pool`: the Pot supplies collateral, lets a
borrower borrow against it (the debt token's `approveDelegation`, with the Pool's reserve reads, in
[examples/AaveV3Delegation.json](examples/AaveV3Delegation.json)), repays that debt and withdraws.
Aave's flash loan does not port: its Pool pays the receiver and then calls it back
(`executeOperation`) to be repaid, and a Pot cannot be called back by a program. The flash a program
has is a flash swap through the Pot's Router (`sauce-swaps`).

[examples/compound-v3-my-contract.sauce.ts](examples/compound-v3-my-contract.sauce.ts) ports
Compound's `MyContract`, its Compound III developer FAQ's example: supply, withdraw (a borrow past
what is supplied), a whole borrow repaid and rewards claimed by `step`, each cook returning the
contract's views for the Pot, and step 0 changing nothing, so `sauce simulate` is the read. The
Comet and CometRewards functions are in [examples/Comet.json](examples/Comet.json). Its signed
principal, an `Int256`, shows signed arithmetic beside unsigned: the sign is read with `>= 0`, each
part converted with `Uint256(…)`, and the debt kept apart from the collateral until `Int256(…)`
takes one from the other.

[examples/morpho-blue-snippets.sauce.ts](examples/morpho-blue-snippets.sauce.ts) ports Morpho's
own snippets for a Morpho Blue market, the market named by its id: supply, collateral in and out,
withdrawals and repayments by an amount, half or all (by shares, their cost worked out as Morpho
rounds it and approved exactly), a borrow, and the views a position needs, with Morpho's reads,
the IRM's rate and the oracle's price in
[examples/MorphoBlueReads.json](examples/MorphoBlueReads.json). A Solidity view that computes
interest accrued since the market was last touched becomes `accrueInterest` and a read: a program
runs as a transaction, even under `sauce simulate`.

[examples/pendle-router-sample.sauce.ts](examples/pendle-router-sample.sauce.ts) ports Pendle's own
router samples: PT and YT bought and sold back, a zap into a market's liquidity and out, SY and PT
with YT minted and redeemed, and a zap that keeps its YT, each a `step` on one market, with the
router's approximation, token and limit-order arguments built as Pendle's StructGen builds them
and the functions the registry's ABI leaves out in
[examples/PendleRouterSample.json](examples/PendleRouterSample.json).

## Pitfalls

- **Recorded is not live.** A registry address is not proof of code: confirm `eth_getCode` returns
  code before relying on it.
- **Swapping through a protocol's own router.** Use `@sauce/router` (`sauce-swaps`).
- **An address-only factory called for a pool** (`Kyberswap.ElasticFactory`): the registry has no
  ABI for it, only its address; pass the pool as a `main` input. An Algebra factory (Camelot V3,
  QuickSwap V3) is a deployed contract: `Camelot.V3Factory.poolByPair(a, b)` returns the pool, with
  no fee argument (Algebra fees are dynamic).
- **A standing allowance.** Approve exactly what the call spends: the Pot keeps any allowance it
  grants.
- **An output left in the Pot by default.** A call naming no beneficiary credits its caller, the
  Pot; pass the user's wallet where they chose it.
- **A receipt measured by the amount supplied.** Rebasing receipts (aTokens) grow: measure deltas.

## Files

- [examples/protocols.sauce.ts](examples/protocols.sauce.ts) calls Aave and, where the chain has
  it, PancakeSwap V3 through their namespaces.
- [examples/protocols.mts](examples/protocols.mts) compiles it for Base, Arbitrum and Optimism (the
  last two preview chains, compiled only), loads a protocol document, and compiles a protocol
  template.
- [examples/uniswap-v3-liquidity-examples.sauce.ts](examples/uniswap-v3-liquidity-examples.sauce.ts)
  ports Uniswap's `LiquidityExamples` (above), with the position reads the registry's ABI leaves
  out in [examples/UniswapV3Positions.json](examples/UniswapV3Positions.json).
- [references/index.md](references/index.md), `references/registry/<slug>.md` (generated) and
  `references/<slug>.md` (one document per protocol).

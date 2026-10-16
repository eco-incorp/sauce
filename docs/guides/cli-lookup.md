# Look things up

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Programs and arguments](cli-programs.md)

> Before you write a program, you want to know what is out there: which tokens a chain has, which
> pools trade a pair and at what price, what a transaction someone sent actually did. These commands
> are the lookups. They only read, never send, and they work on every chain, preview chains
> included.

| Command         | Answers                                                            |
| --------------- | ------------------------------------------------------------------ |
| `sauce globals` | Which tokens and protocols can a program on this chain name?       |
| `sauce price`   | What numbers does a swap program need for this price?              |
| `sauce pools`   | Which pools trade this pair, how deep are they, and at what price? |
| `sauce inspect` | What is in this transaction, call or program?                      |
| `sauce verify`  | Does this payload run the audited settle program?                  |

## The names a program can use: `sauce globals`

```sh
sauce globals --chain base                       # everything
sauce globals --chain base --tokens              # token symbols only
sauce globals --chain base --protocols           # protocol namespaces only
sauce globals --chain base --protocol UniswapV3  # one namespace, with its methods
sauce globals --chain base --stocks              # the chain's tokenized stocks
sauce globals --chain base --search spacex       # tokens by symbol, company name or ticker
```

It lists every name a program compiled for the chain may use without declaring it: the tokens with
their addresses and decimals, each protocol's contracts with their addresses, the chain names that
open intents, and the token functions. `--protocol <name>` adds each method, with every parameter.
A name it lists is one the compiler accepts, at the address the program gets.

## Prices for a swap: `sauce price`

A swap program takes its price limits in a pool's own format. `sauce price` turns a price you can
read into those numbers:

```sh
sauce price --chain base 2700 USDC per WETH
```

Its first line says what the price means both ways round, since a price written backwards is off by
a millionfold for WETH and USDC:

```text
2700 USDC per WETH on base: 1 WETH = 2700 USDC, 1 USDC = 0.00037037037037037 WETH
```

Then it gives the numbers: `sqrtPriceX96`, the price a Uniswap-style pool keeps and a swap's price
limit, and for buying and selling, the `priceLimit`, `maxAvgPrice` and `minAvgPrice` the
[distributed swap](distributed-swap.md) and single swaps check against. It also reads the pair's
price now, and warns when yours is far from it.

## A pair's pools: `sauce pools`

```sh
sauce pools --chain base USDC WETH
sauce pools --chain base USDC SPCXc   # a tokenized stock
```

It reads every pool of the pair at the exchanges whose swaps stop at a price limit (Uniswap V3 and
V4, PancakeSwap V3, Aerodrome Slipstream, and on Solana the venues there), deepest first, with each
pool's fee, liquidity, price both ways, and how much moves its price 1%:

```text
USDC/SPCXc on base at block 36120411: 3 pools with liquidity, deepest first (by liquidity at the pool's price)
  token0  USDC   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  6 decimals
  token1  SPCXc  0xb2000000000000000000007b9fcbd005511aCBd5  8 decimals

1. Aerodrome Slipstream 0x0bf58fe0FAc935Ac69595c19B12Ba0d75E3F8c0E
   AerodromeSlipstream.CLFactoryGaugesV3 0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef
   fee 0.05% (read from the pool), tick spacing 10, liquidity 206953500095168, tick -3968
   sqrtPriceX96  64972491279845651558239670148
   buy SPCXc with USDC  148.771 USDC each, 148.696 before the fee; 128966 USDC moves it 1%
                        priceLimit 1487706738131601814
   buy USDC with SPCXc  0.00672848 SPCXc each, 0.00672512 before the fee; 1267.21 SPCXc moves it 1%
                        priceLimit 672848166136197636
…
```

It reads everything at one block and names it, so `sauce simulate --block` can try a swap on the
prices it saw.

## Take it apart: `sauce inspect`

```sh
sauce inspect 0x<tx hash> --chain base                          # a transaction
sauce inspect 0x<calldata> --chain base --source split.sauce.ts # a cook, its arguments decoded
sauce inspect bridge.sauce.ts --intent-deadline 2000000000 --intent-creator 0xYou  # a file
```

It turns bytes back into what a program's author wrote: a cook and the program in it, every intent
the program opens, a Pot's creation, an intent's publish, a token call, or a whole transaction with
what it cost and what it moved.

## Check a settlement: `sauce verify`

```sh
sauce verify 0x<settle payload>
sauce verify 0x<tx hash> --chain base
```

It checks that a payload, a cook, an intent or a transaction runs the audited settle program, and
prints the `tokens`, `minOut` and `recipient` it carries. [Verification](verification.md) says what
that proves and what it does not.

## Details

### `sauce globals` in detail

It also lists `chainId` and each contract's address as `Namespace_Contract`. On an EVM chain it lists
the interfaces: ABIs the registry knows with no fixed address (`Erc4626.Vault`, `Erc20.ERC20`), which
a program calls with an address of its own, `Erc4626.Vault(vault).totalAssets()`; `--protocol
Erc4626` lists their methods. `--json` prints the same for a program to read (`interfaces` beside
`protocols`). It is `routes.sourceGlobals(chain)`, which reads the registries the compile reads and
lists contracts through the protocol rewrite's own resolver.

A chain's tokenized stocks (Ethereum and Solana have over a thousand each) are counted rather than
listed unless you ask: `--stocks` lists them, each with its name, the underlying's ticker and its
issuer, and `--search <text>` lists the tokens, stocks included, whose symbol, name, ticker or issuer
contains the text, without regard to case. A search also finds a stock by the name another issuer
gives it: `--search spacex` finds Coinbase's `SPCXc`, whose own name is "Space Exploration
Technologies Corp.". In `--json`, a stock token carries `stock` with its issuer, name, ticker and the
issuer's list it was copied from. Symbols are matched without regard to case on the command line
too (`--fund spcxc:1`, `sauce price spcxc USDC 150`, `--account source=pot:tslax` on Solana); in a
program they are case-sensitive. On Solana each stock is a Token-2022 mint, listed with its mint and
the 32-byte key a program holds; `--stocks` leaves out devnet's mints, which have none.

### `sauce price` in detail

```sh
sauce price --chain base WETH USDC 2700                       # the same: <base> <quote> <price>
sauce price --chain base 2700 USDC per WETH --offline         # without the pool's price now
sauce price --chain base WETH USDC --sqrt-price-x96 4116816085950893928074568
sauce price --chain base SPCXc USDC --pool 0x0bf58fe0FAc935Ac69595c19B12Ba0d75E3F8c0E
```

The first line's two readings are `means` and `inverse` in `--json`. It reads the pair's price now
from its deepest Uniswap V3 pool on the chain (`live` in `--json`) and warns on stderr when the price
given is 10x or more away from it, saying so, with the command that reads it the right way, when it
looks written backwards. It turns a price, in quote tokens per base token, into the numbers a swap
program takes, for the pair's order on the chain (token0 is the lower address): the `sqrtPriceX96`
a Uniswap V3 or V4 pool (or a fork) trades at, which is also the swap's `sqrtPriceLimitX96` (a floor
when selling token0, a ceiling when selling token1), and, for selling the base token and for buying
it, the price both ways round, each labelled with its units (`units` in `--json`):

- `priceLimit` and `maxAvgPrice`: the paid token's base units per bought base unit, times 1e18 (the
  price times 10^(18 + paid decimals − bought decimals), rounded down), which the distributed swap
  takes as its `priceLimit` and `maxAvgPrice`, as `sauce pools` prints a pool's. Buying WETH with USDC
  at 2700 that is `2700000000`.
- `minAvgPrice`: the other way round, bought base units per paid base unit, times 1e18, rounded up,
  for a single swap's check `out * 1e18 >= minAvgPrice * spent`. It is never a `maxAvgPrice`.

Either check passes no worse an average than the price. A token is a symbol the chain registers, or
`0x…:<decimals>`, or the address alone: its decimals and symbol are read from the token
(`readFromChain` in `--json`). `--sqrt-price-x96` reads a pool's price back, and `--pool <address>`
reads it from that pool of the pair now (`pool` in `--json`): a Uniswap V3, PancakeSwap V3 or
Aerodrome Slipstream pool, named by its venue where the registry's factory made it. The conversion
is the package's `sqrtPriceX96FromPrice` and `priceFromSqrtPriceX96`, which a TypeScript program
imports from the root; with `--offline`, nothing reaches a network.

### `sauce pools` in detail

```sh
sauce pools --chain base USDC 0x<token> --json
sauce pools --chain base WETH USDC --v4-key 50:1
sauce pools --chain base USDC SPCXc --block 36120411   # at one block
```

It reads Uniswap V3 and PancakeSwap V3 at each fee tier their factory enables (the tiers tried are
0.01%, 0.02%, 0.03%, 0.04%, 0.05%, 0.25%, 0.3% and 1%), Aerodrome Slipstream at each tick spacing
each of its CLFactories enables, and hookless Uniswap V4 pools at the keys `100:1`, `500:10`,
`3000:60` and `10000:200`, and any `--v4-key <fee>:<tickSpacing>`. A token is a symbol the chain
registers, a tokenized stock's included (`SPCXc`, in any case), or an address the registry does not
know, whose decimals and symbol are read from the token (or given, `0x…:8`). It reads everything in
five rounds, each a few `eth_call`s carrying up to 32 reads apiece (Multicall3's `aggregate3`, sent
deployless, so it needs nothing deployed), all at one block: `--block <number | latest | safe |
finalized>`, or the latest when it starts. It names that block (`block` in `--json`).

Pools with liquidity at their price come first, deepest first, by that liquidity (`sortedBy` in
`--json`), which is in the same units at every venue for one pair. For each:

- the venue, the contract a program finds it through as the program names it
  (`AerodromeSlipstream.CLFactoryGaugesV3`), and the pool's address; for a V4 pool, its id and key;
- its fee, read from the pool: Slipstream's is set per pool; a V4 pool's LP fee and its protocol fee,
  which is charged on top and differs by direction, from StateView;
- tick spacing, liquidity, tick and `sqrtPriceX96`;
- both directions, paying the first token for the second and then the reverse: what one token costs
  in the other at the pool's price (`mid`) and with the fee (`taker`), in whole tokens,
  decimals-aware; that taker price as the distributed swap's `priceLimit` (the paid token's base units
  per bought base unit, times 1e18, so 150 USDC for an 8-decimal token is `1500000000000000000`),
  the pool trading only to a `priceLimit` above it; and `depth1Pct`, how much of the paid token, fee
  included, moves the pool's price 1% against the taker, walked through its initialized ticks.

Then the pools with no liquidity at their price, or none at all, listed apart as skipped (`empty`): a
swap passes them by. Last, what was looked at (`checked`): the tiers each factory enables, the tick
spacings each Slipstream factory enables, and the V4 keys tried, with any venue that could not be
read. A pool that answers wrongly is left out with a note on stderr.

On Solana, `sauce pools --chain solana USDC WSOL` finds the pair's pools with `getProgramAccounts` on
the program of each venue whose swap stops at a price limit: Raydium CLMM, PancakeSwap CLMM, Byreal
and Stabble CLMM, Orca Whirlpools and Cropper, DefiTuna, Crema, and Phoenix's markets. A Solana
program takes its pools as accounts, so beside each pool's fee, liquidity and price both ways
(`sides`, as above) it gives `slots`: by the token paid, the nine accounts
[the distributed swap on Solana](solana-distributed-swap.md) takes for the pool (its program, the
pool, its config, its two vaults, one more account its swap takes, and the three tick arrays its walk
crosses that way, each unused one the System program). A pool the distributed swap skips (no
liquidity, swaps switched off, a fee that is more than one rate, paused, a market not open for
taking) is listed under `skipped` with why. `--pay <token>` chooses the pools a distributed swap
paying that token takes: the deepest whose price with the fee is within `--max-price`, one a venue
with `--per-venue`, as many as `--slots` (4). It prints them as `chosen`, in slot order as
`poolArgs`, ready for the program's `--args` (the System program for a slot with none), and as
`accounts`, the slots' accounts as `--accounts` takes them. A venue that could not be read leaves the listing partial: a note says which, and the
command exits 1. `--block` and `--v4-key` are EVM's.

### `sauce inspect` in detail

- A `Pot.cook`: the engine (and whether it is the released one) and the program: its size, hash, and
  every intent it opens, with the route's calls, the reward, the intent hash, the vault the reward is
  escrowed in, and how the program funds it (`fundVia`: paid into the vault then `publish`, or
  `publishAndFund`).
- With `--source <file>`: whether the program is that file's, and the arguments the cook appends,
  decoded against its `main`.
- A `Kitchen.deployPot` (the Pot it makes), a `Portal.publish` or `publishAndFund` (the route, the
  reward, and the intent's vault, the address a funder's `transfer` pays), an ERC-20 call, or bare
  program bytes.
- A 32-byte hash with `--chain`: the transaction, fetched: its status, sender, value and call, what
  it cost (gas, an OP-stack chain's L1 data fee, the value), and the token transfers, approvals and
  net balance changes its receipt's logs record.
- A file: the program it compiles to, and its intents, with every value it measures at run time
  named (`reward: <amount> of 0x…`).

An intent whose values the program measures at run time is only partly readable from the bytes: its
destination, and that the rest is filled in on chain. There is no opcode listing or disassembly:
programs are reported by what they are and what they open.

### `sauce verify` in detail

It checks a settle payload, a `Pot.cook`, a `Portal.publish[AndFund]` (its route's calls) or a
transaction with the SDK's `validateSettleProgram`. `--pin <keccak256>:<length>` also accepts a
historical settle program: `sauce verify 0x<tx hash> --chain base --pin 0x…:435`. A cook must name
the released engine, or one you name with `--engine <address>`: the right bytes on another
interpreter are another computation. A transaction must have succeeded: one that reverted, or has
no receipt yet, settled nothing. A rejection exits 1 with its code: the SDK's `SettleFailureCode`
(`PROGRAM_HASH`, `TOKENS_OFFSET`, …), or `UNKNOWN_ENGINE`, `NO_SETTLE` for an intent without a settle
cook, `TX_FAILED` or `TX_PENDING`. On Solana it checks the engine invocation a settle cook made
([Solana](cli-solana.md#verifying-a-settle-on-solana)).

# `@sauce/router` on Solana

**Reference** · [Documentation](../README.md) · [`@sauce/router`](router.md) · [How Sauce runs on Solana](../concepts/solana-model.md)

> On Solana, `@sauce/router` is a different set of swap functions: one per Solana venue, each taking
> the venue's accounts, an amount and a floor, and returning what arrived. Most programs never call
> them by name, because a venue's namespace (`Orca.Whirlpool.swap(...)`) compiles to them. This page
> lists every function, the accounts each takes, and what each refuses.

This page is for a program or a code generator that calls a Solana venue's function itself. It
assumes the EVM [`@sauce/router`](router.md) page's ideas (an exact input, a floor, a recipient)
and Solana's account model ([How Sauce runs on Solana](../concepts/solana-model.md)). To swap by
name instead, see [venues by namespace](../guides/solana.md#venues-by-namespace).

Solana's venues come in two kinds. Those whose swap takes a price limit, which stops the swap and
leaves the rest of the input, are under [Swaps at a price](#swaps-at-a-price). Those that take the
whole input or fail are under [Exact input](#exact-input). No function is in both the EVM and the
Solana arm, so importing one the target lacks fails at its import, naming it.

## Swaps at a price

A program needs none of these functions directly: the venue's namespace,
`Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, minOut)`,
compiles to that venue's `orcaWhirlpool` below, with the slot and the trader added to `main` and
derived when the cook is built
([Solana: venues by namespace](../guides/solana.md#venues-by-namespace)).

On Solana `@sauce/router` swaps at the venues whose swap takes a price limit that stops it and
leaves the rest of the input, the venues of [the distributed swap on Solana](../guides/solana-distributed-swap.md),
and at Manifest's book. Each venue's swap comes in four forms:

| Form                                      | Takes                                                     | Returns                      |
| ----------------------------------------- | --------------------------------------------------------- | ---------------------------- |
| at a price: `<venue>`                     | `(slot, trader, amountIn, priceLimit, minOut, recipient)` | what the recipient received  |
| at the pool's own limit: `<venue>AtLimit` | `(slot, trader, amountIn, limit, minOut, recipient)`      | what the recipient received  |
| the instruction alone: `<venue>Cpi`       | `(program, accounts, source, amountIn, limit, …)`         | what the paying account paid |
| the instruction's data: `<venue>Data`     | `(amountIn, limit, …)`                                    | the data, to send yourself   |

The first two return `0`, having moved nothing, where the pool cannot trade (below). Every form
sends the same instruction for the same amount, limit and floor, Orca's excepted: at a price every
pool's swap is `swap_v2`, and at its own limit a pool of two SPL Token mints takes the classic
`swap`. The `…AtLimit` forms build it with the venue's `…Data`. The forms at a price write it
themselves and check none of its fields: their floor is 0 and their limit fits its field, so no
check of `…Data`'s could fail there, and every program swapping at a price would carry them. `…Cpi`
writes the same bytes itself too, because a call into `…Data` would cost it about 2k compute units
(Phoenix's excepted, which is cheaper through `phoenixData`).

| Venue            | Program                                        | At a price        | At its own limit         | Its instruction      | Its data                                   |
| ---------------- | ---------------------------------------------- | ----------------- | ------------------------ | -------------------- | ------------------------------------------ |
| Raydium CLMM     | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `raydiumClmm`     | `raydiumClmmAtLimit`     | `raydiumClmmCpi`     | `raydiumClmmData`                          |
| PancakeSwap CLMM | `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq` | `pancakeswapClmm` | `pancakeswapClmmAtLimit` | `pancakeswapClmmCpi` | `pancakeswapClmmData`                      |
| Byreal           | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`  | `byreal`          | `byrealAtLimit`          | `byrealCpi`          | `byrealData`                               |
| Stabble CLMM     | `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6` | `stabbleClmm`     | `stabbleClmmAtLimit`     | `stabbleClmmCpi`     | `stabbleClmmData`                          |
| Orca Whirlpools  | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  | `orcaWhirlpool`   | `orcaWhirlpoolAtLimit`   | `orcaWhirlpoolCpi`   | `orcaWhirlpoolData`, `orcaWhirlpoolV2Data` |
| Cropper          | `H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt` | `cropper`         | `cropperAtLimit`         | `cropperCpi`         | `cropperData`                              |
| DefiTuna         | `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`  | `defituna`        | `defitunaAtLimit`        | `defitunaCpi`        | `defitunaData`                             |
| Crema            | `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR` | `crema`           | `cremaAtLimit`           | `cremaCpi`           | `cremaData`                                |
| Phoenix          | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`  | `phoenix`         | `phoenixAtLimit`         | `phoenixCpi`         | `phoenixData`                              |
| Invariant        | `HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt` |                   | `invariantAtLimit`       | `invariantCpi`       | `invariantData`                            |
| OpenBook v2      | `opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb`  |                   | `openbookV2AtLimit`      | `openbookV2Cpi`      | `openbookV2Data`, `openbookV2LotsData`     |
| Manifest         | `MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms`  |                   | `manifest` (no limit)    | `manifestCpi`        | `manifestData`                             |

The programs in the table are mainnet's. A venue's program is its cluster's: the library writes
none, and each function's guard reads its venue's from a define the compile supplies. The SDK's
compiles for a Solana chain supply them for its cluster; a raw `compile()` of the Solana arm passes
`svmRouterDefines(cluster)` from `@eco-incorp/sauce/svm` (`"mainnet-beta"` or `"devnet"`) as its
`defines`, and fails, naming the define, without them. For a venue the cluster lacks the define is
an address no program can be deployed at, so a swap there reverts as one at another venue's pool
does. [Solana Devnet](../reference/chains/solana-devnet.md) lists devnet's venues and programs.

### Arguments

The forms at a price take:

```text
orcaWhirlpool(slot: Account[], trader: Account[], amountIn, priceLimit, minOut, recipient: Account): Uint256
```

- **`slot`** is the pool's accounts, the System program for any the venue does not take:
  `[program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2]`.
  [`sauce pools`](../guides/cli-lookup.md#a-pairs-pools-sauce-pools) prints each pool's slot for the direction paid. Some
  venues take accounts past the nine: at its own limit, a Raydium-layout pool (Raydium CLMM,
  PancakeSwap CLMM, Byreal, Stabble CLMM) its tick-array bitmap extension tenth, which its swap reads
  past the pool's default range (a slot of nine sends none). At a price, a pool priced past that
  range carries the extension in its first tick-array place instead, where its swap finds it by key;
  Invariant its program's authority tenth (its `config` is the
  program's state, `extra` the pool's tickmap, its ticks the tick accounts the swap may cross);
  OpenBook v2 its two oracles, the program itself for one the market has not (its `config` is the
  market's authority, `extra` its event heap, its ticks its bids, asks and the System program);
  Manifest's `config` is the System program, which its swap takes. An Orca pool's `extra`, its oracle, must be writable at a price, where its swap is `swap_v2`, which declares it writable whatever the fee, and at its own limit for an adaptive fee and for a pool with a Token-2022 mint. Crema refuses a tick array its
  map does not mark and Invariant takes only the ticks it crosses, so each is passed the slot's first
  tick array and each after it until a System program.
- **`trader`** is `[authority, source, payMint, buyMint, tokenProgram, token2022, memo]`: the
  authority that signs (the Pot, through the Kitchen), the token account paid from, the two mints,
  the SPL Token and Token-2022 programs and the memo program. Both are arrays because a function
  other than `main` keeps at most about sixteen values in use at once. Manifest and OpenBook take the
  authority as their payer, so for them it must be writable.
- **`amountIn`** is the most the pool may take. The rest of it stays in `source`.
- **`priceLimit`** is the most one unit bought may cost, fee included: payToken base units per
  buyToken base unit, times 1e18. The function reads the pool's fee and gives the pool its own
  limit, so its last unit, fee paid, costs `priceLimit`: a concentrated-liquidity pool's sqrt price
  limit moved by `√(1 − fee)`, a Phoenix order's price `priceLimit ÷ (1 + fee)` in ticks.
- **`limit`** is the pool's own: the sqrt price its swap takes as the pool keeps it (a Q64.64 root;
  on Invariant a root times 10^24), Phoenix's order price in its market's ticks, OpenBook's in its
  lots (`priceLots`, then `orders`, the most resting orders it may match). No fee is read for it, so
  whatever fee the pool charges stays inside it: an adaptive-fee whirlpool and a Byreal pool with
  fees of its own trade at a limit, and a limit computed to keep a walk inside the tick arrays a slot
  carries keeps it there however the fee moves. `0` is no limit: the program's own bound on Raydium's
  code, Orca and DefiTuna, an order at any price on Phoenix and OpenBook, and on Invariant only selling
  token X. Cropper's and Crema's programs take no `0`; give them their own bound. Invariant's
  program does not stop at its limit: a swap that reaches it with input left is refused (custom
  error `0x1778`), and the whole transaction with it, so there `amountIn` must fit inside the limit.
- **`minOut`** is the least a swap that ran may deliver; below it the whole program reverts. At a
  pool's own limit it rides in the venue's own least-out field where the instruction has one
  (Raydium's code and the whirlpools' `other_amount_threshold`, Crema's `amount_limit`, Manifest's
  `out_atoms`), so the venue refuses a swap below it itself; Phoenix's, Invariant's and OpenBook's
  recipient balance is held to it.
- **`recipient`** is the token account the output lands in; Crema and Phoenix pay only into the
  authority's own.

### The Stopped form

Each of the eight concentrated-liquidity functions also has a Stopped form, the same swap with its
limit held to a `stop` as well. The stop's low 192 bits are a tighter `priceLimit`, and the swap
takes the lower of the two (`0` none). Bits 192 to 223 carry a start bound, a tick: the swap skips
the pool if its price has moved further than that from the stop. A bound past every tick the walk's
way skips the pool whatever its price: `1` paying the pool's lower-key token, `2^32 - 1` paying the
other.

On Raydium's code and Crema, bits 224 to 255 carry a deep tick (`0` none). Their swap at a price
stops where the furthest tick array its slot gives begins, because past that array's last
initialized tick their program fails the whole transaction. A deep tick is that last initialized
tick that way, which the `sauce` command reads from the array; the swap then walks on into the
array, to a tick inside it. The Stopped form reads the tick where the command read it, in a fixed
array (Raydium's code), a dynamic one (Byreal's) or Crema's, and checks it there. A tick no longer
initialized leaves the swap where it would have stopped. A place that holds another tick reverts
(`deep: the tick array is not laid out as Raydium's`, or `Crema's`), and so does a tick no array
of the slot holds. A tick is read as the window reads ticks, its sign bit flipped.

```text
orcaWhirlpoolStopped(slot: Account[], trader: Account[], amountIn, priceLimit, minOut, recipient: Account, stop): Uint256
```

A program written with the venue namespaces (`Orca.Whirlpool.swap(…)`) is compiled to it only for a
pool whose stop binds or walks on, as the `sauce` command works the stops out (see
[compute](../concepts/solana-model.md#compute)); every other swap is the plain function, so a
program no stop binds is the same program, byte for byte.

### What reverts and what is skipped

Each venue's function requires the slot's program to be its venue's and the pool's owner before it
reads the pool, because the authority signs the swap. These are the caller's accounts, so each
reverts rather than skips: a slot naming another program, a pool of another venue or of none
(`not a Crema pool`, …), a pool that is not the pair, and a limit an order cannot
carry (a sqrt price limit past its 128 bits, which cut to its field would be no limit at all; Phoenix's past 64 bits, OpenBook's past 63 or `orders` past 255). Only the System program
itself as the pool is a missing slot, which is skipped.

A failed call into another program fails the whole Solana transaction and cannot be caught, so a
function that takes a slot checks before anything moves and returns `0`, having moved nothing, for a
missing slot (the System program as its pool), no input, a pool whose swaps are off, a paused pool
or a market not open for taking, a pool with no liquidity at its price, a pool already at or past
its limit, an input too small to buy one unit at the pool's price after its fee (judged at a limit
by the pool's base fee), an input smaller than one of a market's lots, and, at a price, a fee that
is more than one rate (a dynamic or adaptive fee, or a Byreal pool's own) and a market limit too
large for an order's 64-bit price. The price only worsens as a pool sells, so the estimate is the
most the input could buy: dust an earlier pool left (an atom, which the fee takes whole) is skipped,
never handed to a venue that would keep it or refuse it. A Phoenix or OpenBook order whose book has
no offer within its price is placed and fills nothing, so it returns `0` too, nothing having moved.
A swap at a price also never walks past the tick arrays its slot gives it, where the venue's program
would fail the transaction: its limit is held a tick inside them, so a `priceLimit` far past the
pool's price buys up to the last of them and stops. A swap that ran returns at least 1, held to
`minOut` and at least 1, and reverts below it. A failure
the checks do not foresee, such as a tick array missing from the slot or an Invariant input past its
limit, fails the transaction.

### Example

```js
import { orcaWhirlpool } from "@sauce/router";

// One Orca pool: up to amountIn of payMint for buyMint, never more than priceLimit a unit with the
// fee, and at least minOut, else the whole transaction reverts.
function main(
  program: Account,
  pool: Account<Writable>,
  config: Account,
  vaultA: Account<Writable>,
  vaultB: Account<Writable>,
  extra: Account<Writable>,
  ticks0: Account<Writable>,
  ticks1: Account<Writable>,
  ticks2: Account<Writable>,
  authority: Account<Signer>,
  source: Account<Writable>,
  payMint: Account,
  buyMint: Account,
  tokenProgram: Account,
  token2022: Account,
  memo: Account,
  output: Account<Writable>,
  amountIn: Uint256,
  priceLimit: Uint256,
  minOut: Uint256,
): Uint256 {
  const slot = [program, pool, config, vaultA, vaultB, extra, ticks0, ticks1, ticks2];
  const trader = [authority, source, payMint, buyMint, tokenProgram, token2022, memo];
  return orcaWhirlpool(slot, trader, amountIn, priceLimit, minOut, output);
}
```

How the `sauce` command chooses each pool's stop, and why, is in
[How Sauce runs on Solana](../concepts/solana-model.md#compute).

### The instruction alone

`<venue>Cpi` is a venue's swap instruction and nothing around it: it takes the accounts in the
venue's own order, the paying account beside them, what the instruction carries and, where its
accounts do not say it, its direction. It checks the program, reads the paying account before and
after, and returns what that account paid, reverting (`debit`) if the venue took more than
`amountIn`. The instruction is the one a caller would build by hand, byte for byte; an amount of `0`
is the venue's to refuse, so skip the call.

`<venue>Data` is that instruction's data alone, for a program that sends it with `svm.call` itself:
it takes what the instruction carries and its direction, checks only that each field can carry its
value (a floor past 64 bits, a sqrt price limit past 128 bits, Phoenix's limit past 64 bits, OpenBook's price or lots past 63 or `orders` past
255 revert), and returns the bytes. The program names the venue's program and reads whatever
balances it wants. It is the cheapest form: an account list passed to a function, as `…Cpi` takes it,
is built as an array first, and one written into `svm.call` is not.

| Function                                                              | After `program, accounts, source`       | `…Data` takes                                                                                                                        | `accounts`, in order                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raydiumClmmCpi`, `pancakeswapClmmCpi`, `byrealCpi`, `stabbleClmmCpi` | `amountIn, limit, minOut`               | `amountIn, limit, minOut`                                                                                                            | the authority, the `AmmConfig`, the pool, the paying and receiving token accounts, the input and output vault, the observation account, SPL Token, Token-2022, the memo program, the input and output mint, then the bitmap extension (if any) and the tick arrays                                |
| `orcaWhirlpoolCpi`                                                    | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB` (`swap`'s, and `swap_v2`'s)                                                                          | for `swap` (both mints SPL Token's): SPL Token, the authority, the pool, token A's account and vault, token B's, three tick arrays, the oracle; for `swap_v2`: token A's and B's token programs, the memo program, the authority, the pool, mint A, mint B, then as `swap` from token A's account |
| `cropperCpi`                                                          | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB`                                                                                                      | as a whirlpool's `swap`                                                                                                                                                                                                                                                                           |
| `defitunaCpi`                                                         | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB`                                                                                                      | token A's and B's token programs, the memo program, the authority, the pool, mint A, mint B, token A's and B's accounts, vault A, vault B, three tick arrays                                                                                                                                      |
| `cremaCpi`                                                            | `amountIn, limit, minOut, aToB`         | `amountIn, limit, minOut, aToB`                                                                                                      | the `clmm_config`, the pool, mint A, mint B, token A's and B's accounts, vault A, vault B, the tick-array map, the authority, SPL Token, the marked tick arrays                                                                                                                                   |
| `phoenixCpi`                                                          | `amountIn, ticks, paysBase`             | `amountIn, lot, ticks, orders, paysBase`                                                                                             | the program, the log authority, the market, the authority, the base and quote token accounts, the base and quote vaults, SPL Token                                                                                                                                                                |
| `invariantCpi`                                                        | `amountIn, limit, xToY`                 | `amountIn, limit, xToY`                                                                                                              | the program's state, the pool, its tickmap, the X and Y token accounts, the X and Y reserves, the authority, the program's authority, SPL Token, the ticks it may cross                                                                                                                           |
| `manifestCpi`                                                         | `amountIn, minOut, paysBase`            | `amountIn, minOut, paysBase`                                                                                                         | the authority, the market, the System program, the base and quote token accounts, the base and quote vaults, the base token program, the base mint, the quote token program, the quote mint                                                                                                       |
| `openbookV2Cpi`                                                       | `amountIn, priceLots, orders, paysBase` | `amountIn, baseLot, quoteLot, priceLots, orders, paysBase`; `openbookV2LotsData`: `baseLots, quoteLots, priceLots, orders, paysBase` | the authority twice (signer and penalty payer), the market, its authority, bids, asks, the base and quote vaults, the event heap, the base and quote token accounts, the two oracles, SPL Token, the System program, the program                                                                  |

`minOut` rides in the venue's floor; Phoenix's, Invariant's and OpenBook's instructions carry none,
and their `…Cpi` and `…Data` take none. Phoenix and OpenBook size the order in their market's lots:
`…Cpi` reads them from the market, the instruction's third account, and `…Data` takes them (`lot`,
the paid token's lot size on Phoenix; `baseLot` and `quoteLot` on OpenBook). `openbookV2LotsData`
takes the order in lots, divided already, for a program that knows the market's lot sizes when it
compiles: the side paid bounds the order, so give the other side its most, `0x7fffffffffffffff` over
its lot size. An input under one lot is no order: `phoenixCpi` returns `0` for it, and a caller of
`phoenixData` skips it. `phoenixData`'s `orders` is the most resting orders the order may match (`0`:
no limit; the expired orders it removes on the way count too): past it matching stops, and the input
left is not taken, as OpenBook's `orders` does.

### Reading both amounts

`<venue>` and `<venue>AtLimit` return what the recipient received, and `…Cpi` what the paying
account paid, each one number. A program that wants both reads the other itself:

```js
import { defitunaCpi } from "@sauce/router";

// A DefiTuna swap at a sqrt price limit computed beforehand, A to B: what source paid, through
// defitunaCpi, and what output received, read around it. accounts is the instruction's own list.
function main(
  program: Account,
  tokenProgramA: Account,
  tokenProgramB: Account,
  memo: Account,
  authority: Account<Signer>,
  pool: Account<Writable>,
  mintA: Account,
  mintB: Account,
  source: Account<Writable>,
  output: Account<Writable>,
  vaultA: Account<Writable>,
  vaultB: Account<Writable>,
  ticks0: Account<Writable>,
  ticks1: Account<Writable>,
  ticks2: Account<Writable>,
  amountIn: Uint256,
  sqrtLimitX64: Uint256,
  minOut: Uint256,
): Uint256 {
  const accounts = [
    tokenProgramA, tokenProgramB, memo, authority, pool, mintA, mintB, source, output, vaultA,
    vaultB, ticks0, ticks1, ticks2,
  ];
  const before = svm.sload(output, 64, 8).toLe();
  const spent = defitunaCpi(program, accounts, source, amountIn, sqrtLimitX64, minOut, true);
  const received = svm.sload(output, 64, 8).toLe() - before;
  return (spent << 128) | received;
}
```

With `…Data`, the same swap reads both itself, and costs a few thousand compute units less:

```js
import { defitunaData } from "@sauce/router";

function main(
  program: Account,
  tokenProgramA: Account,
  tokenProgramB: Account,
  memo: Account,
  authority: Account<Signer>,
  pool: Account<Writable>,
  mintA: Account,
  mintB: Account,
  source: Account<Writable>,
  output: Account<Writable>,
  vaultA: Account<Writable>,
  vaultB: Account<Writable>,
  ticks0: Account<Writable>,
  ticks1: Account<Writable>,
  ticks2: Account<Writable>,
  amountIn: Uint256,
  sqrtLimitX64: Uint256,
  minOut: Uint256,
): Uint256 {
  const data = defitunaData(amountIn, sqrtLimitX64, minOut, true);
  const held = svm.sload(source, 64, 8).toLe();
  const before = svm.sload(output, 64, 8).toLe();
  svm.call(
    program,
    [tokenProgramA, tokenProgramB, memo, authority, pool, mintA, mintB, source, output, vaultA,
     vaultB, ticks0, ticks1, ticks2],
    data,
  );
  const spent = held - svm.sload(source, 64, 8).toLe();
  require(spent <= amountIn, "debit");
  return (spent << 128) | (svm.sload(output, 64, 8).toLe() - before);
}
```

### Accounts and data from TypeScript

A program compiled for one trade knows the venue's accounts before it runs. The SDK names them in
the order each instruction takes them, so a code generator need not keep its own copy of that order:
`routerSvmAccountOrder(venue, options)` from `@eco-incorp/sauce/svm` lists each account's name and
whether the instruction writes it and it signs, and `routerSvmAccounts(venue, options, refs)` builds
the list from a value for each name (an address, or whatever reference the generator resolves
later). `options` is the direction (`aToB`: the pool's first token is paid — token 0 or A,
Invariant's X, a market's base) and, where the venue takes them, Orca's `swap_v2` (`v2`, whose
oracle is always writable), an adaptive-fee whirlpool, whose classic `swap` writes its oracle too
(`adaptive`), a Raydium-layout pool's bitmap
extension (`bitmapExtension`), and how many tick arrays Crema, or ticks Invariant, takes
(`tickArrays`). `ROUTER_SVM_VENUES` gives each venue's program and its `…Data` and `…Cpi` functions.

```ts
import { routerSvmAccounts, ROUTER_SVM_VENUES } from "@eco-incorp/sauce/svm";

const accounts = routerSvmAccounts(
  "defituna",
  { aToB: true },
  {
    tokenProgramA: TOKEN_PROGRAM,
    tokenProgramB: TOKEN_PROGRAM,
    memo: MEMO_PROGRAM,
    authority: pot,
    pool,
    mintA: SOL,
    mintB: USDC,
    source,
    recipient,
    vaultA,
    vaultB,
    tickArray0,
    tickArray1,
    tickArray2,
  },
);
// [{ name: "tokenProgramA", ref: …, writable: false, signer: false }, …], in the instruction's order
const program = ROUTER_SVM_VENUES.defituna.program;
```

The data, too, can be written when the program is generated. The checks `<venue>Data` makes on every
swap (a floor past 64 bits, a sqrt price limit past 128, a book's price or order count past its
field) cost a few hundred compute units each, and the compiler does not fold them away for a literal
argument: a program passing its limit as a literal still runs them. `routerSvmDataTemplate(venue,
options)` makes them once, in TypeScript, throwing for a field past its slot, and returns the bytes
around the amount, so the program writes `prefix ‖ u64le(amountIn ÷ divisor) ‖ suffix` and pays
nothing for the encoding beyond the concatenation. Its bytes are `<venue>Data`'s for the same
fields; its options are the account order's direction and Orca's `v2`, then the fields the venue's
instruction carries (`limit`, `minOut`; Phoenix `ticks` and the paid token's `lot`; OpenBook
`priceLots`, `orders`, `baseLot` and `quoteLot`).

```ts
import { routerSvmDataTemplate } from "@eco-incorp/sauce/svm";

const { prefix, suffix, divisor } = routerSvmDataTemplate("defituna", {
  aToB: true,
  limit: sqrtLimitX64,
  minOut,
});
// The program: prefix.concat((amountIn / divisor).toBytesLe(8), suffix), prefix and suffix as hex
// literals.
```

### Size and compute

A program carries the venues it calls and no other: one venue's function at a price or at a limit
is about 0.9 to 1.7 KB of program, its instruction alone about 0.4 to 0.5 KB, its data alone about
0.2 to 0.4 KB. Past one transaction a program is staged in a code buffer, as `sauce run` does.
[The distributed swap on Solana](../guides/solana-distributed-swap.md) is one venue call per pool
its keys find, each compiled to that venue's function.

Reading an account out of an array is among the dearest steps in a program, so a form that takes a
slot pays for every account it lays out; `…Cpi` and `…Data` read none, and `…Data` does not even
build its accounts into an array. Over a cook that sends the same instruction written by hand,
`…Data` adds about 3,000 to 4,000 compute units (6,000 to 12,000 for Phoenix's and OpenBook's
data: Phoenix's divides the input by its lot size, and OpenBook's word has six fields), `…Cpi`
about 6,500 to 10,000 (14,000 to 18,000 for those two), `…AtLimit` about 55,000 to 97,000, and the form at a price
about 90,000 to 113,000. `…Data`'s units are its fields' packing and checks: the floor's 64-bit check
and the limit's 128-bit one (about 600 units each), the direction, one `toBytesLe`. `…Cpi` adds the
program's check, building its account list into an array, and the call. `openbookV2LotsData`, its
lots divided when the program is compiled, costs about a third less than `openbookV2Data`.
`routerSvmDataTemplate`'s bytes add nothing: they are the hand-written instruction's.
`<venue>` and `…AtLimit` pay for reading the slot: the pool's owner, its state for the skips, and
every account they lay out.

Stabble CLMM runs Raydium's code and its forms cost what Raydium's do. The forms' cost does not grow
with the ticks a swap crosses; the venue's does, as [compute](../concepts/solana-model.md#compute)
explains.

## Exact input

The Solana arm's other functions swap exactly `amountIn` at one pool, with no price limit: the venue
takes the whole input, or the transaction fails. Each venue has three functions:

```text
raydiumCpSwap(slot: Account[], trader: Account[], amountIn, minOut, recipient: Account): Uint256
raydiumCpSwapCpi(program: Account, accounts: Account[], source: Account, amountIn, minOut): Uint256
raydiumCpSwapData(amountIn, minOut): bytes
```

- **`<venue>Data`** is the venue's instruction data, and nothing else. The caller sends it itself,
  `svm.call(program, [accounts…], raydiumCpSwapData(amountIn, minOut))`, and reads what it wants.
  It is the cheapest form, and the one a program compiled for one trade should use.
- **`<venue>Cpi`** sends that data on `accounts`, the instruction's own accounts in the venue's
  order. It checks only the program, reads only `source`, and returns what `source` paid.
- **`<venue>`** swaps on a slot and returns what the recipient received, held to `minOut` and at
  least 1. It reverts below that. It first checks what it can see before the swap: it returns `0`,
  having moved nothing, for a missing slot (the System program as its pool), no input, and each
  refusal of the venue's listed below.

### Floors and direction

`minOut` in `…Data` and `…Cpi` is the venue's own least out, written as given; a venue whose swap
carries none takes no `minOut` there (Bonkswap, Guacswap, the Saber decimal wrapper, M0's swap, and
the staking and vault venues but Helium's treasury). Where the data says the direction, they take it
as their last argument: `aToB` paying the pool's first token (token 0 or A, the decimal wrapper's
underlying token, Scale AMM's buy), `paysBase` the base token (Aldrin, MetaDAO futarchy, PumpSwap's
sell), `xToY` token X (Bonkswap, Guacswap). At the staking and vault venues that swap both ways,
`aToB` is the stake or deposit, and a venue that swaps one way takes no direction. Perena's take the
two tokens' indices among the pool's ten, `perenaData(amountIn, inIndex, outIndex, minOut)`, and
Sanctum Infinity's each token's calculator's account count and its index in the pool's list,
`sanctumInfinityData(amountIn, inCalcAccounts, outCalcAccounts, inIndex, outIndex, minOut)`. A
`minOut` past 64 bits, a Perena index past its byte, a Deriverse instrument id past 32 bits, or a
Sanctum Infinity count past its byte or index past 32 bits reverts; `amountIn` is written as its low
64 bits.

### Account order and data from TypeScript

**The account order is the SDK's.** `@eco-incorp/sauce/svm`'s `routerSvmAccountOrder(venue,
{ aToB })` names each account of a venue's swap in order, with whether the instruction writes it and
whether it signs, and `routerSvmAccounts(venue, { aToB }, refs)` builds the list from a value for
each name, an address or a placeholder a code generator resolves later. `ROUTER_SVM_VENUES` keys
the venues by slug (`raydium-cp-swap`, `meteora-damm-v1-cp`, …) and gives each one's
program and its `…Data` and `…Cpi` functions. Names are the pool's: `vaultA`, `mintA` and
`tokenProgramA` are the pool's first token's whatever the direction; `source` is the paying token
account, `recipient` the one the output lands in, `authority` the account that signs (the Pot).
PumpSwap takes `poolV2` for a pool with a coin creator, and Scale AMM `beneficiaries`, the number
of its fee beneficiaries.

**So is the data.** `routerSvmDataTemplate(venue, options)` writes an exact-input venue's data
around the amount when the program is generated, as it does a limit venue's: `prefix ‖
u64le(amountIn) ‖ suffix`, its divisor 1, the bytes `<venue>Data` writes for the same fields. Its
options are the account order's `aToB`, `minOut` where the swap carries a floor, Perena's `inIndex`
and `outIndex`, Deriverse's `instrId`, Sanctum Infinity's `inCalcAccounts`, `outCalcAccounts`,
`inIndex` and `outIndex`, and Archer's `baseLot`, the divisor when it sells the base token. It
throws a RangeError for a floor past 64 bits, an index past its field or an instrument id past 32
bits, and refuses an option the venue's swap does not carry and the way a one-way venue does not
swap, as its account order does. The program pays nothing for the encoding: those bytes cost what data written by hand does.

### Slots

`trader` and `recipient` are the same as the limit functions take, `[authority, source, payMint,
buyMint, tokenProgram, token2022, memo]`, with the recipient the token account the output lands in.
`slot` is the venue's own accounts: its program first, the pool second, then the rest in the
venue's order below. Where a pool keeps an account per token, such as its two vaults, the slot
carries both in the **pool's** order. The function works out which one is paid from `payMint`, so
one slot serves both directions. Each token's program is the one that owns its mint.

| Functions              | Venue                 | Program                                        | Slot after `[program, pool]`                                                                                                         |
| ---------------------- | --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `raydiumCpSwap`        | Raydium CP-Swap       | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | `authority, ammConfig, vault0, vault1, observation`                                                                                  |
| `gamma`                | Gamma                 | `GAMMA7meSFWaBXF25oSUgmGRwaW6sCMFLmBNiMSdbHVT` | `authority, ammConfig, vault0, vault1, observation`                                                                                  |
| `raydiumAmmV4`         | Raydium AMM v4        | `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | `authority, coinVault, pcVault`                                                                                                      |
| `orcaLegacyTokenSwap`  | Orca legacy pools     | `9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `tokenSwapV1`          | SPL Token Swap        | `SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8`  | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `orcaV1`               | Orca v1               | `DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `penguin`              | Penguin               | `PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP`  | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `stepn`                | STEPN (Dooar)         | `Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `saros`                | Saros                 | `SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr`  | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `fluxbeam`             | Fluxbeam              | `FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `dexlab`               | Dexlab                | `DSwpgjMvXhtGn6BsbqmacdBZyfLj6jSWf3HJpdJtmg6N` | `authority, vaultA, vaultB, poolMint, poolFeeAccount`                                                                                |
| `meteoraDammV2`        | Meteora DAMM v2       | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`  | `authority, vaultA, vaultB, eventAuthority`                                                                                          |
| `meteoraDammV1`        | Meteora DAMM v1       | `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` | `aVault, bVault, aTokenVault, bTokenVault, aVaultLpMint, bVaultLpMint, aVaultLp, bVaultLp, protocolFeeA, protocolFeeB, vaultProgram` |
| `aldrin`               | Aldrin                | `AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6` | `poolSigner, poolMint, baseVault, quoteVault, feeAccount`                                                                            |
| `omnipair`             | Omnipair              | `omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE`  | `rateModel, futarchyAuthority, vault0, vault1, eventAuthority`                                                                       |
| `saber`                | Saber                 | `SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ`  | `authority, vaultA, vaultB, adminFeeA, adminFeeB`                                                                                    |
| `saberDecimalsWrapper` | Saber decimal wrapper | `DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB` | `wrapperMint, underlyingVault` (the wrapper as the pool)                                                                             |
| `stabbleStableSwap`    | Stabble stable swap   | `swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ`  | `withdrawAuthority, vault, vaultAuthority, vaultProgram, vaultTokenA, vaultTokenB, beneficiaryTokenA, beneficiaryTokenB`             |
| `stabbleWeightedSwap`  | Stabble weighted swap | `swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW`  | `withdrawAuthority, vault, vaultAuthority, vaultProgram, vaultTokenA, vaultTokenB, beneficiaryTokenA, beneficiaryTokenB`             |
| `mercurial`            | Mercurial             | `MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky`  | `authority, vault0, vault1` (a two-token pool; `mercurialCpi` takes any)                                                             |
| `perena`               | Perena (Numéraire)    | `NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P`  | `numeraireConfig, vaultA, vaultB` (the two tokens traded)                                                                            |
| `metadaoFutarchy`      | MetaDAO futarchy      | `FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq` | `baseVault, quoteVault, eventAuthority` (the DAO as the pool)                                                                        |
| `solfiV2`              | SolFi v2              | `SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF`  | `oracle, registry, vaultA, vaultB, instructionsSysvar`                                                                               |
| `hadron`               | Hadron                | `HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8` | `assetConfigA, assetConfigB, growingA, vaultA, vaultB, globalConfig, feeVaultA, feeVaultB, clock, metadataA`                         |
| `taurusfi`             | TaurusFi              | `9VX8EKBg6vM6tA68xaDsPkbrx26XConZjkQmhVApUptc` | `vault0, vault1, vaultAuthority, globalConfig, globalAuthority, instructionsSysvar` (the price account as the pool)                  |
| `riptide`              | Riptide               | `riptK81hDxhe5pW5jSzSM9iRA8azgEgLJ4dXkPtBS7j`  | `vaultA, vaultB, instructionsSysvar, dontFront`                                                                                      |
| `denali`               | Denali                | `DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4` | `vaultA, vaultB, oracle, globalConfig`                                                                                               |
| `gavel`                | Gavel                 | `srAMMzfVHVAtgSJc8iH6CfKzuWuUTzLHVCE81QU1rgi`  | `logAuthority, baseVault, quoteVault`                                                                                                |
| `tesserav`             | Tessera V             | `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`  | `authority, vaultA, vaultB, instructionsSysvar, config, oracle`                                                                      |
| `flint`                | Flint                 | `FLiNTXPwppyoJabCoxc2uiiRygAHpmMXajiDXo2Ub1z`  | `marketB, vaultA, vaultB, instructionsSysvar` (market A as the pool)                                                                 |
| `deriverse`            | Deriverse             | `DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD` | `assetVault, crncyVault, bidsTree, bidOrders, asksTree, askOrders, lines, maps, clientInfos` (the instrument as the pool)            |
| `goonfiV2`             | GoonFi v2             | `goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE`  | `vaultA, vaultB, oracle, globalConfig, instructionsSysvar, validator`                                                                |
| `solfiV1`              | SolFi v1              | `SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe`  | `vaultA, vaultB, instructionsSysvar`                                                                                                 |
| `meteoraDbc`           | Meteora DBC           | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`  | `poolAuthority, config, baseVault, quoteVault, eventAuthority`                                                                       |
| `trends`               | Trends                | `CURVEmPpijXDTNdqrA9PGP1io2rkgiVXH26xdXVGLLfz` | `config, poolAuthority, baseVault, quoteVault, eventAuthority`                                                                       |
| `heaven`               | Heaven                | `HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o` | `vaultA, vaultB, protocolConfig, instructionsSysvar, chainlink, solUsdFeed, associatedTokenProgram, systemProgram`                   |
| `virtuals`             | Virtuals (selling)    | `5U3EU2ubXtK84QcRjWVmYt9RaDyA8gKxdUrPFXmZyaki` | `poolTokenAccount, platform, platformVirtualsAccount, poolVirtualsAccount`                                                           |
| `meteoraDlmm`          | Meteora DLMM          | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`  | `eventAuthority, reserveX, reserveY, oracle, binArray0, binArray1, systemProgram`                                                    |

Each row names three functions: the one listed, its `Cpi` form and its `Data` form. Raydium CP-Swap
and Gamma require token 0 to be the lower-key mint. A Meteora DLMM pool's reserves are its token X's
and token Y's, the pool's own order, and its bin arrays the two its bitmap marks from the active
bin's in the trade's direction: `meteoraDlmm` lays out seventeen accounts in place, so it sends
`swap` on both (two SPL Token mints) or `swap2` on the first (a Token-2022 mint), and an input past
what they hold fails the swap. It returns `0`, having moved nothing, for a pool whose swaps are off
or not active yet; a program writes it `Meteora.DLMM.swap(pool, tokenIn, tokenOut, amountIn, minOut)`. A Stabble pool's `vaultTokenA` and `vaultTokenB`
are the vault's accounts for the two tokens traded, in either order. Each beneficiary account is the
vault beneficiary's for that token. Raydium AMM v4 and Mercurial read the direction from the paying
and receiving accounts themselves. Perena finds each mint's index among the pool's ten tokens, and
writes both mints, so they are attached writable.

### Proprietary market makers

SolFi v2, Hadron, TaurusFi, Riptide, Denali, Gavel, Tessera V, Flint, Deriverse, GoonFi v2 and SolFi
v1 are proprietary market makers: each prices off its own oracle, quote or book, which a keeper
keeps fresh, and refuses a swap on a quote gone stale. `<venue>` can't see that before the swap, so
a stale quote fails the transaction. `instructionsSysvar` is the Instructions sysvar and `clock` the
Clock sysvar. Riptide's `dontFront` is `jitodontfront111111111111111111111111111111`, and GoonFi v2's `validator`
is the vote account `J1to1yufRnoWn81KYg1XkTWzmKjnYSnmE2VY8DGUJ9Qv`. A Hadron fee vault is the fee
treasury's token account for that token. A Flint market and its vault are one per token. Tessera V
sells only its token A. SolFi v2, TaurusFi, Deriverse and GoonFi v2 write the authority, so it is
attached writable, and Deriverse requires the authority's associated token accounts. Hadron and
TaurusFi pay wrapped SOL into, and take it out of, native wrapped-SOL accounts. SolFi v1's liquidity
has moved to SolFi v2: every pool it lists holds an empty vault, which `solfiV1` skips.

### Bonding curves

Meteora DBC, Trends, Heaven, Virtuals, Raydium LaunchLab, Runner Rodeo and Scale vMM are bonding
curves: each sells a launched token against its quote token until the token graduates, and a
graduated or paused curve refuses the swap. Trends runs the DBC's data on its own accounts. Heaven
writes the authority, so it is attached writable. Virtuals' buy takes the tokens to buy rather than
what to pay, so only its sell is here. A Raydium LaunchLab swap creates the creator's fee vault when
it is missing, the authority paying its rent, which a Pot cannot: create it first. A curve settled
in native SOL on the authority (pump.fun's bonding curve, Boop, Moonit) has no function, since a Pot
cannot pay or be paid native SOL: they are among the instruction-only venues below.

### Staking and vaults

xORCA, Solayer, Voltr, the liquid-unstake vault, Hylo's stability pool, Huma and Helium's treasury
stake, deposit, unstake or redeem: each swaps a token for its receipt, or a receipt back, at the
venue's own rate. xORCA only stakes ORCA, the liquid-unstake vault only unstakes a liquid staking
token for wrapped SOL, Huma only deposits (with no commitment; a withdrawal needs the lender's own
accounts created first), and Helium's treasury only redeems a subnetwork token for HNT, behind its
circuit breaker. xORCA, the liquid-unstake vault and Hylo's stability pool write the authority, so
it is attached writable. Voltr requires the authority's associated token accounts, and its
withdrawal writes the idle authority; a withdrawal from Hylo's stability pool writes the pool
config. The liquid-unstake vault pays wrapped SOL into a native wrapped-SOL account. A Sanctum stake
pool's deposit takes native SOL from its signer, which a Pot cannot pay: the stake pools are among
the instruction-only venues below.

### Venues with only `Cpi` and `Data`

Sixteen venues take more accounts in their swap than a function can list, or a number of them
that varies. A function other than
`main` builds a list of at most sixteen accounts. These venues have only their `Cpi` and `Data`
forms, on the list the caller's `main` builds:

| Functions          | Venue                        | Program                                        |
| ------------------ | ---------------------------- | ---------------------------------------------- |
| `scaleAmm`         | Scale AMM                    | `SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA`  |
| `pumpswap`         | PumpSwap                     | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`  |
| `bonkswap`         | Bonkswap                     | `BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p` |
| `guacswap`         | Guacswap                     | `Gswppe6ERWKpUTXvRPfXdzHhiCyJvLadVvXGfdpBqcE1` |
| `sarosDlmm`        | Saros DLMM                   | `1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE`  |
| `raydiumLaunchlab` | Raydium LaunchLab            | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`  |
| `runnerRodeo`      | Runner Rodeo                 | `runnrXXdsSRkdueCRYxKDvSWfv6nAnrG5dcM29qj1HA`  |
| `scaleVmm`         | Scale vMM                    | `SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa`  |
| `jupiterLendEarn`  | Jupiter Lend Earn            | `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9`  |
| `hylo`             | Hylo                         | `HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn` |
| `carrot`           | Carrot                       | `CarrotwivhMpDnm27EHmRLeQ683Z1PufuqEmBZvD282s` |
| `mswap`            | M0 swap                      | `MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH`  |
| `perpsJlp`         | Jupiter Perpetuals           | `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`  |
| `perpsJlpMint`     | Jupiter Perpetuals' JLP mint | `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`  |
| `sanctumInfinity`  | Sanctum Infinity             | `5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx` |
| `archer`           | Archer                       | `Archer8kgiavM61GyusMzaaS2ft5sALtNsD1HxkUPMhy` |

A PumpSwap buy takes the authority's volume accumulator, and it has to exist already. A Pot can't
pay to create it, because the System program won't move lamports out of an account that holds data.
PumpSwap's `init_user_volume_accumulator` takes any payer. Bonkswap and Guacswap require the paying
and receiving accounts to be the authority's associated token accounts. PumpSwap, Bonkswap, Guacswap
and Scale AMM write the authority, so it is attached writable. Scale AMM takes one account per fee
beneficiary. A Meteora DLMM swap (`meteoraDlmmCpi`, on a list of any length) crosses bins only as far
as the bin arrays its list ends with, from the active bin onwards in the trade's direction, and a
Saros DLMM swap only within the two bin
arrays around its active bin; a trade too large for them fails. Jupiter Lend Earn deposits an asset
for its fToken and redeems it back, through the Jupiter Lend liquidity program, and writes the
authority. Hylo mints hyUSD for USDC and redeems it back, at its Pyth price. Carrot issues CRT for
one of its vault's assets and redeems it back; its list ends with each of the vault's assets'
account and oracle, `assets` of them, and it writes the authority and requires the authority's
associated token accounts.

M0's swap exchanges one of M's extension tokens for another one for one, unwrapping through the paid
extension's program and wrapping through the bought one's. Jupiter Perpetuals swaps one of its JLP
pool's tokens for another at their oracles' prices less the pool's fee, and refuses a price its
keeper has let go stale; its JLP mint only mints, and its list ends with each of the pool's
custodies and each custody's oracle, `custodies` of them. Sanctum Infinity swaps one of its pool's
liquid staking tokens, or wrapped SOL, for another at their calculators' SOL values less the pool's
fee: each token's calculator is its program, and a stake pool's is followed by its state, the stake
pool, the stake pool's program and that program's data, 1 account or 5 (`inCalcAccounts` and
`outCalcAccounts`). The pool of these four is a basket or a pair the way it is paid, so their
accounts are named for the trade, `mintIn` and `mintOut`, `custodyIn` and `custodyOut`, and their
order takes no direction; the JLP mint refuses the other way.

Archer swaps against its market's makers' quotes, and its list ends with them, `makers` of them. It
sells the base token in whole base lots: `archerData(amountIn, baseLot, minOut, paysBase)` takes the
market's base lot size and writes `amountIn` in lots. It buys the base token spending only the whole
lots' cost in the quote token, which can be less than `amountIn`; `archerCpi` returns what it spent.
It writes the authority, so it is attached writable.

### Instruction only

`routerSvmAccountOrder` and `routerSvmDataTemplate` also give the swap of
venues `@sauce/router` has no function for, for a program that can send it; `ROUTER_SVM_VENUES`
gives their `data` and `cpi` as `null`. A Pot cannot swap at the first three or the three
launchpads, which settle in native SOL, nor at Quantum, Obsidian or AlphaQ until it is on their
routers' list; and WOOFi's and Metric's swaps cannot be proven:

| Venue (`ROUTER_SVM_VENUES`)      | Program                                                                                                                                     | Why                                                                                                                                                                                                                 | Data options     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `one-intro-swap`                 | `DEXYosS6oEGvk8uCDayvwEZz4qEyDJRf9nFgYCaqPMTm`                                                                                              | its signer must be owned by the System program, and a Pot is owned by the Kitchen                                                                                                                                   | `minOut`         |
| `bisonfi`                        | `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi`                                                                                              | it requires a signature from an authorization account off the curve, which only its routing program signs for                                                                                                       | `aToB`, `minOut` |
| `sanctum-stake-pool`, `-2`, `-3` | `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`, `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY`, `SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn` | a deposit (`DepositSol`, the only way here) takes native SOL from its signer                                                                                                                                        | none             |
| `woofi`                          | `WooFif76YGRNjk1pA8wCsN67aQsD9f9iLsz4NcJ1AVb`                                                                                               | its keepers stopped (its oracles last updated 2026-04-20 and 2025-11-23): on mainnet state its swap reverts `WooOracleNotFeasible` at any clock; and `from_amount` ≤ `min_swap_amount` returns Ok and moves nothing | `minOut`         |
| `metric`                         | `Bvs46DPFxiFE6YHxLDLD6QAUcmy51FyRVPZJusPxLk3j`                                                                                              | its oracle refuses its price as stale (its error 20, on mainnet itself on 2026-10-07)                                                                                                                               | `aToB`, `minOut` |
| `quantum`                        | `QuaNtZsgYRe5Z9Bk4LZ4cTD9tbkVoyCNf1R2BN9bBDv`                                                                                               | it admits a swap only when the transaction's outermost program is one of its aggregators                                                                                                                            | `aToB`, `minOut` |
| `obsidian`                       | `HBVw6bZtcCaezhcBrmfyXBSBRWCdv72271xQ4GPvms2z`                                                                                              | it admits a swap only from a router on its list                                                                                                                                                                     | none             |
| `alphaq`                         | `ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA`                                                                                              | it admits a swap only from a router on its list                                                                                                                                                                     | `aToB`           |
| `pumpfun-bonding-curve`          | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`                                                                                               | it settles in native SOL on its signer; its template is unverified against its current binaries                                                                                                                     | `aToB`, `minOut` |
| `boop-fun`                       | `boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4`                                                                                               | it settles in native SOL on its signer                                                                                                                                                                              | `aToB`, `minOut` |
| `moonit`                         | `MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG`                                                                                               | it settles in native SOL on its signer                                                                                                                                                                              | `aToB`, `minOut` |

One Intro's pool names its token 0 and 1 vaults `vaultA` and `vaultB`; a swap paying token A takes
the fee accounts `feeA0` and `feeB0`, one paying B `feeA1` and `feeB1`. WOOFi's token A is the
pool's base token, and `aToB` sells it; its order takes the quote token's pool, price update and
vault a second time, and the authority again, unsigned, as the rebate's recipient. A stake pool's
`referrerFeeAccount` may be its `managerFeeAccount`. AlphaQ's order is the
same both ways, its data saying the direction. The launchpads' token A is the launched token, and
`aToB` sells it; Moonit's floor is the token amount buying and the SOL amount selling. Boop's and
Moonit's orders were sent from a wallet to their programs as deployed, but pump.fun's programs were
upgraded after the capture its order and data are held to, so its template is unverified against
the current binaries: check it against the deployed program before sending it.

### What a swap spends and its floor

**A swap spends exactly `amountIn`**, with four exceptions. The Token Swap program and its forks,
Fluxbeam and Dexlab spend what their curve rounds the input to, and so does Aldrin. The difference
is a few units, and it stays in `source`; a `Cpi` form returns what was actually paid. A Fluxbeam or
Dexlab mint with a transfer fee keeps the fee out of what the pool receives. Archer, buying its base
token, spends the whole lots' cost and leaves the rest of `amountIn`.

**`minOut`** goes into the venue's own floor where its swap takes one, so the venue refuses less
itself: as given in `…Data` and `…Cpi`, and at least 1 in `<venue>` (Denali's and Hadron's as
given there too, 0 included), which also holds what the recipient received to `minOut`
and to at least 1. The Saber decimal wrapper, Bonkswap, Guacswap, TaurusFi, Riptide, Flint, M0's
swap and the staking and vault venues but Helium's treasury have no floor of their own; for these, a
`Data` or `Cpi` caller enforces the floor itself.

### What each function skips

Each `<venue>` skips, before the swap:

- the Raydium CP-Swap and Gamma forms skip swaps switched off, a pool not open yet, an empty side,
  and dust;
- the Raydium AMM v4 form skips a pool that does not swap (a status other than 1, 6 or 7, or 7
  before its open time), an empty side, and dust;
- the Token Swap forms, Fluxbeam and Dexlab skip an uninitialized pool, an empty side, and dust;
- the Meteora DAMM v2 form skips a disabled pool, and a pool with no liquidity;
- the Meteora DAMM v1 form skips a disabled pool;
- the Aldrin and Omnipair forms skip an empty side, and dust;
- the Saber form skips a paused pool and an empty side;
- the Stabble forms skip an inactive pool and an empty side;
- the Mercurial form skips an empty side;
- the Perena form skips a paused pool and an empty side;
- the MetaDAO futarchy form skips a DAO not in its spot state, and an empty side;
- the Saber decimal wrapper form skips a withdrawal the vault cannot pay;
- the SolFi v2, Hadron, TaurusFi, Riptide, Denali, Gavel, Tessera V, Flint, Deriverse, GoonFi v2 and
  SolFi v1 forms skip an empty side;
- the Meteora DBC, Trends, Heaven and Virtuals forms skip an empty side;
- the Solayer form skips an undelegation from an empty vault, and the Voltr form a withdrawal from
  an empty idle account;
- the Helium treasury form skips an empty treasury.

"Dust" is an input too small to buy one unit at the pool's price after its fee. It is estimated from
the vaults' balances. A venue's own refusal that the checks don't foresee still fails the
transaction.

Every form but `…Data` requires the program to be its venue's before the authority signs into it.
It reverts naming the venue (`not a Raydium CP pool`, …). Each refuses a `minOut` past the venues' 64
bits (`minOut past 64 bits`). A pool of another venue, or one that isn't the pair, is the venue's own
to refuse.

### Compute

Each form's units come on top of the venue's own. Over the venue's data written around the amount
by hand (`prefix.concat(amount.toBytesLe(8), suffix)`) and sent with `svm.call` on `main`'s own
accounts, `…Data` costs about 3,300 units more, the call into it and its packed word; `…Cpi` about
7,500 more, because an account list passed to a function is built as an array first, where one
written into `svm.call` is not. A `<venue>` function reads its accounts out of `slot` and `trader`,
and each account it hands the venue costs about 1,400 units more than one of `main`'s own, so a
`<venue>` call costs about 23,000 to 63,000 units more than the data written by hand. Perena's slot
forms include the scan for its two tokens' indices. A venue's own units move between runs with the
accounts' addresses; the library's do not. A function is about 300 to 900 bytes of program.

## Next

- Swap by name, with every account derived: [venues by namespace](../guides/solana.md#venues-by-namespace).
- Spread one order over several pools: [the distributed swap on Solana](../guides/solana-distributed-swap.md).
- The same library on EVM chains: [`@sauce/router`](router.md).

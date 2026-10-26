# Swap by name

**Tutorial** · [Documentation](../README.md) · [Write your first program](write-your-first-program.md) · [Solana quick start](solana-quick-start.md)

> You are going to write a program that makes two swaps in a row on Ethereum: WETH for USDC on
> Uniswap, then that USDC for USDT on Curve. You call every token, exchange and pool by its name,
> and you set the least USDT you will accept. You try it on a copy of Ethereum, so nothing is sent
> and nothing is spent.

It takes about fifteen minutes and costs nothing.

**You will need:**

- the `sauce` command and a wallet named `me`, from the [Quick start](quick-start.md);
- a program you have written and compiled yourself, from
  [Write your first program](write-your-first-program.md).

No money: every step simulates.

**You will have:** a program that swaps through two exchanges in one transaction, a floor that
makes the whole transaction revert when the trade is worse than you accept, and the habit of
finding a chain's names with `sauce globals` before you write them.

## 1. Find the names

A program never writes an address. It names a token (`WETH`), or a protocol's contract
(`UniswapV2.Factory`), and Sauce fills in the address for the chain it is compiled for. Ask which
tokens Ethereum has:

```sh
sauce globals --chain ethereum --tokens
```

```text
Ethereum: ethereum, chain id 1 (evm)

Tokens (3): <Sym>.transfer(…), or the symbol as an address
  USDC  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48  6 decimals
  USDT  0xdAC17F958D2ee523a2206206994597C13D831ec7  6 decimals
  WETH  0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2  18 decimals
  …
```

Note the decimals: an amount of USDT is in millionths, so 24000000 is 24 USDT.

Each protocol is a **namespace**, its contracts its members. Ask for Uniswap V2's:

```sh
sauce globals --chain ethereum --protocol UniswapV2
```

```text
UniswapV2  (Uniswap V2)
  Factory  0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f
    getPair(tokenA: address, tokenB: address): (pair: address)  view
    …
```

So `UniswapV2.Factory.getPair(WETH, USDC)` finds the WETH/USDC pool, which Uniswap V2 calls a
pair. `sauce globals --chain ethereum --protocol Curve` lists `ThreePool`, Curve's pool of USDC,
USDT and DAI.

## 2. Write the program

Save this as `router-swap.sauce.ts`:

```js
import { curve, uniswapV2 } from "@sauce/router";
import { balanceOf } from "@sauce/token";

// Ethereum: sell every WETH the Pot holds on Uniswap V2, then the USDC that returns for USDT in
// Curve's 3pool, and keep the USDT in the Pot: each swap's recipient is `pot`, so a later
// cook spends it (pass the wallet instead to deliver it). The tokens, the factory and the pool are
// the registry's names; the amounts are only known when this runs.
//
//   sauce run router-swap.sauce.ts --chain ethereum --keystore <keystore> --args <minOut>
//
//   minOut: Uint256   the least USDT to keep, in its smallest units (6 decimals): below it the
//                     whole transaction reverts
function main(minOut: Uint256) {
  const pair = UniswapV2.Factory.getPair(WETH, USDC);
  const sold = balanceOf(WETH, pot);
  const received = uniswapV2(pair, WETH, USDC, sold, 3000, 0, pot);
  // USDC is the 3pool's coin 1 and USDT its coin 2.
  curve(Curve.ThreePool, USDC, USDT, received, 1, 2, false, minOut, pot);
}
```

Line by line:

- `@sauce/router` is Sauce's swap library: one function per kind of pool, every one taking the pool,
  the token in, the token out and the amount first, and the floor and the recipient last.
  `@sauce/token` holds the token functions.
- `UniswapV2.Factory.getPair(WETH, USDC)` asks Uniswap's factory for the pair, while the program
  runs.
- `pot` is your **Pot**, the account the program runs in. `balanceOf(WETH, pot)` is the WETH it
  holds now: the program sells all of it.
- `uniswapV2(pair, WETH, USDC, sold, 3000, 0, pot)` sells it. `3000` is the pair's fee in parts per
  million (0.3%), `0` sets no floor on this first swap, and `pot` keeps the USDC in the Pot. It
  returns the USDC received.
- `curve(Curve.ThreePool, USDC, USDT, received, 1, 2, false, minOut, pot)` swaps exactly
  that USDC for USDT. `1` and `2` are the two coins' places in the pool, `false` says this pool
  takes those places as `int128` rather than `uint256` (older Curve pools do), and `minOut` is
  your floor.

The amounts are known only while the program runs, and each step spends what the one before it
returned. That is the reason to write it as one program: the two swaps happen in one transaction,
or not at all.

Check that it compiles:

```sh
sauce compile router-swap.sauce.ts --chain ethereum
```

It prints the compiled program as hex.

## 3. Simulate it

Pretend your Pot holds 0.01 WETH, and ask for at least 1 unit of USDT, which is almost no floor:

```sh
sauce simulate router-swap.sauce.ts --chain ethereum --wallet me \
  --assume-balance WETH:0.01 --args 1
```

```text
ethereum: read through a built-in public endpoint, which can be slow or rate-limited; give your own with --rpc-url <url> or --config <file>
The cook succeeds from 0x…: gas used 331866 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  24.512278 USDT
…
What moved, in order:
  [1] wallet 0x… -> Pot 0x…                         0.00003728943124295 ETH  the cook's value
  [2] Pot        -> Kitchen 0x…                     0.00003728943124295 ETH  the Kitchen's fee
  [3] Pot        -> 0xB4e1…C9Dc                     0.01 WETH
  [4] 0xB4e1…C9Dc -> Pot                            24.493049 USDC
  [5] Pot        -> Curve.ThreePool 0xbEbc…F1C7     24.493049 USDC
  [6] Curve.ThreePool -> Pot                        24.512278 USDT
```

Your numbers will differ: they are Ethereum's prices right now. Read the moves from `[3]`: the Pot
paid the WETH to the Uniswap pair, got USDC back, paid it to Curve's pool, and got USDT back. The
USDT stays in the Pot, as the program asked. `[1]` and `[2]` are the **cook**, the transaction that
runs a program, and the Kitchen's fee for it.

## 4. Set a floor

A swap's price moves between the moment you look and the moment your transaction lands. The floor,
`minOut`, is the least you accept; below it the whole transaction reverts and nothing moves. Take
the USDT amount your simulation printed at `[6]`, and ask for more than that. In the sample above it
was 24.51 USDT, so ask for 30, in USDT's base units (6 decimals):

```sh
sauce simulate router-swap.sauce.ts --chain ethereum --wallet me \
  --assume-balance WETH:0.01 --args 30000000
```

```text
The cook reverts: "Exchange resulted in fewer coins than expected"
```

Curve refused to pay less than the floor, so even the first swap is undone. Now set a fair one: 1%
under what your simulation returned. Write that amount in base units, multiply by 99, divide by
100, and round down. For the sample's 24.512278 USDT that is 24512278 × 99 / 100, so 24267155:

```sh
sauce simulate router-swap.sauce.ts --chain ethereum --wallet me \
  --assume-balance WETH:0.01 --args 24267155
```

The cook succeeds again. Before a real `sauce run`, simulate once more and work the floor out from
that run: prices will have moved since this one.

## 5. See a name on another chain

Names resolve per chain. Compile the same file for Base:

```sh
sauce compile router-swap.sauce.ts --chain base
```

```text
sauce compile: router-swap.sauce.ts does not compile for base
rewriteProtocolAccessors: Contract 'ThreePool' (curve) is not deployed on 'base' (available: ethereum)
```

Base has USDC, WETH and Uniswap V2, but no Curve 3pool, and the compiler says so before anything is
sent. A program that uses only names a chain has compiles there unchanged.

## What just happened

You found a chain's tokens and contracts with `sauce globals`, and wrote a program that names them.
Compiling it for Ethereum put in Ethereum's addresses. The simulation ran two swaps in one cook,
each spending what the one before it returned, and your floor made the whole cook revert when the
trade came out too small.

Running it for real is the same command with `sauce run` and real money: WETH in your Pot on
Ethereum, and ETH in your wallet for the gas and the fee. [Run a program](cli-run.md) shows how to
put tokens in your Pot.

## Next

- The next tutorial: [Solana quick start](solana-quick-start.md).
- How a name becomes an address on each chain: [Names and registries](../concepts/names-and-registries.md).

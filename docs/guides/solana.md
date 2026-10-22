# Solana programs and execution

**How-to guide** · [Documentation](../README.md) · [Solana quick start](solana-quick-start.md) · [How Sauce runs on Solana](../concepts/solana-model.md)

> A program you wrote for Base already runs on Solana: Sauce lists the accounts it touches for you.
> This page is for what goes further: writing an account a program needs where it uses it, swapping
> at Solana's pools by name, moving Token-2022 tokens, and choosing how a program runs.

This page assumes you have run a program with the [Solana quick start](solana-quick-start.md) and
know the words account, token account and staging from
[How Sauce runs on Solana](../concepts/solana-model.md). Each task below names the command or the
program text that does it; [Solana from the command line](cli-solana.md) covers the flags, and
[Solana from TypeScript](solana-from-typescript.md) the same steps in code.

Solana execution differs from EVM in one structural way, and everything on this page follows from it: **a Solana program must declare every account it touches, up front.** Those declarations are `Account` parameters on `main`, and the compiler returns them as an account manifest you resolve to real addresses before sending anything.

A registered token symbol has the same methods it has on an EVM chain, and every account those take
is added to `main` for you. Protocol members are EVM-only: on Solana there is no contract address
to fold in, and no account slot to put one in. A symbol alone is a value: compiled for `solana`,
`USDC` is the mint's 32-byte key, which the `@sauce/token` functions take first
(`balanceOf(USDC, account)`). [Solana's tokens and contracts](../reference/chains/solana.md) lists
the mints.

## The token methods, every account derived

A program pays, approves and reads a token as it would on Base, and the same source compiles for both:

```ts
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

Compiled for Solana, the accounts the calls move through come after `main`'s own parameters. `CompiledSauceProgram.derivedAccounts` says how each is derived, as an `--account` value:

| Slot           | Derivation                                    | The account                                |
| -------------- | --------------------------------------------- | ------------------------------------------ |
| `tokenProgram` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | the token program that owns the mint       |
| `pot`          | `self`                                        | the Pot (the signer, cooked directly)      |
| `potUSDC`      | `self:USDC`                                   | the Pot's USDC account                     |
| `toUSDC`       | `@to:USDC`                                    | the USDC account of `main`'s argument `to` |

`sauce run`, `simulate` and `tx`, and the MCP server's cook tools, fill every derived slot from the owner, the Pot and `main`'s arguments, so the program above runs with `--args <recipient> 400` and no `--account`. A recipient's associated token account that does not exist yet is created before the cook, once the owner agrees (or with `--yes`). From TypeScript, each derivation resolves to an address with `resolveSvmAccountName` ([Solana from TypeScript](solana-from-typescript.md#compile-and-keep-the-account-manifest)).

What the lowering guarantees and requires:

- **Each holder's account is checked on chain.** After each write the program requires the token account it paid, or paid from, to belong to the holder the call named: `wrong recipient account`, `wrong sender account`, `wrong spender account`, and `wrong holder account` for a read. A builder that attaches another account cannot redirect the transfer.
- **Each mint's own write.** An SPL Token mint moves by the plain `transfer`/`approve` (about 360 bytes with the check): for such a mint it does what the checked write does, in about 220 bytes less and one account fewer. A Token-2022 mint moves by `transferChecked`/`approveChecked`, with the registry's decimals and the mint as one more account (about 585 bytes). `Token(mint)` of an `Address` argument takes the checked write, with the decimals read from the mint. Its token program is read from the cluster when the cook is built; a mint whose program cannot be read is refused, never assumed, and every write requires its token program to be SPL Token or Token-2022 before calling it.
- **Every holder is known when the transaction is built.** A holder can be `self` (or `ctx.self()`): as a token's holder it is the Pot, as on an EVM chain, and `self.USDC` is its balance. It can also be `Solana.owner`, an `Address` parameter of `main` (`to.USDC`), or a 32-byte key. `<holder>.SOL` is a holder's lamports, read from its account, which is added to `main` too: `self.SOL` is the Pot's. A holder computed as the program runs is refused, because no transaction can attach its account. Pass its token account as an `Account` parameter in the holder's place instead (`USDC.transfer(dest, amount)` with `dest: Account<Writable>`). That account is paid as attached: the call names no holder, so nothing checks whose it is, and whoever builds the transaction chooses it. Prefer an `Address` recipient, which the program checks, or check the account in the program (`require(ownerOf(USDC, dest) == expected, ...)`).
- **Only in `main`, in a module.** The methods must stand in `main` itself: a helper has no account parameters, and a script has no `main` to add them to.

## Accounts where they are used

For what the token methods do not cover, a program writes each account where it uses it, and the SDK adds it to `main` the same way. This program wraps the owner's SOL into the Pot's WSOL account with the System Program's transfer and SPL Token's SyncNative:

```ts
function main(lamports: Uint256): Uint256 {
  const potWsol = WSOL.accountOf(Solana.self).writable();
  let transfer = hex`02000000`;
  svm.call(
    Solana.systemProgram,
    [Solana.owner.writable().signer(), potWsol],
    transfer.concat(lamports.toBytesLe(8)),
  );
  svm.call(Solana.tokenProgram, [potWsol], hex`11`);
  return self.WSOL;
}
```

Saved as `wrap.sauce.ts`, it runs with `sauce run wrap.sauce.ts --chain solana --keypair <keypair> --args 1000000` and no `--account`. The accounts a program can write this way, each with how it is derived:

| Expression                                                                                          | The account                                                | Derivation                            |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `Solana.pda(program, [seeds])`                                                                      | the address `program` derives for the seeds                | `pda:<program>:<seeds>`               |
| `Solana.account(key)`                                                                               | the account at a key                                       | the key                               |
| `Solana.self`, `Solana.owner`                                                                       | the Pot (the signer, cooked directly), and the Pot's owner | `self`, `owner`                       |
| `Solana.systemProgram`, `tokenProgram`, `token2022Program`, `associatedTokenProgram`, `memoProgram` | the program                                                | its id                                |
| `USDC.accountOf(holder)`                                                                            | the holder's associated USDC account                       | `self:USDC`, `owner:USDC`, `@to:USDC` |
| `USDC.mint`, `USDC.tokenProgram`                                                                    | the mint, and the token program that owns it               | `mint:USDC`, its id                   |

- **Roles.** Each account is read-only; `.writable()` and `.signer()` give it a role, and chain. An account written more than once is one slot with every role its uses give it.
- **Known when the transaction is built.** A program, key, holder or seed is an `Address` parameter of `main`, a 32-byte key, `ctx.self()`, `Solana.self`, `Solana.owner` or a program account. A seed can also be a token symbol (its mint), a string of up to 32 bytes, an integer parameter's or literal's `.toBytesLe(n)` (`n` 1, 2, 4, 8 or 16) or ``hex`…` ``. A seed computed as the program runs is refused: take that account as an `Account` parameter.
- **Names.** A slot is named for what it holds (`systemProgram`, `potWSOL`); a derived address for the constant it initializes (`destPda`) or its first string seed (`statePda`).
- **Each is checked on chain.** The cook commands attach what the expression derives. A transaction built another way could attach another account, so compiling adds a check for each account at the top of `main`. A wrong account is refused with one of these reasons:
  - `wrong account`: `Solana.account(key)` is not at `key`.
  - `wrong program-derived address`: the engine derives `Solana.pda(...)` again with `crypto.findPDA`, at the program's canonical bump.
  - `wrong holder account`: `USDC.accountOf(holder)` is not a USDC token account held by `holder`.
  - `wrong mint`: `USDC.mint` is not that mint.
  - `wrong program`: a program account is not that program.

  The Pot and the owner are pinned by their signatures. An account made from either one makes it a signer; elsewhere, add `.signer()` where its identity matters. The first `accountOf` costs about 290 bytes, shared with the token methods' reads; every other check costs 25 to 60.

- **`accountOf` names an account that exists.** `sauce run` creates a missing one before the cook. For an account the program creates itself, use `Solana.pda(Solana.associatedTokenProgram, [holder, Solana.tokenProgram, USDC])`. The Associated Token Account program checks that address when it creates the account.

`sauce globals --chain solana` lists the expressions under Accounts; in TypeScript, `routes.sourceGlobals("solana").accounts`.

## Venues by namespace

A swap at one pool of a venue whose swap stops at a price limit is that venue's namespace, as a protocol's is on an EVM chain, and its pool is found by its key, as an EVM program asks a Uniswap factory for the pool at a fee. This program is [solana-swap.sauce.ts](../examples/solana-swap.sauce.ts), and [solana-swap.ts](../examples/solana-swap.ts) compiles it and lists the accounts every cook derives for it:

```ts
// Solana: buy WSOL with up to `amountIn` of the Pot's USDC at Orca's SOL/USDC whirlpool of tick
// spacing 4, never paying more than `priceLimit` for any unit, and send what arrived to `to`. The
// pool is found by its key, as an EVM program finds a Uniswap pool by its fee, and compiling adds
// every account the swap takes to main — the pool's nine, read from the pool when the cook is
// built, and the Pot's own — so the command is given none. A pool already past `priceLimit` is
// skipped (`swap` returns 0, and nothing moves); below `minOut` the whole transaction reverts.
//
//   sauce run solana-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <to> <amountIn> <priceLimit> <minOut>
//
//   to: Address           who gets the WSOL bought: a wallet's key
//   amountIn: Uint256     the most USDC to pay, in its smallest units (6 decimals): 100000000 is 100
//   priceLimit: Uint256   the most one WSOL may cost, fee included: USDC base units per WSOL base
//                         unit, times 10^18 (sauce pools prints each pool's own as priceLimit)
//   minOut: Uint256       the least WSOL to receive, in its smallest units (9 decimals)
//
// On Solana, 100 USDC at up to 200 USDC per SOL, for at least 0.4 SOL:
//
//   sauce run solana-swap.sauce.ts --chain solana --keypair <keypair> \
//     --args <recipient> 100000000 200000000000000000 400000000
function main(to: Address, amountIn: Uint256, priceLimit: Uint256, minOut: Uint256): Uint256 {
  const got = Orca.Whirlpool.swap(
    Orca.Whirlpool.pool(USDC, WSOL, 4),
    USDC,
    WSOL,
    amountIn,
    priceLimit,
    minOut,
  );
  if (got > 0) WSOL.transfer(to, got);
  return got;
}
```

Each namespace is the protocol, then its program, as on an EVM chain: `Raydium.CLMM`, `Pancakeswap.CLMM`, `Byreal.CLMM`, `Stabble.CLMM`, `Orca.Whirlpool`, `Cropper.Whirlpool`, `Defituna.Fusion`, `Crema.CLMM` and `Phoenix.Market`. Each has a `swap(pool, tokenIn, tokenOut, amountIn, priceLimit, minOut)`. It returns what arrived. Where the pool cannot trade (there is no pool at the key, or it is empty, paused, or already past `priceLimit`), it returns 0 and moves nothing. Below `minOut` the whole transaction reverts. `priceLimit` is the most one unit bought may cost, fee included: pay base units per buy base unit, times 10^18.

Meteora DLMM's own swap has no price limit, so `Meteora.DLMM.swap(pool, tokenIn, tokenOut, amountIn, minOut)` takes no `priceLimit`: it pays all of `amountIn`, or the whole transaction fails, and reverts below `minOut`. Its pool is named by its address.

- **The pool by its key.** `pool(tokenA, tokenB, key)` is the pool the venue's program keeps for the pair at that key, either token first. The key is a tick spacing at Orca, Cropper, DefiTuna and Crema, and a fee in millionths (400 is 0.04%) at Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble. It is written as the swap's pool, the key a number written out, or the variable of a loop over numbers written out: `for (const spacing of [4, 1]) { … }` swaps at one pool per key. Raydium and PancakeSwap each keep two configs at 0.01% and at 0.05%, one per tick spacing: for those fees the spacing follows the fee, `Raydium.CLMM.pool(USDC, WSOL, 100, 1)`, and the fee alone is refused for a pair with a pool under both. At Orca and Cropper the tick spacing names the pool with a fixed fee; a pool whose fee adapts to volatility is named by its fee tier's number after the spacing, `Orca.Whirlpool.pool(SPCX_US, USDC, 64, 1025)`, and a swap at a price skips it. A Phoenix market is not derived from its pair, so a program takes it as a parameter of `main` declared `Address`.
- **One venue's function.** Each call compiles to that venue's own `@sauce/router` function (`orcaWhirlpool`) and keeps that function's checks: the venue's program, the pool's owner, the pair, `minOut`.
- **The accounts are added to `main`.**
  - The pool's nine (`slot:Orca.Whirlpool(USDC,WSOL,4):USDC.program` through `ticks2`) are read from the pool on the cluster as the cook is built. Its tick arrays follow the token paid, so the slot is that direction's (the slot `sauce pools --chain solana` lists for that direction). A key with no pool there is an empty slot: its nine are the System Program.
  - The trader's are the Pot's.
  - What is bought lands in the Pot's own account for `tokenOut`, which `sauce run` creates when it is missing.
- **What must be known.** The tokens are each a registered symbol, a parameter of `main` declared `Address`, or a 32-byte key; the pool is found by its key, or is such a parameter or key. A pool no price-limit venue owns is refused before the cook; another venue's pool reverts on chain.

`sauce globals --chain solana` lists the namespaces under Venues, each with the key it finds pools by, and `sauce pools --chain solana USDC WSOL` lists a pair's pools with each one's key. [The distributed swap on Solana](solana-distributed-swap.md) spreads one order over several pools, found by key in a loop over each venue's keys.

## Move a Token-2022 token

A Solana mint belongs to one of two token programs, and so does every token account of it: the SPL Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) or Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). USDC and USDT are SPL Token mints; PYUSD (registered as `PYUSD`) and the tokenized stocks are Token-2022 mints. The registry names mainnet-beta's stock mints, each by its issuer's symbol: Backed's xStocks (`TSLAx`), Ondo Global Markets' (`TSLAon`), Backpack Securities' (`NVDA_US`) and PreStocks' (`SPACEX`); [Solana's stock tokens](../reference/chains/solana-stocks.md) lists them, as does `sauce globals --chain solana --stocks`, and [Tokenized stocks](../reference/tokens.md#tokenized-stocks) says what differs about them. `@sauce/token`'s SVM arm takes both programs:

- **Reads**, either program: `balanceOf(mint, account)`, `ownerOf(mint, account)`, `allowance(mint, account, spender)`, `totalSupply(mintAccount)`, `decimals(mintAccount)`. A Token-2022 account or mint is held to its base layout and, where it carries extensions, to its account-type byte.
- **Checked writes**, either program: `transferChecked(mint, tokenProgram, source, mintAccount, dest, authority, amount, decimals)` and `approveChecked(mint, tokenProgram, source, mintAccount, delegate, authority, amount, decimals)`. `tokenProgram` must be one of the two and own the source, the destination and the mint; `mintAccount` must be `mint`; `decimals` must be the mint's.
- **Legacy writes**, SPL Token only and unchanged: `transfer`, `transferFrom` and `approve`. Token-2022 refuses its plain transfer for a mint with a transfer fee, a transfer hook or a pause, so a program that moves a Token-2022 token uses `transferChecked`.

What Token-2022's extensions do is the token program's: a transfer fee is withheld from what the destination receives, so a program measures the balance it got rather than the amount it sent; a scaled UI amount is a display multiplier, and every amount a program sees is raw; a paused mint, or a frozen account (a mint whose default account state is frozen starts every new account frozen), fails the transfer with Token-2022's own error. A transfer hook with no program set is no hook. One that names a program is refused by the library as `transfer hook`, before anything moves: the hook's extra accounts are not passed.

Give the same accounts by token on the command line: `program:PYUSD`, `mint:PYUSD`, `pot:PYUSD`,
and a stock's by its symbol, `pot:TSLAx` ([account values](cli-solana.md#account-values-in-full)).
PreStocks' mints charge a transfer fee, so a program paying one measures what arrived. From
TypeScript, `resolveSvmToken` reads which program owns a mint and what it refuses
([resolve a token's accounts](solana-from-typescript.md#resolve-a-tokens-accounts)).

## Two ways to run a program

A program runs through the Kitchen on your Pot, by default, or directly on the engine with no Pot.
[Two ways to cook](../concepts/solana-model.md#two-ways-to-cook) sets them side by side. Choose:

- **Through the Kitchen** (`--via kitchen`, `via: "kitchen"`, the default) when the program holds
  or spends what your Pot owns, or writes the Pot's storage. The owner signs every cook.
- **Directly** (`--via engine`, `via: "engine"`) when the program spends your wallet's own token
  accounts, with the wallet signing as their authority, or needs one more level of calls into other
  programs than the Kitchen leaves it.

A direct cook has no Pot, so it cannot write a Pot's storage, and a transfer whose authority is a
Pot fails for the missing signature. Attach the wallet, signing, where the program needs an
authority (`--account NAME=owner`). The fee and the compiled program are the same either way.

## Run a large program

A program larger than one transaction is staged into a Kitchen code buffer first, then run from it,
and a cook naming more accounts than fit goes through an address lookup table
([why](../concepts/solana-model.md#why-a-program-is-staged)). `sauce run` does both and closes the
buffer afterwards. `sauce compile --json` reports the cook's size against the 1,232-byte limit as
`cook`, so you can tell before you run. [A program too big for one transaction](cli-solana.md#a-program-too-big-for-one-transaction)
shows the run, and [stage a larger program](solana-from-typescript.md#stage-a-larger-program) the
same steps in code.

## Next

- Run what this page describes from the command line: [Solana from the command line](cli-solana.md).
- Build cooks in your own code: [Solana from TypeScript](solana-from-typescript.md).
- Spread one order over several Solana pools: [the distributed swap on Solana](solana-distributed-swap.md).

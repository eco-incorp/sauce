# Solana programs and execution

**How-to guide** · [Documentation](../README.md) · [Compiler](../api/compiler.md) · [Solana's tokens and contracts](../reference/chains/solana.md)

> On Solana, a transaction must list every account it will touch before it starts: every wallet,
> every token balance, every program. Sauce works that list out for the usual things, such as paying
> and reading tokens. This page is for everything else: calling other Solana programs, Token-2022
> tokens, Solana's pools, programs too big for one transaction, and running a program without a Pot.
> New to Solana? Start with the [Solana quick start](solana-quick-start.md).

Solana execution differs from EVM in one structural way, and everything on this page follows from it: **a Solana program must declare every account it touches, up front.** Those declarations are `Account` parameters on `main`, and the compiler returns them as an account manifest you resolve to real addresses before sending anything.

A registered token symbol has the same methods it has on an EVM chain, and the SDK writes the accounts they need for you, as it does for any account a program writes where it uses it (`Solana.pda(program, [seeds])`, below). `USDC.transfer(to, amount)`, `approve`, `transferFrom`, `balanceOf` and `Token(mint)` lower to the `@sauce/token` functions, and every account those take is added to `main` as an `Account` parameter. Protocol members are EVM-only: on Solana there is no contract address to fold in, and no account slot to put one in. A symbol alone is a value. Compiled for `solana` (`sauce compile --chain solana`, `routes.compileSauceProgram("solana", source)`), `USDC` is the mint's 32-byte key, which the `@sauce/token` functions take first (`balanceOf(USDC, account)`); `routes.SVM_TOKEN_REGISTRY` lists the mints, mainnet's and devnet's. For a program whose accounts you write yourself, use `@eco-incorp/sauce/compiler` directly: `routes.compileSauceRoute()` returns calls and bytecode but drops the manifest, which is the part you need.

## The token methods, every account derived

A program pays, approves and reads a token as it would on Base, and the same source compiles for both:

```ts
function main(to: Address, amount: Uint256) {
  require(USDC.balanceOf(ctx.self()) >= amount, "not enough USDC");
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

`sauce run`, `simulate` and `tx`, and the MCP server's cook tools, fill every derived slot from the owner, the Pot and `main`'s arguments, so the program above runs with `--args <recipient> 400` and no `--account`. A recipient's associated token account that does not exist yet is created before the cook, once the owner agrees (or with `--yes`). From TypeScript, `resolveSvmAccountName(derivation, { chain, owner, pot, via, args, programOf })` from `@eco-incorp/sauce/svm` resolves one derivation to the address to put in the cook's `AccountResolution`. A swap at a price through a venue namespace also adds a value to `main`, its stop (`derivedValues`, after the accounts and never one of `entryParams`), which keeps the pool within its share of the transaction's compute units ([Stops](../api/router.md#stops)); `svmProgramStops(program, chain, accounts, integers, load)` works each out as `sauce` does, and its `values` are encoded after `main`'s own arguments.

What the lowering guarantees and requires:

- **Each holder's account is checked on chain.** After each write the program requires the token account it paid, or paid from, to belong to the holder the call named: `wrong recipient account`, `wrong sender account`, `wrong spender account`, and `wrong holder account` for a read. A builder that attaches another account cannot redirect the transfer.
- **Each mint's own write.** An SPL Token mint moves by the plain `transfer`/`approve` (about 360 bytes with the check): for such a mint it does what the checked write does, in about 220 bytes less and one account fewer. A Token-2022 mint moves by `transferChecked`/`approveChecked`, with the registry's decimals and the mint as one more account (about 585 bytes). `Token(mint)` of an `Address` argument takes the checked write, with the decimals read from the mint. Its token program is read from the cluster when the cook is built; a mint whose program cannot be read is refused, never assumed, and every write requires its token program to be SPL Token or Token-2022 before calling it.
- **Every holder is known when the transaction is built.** A holder can be `ctx.self()` (or `self`): as a token's holder it is the Pot, as on an EVM chain. It can also be an `Address` parameter of `main`, or a 32-byte key. A holder computed as the program runs is refused, because no transaction can attach its account. Pass its token account as an `Account` parameter in the holder's place instead (`USDC.transfer(dest, amount)` with `dest: Account<Writable>`). That account is paid as attached: the call names no holder, so nothing checks whose it is, and whoever builds the transaction chooses it. Prefer an `Address` recipient, which the program checks, or check the account in the program (`require(ownerOf(USDC, dest) == expected, ...)`).
- **Only in `main`, in a module.** The methods must stand in `main` itself: a helper has no account parameters, and a script has no `main` to add them to. `compileSauceRoute` refuses the added accounts, because a route's `execution.accounts` are built before the compile.

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
  return WSOL.balanceOf(ctx.self());
}
```

It runs with `sauce run wrap.sauce.ts --chain solana --keypair <keypair> --args 1000000` and no `--account`. The accounts a program can write this way, each with how it is derived:

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
- **Each is checked on chain.** The cook commands attach what the expression derives. A transaction built another way, such as a solver filling the cook, could attach another account, so compiling adds a check for each account at the top of `main`. A wrong account is refused with one of these reasons:
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
  - The pool's nine (`slot:Orca.Whirlpool(USDC,WSOL,4):USDC.program` through `ticks2`) are read from the pool on the cluster as the cook is built. Its tick arrays follow the token paid, so the slot is that direction's (`svm.svmPoolSlot`, the same `sauce pools --chain solana` lists). A key with no pool there is an empty slot: its nine are the System Program.
  - The trader's are the Pot's.
  - What is bought lands in the Pot's own account for `tokenOut`, which `sauce run` creates when it is missing.
- **What must be known.** The tokens are each a registered symbol, a parameter of `main` declared `Address`, or a 32-byte key; the pool is found by its key, or is such a parameter or key. A pool no price-limit venue owns is refused before the cook; another venue's pool reverts on chain.

`sauce globals --chain solana` lists the namespaces under Venues, each with the key it finds pools by, and `sauce pools --chain solana USDC WSOL` lists a pair's pools with each one's key. [The distributed swap on Solana](solana-distributed-swap.md) spreads one order over several pools, found by key in a loop over each venue's keys.

## Compile an SPL transfer

The universal token builder emits account parameters and an SPL `TransferChecked` CPI. Its source needs no imports, so a single-module resolver is sufficient:

```ts
import { token } from "@eco-incorp/sauce";
import { compile } from "@eco-incorp/sauce/compiler";

export function compileSplTransfer(amount: bigint) {
  const source = token.Token.transfer({
    amount,
    svm: {
      source: "sourceAta",
      mint: "mint",
      dest: "destinationAta",
      owner: "owner",
      tokenProgram: "tokenProgram",
    },
  }).source("svm");

  return compile({
    target: "svm",
    entry: "main.ts",
    resolve: (id) => (id === "main.ts" ? new TextEncoder().encode(source) : null),
  });
}
```

The account references are names, not addresses. `manifest.accounts` records their order and required roles. Resolve them to the mint, source token account, destination token account, authority, and token program before execution. Amounts are smallest-unit integers. The builder reads mint decimals for the checked instruction and defaults to the classic SPL Token program. Set the builder's top-level `tokenProgram: "token-2022"` for a supported Token-2022 operation; `svm.tokenProgram` names the account reference and must resolve to that token program.

## `@sauce/token` and Token-2022

A Solana mint belongs to one of two token programs, and so does every token account of it: the SPL Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) or Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). USDC and USDT are SPL Token mints; PYUSD (registered as `PYUSD`) and the tokenized stocks are Token-2022 mints. The registry names mainnet-beta's stock mints, each by its issuer's symbol: Backed's xStocks (`TSLAx`), Ondo Global Markets' (`TSLAon`), Backpack Securities' (`NVDA_US`) and PreStocks' (`SPACEX`); [Solana's stock tokens](../reference/chains/solana-stocks.md) lists them, as does `sauce globals --chain solana --stocks`, and [Tokenized stocks](../reference/tokens.md#tokenized-stocks) says what differs about them. `@sauce/token`'s SVM arm takes both programs:

- **Reads**, either program: `balanceOf(mint, account)`, `ownerOf(mint, account)`, `allowance(mint, account, spender)`, `totalSupply(mintAccount)`, `decimals(mintAccount)`. A Token-2022 account or mint is held to its base layout and, where it carries extensions, to its account-type byte.
- **Checked writes**, either program: `transferChecked(mint, tokenProgram, source, mintAccount, dest, authority, amount, decimals)` and `approveChecked(mint, tokenProgram, source, mintAccount, delegate, authority, amount, decimals)`. `tokenProgram` must be one of the two and own the source, the destination and the mint; `mintAccount` must be `mint`; `decimals` must be the mint's.
- **Legacy writes**, SPL Token only and unchanged: `transfer`, `transferFrom` and `approve`. Token-2022 refuses its plain transfer for a mint with a transfer fee, a transfer hook or a pause, so a program that moves a Token-2022 token uses `transferChecked`.

What Token-2022's extensions do is the token program's: a transfer fee is withheld from what the destination receives, so a program measures the balance it got rather than the amount it sent; a scaled UI amount is a display multiplier, and every amount a program sees is raw; a paused mint, or a frozen account (a mint whose default account state is frozen starts every new account frozen), fails the transfer with Token-2022's own error. A transfer hook with no program set is no hook. One that names a program is refused by the library as `transfer hook`, before anything moves: the hook's extra accounts are not passed.

A program's accounts depend on the mint's program, and the SDK resolves them per mint. `resolveSvmToken` reads the mint through a loader that returns each account's owner, which is the only way to tell an extensionless Token-2022 mint from a legacy one; the result gives the `tokenProgram` and `mintAccount` to attach and the `decimals` to pass, and `svmTokenAccount` derives a holder's associated token account under that program:

```ts
import { createSolanaRpc, type Address } from "@solana/kit";
import {
  coalescingOwnedAccountLoader,
  kitBatchAccountLoader,
  resolveSvmToken,
  svmTokenAccount,
  svmTokenToSend,
} from "@eco-incorp/sauce/svm";

export async function planTransfer(rpcUrl: string, mint: Address, pot: Address, epoch: bigint) {
  const load = coalescingOwnedAccountLoader(kitBatchAccountLoader(createSolanaRpc(rpcUrl)));
  const token = await resolveSvmToken(load, mint);
  if (token.transferRefusals.length > 0) throw new Error(token.transferRefusals.join("; "));

  return {
    accounts: {
      tokenProgram: token.tokenProgram,
      mint: token.mint,
      source: await svmTokenAccount(token, pot),
    },
    decimals: token.decimals,
    // What to send at `epoch` for the destination to receive exactly 1,000 base units.
    amount: svmTokenToSend(token, 1_000n, epoch),
  };
}
```

`svmTokenReceived` is the other direction: what a transfer of an amount delivers. Both apply the mint's transfer fee exactly as Token-2022 computes it. On the command line, `--account` names the same accounts by token: `program:PYUSD`, `mint:PYUSD`, `pot:PYUSD`, and a stock's by its symbol, `pot:TSLAx` ([CLI guide](cli-solana.md)). PreStocks' mints charge a transfer fee, so a program paying one measures what arrived.

## Two ways to run a program

The released engine has two entry points, and the SDK builds a cook for each. A client chooses with
`via`, and the `sauce` command with `--via` ([CLI guide](cli-solana.md)).

|                                 | Through the Kitchen: `via: "kitchen"` (the default)                      | Direct to the engine: `via: "engine"`                                                  |
| ------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| What the transaction calls      | the Kitchen's `cook`, or `cook_from_account` for a staged program        | the engine's `cookAndPay`, or `cookAndPayFromAccountPinned` for a staged program       |
| Whose authority the program has | the owner's Pot, which the Kitchen signs for, and any signer it is given | only the signers the transaction gives it, such as the wallet; nothing signs for a Pot |
| The execution fee               | charged by the Kitchen, before it calls the engine                       | charged by the engine, before the program runs                                         |
| CPI depth left for the program  | three levels below it, on mainnet; seven where SIMD-0268 is active       | four, on mainnet; eight where SIMD-0268 is active                                      |

**Through the Kitchen** is for custody through a Pot: the program holds and spends what the Pot
owns (token accounts whose owner is the Pot) and writes the Pot's own storage, at an address that is
the same for every cook of that owner and salt. The owner signs every Kitchen cook.

**Direct to the engine** is for a program that acts as the signer: it spends the wallet's own token
accounts, with the wallet signing as their authority, and makes no Pot at all. It also starts the
program's own calls one level higher on Solana's invoke stack, because no Kitchen frame sits under
the engine. That is the difference between fitting and not fitting when the program calls a program
that calls others — an aggregator into a pool into a token program, say. Solana allows 4 levels of
CPI below a transaction's instruction (8 once SIMD-0268's feature is active): through the Kitchen
the engine spends one of them.

What does not change between them:

- **The fee.** Both read it from the Kitchen's `["execution_fee"]` config account and pay it into
  that same account, the Kitchen's treasury. Both instructions carry a signed `max_execution_fee`,
  and a fee above it refuses the cook before anything runs or is paid. Directly, the fee payer must
  be a System-owned account that holds no data, and the engine validates the config even when the
  fee is zero, so a lookalike account is refused rather than read as free.
- **The program.** The same compiled bytecode and the same account indices run either way: the
  Kitchen's accounts, and the three a direct cook pays with, are taken off the list before the
  program sees it.
- **`ctx.self()`** is the engine program's id, and **`ctx.msgSender()`** the first signer among the
  program's accounts.

A program cannot write an account that does not sign (`svm.sstore` refuses it), so a direct cook
cannot write a Pot's storage, and a transfer whose authority is a Pot fails for the missing
signature. Attach the wallet, signing, where the program needs an authority.

## Run with the client

`createSauceSvmClient` requires an RPC URL, engine program ID, Kitchen program ID, and a Kit
transaction signer. It builds the cook `via` names, includes the required heap-frame instruction,
resolves accounts, and builds/signs transactions. The Kitchen ID is required either way: a direct
cook pays the fee its config sets.

Use `v12SvmEngineProgramId()` and `v12SvmKitchenProgramId()` from
`@eco-incorp/sauce/deployments` for the released program identities, and confirm
they are deployed on your cluster. Through the Kitchen the client derives a Pot owned by its
`payer` signer; choose it with `potSalt` when you configure the client. Direct, `payer` signs and
pays the fee, and `potSalt` means nothing.

```ts
import {
  createSauceSvmClient,
  type AccountResolution,
  type SauceSvmClientConfig,
} from "@eco-incorp/sauce/svm";
import type { CompileResult } from "@eco-incorp/sauce/compiler";

export async function simulateProgram(
  config: SauceSvmClientConfig,
  compiled: CompileResult,
  accounts: AccountResolution,
) {
  if (!compiled.manifest) throw new Error("Expected an SVM account manifest");
  const client = await createSauceSvmClient(config);
  return client.simulate(compiled.bytecode, compiled.manifest, accounts);
}
```

For the transfer above, the resolution keys are `sourceAta`, `mint`, `destinationAta`, `owner`, and `tokenProgram`. A non-payer transaction authority should be supplied as `{ address, signer: transactionSigner }`; an address alone cannot provide its signature. A Pot PDA that the Kitchen signs for must be attached with `signer: false` in the transaction resolution. That override represents a signature supplied during invocation, not permission to bypass the program's authority requirement — and a direct cook has no Kitchen to supply it.

Pass `{ accounts: [...] }` to `simulate` to see what the cook would move: the result's `accounts`
holds each one's state after the transaction (`lamports`, `owner`, `data`), or `null` where it no
longer exists, read without sending anything.

After successful simulation, `client.execute(bytecode, manifest, resolution, { computeUnitLimit: "auto" })` simulates for compute budgeting and sends the transaction. `maxExecutionFee` in client configuration is the lamport fee ceiling each cook signs; its default is zero and fails when the Kitchen charges a positive fee. A cook's own `maxExecutionFee` option overrides it.

### When the accounts do not fit

A Solana transaction holds at most 1,232 bytes, and every account it lists takes 32 of them, so a cook that names about thirty accounts no longer fits. An address lookup table is the way around it: a list of addresses kept on chain, which a transaction points into for one byte per account instead of 32. You write no code for it:

- `client.execute` and `client.executeStaged` measure the cook first. When it does not fit, they create a lookup table holding exactly the accounts a table may hold (every account the cook lists except its signers and the programs it calls), wait until the table can be used, and send the cook through it. The payer pays the table's rent and owns it. The result's `lookupTableAddress` names the table: pass it as `lookupTable` to a later cook with the same accounts, and the client uses it again, adding any account it lacks. `lookupTable: false` sends the cook as it is.
- To simulate such a cook first, or to build its transaction yourself, ask for its table with `client.cookLookupTable(bytecode, manifest, resolution)` (`stagedCookLookupTable` for a staged program). It returns `undefined` when the cook fits without one, and otherwise the ready table, whose `lookupTables` you pass on. `simulate` refuses a cook that does not fit and says so.

```ts
import type { CompileResult } from "@eco-incorp/sauce/compiler";
import type { AccountResolution, SauceSvmClient } from "@eco-incorp/sauce/svm";

export async function simulateThenSend(
  client: SauceSvmClient,
  compiled: CompileResult,
  accounts: AccountResolution,
) {
  if (!compiled.manifest) throw new Error("Expected an SVM account manifest");
  const table = await client.cookLookupTable(compiled.bytecode, compiled.manifest, accounts);
  const simulated = await client.simulate(compiled.bytecode, compiled.manifest, accounts, {
    ...(table === undefined ? {} : { lookupTables: table.lookupTables }),
  });
  if (!simulated.ok) throw new Error(`The cook would fail: ${JSON.stringify(simulated.err)}`);

  return client.execute(compiled.bytecode, compiled.manifest, accounts, {
    computeUnitLimit: "auto",
    ...(table === undefined ? {} : { lookupTable: table.lookupTableAddress }),
  });
}
```

`ensureLookupTable(addresses)` is the step underneath, for a table of addresses you choose.

### Select the released programs and quote the fee

Read the program ids from the deployment helpers rather than pasting them, and
confirm each is deployed on the cluster you are targeting.

Every cook pays the Kitchen's fee in lamports, either way, and the fee is read from chain, not
assumed: `fetchExecutionFee` (or a client's `executionFee()`) reads the config account and refuses
one that is not the Kitchen's. This example quotes it, refuses to sign past a budget the caller set,
and signs the quote as the cap:

```ts
import { address, createSolanaRpc, type TransactionSigner } from "@solana/kit";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "@eco-incorp/sauce/deployments";
import { createSauceSvmClient, fetchExecutionFee, type CookVia } from "@eco-incorp/sauce/svm";

export async function createReleasedClient(
  rpcUrl: string,
  payer: TransactionSigner,
  feeBudgetLamports: bigint,
  via: CookVia = "kitchen",
) {
  const kitchen = address(v12SvmKitchenProgramId());
  const fee = await fetchExecutionFee(createSolanaRpc(rpcUrl), kitchen);
  if (fee > feeBudgetLamports) throw new Error(`The execution fee ${fee} exceeds the budget`);
  return createSauceSvmClient({
    rpcUrl,
    payer,
    kitchen,
    programId: address(v12SvmEngineProgramId()),
    maxExecutionFee: fee,
    via,
  });
}
```

The payer needs SOL for this per-cook fee, transaction fees, and any rent or program
spending. The fee charged is the current one, up to the signed cap; a fee increase
above the quoted amount makes the cook fail. Requote before signing a retry.

`resolveAccounts` preserves manifest order. The reserved `payer` reference resolves to the fee payer. A manifest ending with `remaining` leaves the final account tail to the caller; do not insert accounts that shift that tail's indices.

### Build a direct cook yourself

The engine's three paid instructions have builders in `@eco-incorp/sauce/svm` (and the narrow
`@eco-incorp/sauce/svm/engine`): `buildCookAndPayInstruction` for inline bytecode,
`buildCookAndPayFromAccountPinnedInstruction` for a staged program and its digest, and
`buildCookAndPayFromAccountInstruction`, unpinned. Each takes the program's tail and appends the
fee payer, the System Program and the fee config, which the engine takes off before the program
runs:

```ts
import type { Address, TransactionSigner } from "@solana/kit";
import {
  buildCookAndPayInstruction,
  buildHeapFramePrepend,
  deriveExecutionFeeConfigPda,
  type ResolvedAccountMeta,
} from "@eco-incorp/sauce/svm";

export async function directCook(
  engine: Address,
  kitchen: Address,
  wallet: TransactionSigner,
  bytecode: Uint8Array,
  tail: readonly ResolvedAccountMeta[],
  quotedFee: bigint,
) {
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
  return [
    buildHeapFramePrepend(),
    buildCookAndPayInstruction({
      engineProgram: engine,
      feeConfig,
      feePayer: wallet.address,
      maxExecutionFee: quotedFee,
      bytecode,
      tail,
    }),
  ];
}
```

## Stage a larger program

Staging belongs to the Kitchen, whichever way the program then runs. There is no `client.stageBuffer()` convenience method. Build and submit Kitchen instructions in this order:

1. Derive metadata and code addresses with `deriveCodeBufferPda(kitchen, owner, nonce)` and `deriveCodePda(kitchen, codeBuffer)`.
2. Allocate with `buildCreateCodeBufferInstruction`. Capacities above `GROWTH_STEP` require additional `buildGrowCodeBufferInstruction` calls.
3. Write the bytecode in appropriately sized chunks using `buildWriteCodeBufferInstruction`.
4. Finalize with `buildFinalizeCodeBufferInstruction`, supplying the byte length and its SHA-256 digest. Finalization verifies the digest and shrinks the code account to that length.
5. Execute with a Kitchen `buildCookFromAccountInstruction`, the engine's `buildCookAndPayFromAccountPinnedInstruction`, or the client's `simulateStaged`/`executeStaged` methods.

The low-level instruction builders return instructions; the application groups, signs, submits, and confirms them. Every cook requires `buildHeapFramePrepend()` when assembling transactions yourself. A staged client's first argument is the **code-buffer metadata address**; it derives the associated code account.

Through the Kitchen, `buildCookFromAccountInstruction` takes a `pin` the Kitchen checks at execution time, and the Kitchen runs only a finalized buffer the signing owner holds. The client's `expectedSha256` option is rejected there — it is not a substitute for that pin. The digest checked when a buffer is finalized and a digest chosen by a caller at execution are different guarantees about different moments; read both before relying on either.

Direct, the engine checks nothing about the code account — not its owner, not that it is finalized — except, in `cookAndPayFromAccountPinned`, that the SHA-256 of all its data is the digest the instruction carries, and it runs exactly the bytes it hashed. So the client always pins a direct staged cook: to `expectedSha256`, or to the `sha256` of the `StagedBuffer` you pass, and a bare buffer address with neither is refused. `buildCookAndPayFromAccountInstruction` runs whatever the account holds when the transaction lands, with the signer's authority: use it only for an account no one else can change.

## SVM destinations in Eco intents

**The easy way: write the intent in a program.** `Solana(() => { ... }).reward({ ... })` in a
program published from Ethereum or Base builds the Solana route for you
([Sending to Solana](intents.md#sending-to-solana)):

- a body that only pays wallets (`USDC.transfer(recipient, amount)`) becomes Solana's own token
  transfers: the Associated Token Account program's `CreateIdempotent` for each wallet with no
  account yet, the Portal's executor paying the rent, then `TransferChecked` from the executor's
  account;
- any other body is compiled for Solana and cooked through the Kitchen on the executor's Pot. The
  route first creates that Pot if it is missing (`create_pot` needs its owner's signature, and only
  the Portal signs for the executor, so only a route can), creates each token account the program
  names that is missing, and moves what the solver delivered into the Pot.

Which accounts exist decides the route, so it is read from the cluster first: with
`compileSauceProgram`, pass it as `intents.svm` (`potExists`, the token accounts in `existing`,
and the Kitchen's fee as `executionFee`). The `sauce` command reads it for you.

**Building a route by hand.** `Solana(body, { execution, ... }).reward(...)` in TypeScript,
`routes.compileSauceRoute()`, `buildSauceSvmCall()` and `buildSauceSvmCalls()` emit an
`execute_from_account` instruction carrying only its 8-byte discriminator. The engine needs 65
further bytes of Pot derivation material and a trailing Pot signer that the Kitchen supplies, so
that instruction is not one it will run — and pointing the helper at a different engine id does
not add the missing bytes.

The [SVM Portal's fulfillment](https://github.com/eco/eco-routes-svm/blob/5e544b72d368d9d1f0ee5269e2a1a5d2a9f8c2f2/programs/portal/src/instructions/fulfill.rs#L139-L192)
forwards a route's instruction bytes to their target unchanged and signs each
call for its own executor PDA. So the executor can own a Kitchen Pot and cook on
it: the Solana counterpart of an EVM intent's cook on the Executor's shared Pot.
`svm` has the pieces the program path is built from:

- `svmIntentPot({ portal, kitchen })` is the executor's Pot (the zero salt by
  convention), which every intent's cook through that Portal shares: send on in the
  program what the intent delivers.
- `svmIntentPotInstruction(...)` is the Kitchen's `create_pot` with the executor as
  owner and rent payer. One route carries it once, the rent its native amount; a
  second route carrying it fails, the Pot existing.
- `svmIntentCookInstruction({ portal, kitchen, engineProgram, bytecode, manifest,
resolution, maxExecutionFee })` is the Kitchen's `cook` with the executor as owner
  and fee payer, the fee the route's native amount, the program's accounts resolved
  from its manifest as for any cook.
- `svmRouteCalls(portal, instructions, tokens)` turns instructions into route calls.
  The Portal hashes each call account's flags as the fill transaction carries them,
  and a transaction gives an account one set of flags: an account written anywhere
  (the executor paying the cook's fee, the executor's token account the fill funds) is
  committed writable everywhere, and the executor never as a signer. A route committed
  with each call's own flags is another intent, which no fill matches.

Publish a hand-built route with the EVM Portal helpers (`routes.publishAndFundTx`).
The fill must request the engine's heap frame, as every cook does; `sauce intent fill`
adds it when a route call is the Kitchen's. The whole route rides in the solver's one
fill transaction, which Solana caps at 1,232 bytes, and a program's bytecode is most
of it; a fill too large as it is takes its accounts through an address lookup table
the solver creates first, which `sauce intent fill` builds (`lookupTable` in its
result, the table's transactions first).

A route's program runs through the Kitchen, on the executor's Pot: that is what
these builders make, and the `sauce intent` commands take no `--via`. The direct
entry ([Two ways to run a program](#two-ways-to-run-a-program), `via: "engine"`)
is for a cook a wallet sends with its own authority. An executor issuing one is
not something this package builds or tests.

The Portal's own instructions are `buildPortalFulfillInstruction`,
`buildPortalHyperProveInstructions` (the proof through the HyperProver, with the
gas for Hyperlane's delivery paid in the same transaction) and
`buildPortalCancelInstruction`. `decodeFulfillMarker` reads what the Portal
recorded, and `svmTokenTransferCall` is the route call eco-routes' Solana deposit
addresses publish. `sauce intent fill`, `prove` and `cancel` send them
([CLI guide](cli-intents.md#an-intent-to-solana)).

One detail worth knowing if you are reading routes somebody already built:
`execution.code` there means the finalized **code account**, not its metadata
address, and the helper neither stages that code nor checks it against the bytes
it just compiled. Keep the direct compilation result when you inspect one.

An intent can also start on Solana, its reward held by Solana's Portal. The
builders for that side are `buildPortalFundInstruction` (moves the reward into the
intent's vault, `svmVaultPda`), `buildPortalPublishInstruction` (announces the
intent), `buildPortalWithdrawInstruction` (pays the claimant once the proof is
recorded) and `buildPortalRefundInstruction` (returns the reward to its creator).
`decodeSvmProof` reads the proof the HyperProver records when Hyperlane delivers
it. `sauce intent publish --chain solana`, `claim` and `refund` send them
([CLI guide](cli-intents.md#an-intent-from-solana)). A Sauce program running on Solana
cannot open an intent itself: the wallet calls the Portal.

## Venue accessors

The `Solana` accessor, imported from the package root, includes the venues registered for runtime access. A venue accessor exposes a program ID, pool configuration loading, quote-source generation, swap CPI construction, and a TypeScript reference quote:

```ts
import { venue } from "@eco-incorp/sauce/svm";
import type { AccountLoader, SwapUser } from "@eco-incorp/sauce/svm";
import type { Address } from "@solana/kit";

export async function buildRaydiumSwap(
  load: AccountLoader,
  pool: Address,
  user: SwapUser,
  amount: bigint,
) {
  const raydium = venue("raydium-cp-swap");
  const config = await raydium.poolConfig(load, pool);
  return raydium.swap(config, user, amount);
}
```

`Solana.RaydiumCpSwap` exposes the same accessor after `import { Solana } from "@eco-incorp/sauce"`. `poolConfig` uses the account loader you supply; it does not create an RPC client or discover pools. `quoteSource` returns SauceScript source, and `.swap` returns CPI data plus account references, not a transaction.

Venue swap builders use a venue-level minimum output of one; the composed program must enforce the user's actual minimum with a post-swap output balance delta. Runtime accessors cover the registered venue set. Other adapters exported from `/svm` do not automatically appear as `Solana.<Venue>`; consult [coverage](../api/coverage.md).

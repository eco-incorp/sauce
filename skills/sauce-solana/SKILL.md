---
name: sauce-solana
description: Everything Solana changes about a Sauce program. The token methods as on an EVM chain (USDC.transfer(to, amount), self.USDC, Token(mint)) with every account derived and checked on chain; any other account written where it is used (Solana.pda(program, seeds), USDC.accountOf(holder), .writable()) or taken as an Account parameter with Writable/Signer roles; the account manifest and every --account name; binding a slot to the Pot; token accounts; @sauce/token for SPL Token and Token-2022 and its extensions (fees, pauses, frozen accounts, hooks); svm.call and svm.sload; transaction size; running on the owner's Pot or the engine (--via engine), simulating in a local copy, staging, plans for other signers, lookup tables, rent left open. Use when the user targets Solana, SPL tokens, Token-2022, PYUSD or tokenized stocks on Solana, PDAs or CPIs, account manifests, lamport fees, CPI depth, LiteSVM, or a Solana cook that does not fit one transaction.
---

# Sauce on Solana

A Solana transaction lists every account it touches before it runs. This skill owns what that
changes about writing and running a Sauce program: which accounts compiling derives and which a
program takes as parameters, how each is named and checked, the Pot's key, token accounts and both
token programs, transaction size, and running (through the Kitchen or the engine, simulating,
staging, plans for other signers). Swaps at Solana venues are `sauce-swaps`'s; the multi-pool order
is `sauce-solana-distributed-swap`'s.

## When to use

| Task                                                                 | Here                               | Elsewhere                                          |
| -------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| Any program compiled with `--chain solana`                           | yes, beside the skill for its task |                                                    |
| Move or read SPL Token or Token-2022 balances; PYUSD; a stock's mint | yes                                | a stock's symbol and issuer facts: `sauce-globals` |
| A PDA, a CPI, an account read; `--account`                           | yes                                |                                                    |
| A cook too large for one transaction; plans; rent left open          | yes                                |                                                    |
| A swap at a Solana venue                                             |                                    | `sauce-swaps`                                      |

## Core model

- **Every account is known before the transaction runs.** A program gets an account three ways:
  compiling **derives** it for a token method; compiling **adds** it where an expression names it
  (`Solana.pda(...)`, `USDC.accountOf(...)`); or the program declares it as an **`Account`
  parameter** of `main`, attached with `--account`. Compiling returns them all, in order with their
  roles, as the **account manifest**.
- **Every holder and seed must be known when the cook is built**: `ctx.self()`, an `Address`
  argument of `main`, a key written out, or a program account. One computed as the program runs is
  refused.
- **Each derived account is checked on chain**, because a transaction built another way could
  attach another account in its slot.
- **A Solana key is base58 or its 32 bytes as 0x hex** wherever the command takes one: `--owner`,
  `--account` and every key in its names, `--lookup-table`, a mint in `--assume-balance` and
  `sauce pools`, a wallet policy's `to` and `tokens`, and the MCP tools' `owner` and `accounts`.
  The hex is how `sauce globals --chain solana --json` prints a token's `address`.
- **The Pot** is the Kitchen's program address for `"pot"`, its owner and a 32-byte salt (zero
  unless `--salt` names another). `ctx.self()` alone is the engine's program id, which owns every
  Pot account, **not the Pot**; as a token's holder it is the Pot, as `self` is: `self.USDC` is
  the Pot's USDC.
- **Two token programs**: SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) and Token-2022
  (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). USDC, USDT and WSOL are SPL Token mints; PYUSD
  and the tokenized stocks are Token-2022 mints.
- **A transaction is at most 1,232 bytes**; a program that does not fit is staged first, which
  `sauce run` does.
- **No protocol namespaces**: a program calls another program with `svm.call`; the price-limit
  venues are namespaces of their own, their protocol then their program
  (`Orca.Whirlpool.swap(pool, …)`), each finding its pools by key
  (`Orca.Whirlpool.pool(USDC, WSOL, 4)`, `sauce-swaps`). `sauce globals --chain solana` lists the
  mints (devnet's too), the venues and the account expressions.

| The account                                                                           | Write                                                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A token account a token method moves through                                          | nothing: `USDC.transfer(to, amount)` derives it                                                                   |
| An account derivable from known values (a PDA, an ATA, a program, the Pot, the owner) | the expression where it is used: `Solana.pda(program, [seeds])`, `USDC.accountOf(holder)`, `Solana.systemProgram` |
| An account computed as the program runs, or whose identity the caller supplies        | an `Account` parameter, attached with `--account NAME=<value>`                                                    |

## The token methods

A program pays, approves and reads a token as it does on an EVM chain:

```sauce chain=solana
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

```sh
sauce run pay.sauce.ts --chain solana --keypair <keypair> --args <recipient> 400
```

The same file compiles for Base. On Solana, compiling adds every account the calls move through to
`main`, after `main`'s own parameters, each with a `derive`: an `--account` value saying where it
comes from.

| Slot           | `derive`                                      | The account                              |
| -------------- | --------------------------------------------- | ---------------------------------------- |
| `tokenProgram` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | the token program that owns the mint     |
| `pot`          | `self`                                        | the Pot, which signs for its accounts    |
| `potUSDC`      | `self:USDC`                                   | the Pot's USDC account                   |
| `toUSDC`       | `@to:USDC`                                    | the USDC account of main's argument `to` |

- **Nothing to attach.** `sauce run`, `simulate` and `tx` derive every such slot from the owner, the
  Pot and `main`'s arguments, so the program runs with `--args` alone. `sauce compile --json` lists
  each slot with its `derive`; `--account NAME=<value>` replaces one.
- **A holder** is `self` (or `ctx.self()`), the Pot; `Solana.owner`; a parameter of `main` declared
  `Address`; a token's mint (`USDC.WSOL`, the USDC mint's own WSOL account); or a 32-byte key
  written out. Its balance is `<holder>.<TOKEN>` (`self.USDC`,
  `to.USDC`), the same read as `USDC.balanceOf(to)`, and its lamports `<holder>.SOL` (`self.SOL`),
  read with `ctx.balance` from its account, which is added to `main`. For a holder computed as the
  program runs, take
  its token account as an `Account` parameter and pass it where the holder goes
  (`USDC.transfer(dest, amount)` with `dest: Account<Writable>`). **That account is paid as
  attached**: nothing checks whose it is, so prefer an `Address` recipient, or check it yourself,
  `require(ownerOf(USDC, dest) == expected, "not theirs")`.
- **Each account is checked on chain.** After each write the program requires the token account it
  paid, or paid from, to belong to the holder named, refusing another with `wrong recipient account`,
  `wrong sender account` (`transferFrom`), `wrong spender account` (`approve`) or
  `wrong holder account` (a read).
- **Each mint's own write.** An SPL Token mint (USDC, USDT, WSOL) moves by the plain
  `transfer`/`approve`: for such a mint it does what the checked write does, in about 220 bytes less
  and one account fewer. A Token-2022 mint (PYUSD, the stocks) moves by
  `transferChecked`/`approveChecked`, with the registry's decimals and the mint as one more account.
  `Token(mint)`, for a mint given as an `Address` argument, takes the checked write, with the
  decimals read from the mint; its token program is read from the cluster when the cook is built,
  and a mint whose program cannot be read is refused, never assumed. Every write requires its token
  program to be SPL Token or Token-2022 (`not the token program`).
- **A Token-2022 transfer fee** is withheld from what arrives: measure the recipient's balance before
  and after.
- **A recipient with no token account yet**: `sauce run` creates its associated token account
  before the cook, the owner paying the rent, asking first or with `--yes`.
- **The methods stand in `main` itself**, not in a helper, in a file that has a `main`: the added
  accounts are `main`'s parameters. Cooked directly (`--via engine`), `self` is the signer, and its
  own token accounts pay.

The methods lower to the `@sauce/token` functions (below), which a program can also call with the
accounts written out.

## Accounts where they are used

For what the token methods do not cover (a call into another program, a read of an account a program
derives), write each account where it is used. Compiling adds it to `main` with its `derive`, so the
program still runs with `--args` alone. This one wraps the owner's SOL into the Pot's WSOL account,
calling the System Program's transfer, then SPL Token's SyncNative:

```sauce chain=solana
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

```sh
sauce run wrap.sauce.ts --chain solana --keypair <keypair> --args 1000000
```

| Expression                      | The account                                 | `derive`                              |
| ------------------------------- | ------------------------------------------- | ------------------------------------- |
| `Solana.pda(program, [seeds])`  | the address `program` derives for the seeds | `pda:<program>:<seeds>`               |
| `Solana.account(key)`           | the account at a key                        | the key, or `@<parameter>`            |
| `Solana.self`                   | the Pot (the signer with `--via engine`)    | `self`                                |
| `Solana.owner`                  | the Pot's owner, who signs the cook         | `owner`                               |
| `Solana.systemProgram`          | the System Program                          | its id                                |
| `Solana.tokenProgram`           | SPL Token                                   | its id                                |
| `Solana.token2022Program`       | Token-2022                                  | its id                                |
| `Solana.associatedTokenProgram` | the Associated Token Account program        | its id                                |
| `Solana.memoProgram`            | the Memo program                            | its id                                |
| `USDC.accountOf(holder)`        | the holder's associated USDC account        | `self:USDC`, `owner:USDC`, `@to:USDC` |
| `USDC.mint`                     | USDC's mint                                 | `mint:USDC`                           |
| `USDC.tokenProgram`             | the token program that owns the mint        | its id                                |

- **Roles.** Each account is read-only. `.writable()` and `.signer()` give it the role a call needs,
  and they chain: `Solana.owner.writable().signer()`. An account written more than once is one slot,
  with every role any of its uses gives it.
- **Known when the transaction is built.** A program, key or holder is a parameter of `main`
  declared `Address`, a 32-byte key written out, `ctx.self()`, `Solana.self` or `Solana.owner`, or a
  program account such as `Solana.tokenProgram`. A seed can be any of those, and also a token symbol
  or `USDC.mint` (the mint's key), a string of 32 bytes at most, `.toBytesLe(n)` of an integer
  parameter or literal (`n` 1, 2, 4, 8 or 16), or ``hex`…` ``. A seed computed as the program runs
  is refused: take that account as an `Account` parameter instead.
- **Each slot's name** says what it holds: `systemProgram`, `potWSOL`, `toUSDC`. An address
  `Solana.pda` derives is named for the constant it initializes (`destPda` for `const dest`), else
  for its first string seed (`statePda` for `"state"`).
- **Each is checked on chain**, at the top of `main` before the program's own code, refusing an
  account in the wrong slot with `wrong account` (`Solana.account(key)` is not at `key`),
  `wrong program-derived address` (the engine derives `Solana.pda(program, [seeds])` again, at the
  canonical bump, and it is not that address), `wrong holder account` (`USDC.accountOf(holder)` is
  not a token account of USDC's mint, owned by a token program and held by `holder`), `wrong mint`,
  or `wrong program`. The Pot and the owner are pinned by their signatures: a holder or seed made of
  either one becomes a signer; elsewhere, give an account `.signer()` where its identity matters. An
  `--account` that replaces one of these must pass the same check. Each check costs bytes: the first
  `accountOf` about 290 (it compiles in `@sauce/token`'s account check, which the token methods'
  reads share), each other 25 to 60.
- **`accountOf` names an account that exists**: its check reads it when the program starts, and
  `sauce run` creates a missing one before the cook (asking first, or with `--yes`). For an account
  the program creates itself, use the address the Associated Token Account program derives, which
  that program checks when it creates it:
  `Solana.pda(Solana.associatedTokenProgram, [holder, Solana.tokenProgram, USDC])`.

## Account parameters

`@sauce/token`'s functions take the mint first, then the accounts, with no import; a registered
symbol on its own is its mint's 32-byte key (`balanceOf(USDC, account)`):

```sauce chain=solana
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  destination: Account<Writable>,
  authority: Account<Signer>,
  mint: Address,
  amount: Uint256
): Uint256 {
  const before = balanceOf(mint, destination);
  transfer(mint, tokenProgram, source, destination, authority, amount);
  const after = balanceOf(mint, destination);
  require(after - before == amount, "destination did not receive the amount");
  return after;
}
```

```sh
sauce compile solana.sauce.ts --chain solana --json
sauce run solana.sauce.ts --chain solana --keypair <keypair> \
  --account tokenProgram=<SPL Token program> --account source=<the Pot's token account> \
  --account destination=<token account> --account authority=pot --args <mint> 400
```

- **Roles.** `Account` is read-only; `Account<Writable>` and `Account<Signer>` declare the role the
  transaction must grant. The manifest records `readonly`, `writable`, `readonly_signer` or
  `writable_signer` per slot. Roles are the author's declaration; nothing infers them from what a
  CPI needs.
- **A missing `Account` is refused before anything is read.** A cook not given one of `main`'s
  `Account` parameters is refused with each missing account, the values that suit its role (`pot`
  or `owner` for a signer, `pot:<token>` for a token account, `program:<token>` for a token
  program) and the JSON object `--accounts <file>` takes them all from, to fill in.
  `sauce compile --json` lists the same, each account's name, role and forms, as `accountsToGive`.
- **An `Account` compares by identity** (`tokenProgram.address == splToken`, with the SPL Token
  program an `Address` argument, or its 32-byte hex
  `0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9` as a literal) and exposes
  `.owner` and `.dataLen`. Check the owner before trusting bytes: a hand-made account can carry any
  layout.
- **`svm.sload(account, offset, length)`** reads bytes (`.toLe()`/`.toBe()` make a number);
  **`svm.call(program, [accounts...], data)`** is a CPI to an attached program account. Move
  lamports with a System Program CPI.
- **Scalar parameters are runtime arguments** (`--args`); `Account` parameters are not encoded. A
  32-byte key the program is given, such as a mint, is an `Address` argument passed as a base58
  public key (or its 0x hex), or as a registered token, `USDC` or `mint:USDC`, meaning its mint; it
  is encoded as one ABI word. It is an `Account` parameter when the
  program reads or writes that account. A registered symbol (`USDC`) is mainnet's mint; for
  devnet's, pass the key `sauce globals --chain solana` lists.
- **`ctx` on Solana**: `ctx.msgSender()` is the first signer among the accounts the engine receives
  (the Pot, when a `pot` slot is attached as the Pot), not proof of who sent the transaction;
  `ctx.balance(acct.address)` is an attached account's lamports; `ctx.msgValue`, `ctx.gasLeft`,
  `ctx.codeSize` and the other EVM reads are rejected. Every read per target is in
  [../sauce-script/references/builtins.md](../sauce-script/references/builtins.md).

### `--account` names

Each slot is passed by its name, `--account NAME=<value>`, or all of them in one JSON object with
`--accounts <file>`. A value is an address or one of (every key in these forms may also be 0x hex):

| Value                        | The account                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pot`                        | the Pot, which the Kitchen signs for                                                                                                                                                                                                                                                                                                        |
| `owner`                      | the signer                                                                                                                                                                                                                                                                                                                                  |
| `self`                       | the Pot, or the signer with `--via engine`                                                                                                                                                                                                                                                                                                  |
| `system`                     | the System Program                                                                                                                                                                                                                                                                                                                          |
| `@to`                        | `main`'s argument `to`                                                                                                                                                                                                                                                                                                                      |
| `<holder>:<token>`           | the holder's associated token account for a mint: the holder `pot`, `owner`, `self`, `@to` or a base58 key; the token a symbol, a base58 mint, or `@mint` for `main`'s argument `mint`                                                                                                                                                      |
| `mint:<token>`               | the mint                                                                                                                                                                                                                                                                                                                                    |
| `program:<token>`            | the mint's token program, SPL Token or Token-2022, read from the cluster for a mint given by address                                                                                                                                                                                                                                        |
| `slot:<pool>:<token>.<part>` | one of a pool's nine accounts paying the token (`program`, `pool`, `config`, `vaultA`, `vaultB`, `extra`, `ticks0` to `ticks2`), read from the pool on the cluster, the pool a base58 key or `@pool`                                                                                                                                        |
| `pda:<program>:<seeds>`      | the address a program derives for its seeds: the program a base58 key or `@prog`; the seeds comma-separated, each `"text"` or a bare word (its bytes), `pot`, `owner`, `self`, `@to` or a base58 key (its 32 bytes), `mint:USDC` (the mint's key), `u8:7` to `u128:7` or `u64:@index` (an integer, little-endian), or hex digits after `0x` |

The Pot itself is `pda:<the Kitchen program id>:"pot",owner,<its 32-byte salt>`.

## The Pot's key

Declared `pot: Account<Signer>` and passed as `--account pot=pot`, the Pot's slot proves nothing by
itself: a `Signer` slot takes any signer (`pot=owner` satisfies it too); `ctx.msgSender()` is only
the first signer the engine receives; and `pot.owner == ctx.self()` says only that the engine owns
the account. **The engine owns every Pot, but not only Pots**: a keypair account assigned to the
engine, which the transaction signs, passes that check as well.

**To bind the slot to the Pot, re-derive the Pot's address and require the slot to be it.** Only a
Kitchen cook can make that address sign, so a signing slot at it is the Pot. Take the owner as a
signer slot of its own (`--account wallet=owner`) and the Kitchen program as an argument: its id is
`svm.kitchen.programId` in
[../sauce-chains/references/deployments.json](../sauce-chains/references/deployments.json), the same
on every cluster (`svm.kitchen.key` is its 32-byte hex). Bind an account's key to a local before
calling a method on it.

```sauce chain=solana
function main(pot: Account<Signer>, wallet: Account<Signer>, kitchen: Address, salt: Uint256) {
  const owner = wallet.address;
  const [expected] = crypto.findPDA(kitchen, ["pot", owner.toBytesBe(32), salt.toBytesBe(32)]);
  require(pot.address == expected, "pot is not the wallet's Pot");
}
```

```sh
sauce run pot.sauce.ts --chain solana --keypair <keypair> \
  --account pot=pot --account wallet=owner --args <the Kitchen program id> 0
```

A Pot under another salt passes that salt, as a 32-byte number, in place of `0`. The binding is a
Kitchen cook's: a direct cook (`--via engine`) runs as no Pot, so a slot that must sign cannot be
`pot` there.

## Token accounts

An SPL token account is 165 bytes, and `acct.owner` is the program that owns it, not whose balance
it is. A Token-2022 account has the same first 165 bytes, then its extensions:

| Bytes   | Field                              | Read                             |
| ------- | ---------------------------------- | -------------------------------- |
| 0–32    | mint                               | `svm.sload(acct, 0, 32).toBe()`  |
| 32–64   | owner: whose balance it is         | `ownerOf(mint, acct)`            |
| 64–72   | amount (u64, little-endian)        | `svm.sload(acct, 64, 8).toLe()`  |
| 72–76   | delegate tag (u32: 0 none, 1 some) | `svm.sload(acct, 72, 4).toLe()`  |
| 76–108  | delegate                           | `svm.sload(acct, 76, 32).toBe()` |
| 121–129 | delegated amount (u64)             | `svm.sload(acct, 121, 8).toLe()` |

`USDC` on Solana is mainnet's USDC mint, `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, whose
32-byte key is `0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61`;
`balanceOf(USDC, account)` takes it as it is. On devnet USDC is another mint,
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: a program for devnet takes the mint as an `Address`
argument. The Solana file in `sauce-chains` lists every registered mint, mainnet's and devnet's.

`--account <name>=pot` attaches **the Pot's own account**, not its USDC. The Pot's USDC is a token
account of its own, so a program reading it takes that account and checks whose it is:

```sauce chain=solana
function main(
  pot: Account<Signer>,
  wallet: Account<Signer>,
  potUsdc: Account,
  kitchen: Address,
  salt: Uint256
): Uint256 {
  const owner = wallet.address;
  const [expected] = crypto.findPDA(kitchen, ["pot", owner.toBytesBe(32), salt.toBytesBe(32)]);
  require(pot.address == expected, "pot is not the wallet's Pot");
  require(ownerOf(USDC, potUsdc) == pot.address, "not the Pot's USDC account");
  return balanceOf(USDC, potUsdc);
}
```

Run it with `--account pot=pot --account wallet=owner --account potUsdc=pot:USDC` (the Pot's
associated token account for the mint; `owner:USDC` the owner's) and
`--args <the Kitchen program id> 0`. The first check binds `pot` to the wallet's Pot; the second
binds the token account to `pot`. Passing the Pot for that slot fails the checks with no message
(the Pot is not a token account), and so does an account that does not exist: **a Pot with no USDC
account holds no USDC**. `sauce pot --chain solana --owner <pubkey>` lists the Pot's account for each
registered mint, whether it exists and what it holds.

- **Check the owner before calling a balance the Pot's**: a transfer with the Pot as `authority` also
  succeeds from an account where the Pot is only a delegate, up to the delegated amount.
- **The Pot's tokens sit in its associated token accounts**, the ATA of (Pot, mint) under the mint's
  token program. Derive one with `findAssociatedTokenPda` and create it with
  `getCreateAssociatedTokenIdempotentInstruction`, both from `@solana-program/token`, passing the
  mint's token program as `tokenProgram` (Token-2022 for PYUSD), then fund it with an ordinary
  transfer from any wallet (`--fund` is EVM only). `@solana/kit` and `@solana-program/token` are
  dependencies of the package, not of your project: add them to it before importing them.

## `@sauce/token` on Solana

The arm takes the mint first, then the accounts:

| Kind                           | Functions                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reads, either program          | `balanceOf(mint, account)`, `allowance(mint, account, spender)`, `ownerOf(mint, account)`, `totalSupply(mintAccount)`, `decimals(mintAccount)`                                                                                                                                                                                                                           |
| Checked writes, either program | `transferChecked(mint, tokenProgram, source, mintAccount, dest, authority, amount, decimals)`, `approveChecked(mint, tokenProgram, source, mintAccount, delegate, authority, amount, decimals)`: `tokenProgram` owns the mint, source and destination; the account after the source is the mint's own, which must be the mint named first; `decimals` must be the mint's |
| Legacy writes, SPL Token only  | `transfer(mint, tokenProgram, source, dest, authority, amount)`, `approve(mint, tokenProgram, source, delegate, authority, amount)`, `transferFrom` (the same instruction: SPL has one transfer for owners and delegates); they refuse a Token-2022 account or program                                                                                                   |

- Every function checks the account's program and mint, and every write rejects an amount above
  `u64`. Each check reverts with its reason, which `sauce simulate` prints: `not a token account`,
  `wrong mint`, `not a mint`, `uninitialized mint`, `not the token program`, `amount over u64`,
  `wrong decimals` and `transfer hook`.
- Move a Token-2022 token with `transferChecked`: Token-2022 refuses its plain transfer for a mint
  with a transfer fee, a transfer hook or a pause.
- SPL tracks one delegate per account, so a second approval replaces the first.
- A transfer's `authority` may be the source's owner or its delegate, so a transfer that succeeds
  does not show whose `source` is. `ownerOf(mint, account)` reads the token account's owner (the
  wallet or PDA whose balance it is, not `account.owner`): before treating a balance as the Pot's,
  `require(ownerOf(USDC, source) == authority, "not the Pot's account")`.

### Token-2022 extensions

| Extension                                            | What a program sees                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer fee                                         | The destination receives the amount less the fee, which the mint withholds. Measure what arrived (`balanceOf` before and after), never the amount sent. |
| Scaled UI amount                                     | A display multiplier, for wallets. Balances, amounts and transfers are raw base units; a program never sees a UI amount.                                |
| Pausable                                             | While the issuer has paused the mint, every transfer fails: `Token-2022 refused: Transferring, minting, and burning is paused on this mint`.            |
| Default account state, frozen                        | A new account starts frozen until the issuer thaws it, and a transfer into or out of a frozen account fails: `Token-2022 refused: Account is frozen`.   |
| Transfer hook with no program                        | No hook: the mint transfers as any other. Tokenized stocks carry one.                                                                                   |
| Transfer hook that names a program                   | Refused, `transfer hook`, before anything moves: the hook's own accounts are not passed.                                                                |
| Permanent delegate, confidential transfers, metadata | Nothing for a program: reads and checked writes work as on a legacy mint.                                                                               |

A paused mint or a frozen account fails the whole transaction with the token program's error, which
`sauce simulate` prints.

```sauce chain=solana
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  mint: Account,
  destination: Account<Writable>,
  pot: Account<Signer>,
  amount: Uint256
): Uint256 {
  require(ownerOf(PYUSD, source) == pot.address, "not the Pot's account");
  const before = balanceOf(PYUSD, destination);
  transferChecked(PYUSD, tokenProgram, source, mint, destination, pot, amount, 6);
  return balanceOf(PYUSD, destination) - before;
}
```

A token account's address derives from its owner, its mint and the mint's token program, so the
Pot's PYUSD account is not where an SPL Token derivation puts it; name each by its token:

```sh
sauce run token-2022.sauce.ts --chain solana --keypair <keypair> \
  --account tokenProgram=program:PYUSD --account source=pot:PYUSD --account mint=mint:PYUSD \
  --account destination=<token account> --account pot=pot --args 400
```

## Transaction size

A Solana transaction is at most **1,232 bytes**. The final size includes the program, ABI
arguments, accounts, signatures and transaction setup. Compiler/release changes can alter the
program size, so budget from the current compiled artifact and serialized transaction, not a
fixed per-operation estimate.

Longer messages and more calls increase the program; additional accounts increase transaction
metadata unless compressed through a lookup table. ABI scalar inputs take 32 bytes each;
dynamic inputs add offsets, lengths and data. `sauce compile --json` reports program/payload size,
and `sauce tx` reports whether the cook fits.

A program that does not fit is **staged**: written into a code buffer first, then cooked from it.
`sauce run` handles staging. Token-2022 account checks and larger multi-call programs can require it;
use the current program's measured size rather than assuming every transfer fits.

## Running

Solana is a supported chain: its cooks and Pots are built and sent.

1. **The Pot** is the Kitchen's address for the owner and salt:
   `sauce pot --chain solana --owner <pubkey>` prints it. It needs no step of its own: a cook on a
   Pot the Kitchen has not created yet creates it in the same transaction, ahead of the cook (`sauce tx`'s transaction carries it,
   `createsPot`); where the two do not fit in one transaction `sauce run` asks first, or creates it
   with `--yes`. `sauce pot --deploy --chain solana --keypair <keypair>` creates it by hand. A cook
   names its Pot by `--owner` (and `--salt`), never `--pot`.
2. **The fee** is the Kitchen's execution fee in lamports, read from the cluster and printed as
   `fee`, so there is no `--value`; `--max-execution-fee <lamports>` refuses a cook whose fee is
   above it.
3. **Simulate.** `sauce simulate` runs the cook from `--owner` with no signature and prints the
   compute units, or the reason (a `throw` or `require` message, decoded) and the program logs, and
   what moved. Solana's own simulation takes no account overrides, so there the owner must hold the
   Pot's rent and the fees. **In a local copy**: a cook too large for one transaction, or one given
   `--assume-balance`, runs in a local copy of every account the cook names, read from the cluster as
   it is, with its rent and the released engine and Kitchen (LiteSVM, which the first simulation
   installs for the command): the Pot created where missing, the owner given the lamports staging and
   fees take, the program staged as `sauce run` stages it, then the cook. Nothing is signed or sent.
   `--assume-balance USDC:1000` (whole tokens) gives the account the cook spends USDC from (the
   Pot's, or the owner's with `--via engine`) that balance; a `pot:<token>` or `owner:<token>`
   account the cluster lacks is made empty, with a note. The owner must be a wallet, or an address
   with no account: it signs and pays. Before any of this, and before `run`, `tx` or
   `pot --deploy`, the command holds the cluster's engine and Kitchen to the release's own programs,
   and refuses a cluster where either is missing or another build: `the released Kitchen <id> is not
deployed on solana: this SDK's cook cannot run there` (with `--via engine`, the engine alone, and
   the Kitchen too when the program is staged). A plan carried on later, and a transaction a wallet
   sends for another step, are held to it again on the endpoint they go to, before anything is signed.
4. **Send.** `sauce run` signs with `--keypair` (or `--wallet`), stages the program when it does not
   fit, creates the token accounts the cook names that are missing (asking first, or with `--yes`),
   and sends. A cook that succeeds, simulated or sent, leads with what it leaves in the Pot's token
   accounts (`Left in the Pot`, `leftInPot` in `--json`); a sent one prints its Solscan page and its
   trace, links for the user to open, and each token account's change. A failed `sauce run` prints
   the program logs.
5. **For another signer**, `sauce tx` prints a base64 transaction for the owner's wallet; signed
   there, `sauce send <signed> --chain solana` checks every signature, simulates it as signed, sends
   it and prints what it did, with what `main` returned as hex. Its blockhash expires about a minute
   after `sauce tx` built it, after which it is refused, to build and sign again.

**Through the Kitchen or directly.** `--via kitchen`, the default, is the Kitchen's cook on the
owner's Pot: the program holds and spends what the Pot owns and can write the Pot's storage.
`--via engine` calls the engine itself, with no Kitchen and no Pot: nothing is created, and the
signer (`--keypair`, or `--owner` for `simulate` and `tx`) pays the fee and is the authority the
program acts with: spend from the signer's own token accounts and pass `NAME=owner` where an
authority signs. A direct cook leaves the program one more level of CPI depth. Both pay the same fee
into the Kitchen's treasury:

```sh
sauce run solana.sauce.ts --chain solana --keypair <keypair> \
  --via engine --account tokenProgram=<SPL Token program> \
  --account source=<the signer's token account> --account destination=<token account> \
  --account authority=owner --args <mint> 400
```

**A plan of several transactions.** For any signer other than the `sauce` command, `sauce tx` prints
a cook past one transaction as a plan of steps: the setup (the Pot and the token accounts the cook
names, where missing; the program staged in a code buffer; a lookup table, where the accounts do not
fit), the cook, then the buffer's close.

- A step is `{ step, plan, transactions, cursor }`, each transaction `{ what, transaction, feePayer }`,
  base64 for the owner to sign, all on one blockhash that expires in about a minute.
- `sauce send <signed>… --cursor <cursor>` sends them in order and returns `next`, the step after,
  built fresh from what the cluster shows, with its own cursor, until `next.step` is `done` (a setup
  of more than 32 transactions comes in several steps). What did not land is built again, so a slow
  signer re-signs only what is left: the cursor alone builds that step.
- The owner signs and pays every transaction; none needs a fresh keypair.
- A transaction broadcast another way is confirmed with `--signature <signature>`, so the plan knows
  how its cook went (a cook it handed out is never built again while it can still land, nor once it
  has). A wallet's MCP server that signs and sends in one step (`sauce-cli`) returns the signature
  to pass. `--close` gives up on the cook and closes the buffer, once a cook handed out can no longer
  land.
- A step with nothing to sign says why in `wait`: a cook through a lookup table extended a moment
  ago waits a slot, about half a second; the cursor alone, sent again, builds the cook.
- A cook its simulation says would fail is not built: the step says why in `fails`, with the
  simulation's `logs` (`sauce tx` exits 1), and once what it needs is there the cursor alone
  simulates it again.

**Accounts past one transaction go through a lookup table.** Each account a transaction lists costs
32 bytes, one taken through an address lookup table one byte. `sauce run` creates a table holding a
staged cook's accounts when they do not fit, from the signer, which pays its rent, and prints its
address; `--lookup-table <address>` (on `run`, `simulate` and `tx`) takes the accounts through a
table that holds them, so a later cook naming the same accounts reuses it.

**What a first run costs.** Beside the cook's `fee`, the owner pays the rent of what a run creates
and a fee per transaction. Rent is the rent-exempt minimum, `(data bytes + 128) × 6,960` lamports
(3,480 per byte-year, for two years) at mainnet's rate, so these figures are approximate and move
with the cluster's rent:

| What                                     | Lamports                                                                             | About                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| the Pot, 10,240 bytes, created once      | 72,161,280                                                                           | 0.072 SOL                                        |
| a token account, 165 bytes (SPL Token)   | 2,039,280                                                                            | 0.002 SOL; a Token-2022 one with extensions more |
| a code buffer, 91 bytes, and its code    | 1,524,240 + (payload bytes + 128) × 6,960, the payload the program and its arguments | back to the owner when the buffer closes         |
| a lookup table, 56 bytes and 32 an entry | 1,280,640 + 222,720 for each address it holds                                        | back to the owner when the table closes          |
| each transaction's signature             | 5,000                                                                                | a staged run sends several transactions          |

**Rent left open.** A code buffer a plan never closed, and the lookup tables cooks keep for the next
cook, hold the owner's rent. `sauce reclaim --chain solana --owner <pubkey>` lists them with that
rent and prints the transactions that close them, unsigned (the tool `sauce_reclaim`); with
`--keypair <keypair>` it sends them.

- A buffer closes at once; a table is deactivated first and closed about 512 slots later (run it
  again then; the listing names the slot), serving cooks until then and none after, so
  `--keep-tables` leaves the tables.
- Nothing in use is closed: a buffer or an active table a transaction named in the last 300 slots is
  listed in use, with the slot it can close from; `--keep <cursor>` keeps a plan still under way
  whole.
- A run takes 32 code buffers and 24 lookup tables at most, the tables it can act on first, and says
  how many remain (`remaining`).

**The programs.** The engine and Kitchen program ids are `svm.engine` and `svm.kitchen` in
[../sauce-chains/references/deployments.json](../sauce-chains/references/deployments.json), the same
on every cluster; confirm both are deployed on the cluster (`getAccountInfo` returns an executable
account). For a local run the package ships both programs, to load into a local validator or
LiteSVM (`sauce-typescript` says where they are).

**Testing.** A program is tested end to end with no funds through `@eco-incorp/sauce/testing`
(`sauce-typescript`); a recording pins the slot it was read at, since a Solana node serves accounts
only as they are now.

## Pitfalls

- **`ctx.self()` alone as the Pot.** It is the engine's program id; only as a token's holder is it
  the Pot. Bind a `pot` slot by re-deriving its address.
- **A holder or seed computed as the program runs.** Refused: take the account as an `Account`
  parameter.
- **An `Account` destination trusted unchecked.** It is paid as attached; check `ownerOf` or use an
  `Address` recipient.
- **A Token-2022 mint moved by the legacy `transfer`.** Use `transferChecked` (the token methods do).
- **The amount sent taken as the amount received** for a mint with a transfer fee. Measure the
  delta.
- **The Pot's own account passed as its token account.** `pot` is the Pot; its USDC is `pot:USDC`.
- **A wallet passed where a token account goes.** A token program refuses a wallet as a token
  account (InvalidAccountData); a failed cook says so. Give the wallet's associated token account,
  `--account dest=<wallet>:USDC`, which `sauce run` creates where it is missing.
- **An SPL derivation for a Token-2022 account.** An ATA derives under the mint's own token program.
- **`--fund` on Solana.** It is EVM only: fund the Pot's token account by a transfer.
- **A program past 1,232 bytes sent by another tool unstaged.** Use `sauce run`, or the plan
  `sauce tx` prints.

## Files

- [examples/pay.sauce.ts](examples/pay.sauce.ts) pays USDC with the token methods, every account
  derived; the same file compiles for Base.
- [examples/wrap.sauce.ts](examples/wrap.sauce.ts) wraps SOL into the Pot's WSOL with every account
  written where it is used.
- [examples/solana.sauce.ts](examples/solana.sauce.ts) is the program with its accounts written out.
- [examples/token-2022.sauce.ts](examples/token-2022.sauce.ts) moves PYUSD with `transferChecked`.
- [examples/solana.mts](examples/solana.mts) compiles them and pins the accounts the token methods
  add and how each is derived, the checks and their reasons, the manifest order and roles, the
  arguments, the mints' token programs, a cook's size, and that the client refuses to run without
  an `rpcUrl`.

---
name: sauce-solana
description: Writing and running Sauce programs on Solana (the SVM target) — the token methods as on an EVM chain (USDC.transfer(to, amount), approve, transferFrom, USDC.balanceOf(ctx.self()), Token(mint)) with every account derived and checked on chain, any other account written where it is used (Solana.pda(program, seeds), USDC.accountOf(holder), Solana.systemProgram, .writable()) or taken as an Account parameter with Writable/Signer roles, the account manifest, --account names, the @sauce/token arm for SPL Token and Token-2022 and what Token-2022's extensions do to a program (fees, scaled UI amounts, pauses, frozen accounts, hooks), svm.call CPIs and svm.sload reads, and how a program runs with sauce run --chain solana, on the owner's Pot or on the engine (--via engine). Use when the user targets Solana, SPL tokens, Token-2022, PYUSD or tokenized stocks on Solana, PDAs or CPIs, account manifests, lamport fees, CPI depth, LiteSVM, or Solana venues such as Raydium, Orca or Meteora.
---

# Sauce on Solana

A Solana program must declare every account it touches before it runs. In SauceScript those are
`Account` parameters of `main`; the compile returns them, in order and with their roles, as the
**account manifest**, and each is attached when the program runs. A program for Solana is compiled
with `--chain solana`, and its signatures are annotated. A registered token symbol (`USDC`, `USDT`,
`WSOL`, `PYUSD`, the tokenized stocks) has the same methods as on an EVM chain, and compiling adds
the accounts they move through to `main` for you; any other account can be written where it is used
(`Solana.pda(program, [seeds])`, `USDC.accountOf(holder)`), and compiling adds it the same way.
Protocol namespaces do not exist on Solana.
`sauce globals --chain solana` lists the mints (devnet's too) and which of them are Token-2022 mints.

## The token methods

A program pays, approves and reads a token as it does on an EVM chain:

```sauce chain=solana
function main(to: Address, amount: Uint256) {
  require(USDC.balanceOf(ctx.self()) >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

```sh
sauce run pay.sauce.ts --chain solana --keypair <keypair> --args <recipient> 400
```

The same file compiles for Base. On Solana, compiling it adds every account the calls move through
to `main`, after main's own parameters. The manifest gives each one a `derive`: an `--account` value
saying where the account comes from.

| Slot           | `derive`                                      | The account                              |
| -------------- | --------------------------------------------- | ---------------------------------------- |
| `tokenProgram` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | the token program that owns the mint     |
| `pot`          | `self`                                        | the Pot, which signs for its accounts    |
| `potUSDC`      | `self:USDC`                                   | the Pot's USDC account                   |
| `toUSDC`       | `@to:USDC`                                    | the USDC account of main's argument `to` |

- **Nothing to attach.** `sauce run`, `simulate` and `tx` derive every such slot from the owner,
  the Pot and main's arguments, so the program runs with `--args` alone. `sauce compile --json`
  lists each slot with its `derive`. `--account NAME=<value>` replaces one, in the same language
  (below).
- **Every holder is known when the transaction is built.** A holder can be:
  - `ctx.self()` (or `self`): the Pot. `self.USDC` is its balance.
  - a parameter of `main` declared `Address`: its argument;
  - a 32-byte key written out.

  A holder computed as the program runs is refused: no transaction can attach its account. Instead,
  take that token account as an `Account` parameter and pass it where the holder goes
  (`USDC.transfer(dest, amount)` with `dest: Account<Writable>`). **That account is paid as
  attached**: the call names no holder, so nothing checks whose it is, and whoever builds the
  transaction chooses it. Prefer an `Address` recipient, which the program checks; or check the
  account yourself, `require(ownerOf(USDC, dest) == expected, "not theirs")`.

- **Each account is checked on chain.** After each write, the program requires the token account it
  paid, or paid from, to belong to the holder the call named. A builder who attaches another account
  in its place (a solver filling the cook, say) is refused with one of these reasons:
  - `wrong recipient account`
  - `wrong sender account` (`transferFrom`)
  - `wrong spender account` (`approve`)
  - `wrong holder account` (a read)
- **Each mint's own write.** An SPL Token mint (USDC, USDT, WSOL) moves by the plain
  `transfer`/`approve`: for such a mint it does what the checked write does, in about 220 bytes
  less and one account fewer, and a Solana transaction has 1,232 bytes. A Token-2022 mint (PYUSD,
  the stocks) moves by `transferChecked`/`approveChecked`, with the registry's decimals and the mint
  as one more account. `Token(mint)`, for a mint given as an `Address` argument, takes the checked
  write, which either program accepts, with the decimals read from the mint; its token program is
  read from the cluster when the cook is built, and a mint whose program cannot be read is refused,
  never assumed. Every write requires its token program to be SPL Token or Token-2022 before it
  calls it (`not the token program`). A Token-2022 transfer fee is withheld from what arrives, so
  measure the recipient's balance before and after.
- **A recipient with no token account yet.** `sauce run` creates its associated token account
  before the cook, the owner paying the rent. It asks first, or does it with `--yes`.
- **Where the methods can stand.** The added accounts are main's parameters, so the methods stand in
  `main` itself, not in a helper, in a file that has a `main`. `ctx.self()` alone is still the
  engine's program id on Solana (below); only as a token's holder is it the Pot. Cooked directly
  (`--via engine`), `self` is the signer, and its own token accounts pay.

Compiling produces the bytecode and the manifest. Every derived account is filled in the
transaction `sauce tx` prints, so any wallet can sign it.
[examples/pay.sauce.ts](examples/pay.sauce.ts) is the program above.

The methods lower to the `@sauce/token` functions below, which a program can also call itself with
the accounts written out: to move tokens between accounts the transaction names some other way, or
to keep every account in view.

## Accounts where they are used

For what the token methods do not cover, such as a call into another program or a read of an
account a program derives, write each account where it is used. Compiling adds it to `main` with its
`derive`, as it does for the token methods, so the program still runs with `--args` alone. This one
wraps the owner's SOL into the Pot's WSOL account. It calls the System Program's transfer, then SPL
Token's SyncNative:

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
  return WSOL.balanceOf(ctx.self());
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

- **Roles.** Each account is read-only. `.writable()` and `.signer()` give it the role a call
  needs, and they chain: `Solana.owner.writable().signer()`. An account written more than once is
  one slot, with every role any of its uses gives it.
- **Known when the transaction is built.** The command derives each account as it builds the cook,
  so a program, key or holder is one of:
  - a parameter of `main` declared `Address`;
  - a 32-byte key written out;
  - `ctx.self()`, `Solana.self` or `Solana.owner`;
  - a program account such as `Solana.tokenProgram`.

  A seed can be any of those, and also:
  - a token symbol or `USDC.mint` (the mint's key);
  - a string of 32 bytes at most;
  - `.toBytesLe(n)` of an integer parameter or literal, with `n` 1, 2, 4, 8 or 16;
  - ``hex`…` ``.

  A seed computed as the program runs is refused. Take that account as an `Account` parameter of
  `main` instead (below).

- **Each slot's name.** A slot is named for what it holds: `systemProgram`, `potWSOL`, `toUSDC`.
  An address `Solana.pda` derives is named for the constant it initializes (`destPda` for
  `const dest`), else for its first string seed (`statePda` for `"state"`). `sauce compile --json` lists every slot with its `derive`, and
  `--account NAME=<value>` replaces one.
- **Where they can stand.** In `main` itself, as with the token methods.
- **Each is checked on chain.** `sauce run`, `simulate` and `tx` attach what the expression
  derives, but a transaction built another way (a solver filling the cook, say) could attach another
  account in that slot. So compiling also adds a check for each account, at the top of `main` before
  the program's own code. An account in the wrong slot is refused with one of these reasons:
  - `wrong account`: `Solana.account(key)` is not at `key`;
  - `wrong program-derived address`: the engine derives `Solana.pda(program, [seeds])` again, at
    the program's canonical bump, and it is not that address;
  - `wrong holder account`: `USDC.accountOf(holder)` is not a token account of USDC's mint, owned by
    a token program and held by `holder`;
  - `wrong mint`: `USDC.mint` is not USDC's mint;
  - `wrong program`: a program account, or `USDC.tokenProgram`, is not that program.

  The Pot and the owner are what the cook attaches, so their signatures are what pins them. When a
  holder or a seed is made of either one, it becomes a signer; elsewhere, give it `.signer()` where
  its identity matters. An `--account` that replaces one of these accounts has to pass the same
  check. Each check costs bytes. The first `accountOf` costs about 290, because it compiles in
  `@sauce/token`'s account check, which the token methods' reads share. Each other check costs
  25 to 60.

- **`accountOf` names an account that exists.** Its check reads the account when the program starts,
  and `sauce run` creates a missing one before the cook, asking first (or with `--yes`). For an
  account the program creates itself, use the address the Associated Token Account program derives,
  which that program checks when it creates the account:
  `Solana.pda(Solana.associatedTokenProgram, [holder, Solana.tokenProgram, USDC])`.

[examples/wrap.sauce.ts](examples/wrap.sauce.ts) is the program above.

## The accounts written out

`@sauce/token`'s functions take the mint first, then the accounts, with no import. A registered
symbol on its own is its mint's 32-byte key: `balanceOf(USDC, account)`.

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

## Accounts

- `Account` is read-only; `Account<Writable>` and `Account<Signer>` declare the role the
  transaction must grant. The manifest records `readonly`, `writable`, `readonly_signer` or
  `writable_signer` per slot. Roles are the author's declaration; nothing infers them from what a
  CPI needs.
- Each slot is passed by its name: `--account NAME=<address>`, `NAME=pot` for the Pot, which the
  Kitchen signs for, or `NAME=owner` for the signer. Other names a slot can be given:
  - `self`: the Pot, or the signer with `--via engine`;
  - `system`: the System Program;
  - `@to`: main's argument `to`;
  - `<holder>:<token>`: the holder's associated token account for a mint. The holder is `pot`,
    `owner`, `self`, `@to` or a base58 key; the token is a symbol, a base58 mint, or `@mint` for
    main's argument `mint`;
  - `mint:<token>`: the mint;
  - `program:<token>`: the mint's token program;
  - `slot:<pool>:<token>.<part>`: one of a pool's nine accounts paying the token (`program`, `pool`,
    `config`, `vaultA`, `vaultB`, `extra`, `ticks0` to `ticks2`), read from the pool on the cluster,
    the pool a base58 key or `@pool`;
  - `pda:<program>:<seeds>`: the address a program derives for its seeds. The program is a base58
    key or `@prog`, and the seeds are comma-separated, each one of:
    - `"text"`, or a bare word: its bytes;
    - `pot`, `owner`, `self`, `@to` or a base58 key: that key's 32 bytes;
    - `mint:USDC`: the mint's key;
    - `u8:7` to `u128:7`, or `u64:@index`: an integer, little-endian;
    - hex digits after `0x`: those bytes.

    The Pot itself is `pda:<the Kitchen program id>:"pot",owner,<its 32-byte salt>`.

  `sauce compile --json` lists the slots in its `manifest` (each one the token methods added with
  its `derive`), and a missing one is named with the role it needs.

- An `Account` compares by identity (`tokenProgram.address == splToken`, with the SPL Token program
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` an `Address` argument, or its 32-byte hex
  `0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9` as a literal) and exposes
  `.owner` and `.dataLen`. Check the owner before trusting bytes: a hand-made account can carry any layout.
- `svm.sload(account, offset, length)` reads bytes; `.toLe()`/`.toBe()` make a number.
  `svm.call(program, [accounts...], data)` is a CPI to an attached program account.
- Scalar parameters are runtime arguments (`--args`); `Account` parameters are not encoded. A
  32-byte key the program is given, such as a mint, is an `Address` argument of `main`, passed as a
  base58 public key and encoded as one ABI word (not with `--compact-args`), or an `Account`
  parameter when the program reads or writes that account. A registered symbol (`USDC`) is
  mainnet's mint; for devnet's, pass the key `sauce globals --chain solana` lists as an argument.
- On Solana `ctx.self()` is the engine's program id, which owns every Pot account, **not the
  Pot**; `ctx.msgSender()` is the first signer among the accounts the engine receives (the Pot,
  when a `pot` slot is attached as the Pot), not proof of who sent the transaction; and
  `ctx.balance(acct.address)` is an attached account's lamports.
  `ctx.msgValue`, `ctx.gasLeft`, `ctx.codeSize` and the other EVM reads are rejected; move lamports with a
  system-program CPI through `svm.call`. Every read, per target, is in
  [../sauce-script/references/builtins.md](../sauce-script/references/builtins.md).

## The Pot's key

The Pot is an account the program is given: declare it as `pot: Account<Signer>`, pass it as
`--account pot=pot`, and read `pot.address`. Nothing about the slot alone proves it is the Pot:

- a `Signer` slot takes any signer (`pot=owner` satisfies it too);
- `ctx.msgSender()` is only the first signer among the accounts the engine receives;
- `pot.owner == ctx.self()` says only that the engine owns the account. **The engine owns every
  Pot, but not only Pots**: a keypair account assigned to the engine, which the transaction signs,
  passes the check as well. It keeps the owner's wallet out (the System program owns that) and
  lets a lookalike in.

**To bind the slot to the Pot, re-derive the Pot's address and require the slot to be it.** The Pot
is the Kitchen's program address for the seeds `"pot"`, its owner and the 32-byte salt (zero unless
`--salt` names another), and only a Kitchen cook can make that address sign, so a signing slot at
that address is the Pot. Take the owner as a signer slot of its own (`--account wallet=owner`). The
Kitchen program is passed as an argument: its id is `svm.kitchen.programId` in
[../sauce-chains/references/deployments.json](../sauce-chains/references/deployments.json), the
same on every cluster. The salt is the Pot's (zero unless `--salt` names another). Bind an
account's key to a local before calling a method on it.

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

A Pot under another salt passes that salt, as a 32-byte number, in place of `0`. The Kitchen's key as
32-byte hex, the value a program holds, is `svm.kitchen.key` in the same file.
This binding is a Kitchen cook's. A direct cook (`--via engine`) runs as no Pot: nothing signs for
one, so a slot that must sign cannot be `pot` there.

## Token accounts

An SPL token account is 165 bytes, and `acct.owner` is the program that owns it (the SPL Token
program, or Token-2022), not whose balance it is. A Token-2022 account has the same first 165 bytes,
then its extensions:

| Bytes   | Field                              | Read                             |
| ------- | ---------------------------------- | -------------------------------- |
| 0–32    | mint                               | `svm.sload(acct, 0, 32).toBe()`  |
| 32–64   | owner: whose balance it is         | `ownerOf(mint, acct)`            |
| 64–72   | amount (u64, little-endian)        | `svm.sload(acct, 64, 8).toLe()`  |
| 72–76   | delegate tag (u32: 0 none, 1 some) | `svm.sload(acct, 72, 4).toLe()`  |
| 76–108  | delegate                           | `svm.sload(acct, 76, 32).toBe()` |
| 121–129 | delegated amount (u64)             | `svm.sload(acct, 121, 8).toLe()` |

**Check the owner before calling a balance the Pot's**: a transfer with the Pot as `authority` also
succeeds from an account where the Pot is only a delegate, up to the delegated amount.
`ownerOf(mint, acct)` (below) checks the account's program and mint, then reads its owner.

## USDC, and the Pot's token account

`USDC` on Solana is mainnet's USDC mint, `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, whose
32-byte key is `0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61`;
`balanceOf(USDC, account)` takes it as it is. On devnet USDC is another mint,
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: a program for devnet takes the mint as an `Address`
argument and is passed that key. The Solana file in `sauce-chains` lists every registered mint,
mainnet's and devnet's.

`--account <name>=pot` attaches **the Pot's own account**, not its USDC. The Pot's USDC is a token
account of its own, so a program reading it takes that account as a parameter and checks whose it
is:

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

run with `--account pot=pot --account wallet=owner`, the Pot's USDC account in the third slot and
the Kitchen and salt as above (`--args <the Kitchen program id> 0`):
`--account potUsdc=pot:USDC` passes it, the Pot's associated token
account for the mint (`pot:<mint>` for any mint, `owner:USDC` for the owner's). The first check
binds `pot` to the wallet's Pot; the second binds the token account to `pot`. Passing the Pot for
that slot fails the checks with no message (the Pot is not an SPL token account), and so does an
account that does not exist: **a Pot with no USDC account holds no USDC**. `sauce simulate` names
a given account the cluster does not have, and
`sauce pot --chain solana --owner <pubkey>` lists the Pot's account for
each registered mint, whether it exists and what it holds.

The Pot's USDC sits in its associated token account, the ATA of (Pot, mint) under the mint's token
program. Derive it with `findAssociatedTokenPda` and create it with
`getCreateAssociatedTokenIdempotentInstruction`, both from `@solana-program/token`, passing the
mint's token program as `tokenProgram` (Token-2022 for PYUSD), then fund it with an ordinary
transfer from any wallet: `--fund` is EVM only. `@solana/kit` and `@solana-program/token` are dependencies of the package, not of your
project: add them to it before importing them (to build a payer, derive an ATA or send a transfer).

## Transaction size

A Solana transaction is at most **1,232 bytes**, and the cook carries the program and its
arguments, so a program that does not fit has to be staged first, which only `sauce run` does. The
cook adds about 404 bytes and 33 more per account (538 with four accounts), so with four accounts a
program and its arguments have about 694 bytes. A direct cook (`--via engine`) carries no
Kitchen, Pot or salt and adds about 100 bytes less: about 798 for the program and its arguments with
four accounts. What costs bytes:

- each `require` message, byte for byte;
- each `@sauce/token` function, which carries its own checks and their reasons: a `transfer` about
  280 bytes and a second about 50, a `transferChecked` about 500, a first read (`balanceOf`) about
  260, and a read of another kind about 40 more (the reads share their checks). A program that moves
  a Token-2022 token and measures what arrived is past one transaction, and `sauce run` stages it;
- a token method, which is that function and its holder check: `USDC.transfer(to, amount)` is about
  360 bytes and four accounts, a Token-2022 mint's about 585 bytes and five;
- each account, about 33 bytes;
- arguments: `--compact-args` encodes them compactly (a `Uint256` takes 7 bytes instead of 32).

## `@sauce/token` on Solana

Solana has two token programs, and every mint belongs to one, with every token account of it: the
SPL Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) or Token-2022
(`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). USDC, USDT and WSOL are SPL Token mints; PYUSD and
the tokenized stocks (`TSLAx`, `NVDA_US`, `SPACEX`, …, in `sauce-globals`'
[Tokenized stocks](../sauce-globals/SKILL.md#on-solana)) are Token-2022 mints. The arm takes the
mint first, then the accounts:

- **Reads, either program:** `balanceOf(mint, account)`, `allowance(mint, account, spender)`,
  `ownerOf(mint, account)`, `totalSupply(mintAccount)`, `decimals(mintAccount)`.
- **Checked writes, either program:** `transferChecked(mint, tokenProgram, source, mintAccount, dest,
authority, amount, decimals)` and `approveChecked(mint, tokenProgram, source, mintAccount,
delegate, authority, amount, decimals)`. `tokenProgram` is the program that owns the mint, the
  source and the destination; the account after the source is the mint's own, which must be the
  mint named first; `decimals` must be the mint's.
- **Legacy writes, SPL Token only:** `transfer(mint, tokenProgram, source, dest, authority, amount)`,
  `approve(mint, tokenProgram, source, delegate, authority, amount)`, and `transferFrom` (the same
  instruction: SPL has one transfer for owners and delegates). They refuse a Token-2022 account or
  program. Move a Token-2022 token with `transferChecked`: Token-2022 refuses its plain transfer for
  a mint with a transfer fee, a transfer hook or a pause.

Every function checks the account's program and mint, and every write rejects an amount above
`u64`. Each check reverts with its reason, which `sauce simulate` prints: `not a token account`,
`wrong mint`, `not a mint`, `uninitialized mint`, `not the token program`, `amount over u64`,
`wrong decimals` and `transfer hook`. SPL tracks one delegate per account, so a second approval
replaces the first.

A transfer's `authority` may be the source's owner or its delegate, so a transfer that succeeds does
not show whose account `source` is. `ownerOf(mint, account)` reads the token account's owner (the
wallet or PDA whose balance it is, not `account.owner`, the token program): before treating a
balance as the Pot's, `require(ownerOf(USDC, source) == authority, "not the Pot's account")`.

### Token-2022 mints and their extensions

A Token-2022 mint carries extensions, which the token program applies to every transfer. What each
does to a program:

| Extension                                            | What a program sees                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer fee                                         | The destination receives the amount less the fee, which the mint withholds. Measure what arrived (`balanceOf` before and after), never the amount sent. |
| Scaled UI amount                                     | A display multiplier, for wallets. Balances, amounts and transfers are raw base units; a program never sees a UI amount.                                |
| Pausable                                             | While the issuer has paused the mint, every transfer fails: `Token-2022 refused: Transferring, minting, and burning is paused on this mint`.            |
| Default account state, frozen                        | A new account starts frozen until the issuer thaws it, and a transfer into or out of a frozen account fails: `Token-2022 refused: Account is frozen`.   |
| Transfer hook with no program                        | No hook: the mint transfers as any other. Tokenized stocks carry one.                                                                                   |
| Transfer hook that names a program                   | Refused, `transfer hook`, before anything moves: the hook's own accounts are not passed.                                                                |
| Permanent delegate, confidential transfers, metadata | Nothing for a program: reads and checked writes work as on a legacy mint.                                                                               |

A paused mint or a frozen account fails the whole transaction with the token program's error, as
any failed call does; `sauce simulate` prints it.

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

`--account` names each of its accounts by its token: `program:PYUSD` is the token program that owns
the mint, `mint:PYUSD` the mint, `pot:PYUSD` the Pot's account for it and `owner:PYUSD` the
owner's; any other mint by its base58 address (`program:<mint>`), its program read from the
cluster. A token account's address derives from its owner, its mint and the mint's token program, so
the Pot's PYUSD account is not where an SPL Token derivation puts it:

```sh
sauce run token-2022.sauce.ts --chain solana --keypair <keypair> \
  --account tokenProgram=program:PYUSD --account source=pot:PYUSD --account mint=mint:PYUSD \
  --account destination=<token account> --account pot=pot --args 400
```

## Running

Solana is one of the three chains the initial release supports, with Ethereum and Base: its cooks,
Pots and intent steps are built and sent there.

- **The Pot** is the Kitchen's address for the owner and salt.
  `sauce pot --chain solana --owner <pubkey>` prints it. It needs no step of its own: a cook on a
  Pot the Kitchen has not created yet creates it in the same transaction, ahead of the cook
  (`sauce run` asks nothing; `sauce tx`'s transaction carries it, `createsPot`), and where the two
  do not fit in one transaction `sauce run` asks first, or creates it with `--yes`.
  `sauce pot --deploy --chain solana --keypair <keypair>` creates it by hand.
  A cook names its Pot by `--owner` (and `--salt`), never `--pot`.
- **The cook** pays the execution fee in lamports, read from the cluster and printed as `fee`, so
  there is no `--value`; `--max-execution-fee <lamports>` refuses a cook whose fee is above it.
  `sauce simulate` runs it from `--owner` with no signature and prints the compute units, or the
  reason (a `throw` or `require` message, decoded) and the program logs. A Pot the Kitchen has not
  created yet is created in the same simulated transaction, ahead of the cook. Solana's simulation
  takes no account overrides, so there the owner must hold the Pot's rent and the fees, and the
  accounts hold what they hold. `sauce run` signs with `--keypair`; `sauce tx` prints a base64
  transaction for the owner's wallet. Signed there, by any signer,
  `sauce send <signed> --chain solana` sends it (the tool `sauce_send`), checking every signature
  and simulating it as signed first, and prints what it did, as `sauce run` does, with what `main`
  returned as hex; its blockhash expires about a minute after `sauce tx` built it, after which it
  is refused, to build and sign again. A cook that succeeds, simulated or sent, leads with what it
  leaves in the Pot's token accounts (`Left in the Pot`, and `leftInPot` in `--json`): that is the
  owner's, but not in their wallet, and only another cook moves it out. A sent one prints its
  Solscan page and its trace (calls and balance changes), links for the user to open, and each
  token account's change, read before the cook and once it lands.
- **A simulation in a local copy.** A cook too large for one transaction, or one given
  `--assume-balance`, `sauce simulate` runs in a local copy of every account the cook names, read
  from the cluster as it is, with the cluster's rent and the released engine and Kitchen (the copy
  is LiteSVM, which the first simulation installs for the command): the Pot created where it is
  missing, the owner given the lamports the staging and the fees take (so any address can
  simulate), the program staged as `sauce run` stages it, then the cook. Nothing is signed or sent. A failure names the account an
  error gives only by its index, and what `main` returned when the program finished first. There
  `--assume-balance USDC:1000` gives the account the cook spends USDC from (the Pot's, or the
  owner's with `--via engine`) that balance, whole tokens as `--fund` takes them, and a
  `pot:<token>` or `owner:<token>` account the cluster does not have yet is made empty, with a
  note; `sauce run` creates it before the cook (asking first, or with `--yes`). The
  owner must be a wallet, or an address with no account: it signs and pays.
- **Through the Kitchen or directly.** `--via kitchen`, the default, is the Kitchen's cook on the
  owner's Pot: the program holds and spends what the Pot owns and can write the Pot's storage.
  `--via engine` calls the engine itself, with no Kitchen and no Pot: nothing is created, and the
  signer (`--keypair`, or `--owner` for `simulate` and `tx`) pays the fee and is the authority the
  program acts with. Spend from the signer's own token accounts and pass `NAME=owner` where an
  authority signs. A direct cook leaves the program one more level of CPI depth, for a program that
  calls a program that calls others. Both pay the same fee into the Kitchen's treasury:

```sh
sauce run solana.sauce.ts --chain solana --keypair <keypair> \
  --via engine --account tokenProgram=<SPL Token program> \
  --account source=<the signer's token account> --account destination=<token account> \
  --account authority=owner --args <mint> 400
```

- A program too large for one transaction is staged through the Kitchen by `sauce run`, and
  simulated by `sauce simulate` in a local copy; `sauce tx` refuses it, naming how many bytes the
  payload (the program and its arguments) must shrink by to fit.
- **Accounts past one transaction go through a lookup table.** Each account a transaction lists
  costs 32 bytes, and one taken through an address lookup table one byte. `sauce run` creates a
  table holding a staged cook's accounts when they do not fit, from the signer, which pays its
  rent, and prints its address; `--lookup-table <address>` takes the accounts through a table that
  holds them, on `run`, `simulate` and `tx`, so a later cook naming the same accounts reuses it.
- The engine and Kitchen program ids are `svm.engine` and `svm.kitchen` in
  [../sauce-chains/references/deployments.json](../sauce-chains/references/deployments.json), the
  same on every cluster; confirm both are deployed on the cluster (`getAccountInfo` returns an
  executable account).
- `sauce intent publish` does not work from Solana; open an intent from Ethereum or Base. Its
  destination may be Solana: `sauce intent fill`, `prove` and `cancel` act on it there with
  `--keypair` (`sauce-intents`), and take no `--via`: an intent's program on Solana runs
  through the Kitchen. A failed `sauce run` prints the program logs.
- For a local run, the package ships the engine and Kitchen programs, to load into a local
  validator or LiteSVM; `sauce-typescript` says where they are. Setting one up is outside this
  skill.
- A swap at one pool of a venue whose swap stops at a price limit is the venue's namespace:
  `OrcaWhirlpool.swap(pool, USDC, WSOL, amountIn, maxPrice, minOut)` (and `RaydiumClmm`,
  `PancakeswapClmm`, `Byreal`, `StabbleClmm`, `Cropper`, `Defituna`, `Crema`, `Phoenix`), with the
  pool as an `Address` argument. Its nine accounts are read from the pool when the cook is built
  (`slot:@pool:USDC.vaultA`, …), and the Pot's are derived like the token methods' (`sauce-swaps`).
  Behind each is one `@sauce/router` function per venue, and `trySwap` for a pool at any of them,
  which take the accounts as `Account[]` arrays for a program that gives them itself. One order
  over several pools under one price is `sauce-solana-distributed-swap`.
- From TypeScript, the SVM client (`createSauceSvmClient`) builds the same cooks: `via: "engine"`
  for the direct one, and `executionFee()` quotes the fee to set `maxExecutionFee` from. Venue
  adapters build swaps on Solana venues such as Raydium (`sauce-typescript`). A venue swap they
  build uses a minimum output of one: enforce the real minimum with a balance delta in the program.

## Example

[examples/pay.sauce.ts](examples/pay.sauce.ts) pays USDC with the token methods, every account
derived; [examples/solana.sauce.ts](examples/solana.sauce.ts) is the program with its accounts
written out; [examples/token-2022.sauce.ts](examples/token-2022.sauce.ts) moves PYUSD with
`transferChecked`; [examples/solana.mts](examples/solana.mts) compiles them, checks the accounts the
token methods add and how each is derived, the manifest order and roles and the arguments, the mints'
token programs, and confirms the client refuses to run without an `rpcUrl`.

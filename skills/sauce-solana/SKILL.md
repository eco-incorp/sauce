---
name: sauce-solana
description: Writing and running Sauce programs on Solana (the SVM target) — declaring every account as an Account parameter with Writable/Signer roles, the account manifest the compile returns, passing accounts by name with --account, the @sauce/token arm for SPL Token and Token-2022 (balanceOf and the other reads, transferChecked and approveChecked for either program, the legacy transfer and approve) and what Token-2022's extensions do to a program (transfer fees, scaled UI amounts, pauses, frozen accounts, transfer hooks), svm.call CPIs and svm.sload byte reads, account .owner and .dataLen checks, a 32-byte key as a define, runtime arguments without Account slots, and how a program runs with sauce run --chain solana, through the Kitchen on the owner's Pot or directly on the engine (--via engine). Use when the user targets Solana, SPL tokens, Token-2022, PYUSD or tokenized stocks on Solana, PDAs or CPIs, account manifests, lamport fees, CPI depth, LiteSVM, or Solana venues such as Raydium, Orca or Meteora.
---

# Sauce on Solana

A Solana program must declare every account it touches before it runs. In SauceScript those are
`Account` parameters of `main`; the compile returns them, in order and with their roles, as the
**account manifest**, and each is attached by name when the program runs. A program for Solana is
compiled with `--chain solana`. Its signatures are annotated. Protocol namespaces and the token
methods (`USDC.transfer(...)`) do not exist there; the `@sauce/token` functions do, with no import,
and a registered token symbol (`USDC`, `USDT`, `WSOL`, `PYUSD`) is its mint's 32-byte key, a value
they take: `balanceOf(USDC, account)`. `sauce globals --chain solana` lists the mints, devnet's, and
which are Token-2022 mints.

```sauce chain=solana define=MINT
const MINT = 0n; // the SPL mint's 32-byte key: a define replaces it

function main(
  tokenProgram: Account,
  source: Account<Writable>,
  destination: Account<Writable>,
  authority: Account<Signer>,
  amount: Uint256
): Uint256 {
  require(MINT != 0n, "set MINT");
  const before = balanceOf(MINT, destination);
  transfer(MINT, tokenProgram, source, destination, authority, amount);
  const after = balanceOf(MINT, destination);
  require(after - before == amount, "destination did not receive the amount");
  return after;
}
```

```sh
npx sauce compile solana.sauce.ts --chain solana --define MINT=<mint> --json
npx sauce run solana.sauce.ts --chain solana --config sauce.config.json --keypair <keypair> \
  --define MINT=<mint> --account tokenProgram=<SPL Token program> \
  --account source=<the Pot's token account> --account destination=<token account> \
  --account authority=pot --args 400
```

`npx sauce` runs the command in a project that depends on `@eco-incorp/sauce`; anywhere else, run
`npx -y @eco-incorp/sauce` in its place, because without the package `npx sauce` fetches and runs
npm's unrelated `sauce` package.

## Accounts

- `Account` is read-only; `Account<Writable>` and `Account<Signer>` declare the role the
  transaction must grant. The manifest records `readonly`, `writable`, `readonly_signer` or
  `writable_signer` per slot. Roles are the author's declaration; nothing infers them from what a
  CPI needs.
- Each slot is passed by its name: `--account NAME=<address>`, `NAME=pot` for the Pot, which the
  Kitchen signs for, or `NAME=owner` for the signer. `sauce compile --json` lists the slots in its
  `manifest`, and a missing one is named with the role it needs.
- An `Account` compares by identity (`tokenProgram == SPL_TOKEN_PROGRAM`, with the SPL Token
  program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` as a define, in base58 or as
  `0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9`) and exposes `.owner` and
  `.dataLen`. Check the owner before trusting bytes: a hand-made account can carry any layout.
- `svm.sload(account, offset, length)` reads bytes; `.toLe()`/`.toBe()` make a number.
  `svm.call(program, [accounts...], data)` is a CPI to an attached program account.
- Scalar parameters are runtime arguments (`--args`); `Account` parameters are not encoded. A
  32-byte key chosen per compile, such as a mint, is a module constant (`const MINT = 0n;`) that
  `--define MINT=<key>` replaces, the key in base58 or as 32-byte hex. A define also overrides a
  registered symbol, which is how a devnet program names devnet's USDC; a module `const USDC = …`
  does not, since the symbol is itself a define and a define wins. A key that changes per call is
  an `Address` argument of `main`, passed as a base58 public key and encoded as one ABI word (not
  with `--compact-args`), or an `Account` parameter when the program reads or writes that account.
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
that address is the Pot. Take the owner as a signer slot of its own (`--account wallet=owner`).
`KITCHEN` is the Kitchen program, as a define: `--define KITCHEN=SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot`
(or its 32-byte hex, `0x068ddbf2073c779081c9b11a48aea267e5545cb7f387144de6b7ff8c7138818b`). Bind an
account's key to a local before calling a method on it.

```sauce chain=solana define=KITCHEN
const SALT = 0n; // the Pot's salt, zero by default

function main(pot: Account<Signer>, wallet: Account<Signer>) {
  const owner = wallet.address;
  const [expected] = crypto.findPDA(KITCHEN, ["pot", owner.toBytesBe(32n), SALT.toBytesBe(32n)]);
  require(pot.address == expected, "pot is not the wallet's Pot");
}
```

```sh
npx sauce run pot.sauce.ts --chain solana --config sauce.config.json --keypair <keypair> \
  --define KITCHEN=SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot --account pot=pot --account wallet=owner
```

A Pot under another salt is the same program with `--define SALT=<the salt, as 32-byte hex>`.
This binding is a Kitchen cook's. A direct cook (`--via engine`) runs as no Pot: nothing signs for
one, so a slot that must sign cannot be `pot` there.

## Token accounts

An SPL token account is 165 bytes, and `acct.owner` is the program that owns it (the SPL Token
program, or Token-2022), not whose balance it is. A Token-2022 account has the same first 165 bytes,
then its extensions:

| Bytes   | Field                              | Read                               |
| ------- | ---------------------------------- | ---------------------------------- |
| 0–32    | mint                               | `svm.sload(acct, 0n, 32n).toBe()`  |
| 32–64   | owner: whose balance it is         | `ownerOf(mint, acct)`              |
| 64–72   | amount (u64, little-endian)        | `svm.sload(acct, 64n, 8n).toLe()`  |
| 72–76   | delegate tag (u32: 0 none, 1 some) | `svm.sload(acct, 72n, 4n).toLe()`  |
| 76–108  | delegate                           | `svm.sload(acct, 76n, 32n).toBe()` |
| 121–129 | delegated amount (u64)             | `svm.sload(acct, 121n, 8n).toLe()` |

**Check the owner before calling a balance the Pot's**: a transfer with the Pot as `authority` also
succeeds from an account where the Pot is only a delegate, up to the delegated amount.
`ownerOf(mint, acct)` (below) checks the account's program and mint, then reads its owner.

## USDC, and the Pot's token account

`USDC` on Solana is mainnet's USDC mint, `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, whose
32-byte key is `0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61`;
`balanceOf(USDC, account)` takes it with no define. On devnet USDC is another mint,
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: pass it as `--define USDC=<key>`, which wins over
the symbol. The Solana file in `sauce-chains` lists every registered mint, mainnet's and devnet's.

`--account <name>=pot` attaches **the Pot's own account**, not its USDC. The Pot's USDC is a token
account of its own, so a program reading it takes that account as a parameter and checks whose it
is:

```sauce chain=solana define=KITCHEN
const SALT = 0n; // the Pot's salt, zero by default

function main(pot: Account<Signer>, wallet: Account<Signer>, potUsdc: Account): Uint256 {
  const owner = wallet.address;
  const [expected] = crypto.findPDA(KITCHEN, ["pot", owner.toBytesBe(32n), SALT.toBytesBe(32n)]);
  require(pot.address == expected, "pot is not the wallet's Pot");
  require(ownerOf(USDC, potUsdc) == pot.address, "not the Pot's USDC account");
  return balanceOf(USDC, potUsdc);
}
```

run with `--account pot=pot --account wallet=owner`, the Pot's USDC account in the third slot and
`--define KITCHEN=…` as above: `--account potUsdc=pot:USDC` passes it, the Pot's associated token
account for the mint (`pot:<mint>` for any mint, `owner:USDC` for the owner's). The first check
binds `pot` to the wallet's Pot; the second binds the token account to `pot`. Passing the Pot for
that slot fails the checks with no message (the Pot is not an SPL token account), and so does an
account that does not exist: **a Pot with no USDC account holds no USDC**. `sauce simulate` names
a given account the cluster does not have, and
`sauce pot --chain solana --owner <pubkey> --config sauce.config.json` lists the Pot's account for
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
  transferChecked(PYUSD, tokenProgram, source, mint, destination, pot, amount, 6n);
  return balanceOf(PYUSD, destination) - before;
}
```

`--account` names each of its accounts by its token: `program:PYUSD` is the token program that owns
the mint, `mint:PYUSD` the mint, `pot:PYUSD` the Pot's account for it and `owner:PYUSD` the
owner's; any other mint by its base58 address (`program:<mint>`), its program read from the
cluster. A token account's address derives from its owner, its mint and the mint's token program, so
the Pot's PYUSD account is not where an SPL Token derivation puts it:

```sh
npx sauce run token-2022.sauce.ts --chain solana --config sauce.config.json --keypair <keypair> \
  --account tokenProgram=program:PYUSD --account source=pot:PYUSD --account mint=mint:PYUSD \
  --account destination=<token account> --account pot=pot --args 400
```

## Running

Solana is one of the three chains the initial release supports, with Ethereum and Base: its cooks,
Pots and intent steps are built and sent there.

- **The Pot** is the Kitchen's address for the owner and salt.
  `npx sauce pot --chain solana --owner <pubkey>` prints it;
  `npx sauce pot --deploy --chain solana --config sauce.config.json --keypair <keypair>` creates it.
  A cook names its Pot by `--owner` (and `--salt`), never `--pot`.
- **The cook** pays the execution fee in lamports, read from the cluster and printed as `fee`, so
  there is no `--value`; `--max-execution-fee <lamports>` refuses a cook whose fee is above it.
  `sauce simulate` runs it from `--owner` with no signature and prints the compute units, or the
  reason (a `throw` or `require` message, decoded) and the program logs. A Pot the Kitchen has not
  created yet is created in the same simulated transaction, ahead of the cook. Solana's simulation
  takes no account overrides, so the owner must hold the Pot's rent and the fees, and the accounts
  hold what they hold: there is no `--assume-balance` on Solana. `sauce run` signs with
  `--keypair`; `sauce tx` prints a base64 transaction for the owner's wallet.
- **Through the Kitchen or directly.** `--via kitchen`, the default, is the Kitchen's cook on the
  owner's Pot: the program holds and spends what the Pot owns and can write the Pot's storage.
  `--via engine` calls the engine itself, with no Kitchen and no Pot: nothing is created, and the
  signer (`--keypair`, or `--owner` for `simulate` and `tx`) pays the fee and is the authority the
  program acts with. Spend from the signer's own token accounts and pass `NAME=owner` where an
  authority signs. A direct cook leaves the program one more level of CPI depth, for a program that
  calls a program that calls others. Both pay the same fee into the Kitchen's treasury:

```sh
npx sauce run solana.sauce.ts --chain solana --config sauce.config.json --keypair <keypair> \
  --via engine --define MINT=<mint> --account tokenProgram=<SPL Token program> \
  --account source=<the signer's token account> --account destination=<token account> \
  --account authority=owner --args 400
```

- A program too large for one transaction is staged through the Kitchen by `sauce run`. `simulate`
  and `tx` refuse it, naming how many bytes the payload (the program and its arguments) must
  shrink by to fit.
- The engine program is `2HH8xZ7ZN8SSDD8B3ALYANTVKBbMKGxTzjX7LTzvtSzT` and the Kitchen
  `SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot` ([../sauce-chains/references/solana.md](../sauce-chains/references/solana.md));
  confirm both are deployed on the cluster (`getAccountInfo` returns an executable account).
- `sauce intent publish` does not work from Solana; open an intent from Ethereum or Base. Its
  destination may be Solana: `sauce intent fill`, `prove` and `cancel` act on it there with
  `--keypair` (`sauce-intents`), and take no `--via`: an intent's program on Solana runs
  through the Kitchen. A failed `sauce run` prints the program logs.
- For a local run, the package ships the engine and Kitchen programs, to load into a local
  validator or LiteSVM; `sauce-typescript` says where they are. Setting one up is outside this
  skill.
- From TypeScript, the SVM client (`createSauceSvmClient`) builds the same cooks: `via: "engine"`
  for the direct one, and `executionFee()` quotes the fee to set `maxExecutionFee` from. Venue
  adapters build swaps on Solana venues such as Raydium (`sauce-typescript`). A venue swap they
  build uses a minimum output of one: enforce the real minimum with a balance delta in the program.

## Example

[examples/solana.sauce.ts](examples/solana.sauce.ts) is the program above;
[examples/token-2022.sauce.ts](examples/token-2022.sauce.ts) moves PYUSD with `transferChecked`;
[examples/solana.mts](examples/solana.mts) compiles both, checks the manifest order and roles and the
arguments, the mints' token programs, and confirms the client refuses to run without an `rpcUrl`.

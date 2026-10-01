---
name: sauce-solana
description: Writing and running Sauce programs on Solana (the SVM target) — declaring every account as an Account parameter with Writable/Signer roles, the account manifest the compile returns, passing accounts by name with --account, the @sauce/token SPL arm (transfer, approve, balanceOf with account parameters), svm.call CPIs and svm.sload byte reads, account .owner and .dataLen checks, a 32-byte key as a define, runtime arguments without Account slots, and how a program runs through the Kitchen with sauce run --chain solana. Use when the user targets Solana, SPL tokens, Token-2022, PDAs or CPIs, account manifests, lamport fees, LiteSVM, or Solana venues such as Raydium, Orca or Meteora.
---

# Sauce on Solana

A Solana program must declare every account it touches before it runs. In SauceScript those are
`Account` parameters of `main`; the compile returns them, in order and with their roles, as the
**account manifest**, and each is attached by name when the program runs. A program for Solana is
compiled with `--chain solana`. Its signatures are annotated, and the EVM registry names (`USDC`,
protocol namespaces) do not exist there; the `@sauce/token` functions do, with no import.

```sauce chain=solana define=MINT
const MINT = 0n; // the SPL mint, as 32-byte hex: a define replaces it

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
npx sauce compile solana.sauce.ts --chain solana --define MINT=<mint, as 32-byte hex> --json
npx sauce run solana.sauce.ts --chain solana --config sauce.config.json --keypair <keypair> \
  --define MINT=<mint, as 32-byte hex> --account tokenProgram=<SPL Token program> \
  --account source=<the Pot's token account> --account destination=<token account> \
  --account authority=pot --args 400
```

## Accounts

- `Account` is read-only; `Account<Writable>` and `Account<Signer>` declare the role the
  transaction must grant. The manifest records `readonly`, `writable`, `readonly_signer` or
  `writable_signer` per slot. Roles are the author's declaration; nothing infers them from what a
  CPI needs.
- Each slot is passed by its name: `--account NAME=<address>`, `NAME=pot` for the Pot, which the
  Kitchen signs for, or `NAME=owner` for the signer. `sauce compile --json` lists the slots in its
  `manifest`, and a missing one is named with the role it needs.
- An `Account` compares by identity (`tokenProgram == SPL_TOKEN_PROGRAM`) and exposes `.owner` and
  `.dataLen`. Check the owner before trusting bytes: a hand-made account can carry any layout.
- `svm.sload(account, offset, length)` reads bytes; `.toLe()`/`.toBe()` make a number.
  `svm.call(program, [accounts...], data)` is a CPI to an attached program account.
- Scalar parameters are runtime arguments (`--args`); `Account` parameters are not encoded. A
  32-byte key chosen per compile, such as a mint, is a module constant (`const MINT = 0n;`) that
  `--define MINT=<32-byte hex>` replaces. A key that changes per call is an `Account` parameter: the
  command does not encode an `Address` argument of `main` on Solana.
- On Solana `ctx.self()` is the executing Sauce program's id, **not the Pot**, `ctx.msgSender()`
  the transaction's first signer, and `ctx.balance(acct.address)` an attached account's lamports. `ctx.msgValue`,
  `ctx.gasLeft`, `ctx.codeSize` and the other EVM reads are rejected; move lamports with a
  system-program CPI through `svm.call`. Every read, per target, is in
  [../sauce-script/references/builtins.md](../sauce-script/references/builtins.md).

## The Pot's key

The Pot is an account the program is given: declare it as `pot: Account<Signer>`, pass it as
`--account pot=pot`, and read `pot.address`. A `Signer` slot alone does not prove it is the Pot
(`pot=owner` satisfies it too). To bind it, re-derive the Pot: it is the Kitchen's program address
for the seeds `"pot"`, the owner and the 32-byte salt (zero unless `--salt` names another), and the
owner is `ctx.msgSender()` when the owner signs the cook, as `sauce run` does. `KITCHEN` is
`v12SvmKitchenProgramId()` from `@eco-incorp/sauce/deployments`, as a define:

```sauce chain=solana define=KITCHEN
const SALT = 0n; // the Pot's salt, zero by default

function main(pot: Account<Signer>, amount: Uint256) {
  const owner = ctx.msgSender();
  const [expected] = crypto.findPDA(KITCHEN, ["pot", owner.toBytesBe(32n), SALT.toBytesBe(32n)]);
  require(pot.address == expected, "pot is not the signer's Pot");
  require(amount > 0n);
}
```

## Token accounts

An SPL token account is 165 bytes, and `acct.owner` is the program that owns it (the SPL Token
program), not who may spend it:

| Bytes   | Field                                  | Read                               |
| ------- | -------------------------------------- | ---------------------------------- |
| 0–32    | mint                                   | `svm.sload(acct, 0n, 32n).toBe()`  |
| 32–64   | owner: the authority that may spend it | `svm.sload(acct, 32n, 32n).toBe()` |
| 64–72   | amount (u64, little-endian)            | `svm.sload(acct, 64n, 8n).toLe()`  |
| 72–76   | delegate tag (u32: 0 none, 1 some)     | `svm.sload(acct, 72n, 4n).toLe()`  |
| 76–108  | delegate                               | `svm.sload(acct, 76n, 32n).toBe()` |
| 121–129 | delegated amount (u64)                 | `svm.sload(acct, 121n, 8n).toLe()` |

**Check the authority before calling a balance the Pot's.** `transfer(..., authority, ...)` with
the Pot as `authority` also succeeds from an account where the Pot is only a delegate, up to the
delegated amount, so `require(svm.sload(source, 32n, 32n).toBe() == pot.address)` before treating
`source` as the Pot's own.

## USDC, and the Pot's token account

The SDK records Solana mainnet's USDC mint as `USDC_MINT` in `@eco-incorp/sauce/svm`:
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, which as a define is
`0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61`. It records no devnet mint, and
`sauce globals --chain solana` lists no token symbols.

The Pot's USDC sits in its associated token account, the ATA of (Pot, mint). Derive it with
`findAssociatedTokenPda` and create it with `getCreateAssociatedTokenIdempotentInstruction`, both
from `@solana-program/token`, then fund it with an ordinary SPL transfer from any wallet: `--fund`
is EVM only. `@solana/kit` and `@solana-program/token` are dependencies of the package, not of your
project: add them to it before importing them (to build a payer, derive an ATA or send a transfer).

## Transaction size

A Solana transaction is at most **1,232 bytes**, and the cook carries the program and its
arguments, so a program that does not fit has to be staged first, which only `sauce run` does. The
cook adds about 404 bytes and 33 more per account (538 with four accounts), so with four accounts a
program and its arguments have about 694 bytes. What costs bytes:

- each `require` message, byte for byte;
- each `@sauce/token` call, which inlines its own checks (a second `transfer` adds about 40 bytes, a
  `balanceOf` about 110);
- each account, about 33 bytes;
- arguments: `--compact-args` encodes them compactly (a `Uint256` takes 7 bytes instead of 32).

## `@sauce/token` on Solana

The SPL arm takes the mint first, then the accounts: `transfer(mint, tokenProgram, source, dest,
authority, amount)`, `approve(mint, tokenProgram, source, delegate, authority, amount)`,
`transferFrom` (the same instruction: SPL has one transfer for owners and delegates),
`balanceOf(mint, account)`, `allowance(mint, account, spender)`, `totalSupply(mintAccount)`,
`decimals(mintAccount)`. Every function requires the classic SPL Token program as the account owner
and callee, checks the mint, and rejects amounts above `u64`; a Token-2022 account is refused. SPL
tracks one delegate per account, so a second `approve` replaces the first.

For Token-2022 and `TransferChecked`, generate the program from TypeScript with the token builder
(`token.Token.transfer({ amount, svm: { ... } }).source("svm")`, top-level
`tokenProgram: "token-2022"`).

## Running

- **The Pot** is the Kitchen's address for the owner and salt.
  `npx sauce pot --chain solana --owner <pubkey>` prints it;
  `npx sauce pot --deploy --chain solana --config sauce.config.json --keypair <keypair>` creates it.
  A cook names its Pot by `--owner` (and `--salt`), never `--pot`.
- **The cook** pays the Kitchen's fee in lamports, read from the cluster, so there is no `--value`.
  `sauce simulate` runs it from `--owner` with no signature and prints the compute units, or the
  reason and the program logs; `sauce run` signs with `--keypair`; `sauce tx` prints a base64
  transaction for the owner's wallet.
- A program too large for one transaction is staged through the Kitchen by `sauce run`.
- The engine and Kitchen program ids come from `v12SvmEngineProgramId()` and
  `v12SvmKitchenProgramId()` in `/deployments`; confirm both are deployed on the cluster.
- `sauce publish` does not work from Solana; open an intent from an EVM chain. A failed `sauce run`
  prints the program logs.
- For a local run, the package ships the engine and Kitchen programs:
  `svmEnginePath()`, `svmKitchenPath()` and `svmKitchenIdlPath()` from
  `@eco-incorp/sauce/svm/engine-artifacts` (Node only) give the files to load into a local validator
  or LiteSVM; setting one up is outside this skill.
- From TypeScript the same cook goes through the Kitchen client:
  `createSauceSvmClient({ rpcUrl, payer, programId, kitchen, maxExecutionFee })`, with no default
  endpoint. The SVM route helpers (`Solana(...)` routes, `buildSauceSvmCall`) do not produce an
  instruction the engine accepts: build execution with the Kitchen client.
- Venue adapters (`venue("raydium-cp-swap")` from `/svm`, also `Solana.RaydiumCpSwap`) build pool
  configs, quote source and swap CPIs over an account loader you supply. Their swaps use a minimum
  output of one: enforce the real minimum with a balance delta in the program.

## Example

[examples/solana.sauce.ts](examples/solana.sauce.ts) is the program above;
[examples/solana.mts](examples/solana.mts) compiles it, checks the manifest order and roles and the
arguments, and confirms the client refuses to run without an `rpcUrl`.

---
name: sauce-solana
description: Writing and running Sauce programs on Solana (the SVM target) — declaring every account as an Account parameter with Writable/Signer roles, the account manifest the compile returns, passing accounts by name with --account, the @sauce/token SPL arm (transfer, approve, balanceOf with account parameters), svm.call CPIs and svm.sload byte reads, account .owner and .dataLen checks, a 32-byte key as a define, runtime arguments without Account slots, and how a program runs through the Kitchen with sauce run --chain solana. Use when the user targets Solana, SPL tokens, Token-2022, PDAs or CPIs, account manifests, lamport fees, LiteSVM, or Solana venues such as Raydium, Orca or Meteora.
---

# Sauce on Solana

A Solana program must declare every account it touches before it runs. In SauceScript those are
`Account` parameters of `main`; the compile returns them, in order and with their roles, as the
**account manifest**, and each is attached by name when the program runs. A program for Solana is
compiled with `--chain solana`. Its signatures are annotated. Protocol namespaces and the token
methods (`USDC.transfer(...)`) do not exist there; the `@sauce/token` functions do, with no import,
and a registered token symbol (`USDC`, `USDT`, `WSOL`) is its mint's 32-byte key, a value they take:
`balanceOf(USDC, account)`. `sauce globals --chain solana` lists the mints, and devnet's.

```sauce chain=solana define=MINT
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  destination: Account<Writable>,
  authority: Account<Signer>,
  amount: Uint256
): Uint256 {
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
  32-byte key the program needs as a value, such as a mint, is a define: `--define MINT=<hex>`. A
  define also overrides a registered symbol, which is how a devnet program names devnet's USDC.
- On Solana `ctx.self()` is the executing Sauce program's id, `ctx.msgSender()` the transaction's
  first signer, and `ctx.balance(acct.address)` an attached account's lamports. `ctx.msgValue`,
  `ctx.gasLeft`, `ctx.codeSize` and the other EVM reads are rejected; move lamports with a
  system-program CPI through `svm.call`. Every read, per target, is in
  [../sauce-script/references/builtins.md](../sauce-script/references/builtins.md).

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

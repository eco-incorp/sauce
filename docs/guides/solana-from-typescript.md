# Solana from TypeScript

**How-to guide** · [Documentation](../README.md) · [Solana](solana.md) · [How Sauce runs on Solana](../concepts/solana-model.md)

> The `sauce` command compiles, simulates and sends a Solana program for you. This page does the
> same from your own TypeScript: compile a program and keep its account list, create a client,
> simulate a cook, send it, and build the pieces yourself when you need to.

This page is for an application that builds Solana cooks in code. It assumes you have run a program
with the [Solana quick start](solana-quick-start.md), know what an account, a token account and a
staged program are ([How Sauce runs on Solana](../concepts/solana-model.md)), and have compiled
from TypeScript before ([Compile from TypeScript](compiling.md)).

## Install

```sh
npm install @eco-incorp/sauce @solana/kit
```

`@solana/kit` is Solana's TypeScript library: the examples here take its `Address`, its RPC client
and its `TransactionSigner`. The package depends on version 8 of it; install the same major
version. `@eco-incorp/sauce/svm` re-exports the few kit functions its own functions take
(`address`, `generateKeyPairSigner`, `getProgramDerivedAddress`, `AccountRole`,
`getAddressEncoder`, `blockhash`), so a project that needs only those can skip the install.

You also need:

- **An RPC URL** for your cluster. The SDK has no default endpoint.
- **A signer**, the wallet that pays and owns the Pot, as a kit `TransactionSigner`.
- **SOL in that wallet**, for the Kitchen's fee, transaction fees and rent
  ([Costs](../concepts/costs.md)).

A signer from a Solana CLI keypair file:

```ts
import { readFileSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";

export async function loadSigner(path: string) {
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
}
```

## Compile and keep the account manifest

Compile with `@eco-incorp/sauce/compiler` directly. Its result carries the **account manifest**,
the list of accounts the program needs, which you resolve to addresses before a cook.
`routes.compileSauceRoute()` returns calls and bytecode but drops the manifest.

The universal token builder emits account parameters and an SPL `TransferChecked` call into the
token program. Its source needs no imports, so a single-module resolver is enough:

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

The account references are names, not addresses. `manifest.accounts` records their order and
required roles. Resolve them to the mint, source token account, destination token account,
authority, and token program before execution. Amounts are smallest-unit integers. The builder
reads mint decimals for the checked instruction and defaults to the classic SPL Token program. Set
the builder's top-level `tokenProgram: "token-2022"` for a supported Token-2022 operation;
`svm.tokenProgram` names the account reference and must resolve to that token program.

A program that uses the token methods (`USDC.transfer(to, amount)`) or writes its accounts where it
uses them gets those accounts added to `main` ([Solana](solana.md#the-token-methods-every-account-derived)).
Compile it with `routes.compileSauceProgram("solana", source)`, whose `derivedAccounts` says how
each is derived. `resolveSvmAccountName(derivation, { chain, owner, pot, via, args, programOf })`
from `@eco-incorp/sauce/svm` resolves one derivation to the address to put in the cook's
`AccountResolution`.

## Create the client

`createSauceSvmClient` builds, signs and sends cooks. Its configuration:

| Field             | Required | What it is                                                                                                    |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `rpcUrl`          | yes      | your cluster's JSON-RPC URL                                                                                   |
| `wsUrl`           | no       | its websocket URL; defaults to `rpcUrl` with `http` swapped for `ws`                                          |
| `programId`       | yes      | the engine program                                                                                            |
| `kitchen`         | yes      | the Kitchen program, needed either way: a direct cook pays the fee the Kitchen's config sets                  |
| `payer`           | yes      | the `TransactionSigner` that signs and pays; through the Kitchen, the owner of the Pot                        |
| `potSalt`         | no       | which of the payer's Pots to cook on, 32 bytes; defaults to all zeros                                         |
| `maxExecutionFee` | no       | the most each cook may pay the Kitchen, in lamports; defaults to `0`, which fails while a fee is set          |
| `via`             | no       | `"kitchen"` (the default) or `"engine"`: see [two ways to cook](../concepts/solana-model.md#two-ways-to-cook) |

Read the program ids from `@eco-incorp/sauce/deployments` rather than pasting them, and confirm each
is deployed on the cluster you are targeting. Every cook pays the Kitchen's fee in lamports, and the
fee is read from the chain, not assumed: `fetchExecutionFee` (or a client's `executionFee()`) reads
the config account and refuses one that is not the Kitchen's. This example quotes it, refuses to
sign past a budget you set, and signs the quote as the cap:

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

The fee charged is the current one, up to the signed cap: a fee increase above the quoted amount
makes the cook fail. Quote again before signing a retry. Through the Kitchen the client cooks on the
Pot of its `payer` and `potSalt`. Direct, `payer` signs and pays the fee, and `potSalt` means
nothing.

## Simulate a cook

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

The resolution maps each manifest name to an account. For the transfer above, its keys are
`sourceAta`, `mint`, `destinationAta`, `owner`, and `tokenProgram`.

- **Signers.** A non-payer authority is `{ address, signer: transactionSigner }`: an address alone
  cannot provide its signature.
- **The Pot.** A Pot the Kitchen signs for is attached with `signer: false`. The Kitchen supplies
  that signature during the cook; a direct cook has no Kitchen to supply it.
- **Order.** `resolveAccounts` keeps manifest order. The reserved `payer` reference resolves to the
  fee payer. A manifest ending with `remaining` leaves the final account tail to you: do not insert
  accounts that shift that tail's indices.

Pass `{ accounts: [...] }` to `simulate` to see what the cook would move: the result's `accounts`
holds each one's state after the transaction (`lamports`, `owner`, `data`), or `null` where it no
longer exists, read without sending anything.

## Send it

`client.execute(bytecode, manifest, resolution, { computeUnitLimit: "auto" })` simulates to set the
compute budget, then sends the transaction and confirms it. A cook's own `maxExecutionFee` option
overrides the client's. `client.cookTransaction(...)` takes the same arguments and returns the
signed transaction without sending it, for a caller that sends it another way.

### When the accounts do not fit

A cook that names about thirty accounts no longer fits one transaction, and goes through an address
lookup table ([lookup tables](../concepts/solana-model.md#lookup-tables)). You write no code for it:

- `client.execute` and `client.executeStaged` measure the cook first. When it does not fit, they
  create a lookup table holding exactly the accounts a table may hold, wait until it can be used,
  and send the cook through it. The payer pays the table's rent and owns it. The result's
  `lookupTableAddress` names the table: pass it as `lookupTable` to a later cook with the same
  accounts, and the client uses it again, adding any account it lacks. `lookupTable: false` sends
  the cook as it is.
- To simulate such a cook first, or to build its transaction yourself, ask for its table with
  `client.cookLookupTable(bytecode, manifest, resolution)` (`stagedCookLookupTable` for a staged
  program). It returns `undefined` when the cook fits without one, and otherwise the ready table,
  whose `lookupTables` you pass on. `simulate` refuses a cook that does not fit and says so.

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

## Resolve a token's accounts

A program's accounts depend on which token program owns the mint, SPL Token or Token-2022
([token accounts](../concepts/solana-model.md#token-accounts)). `resolveSvmToken` reads the mint
through a loader that returns each account's owner, which is the only way to tell an extensionless
Token-2022 mint from a legacy one. The result gives the `tokenProgram` and `mintAccount` to attach
and the `decimals` to pass, and `svmTokenAccount` derives a holder's associated token account under
that program:

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

`svmTokenReceived` is the other direction: what a transfer of an amount delivers. Both apply the
mint's transfer fee exactly as Token-2022 computes it.

## Hold each pool's walk

A swap at a price through a venue namespace is listed in the compiled program's `stoppable`, by the
derivation of its stop ([compute](../concepts/solana-model.md#compute)).
`svmProgramStops(program, chain, accounts, integers, load)` works each out as `sauce` does, and
names in `binding` the swaps to hold. Compiled again with `stops: binding`, those call the Stopped
form, each stop a value added to `main` after the accounts (`derivedValues`, never one of
`entryParams`), and `svmStopValues` gives the values to encode after `main`'s own arguments.

## Build a direct cook yourself

The engine's three paid instructions have builders in `@eco-incorp/sauce/svm` (and the narrow
`@eco-incorp/sauce/svm/engine`): `buildCookAndPayInstruction` for inline bytecode,
`buildCookAndPayFromAccountPinnedInstruction` for a staged program and its digest, and
`buildCookAndPayFromAccountInstruction`, unpinned. Each takes the program's tail and appends the
fee payer, the System Program and the fee config, which the engine takes off before the program
runs. Every cook you assemble yourself starts with `buildHeapFramePrepend()`, the request for the
engine's working memory:

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

Staging belongs to the Kitchen, whichever way the program then runs. The client has no staging
method of its own: build and submit Kitchen instructions in this order.

1. Derive metadata and code addresses with `deriveCodeBufferPda(kitchen, owner, nonce)` and `deriveCodePda(kitchen, codeBuffer)`.
2. Allocate with `buildCreateCodeBufferInstruction`. Capacities above `GROWTH_STEP` require additional `buildGrowCodeBufferInstruction` calls.
3. Write the bytecode in appropriately sized chunks using `buildWriteCodeBufferInstruction`.
4. Finalize with `buildFinalizeCodeBufferInstruction`, supplying the byte length and its SHA-256 digest. Finalization verifies the digest and shrinks the code account to that length.
5. Execute with a Kitchen `buildCookFromAccountInstruction`, the engine's `buildCookAndPayFromAccountPinnedInstruction`, or the client's `simulateStaged`/`executeStaged` methods.

The low-level instruction builders return instructions; your application groups, signs, submits
and confirms them. A staged client's first argument is the **code-buffer metadata address**; it
derives the associated code account.

What each way of cooking checks about the staged bytes is set out in
[why a program is staged](../concepts/solana-model.md#why-a-program-is-staged). In code:

- **Through the Kitchen**, `buildCookFromAccountInstruction` takes a `pin` the Kitchen checks at
  execution time, and the Kitchen runs only a finalized buffer the signing owner holds. The client's
  `expectedSha256` option is rejected there: it is not a substitute for that pin.
- **Direct**, the client always pins a staged cook: to `expectedSha256`, or to the `sha256` of the
  `StagedBuffer` you pass, and a bare buffer address with neither is refused.
  `buildCookAndPayFromAccountInstruction` runs whatever the account holds when the transaction
  lands, with the signer's authority: use it only for an account no one else can change.

## Build a venue's swap instruction

The `Solana` accessor, imported from the package root, includes the venues registered for runtime
access. A venue accessor exposes a program ID, pool configuration loading, quote-source generation,
swap instruction construction, and a TypeScript reference quote:

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

`Solana.RaydiumCpSwap` exposes the same accessor after `import { Solana } from "@eco-incorp/sauce"`.
`poolConfig` uses the account loader you supply; it does not create an RPC client or discover
pools. `quoteSource` returns SauceScript source, and `.swap` returns instruction data plus account
references, not a transaction.

Venue swap builders use a venue-level minimum output of one, so the program must enforce your
actual minimum with a post-swap output balance check. Runtime accessors cover the registered venue
set; other adapters exported from `/svm` do not appear as `Solana.<Venue>`
([Coverage](../api/coverage.md#solana-venues) lists both). For a program that
calls a venue itself, `routerSvmAccountOrder`, `routerSvmAccounts`, `routerSvmDataTemplate` and
`ROUTER_SVM_VENUES` give every venue's accounts and data
([`@sauce/router` on Solana](../api/router-solana.md#the-instruction-alone)).

## Next

- Send a Solana program through an intent from Ethereum or Base:
  [SVM destinations in Eco intents](solana.md#svm-destinations-in-eco-intents).
- Test a Solana program on a local copy of the cluster: [Testing](testing.md).
- The swap functions a program calls: [`@sauce/router` on Solana](../api/router-solana.md).

# Solana programs and execution

[Documentation](../README.md) · [Compiler](../api/compiler.md) · [Coverage](../api/coverage.md)

Solana execution differs from EVM in one structural way, and everything on this page follows from it: **a Solana program must declare every account it touches, up front.** Those declarations are `Account` parameters on `main`, and the compiler returns them as an account manifest you resolve to real addresses before sending anything.

Two consequences. The EVM name rewrites (`USDC.transfer(...)`, protocol members) do not apply here — there is no address to fold in without an account slot to put it in. A registered token symbol is still a value: compiled for `solana` (`sauce compile --chain solana`, `routes.compileSauceProgram("solana", source)`), `USDC` is the mint's 32-byte key, which the `@sauce/token` functions take first (`balanceOf(USDC, account)`); `routes.SVM_TOKEN_REGISTRY` lists the mints, mainnet's and devnet's. And you want `@eco-incorp/sauce/compiler` directly: `routes.compileSauceRoute()` returns calls and bytecode but drops the manifest, which is the part you need.

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

## Two ways to run a program

The released engine has two entry points, and the SDK builds a cook for each. A client chooses with
`via`, and the `sauce` command with `--via` ([CLI guide](cli.md#solana)).

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
they are deployed on your cluster. `v12SvmProgramId` names an earlier engine
generation, not these. Through the Kitchen the client derives a Pot owned by its `payer` signer;
choose it with `potSalt` when you configure the client. Direct, `payer` signs and pays the fee, and
`potSalt` means nothing.

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

After successful simulation, `client.execute(bytecode, manifest, resolution, { computeUnitLimit: "auto" })` simulates for compute budgeting and sends the transaction. `maxExecutionFee` in client configuration is the lamport fee ceiling each cook signs; its default is zero and fails when the Kitchen charges a positive fee. A cook's own `maxExecutionFee` option overrides it. Lookup-table helpers can create or extend an address lookup table and wait until it is usable.

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

**Build Solana execution with the SVM client (`createSauceSvmClient`), not the SVM route helpers.**

`Solana(body, { execution, ... }).reward(...)`, `routes.compileSauceRoute()`,
`buildSauceSvmCall()` and `buildSauceSvmCalls()` emit an `execute_from_account`
instruction carrying only its 8-byte discriminator. The engine needs 65 further
bytes of Pot derivation material and a trailing Pot signer that the Kitchen
supplies, so that instruction is not one it will run — and pointing the helper at
a different engine id does not add the missing bytes.

The [SVM Portal's fulfillment](https://github.com/eco/eco-routes-svm/blob/5e544b72d368d9d1f0ee5269e2a1a5d2a9f8c2f2/programs/portal/src/instructions/fulfill.rs#L139-L192)
forwards a route's instruction bytes to their target unchanged and signs for its
own Executor PDA. It does not assemble a Kitchen call or sign for a Sauce Pot.
A Portal integration that reaches the Kitchen therefore needs cook data and
accounts built separately — the owner signature, the Pot, the fee configuration
and payer, the engine, and staged metadata and code where they apply. That
assembly is not in this package.

One detail worth knowing if you are reading routes somebody already built:
`execution.code` there means the finalized **code account**, not its metadata
address, and the helper neither stages that code nor checks it against the bytes
it just compiled. Keep the direct compilation result when you inspect one.

The EVM-source Portal helpers can encode a Solana destination perfectly well.
That is about encoding, not about submitting from Solana.

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

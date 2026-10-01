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

## Execute through the Kitchen

`createSauceSvmClient` requires an RPC URL, engine program ID, Kitchen program ID, and a Kit transaction signer. Its inline execution path constructs a Kitchen `cook`, includes the required heap-frame instruction, resolves accounts, and builds/signs transactions.

Use `v12SvmEngineProgramId()` and `v12SvmKitchenProgramId()` from
`@eco-incorp/sauce/deployments` for the released program identities, and confirm
they are deployed on your cluster. The client derives a Pot owned by its `payer` signer;
choose it with `potSalt` when you configure the client.

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

For the transfer above, the resolution keys are `sourceAta`, `mint`, `destinationAta`, `owner`, and `tokenProgram`. A non-payer transaction authority should be supplied as `{ address, signer: transactionSigner }`; an address alone cannot provide its signature. A Pot PDA that the Kitchen signs for must be attached with `signer: false` in the transaction resolution. That override represents a signature supplied during invocation, not permission to bypass the program's authority requirement.

After successful simulation, `client.execute(bytecode, manifest, resolution, { computeUnitLimit: "auto" })` simulates for compute budgeting and sends the transaction. `maxExecutionFee` in client configuration is the lamport fee ceiling accepted for each cook; its default is zero and fails when the Kitchen charges a positive fee. Lookup-table helpers can create or extend an address lookup table and wait until it is usable.

### Select the released programs and quote the fee

Read the program ids from the deployment helpers rather than pasting them, and
confirm each is deployed on the cluster you are targeting. The SDK's clients cook
through the Kitchen; the engine's direct paid instructions have no builder here.

Every cook pays the Kitchen's fee in lamports, and the fee is read from chain, not
assumed. This example quotes it and refuses to sign past a budget the caller set:

```ts
import { createHash } from "node:crypto";
import {
  address,
  assertAccountExists,
  createSolanaRpc,
  fetchEncodedAccount,
  type TransactionSigner,
} from "@solana/kit";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "@eco-incorp/sauce/deployments";
import { createSauceSvmClient, deriveExecutionFeeConfigPda } from "@eco-incorp/sauce/svm";

export async function createReleasedClient(
  rpcUrl: string,
  payer: TransactionSigner,
  feeBudgetLamports: bigint,
) {
  const kitchen = address(v12SvmKitchenProgramId());
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
  const account = await fetchEncodedAccount(createSolanaRpc(rpcUrl), feeConfig);
  assertAccountExists(account);
  const discriminator = createHash("sha256")
    .update("account:ExecutionFeeConfig")
    .digest()
    .subarray(0, 8);
  if (
    account.programAddress !== kitchen ||
    account.data.length !== 16 ||
    !discriminator.every((value, index) => account.data[index] === value)
  )
    throw new Error("Unexpected Kitchen fee account");
  const fee = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  ).getBigUint64(8, true);
  if (fee > feeBudgetLamports) throw new Error("Kitchen fee exceeds the approved budget");
  return createSauceSvmClient({
    rpcUrl,
    payer,
    kitchen,
    programId: address(v12SvmEngineProgramId()),
    maxExecutionFee: fee,
  });
}
```

The payer needs SOL for this per-cook fee, transaction fees, and any rent or program
spending. The Kitchen charges its current fee up to the signed cap; a fee increase
above the quoted amount makes the cook fail. Requote before signing a retry.

`resolveAccounts` preserves manifest order. The reserved `payer` reference resolves to the fee payer. A manifest ending with `remaining` leaves the final account tail to the caller; do not insert accounts that shift that tail's indices.

## Stage a larger program

Staging belongs to the Kitchen. There is no `client.stageBuffer()` convenience method. Build and submit Kitchen instructions in this order:

1. Derive metadata and code addresses with `deriveCodeBufferPda(kitchen, owner, nonce)` and `deriveCodePda(kitchen, codeBuffer)`.
2. Allocate with `buildCreateCodeBufferInstruction`. Capacities above `GROWTH_STEP` require additional `buildGrowCodeBufferInstruction` calls.
3. Write the bytecode in appropriately sized chunks using `buildWriteCodeBufferInstruction`.
4. Finalize with `buildFinalizeCodeBufferInstruction`, supplying the byte length and its SHA-256 digest. Finalization verifies the digest and shrinks the code account to that length.
5. Execute with a Kitchen `buildCookFromAccountInstruction`, or the client's `simulateStaged`/`executeStaged` methods.

The low-level instruction builders return instructions; the application groups, signs, submits, and confirms them. The two Kitchen cook paths require `buildHeapFramePrepend()` when assembling transactions yourself. A staged client's first argument is the **code-buffer metadata address**; it derives the associated code account.

`buildCookFromAccountInstruction` takes a `pin` the Kitchen checks at execution time. The client's `expectedSha256` option is rejected — it is not a substitute for that pin. The digest checked when a buffer is finalized and a digest chosen by a caller at execution are different guarantees about different moments; read both before relying on either.

## SVM destinations in Eco intents

**Build Solana execution with the Kitchen client, not the SVM route helpers.**

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

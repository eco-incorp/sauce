import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import type {
  Address,
  AddressesByLookupTableAddress,
  Commitment,
  Instruction,
  Signature,
  TransactionSigner,
} from "@solana/kit";
import type { AccountManifest } from "sauce-compiler";
import type { ArgsLayout, ArgValue } from "./layout.js";
import {
  LOOKUP_TABLE_MAX_ADDRESSES,
  createAltWithAddresses,
  extendAlt,
  fetchAlt,
  waitForAltActive,
} from "./alt.js";
import { assertNoExecutePin } from "./instructions.js";
import { buildComputeBudgetPrepend, buildHeapFramePrepend } from "./prepends.js";
import { resolveAccounts } from "./resolve.js";
import {
  buildCookFromAccountInstruction,
  buildCookInstruction,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
} from "./kitchen.js";
import type { AccountResolution } from "./resolve.js";
import { recommendedComputeUnitLimit, sendExecute, simulateExecute } from "./send.js";
import type { SendExecuteResult, SimulateExecuteResult } from "./send.js";
import { buildExecuteTransaction } from "./transaction.js";
import type { SignedExecuteTransaction } from "./transaction.js";

export interface SauceSvmClientConfig {
  rpcUrl: string;
  /** Defaults to rpcUrl with the protocol swapped to ws(s). */
  wsUrl?: string;
  /** The ENGINE. Named per call rather than compiled in, and still the interpreter that runs — but
   *  it is no longer what a transaction talks to. */
  programId: Address;
  /**
   * The KITCHEN every execution goes through.
   *
   * A released engine refuses any invocation that did not arrive through a kitchen cook, so this is
   * not optional: without it there is no way to reach the interpreter at all.
   */
  kitchen: Address;
  payer: TransactionSigner;
  /** Which of the payer's Pots to run as. Defaults to the all-zero salt — the natural "primary". */
  potSalt?: Uint8Array;
  /**
   * What the caller consents to pay per cook, in lamports. Defaults to zero, which succeeds only
   * while the kitchen is priced at zero — a kitchen with a positive fee refuses, rather than
   * silently spending the payer's SOL on a quote they never saw.
   */
  maxExecutionFee?: bigint;
}

export interface SimulateOpts {
  prepends?: readonly Instruction[];
  lookupTables?: AddressesByLookupTableAddress;
  /**
   * Append the fee payer as an in-list readonly signer when the manifest yields no
   * signer meta. Needed ONLY for programs that read MSG_SENDER/TX_ORIGIN —
   * NoSigner is lazy, so everything else runs (and simulates) signerless.
   */
  appendPayerSigner?: boolean;
}

export interface ExecuteOpts extends SimulateOpts {
  /** 'auto' simulates first and applies recommendedComputeUnitLimit (x1.2, capped 1.4M). */
  computeUnitLimit?: number | "auto";
}

/** A buffer staged by this client — carries the SDK-computed content hash (the execute pin). */
export interface StagedBuffer {
  address: Address;
  /** The 32-byte PDA seed the buffer was derived + init'd under. */
  seed: Uint8Array;
  /** sha256 of the staged bytecode, computed SDK-side and verified on-chain at finalize. */
  sha256: Uint8Array;
  /** Staging transaction signatures in send order: init, writes…, finalize. */
  signatures: Signature[];
}

/** Per-execution args for a staged program. The layout is CALLER-SUPPLIED: neither `CompileResult`
 *  carries one — the compiler's is `{ bytecode, manifest? }`, the route seam's is
 *  `{ bytecode: Uint8Array[], warnings }` — so `ArgsLayout` is the SDK's own type (`./layout.ts`)
 *  describing where each value sits in the payload tail. */
export interface StagedArgs {
  layout: ArgsLayout;
  values: readonly ArgValue[];
}

export interface SimulateStagedOpts extends SimulateOpts {
  /**
   * REJECTED, not enforced. Passing this THROWS.
   *
   * `execute_from_account` on the released engine takes no payload, so this was being forwarded
   * and then dropped while documented as an applied pin. The enforceable content pin is the
   * kitchen's, given to `buildFinalizeCodeBufferInstruction` when the buffer is finalized.
   */
  expectedSha256?: Uint8Array;
}

export interface ExecuteStagedOpts extends SimulateStagedOpts {
  computeUnitLimit?: number | "auto";
}

/** An address lookup table this client created/extended, ready to compress a v0 transaction against. */
export interface EnsuredLookupTable {
  lookupTableAddress: Address;
  /** The shape `executeStaged`/`simulate`'s `lookupTables` option consumes (table → its addresses). */
  lookupTables: AddressesByLookupTableAddress;
}

export interface EnsureLookupTableOpts {
  /**
   * Reuse and EXTEND this table instead of creating a fresh one: the addresses
   * already in it are diffed out and only the missing ones are appended (an
   * all-present set sends nothing) — the idempotent per-universe reuse path.
   */
  existing?: Address;
  commitment?: Commitment;
}

export interface SauceSvmClient {
  /** Fee-payer / lookup-table authority public key — the ALT-address selection excludes it (signers cannot be looked up). */
  readonly payerAddress: Address;
  /**
   * Creates (or, with `opts.existing`, extends) an address lookup table over
   * `addresses`, waits for it to warm up, and returns it in the shape the
   * execute/simulate `lookupTables` option consumes. Signers must NOT be in
   * `addresses` — they have to stay static message accounts. Idempotent on the
   * existing path: an already-covering table sends no transactions. A set that
   * would take the table past LOOKUP_TABLE_MAX_ADDRESSES throws before any
   * transaction is sent — a partially-extended table cannot be un-funded.
   */
  ensureLookupTable(
    addresses: readonly Address[],
    opts?: EnsureLookupTableOpts,
  ): Promise<EnsuredLookupTable>;
  simulate(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: SimulateOpts,
  ): Promise<SimulateExecuteResult>;
  execute(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: ExecuteOpts,
  ): Promise<SendExecuteResult>;
  simulateStaged(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: SimulateStagedOpts,
  ): Promise<SimulateExecuteResult>;
  /**
   * Executes a finalized buffer, hash-pinned, in ONE instruction. With `args`,
   * the per-execution values are encoded into the instruction payload
   * (encodePayloadArgs) after the flags byte and pin — the staged program
   * reads them through its CALLDATA prologue, so one staged buffer serves
   * every argument set without restaging.
   */
  executeStaged(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts?: ExecuteStagedOpts,
  ): Promise<SendExecuteResult>;
}

export async function createSauceSvmClient({
  rpcUrl,
  wsUrl,
  programId,
  kitchen,
  payer,
  potSalt = new Uint8Array(32),
  maxExecutionFee = 0n,
}: SauceSvmClientConfig): Promise<SauceSvmClient> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl ?? rpcUrl.replace(/^http/, "ws"));
  // Derived once: both are pure functions of the kitchen and the payer, and a cook names them on
  // every call.
  const { address: pot } = await derivePotPda(kitchen, payer.address, potSalt);
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);

  /**
   * Signs an execute transaction: RequestHeapFrame(262144) FIRST (required on
   * every execute/simulate; add-once — caller prepends must not carry their
   * own), then the prepends, then the execute instruction.
   */
  async function signExecuteTransaction(
    executeInstruction: Instruction,
    prepends: readonly Instruction[],
    lookupTables?: AddressesByLookupTableAddress,
  ): Promise<SignedExecuteTransaction> {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    return buildExecuteTransaction({
      payer,
      instructions: [buildHeapFramePrepend(), ...prepends, executeInstruction],
      latestBlockhash,
      lookupTables,
    });
  }

  async function buildTransaction(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    prepends: readonly Instruction[],
    opts: SimulateOpts,
  ): Promise<SignedExecuteTransaction> {
    const accounts = resolveAccounts(manifest, resolution, payer.address, {
      appendPayerSigner: opts.appendPayerSigner,
    });
    const executeInstruction = buildCookInstruction({
      kitchen,
      owner: payer.address,
      engineProgram: programId,
      potSalt,
      pot,
      feeConfig,
      bytecode,
      maxExecutionFee,
      tail: accounts,
    });

    return signExecuteTransaction(executeInstruction, prepends, opts.lookupTables);
  }

  async function simulate(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateOpts = {},
  ): Promise<SimulateExecuteResult> {
    const transaction = await buildTransaction(
      bytecode,
      manifest,
      resolution,
      opts.prepends ?? [],
      opts,
    );

    return simulateExecute(rpc, transaction);
  }

  async function buildStagedTransaction(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    prepends: readonly Instruction[],
    opts: SimulateStagedOpts,
  ): Promise<SignedExecuteTransaction> {
    const address = typeof buffer === "string" ? buffer : buffer.address;
    const accounts = resolveAccounts(manifest, resolution, payer.address, {
      appendPayerSigner: opts.appendPayerSigner,
    });
    assertNoExecutePin(opts.expectedSha256);

    const { address: code } = await deriveCodePda(kitchen, address);
    const executeInstruction = buildCookFromAccountInstruction({
      kitchen,
      owner: payer.address,
      codeBuffer: address,
      code,
      engineProgram: programId,
      potSalt,
      pot,
      feeConfig,
      maxExecutionFee,
      tail: accounts,
    });

    return signExecuteTransaction(executeInstruction, prepends, opts.lookupTables);
  }

  async function simulateStaged(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateStagedOpts = {},
  ): Promise<SimulateExecuteResult> {
    const transaction = await buildStagedTransaction(
      buffer,
      manifest,
      resolution,
      opts.prepends ?? [],
      opts,
    );

    return simulateExecute(rpc, transaction);
  }

  async function autoComputeUnitPrepends(
    simulateRun: () => Promise<SimulateExecuteResult>,
    opts: ExecuteOpts | ExecuteStagedOpts,
  ): Promise<Instruction[]> {
    let unitLimit: number | undefined;

    if (opts.computeUnitLimit === "auto") {
      const sim = await simulateRun();

      if (!sim.ok || sim.unitsConsumed === undefined) {
        throw new Error(
          `compute unit auto-limit simulation failed: ${JSON.stringify(sim.err) ?? "no units consumed"}`,
        );
      }

      unitLimit = recommendedComputeUnitLimit(sim.unitsConsumed);
    } else {
      unitLimit = opts.computeUnitLimit;
    }

    return [
      ...(unitLimit !== undefined ? buildComputeBudgetPrepend({ unitLimit }) : []),
      ...(opts.prepends ?? []),
    ];
  }

  const sendAndConfirmAlt = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  async function ensureLookupTable(
    addresses: readonly Address[],
    opts: EnsureLookupTableOpts = {},
  ): Promise<EnsuredLookupTable> {
    if (addresses.length === 0) {
      throw new Error(
        "ensureLookupTable needs at least one address (a lookup table cannot be empty)",
      );
    }
    const commitment = opts.commitment ?? "confirmed";
    const deduped = [...new Set(addresses)];

    if (opts.existing !== undefined) {
      const current = (await fetchAlt(rpc, opts.existing))[opts.existing] ?? [];
      const have = new Set(current);
      const missing = deduped.filter((address) => !have.has(address));
      if (current.length + missing.length > LOOKUP_TABLE_MAX_ADDRESSES) {
        throw new Error(
          `lookup table ${opts.existing} holds ${current.length} addresses and cannot take ${missing.length} more: one table holds at most ${LOOKUP_TABLE_MAX_ADDRESSES}`,
        );
      }
      if (missing.length > 0) {
        const { lastExtendedSlot } = await extendAlt({
          rpc,
          payer,
          authority: payer,
          lookupTableAddress: opts.existing,
          addresses: missing,
          sendAndConfirm: sendAndConfirmAlt,
          commitment,
        });
        await waitForAltActive(rpc, lastExtendedSlot);
      }
      return {
        lookupTableAddress: opts.existing,
        lookupTables: await fetchAlt(rpc, opts.existing),
      };
    }

    const { lookupTableAddress, lastExtendedSlot } = await createAltWithAddresses({
      rpc,
      payer,
      authority: payer,
      addresses: deduped,
      sendAndConfirm: sendAndConfirmAlt,
      commitment,
    });
    await waitForAltActive(rpc, lastExtendedSlot);
    return { lookupTableAddress, lookupTables: await fetchAlt(rpc, lookupTableAddress) };
  }

  return {
    payerAddress: payer.address,
    ensureLookupTable,
    simulate,

    async execute(
      bytecode: Uint8Array,
      manifest: AccountManifest,
      resolution: AccountResolution,
      opts: ExecuteOpts = {},
    ): Promise<SendExecuteResult> {
      const prepends = await autoComputeUnitPrepends(
        () =>
          simulate(bytecode, manifest, resolution, {
            prepends: opts.prepends,
            lookupTables: opts.lookupTables,
            appendPayerSigner: opts.appendPayerSigner,
          }),
        opts,
      );
      const transaction = await buildTransaction(bytecode, manifest, resolution, prepends, opts);

      return sendExecute({ rpc, rpcSubscriptions, transaction });
    },

    simulateStaged,

    async executeStaged(
      buffer: Address | StagedBuffer,
      manifest: AccountManifest,
      resolution: AccountResolution,
      opts: ExecuteStagedOpts = {},
    ): Promise<SendExecuteResult> {
      const prepends = await autoComputeUnitPrepends(
        () =>
          simulateStaged(buffer, manifest, resolution, {
            prepends: opts.prepends,
            lookupTables: opts.lookupTables,
            appendPayerSigner: opts.appendPayerSigner,
            expectedSha256: opts.expectedSha256,
          }),
        opts,
      );
      const transaction = await buildStagedTransaction(
        buffer,
        manifest,
        resolution,
        prepends,
        opts,
      );

      return sendExecute({ rpc, rpcSubscriptions, transaction });
    },
  };
}

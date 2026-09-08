import { createSolanaRpc, createSolanaRpcSubscriptions, sendAndConfirmTransactionFactory } from '@solana/kit';
import type { Address, AddressesByLookupTableAddress, Commitment, Instruction, Signature, TransactionSigner } from '@solana/kit';
import type { AccountManifest } from 'sauce-compiler';
import type { ArgsLayout, ArgValue } from './layout.js';
import { LOOKUP_TABLE_MAX_ADDRESSES, createAltWithAddresses, extendAlt, fetchAlt, waitForAltActive } from './alt.js';
import { encodePayloadArgs } from './args.js';
import {
  buildCloseBufferInstruction,
  buildExecuteFromAccountInstruction,
  buildExecuteInstruction,
  buildFinalizeBufferInstruction,
  buildInitBufferInstructions,
  buildStagingPlan,
  buildWriteBufferInstruction,
} from './instructions.js';
import { deriveBufferPda } from './pda.js';
import { buildComputeBudgetPrepend, buildHeapFramePrepend } from './prepends.js';
import { resolveAccounts } from './resolve.js';
import type { AccountResolution } from './resolve.js';
import { recommendedComputeUnitLimit, sendExecute, simulateExecute } from './send.js';
import type { SendExecuteResult, SimulateExecuteResult } from './send.js';
import { buildExecuteTransaction } from './transaction.js';
import type { SignedExecuteTransaction } from './transaction.js';

export interface SauceSvmClientConfig {
  rpcUrl: string;
  /** Defaults to rpcUrl with the protocol swapped to ws(s). */
  wsUrl?: string;
  programId: Address;
  payer: TransactionSigner;
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
  computeUnitLimit?: number | 'auto';
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
  args?: StagedArgs;
  /**
   * Content-hash pin for the execute (32 bytes). Required for buffers this
   * client did not stage itself — a buffer address alone is never a
   * cross-lifecycle trust anchor. Buffers from stageBuffer pin automatically.
   */
  expectedSha256?: Uint8Array;
}

export interface ExecuteStagedOpts extends SimulateStagedOpts {
  computeUnitLimit?: number | 'auto';
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
  ensureLookupTable(addresses: readonly Address[], opts?: EnsureLookupTableOpts): Promise<EnsuredLookupTable>;
  simulate(bytecode: Uint8Array, manifest: AccountManifest, resolution: AccountResolution, opts?: SimulateOpts): Promise<SimulateExecuteResult>;
  execute(bytecode: Uint8Array, manifest: AccountManifest, resolution: AccountResolution, opts?: ExecuteOpts): Promise<SendExecuteResult>;
  /**
   * Stages bytecode into the buffer at 32-byte `seed` (init → chunked writes → a
   * dedicated finalize sent only after every write confirmed, each tx on a fresh
   * blockhash). The buffer at that seed must not be finalized — close it first
   * (closeBuffer) to recompile at the same address. The same seed is resumable:
   * it always derives the same address, and the content-hash pin is recorded
   * just before the finalize send, so a run that dies after the buffer is
   * finalized on-chain still leaves executeStaged/simulateStaged able to
   * address it.
   */
  stageBuffer(seed: Uint8Array, bytecode: Uint8Array): Promise<StagedBuffer>;
  /** Closes the buffer at 32-byte `seed`, refunding its rent to the payer (the recompile path). */
  closeBuffer(seed: Uint8Array): Promise<SendExecuteResult>;
  simulateStaged(buffer: Address | StagedBuffer, manifest: AccountManifest, resolution: AccountResolution, opts?: SimulateStagedOpts): Promise<SimulateExecuteResult>;
  /**
   * Executes a finalized buffer, hash-pinned, in ONE instruction. With `args`,
   * the per-execution values are encoded into the instruction payload
   * (encodePayloadArgs) after the flags byte and pin — the staged program
   * reads them through its CALLDATA prologue, so one staged buffer serves
   * every argument set without restaging.
   */
  executeStaged(buffer: Address | StagedBuffer, manifest: AccountManifest, resolution: AccountResolution, opts?: ExecuteStagedOpts): Promise<SendExecuteResult>;
}

export async function createSauceSvmClient({ rpcUrl, wsUrl, programId, payer }: SauceSvmClientConfig): Promise<SauceSvmClient> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl ?? rpcUrl.replace(/^http/, 'ws'));
  /** Content hashes of buffers staged by THIS client — the automatic execute pins. */
  const stagedHashes = new Map<Address, Uint8Array>();

  async function currentDataSize(account: Address): Promise<number> {
    const { value } = await rpc.getAccountInfo(account, { encoding: 'base64' }).send();

    return value === null ? 0 : Number(value.space);
  }

  /** Sends staging/lifecycle instructions — NO heap frame (they never touch interpreter memory). */
  async function sendInstructions(instructions: readonly Instruction[]): Promise<SendExecuteResult> {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transaction = await buildExecuteTransaction({ payer, instructions, latestBlockhash });

    return sendExecute({ rpc, rpcSubscriptions, transaction });
  }

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
    const accounts = resolveAccounts(manifest, resolution, payer.address, { appendPayerSigner: opts.appendPayerSigner });
    const executeInstruction = buildExecuteInstruction({ programId, bytecode, accounts });

    return signExecuteTransaction(executeInstruction, prepends, opts.lookupTables);
  }

  async function simulate(
    bytecode: Uint8Array,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateOpts = {},
  ): Promise<SimulateExecuteResult> {
    const transaction = await buildTransaction(bytecode, manifest, resolution, opts.prepends ?? [], opts);

    return simulateExecute(rpc, transaction);
  }

  function stagedPin(address: Address, expectedSha256?: Uint8Array): Uint8Array {
    const pin = expectedSha256 ?? stagedHashes.get(address);

    if (pin === undefined) {
      throw new Error(
        `buffer ${address} was not staged by this client: pass expectedSha256 (the content-hash pin) — an address alone is never a trust anchor`,
      );
    }

    return pin;
  }

  async function buildStagedTransaction(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    prepends: readonly Instruction[],
    opts: SimulateStagedOpts,
  ): Promise<SignedExecuteTransaction> {
    const address = typeof buffer === 'string' ? buffer : buffer.address;
    const expectedSha256 = stagedPin(address, opts.expectedSha256 ?? (typeof buffer === 'string' ? undefined : buffer.sha256));
    const accounts = resolveAccounts(manifest, resolution, payer.address, { appendPayerSigner: opts.appendPayerSigner });
    const args = opts.args && opts.args.layout.slots.length > 0 ? encodePayloadArgs(opts.args.layout, opts.args.values) : undefined;
    const executeInstruction = buildExecuteFromAccountInstruction({ programId, buffer: address, accounts, expectedSha256, args });

    return signExecuteTransaction(executeInstruction, prepends, opts.lookupTables);
  }

  async function simulateStaged(
    buffer: Address | StagedBuffer,
    manifest: AccountManifest,
    resolution: AccountResolution,
    opts: SimulateStagedOpts = {},
  ): Promise<SimulateExecuteResult> {
    const transaction = await buildStagedTransaction(buffer, manifest, resolution, opts.prepends ?? [], opts);

    return simulateExecute(rpc, transaction);
  }

  async function autoComputeUnitPrepends(
    simulateRun: () => Promise<SimulateExecuteResult>,
    opts: ExecuteOpts | ExecuteStagedOpts,
  ): Promise<Instruction[]> {
    let unitLimit: number | undefined;

    if (opts.computeUnitLimit === 'auto') {
      const sim = await simulateRun();

      if (!sim.ok || sim.unitsConsumed === undefined) {
        throw new Error(`compute unit auto-limit simulation failed: ${JSON.stringify(sim.err) ?? 'no units consumed'}`);
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

  async function ensureLookupTable(addresses: readonly Address[], opts: EnsureLookupTableOpts = {}): Promise<EnsuredLookupTable> {
    if (addresses.length === 0) {
      throw new Error('ensureLookupTable needs at least one address (a lookup table cannot be empty)');
    }
    const commitment = opts.commitment ?? 'confirmed';
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
      return { lookupTableAddress: opts.existing, lookupTables: await fetchAlt(rpc, opts.existing) };
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

    async stageBuffer(seed: Uint8Array, bytecode: Uint8Array): Promise<StagedBuffer> {
      const plan = buildStagingPlan(bytecode.length);
      const { address } = await deriveBufferPda(programId, payer.address, seed);
      // Copy into a fresh ArrayBuffer-backed view (subtle.digest rejects
      // SharedArrayBuffer-backed views at the type level).
      const sha256 = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytecode)));
      const currentBytes = await currentDataSize(address);
      const signatures: Signature[] = [];

      // One init tx (all growth steps pack), one tx per write chunk, then the
      // DEDICATED finalize — sent only after every write confirmed (landing
      // order across concurrently broadcast txs is not guaranteed; the on-chain
      // hash gate backstops any race). Each send fetches a fresh blockhash.
      const initInstructions = buildInitBufferInstructions({
        programId,
        payer: payer.address,
        buffer: address,
        seed,
        capacity: bytecode.length,
        currentBytes,
      });

      if (initInstructions.length > 0) {
        signatures.push((await sendInstructions(initInstructions)).signature);
      }

      for (const chunk of plan.chunks) {
        const write = buildWriteBufferInstruction({
          programId,
          authority: payer.address,
          buffer: address,
          offset: chunk.offset,
          chunk: bytecode.subarray(chunk.offset, chunk.offset + chunk.length),
        });
        signatures.push((await sendInstructions([write])).signature);
      }

      const finalize = buildFinalizeBufferInstruction({
        programId,
        authority: payer.address,
        buffer: address,
        length: bytecode.length,
        sha256,
      });
      // Pinned immediately before the finalize send: the only step that follows
      // is sendExecute's post-confirmation meta read, so the pin survives a
      // throw there and still leaves the finalized buffer addressable. Any
      // earlier, and a restage that cannot land — the buffer at this seed is
      // already finalized — would overwrite the good pin of the bytes the
      // buffer actually holds.
      stagedHashes.set(address, sha256);
      signatures.push((await sendInstructions([finalize])).signature);

      return { address, seed, sha256, signatures };
    },

    async closeBuffer(seed: Uint8Array): Promise<SendExecuteResult> {
      const { address } = await deriveBufferPda(programId, payer.address, seed);
      stagedHashes.delete(address);

      return sendInstructions([buildCloseBufferInstruction({ programId, authority: payer.address, buffer: address })]);
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
            args: opts.args,
            expectedSha256: opts.expectedSha256,
          }),
        opts,
      );
      const transaction = await buildStagedTransaction(buffer, manifest, resolution, prepends, opts);

      return sendExecute({ rpc, rpcSubscriptions, transaction });
    },
  };
}

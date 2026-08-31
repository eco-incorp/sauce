import type { Address, AddressesByLookupTableAddress, Commitment, Instruction, Signature, TransactionSigner } from '@solana/kit';
import type { AccountManifest } from 'sauce-compiler';
import type { ArgsLayout, ArgValue } from './layout.js';
import type { AccountResolution } from './resolve.js';
import type { SendExecuteResult, SimulateExecuteResult } from './send.js';
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
/** Per-execution args for a staged program, matching the compile's argsLayout. */
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
     * existing path: an already-covering table sends no transactions.
     */
    ensureLookupTable(addresses: readonly Address[], opts?: EnsureLookupTableOpts): Promise<EnsuredLookupTable>;
    simulate(bytecode: Uint8Array, manifest: AccountManifest, resolution: AccountResolution, opts?: SimulateOpts): Promise<SimulateExecuteResult>;
    execute(bytecode: Uint8Array, manifest: AccountManifest, resolution: AccountResolution, opts?: ExecuteOpts): Promise<SendExecuteResult>;
    /**
     * Stages bytecode into the buffer at 32-byte `seed` (init → chunked writes → a
     * dedicated finalize sent only after every write confirmed, each tx on a fresh
     * blockhash). The buffer at that seed must not be finalized — close it first
     * (closeBuffer) to recompile at the same address. The same seed is resumable:
     * it always derives the same address.
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
export declare function createSauceSvmClient({ rpcUrl, wsUrl, programId, payer }: SauceSvmClientConfig): Promise<SauceSvmClient>;
//# sourceMappingURL=client.d.ts.map
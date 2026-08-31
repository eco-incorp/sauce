/**
 * Packet budget estimator for the 'svm' compile target.
 *
 * Solana caps a serialized transaction packet at 1232 bytes. Two execute
 * transports exist:
 *
 * - **inline** (`execute`): the instruction data carries the full v12 bytecode,
 *   so bytecode size eats directly into the packet budget (practical ceiling
 *   ~900-1000 bytes of bytecode depending on the account surface).
 * - **staged** (`execute_from_account`): the bytecode lives in a finalized
 *   buffer PDA (staged across separate transactions) and the execute
 *   instruction data is the 8-byte discriminator + the 1-byte flags + the
 *   32-byte content-hash pin + the payload args — bytecode size stops
 *   mattering to the packet and is bounded by the 65,535-byte composite
 *   (`program ++ args`) instead. The account list gains the buffer (prepended
 *   read-only before the user tail).
 *
 * estimatePacket models the v0 transaction the send layer will build (fee
 * payer + engine program + the plan's user accounts, the SDK-normative
 * `RequestHeapFrame(262144)` prepend, execute as the only other instruction)
 * and reports overflow before anything hits the wire. Pure function of its
 * inputs; raw-index plans have empty metas, so their user accounts are not
 * counted.
 *
 * The ref 'payer' is reserved: the SDK's resolveAccounts binds it to the fee
 * payer, whose signature, key, and lock the fixed terms already count — a plan
 * meta under that ref adds only its 1-byte instruction account index. NoSigner
 * is lazy on both execute paths (raised only when the program reads
 * MSG_SENDER/TX_ORIGIN), so no signer meta is auto-appended or modeled.
 *
 * Staged payload-args budget (measured, engine tests/payload_args.rs, legacy
 * tx): the fixed transaction cost is 293 + 33·N wire bytes with a pin, both
 * ComputeBudget instructions, and N extra user accounts — leaving
 * **939 − 33·N** bytes for payload args. The engine pin is legacy-shaped; the
 * v0 message this estimator models costs 2 more bytes (version prefix + empty
 * ALT section), which the estimate carries and the budget line mirrors as the
 * normative SDK warning threshold.
 */
import type { AccountPlan } from './registry.js';
export type PacketMode = 'inline' | 'staged';
export interface PacketBudgetOptions {
    /**
     * Execute transport being modeled. 'inline' (default) carries the bytecode
     * in the instruction data; 'staged' models execute_from_account — data is
     * discriminator + flags + 32-byte hash pin + payload args, the buffer
     * account is prepended, and the bytecode is bounded by the 65,535-byte
     * composite instead of the packet. Pass the plan the staged compile produced.
     */
    mode?: PacketMode;
    /**
     * staged only: payload-arg bytes riding the execute instruction data (the
     * compile passes argsLayout.byteLength). Default 0.
     */
    argsBytes?: number;
    /**
     * Transaction signature count (fee payer included). Default: 1 (fee payer)
     * + one per plan meta flagged signer, except the reserved 'payer' ref (it is
     * guaranteed-bound to the fee payer). Still conservative for any OTHER
     * signer ref the sender happens to resolve to the fee payer's own key —
     * pass an explicit count for that case.
     */
    signers?: number;
    /** Address lookup tables referenced by the message. Default 0. */
    lookupTables?: number;
    /** Account metas resolved via those tables (moved out of the static key section). Default 0. */
    lookupAddresses?: number;
    /**
     * Serialized bytes of instructions the send layer prepends to execute BEYOND
     * the always-counted `RequestHeapFrame` — the SDK's computeUnitLimit option
     * prepends one ComputeBudget SetComputeUnitLimit instruction: +40 bytes
     * (32-byte program key + 8-byte instruction) minus the 32-byte key and
     * count byte RequestHeapFrame already paid, so ~+8; a microLamportsPerCu
     * price prepend adds 12 more. Default 0.
     */
    prependBytes?: number;
}
export interface PacketBudget {
    /** The transport this estimate models. */
    mode: PacketMode;
    bytecodeBytes: number;
    /** inline: 8 (discriminator) + bytecodeBytes; staged: 8 + 1 (flags) + 32 (pin) + argsBytes. */
    instructionDataBytes: number;
    /** payer + engine program + ComputeBudget program (+ buffer when staged) + non-ALT user metas (a reserved 'payer' meta dedupes into the fee payer). */
    staticAccountKeys: number;
    /** Full serialized v0 transaction estimate (RequestHeapFrame + prependBytes headroom included). */
    messageBytes: number;
    /** 1232 — the wire packet cap. */
    limitBytes: number;
    /** max(0, messageBytes - limitBytes). */
    overflowBytes: number;
    /** Total unique tx accounts, ALT-resolved included. */
    accountLocks: number;
    /** 64 — the runtime account-lock cap. */
    lockLimit: number;
    /**
     * staged only: the payload-args packet budget, 939 − 33·N with N = the
     * plan's non-payer user accounts (measured, engine tests/payload_args.rs).
     */
    argsBudgetBytes?: number;
    /**
     * staged only: end-to-end transactions to stage-and-execute this bytecode at
     * the 1,000-byte write chunk — init tx + ceil(len/1000) write txs + a
     * dedicated finalize tx + the execute tx (8/12/20 for 4/8/16 KB).
     */
    stagingTxs?: number;
    warnings: string[];
}
/**
 * Transactions to stage `bytecodeLength` bytes and execute them: one init tx
 * (1 ix ≤ 10,160 capacity, 2 up to 20,400, … — all fit one tx), the write txs,
 * a dedicated finalize tx (sent only after every write confirmed), the execute.
 */
export declare function stagingTransactionCount(bytecodeLength: number, chunkBytes?: number): number;
export declare function estimatePacket(plan: AccountPlan, bytecodeLength: number, opts?: PacketBudgetOptions): PacketBudget;
//# sourceMappingURL=budget.d.ts.map
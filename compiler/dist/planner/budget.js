import { PAYER_REF } from './registry.js';
const PACKET_LIMIT_BYTES = 1232;
// The runtime lock cap is 64 today — the increase_tx_account_lock_limit
// feature (raising it to 128) is not active.
const LOCK_LIMIT = 64;
/**
 * payer + engine program + the ComputeBudget program — always in the static
 * key section: every execute transaction carries `RequestHeapFrame(262144)`
 * (the 256 KiB interpreter heap frame; a transaction without it aborts
 * deterministically before any opcode).
 */
const FIXED_STATIC_KEYS = 3;
/** The staged buffer rides read-only ahead of the user tail — one more static key. */
const STAGED_EXTRA_STATIC_KEYS = 1;
/**
 * The always-attached `RequestHeapFrame` instruction's wire bytes beyond its
 * (already counted) program key: program-id index 1 + compact account count 1
 * + compact data length 1 + data 5 (u8 discriminant + u32 LE bytes) + its slot
 * in the instruction count = 9 standalone, 8 beside another ComputeBudget
 * instruction (measured, engine tests/cu_budget.rs).
 */
const HEAP_FRAME_IX_BYTES = 8;
/** Mirrors the engine's MAX_BUFFER_CAPACITY (u16::MAX) — the `program ++ args` composite ceiling. */
const MAX_COMPOSITE_BYTES = 65_535;
/** The SDK's staging write chunk (hard packet ceiling ≈ 1,016; 1,000 leaves margin). */
const STAGING_CHUNK_BYTES = 1_000;
/** The measured staged payload-args budget line: 939 − 33·N (engine tests/payload_args.rs). */
const STAGED_ARGS_BUDGET_BASE = 939;
const STAGED_ARGS_BYTES_PER_ACCOUNT = 33;
/** Byte length of a compact-u16 (shortvec) encoding: 1 below 0x80, 2 below 0x4000, else 3. */
function compactU16Len(n) {
    return n < 0x80 ? 1 : n < 0x4000 ? 2 : 3;
}
/**
 * Transactions to stage `bytecodeLength` bytes and execute them: one init tx
 * (1 ix ≤ 10,160 capacity, 2 up to 20,400, … — all fit one tx), the write txs,
 * a dedicated finalize tx (sent only after every write confirmed), the execute.
 */
export function stagingTransactionCount(bytecodeLength, chunkBytes = STAGING_CHUNK_BYTES) {
    return 1 + Math.ceil(bytecodeLength / chunkBytes) + 1 + 1;
}
export function estimatePacket(plan, bytecodeLength, opts = {}) {
    const mode = opts.mode ?? 'inline';
    // Every plan meta flagged signer contributes its own 64-byte signature on
    // top of the fee payer's — the runtime rejects the tx without it. The
    // reserved 'payer' ref IS the fee payer: no extra signature, key, or lock.
    const planSigners = plan.metas.reduce((n, m) => (m.signer && m.ref !== PAYER_REF ? n + 1 : n), 0);
    const signers = opts.signers ?? 1 + planSigners;
    const argsBytes = opts.argsBytes ?? 0;
    const lookupTables = opts.lookupTables ?? 0;
    const lookupAddresses = opts.lookupAddresses ?? 0;
    const prependBytes = opts.prependBytes ?? 0;
    const userMetas = plan.metas.length;
    // Metas whose key occupies a slot outside FIXED_STATIC_KEYS (the fee payer's
    // key is deduplicated at message compile).
    const nonPayerMetas = plan.metas.reduce((n, m) => (m.ref === PAYER_REF ? n : n + 1), 0);
    if (lookupAddresses > nonPayerMetas) {
        throw new Error(`lookupAddresses (${lookupAddresses}) exceeds the plan's account metas (${nonPayerMetas})`);
    }
    if (lookupAddresses > 0 && lookupTables === 0) {
        throw new Error(`lookupAddresses (${lookupAddresses}) requires lookupTables > 0, got 0`);
    }
    const bytecodeBytes = bytecodeLength;
    // staged: discriminator + the required flags byte + the 32-byte content-hash
    // pin the SDK always sends + the payload args.
    const instructionDataBytes = mode === 'staged' ? 8 + 1 + 32 + argsBytes : 8 + bytecodeBytes;
    const fixedStaticKeys = FIXED_STATIC_KEYS + (mode === 'staged' ? STAGED_EXTRA_STATIC_KEYS : 0);
    const staticAccountKeys = fixedStaticKeys + (nonPayerMetas - lookupAddresses);
    // Every account the execute instruction references, ALT-resolved included
    // (ALT moves key BYTES out of the message, not the instruction's index list).
    // Staged prepends the buffer: [buffer, ...user].
    const ixAccounts = (mode === 'staged' ? 1 : 0) + userMetas;
    // v0 wire math, term by term (every count prefix is compact-u16: 1 byte
    // below 128, 2 below 16384, else 3):
    //   signatures   = compact signature count + 64 per signature
    //   message      = version prefix 1 + header 3 + compact key count
    //                  + 32 per static account key + recent blockhash 32
    //   instructions = compact instruction count 1 + RequestHeapFrame (its key
    //                  is in the fixed terms) + the execute instruction:
    //                  program-id index 1 + compact account count + 1 per account index
    //                  + compact data length + instruction data
    //   ALT section  = compact table count + per table: pubkey 32
    //                  + writable/readonly compact index counts + 1 per resolved address index
    // The split of resolved addresses across tables (and each table's writable/
    // readonly lists) is unknown here, so the per-table index-count prefixes
    // assume an even spread, all in one list per table.
    const perTableAddresses = lookupTables > 0 ? Math.ceil(lookupAddresses / lookupTables) : 0;
    const signaturesSection = compactU16Len(signers) + 64 * signers;
    const messageSection = 1 + 3 + compactU16Len(staticAccountKeys) + 32 * staticAccountKeys + 32;
    const instructionsSection = 1 +
        HEAP_FRAME_IX_BYTES +
        (1 + compactU16Len(ixAccounts) + ixAccounts + compactU16Len(instructionDataBytes) + instructionDataBytes);
    const altSection = compactU16Len(lookupTables) + lookupTables * (32 + compactU16Len(perTableAddresses) + 1) + lookupAddresses;
    const messageBytes = signaturesSection + messageSection + instructionsSection + altSection + prependBytes;
    const overflowBytes = Math.max(0, messageBytes - PACKET_LIMIT_BYTES);
    const accountLocks = staticAccountKeys + lookupAddresses;
    const argsBudgetBytes = mode === 'staged' ? STAGED_ARGS_BUDGET_BASE - STAGED_ARGS_BYTES_PER_ACCOUNT * nonPayerMetas : undefined;
    const warnings = [];
    if (overflowBytes > 0) {
        warnings.push(mode === 'staged'
            ? `staged execute transaction exceeds the 1232-byte packet by ${overflowBytes} bytes; use address lookup tables or trim accounts/args`
            : `transaction exceeds the 1232-byte packet by ${overflowBytes} bytes; stage the bytecode (execute_from_account), use address lookup tables, or trim bytecode`);
    }
    if (argsBudgetBytes !== undefined && argsBytes > 0 && argsBytes > argsBudgetBytes) {
        warnings.push(`staged payload args (${argsBytes} bytes) exceed the ${argsBudgetBytes}-byte packet budget ` +
            `(939 − 33·N at N = ${nonPayerMetas} user accounts); move bulk data into a second buffer read via accountData`);
    }
    if (mode === 'staged' && bytecodeBytes + argsBytes > MAX_COMPOSITE_BYTES) {
        warnings.push(`bytecode (${bytecodeBytes} bytes) plus payload args (${argsBytes} bytes) exceeds the ${MAX_COMPOSITE_BYTES}-byte composite ceiling`);
    }
    if (accountLocks > LOCK_LIMIT) {
        warnings.push(`account locks (${accountLocks}) exceed the runtime cap of 64`);
    }
    return {
        mode,
        bytecodeBytes,
        instructionDataBytes,
        staticAccountKeys,
        messageBytes,
        limitBytes: PACKET_LIMIT_BYTES,
        overflowBytes,
        accountLocks,
        lockLimit: LOCK_LIMIT,
        ...(argsBudgetBytes !== undefined ? { argsBudgetBytes } : {}),
        ...(mode === 'staged' ? { stagingTxs: stagingTransactionCount(bytecodeBytes) } : {}),
        warnings,
    };
}

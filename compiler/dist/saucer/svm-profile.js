import { assertCapability, SVM_GATED_HINTS } from '../capabilities.js';
/**
 * SVM target profile — the single reference for how the 'svm' target differs
 * from the EVM v12 dialect. The SVM engine executes the SAME v12 postfix opcode
 * table; only these ops diverge:
 *
 * UNSUPPORTED (engine raises UnsupportedOpcode; the compiler rejects them at
 * emission — see SVM_UNSUPPORTED below): the CREATE family and DELEGATE.
 *
 * DIVERGENT SHAPE (same opcode byte, different operands — lowered differently
 * by V12Saucer when ctx.isSvm):
 *   - CALL (0xA2):   pops [target(top, 32-byte program id), calldata (Bytes
 *     descriptor), accounts (static ARRAY of scalar account indices, element
 *     data inline in bytecode)]. NO value operand. Indices are 0-based into the
 *     execute instruction's USER account slice (after the 3 engine PDAs).
 *     Per-CPI account cap: 64.
 *   - STATIC (0xA3): alias of CALL — identical operands.
 *   - SLOAD (0x81):  pops [account_index(top), offset, len] → pushes a Bytes
 *     descriptor over that slice of the account's data (surface: accountData).
 *   - SSTORE (0xC5): pops [account_index(top), offset, value descriptor] →
 *     writes the bytes into the account's data (surface: writeAccountData).
 *
 * DIVERGENT LOWERING (same SauceScript source, different opcode byte):
 *   - uint(data): lowers to the platform-native cast — CAST_BE (0x54) on 'v12',
 *     CAST_LE (0x55) on 'svm'. The endianness rule lives on the builtin in
 *     globals.ts.
 *
 * Everything else passes through untouched — the engine has fork-parity analogs
 * for all chain ops (MSG_SENDER, TIMESTAMP, BALANCE, CHAIN_ID, LOG, KECCAK,
 * ABI codec, EVAL, CATCH, TLOAD/TSTORE, ...). Note: EVAL runs in static mode
 * (no CPI inside eval'd code), and CATCH intercepts only PRE-FLIGHT CPI
 * failures — once invoke() launches, a failing callee aborts the transaction.
 */
/** Opcodes the SVM engine rejects at runtime (UnsupportedOpcode) — gated at compile time. */
export const SVM_UNSUPPORTED = {
    create: 0x82,
    createAddress: 0x83,
    create2: 0x84,
    create2Address: 0x85,
    create3: 0x86,
    create3Address: 0x87,
    delegatecall: 0xa4,
};
/** Surface names whose emission is rejected under 'svm', → the replacement to suggest (if any).
 *  Re-derived from `capabilities.ts`'s `TARGET_CAPABILITIES` (the single source of truth) —
 *  kept as its own export only so nothing outside this file needs to change shape. */
export const SVM_GATED = SVM_GATED_HINTS;
/** Throw when a gated construct is emitted under target 'svm'; no-op otherwise. A one-line
 *  delegate to the centralized, bidirectional gate (`capabilities.ts`) — kept so the nine
 *  builder call sites below (which have no AST node in scope) don't need to change at all. */
export function assertSvmSupported(ctx, construct) {
    assertCapability(ctx, construct);
}

// @eco-incorp/sauce-sdk/svm/verify — the SVM counterpart of `@eco-incorp/sauce-sdk/verify`, for a
// compiled `settle` program.
//
// VERIFICATION IS BY RECOMPILE, on both VMs. A settle program's per-execution values
// (`minOut`, `splCount`) are compile-time `defines`, constant-folded into the bytecode, and every
// account identity is an attach slot that never appears in it. So there is nothing to decode OUT of
// a program — and nothing that needs to be: a caller checking an execution already knows the values
// it expects. What it needs is proof that the program it was handed IS the one those values produce.
//
// `verifySvmSettleProgram` is that proof: recompile `svmSettleSource(N)` with the expected defines
// and byte-compare. A match establishes THREE things at once — the logic is the genuine settle
// logic, `minOut` is the expected floor, and `splCount` is the expected token-program split —
// because all three are folded into the same bytes. Under the older staged form the blob was a pure
// function of N and the scalars rode the instruction payload, so they had to be decoded and checked
// separately; binding them into the program is strictly stronger.
//
// The account identities are never in the bytecode on SVM in either form — Solana requires them
// attached — so they come from the executed instruction's account list, matched positionally against
// `svmSettleRefs(N)`. `decodeSvmSettleExecution` does that half; `verifySvmSettleExecution` adds the
// recompile check and the pin↔bytecode tie.
//
// Unlike `@eco-incorp/sauce-sdk/verify`, this pulls the compiler in to recompile — a node-side check.
import { createHash } from 'node:crypto';
import { compileWithRs } from '../routes/rs-compile.js';
import { EXECUTE_AND_CLOSE_DISCRIMINATOR, EXECUTE_DISCRIMINATOR, EXECUTE_FLAG_HAS_PIN, EXECUTE_FLAG_HAS_SLICE, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, } from './engine.js';
import { SVM_MAX_ESCROWS, svmSettleRefs, svmSettleSource } from './recipes/index.js';
// The intent-level surface (unwrap the Portal envelope + extract from an intent) is re-exported here so
// the whole partner-facing decode/verify story lives under `@eco-incorp/sauce-sdk/svm/verify`, symmetric
// with the EVM `/verify` barrel re-exporting its own `intent.ts`.
export { decodePortalCalldataWithAccounts, encodePortalCalldataWithAccounts, extractSvmSettleFromCalls, extractSvmSettleFromIntent, } from './intent.js';
/** N escrows declare `3N + 3` accounts (2 token programs + 3 per escrow + the shared owner). */
function escrowCountFromPlan(metaCount) {
    if ((metaCount - 3) % 3 !== 0)
        return null;
    const n = (metaCount - 3) / 3;
    return Number.isInteger(n) && n >= 1 && n <= SVM_MAX_ESCROWS ? n : null;
}
function bytesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}
function sha256(bytes) {
    return new Uint8Array(createHash('sha256').update(bytes).digest());
}
/** The canonical settle bytecode for `escrowCount` under `expected`, recompiled from the shipped
 *  source with the shipped defines — a deterministic function of exactly those three values, and the
 *  SDK's own ground truth for "what the genuine settle program's bytes are", derivable WITHOUT any
 *  partner-supplied bytecode. */
function compileCanonicalSettle(escrowCount, expected) {
    return compileWithRs({
        source: svmSettleSource(escrowCount),
        target: 'svm',
        defines: { SETTLE_MIN_OUT: expected.minOut, SETTLE_SPL_COUNT: expected.splCount },
    }).bytecode[0];
}
/**
 * Verifies a compiled SVM settle program is genuine AND enforces `expected` — the SVM analogue of the
 * EVM check, done by recompile. It:
 *   1. takes the escrow count N (or infers it from the manifest's `3N + 3` slots),
 *   2. recompiles `svmSettleSource(N)` with `expected` as defines, and
 *   3. byte-compares the result, and asserts the manifest's slot names equal `svmSettleRefs(N)`.
 *
 * A genuine result means the bytecode IS the reusable settle logic for N escrows, compiled for
 * exactly this floor and this split — all three are the same bytes, so one comparison pins them all.
 * The resolved account identities (from the executed instruction) remain the caller's own check.
 * Never throws for a non-genuine program; returns `{ genuine: false, mismatch }`.
 */
export function verifySvmSettleProgram(bytecode, manifest, expected) {
    const slots = manifest.accounts.filter((entry) => entry.kind === 'slot');
    const escrowCount = escrowCountFromPlan(slots.length);
    if (escrowCount === null) {
        return {
            genuine: false,
            escrowCount: null,
            refs: [],
            mismatch: `account manifest has ${slots.length} slots, which is not 3N + 3 for any settle escrow count 1..${SVM_MAX_ESCROWS}`,
        };
    }
    const refs = svmSettleRefs(escrowCount);
    const slotNames = slots.map((slot) => slot.name);
    if (slotNames.length !== refs.length || slotNames.some((name, i) => name !== refs[i])) {
        return { genuine: false, escrowCount, refs, mismatch: `account manifest slots do not match svmSettleRefs(${escrowCount})` };
    }
    if (!bytesEqual(bytecode, compileCanonicalSettle(escrowCount, expected))) {
        return {
            genuine: false,
            escrowCount,
            refs,
            mismatch: `bytecode does not byte-match svmSettleSource(${escrowCount}) at minOut=${expected.minOut}, splCount=${expected.splCount}`,
        };
    }
    return { genuine: true, escrowCount, refs };
}
/**
 * Parses the shared `execute_from_account` / `execute_and_close` instruction data into its
 * `[disc][flags][pin?][slice?][args]` parts. Throws on a non-staged-execute discriminator (an inline
 * `execute` payload carries BYTECODE, not an args tail — a different grammar), a missing flags byte, or
 * a header that runs past the end of the buffer. The exact inverse of `encodeExecutePayload`
 * (instructions.ts).
 */
export function parseExecutePayload(instructionData) {
    if (!(instructionData instanceof Uint8Array))
        throw new Error('instructionData must be a Uint8Array');
    if (instructionData.length < 8)
        throw new Error(`instructionData is ${instructionData.length} bytes — too short for an 8-byte discriminator`);
    const disc = instructionData.subarray(0, 8);
    let instruction;
    if (bytesEqual(disc, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR))
        instruction = 'execute_from_account';
    else if (bytesEqual(disc, EXECUTE_AND_CLOSE_DISCRIMINATOR))
        instruction = 'execute_and_close';
    else if (bytesEqual(disc, EXECUTE_DISCRIMINATOR)) {
        throw new Error('this is an inline `execute` instruction — its payload is bytecode, not a staged args tail; pass the execute_from_account / execute_and_close data');
    }
    else {
        throw new Error('instructionData does not begin with a Sauce staged-execute discriminator');
    }
    if (instructionData.length < 9)
        throw new Error('instructionData is missing the required flags byte');
    const flags = instructionData[8];
    let offset = 9;
    let pin;
    if (flags & EXECUTE_FLAG_HAS_PIN) {
        if (instructionData.length < offset + 32)
            throw new Error('HAS_PIN flag set but the 32-byte pin runs past the end of instructionData');
        pin = instructionData.subarray(offset, offset + 32);
        offset += 32;
    }
    let slice;
    if (flags & EXECUTE_FLAG_HAS_SLICE) {
        if (instructionData.length < offset + 8)
            throw new Error('HAS_SLICE flag set but the 8-byte slice runs past the end of instructionData');
        const view = new DataView(instructionData.buffer, instructionData.byteOffset + offset, 8);
        slice = { offset: view.getUint32(0, true), len: view.getUint32(4, true) };
        offset += 8;
    }
    return { instruction, pin, slice, args: instructionData.subarray(offset) };
}
function accountAddress(a, i) {
    const raw = typeof a === 'string' ? a : (a.address ?? a.pubkey);
    if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error(`account ${i} is not an address (expected a base58 string, or an object with .address/.pubkey)`);
    }
    return raw;
}
/** Classifies an account-list length as a settle shape: `3N+3` is the user tail alone, `3N+4` is that
 *  tail with the leading bytecode-buffer account. Returns null for any other length (the two never
 *  collide — `3N+3 = 3M+4` has no integer solution). */
function classifyAccountList(length) {
    for (const hasBuffer of [false, true]) {
        const userCount = hasBuffer ? length - 1 : length;
        if ((userCount - 3) % 3 !== 0)
            continue;
        const escrowCount = (userCount - 3) / 3;
        if (Number.isInteger(escrowCount) && escrowCount >= 1 && escrowCount <= SVM_MAX_ESCROWS) {
            return { escrowCount, hasBuffer };
        }
    }
    return null;
}
/**
 * Decodes a full settle execution — the calldata AND the account list — into its staged-execute header
 * and resolved account identities in one call. It parses the execute payload grammar off
 * `instructionData`, infers the escrow count from the account-list length, and resolves each
 * `svmSettleRefs(N)` slot to the attached pubkey. Consumes the sauce-recipes `split=1` settle sauce
 * (`execution.instructionData` + `execution.accounts[]`) directly, and equally an executed engine
 * instruction (full data + `[buffer, …user]` account list).
 *
 * `minOut`/`splCount` are NOT among the results, and cannot be: they are defines folded into the
 * bytecode, so no amount of reading the calldata recovers them. `verifySvmSettleExecution` establishes
 * them the only way available — by recompiling with the values a caller expects and byte-comparing.
 *
 * What IS here is not trusted either: the header comes from the raw calldata (not from a receipt), and
 * the account identities are resolved positionally against the canonical refs, never from
 * caller-supplied labels — `labeledRefsConsistent` only reports whether a label the caller happened to
 * attach agreed with the slot it landed in.
 *
 * IMPORTANT — this is a STRUCTURAL decode, NOT a genuineness proof. Unlike the EVM `decodeSettleProgram`
 * (whose prologue grammar is a settle-specific signature), a staged settle's calldata carries no
 * structural signature at all: any staged Sauce execute with a `3N+3`/`3N+4` account count has this
 * exact shape. So a non-settle execution (or an adversarial decoy) decodes here without error into any
 * staged program at all. To prove the execution actually runs the genuine settle program, use
 * `verifySvmSettleExecution` (or `extractSvmSettleFromIntent`), which ties the calldata to the SDK's
 * own recompiled canonical settle bytecode.
 */
export function decodeSvmSettleExecution(input) {
    const { instruction, pin, slice } = parseExecutePayload(input.instructionData);
    const shape = classifyAccountList(input.accounts.length);
    if (shape === null) {
        throw new Error(`account list has ${input.accounts.length} accounts, which is neither 3N+3 (user tail) nor 3N+4 (with buffer) for any settle escrow count 1..${SVM_MAX_ESCROWS}`);
    }
    const { escrowCount, hasBuffer } = shape;
    const refs = svmSettleRefs(escrowCount);
    const userAccounts = hasBuffer ? input.accounts.slice(1) : input.accounts;
    const accounts = {};
    let labeledRefsConsistent = true;
    refs.forEach((ref, i) => {
        accounts[ref] = accountAddress(userAccounts[i], i);
        const entry = userAccounts[i];
        if (typeof entry === 'object' && entry !== null && typeof entry.ref === 'string') {
            if (entry.ref !== ref)
                labeledRefsConsistent = false;
        }
        else if (labeledRefsConsistent !== false) {
            labeledRefsConsistent = null; // at least one entry carried no label → can't confirm
        }
    });
    return {
        instruction,
        pin,
        slice,
        escrowCount,
        refs,
        accounts,
        hadBufferAccount: hasBuffer,
        labeledRefsConsistent,
    };
}
/**
 * The genuineness check for a settle execution — the crucial companion to `decodeSvmSettleExecution`,
 * whose structural decode alone CANNOT tell a settle from any other staged Sauce execute (an account
 * count is not a signature). This ties the calldata to the SDK's own recompiled canonical settle
 * bytecode, in one of two ways, no partner bytecode required for either verdict:
 *
 *   - `bytecode` supplied → byte-compare it to `compileCanonicalSettle(escrowCount)` AND check the pin
 *     ties to it (`sha256(bytecode) === pin`). Proves the exact staged bytes ARE the settle and WILL run.
 *   - no bytecode, but the calldata carries a pin → check `pin === sha256(canonical settle)`. The pin is
 *     the buffer's content hash the engine enforces on-chain, so a match proves the committed program is
 *     the genuine settle (or the execution reverts on the pin gate) — a decoy's pin cannot match.
 *   - neither → `genuine: false`, `verifiedBy: 'none'` (structure alone is not proof).
 *
 * Because `minOut`/`splCount` are folded into the bytecode, a `genuine` result also proves the program
 * enforces the `minOut`/`splCount` passed in — leaving only the resolved account identities for the
 * caller to check. Never throws beyond the shared structural decode; reports failures in `mismatch`.
 */
export function verifySvmSettleExecution(input) {
    const decoded = decodeSvmSettleExecution(input);
    const canonical = compileCanonicalSettle(decoded.escrowCount, input);
    const pin = decoded.pin;
    const pinMatchesCanonical = pin === undefined ? null : bytesEqual(sha256(canonical), pin);
    const bytecodeMatchesCanonical = input.bytecode === undefined ? null : bytesEqual(input.bytecode, canonical);
    const pinMatchesBytecode = input.bytecode === undefined || pin === undefined ? null : bytesEqual(sha256(input.bytecode), pin);
    let genuine;
    let verifiedBy;
    let mismatch;
    if (input.bytecode !== undefined) {
        verifiedBy = 'bytecode';
        genuine = bytecodeMatchesCanonical === true && pinMatchesBytecode !== false;
        mismatch =
            bytecodeMatchesCanonical !== true
                ? `bytecode does not byte-match svmSettleSource(${decoded.escrowCount})`
                : pinMatchesBytecode === false
                    ? 'calldata pin does not equal sha256(bytecode) — the calldata targets different bytecode'
                    : undefined;
    }
    else if (pin !== undefined) {
        verifiedBy = 'pin';
        genuine = pinMatchesCanonical === true;
        mismatch = genuine
            ? undefined
            : `calldata pin does not match sha256(svmSettleSource(${decoded.escrowCount})) — not a genuine settle execution`;
    }
    else {
        verifiedBy = 'none';
        genuine = false;
        mismatch = 'no calldata pin and no bytecode supplied — a staged settle has no structural signature, so genuineness cannot be proven';
    }
    return { ...decoded, genuine, verifiedBy, pinMatchesCanonical, pinMatchesBytecode, bytecodeMatchesCanonical, mismatch };
}
//# sourceMappingURL=verify.js.map
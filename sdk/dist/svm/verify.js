// @eco-incorp/sauce-sdk/svm/verify — the SVM counterpart of `@eco-incorp/sauce-sdk/verify`, for a
// compiled `settle` program.
//
// WHY IT LOOKS DIFFERENT FROM THE EVM ONE. The EVM settle program bakes its params
// (tokens, minOut, recipient) into a PROLOGUE, so `decodeSettleProgram` reads them straight out of
// the bytecode. The SVM settle program is compiled STAGED (`staged: true`): the compiler puts args in
// the per-execution CALLDATA, not the blob — the buffer bytecode is byte-identical for ANY arg values
// at a given escrow count (verified: `svmSettleSource(1)` compiles to the same 293 bytes for
// minOut=1 and minOut=999). So there is nothing to decode OUT of the program itself. Two facts split
// the EVM decoder's single job into two halves here:
//
//   1. THE PROGRAM is a pure function of the escrow count. You verify it the way the recipe's own
//      "PARTNER VERIFY" note says — recompile `svmSettleSource(N)` and byte-compare — not by parsing a
//      prologue. `verifySvmSettleProgram` packages that: it infers N from the account plan, recompiles,
//      and byte-compares the blob + the ref order. That is the SVM analogue of the EVM `bodyHash`
//      check (prove the logic is the genuine settle logic, not a lookalike).
//
//   2. THE ARGS (minOut, splCount, tokenProgram0/1) ride the CALLDATA, so they ARE recoverable — from
//      the execute payload's args tail, not the blob. `decodeSvmSettleArgs` is the exact inverse of the
//      SDK's `encodePayloadArgs` for the settle layout (four 32-byte big-endian scalar slots).
//
// The account identities (escrows, mints, dests, owner, token programs) are never in the bytecode on
// SVM in either mode — Solana requires them attached — so they come from the executed instruction's
// account list, matched against the plan's refs (`svmSettleRefs(N)`). This module does not read them;
// a caller pairs the verified plan with the on-chain instruction to resolve them.
//
// Unlike `@eco-incorp/sauce-sdk/verify` (viem-only, browser-safe), `verifySvmSettleProgram` pulls the
// compiler in to recompile — a node-side check. `decodeSvmSettleArgs` is light (only @solana/kit).
import { createHash } from 'node:crypto';
import { getAddressDecoder } from '@solana/kit';
import { compile } from '@eco-incorp/sauce-compiler';
import { EXECUTE_AND_CLOSE_DISCRIMINATOR, EXECUTE_DISCRIMINATOR, EXECUTE_FLAG_HAS_PIN, EXECUTE_FLAG_HAS_SLICE, EXECUTE_FROM_ACCOUNT_DISCRIMINATOR, } from './engine.js';
import { SVM_MAX_ESCROWS, svmSettleRefs, svmSettleSource } from './recipes/index.js';
// The intent-level surface (unwrap the Portal envelope + extract from an intent) is re-exported here so
// the whole partner-facing decode/verify story lives under `@eco-incorp/sauce-sdk/svm/verify`, symmetric
// with the EVM `/verify` barrel re-exporting its own `intent.ts`.
export { decodePortalCalldataWithAccounts, encodePortalCalldataWithAccounts, extractSvmSettleFromCalls, extractSvmSettleFromIntent, } from './intent.js';
/** Byte length of the settle args tail: 4 scalar slots × 32 bytes. */
export const SVM_SETTLE_ARGS_BYTES = 4 * 32;
const addressDecoder = getAddressDecoder();
/** Big-endian u256 -> bigint, for a 32-byte scalar slot. */
function beScalar(bytes, offset) {
    let v = 0n;
    for (let i = 0; i < 32; i++)
        v = (v << 8n) | BigInt(bytes[offset + i]);
    return v;
}
/**
 * Decodes the settle program's per-execution args from the CALLDATA tail — the exact inverse of the
 * SDK's `encodePayloadArgs` for `main(minOut, splCount, tokenProgram0, tokenProgram1)` (four 32-byte
 * big-endian scalar slots). Pass the ARGS bytes only (strip the execute payload's flags byte + any
 * hash pin / slice first). `argsLayout` is optional: when supplied it is checked to be the settle
 * shape; the decode itself uses the fixed 0/32/64/96 offsets either way.
 *
 * A token-program slot is a 32-byte pubkey; minOut/splCount are big-endian scalars. Nothing about
 * these values is trusted — a caller compares them against what it expects, exactly as with the EVM
 * decoder.
 */
export function decodeSvmSettleArgs(payloadArgs, argsLayout) {
    if (!(payloadArgs instanceof Uint8Array) || payloadArgs.length !== SVM_SETTLE_ARGS_BYTES) {
        const got = payloadArgs instanceof Uint8Array ? `${payloadArgs.length} bytes` : 'a non-Uint8Array';
        throw new Error(`svm settle args must be exactly ${SVM_SETTLE_ARGS_BYTES} bytes (4 × 32), got ${got}`);
    }
    if (argsLayout !== undefined) {
        const shapeOk = argsLayout.mode === 'calldata' &&
            argsLayout.slots.length === 4 &&
            argsLayout.slots.every((s, i) => s.kind === 'scalar' && s.length === 32 && s.offset === i * 32);
        if (!shapeOk) {
            throw new Error('argsLayout is not the settle shape (4 scalar 32-byte slots at 0/32/64/96)');
        }
    }
    return {
        minOut: beScalar(payloadArgs, 0),
        splCount: beScalar(payloadArgs, 32),
        tokenProgram0: addressDecoder.decode(payloadArgs.subarray(64, 96)),
        tokenProgram1: addressDecoder.decode(payloadArgs.subarray(96, 128)),
    };
}
/** N escrows intern `3N + 3` accounts (2 token programs + 3 per escrow + the shared owner). */
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
/** The canonical settle bytecode for `escrowCount`, recompiled from the shipped source with the shipped
 *  options. A pure function of the escrow count (staged args never affect the blob), and cached by the
 *  compiler — so it is the SDK's own ground truth for "what the genuine settle program's bytes are",
 *  derivable WITHOUT any partner-supplied bytecode. */
function compileCanonicalSettle(escrowCount) {
    return compile(svmSettleSource(escrowCount), { target: 'svm', staged: true, treeshake: true, args: [0n, 0n, 0n, 0n] }).bytecode[0];
}
/**
 * Verifies a compiled SVM settle program is genuine — the SVM analogue of the EVM decoder's body-hash
 * check, done by recompile rather than prologue-decode (the staged blob has no prologue). It:
 *   1. infers the escrow count N from the account plan's ref count (3N + 3),
 *   2. recompiles `svmSettleSource(N)` with the exact shipped options (`target: svm, staged, treeshake`;
 *      placeholder args, whose VALUES cannot affect a staged blob), and
 *   3. byte-compares the blob AND asserts the plan's refs equal `svmSettleRefs(N)`.
 *
 * A genuine result means the bytecode IS the reusable settle logic for N escrows and the account slots
 * are the ones that logic addresses — the params (from `decodeSvmSettleArgs`) and the resolved account
 * identities (from the executed instruction) are then checkable against expectation. Never throws for a
 * non-genuine program; returns `{ genuine: false, mismatch }`.
 */
export function verifySvmSettleProgram(bytecode, accountPlan) {
    const escrowCount = escrowCountFromPlan(accountPlan.metas.length);
    if (escrowCount === null) {
        return {
            genuine: false,
            escrowCount: null,
            refs: [],
            mismatch: `account plan has ${accountPlan.metas.length} accounts, which is not 3N + 3 for any settle escrow count 1..${SVM_MAX_ESCROWS}`,
        };
    }
    const refs = svmSettleRefs(escrowCount);
    const planRefs = accountPlan.metas.map((m) => m.ref);
    if (planRefs.length !== refs.length || planRefs.some((r, i) => r !== refs[i])) {
        return { genuine: false, escrowCount, refs, mismatch: `account plan refs do not match svmSettleRefs(${escrowCount})` };
    }
    // Placeholder args: 4 scalars. Values are irrelevant to a staged blob (verified) — only the shape
    // (four scalar slots) must match what the source declares.
    const expected = compile(svmSettleSource(escrowCount), {
        target: 'svm',
        staged: true,
        treeshake: true,
        args: [0n, 0n, 0n, 0n],
    });
    if (!bytesEqual(bytecode, expected.bytecode[0])) {
        return { genuine: false, escrowCount, refs, mismatch: `bytecode does not byte-match svmSettleSource(${escrowCount})` };
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
 * Decodes a full settle execution — the calldata AND the account list — into its params and resolved
 * account identities in one call. It parses the execute payload grammar off `instructionData`, decodes
 * the four settle args from the tail, infers the escrow count from the account-list length, and resolves
 * each `svmSettleRefs(N)` slot to the attached pubkey. Consumes the sauce-recipes `split=1` settle sauce
 * (`execution.instructionData` + `execution.accounts[]`) directly, and equally an executed engine
 * instruction (full data + `[buffer, …user]` account list).
 *
 * Nothing is trusted: the args are re-derived from the raw calldata (not read from a receipt), the
 * account identities are resolved positionally against the canonical refs (not from caller-supplied
 * labels), and `tokenProgramsConsistent` cross-checks the two independent bindings of each token program
 * — exactly the "decode from the bytes, then compare against expectation" contract of the EVM decoder.
 *
 * IMPORTANT — this is a STRUCTURAL decode, NOT a genuineness proof. Unlike the EVM `decodeSettleProgram`
 * (whose prologue grammar is a settle-specific signature), a STAGED settle's args carry no structural
 * signature: any staged Sauce execute with a 128-byte args tail and a `3N+3`/`3N+4` account count has
 * this exact shape. So a non-settle execution (or an adversarial decoy) decodes here without error into
 * arbitrary `(minOut, splCount, …)`. To prove the execution actually runs the genuine settle program,
 * use `verifySvmSettleExecution` (or `extractSvmSettleFromIntent`), which ties the calldata to the SDK's
 * own recompiled canonical settle bytecode.
 */
export function decodeSvmSettleExecution(input) {
    const { instruction, pin, slice, args } = parseExecutePayload(input.instructionData);
    const shape = classifyAccountList(input.accounts.length);
    if (shape === null) {
        throw new Error(`account list has ${input.accounts.length} accounts, which is neither 3N+3 (user tail) nor 3N+4 (with buffer) for any settle escrow count 1..${SVM_MAX_ESCROWS}`);
    }
    const { escrowCount, hasBuffer } = shape;
    const decodedArgs = decodeSvmSettleArgs(args);
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
    const tokenProgramsConsistent = decodedArgs.tokenProgram0 === accounts.tokenProgram0 && decodedArgs.tokenProgram1 === accounts.tokenProgram1;
    return {
        instruction,
        pin,
        slice,
        args: decodedArgs,
        escrowCount,
        refs,
        accounts,
        hadBufferAccount: hasBuffer,
        tokenProgramsConsistent,
        labeledRefsConsistent,
    };
}
/**
 * The genuineness check for a settle execution — the crucial companion to `decodeSvmSettleExecution`,
 * whose structural decode alone CANNOT tell a settle from any other staged Sauce execute (staged args
 * carry no signature). This ties the calldata to the SDK's own recompiled canonical settle bytecode, in
 * one of two ways, no partner bytecode required for either verdict:
 *
 *   - `bytecode` supplied → byte-compare it to `compileCanonicalSettle(escrowCount)` AND check the pin
 *     ties to it (`sha256(bytecode) === pin`). Proves the exact staged bytes ARE the settle and WILL run.
 *   - no bytecode, but the calldata carries a pin → check `pin === sha256(canonical settle)`. The pin is
 *     the buffer's content hash the engine enforces on-chain, so a match proves the committed program is
 *     the genuine settle (or the execution reverts on the pin gate) — a decoy's pin cannot match.
 *   - neither → `genuine: false`, `verifiedBy: 'none'` (structure alone is not proof).
 *
 * A `genuine` result leaves only `(minOut, splCount, tokenPrograms)` + the resolved account identities to
 * check against expectation. Never throws beyond the shared structural decode; reports failures in
 * `mismatch`.
 */
export function verifySvmSettleExecution(input) {
    const decoded = decodeSvmSettleExecution(input);
    const canonical = compileCanonicalSettle(decoded.escrowCount);
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
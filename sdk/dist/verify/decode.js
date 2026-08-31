/**
 * SAUCE SWEEP PROGRAM WIRE FORMAT v1 — `recipes/settle.sauce.ts` on engine target v12.
 *
 * `program := PROLOGUE || BODY`. Byte 0 is the first prologue byte — there is NO header, magic,
 * version byte, or length prefix.
 *
 * ```
 * program        := token_push{N} , TUPLE , arity , minout_push , recipient_push , body
 * token_push{N}  := N PUSHes (see wire.ts) carrying tokens REVERSED: tokens[N-1], …, tokens[0]
 * TUPLE          := 0x94              ; not a legal PUSH length (0x94 > 0x20) — the array terminator
 * arity          := one RAW byte, unsigned, MUST equal N
 * minout_push    := PUSH, uint256, value = minOut          (0 = floor disabled)
 * recipient_push := PUSH, uint160,  value = recipient      (MUST be nonzero)
 * body           := remaining bytes (must be non-empty); `keccak256(body)` is reported as
 *                    `bodyHash` for the caller to compare against, but this file pins no value
 * ```
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. The prologue grammar is independent of the body, so
 * decoding tells you which `(tokens, minOut, recipient)` a program carries and nothing more. It
 * cannot exclude an appended transfer, branch, or unbounded call after the prologue — a
 * prologue-shaped program may do anything in its body.
 *
 * "This is the program I audited" USED to be answerable by recompiling the shipped source and
 * byte-comparing, because the retired compiler baked the params into this prologue and left a body
 * that was byte-identical for every token count, minOut and recipient — so one body hash covered
 * every argument set. Neither half survives the current compiler: it folds each value at its use
 * site, which puts the arguments INSIDE the body (measured: `minOut` at byte 48, `recipient` at 104)
 * and leaves no prologue at all. So `bodyHash` is still reported, but there is no longer a single
 * argument-independent value to compare it against, and a recompile is not an equality check.
 *
 * This decoder therefore describes a LEGACY wire format — the programs the retired compiler emitted.
 * `SETTLE_VECTORS` are its committed golden bytes and remain the conformance corpus.
 *
 * THIS decoder is CANONICAL/STRICT: unlike the recipes package's original in-repo decoder (which
 * predates this package and accepted three malformed shapes — see the `SettleFailureCode` docs
 * below), every PUSH is required to be minimal-length, token/recipient pushes are capped at 20
 * bytes, and a zero recipient is rejected. A program this decoder accepts is the UNIQUE byte
 * encoding of its `(tokens, minOut, recipient)` — which is exactly what makes §5 (re-encode and
 * compare, `encodeSettleProgram`) an equivalent, cheaper alternative to this scan.
 */
import { keccak256 } from "viem";
import { SETTLE_WIRE, scanMinimalPush, encodeMinimalPush } from "./wire.js";
/* NOTE: this union used to also carry BODY_HASH, TEMPLATE_REVOKED, INTERNAL_INCONSISTENT,
 *  PRODUCER_HASH_DIVERGED, EXPECT_* and INTENT_UNCHECKED. Every one of those was produced by the
 *  template/report layer that used to sit beside this file, never by the decoder — so with that
 *  layer gone they would advertise rejections nothing here can make. Removed rather than kept as
 *  dead vocabulary; the doc above ("every one of these is a REAL rejection this decoder makes") is
 *  true again. */
export class SettleDecodeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "SettleDecodeError";
        this.code = code;
    }
}
function toAddress(value) {
    return ("0x" + value.toString(16).padStart(40, "0"));
}
function bytesToHexLocal(bytes) {
    let hex = "0x";
    for (const b of bytes)
        hex += b.toString(16).padStart(2, "0");
    return hex;
}
/** Returns `null` (never throws) on malformed hex — odd length, a non-hex character, or a
 *  non-string `hex` argument entirely (a runtime caller bypassing the type system) — so
 *  `parseSettleProgram` can report it as an `EMPTY`-coded fatal rather than throwing out of a
 *  function documented to never throw. */
function hexToBytesLocal(hex) {
    if (typeof hex !== "string")
        return null;
    const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean))
        return null;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}
/** Best-effort single left-to-right pass — never throws. This is the shared engine both
 *  `decodeSettleProgram` (throws on `parse.fatal`) and `bestEffortDecode` (keeps
 *  whatever DID parse even when a later stage failed) run on top of. */
export function parseSettleProgram(program) {
    const decodedHex = hexToBytesLocal(program);
    const bytes = decodedHex ?? new Uint8Array(0);
    const result = {
        bytes,
        tokenPushes: [],
        tokenScanError: null,
        tupleOffset: null,
        tupleOk: false,
        arityOffset: null,
        arityByte: null,
        arityOk: false,
        minOutPush: null,
        minOutError: null,
        recipientPush: null,
        recipientError: null,
        recipientNonZero: false,
        bodyOffset: null,
        body: null,
        bodyHash: null,
        fatal: null,
    };
    if (decodedHex === null) {
        let rendered;
        try {
            rendered = JSON.stringify(program).slice(0, 80);
        }
        catch {
            // `program` was a type JSON.stringify itself rejects (e.g. a bigint) — never throw out of a
            // function documented to always return a report.
            rendered = String(program).slice(0, 80);
        }
        result.fatal = { code: "EMPTY", message: `not a valid hex string: ${rendered}` };
        return result;
    }
    if (bytes.length === 0) {
        result.fatal = { code: "EMPTY", message: "empty program" };
        return result;
    }
    let pos = 0;
    // Leading token-push run: scan while the byte at `pos` is a legal PUSH opcode (0x01..0x20).
    // 0x94 (TUPLE_OP) is > 0x20 so the loop terminates there naturally; that termination condition
    // is what lets this be a greedy, lookahead-free scan.
    for (;;) {
        const op = bytes[pos];
        if (op === undefined || op < SETTLE_WIRE.PUSH_MIN || op > SETTLE_WIRE.PUSH_MAX)
            break;
        const scan = scanMinimalPush(bytes, pos, SETTLE_WIRE.ADDRESS_BYTES);
        if (!scan.ok) {
            result.tokenScanError = { code: scan.code, offset: scan.offset, message: scan.message };
            result.fatal = result.fatal ?? { code: scan.code, message: scan.message };
            return result; // cannot safely continue scanning past a malformed push
        }
        result.tokenPushes.push({ value: scan.value, offset: scan.offset, width: scan.width });
        pos = scan.next;
    }
    if (result.tokenPushes.length === 0) {
        result.fatal = { code: "NOT_SETTLE_SHAPED", message: `no leading token push found at byte 0 (got 0x${bytes[0].toString(16)})` };
        return result;
    }
    result.tupleOffset = pos;
    if (bytes[pos] !== SETTLE_WIRE.TUPLE_OP) {
        const got = bytes[pos];
        result.fatal = {
            code: "NOT_SETTLE_SHAPED",
            message: `expected the TUPLE opcode (0x${SETTLE_WIRE.TUPLE_OP.toString(16)}) at byte ${pos} after ${result.tokenPushes.length} token push(es), got ${got === undefined ? "end of buffer" : "0x" + got.toString(16)}`,
        };
        return result;
    }
    result.tupleOk = true;
    pos += 1;
    result.arityOffset = pos;
    const arity = bytes[pos];
    if (arity === undefined) {
        result.fatal = { code: "ARITY_MISMATCH", message: "truncated after the TUPLE opcode — no arity byte" };
        return result;
    }
    result.arityByte = arity;
    if (arity !== result.tokenPushes.length) {
        result.fatal = {
            code: "ARITY_MISMATCH",
            message: `TUPLE arity byte ${arity} does not match ${result.tokenPushes.length} leading token push(es)`,
        };
        return result;
    }
    result.arityOk = true;
    pos += 1;
    const minOutScan = scanMinimalPush(bytes, pos, SETTLE_WIRE.PUSH_MAX);
    if (!minOutScan.ok) {
        const code = minOutScan.code === "TRUNCATED_PUSH" ? "TRUNCATED_MINOUT" : minOutScan.code;
        result.minOutError = { code, offset: minOutScan.offset, message: minOutScan.message };
        result.fatal = { code, message: `minOut: ${minOutScan.message}` };
        return result;
    }
    result.minOutPush = { value: minOutScan.value, offset: minOutScan.offset, width: minOutScan.width };
    pos = minOutScan.next;
    const recipientScan = scanMinimalPush(bytes, pos, SETTLE_WIRE.ADDRESS_BYTES);
    if (!recipientScan.ok) {
        const code = recipientScan.code === "TRUNCATED_PUSH" ? "TRUNCATED_RECIPIENT" : recipientScan.code;
        result.recipientError = { code, offset: recipientScan.offset, message: recipientScan.message };
        result.fatal = { code, message: `recipient: ${recipientScan.message}` };
        return result;
    }
    result.recipientPush = { value: recipientScan.value, offset: recipientScan.offset, width: recipientScan.width };
    result.recipientNonZero = recipientScan.value !== 0n;
    pos = recipientScan.next;
    if (!result.recipientNonZero) {
        result.fatal = result.fatal ?? { code: "ZERO_RECIPIENT", message: "recipient push decodes to the zero address" };
        // Do NOT return — body still parses so a report can show what would-be-decoded state looked like.
    }
    result.bodyOffset = pos;
    result.body = bytes.subarray(pos);
    result.bodyHash = keccak256(bytesToHexLocal(result.body));
    // A program must HAVE a body — a bare prologue with nothing after it is not a runnable program,
    // and decoding params out of one would report intent for something that does nothing.
    //
    // The exact length is deliberately NOT pinned here. It used to be (a bare `165`), which coupled
    // this decoder to one specific compiled body: the same params compiled from a program whose body
    // legitimately differs in length — a different program, or the same one after an edit — was
    // rejected on its length before its params were ever read, even though the prologue grammar this
    // file implements is entirely independent of what follows it. Deciding WHOSE body it is belongs to
    // whoever compiles the source and byte-compares (see `@eco-incorp/sauce-sdk/recipes`), not here.
    if (result.fatal === null && result.body.length === 0) {
        result.fatal = { code: "BODY_LENGTH", message: "program has no body after the prologue" };
    }
    return result;
}
function parseToDecoded(parse) {
    if (parse.tokenPushes.length === 0 || !parse.tupleOk || !parse.arityOk || parse.minOutPush === null || parse.recipientPush === null || parse.body === null) {
        return null;
    }
    const tokens = parse.tokenPushes
        .slice()
        .reverse()
        .map((p) => toAddress(p.value));
    return {
        tokens,
        minOut: parse.minOutPush.value,
        recipient: toAddress(parse.recipientPush.value),
        floorToken: tokens[0],
        body: bytesToHexLocal(parse.body),
        bodyHash: parse.bodyHash,
        prologueSize: parse.bodyOffset ?? 0,
        bodySize: parse.body.length,
        programSize: parse.bytes.length,
    };
}
/** Decode whenever the shape is well-formed enough to name a full `(tokens, minOut, recipient)`
 *  — even when a later, non-structural check (a nonzero-but-wrong-length body, a zero recipient)
 *  would make `decodeSettleProgram` throw — so a rejected program's decoded intent is still
 *  visible to a caller debugging the rejection. */
export function bestEffortDecode(parse) {
    return parseToDecoded(parse);
}
/**
 * Decode a settle-shaped program back into `(tokens, minOut, recipient)`. STRICT: rejects a
 * non-minimal-length push, an oversize (>20 byte) token/recipient word, and a zero recipient —
 * see this module's docstring for why. Throws `SettleDecodeError` (carrying a stable `.code`) on
 * any of the failures in `SettleFailureCode`.
 *
 * This is a STRUCTURAL decode only — it proves the program STARTS with the sweep shape and has a
 * non-empty suffix. It does NOT prove that suffix is a program you audited: compile the source and
 * byte-compare for that (`@eco-incorp/sauce-sdk/recipes`), and compare `decoded.bodyHash` against
 * the body you get, before treating the decoded values as "this is my sweep program".
 */
export function decodeSettleProgram(program) {
    const parse = parseSettleProgram(program);
    if (parse.fatal) {
        throw new SettleDecodeError(parse.fatal.code, `decodeSettleProgram: ${parse.fatal.message}`);
    }
    const decoded = parseToDecoded(parse);
    if (decoded === null) {
        // Unreachable given parse.fatal === null, but keeps the return type honest.
        throw new SettleDecodeError("NOT_SETTLE_SHAPED", "decodeSettleProgram: incomplete parse");
    }
    return decoded;
}
/**
 * §5 of the wire spec — the cheaper, EQUIVALENT alternative to scan-and-check: when the caller
 * already knows the intended `(tokens, minOut, recipient)` (the normal case — they asked for the
 * swap), encode it directly and `memcmp`/hash-compare the whole program rather than decoding.
 * Given the minimality rule this produces the UNIQUE canonical encoding, so
 * `encodeSettleProgram(...) === program` is exactly equivalent to
 * `decodeSettleProgram(program)` succeeding with those values AND the body matching the pinned
 * hash — in one comparison, with no parser exposed to a hostile input at all. This is the
 * recommended non-TypeScript (Solidity/Go/Python) implementation — see `onChainVerdict` guidance
 * in this package's docs for why an on-chain form should implement §5, not §4.
 *
 * `bodyHex` is supplied by the caller — pass the body of a program you compiled yourself (there is
 * no pinned table here to default to, deliberately: the body you compare against should be one you
 * derived, not one shipped alongside the claim).
 */
export function encodeSettleProgram(tokens, minOut, recipient, bodyHex) {
    if (tokens.length === 0)
        throw new RangeError("encodeSettleProgram: tokens must have at least one entry");
    if (tokens.length > SETTLE_WIRE.MAX_ARITY)
        throw new RangeError(`encodeSettleProgram: ${tokens.length} tokens exceeds the ${SETTLE_WIRE.MAX_ARITY} arity cap`);
    const tokenValues = tokens.map((t) => (typeof t === "bigint" ? t : BigInt(t)));
    const recipientValue = typeof recipient === "bigint" ? recipient : BigInt(recipient);
    if (recipientValue === 0n)
        throw new RangeError("encodeSettleProgram: recipient must be nonzero");
    const parts = [];
    for (let i = tokenValues.length - 1; i >= 0; i--) {
        parts.push(encodeMinimalPush(tokenValues[i], SETTLE_WIRE.ADDRESS_BYTES));
    }
    parts.push(new Uint8Array([SETTLE_WIRE.TUPLE_OP]));
    parts.push(new Uint8Array([tokenValues.length]));
    parts.push(encodeMinimalPush(minOut, SETTLE_WIRE.PUSH_MAX));
    parts.push(encodeMinimalPush(recipientValue, SETTLE_WIRE.ADDRESS_BYTES));
    const bodyBytes = hexToBytesLocal(bodyHex);
    if (bodyBytes === null)
        throw new RangeError(`encodeSettleProgram: bodyHex is not valid hex: ${bodyHex}`);
    parts.push(bodyBytes);
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return bytesToHexLocal(out);
}
export { keccak256 };
//# sourceMappingURL=decode.js.map
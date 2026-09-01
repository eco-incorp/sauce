/**
 * SAUCE SETTLE PAYLOAD WIRE FORMAT — `recipes/settle.sauce.ts` on engine target v12, compiled by
 * the published Rust compiler.
 *
 * `payload := PROGRAM || ARGS`. Byte 0 is the first program byte — there is no header, magic,
 * version byte or length prefix. The two regions are DISJOINT: the program is a compile-time
 * constant, the arguments are per-execution bytes the engine reads back through CALLDATA.
 *
 * ```
 * payload     := program , args
 * program     := 391 bytes                        ; SETTLE_WIRE.PROGRAM_BYTES — invariant
 * args        := head , token_array
 * head        := tokens_ptr , minout , recipient  ; three 32-byte big-endian words
 * tokens_ptr  := word, value = 96                 ; byte offset WITHIN args of token_array
 * minout      := word, uint256, value = minOut    ; 0 = floor disabled
 * recipient   := word, uint160 in the LOW 20 bytes, upper 12 zero, MUST be nonzero
 * token_array := count , token{count}             ; at args + 96
 * count       := word, uint256, value = tokens.length, MUST be >= 1
 * token       := word, uint160 in the LOW 20 bytes, upper 12 zero
 * ```
 *
 * So `args` is exactly `128 + 32 * tokens.length` bytes, and `tokens[i]` — in SOURCE order, index 0
 * is the floor token — sits at `PROGRAM_BYTES + 128 + 32*i`. This is the compiler's appended-args
 * ABI: a scalar entry argument occupies one word at `PROGRAM_BYTES + slot*32`, and a dynamic array
 * spends its word on a pointer to `[count][element…]`, ABI-style, rooted at the start of `args`.
 *
 * §4 CANONICALITY — WHY THIS IS STRICTER THAN THE ENGINE. Measured on a real v12 runtime, the
 * engine ACCEPTS three payloads this decoder rejects: a `tokens_ptr` other than 96 (it follows any
 * offset), trailing bytes past the token array, and a token word whose upper 12 bytes are dirty
 * (the call target is masked to 160 bits, so it sweeps the same token). Each is a DIFFERENT byte
 * string producing IDENTICAL behavior. Accepting them would make the decode non-injective and put
 * `encodeSettleProgram`'s re-encode-and-compare (§5) at odds with a decode-and-compare, so all
 * three are refused: an accepted payload is the UNIQUE byte encoding of the values it decodes to.
 *
 * WHAT WAS DROPPED WITH THE v1 GRAMMAR, AND WHY. The retired TypeScript compiler baked the
 * arguments into a variable-length PUSH prologue ahead of a constant body, so a decoder had to walk
 * that prologue and enforce minimal-length pushes and a 20-byte cap per push to keep the encoding
 * unique. There are no pushes on this wire — every value is a fixed 32-byte word — so
 * `NON_MINIMAL_PUSH`, the `TUPLE`/arity pair and `BODY_LENGTH` describe nothing that can happen
 * here. Their uniqueness role is taken by §4 above, and `OVERSIZE_ADDRESS`'s role by
 * `DIRTY_ADDRESS_WORD`.
 *
 * WHAT THIS PROVES. `decodeSettleProgram` is STRUCTURAL: it pins the program's LENGTH and reads the
 * tail, so it tells you which `(tokens, minOut, recipient)` a payload carries and nothing about
 * what the 391 program bytes do. `validateSettleProgram` adds the authenticity half — one
 * `keccak256` over the WHOLE program against `SETTLE_WIRE.PROGRAM_HASH` — and that is now a
 * complete answer rather than a partial one: because the arguments left the program, a matching
 * hash means the payload runs the audited `settle.sauce.ts` and nothing else. Under the v1 grammar
 * no such statement was available from bytes alone, which is why the old decoder reported a
 * `bodyHash` for the caller to compare against something they compiled themselves.
 *
 * Dependency closure is `viem` only (`keccak256`) — no compiler, no `node:*`, no artifact
 * resolution — so this surface stays safe to import in a browser or an edge runtime. That closure
 * is the reason `/verify` decodes rather than recompiling-and-comparing: a recompile would put a
 * 1.96 MB wasm compiler in every consumer's dependency graph to answer a question `viem` answers
 * with one hash.
 */

import { keccak256, type Hex } from "viem";
import { SETTLE_WIRE } from "./wire.js";

/** Canonical `args` length for `count` tokens: the three head words, the count word, the elements. */
const argsLengthFor = (count: bigint): bigint => BigInt(SETTLE_WIRE.HEAD_BYTES + SETTLE_WIRE.WORD_BYTES) + BigInt(SETTLE_WIRE.WORD_BYTES) * count;

/** Everything above the low 20 bytes of a word — nonzero means the word is not a clean address. */
const ADDRESS_MASK = (1n << BigInt(SETTLE_WIRE.ADDRESS_BYTES * 8)) - 1n;

/** Stable failure codes — safe to `switch` on. Every one is a REAL rejection this decoder makes. */
export type SettleFailureCode =
  | "EMPTY"
  | "PROGRAM_TRUNCATED"
  | "ARGS_TRUNCATED"
  | "ARGS_OVERLONG"
  | "TOKENS_OFFSET"
  | "TOKENS_EMPTY"
  | "DIRTY_ADDRESS_WORD"
  | "ZERO_RECIPIENT"
  | "PROGRAM_HASH";

export class SettleDecodeError extends Error {
  readonly code: SettleFailureCode;
  constructor(code: SettleFailureCode, message: string) {
    super(message);
    this.name = "SettleDecodeError";
    this.code = code;
  }
}

export interface DecodedSettleProgram {
  /** The swept token list, in SOURCE order (index 0 is the FLOOR token — the wire does not reverse). */
  tokens: Address20[];
  minOut: bigint;
  recipient: Address20;
  /** `tokens[0]` — the floor token, named for readability at call sites. */
  floorToken: Address20;
  /** The leading `SETTLE_WIRE.PROGRAM_BYTES` bytes — argument-independent. */
  program: Hex;
  /** `keccak256(program)`. Compare against `SETTLE_WIRE.PROGRAM_HASH`, or let
   *  `validateSettleProgram` do it. */
  programHash: Hex;
  /** The argument tail — everything after the program. */
  args: Hex;
  argsSize: number;
  payloadSize: number;
}

/** A 20-byte address rendered as lowercase 0x-hex — deliberately NOT `viem`'s `Address` branded
 *  type: callers that want an EIP-55 checksum should `getAddress()` it themselves. */
export type Address20 = `0x${string}`;

function toAddress(value: bigint): Address20 {
  return ("0x" + value.toString(16).padStart(40, "0")) as Address20;
}

function bytesToHexLocal(bytes: Uint8Array): Hex {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

/** Returns `null` (never throws) on malformed hex — odd length, a non-hex character, or a
 *  non-string argument entirely (a runtime caller bypassing the type system) — so
 *  `parseSettleProgram` can report it as an `EMPTY`-coded fatal rather than throwing out of a
 *  function documented to never throw. */
function hexToBytesLocal(hex: string): Uint8Array | null {
  if (typeof hex !== "string") return null;
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Read the 32-byte big-endian word whose `index`-th slot starts at `slot * 32` within `args`. */
function wordAt(args: Uint8Array, slot: number): bigint {
  const start = slot * SETTLE_WIRE.WORD_BYTES;
  let value = 0n;
  for (let i = start; i < start + SETTLE_WIRE.WORD_BYTES; i++) value = (value << 8n) | BigInt(args[i]!);
  return value;
}

/** Internal parse result — used by both the throwing `decodeSettleProgram` and the non-throwing
 *  `bestEffortDecode`, which keeps partial state past a failure. */
export interface SettleParse {
  bytes: Uint8Array;
  program: Uint8Array | null;
  programHash: Hex | null;
  args: Uint8Array | null;
  /** The `tokens` head word as it appears on the wire — `SETTLE_WIRE.HEAD_BYTES` on a canonical
   *  payload. Recorded even when wrong, so a report can say what it was. */
  tokensOffset: bigint | null;
  minOut: bigint | null;
  recipient: bigint | null;
  recipientNonZero: boolean;
  /** The declared element count. Values past what the payload can hold are recorded here and
   *  reported as `ARGS_TRUNCATED`. */
  tokenCount: bigint | null;
  /** Element words as they appear on the wire, unmasked, so a dirty word is visible to a report. */
  tokenWords: bigint[];
  /** The first fatal failure, in scan order — null iff the payload is canonical. */
  fatal: { code: SettleFailureCode; message: string } | null;
}

/** Best-effort single left-to-right pass — never throws. This is the shared engine both
 *  `decodeSettleProgram` (throws on `parse.fatal`) and `bestEffortDecode` (keeps whatever DID
 *  parse even when a later stage failed) run on top of. */
export function parseSettleProgram(payload: Hex): SettleParse {
  const decodedHex = hexToBytesLocal(payload);
  const bytes = decodedHex ?? new Uint8Array(0);
  const result: SettleParse = {
    bytes,
    program: null,
    programHash: null,
    args: null,
    tokensOffset: null,
    minOut: null,
    recipient: null,
    recipientNonZero: false,
    tokenCount: null,
    tokenWords: [],
    fatal: null,
  };
  if (decodedHex === null) {
    result.fatal = { code: "EMPTY", message: `not a valid hex string: ${render(payload)}` };
    return result;
  }
  if (bytes.length === 0) {
    result.fatal = { code: "EMPTY", message: "empty payload" };
    return result;
  }
  if (bytes.length < SETTLE_WIRE.PROGRAM_BYTES) {
    result.fatal = {
      code: "PROGRAM_TRUNCATED",
      message: `payload is ${bytes.length} bytes, shorter than the ${SETTLE_WIRE.PROGRAM_BYTES}-byte settle program`,
    };
    return result;
  }

  result.program = bytes.subarray(0, SETTLE_WIRE.PROGRAM_BYTES);
  result.programHash = keccak256(bytesToHexLocal(result.program));
  const args = bytes.subarray(SETTLE_WIRE.PROGRAM_BYTES);
  result.args = args;

  // The head plus the array's count word is the smallest readable tail; below that nothing can be
  // named, so this returns rather than reporting values read past the end of the buffer.
  const minimumArgs = SETTLE_WIRE.HEAD_BYTES + SETTLE_WIRE.WORD_BYTES;
  if (args.length < minimumArgs) {
    result.fatal = {
      code: "ARGS_TRUNCATED",
      message: `argument tail is ${args.length} bytes, below the ${minimumArgs}-byte minimum (three head words and the token count)`,
    };
    return result;
  }

  result.tokensOffset = wordAt(args, 0);
  result.minOut = wordAt(args, 1);
  const recipientWord = wordAt(args, 2);
  result.recipient = recipientWord & ADDRESS_MASK;
  result.recipientNonZero = result.recipient !== 0n;

  if (result.tokensOffset !== BigInt(SETTLE_WIRE.HEAD_BYTES)) {
    // Reported at the CANONICAL offset, not at `result.tokensOffset`: this reads the array where a
    // conforming payload puts it. It does NOT follow the pointer the way the engine does, so for a
    // non-canonical payload the report and on-chain behaviour can differ -- which is exactly why this
    // is a fatal code rather than a silent reinterpretation.
    result.fatal = {
      code: "TOKENS_OFFSET",
      message: `tokens pointer is ${result.tokensOffset}, not the canonical ${SETTLE_WIRE.HEAD_BYTES} — the token array must follow the head immediately`,
    };
  }

  result.tokenCount = wordAt(args, SETTLE_WIRE.HEAD_SLOTS);
  const expected = argsLengthFor(result.tokenCount);
  if (BigInt(args.length) < expected) {
    result.fatal = result.fatal ?? {
      code: "ARGS_TRUNCATED",
      message: `token count ${result.tokenCount} needs a ${expected}-byte argument tail, but only ${args.length} bytes are present`,
    };
    return result; // reading elements past the end would fabricate values
  }
  if (BigInt(args.length) > expected) {
    result.fatal = result.fatal ?? {
      code: "ARGS_OVERLONG",
      message: `argument tail is ${args.length} bytes, ${BigInt(args.length) - expected} past the ${expected} bytes ${result.tokenCount} token(s) occupy`,
    };
  }

  const count = Number(result.tokenCount);
  for (let i = 0; i < count; i++) result.tokenWords.push(wordAt(args, SETTLE_WIRE.HEAD_SLOTS + 1 + i));

  if (count === 0) {
    result.fatal = result.fatal ?? { code: "TOKENS_EMPTY", message: "token count is 0 — a settle sweeps at least its floor token" };
  }

  // Scan order: the recipient word precedes the array, so its complaint is reported first.
  const dirtyToken = result.tokenWords.map((word, i) => dirtyWord(word, `tokens[${i}]`)).find((message) => message !== null);
  const dirty = dirtyWord(recipientWord, "recipient") ?? dirtyToken ?? null;
  if (dirty !== null) {
    result.fatal = result.fatal ?? { code: "DIRTY_ADDRESS_WORD", message: dirty };
  }

  if (!result.recipientNonZero) {
    result.fatal = result.fatal ?? { code: "ZERO_RECIPIENT", message: "recipient word decodes to the zero address" };
  }
  return result;
}

/** The §4 rule for one address word: the 12 bytes above the address must be zero. Returns the
 *  message for a dirty word, `null` for a clean one. */
function dirtyWord(word: bigint, label: string): string | null {
  const upper = word >> BigInt(SETTLE_WIRE.ADDRESS_BYTES * 8);
  return upper === 0n
    ? null
    : `${label} has nonzero bytes above its ${SETTLE_WIRE.ADDRESS_BYTES}-byte address (upper 0x${upper.toString(16)}) — the engine masks them away, so accepting this would make two byte strings decode alike`;
}

function render(payload: unknown): string {
  try {
    return JSON.stringify(payload).slice(0, 80);
  } catch {
    // `payload` was a type JSON.stringify itself rejects (e.g. a bigint) — never throw out of a
    // function documented to always return a report.
    return String(payload).slice(0, 80);
  }
}

function parseToDecoded(parse: SettleParse): DecodedSettleProgram | null {
  const { program, programHash, args, minOut, recipient, tokenWords } = parse;
  if (program === null || programHash === null || args === null || minOut === null || recipient === null || tokenWords.length === 0) {
    return null;
  }
  const tokens = tokenWords.map((w) => toAddress(w & ADDRESS_MASK));

  return {
    tokens,
    minOut,
    recipient: toAddress(recipient),
    floorToken: tokens[0]!,
    program: bytesToHexLocal(program),
    programHash,
    args: bytesToHexLocal(args),
    argsSize: args.length,
    payloadSize: parse.bytes.length,
  };
}

/** Decode whenever the shape is well-formed enough to name a full `(tokens, minOut, recipient)` —
 *  even when a check that does not block reading (a non-canonical tokens pointer, a trailing-slack
 *  tail, a dirty address word, a zero recipient) would make `decodeSettleProgram` throw — so a
 *  rejected payload's decoded intent is still visible to a caller debugging the rejection. */
export function bestEffortDecode(parse: SettleParse): DecodedSettleProgram | null {
  return parseToDecoded(parse);
}

/**
 * Decode a settle payload back into `(tokens, minOut, recipient)`. STRICT: rejects a non-canonical
 * tokens pointer, a tail longer or shorter than the token count implies, an address word with
 * dirty upper bytes, and a zero recipient — see §4 for why. Throws `SettleDecodeError` (carrying a
 * stable `.code`) on any of the failures in `SettleFailureCode`.
 *
 * This is a STRUCTURAL decode: it proves the payload is `391 bytes || a canonical argument tail`.
 * It does NOT prove those 391 bytes are the settle program you audited — any 391-byte prefix
 * passes. Use `validateSettleProgram` when that matters, which is nearly always.
 */
export function decodeSettleProgram(payload: Hex): DecodedSettleProgram {
  const parse = parseSettleProgram(payload);
  if (parse.fatal) {
    throw new SettleDecodeError(parse.fatal.code, `decodeSettleProgram: ${parse.fatal.message}`);
  }
  const decoded = parseToDecoded(parse);
  if (decoded === null) {
    // Unreachable given parse.fatal === null, but keeps the return type honest.
    throw new SettleDecodeError("PROGRAM_TRUNCATED", "decodeSettleProgram: incomplete parse");
  }

  return decoded;
}

/**
 * `decodeSettleProgram` plus the authenticity pin: the payload's 391 program bytes must hash to
 * `SETTLE_WIRE.PROGRAM_HASH`. Because the arguments no longer live inside the program, a match
 * means the payload runs the audited `recipes/settle.sauce.ts` and nothing else — the whole
 * question, not the structural half.
 *
 * Throws `SettleDecodeError` with code `PROGRAM_HASH` when the program is a different 391 bytes,
 * and whatever `decodeSettleProgram` would throw otherwise.
 */
export function validateSettleProgram(payload: Hex): DecodedSettleProgram {
  const decoded = decodeSettleProgram(payload);
  if (decoded.programHash !== SETTLE_WIRE.PROGRAM_HASH) {
    throw new SettleDecodeError(
      "PROGRAM_HASH",
      `validateSettleProgram: program hashes to ${decoded.programHash}, not the pinned ${SETTLE_WIRE.PROGRAM_HASH}`,
    );
  }

  return decoded;
}

/**
 * §5 of the wire spec — the cheaper, EQUIVALENT alternative to scan-and-check: when the caller
 * already knows the intended `(tokens, minOut, recipient)` (the normal case — they asked for the
 * swap), encode them directly and `memcmp`/hash-compare the whole payload rather than decoding.
 * Given §4 this produces the UNIQUE canonical encoding, so `encodeSettleProgram(...) === payload`
 * is exactly equivalent to `validateSettleProgram(payload)` succeeding with those values — in one
 * comparison, with no parser exposed to a hostile input at all. This is the recommended
 * non-TypeScript (Solidity/Go/Python) implementation.
 *
 * `programHex` is supplied by the caller — pass the program you compiled yourself. There is
 * deliberately no default: the bytes you compare against should be ones you derived, not ones
 * shipped alongside the claim they support. `SETTLE_WIRE.PROGRAM_HASH` is what to check them
 * against once you have them.
 */
export function encodeSettleProgram(tokens: readonly (bigint | `0x${string}`)[], minOut: bigint, recipient: bigint | `0x${string}`, programHex: Hex): Hex {
  if (tokens.length === 0) throw new RangeError("encodeSettleProgram: tokens must have at least one entry");
  const tokenValues = tokens.map((t) => (typeof t === "bigint" ? t : BigInt(t)));
  const recipientValue = typeof recipient === "bigint" ? recipient : BigInt(recipient);
  if (recipientValue === 0n) throw new RangeError("encodeSettleProgram: recipient must be nonzero");
  // Negatives need their own rejection, not just the upper bound: `-1n > ADDRESS_MASK` is FALSE and
  // `-1n === 0n` is FALSE, so a negative clears both guards -- and the write loop below terminates on
  // `value > 0n` before writing a byte, leaving an all-zero word. A negative recipient would encode as
  // address(0), defeating the nonzero check above; a negative token would sweep it.
  for (const [i, value] of tokenValues.entries()) {
    if (value < 0n || value > ADDRESS_MASK) {
      throw new RangeError(`encodeSettleProgram: tokens[${i}] does not fit in ${SETTLE_WIRE.ADDRESS_BYTES} bytes`);
    }
  }
  if (recipientValue < 0n || recipientValue > ADDRESS_MASK) {
    throw new RangeError(`encodeSettleProgram: recipient does not fit in ${SETTLE_WIRE.ADDRESS_BYTES} bytes`);
  }
  if (minOut < 0n || minOut >= 1n << 256n) throw new RangeError(`encodeSettleProgram: minOut ${minOut} is out of uint256 range`);

  const programBytes = hexToBytesLocal(programHex);
  if (programBytes === null) throw new RangeError(`encodeSettleProgram: programHex is not valid hex: ${programHex}`);
  if (programBytes.length !== SETTLE_WIRE.PROGRAM_BYTES) {
    throw new RangeError(`encodeSettleProgram: programHex is ${programBytes.length} bytes, not the ${SETTLE_WIRE.PROGRAM_BYTES} a settle program occupies`);
  }

  const words = [BigInt(SETTLE_WIRE.HEAD_BYTES), minOut, recipientValue, BigInt(tokenValues.length), ...tokenValues];
  const out = new Uint8Array(programBytes.length + words.length * SETTLE_WIRE.WORD_BYTES);
  out.set(programBytes, 0);
  words.forEach((value, slot) => {
    let v = value;
    for (let i = SETTLE_WIRE.WORD_BYTES - 1; i >= 0 && v > 0n; i--) {
      out[programBytes.length + slot * SETTLE_WIRE.WORD_BYTES + i] = Number(v & 0xffn);
      v >>= 8n;
    }
  });

  return bytesToHexLocal(out);
}

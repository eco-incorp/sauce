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
 * §4 CANONICALITY — WHY THIS IS STRICTER THAN THE ENGINE. Measured on a real v12 runtime, the engine
 * ACCEPTS five payloads this decoder rejects — `SETTLE_REJECTIONS.filter(r => r.engineAccepts)` is the
 * list, and the suite pins it, so this prose is a description and not the source of truth. They are: a
 * `tokens_ptr` other than 96 (it follows any offset), trailing bytes past the token array, a token
 * word whose upper 12 bytes are dirty (the call target is masked to 160 bits, so it sweeps the same
 * token), a dirty RECIPIENT word, and a ZERO recipient. The first three move the same tokens against
 * any ERC20. The last two both follow from one fact: the engine passes the recipient word through
 * UNMASKED and never inspects it, so what refuses them is the callee's own `address` / zero check —
 * against a token that omits those (Vyper, older solc, a forwarding proxy) they deliver too, the zero
 * case to address(0).
 * Each is a DIFFERENT byte string producing IDENTICAL behavior. Accepting them would make the decode
 * non-injective and put `encodeSettleProgram`'s re-encode-and-compare (§5) at odds with a
 * decode-and-compare, so ALL of them are refused — the recipient cases included, precisely because
 * whether they are caught depends on the callee rather than on the payload. An accepted payload is the UNIQUE
 * byte encoding of the values it decodes to.
 *
 * DO NOT PORT A POSITIONAL DECODER ONTO THIS WIRE. Values here are fixed 32-byte words and the
 * tokens head word is a POINTER, not a value (see the layout at the top of this file) — so a reader
 * that walks the tail by position,
 * as a decoder for a PUSH-prologue encoding must, lands on the offset and returns a plausible
 * wrong answer instead of failing. That is the one mistake this format invites, and §4 is what
 * closes it.
 *
 * WHAT THIS PROVES. `decodeSettleProgram` is STRUCTURAL: it pins the program's LENGTH and reads the
 * tail, so it tells you which `(tokens, minOut, recipient)` a payload carries and nothing about
 * what the 391 program bytes do. `validateSettleProgram` adds the authenticity half — one
 * `keccak256` over the WHOLE program against `SETTLE_WIRE.PROGRAM_HASH` — and that is now a
 * complete answer rather than a partial one: because the arguments left the program, a matching
 * hash means the payload runs the audited `settle.sauce.ts` and nothing else — a statement about
 * the bytes alone, needing nothing the caller has to compile and compare for themselves.
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
const argsLengthFor = (count: bigint): bigint =>
  BigInt(SETTLE_WIRE.HEAD_BYTES + SETTLE_WIRE.WORD_BYTES) + BigInt(SETTLE_WIRE.WORD_BYTES) * count;

/** The low 20 bytes of a word — an address's own bits. A value ABOVE this has dirty upper bytes and
 *  is not a clean address; `dirtyWord` (§ below) reports those upper bytes themselves. */
const ADDRESS_MASK = (1n << BigInt(SETTLE_WIRE.ADDRESS_BYTES * 8)) - 1n;

/** An accepted program: its `keccak256` AND the byte length the payload splits at. Both are needed —
 *  the split happens before any hash is computed, so a historical pin whose program was a different
 *  length cannot be matched by hash alone. */
export interface ProgramPin {
  hash: Hex;
  bytes: number;
}

/** Stable failure codes — safe to `switch` on. Every one is a REAL rejection this decoder makes.
 *
 *  BREAKING vs the v1 grammar: eight codes are GONE, because the defects they named cannot occur on a
 *  fixed-width wire. `NON_MINIMAL_PUSH`, `TRUNCATED_PUSH`, `TRUNCATED_MINOUT`, `TRUNCATED_RECIPIENT`
 *  and `OVERSIZE_ADDRESS` all described a variable-length PUSH prologue that no longer exists;
 *  `ARITY_MISMATCH` and `NOT_SETTLE_SHAPED` described shape inference the whole-program hash now
 *  settles outright; `BODY_LENGTH` described a body slice that is no longer a separate region. Their
 *  uniqueness role is taken by §4's canonicality rules and `PROGRAM_HASH`. Only `EMPTY` and
 *  `ZERO_RECIPIENT` carry over. A consumer with an exhaustive `switch` on the old union will compile
 *  and silently stop matching, which is why this ships as a breaking change. */
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
  /** The leading bytes the payload was split at — `SETTLE_WIRE.PROGRAM_BYTES` by default, or the
   *  matched `ProgramPin.bytes` when validating against a historical pin. Argument-independent. */
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
  for (let i = start; i < start + SETTLE_WIRE.WORD_BYTES; i++)
    value = (value << 8n) | BigInt(args[i]!);
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
  /** The recipient word BEFORE masking — what the engine actually passes to the token, since it does
   *  not mask that word. Differs from `recipient` exactly when the upper 12 bytes are dirty. */
  recipientWord: bigint | null;
  recipientNonZero: boolean;
  /** The declared element count, READ AT THE CANONICAL OFFSET 96. Values past what the payload can
   *  hold are recorded here and reported as `ARGS_TRUNCATED`.
   *
   *  When `fatal.code` is `TOKENS_OFFSET` this is NOT what the engine reads: the engine follows the
   *  payload's own pointer, this reads at 96, and the two name different arrays. Use
   *  `bestEffortDecode`, which declines that case, rather than reporting off raw parse state. */
  tokenCount: bigint | null;
  /** Element words as they appear on the wire, unmasked, so a dirty word is visible to a report. Read
   *  at the canonical offset — same `TOKENS_OFFSET` caveat as `tokenCount`. */
  tokenWords: bigint[];
  /** The first fatal failure, in scan order — null iff the payload is canonical. */
  fatal: { code: SettleFailureCode; message: string } | null;
}

/** Best-effort single left-to-right pass — never throws. This is the shared engine both
 *  `decodeSettleProgram` (throws on `parse.fatal`) and `bestEffortDecode` (keeps whatever DID
 *  parse even when a later stage failed) run on top of. */
export function parseSettleProgram(
  payload: Hex,
  programBytes: number = SETTLE_WIRE.PROGRAM_BYTES,
): SettleParse {
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
    recipientWord: null,
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
  if (bytes.length < programBytes) {
    result.fatal = {
      code: "PROGRAM_TRUNCATED",
      message: `payload is ${bytes.length} bytes, shorter than the ${programBytes}-byte settle program`,
    };
    return result;
  }

  result.program = bytes.subarray(0, programBytes);
  result.programHash = keccak256(bytesToHexLocal(result.program));
  const args = bytes.subarray(programBytes);
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
  result.recipientWord = recipientWord;
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
  for (let i = 0; i < count; i++)
    result.tokenWords.push(wordAt(args, SETTLE_WIRE.HEAD_SLOTS + 1 + i));

  if (count === 0) {
    result.fatal = result.fatal ?? {
      code: "TOKENS_EMPTY",
      message: "token count is 0 — a settle sweeps at least its floor token",
    };
  }

  // Within the dirty check only: the recipient word precedes the array, so its complaint wins over a
  // token's. This says nothing about ordering ACROSS codes -- `fatal` is first-wins by check position,
  // not by byte position, and ARGS_OVERLONG and TOKENS_EMPTY are both recorded above. Trailing slack
  // plus a dirty recipient reports ARGS_OVERLONG.
  const dirtyToken = result.tokenWords
    .map((word, i) => dirtyWord(word, `tokens[${i}]`))
    .find((message) => message !== null);
  const dirty = dirtyWord(recipientWord, "recipient") ?? dirtyToken ?? null;
  if (dirty !== null) {
    result.fatal = result.fatal ?? { code: "DIRTY_ADDRESS_WORD", message: dirty };
  }

  if (!result.recipientNonZero) {
    result.fatal = result.fatal ?? {
      code: "ZERO_RECIPIENT",
      message: "recipient word decodes to the zero address",
    };
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
  if (
    program === null ||
    programHash === null ||
    args === null ||
    minOut === null ||
    recipient === null ||
    tokenWords.length === 0
  ) {
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
 *  even when a check that does not block reading (a trailing-slack tail, a dirty address word, a
 *  zero recipient) would make `decodeSettleProgram` throw — so a rejected payload's decoded intent is
 *  still visible to a caller debugging the rejection.
 *
 *  DECLINES wherever the report would not match execution — the whole point being that on a hostile
 *  payload, reporting nothing beats reporting a wrong answer confidently. Two cases:
 *
 *  - a non-canonical tokens pointer: the engine follows it, this reads at the canonical offset, so the
 *    two name different TOKENS.
 *  - a dirty RECIPIENT word: `recipient` is masked here, but the engine does not mask that word (§4),
 *    so execution addresses a different 256-bit key than the masked answer would suggest.
 *
 *  A dirty TOKEN word is NOT declined: the engine masks a call target to 160 bits, so there the masked
 *  answer is exactly what executes, and reporting it is what shows the payload's true meaning. */
export function bestEffortDecode(parse: SettleParse): DecodedSettleProgram | null {
  // Both declines read STATE, not `fatal.code`. Gating on the code would be correct only while the
  // pointer check is the first non-returning fatal: add an earlier one, reorder the scan, or hand this
  // a caller-built `SettleParse` (the type is exported and is this function's only parameter) and the
  // decline would silently stop firing -- reporting tokens read at offset 96 for a payload the engine
  // reads elsewhere, the exact wrong answer this exists to refuse.
  if (parse.tokensOffset !== null && parse.tokensOffset !== BigInt(SETTLE_WIRE.HEAD_BYTES))
    return null;
  if (parse.recipientWord !== null && parse.recipientWord !== (parse.recipient ?? 0n)) return null;

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
export function decodeSettleProgram(
  payload: Hex,
  programBytes: number = SETTLE_WIRE.PROGRAM_BYTES,
): DecodedSettleProgram {
  const parse = parseSettleProgram(payload, programBytes);
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
 *
 * `accepted` overrides the pin. The dependency is a caret range and `SETTLE_WIRE` documents that a
 * codegen change is answered by RE-PINNING — at which point every intent already on chain carries the
 * OLD program, and a single hard-coded pin makes all of them unverifiable. Pass the pins you accept
 * (the current one plus any historical ones) to keep those payloads readable across a re-pin.
 *
 * A PIN IS A HASH *AND* A LENGTH, which is why a bare hash is not enough. The payload is split into
 * program and argument tail at a byte offset, before any hash is computed — so if a re-pin changes the
 * program's length (the likely outcome of a codegen change), splitting a historical payload at the NEW
 * length yields a wrong program and a truncated tail, and it dies as `ARGS_TRUNCATED` without any hash
 * ever being compared. Each entry may be `{ hash, bytes }`; a bare `Hex` means the CURRENT
 * `SETTLE_WIRE.PROGRAM_BYTES` and is only safe for a same-length re-pin. Candidates are tried in order
 * and the first whose program hash matches wins. Defaults to the current pin.
 */
export function validateSettleProgram(
  payload: Hex,
  accepted: readonly (Hex | ProgramPin)[] = [
    { hash: SETTLE_WIRE.PROGRAM_HASH as Hex, bytes: SETTLE_WIRE.PROGRAM_BYTES },
  ],
): DecodedSettleProgram {
  // Compared case-insensitively: `programHash` is always viem's lowercase keccak, so a historical pin
  // supplied in any other spelling would silently fail to match and orphan exactly the payloads this
  // parameter exists to keep readable -- surfacing through the intent path as a bare `null`.
  const pins: ProgramPin[] = accepted.map((pin) =>
    typeof pin === "string"
      ? { hash: pin.toLowerCase() as Hex, bytes: SETTLE_WIRE.PROGRAM_BYTES }
      : { hash: pin.hash.toLowerCase() as Hex, bytes: pin.bytes },
  );

  // Two kinds of failure, and they are NOT interchangeable. A pin whose length does not fit the
  // payload yields a parse error about bytes read at the wrong offset -- an artefact of trying that
  // candidate, not a fact about the payload. A pin that parses but does not match is the real answer:
  // these are not the audited program. So a hash mismatch always outranks a length-mismatch parse
  // error, whatever order the pins were supplied in; otherwise `.code` would depend on pin order and a
  // payload with a perfectly canonical tail could be reported as having a malformed one.
  //
  // That precedence is the guarantee, and it is the whole of it. Among parse errors there is no such
  // ordering: each is an artefact of the candidate that produced it, and the FIRST supplied pin's is
  // the one reported -- so with several pins and no match at all, the code can still differ by pin
  // order (a 391-byte program read at 359 reports TOKENS_OFFSET where reading it at 391 reports
  // ARGS_TRUNCATED). Diagnostic only: through `intent.ts` every one of them collapses to `null`, and
  // with a single pin -- the default and common case -- there is no order to depend on.
  let hashMismatch: SettleDecodeError | null = null;
  let parseError: unknown = null;
  for (const pin of pins) {
    let candidate: DecodedSettleProgram;
    try {
      candidate = decodeSettleProgram(payload, pin.bytes);
    } catch (error) {
      parseError = parseError ?? error;
      continue;
    }
    if (candidate.programHash.toLowerCase() === pin.hash) return candidate;
    hashMismatch =
      hashMismatch ??
      new SettleDecodeError(
        "PROGRAM_HASH",
        `validateSettleProgram: program hashes to ${candidate.programHash}, not the pinned ${pin.hash}`,
      );
  }
  if (hashMismatch !== null) throw hashMismatch;
  if (parseError !== null) throw parseError;

  // Only reachable for an empty pin list, which accepts nothing and would otherwise return a
  // successful decode of a program no caller vouched for.
  throw new SettleDecodeError(
    "PROGRAM_HASH",
    "validateSettleProgram: no accepted program pins were supplied",
  );
}

/** `BigInt` is the wrong gate for a caller-supplied address: `BigInt("")` is `0n` rather than a throw,
 *  so an empty string would encode as `address(0)` and sweep it; and malformed hex raises `SyntaxError`,
 *  where every other rejection here is a `RangeError` callers already catch. Require the canonical
 *  `0x`-prefixed spelling and report both as `RangeError`. */
function coerceAddressValue(value: bigint | `0x${string}`, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new RangeError(
      `encodeSettleProgram: ${label} is not a 0x-prefixed hex address: ${String(value)}`,
    );
  }

  return BigInt(value);
}

/**
 * §5 of the wire spec — the cheaper, EQUIVALENT alternative to scan-and-check: when the caller
 * already knows the intended `(tokens, minOut, recipient)` (the normal case — they asked for the
 * swap), encode them directly and `memcmp`/hash-compare the whole payload rather than decoding.
 * Given §4 this produces the UNIQUE canonical encoding, so `encodeSettleProgram(...)` equals
 * `payload` exactly when `validateSettleProgram(payload)` succeeds with those values — in one
 * comparison, with no parser exposed to a hostile input at all. This is the recommended
 * non-TypeScript (Solidity/Go/Python) implementation, where a payload is bytes and the comparison is
 * a plain `memcmp`.
 *
 * THE EQUIVALENCE IS OVER BYTES, NOT OVER HEX SPELLINGS. `validateSettleProgram` accepts any spelling
 * of the same bytes — uppercase, a `0X` prefix, no prefix at all — while this returns canonical
 * lowercase `0x`. So `validateSettleProgram(p.toUpperCase())` succeeds where
 * `encodeSettleProgram(...) === p.toUpperCase()` is `false`. A string `===` is only equivalent once
 * both sides are in canonical spelling; normalize first, or compare decoded bytes.
 *
 * `programHex` is supplied by the caller — pass the program you compiled yourself. There is
 * deliberately no default: the bytes you compare against should be ones you derived, not ones
 * shipped alongside the claim they support. `SETTLE_WIRE.PROGRAM_HASH` is what to check them
 * against once you have them.
 */
export function encodeSettleProgram(
  tokens: readonly (bigint | `0x${string}`)[],
  minOut: bigint,
  recipient: bigint | `0x${string}`,
  programHex: Hex,
): Hex {
  if (tokens.length === 0)
    throw new RangeError("encodeSettleProgram: tokens must have at least one entry");
  const tokenValues = tokens.map((token, i) => coerceAddressValue(token, `tokens[${i}]`));
  const recipientValue = coerceAddressValue(recipient, "recipient");
  if (recipientValue === 0n) throw new RangeError("encodeSettleProgram: recipient must be nonzero");
  // Negatives need their own rejection, not just the upper bound: `-1n > ADDRESS_MASK` is FALSE and
  // `-1n === 0n` is FALSE, so a negative clears both guards -- and the write loop below terminates on
  // `value > 0n` before writing a byte, leaving an all-zero word. A negative recipient would encode as
  // address(0), defeating the nonzero check above; a negative token would sweep it.
  for (const [i, value] of tokenValues.entries()) {
    if (value < 0n || value > ADDRESS_MASK) {
      throw new RangeError(
        `encodeSettleProgram: tokens[${i}] does not fit in ${SETTLE_WIRE.ADDRESS_BYTES} bytes`,
      );
    }
  }
  if (recipientValue < 0n || recipientValue > ADDRESS_MASK) {
    throw new RangeError(
      `encodeSettleProgram: recipient does not fit in ${SETTLE_WIRE.ADDRESS_BYTES} bytes`,
    );
  }
  // Guarded like the addresses above, and for the same reason: a runtime caller bypassing the type
  // system (minOut deserialized from JSON as a number) would otherwise reach the word-write loop and
  // raise TypeError from a BigInt mix, where every rejection here is a RangeError callers catch.
  if (typeof minOut !== "bigint")
    throw new RangeError(`encodeSettleProgram: minOut must be a bigint, got ${typeof minOut}`);
  if (minOut < 0n || minOut >= 1n << 256n)
    throw new RangeError(`encodeSettleProgram: minOut ${minOut} is out of uint256 range`);

  const programBytes = hexToBytesLocal(programHex);
  if (programBytes === null)
    throw new RangeError(`encodeSettleProgram: programHex is not valid hex: ${programHex}`);
  // Deliberately NOT compared against `SETTLE_WIRE.PROGRAM_BYTES`. `programHex` is the program the
  // caller compiled, and §5 offers this as the equivalent of `validateSettleProgram` — which now
  // accepts historical pins of other lengths. Pinning the current constant here would make the two
  // halves of that equivalence diverge for exactly the re-pin `ProgramPin.bytes` exists to survive.
  if (programBytes.length === 0) {
    throw new RangeError("encodeSettleProgram: programHex is empty");
  }

  const words = [
    BigInt(SETTLE_WIRE.HEAD_BYTES),
    minOut,
    recipientValue,
    BigInt(tokenValues.length),
    ...tokenValues,
  ];
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

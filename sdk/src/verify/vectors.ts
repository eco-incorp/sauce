import type { Hex } from "viem";

import type { SettleFailureCode } from "./decode.js";

/**
 * The compiled `recipes/settle.sauce.ts` program — 391 bytes, measured by compiling it with the
 * published Rust compiler (`@eco-incorp/sauce-compiler`) against the package's own
 * `artifacts/IERC20.json`.
 *
 * ONE constant covers the whole corpus because the program is INVARIANT: `main` takes
 * `(tokens, minOut, recipient)` as runtime entry arguments, so no caller value reaches the
 * compiler. That is the property the appended-args model rests on, and `verify.compile.test.ts` recompiles
 * this and compares — a LIVE pin, unlike the v1 corpus it replaces, whose compiler no longer exists.
 */
export const SETTLE_PROGRAM: Hex =
  "0xa50201e7d15146010122020011b19000b6d00201870120955402018721d1d1d00120d4212295540240000120d22345010122020039b19000b60120d123012021d221d3514601012202004fb19000b6d0012023d08a04ffffffff30e10120340a9290000000000000000031310100d2d146020079b10200beb00120d4210120d223e1210120d5210120d3230120e1e1e22121d3d3d151d14642020184b101019504ffffffff30d7e1e2e3d0e1e2e3e4229554e1890101d121e1e002006eb0d40201a701209554e1e2e3e4e50201c7012095540100d4970100e1649401a0900470a082319602a3a10120970100d3450200f6b1020120b0d2d146020101b1020120b0901c736574746c653a2062616c616e63652062656c6f77206d696e4f7574b60100d551d14602012eb1020175b0d0d6970100d1649401a0900470a082319602a3a10120970100d145020151b1020169b00100d20100d3d89402a09004a9059cbb9602a2a1012097e00101d321e3e0e0e0020122b0e101208ae1d18905200000000031009000b6" as Hex;

export interface ConformanceVector {
  name: string;
  tokens: Hex[];
  minOut: bigint;
  recipient: Hex;
  /** The canonical argument tail these values encode to. `settlePayload(args)` prepends the program. */
  args: Hex;
}

/** The full on-the-wire payload for a vector's tail: `program || args`. */
export function settlePayload(args: Hex): Hex {
  return (SETTLE_PROGRAM + args.slice(2)) as Hex;
}

const U = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex; // Base USDC
const W = "0x4200000000000000000000000000000000000006" as Hex; // Base WETH
const Z = "0x0000000000000000000000000000000000ff00aa" as Hex; // an address with leading zero bytes
const D = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" as Hex; // Base DAI
const B = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Hex; // Base cbBTC

/**
 * Golden wire-format vectors — the Go/Solidity/Python conformance corpus, and the definition of the
 * layout for anyone reimplementing the decoder.
 *
 * Each `args` tail is proven by EXECUTION, not by construction: `verify-execution.e2e.test.ts` runs
 * `settlePayload(v.args)` on a real v12 runtime against real ERC20s and asserts the engine sweeps
 * exactly `v.tokens` to `v.recipient` under `v.minOut`. The bytes below are what the engine reads,
 * not what this package's encoder happens to emit.
 *
 * `v3` carries `Z = 0x0000000000000000000000000000000000ff00aa` — the address the retired v1 corpus
 * used as its trap, because a minimal-length PUSH squeezed it into 3 bytes and a fixed 20-byte read
 * misframed everything after it. On THIS wire it is an ordinary 32-byte word: the layout is
 * fixed-width, so leading zero bytes cost nothing and mean nothing. The hazard moved, and
 * `SETTLE_REJECTIONS` is where it went.
 */
export const SETTLE_VECTORS: readonly ConformanceVector[] = [
  {
    name: "v1 — single token, minOut disabled",
    tokens: [U],
    minOut: 0n,
    recipient: W,
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
  },
  {
    name: "v2 — two tokens, large minOut",
    tokens: [U, W],
    minOut: 1234567890123456789012n,
    recipient: W,
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000042ed123b0bd8203a1400000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000002000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000004200000000000000000000000000000000000006" as Hex,
  },
  {
    name: "v3 — five tokens, leading-zero-byte addresses in both a token slot and the recipient",
    tokens: [Z, U, W, D, B],
    minOut: 1n,
    recipient: Z,
    args: "0x000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000ff00aa00000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000ff00aa000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000420000000000000000000000000000000000000600000000000000000000000050c5725949a6f0c72e6c4a641f24049a917db0cb000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf" as Hex,
  },
];

export interface RejectionVector {
  name: string;
  /** The non-canonical tail. `settlePayload(args)` makes the payload a decoder must refuse. */
  args: Hex;
  code: SettleFailureCode;
  /** Whether a real v12 runtime ACCEPTS this payload — measured. Where it does, the rejection is
   *  this decoder being stricter than the engine on purpose (decode.ts §4), and the vector is
   *  load-bearing: a lax implementation would pass every other test in this corpus. */
  engineAccepts: boolean;
}

/**
 * Payloads a conformant decoder MUST refuse — the successor to the v1 corpus's `v3` trap.
 *
 * The first three are the trap proper, and they are the reason this corpus exists at all: the
 * engine RUNS them and produces exactly the behavior of the canonical payload beside them, so they
 * are distinct byte strings with identical meaning. A decoder that accepts any of them is not
 * injective, and `encodeSettleProgram` re-encode-and-compare stops agreeing with decode-and-compare.
 * `upperBytes` is the sharpest: the engine masks a call target to 160 bits, so twelve arbitrary
 * bytes ride along in a token word and sweep the very same token.
 *
 * Each vector's `code` is reachable under ANY check order, so a Go or Solidity reimplementation is not
 * required to match this decoder's sequence to pass. `tokensPointer` is the one that has to be built
 * for that: its padding word is `0x02` so that the count read at the canonical offset agrees with the
 * tail length, leaving the non-canonical pointer as the only complaint. A length-first decoder and a
 * pointer-first decoder both report `TOKENS_OFFSET`. (The engine reads its array from offset 128, so
 * that word is not in its read path -- `engineAccepts` is unaffected by its value.)
 */
export const SETTLE_REJECTIONS: readonly RejectionVector[] = [
  {
    name: "tokensPointer — 0x80 with a padding word, instead of the canonical 0x60",
    args: "0x00000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "TOKENS_OFFSET",
    engineAccepts: true,
  },
  {
    name: "trailingSlack — a canonical tail with 32 zero bytes appended",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000000000" as Hex,
    code: "ARGS_OVERLONG",
    engineAccepts: true,
  },
  {
    name: "upperBytes — tokens[0] carries 0xff in all 12 bytes above its address",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001ffffffffffffffffffffffff833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "DIRTY_ADDRESS_WORD",
    engineAccepts: true,
  },
  {
    name: "dirtyRecipient — the recipient word carries 0xff above its address",
    args: "0x00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffff42000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "DIRTY_ADDRESS_WORD",
    engineAccepts: false,
  },
  {
    name: "shortArray — count says 2, one element word present",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000002000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "ARGS_TRUNCATED",
    engineAccepts: false,
  },
  {
    name: "zeroRecipient — the recipient word is 0",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "ZERO_RECIPIENT",
    engineAccepts: false,
  },
  {
    name: "emptyArray — count is 0, so there is no floor token",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000" as Hex,
    code: "TOKENS_EMPTY",
    engineAccepts: false,
  },
];

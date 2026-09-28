import type { Hex } from "viem";

import type { SettleFailureCode } from "./decode.js";

/**
 * The compiled `recipes/settle.sauce.ts` program — 435 bytes, measured by compiling it with the
 * published Rust compiler (`@eco-incorp/sauce-compiler`) against the package's own
 * `artifacts/IERC20.json`.
 *
 * ONE constant covers the whole corpus because the program is INVARIANT: `main` takes
 * `(tokens, minOut, recipient)` as runtime entry arguments, so no caller value reaches the
 * compiler. That is the property the appended-args model rests on, and `verify.compile.test.ts` recompiles
 * this and compares — a LIVE pin, unlike the v1 corpus it replaces, whose compiler no longer exists.
 */
export const SETTLE_PROGRAM: Hex =
  "0xa5020213d1514702000eb19000b6d00201b3012095540201b321d1d1d00120d4212295540240000120d22348020033b19000b60120d123012021d221d35147020046b19000b6d0012023d08a04ffffffff30e10120340a9220000000000000000031310100d2d146020070b10200a8b00120d4210120d223e1210120d5210120d3230120e1f12121d3d3d151d146420201b0b1d8f1e3e4d0f1e3e4e52295549b0101e121020065b0d40201d301209554f1e3e4e50201f3012095540100d4970100e1649401a0900470a082319602a3a10120970100d348020101b1d2d147020101b1901c736574746c653a2062616c616e63652062656c6f77206d696e4f7574b60100d551d14602010fb10201a1b0d0d6970100e1649401a0900470a082319602a3a10120970100d148020196b19004a9059cbbd2d8970100d301208ae1d189052000000000310100012095d701208ae1d189052000000000310100012095f1e3e496029602a20100d15143020187b1d0a101200100e1970101e143020183b19000b6020195b00100d3d9977245020195b19000b6e00101d221e2e0e0020103b0e101208ae1d18905200000000031009000b6" as Hex;

export interface ConformanceVector {
  name: string;
  tokens: Hex[];
  minOut: bigint;
  recipient: Hex;
  /** The canonical argument tail these values encode to. `settlePayload(args)` prepends the program. */
  args: Hex;
}

/** The full on-the-wire payload for a vector's tail: `program || args`.
 *
 *  Exported from `./verify`, so it takes a caller's hex rather than only this file's literals: an
 *  unprefixed tail would otherwise lose its first byte to the slice and resurface as a puzzling
 *  `ARGS_TRUNCATED`, and a `0X` prefix — which the decoder itself tolerates — would produce garbage.
 *  Requires the canonical `0x`, consistent with `encodeSettleProgram`'s inputs. */
export function settlePayload(args: Hex): Hex {
  if (typeof args !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(args)) {
    throw new RangeError(
      `settlePayload: args must be 0x-prefixed hex of whole bytes, got ${String(args)}`,
    );
  }

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
   *  load-bearing: a lax implementation would pass every other test in this corpus.
   *
   *  NOT SELF-VERIFYING for every row. The e2e filters on `sweepsIdentically`, so only those rows
   *  re-measure themselves on chain each run. Any row that is `engineAccepts` WITHOUT
   *  `sweepsIdentically` is asserted nowhere but here and would keep claiming it if the engine changed
   *  — `SETTLE_REJECTIONS.filter(r => r.engineAccepts && !r.sweepsIdentically)` is that ledger, and the
   *  suite pins it rather than this comment naming rows that then drift. Each is refused by the CALLEE
   *  rather than the engine, so proving one needs a token fixture that skips the check in question;
   *  without that, the engine's acceptance is invisible behind the revert. */
  engineAccepts: boolean;
  /** Whether the whole call then SUCCEEDS and moves the same tokens as the canonical payload, against
   *  a standard solc ERC20. Distinct from `engineAccepts`, and the e2e's on-chain equivalence loop
   *  filters on THIS: the engine can run a payload that the *callee* refuses, in which case the
   *  identical-behavior claim holds only for tokens that do not perform the callee's check. */
  sweepsIdentically: boolean;
}

/**
 * Payloads a conformant decoder MUST refuse — the successor to the v1 corpus's `v3` trap.
 *
 * The `engineAccepts` rows are the trap proper, and they are the reason this corpus exists at all: the
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
    sweepsIdentically: true,
  },
  {
    name: "trailingSlack — a canonical tail with 32 zero bytes appended",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000000000" as Hex,
    code: "ARGS_OVERLONG",
    engineAccepts: true,
    sweepsIdentically: true,
  },
  {
    name: "upperBytes — tokens[0] carries 0xff in all 12 bytes above its address",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001ffffffffffffffffffffffff833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "DIRTY_ADDRESS_WORD",
    engineAccepts: true,
    sweepsIdentically: true,
  },
  {
    name: "dirtyRecipient — the recipient word carries 0xff above its address",
    args: "0x00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffff42000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "DIRTY_ADDRESS_WORD",
    // The engine passes the RECIPIENT word through unmasked -- unlike a token word, which it masks as
    // a CALL target -- so it executes this payload and emits `a9059cbb <dirty recipient> ...`. The
    // revert against a solc ERC20 is that callee's own dirty-`address` ABI check, not the engine's.
    // A token that does not perform it (Vyper, older solc, a raw-forwarding proxy) delivers to the
    // same recipient as the canonical payload, which is the non-injectivity §4 exists to refuse.
    engineAccepts: true,
    sweepsIdentically: false,
  },
  {
    name: "shortArray — count says 2, one element word present",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000002000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "ARGS_TRUNCATED",
    engineAccepts: false,
    sweepsIdentically: false,
  },
  {
    name: "zeroRecipient — the recipient word is 0",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Hex,
    code: "ZERO_RECIPIENT",
    // Same fact as `dirtyRecipient`, not a separate measurement: the engine passes the recipient word
    // through unmasked and performs no check on it, so zero is simply another value of that word --
    // there is no mechanism by which the engine would single it out. A standard solc ERC20's own
    // zero-address check in `_transfer` is what refuses this; a callee that permits it sends the
    // tokens to address(0).
    engineAccepts: true,
    sweepsIdentically: false,
  },
  {
    name: "emptyArray — count is 0, so there is no floor token",
    args: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000" as Hex,
    code: "TOKENS_EMPTY",
    engineAccepts: false,
    sweepsIdentically: false,
  },
];

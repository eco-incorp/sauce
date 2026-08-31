import type { Hex } from "viem";

export interface ConformanceVector {
  name: string;
  tokens: Hex[];
  minOut: bigint;
  recipient: Hex;
  /** The exact program these args produced under the retired compiler — measured by compiling
   *  `recipes/settle.sauce.ts`, not hand-assembled. Frozen: nothing recompiles it any more. */
  program: Hex;
}

const U = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex; // Base USDC
const W = "0x4200000000000000000000000000000000000006" as Hex; // Base WETH
const Z = "0x0000000000000000000000000000000000ff00aa" as Hex; // leading-zero-byte address — THE TRAP

/**
 * Golden wire-format vectors — the Go/Solidity/Python conformance corpus. Each `program` was
 * obtained by actually compiling `recipes/settle.sauce.ts` with the given args (not hand-encoded).
 * See decode.ts's module docstring for the grammar these bytes instantiate.
 *
 * They are now a FROZEN corpus rather than a regression pin on a live compiler: the compiler that
 * produced them is retired, and its replacement folds the params into the body instead of a prologue
 * (decode.ts explains). Nothing recompiles these — they are the definition of the v1 grammar for
 * anyone reimplementing the decoder, which is what a conformance corpus is for.
 *
 * `v3` is the trap vector: `Z = 0x0000000000000000000000000000000000ff00aa` has two leading zero
 * bytes, so its minimal-length PUSH is only 3 bytes wide (`03 ff00aa`), not the naive 20 — a fixed
 * 20-byte read at that offset silently misframes everything after it. `v3` also (together with
 * `v1`) pins the reversal: the FIRST push on the wire is the LAST logical token.
 */
export const SETTLE_VECTORS: readonly ConformanceVector[] = [
  {
    name: "v1 — single token, minOut disabled",
    tokens: [U],
    minOut: 0n,
    recipient: W,
    program:
      "0x14833589fcd6edb6e08f4c7c32d4f71b54bda0291394010100144200000000000000000000000000000000000006c0050100d397c10001005000649401a0900470a082319602a3a1012097c1010100d245b025d1500146b01f901c736574746c653a2062616c616e63652062656c6f77206d696e4f7574b60100c102b2075002010121c102d251500246b0405002d397c10301005003649401a0900470a082319602a3a1012097c1040100500445b01a0100500301005004d49402a09004a9059cbb9602a2a1010197e0b44e5001f200" as Hex,
  },
  {
    name: "v2 — two tokens, large minOut",
    tokens: [U, W],
    minOut: 1234567890123456789012n,
    recipient: W,
    program:
      "0x14420000000000000000000000000000000000000614833589fcd6edb6e08f4c7c32d4f71b54bda0291394020942ed123b0bd8203a14144200000000000000000000000000000000000006c0050100d397c10001005000649401a0900470a082319602a3a1012097c1010100d245b025d1500146b01f901c736574746c653a2062616c616e63652062656c6f77206d696e4f7574b60100c102b2075002010121c102d251500246b0405002d397c10301005003649401a0900470a082319602a3a1012097c1040100500445b01a0100500301005004d49402a09004a9059cbb9602a2a1010197e0b44e5001f200" as Hex,
  },
  {
    name: "v3 — leading-zero-byte address (THE TRAP: 3-byte push, not 20)",
    tokens: [Z, U],
    minOut: 1n,
    recipient: Z,
    program:
      "0x14833589fcd6edb6e08f4c7c32d4f71b54bda0291303ff00aa9402010103ff00aac0050100d397c10001005000649401a0900470a082319602a3a1012097c1010100d245b025d1500146b01f901c736574746c653a2062616c616e63652062656c6f77206d696e4f7574b60100c102b2075002010121c102d251500246b0405002d397c10301005003649401a0900470a082319602a3a1012097c1040100500445b01a0100500301005004d49402a09004a9059cbb9602a2a1010197e0b44e5001f200" as Hex,
  },
];

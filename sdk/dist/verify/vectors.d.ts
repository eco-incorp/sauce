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
export declare const SETTLE_VECTORS: readonly ConformanceVector[];
//# sourceMappingURL=vectors.d.ts.map
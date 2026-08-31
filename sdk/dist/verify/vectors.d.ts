import type { Hex } from "viem";
export interface ConformanceVector {
    name: string;
    tokens: Hex[];
    minOut: bigint;
    recipient: Hex;
    /** The exact program these args produce — measured by compiling `recipes/settle.sauce.ts` with
     *  `@eco-incorp/sauce-sdk/compiler`, not hand-assembled. `test/verify.compile.test.ts` recompiles
     *  it and byte-compares, so this is a live regression pin, not a transcription. */
    program: Hex;
}
/**
 * Golden wire-format vectors — the Go/Solidity/Python conformance corpus. Each `program` was
 * obtained by actually compiling `recipes/settle.sauce.ts` with the given args (not hand-encoded).
 * See decode.ts's module docstring for the grammar these bytes instantiate.
 *
 * They serve two purposes at once. They are the definition of the v1 grammar for anyone
 * reimplementing the decoder, which is what a conformance corpus is for; and they are a LIVE
 * regression pin on the compiler that produces the grammar — `test/verify.compile.test.ts` compiles
 * `recipes/settle.sauce.ts` with `@eco-incorp/sauce-sdk/compiler` (the TypeScript compiler this
 * package ships) and byte-compares against these vectors, so a program edit or a compiler change
 * shows up as a real diff.
 *
 * The published Rust compiler does NOT reproduce them, and is not meant to: it folds the params
 * into the body instead of emitting them as a decodable prologue (decode.ts explains), so these
 * bytes pin the `/compiler` v1 grammar only.
 *
 * `v3` is the trap vector: `Z = 0x0000000000000000000000000000000000ff00aa` has two leading zero
 * bytes, so its minimal-length PUSH is only 3 bytes wide (`03 ff00aa`), not the naive 20 — a fixed
 * 20-byte read at that offset silently misframes everything after it. `v3` also (together with
 * `v1`) pins the reversal: the FIRST push on the wire is the LAST logical token.
 */
export declare const SETTLE_VECTORS: readonly ConformanceVector[];
//# sourceMappingURL=vectors.d.ts.map
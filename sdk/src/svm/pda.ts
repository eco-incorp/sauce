/**
 * The engine exposes no PDA of its own.
 *
 * `deriveBufferPda` derived the pre-release engine's `["buffer", authority, seed]`. Buffers belong
 * to the kitchen now — `deriveCodeBufferPda` / `deriveCodePda` in `kitchen.ts`. `EnginePda` stays
 * because it is the shape those return and consumers destructure.
 */
import type { Address } from "@solana/kit";

export interface EnginePda {
  address: Address;
  bump: number;
}

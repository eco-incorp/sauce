/**
 * Proves the venue account-plan derivations that were re-routed onto the shared
 * PDA-derivation memo (../../src/svm/venues/pda-memo.ts) stay byte-identical to a
 * direct, un-memoized getProgramDerivedAddress over the exact same
 * (programAddress, seeds), AND that a warm repeat resolves entirely from the
 * memo (zero fresh derivations).
 *
 * This complements pda-memo.test.ts — which proves the memo itself over the
 * CLMM/DLMM tick/bin-array seed shapes — by exercising the ATA / shared-`pda`
 * helpers that carry the bulk of the warm-quote derivation cost
 * (pumpswap + the shared scale-common / stabble-common `ata()` families). The
 * venue fixture suites (pumpswap.test.ts, scale-*.test.ts, stabble-*.test.ts,
 * …) are the byte-identity net for every OTHER routed venue: each asserts real
 * derived account addresses against a fixture, so a changed derivation reddens
 * there.
 */
import { address, getAddressCodec, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  __pdaMemoStats,
  __resetPdaMemoForTest,
  memoizedFindAssociatedTokenPda,
} from "../../src/svm/venues/pda-memo.js";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  POOL_SEED,
  SCALE_AMM_PROGRAM_ID,
  TOKEN_PROGRAM,
  ata as scaleAta,
  pda as scalePda,
} from "../../src/svm/venues/scale-common.js";
import {
  STABBLE_ATA_PROGRAM_ID,
  STABBLE_TOKEN_PROGRAM_ID,
  findStabbleAta,
} from "../../src/svm/venues/stabble-common.js";

/** The un-memoized primitive every routed venue deriver used to call directly. */
async function directPda(programAddress: Address, seeds: Uint8Array[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress, seeds });
  return pda;
}

function addressBytes(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}

// Real, distinct mainnet mints (confirmed-valid base58 addresses). The
// derivations are pure functions of the seed bytes, so any valid pubkeys in the
// owner/mint roles exercise the path; reusing these four in both roles keeps the
// fixtures unambiguously valid while giving four distinct (owner, mint) pairs.
const WSOL = address("So11111111111111111111111111111111111111112");
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const JLP = address("27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4");

const SAMPLES: ReadonlyArray<{ owner: Address; mint: Address; tokenProgram: Address }> = [
  { owner: USDC, mint: WSOL, tokenProgram: TOKEN_PROGRAM },
  { owner: WSOL, mint: USDC, tokenProgram: TOKEN_PROGRAM },
  { owner: USDT, mint: JLP, tokenProgram: TOKEN_PROGRAM },
  { owner: JLP, mint: USDT, tokenProgram: TOKEN_PROGRAM },
];

beforeEach(() => {
  __resetPdaMemoForTest();
});

describe("venue PDA derivations routed through the shared memo", () => {
  describe("address correctness: memoized helper == direct un-memoized derive", () => {
    it("scale-common ata([owner, tokenProgram, mint], ATA_PROGRAM)", async () => {
      for (const { owner, mint, tokenProgram } of SAMPLES) {
        const got = await scaleAta(owner, mint, tokenProgram);
        const expected = await directPda(ASSOCIATED_TOKEN_PROGRAM, [
          addressBytes(owner),
          addressBytes(tokenProgram),
          addressBytes(mint),
        ]);
        expect(got).toBe(expected);
      }
    });

    it("stabble-common findStabbleAta(owner, mint) — [owner, TOKEN_PROGRAM, mint] under the ATA program", async () => {
      for (const { owner, mint } of SAMPLES) {
        const got = await findStabbleAta(owner, mint);
        const expected = await directPda(STABBLE_ATA_PROGRAM_ID, [
          addressBytes(owner),
          addressBytes(STABBLE_TOKEN_PROGRAM_ID),
          addressBytes(mint),
        ]);
        expect(got).toBe(expected);
      }
    });

    it("scale-common shared pda() over a MIXED (byte-seed + Address) list keeps its own normalization", async () => {
      // Scale's own Pool PDA shape: ["pool", owner, mint_a, mint_b], where the
      // leading label is already bytes (POOL_SEED) and the addresses normalize
      // to their 32-byte pubkeys — the exact seed set the helper passes the memo.
      const got = await scalePda([POOL_SEED, USDT, WSOL, USDC], SCALE_AMM_PROGRAM_ID);
      const expected = await directPda(SCALE_AMM_PROGRAM_ID, [
        POOL_SEED,
        addressBytes(USDT),
        addressBytes(WSOL),
        addressBytes(USDC),
      ]);
      expect(got).toBe(expected);
    });
  });

  describe("warm repeat: every derivation resolves from the memo, zero fresh derives", () => {
    it("scale-common ata: a second pass over the same sample set is all hits", async () => {
      for (const { owner, mint, tokenProgram } of SAMPLES) {
        await scaleAta(owner, mint, tokenProgram);
      }
      const afterFirst = __pdaMemoStats();
      expect(afterFirst.misses).toBe(SAMPLES.length); // one fresh derive per distinct ATA
      expect(afterFirst.hits).toBe(0);

      for (const { owner, mint, tokenProgram } of SAMPLES) {
        await scaleAta(owner, mint, tokenProgram);
      }
      const afterSecond = __pdaMemoStats();
      expect(afterSecond.misses).toBe(afterFirst.misses); // zero fresh derivations on the repeat
      expect(afterSecond.hits).toBe(SAMPLES.length); // every derivation of the repeat was a memo hit
    });

    it("stabble-common findStabbleAta: a second pass over the same sample set is all hits", async () => {
      for (const { owner, mint } of SAMPLES) {
        await findStabbleAta(owner, mint);
      }
      const afterFirst = __pdaMemoStats();
      expect(afterFirst.misses).toBe(SAMPLES.length);
      expect(afterFirst.hits).toBe(0);

      for (const { owner, mint } of SAMPLES) {
        await findStabbleAta(owner, mint);
      }
      const afterSecond = __pdaMemoStats();
      expect(afterSecond.misses).toBe(afterFirst.misses);
      expect(afterSecond.hits).toBe(SAMPLES.length);
    });
  });

  describe("memoizedFindAssociatedTokenPda == @solana-program/token findAssociatedTokenPda", () => {
    it("is byte-identical to findAssociatedTokenPda for every sample", async () => {
      for (const { owner, mint, tokenProgram } of SAMPLES) {
        const got = await memoizedFindAssociatedTokenPda({ owner, mint, tokenProgram });
        const [expected] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
        expect(got).toBe(expected);
      }
    });

    it("a warm repeat of the same ATAs is all memo hits", async () => {
      for (const { owner, mint, tokenProgram } of SAMPLES) {
        await memoizedFindAssociatedTokenPda({ owner, mint, tokenProgram });
      }
      const afterFirst = __pdaMemoStats();
      expect(afterFirst.misses).toBe(SAMPLES.length);
      expect(afterFirst.hits).toBe(0);

      for (const { owner, mint, tokenProgram } of SAMPLES) {
        await memoizedFindAssociatedTokenPda({ owner, mint, tokenProgram });
      }
      const afterSecond = __pdaMemoStats();
      expect(afterSecond.misses).toBe(afterFirst.misses);
      expect(afterSecond.hits).toBe(SAMPLES.length);
    });
  });
});

/**
 * Kitchen PDA helpers + `buildAtaPrepend` go through the shared PDA memo
 * (src/svm/venues/pda-memo.ts). They run on every cook/swap build, so a raw derivation here is a
 * fresh SHA-256 bump-walk + on-curve check per request for an address that never changes.
 *
 *  (a) a SECOND call with the same inputs performs ZERO underlying derivations (`__pdaMemoStats()`
 *      counts misses, i.e. real `getProgramDerivedAddress` calls);
 *  (b) every result is byte-identical (address AND bump) to a direct, un-memoized derivation;
 *  (c) different inputs are different keys, never a stale hit.
 *
 * Fails on a tree where these helpers call kit's `getProgramDerivedAddress` directly: the memo
 * counters never move, so the first-call `misses` assertion is red.
 */
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  deriveCodeBufferPda,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  deriveProgramDataPda,
} from "../../src/svm/kitchen.js";
import { buildAtaPrepend } from "../../src/svm/prepends.js";
import { __pdaMemoStats, __resetPdaMemoForTest } from "../../src/svm/venues/pda-memo.js";

const KITCHEN = address("SauceYSPMs8xQnDxqmhmSYfKArxRmpnSeEMHUfhoP5g");
const OWNER = address("58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2");
const OTHER = address("9tXiuRRw7kbejLhZXtxDxYs2REe43uH2e7k1kocgdM9B");
const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SALT = new Uint8Array(32).fill(7);
const enc = getAddressEncoder();
const le64 = (n: bigint): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
};
const BPF_LOADER_UPGRADEABLE = address("BPFLoaderUpgradeab1e11111111111111111111111");

type Case = {
  name: string;
  run: () => Promise<{ address: Address; bump: number }>;
  direct: () => Promise<readonly [Address, number]>;
};

const CASES: Case[] = [
  {
    name: "derivePotPda",
    run: () => derivePotPda(KITCHEN, OWNER, SALT),
    direct: () =>
      getProgramDerivedAddress({
        programAddress: KITCHEN,
        seeds: ["pot", enc.encode(OWNER), SALT],
      }),
  },
  {
    name: "deriveExecutionFeeConfigPda",
    run: () => deriveExecutionFeeConfigPda(KITCHEN),
    direct: () => getProgramDerivedAddress({ programAddress: KITCHEN, seeds: ["execution_fee"] }),
  },
  {
    name: "deriveProgramDataPda",
    run: () => deriveProgramDataPda(KITCHEN),
    direct: () =>
      getProgramDerivedAddress({
        programAddress: BPF_LOADER_UPGRADEABLE,
        seeds: [enc.encode(KITCHEN)],
      }),
  },
  {
    name: "deriveCodeBufferPda",
    run: () => deriveCodeBufferPda(KITCHEN, OWNER, 5n),
    direct: () =>
      getProgramDerivedAddress({
        programAddress: KITCHEN,
        seeds: ["buffer", enc.encode(OWNER), le64(5n)],
      }),
  },
  {
    name: "deriveCodePda",
    run: () => deriveCodePda(KITCHEN, OTHER),
    direct: () =>
      getProgramDerivedAddress({ programAddress: KITCHEN, seeds: ["code", enc.encode(OTHER)] }),
  },
];

describe("Kitchen PDA helpers use the shared PDA memo", () => {
  for (const c of CASES) {
    it(`${c.name}: byte-identical to a direct derive; the second call derives nothing`, async () => {
      __resetPdaMemoForTest();
      const first = await c.run();
      expect(__pdaMemoStats().misses).toBe(1);
      const [addr, bump] = await c.direct();
      expect(first).toEqual({ address: addr, bump });
      const second = await c.run();
      expect(second).toEqual(first);
      expect(__pdaMemoStats().misses).toBe(1);
      expect(__pdaMemoStats().hits).toBe(1);
    });
  }

  it("different inputs are different keys (no stale hit)", async () => {
    __resetPdaMemoForTest();
    const a = await deriveCodeBufferPda(KITCHEN, OWNER, 1n);
    const b = await deriveCodeBufferPda(KITCHEN, OWNER, 2n);
    expect(b.address).not.toBe(a.address);
    expect(__pdaMemoStats().misses).toBe(2);
  });
});

describe("buildAtaPrepend uses the shared PDA memo", () => {
  it("is byte-identical to findAssociatedTokenPda; the second call derives nothing", async () => {
    __resetPdaMemoForTest();
    const payer = { address: OTHER } as never;
    const first = await buildAtaPrepend({ payer, owner: OWNER, mint: MINT });
    expect(__pdaMemoStats().misses).toBe(1);
    const [expected] = await findAssociatedTokenPda({
      owner: OWNER,
      mint: MINT,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    expect(first.ata).toBe(expected);
    await buildAtaPrepend({ payer, owner: OWNER, mint: MINT });
    expect(__pdaMemoStats().misses).toBe(1);
  });
});

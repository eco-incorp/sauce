/**
 * CPI-acceptance probe units (no engine, no RPC): the static screen and the
 * unrecognized-caller simulation lane that sort a venue into P-A / P-B / P-C.
 * The simulation is driven by a MOCK rpc returning canned simulate results
 * (accept / reject / degrade) — the classifier logic is exercised offline.
 */
import { address, generateKeyPairSigner, getBase64Decoder } from "@solana/kit";
import type { Instruction } from "@solana/kit";
import {
  INSTRUCTIONS_SYSVAR,
  classifyVenue,
  probeCpiAcceptance,
  staticCpiScreen,
} from "../../src/svm/index.js";

const USER = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const OUT_ATA = address("So11111111111111111111111111111111111111112");
const VENUE = address("obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y");

/** base64 of a 165-byte SPL token account with the given amount @64. */
function tokenB64(amount: bigint): string {
  const d = new Uint8Array(165);
  new DataView(d.buffer).setBigUint64(64, amount, true);
  d[108] = 1;
  return getBase64Decoder().decode(d);
}

/** A mock rpc: canned pre-balance + simulate result. */
function mockRpc(
  pre: bigint,
  sim: { err?: unknown; post?: bigint; unitsConsumed?: number; logs?: string[] },
) {
  return {
    getAccountInfo: () => ({ send: async () => ({ value: { data: [tokenB64(pre)] } }) }),
    simulateTransaction: () => ({
      send: async () => ({
        value: {
          err: sim.err ?? null,
          logs: sim.logs ?? [],
          unitsConsumed: sim.unitsConsumed,
          accounts: sim.post === undefined ? null : [{ data: [tokenB64(sim.post)] }],
        },
      }),
    }),
  } as any;
}

const dummyIx: Instruction = { programAddress: VENUE, accounts: [], data: new Uint8Array() };

describe("cpi-probe: static screen", () => {
  it("the Instructions sysvar ⇒ introspection ⇒ P-C", () => {
    const s = staticCpiScreen({
      accounts: [{ address: OUT_ATA }, { address: INSTRUCTIONS_SYSVAR }],
      userSigner: USER,
    });
    expect(s.introspects).toBe(true);
    expect(s.candidateTier).toBe("P-C");
  });

  it("a non-user signer ⇒ maker/oracle seat ⇒ P-C", () => {
    const maker = address("4zaRAseHRKTsdb4NNcLJogrLjUvQAobaNYuKebKPnWs");
    const s = staticCpiScreen({
      accounts: [
        { address: maker, signer: true },
        { address: USER, signer: true },
      ],
      userSigner: USER,
    });
    expect(s.foreignSigners).toEqual([maker]);
    expect(s.candidateTier).toBe("P-C");
  });

  it("a clean swap (only the user signs, no sysvar) ⇒ P-A candidate", () => {
    const s = staticCpiScreen({
      accounts: [{ address: OUT_ATA }, { address: USER, signer: true }],
      userSigner: USER,
    });
    expect(s.introspects).toBe(false);
    expect(s.foreignSigners).toEqual([]);
    expect(s.candidateTier).toBe("P-A");
  });
});

describe("cpi-probe: unrecognized-caller simulation", () => {
  it("ACCEPT: the simulation succeeds and credits output", async () => {
    const payer = await generateKeyPairSigner();
    const probe = await probeCpiAcceptance({
      rpc: mockRpc(0n, { post: 1000n, unitsConsumed: 42000 }),
      swapIx: dummyIx,
      payer,
      outAta: OUT_ATA,
    });
    expect(probe.verdict).toBe("accept");
    expect(probe.delta).toBe(1000n);
    expect(probe.cu).toBe(42000n);
  });

  it("REJECT: a custom program error (gated caller)", async () => {
    const payer = await generateKeyPairSigner();
    const probe = await probeCpiAcceptance({
      rpc: mockRpc(0n, {
        err: { InstructionError: [0, { Custom: 6001 }] },
        logs: ["unrecognized caller"],
      }),
      swapIx: dummyIx,
      payer,
      outAta: OUT_ATA,
    });
    expect(probe.verdict).toBe("reject");
    expect(probe.delta).toBe(0n);
    expect(probe.detail).toContain("6001");
  });

  it("REJECT: simulated but credited nothing", async () => {
    const payer = await generateKeyPairSigner();
    const probe = await probeCpiAcceptance({
      rpc: mockRpc(500n, { post: 500n }),
      swapIx: dummyIx,
      payer,
      outAta: OUT_ATA,
    });
    expect(probe.verdict).toBe("reject");
  });

  it("DEGRADE: succeeds but the fill is materially below the venue quote", async () => {
    const payer = await generateKeyPairSigner();
    const probe = await probeCpiAcceptance({
      rpc: mockRpc(0n, { post: 800n }),
      swapIx: dummyIx,
      payer,
      outAta: OUT_ATA,
      expectedOut: 1000n,
      degradeBps: 500, // floor 950 > 800 ⇒ degrade
    });
    expect(probe.verdict).toBe("degrade");
  });

  it("ACCEPT within tolerance: a fill just inside the degrade band", async () => {
    const payer = await generateKeyPairSigner();
    const probe = await probeCpiAcceptance({
      rpc: mockRpc(0n, { post: 960n }),
      swapIx: dummyIx,
      payer,
      outAta: OUT_ATA,
      expectedOut: 1000n,
      degradeBps: 500,
    });
    expect(probe.verdict).toBe("accept"); // 960 >= floor 950
  });
});

describe("cpi-probe: classifyVenue combines screen + verdict", () => {
  const cleanScreen = staticCpiScreen({
    accounts: [{ address: USER, signer: true }],
    userSigner: USER,
  });
  const introspectScreen = staticCpiScreen({
    accounts: [{ address: INSTRUCTIONS_SYSVAR }],
    userSigner: USER,
  });

  it("introspection is decisive P-C regardless of the sim", () => {
    expect(classifyVenue(introspectScreen, { verdict: "accept", delta: 100n }).tier).toBe("P-C");
  });

  it("clean + ACCEPT ⇒ P-A (public oracle) or P-B (internal oracle)", () => {
    expect(classifyVenue(cleanScreen, { verdict: "accept", delta: 1n }).tier).toBe("P-A");
    expect(
      classifyVenue(cleanScreen, { verdict: "accept", delta: 1n }, { internalOracle: true }).tier,
    ).toBe("P-B");
  });

  it("clean + REJECT/DEGRADE ⇒ P-C (degrade stays external-scan eligible)", () => {
    expect(classifyVenue(cleanScreen, { verdict: "reject", delta: 0n }).tier).toBe("P-C");
    const d = classifyVenue(cleanScreen, { verdict: "degrade", delta: 1n });
    expect(d.tier).toBe("P-C");
    expect(d.externalScanEligible).toBe(true);
  });

  it("clean with no sim verdict is a provisional P-A", () => {
    const c = classifyVenue(cleanScreen);
    expect(c.tier).toBe("P-A");
    expect(c.reasons.join(" ")).toContain("provisional");
  });
});

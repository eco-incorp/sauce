/**
 * cctp-split recipe — the "split a large USDC transfer into N sub-limit CCTP burns, atomically"
 * demo, compiled through the RUST compiler (`compile: { compiler: 'rs' }`).
 *
 * These are compile-and-structure assertions (no chain): they prove (i) the route body compiles
 * through RS, (ii) N chunks really are emitted (the depositForBurn selector appears N times in the
 * one program's bytecode), and (iii) the STITCHED build is exactly ONE intent with ONE cook call —
 * which is what makes it atomic (a V12Pot.cook runs the whole program in one tx, so any chunk's
 * revert reverts the lot) — versus the NAIVE build's N independent intents.
 */
import { bytesToHex, toFunctionSelector } from "viem";

import {
  CCTP_DOMAIN,
  buildCctpSplitIntent,
  buildNaiveCctpIntents,
  cctpSplitProgram,
  splitIntoChunks,
  type CctpSplitParams,
} from "../src/recipes/cctp-split.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // Base USDC
const TOKEN_MESSENGER = "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d"; // CCTP v2 TokenMessenger
const RECIPIENT = "0x000000000000000000000000000000000000abcd";
const POT = "0x1111111111111111111111111111111111111111";
const PORTAL = "0x2222222222222222222222222222222222222222";
const SOURCE_PORTAL = "0x8888888888888888888888888888888888888888";
const CREATOR = "0x3333333333333333333333333333333333333333";
const PROVER = "0x4444444444444444444444444444444444444444";

const DEPOSIT_FOR_BURN_SELECTOR = toFunctionSelector(
  "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
).slice(2); // strip 0x

function countSelector(bytecode: Uint8Array): number {
  const hex = bytesToHex(bytecode).slice(2);
  let count = 0;
  let from = 0;
  for (;;) {
    const at = hex.indexOf(DEPOSIT_FOR_BURN_SELECTOR, from);
    if (at === -1) break;
    count += 1;
    from = at + DEPOSIT_FOR_BURN_SELECTOR.length;
  }
  return count;
}

function params(overrides: Partial<CctpSplitParams> = {}): CctpSplitParams {
  return {
    sourceChain: "base",
    totalAmount: 2_000_000n, // $2 USDC (6 decimals)
    perMessageLimit: 1_000_000n, // $1 per-message cap -> forces a 2-way split
    usdc: USDC,
    tokenMessenger: TOKEN_MESSENGER,
    destinationDomain: CCTP_DOMAIN.arbitrum,
    mintRecipient: RECIPIENT,
    maxFeePerChunk: 100n,
    pot: POT,
    portal: PORTAL,
    sourcePortal: SOURCE_PORTAL,
    deadline: 2000n,
    rewardDeadline: 1000n,
    creator: CREATOR,
    prover: PROVER,
    reward: 0n,
    routeTokens: [{ token: USDC, amount: 2_000_000n }],
    ...overrides,
  };
}

describe("splitIntoChunks", () => {
  it("splits $2 into 2x$1 at a $1 cap", () => {
    expect(splitIntoChunks(2_000_000n, 1_000_000n)).toEqual([1_000_000n, 1_000_000n]);
  });
  it("carries a remainder as a final short chunk", () => {
    expect(splitIntoChunks(2_500_000n, 1_000_000n)).toEqual([1_000_000n, 1_000_000n, 500_000n]);
  });
  it("is a single chunk when under the cap", () => {
    expect(splitIntoChunks(500_000n, 1_000_000n)).toEqual([500_000n]);
  });
  it("rejects a zero/negative limit or total", () => {
    expect(() => splitIntoChunks(1n, 0n)).toThrow(/perMessageLimit/);
    expect(() => splitIntoChunks(0n, 1n)).toThrow(/totalAmount/);
  });
  it("rejects a split that would exceed MAX_CCTP_CHUNKS", () => {
    expect(() => splitIntoChunks(1_000n, 1n)).toThrow(/MAX_CCTP_CHUNKS/);
  });
});

describe("cctpSplitProgram", () => {
  it("emits one approve+depositForBurn pair per chunk and a trailing return", () => {
    const src = cctpSplitProgram([1_000_000n, 1_000_000n], params());
    expect(src.match(/\.approve\(/g)).toHaveLength(2);
    expect(src.match(/\.depositForBurn\(/g)).toHaveLength(2);
    expect(src.trimEnd().endsWith("return 0n;\n}")).toBe(true);
  });
});

describe("buildCctpSplitIntent — the STITCHED (atomic) build, via compiler:'rs'", () => {
  it("is exactly ONE intent with ONE cook call (this is what makes the split atomic)", () => {
    const built = buildCctpSplitIntent(params());
    expect(built.intents()).toHaveLength(1);
    expect(built.intent.route.calls).toHaveLength(1); // one V12Pot.cook -> one tx -> all-or-revert
  });

  it("compiles the burn program through RS to non-empty bytecode containing BOTH chunks", () => {
    const built = buildCctpSplitIntent(params());
    expect(built.compiled.bytecode.length).toBe(1);
    const bytecode = built.compiled.bytecode[0]!;
    expect(bytecode.length).toBeGreaterThan(0);
    // Both depositForBurn calls are really in the one program.
    expect(countSelector(bytecode)).toBe(2);
  });

  it("scales chunk count with the amount: $4 at a $1 cap emits 4 burns in the one program", () => {
    const two = buildCctpSplitIntent(params());
    const four = buildCctpSplitIntent(params({ totalAmount: 4_000_000n }));
    expect(countSelector(four.compiled.bytecode[0]!)).toBe(4);
    expect(four.intents()).toHaveLength(1); // STILL one atomic intent
    expect(four.compiled.bytecode[0]!.length).toBeGreaterThan(two.compiled.bytecode[0]!.length);
  });

  it("produces a fundable/publishable intent (portal submission surface works)", () => {
    const built = buildCctpSplitIntent(params());
    expect(built.hash().intentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(built.publishCalldata().to.toLowerCase()).toBe(SOURCE_PORTAL.toLowerCase());
    expect(built.destination.slug).toBe("base"); // burn is fulfilled locally on the source chain
    expect(built.source.slug).toBe("base");
  });
});

describe("buildNaiveCctpIntents — the NON-atomic baseline (for contrast)", () => {
  it("is N INDEPENDENT intents (one burn each) with distinct hashes", () => {
    const naive = buildNaiveCctpIntents(params());
    expect(naive).toHaveLength(2);
    for (const intent of naive) {
      expect(intent.intent.route.calls).toHaveLength(1);
      expect(countSelector(intent.compiled.bytecode[0]!)).toBe(1); // exactly one burn per intent
    }
    // Distinct intents (different salt -> different hash) — they settle separately, NOT atomically.
    expect(naive[0]!.hash().intentHash).not.toBe(naive[1]!.hash().intentHash);
  });

  it("contrast: the stitched build is ONE intent, the naive build is TWO", () => {
    expect(buildCctpSplitIntent(params()).intents()).toHaveLength(1);
    expect(buildNaiveCctpIntents(params())).toHaveLength(2);
  });
});

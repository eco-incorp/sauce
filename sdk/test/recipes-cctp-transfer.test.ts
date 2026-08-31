/**
 * cctp-transfer demo — Base→Arbitrum USDC, with CCTP and without. The route PROGRAMS are standalone
 * `.sauce.ts` assets (`cctp-split.sauce.ts` / `plain-transfer.sauce.ts`) whose parameterized `main`
 * is baked with this intent's values as compile-time `args` (the `settle.sauce.ts` mechanism — a TS
 * compiler feature; RS binds entry params by runtime-decode instead). The point of these assertions:
 * the programs are DSL-native (USDC + Cctp.TokenMessenger resolve from the registries), and the CCTP
 * variant is ONE atomic cook.
 */
import { bytesToHex, toFunctionSelector } from "viem";

import { buildCctpSplitTransfer, buildPlainTransfer, type CctpTransferParams } from "../src/recipes/cctp-transfer.js";

const RECIPIENT = "0x000000000000000000000000000000000000abcd";
const POT = "0x1111111111111111111111111111111111111111";
const PORTAL = "0x2222222222222222222222222222222222222222";
const CREATOR = "0x3333333333333333333333333333333333333333";
const PROVER = "0x4444444444444444444444444444444444444444";

const DEPOSIT_FOR_BURN = toFunctionSelector(
  "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
).slice(2);

function params(over: Partial<CctpTransferParams> = {}): CctpTransferParams {
  return {
    from: "base",
    to: "arbitrum",
    amount: 2_000_000n, // $2 USDC
    perMessageLimit: 1_000_000n, // $1 cap -> 2 chunks
    recipient: RECIPIENT,
    pot: POT,
    portal: PORTAL,
    deadline: 2000n,
    creator: CREATOR,
    prover: PROVER,
    reward: 0n,
    ...over,
  };
}

describe("cctp-transfer — Base→Arbitrum, DSL-native (no hardcoded ABIs/addresses)", () => {
  it("WITH CCTP: one atomic intent; the route burns the split, compiled from the DSL accessor", () => {
    const built = buildCctpSplitTransfer(params());
    expect(built.intents()).toHaveLength(1);
    expect(built.intent.route.calls).toHaveLength(1); // one V12Pot.cook -> atomic all-or-revert
    const bytecode = built.compiled.bytecode[0]!;
    expect(bytecode.length).toBeGreaterThan(0);
    // depositForBurn is really in the bytecode — proving Cctp.TokenMessenger resolved to a real call,
    // not a hardcoded inline ABI.
    expect(bytesToHex(bytecode).slice(2).includes(DEPOSIT_FOR_BURN)).toBe(true);
    // fulfilled locally on the source chain (CCTP delivers to the destination asynchronously)
    expect(built.destination.slug).toBe("base");
    expect(built.source.slug).toBe("base");
  });

  it("WITHOUT CCTP: a plain cross-chain USDC transfer baseline compiles (destination = arbitrum)", () => {
    const built = buildPlainTransfer(params());
    expect(built.intent.route.calls).toHaveLength(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
    expect(built.destination.slug).toBe("arbitrum");
    expect(built.source.slug).toBe("base");
  });

  it("a non-even amount builds atomically — the SCRIPT handles the remainder, no divisibility assumption", () => {
    // $2.50 at a $1 cap -> $1 + $1 + $0.50, split on-chain. The builder used to REJECT this ("must be
    // a multiple of perMessageLimit"); it now just hands the script `amount` + `chunkSize`.
    const built = buildCctpSplitTransfer(params({ amount: 2_500_000n }));
    expect(built.intents()).toHaveLength(1);
    expect(built.intent.route.calls).toHaveLength(1); // one atomic V12Pot.cook
    expect(bytesToHex(built.compiled.bytecode[0]!).slice(2).includes(DEPOSIT_FOR_BURN)).toBe(true);
  });

  it("splits at RUNTIME: ONE loop site plus a remainder site, never one per chunk", () => {
    // 2.5 chunks' worth: the program carries exactly two depositForBurn call sites — the loop body
    // and the remainder burn — so the burns are driven by a loop, not unrolled per chunk.
    const built = buildCctpSplitTransfer(params({ amount: 2_500_000n }));
    const hex = bytesToHex(built.compiled.bytecode[0]!).slice(2);
    expect(hex.split(DEPOSIT_FOR_BURN).length - 1).toBe(2);
  });

  it("an evenly divisible amount drops the remainder burn entirely (the branch is dead at compile time)", () => {
    // `amount % chunkSize` folds to 0 from the compile-time defines, so `if (remainder > 0n)` is
    // provably false and the second call site is not emitted at all.
    const built = buildCctpSplitTransfer(params({ amount: 10_000_000n }));
    const hex = bytesToHex(built.compiled.bytecode[0]!).slice(2);
    expect(hex.split(DEPOSIT_FOR_BURN).length - 1).toBe(1);
  });

  it("a sub-cap amount builds too (count = 0, just the remainder burn)", () => {
    const built = buildCctpSplitTransfer(params({ amount: 500_000n })); // $0.50 < $1 cap
    expect(built.intent.route.calls).toHaveLength(1);
    expect(bytesToHex(built.compiled.bytecode[0]!).slice(2).includes(DEPOSIT_FOR_BURN)).toBe(true);
  });

  it("rejects a non-positive amount or per-message limit", () => {
    expect(() => buildCctpSplitTransfer(params({ amount: 0n }))).toThrow(/must be > 0/);
    expect(() => buildCctpSplitTransfer(params({ perMessageLimit: 0n }))).toThrow(/must be > 0/);
  });
});

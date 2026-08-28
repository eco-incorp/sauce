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

  it("handles a non-even split: full chunks PLUS a remainder burn — the whole amount moves, no truncation", () => {
    // $2.50 at a $1 cap -> 2×$1 full burns + one $0.50 remainder burn. Previously this threw
    // ("must be a multiple of perMessageLimit"); it must now build atomically instead of dropping $0.50.
    const built = buildCctpSplitTransfer(params({ amount: 2_500_000n }));
    expect(built.intents()).toHaveLength(1);
    expect(built.intent.route.calls).toHaveLength(1); // still ONE atomic V12Pot.cook
    const hex = bytesToHex(built.compiled.bytecode[0]!).slice(2);
    // Two depositForBurn call sites compile in: the loop body + the guarded remainder burn — so the
    // remainder is accounted for in the program, not silently truncated.
    expect(hex.split(DEPOSIT_FOR_BURN).length - 1).toBe(2);
  });

  it("an exact multiple still builds (remainder guard is skipped at runtime)", () => {
    const built = buildCctpSplitTransfer(params({ amount: 2_000_000n })); // $2 at $1 cap -> 2×$1, no remainder
    expect(built.intent.route.calls).toHaveLength(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("bakes the actual remainder VALUE into the program (not always zero)", () => {
    // Both amounts give count = 2 full $1 chunks; they differ ONLY in the remainder ($0 vs $0.50).
    // So a byte difference proves the remainder is a real baked input, not silently dropped/zeroed.
    const even = bytesToHex(buildCctpSplitTransfer(params({ amount: 2_000_000n })).compiled.bytecode[0]!);
    const odd = bytesToHex(buildCctpSplitTransfer(params({ amount: 2_500_000n })).compiled.bytecode[0]!);
    expect(odd).not.toBe(even);
  });

  it("rejects a non-positive amount or per-message limit", () => {
    expect(() => buildCctpSplitTransfer(params({ amount: 0n }))).toThrow(/must be > 0/);
    expect(() => buildCctpSplitTransfer(params({ perMessageLimit: 0n }))).toThrow(/must be > 0/);
  });
});

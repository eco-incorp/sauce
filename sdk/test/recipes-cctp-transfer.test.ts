/**
 * cctp-transfer demo — Base→Arbitrum USDC, with CCTP and without, compiled through the RUST compiler.
 * The point of these assertions: the route bodies are DSL-native (USDC + Cctp.TokenMessenger resolve
 * from the registries), and the CCTP variant is ONE atomic cook.
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

  it("rejects a non-even split (step-one demo splits into equal sub-limit chunks)", () => {
    expect(() => buildCctpSplitTransfer(params({ amount: 2_500_000n }))).toThrow(/multiple of perMessageLimit/);
  });
});

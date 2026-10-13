/**
 * `sauce send`'s reading of what it is given, before any endpoint: the chain each signed
 * transaction names, and the refusals — transactions signed for different chains in one call, a
 * legacy transaction that names no chain, bytes that are no transaction.
 */
import { serializeTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { signedChain } from "../src/cli/send.js";

/** A throwaway signer: the signatures are real, the key is the test's alone. */
const signer = privateKeyToAccount(`0x${"42".repeat(32)}`);
const RECIPIENT = "0x6666666666666666666666666666666666666666";

const signed = (chainId: number): Promise<Hex> =>
  signer.signTransaction({
    chainId,
    type: "eip1559",
    to: RECIPIENT,
    value: 0n,
    nonce: 0,
    gas: 21_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
  });

describe("the chain a send is for", () => {
  it("is the chain each EVM transaction was signed for", async () => {
    expect(signedChain([await signed(8453), await signed(8453)]).slug).toBe("base");
  });

  it("refuses transactions signed for different chains in one call", async () => {
    const [ethereum, base] = [await signed(1), await signed(8453)];
    expect(() => signedChain([ethereum, base])).toThrow(
      /the transactions are for base, not ethereum: send each chain's in a call of its own/,
    );
    expect(() => signedChain([base], requireChain("ethereum"))).toThrow(
      /the transactions are for base, not ethereum/,
    );
  });

  it("needs the chain for a legacy transaction signed without a chain id", async () => {
    const legacy = await signer.signTransaction({
      type: "legacy",
      to: RECIPIENT,
      value: 0n,
      nonce: 0,
      gas: 21_000n,
      gasPrice: 1n,
    });
    expect(() => signedChain([legacy])).toThrow(/names no chain/);
    expect(signedChain([legacy], requireChain("base")).slug).toBe("base");
  });

  it("is Solana for a base64 wire transaction, and refuses what is neither", () => {
    expect(signedChain(["AQABAgM="]).slug).toBe("solana");
    expect(() => signedChain(["not a transaction!"])).toThrow(/is not a signed transaction/);
    expect(() =>
      signedChain([serializeTransaction({ chainId: 1, type: "eip1559", to: RECIPIENT })]),
    ).not.toThrow();
    expect(() => signedChain([])).toThrow(/missing the signed transactions/);
  });
});

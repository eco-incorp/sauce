/**
 * `sauce send`'s reading of what it is given, before any endpoint: the chain each signed
 * transaction names, and the refusals — transactions signed for different chains in one call, a
 * legacy transaction that names no chain, bytes that are no transaction, and a Solana transaction
 * whose signatures are not all there (none, fewer than its message's signers, or not its fee
 * payer's), each refused by name before anything is read.
 */
import { serializeTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { sendCommand, signedChain } from "../src/cli/send.js";

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
    expect(signedChain({ transactions: [await signed(8453), await signed(8453)] }).slug).toBe(
      "base",
    );
  });

  it("refuses transactions signed for different chains in one call", async () => {
    const [ethereum, base] = [await signed(1), await signed(8453)];
    expect(() => signedChain({ transactions: [ethereum, base] })).toThrow(
      /the transactions are for base, not ethereum: send each chain's in a call of its own/,
    );
    expect(() => signedChain({ transactions: [base] }, requireChain("ethereum"))).toThrow(
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
    expect(() => signedChain({ transactions: [legacy] })).toThrow(/names no chain/);
    expect(signedChain({ transactions: [legacy] }, requireChain("base")).slug).toBe("base");
  });

  it("is Solana for a base64 wire transaction, and refuses what is neither", () => {
    expect(signedChain({ transactions: ["AQABAgM="] }).slug).toBe("solana");
    expect(() => signedChain({ transactions: ["not a transaction!"] })).toThrow(
      /is not a signed transaction/,
    );
    expect(() =>
      signedChain({
        transactions: [serializeTransaction({ chainId: 1, type: "eip1559", to: RECIPIENT })],
      }),
    ).not.toThrow();
    expect(() => signedChain({ transactions: [] })).toThrow(/missing the signed transactions/);
  });
});

/** A legacy Solana wire transaction: `signatures` (64 bytes each, a zero one unsigned), then a
 *  message of `signers` signing accounts among `keys`, no instruction. */
const solanaWire = (signatures: readonly number[], signers: number, keys: number): string =>
  Buffer.from([
    signatures.length,
    ...signatures.flatMap((fill) => Array<number>(64).fill(fill)),
    ...[signers, 0, 0],
    keys,
    ...Array.from({ length: keys }, (_, index) => Array<number>(32).fill(index + 1)).flat(),
    ...Array<number>(32).fill(9),
    0,
  ]).toString("base64");

describe("a Solana transaction whose signatures are not all there", () => {
  // Refused before the endpoint, which is not there to reach.
  const send = (transaction: string) =>
    sendCommand({
      chain: requireChain("solana"),
      rpcUrl: "http://127.0.0.1:9/",
      transactions: [transaction],
    });

  it("refuses one with no signer at all: it names no fee payer", async () => {
    await expect(send(solanaWire([], 0, 1))).rejects.toThrow(
      /transaction 1 has no signer, so no fee payer: a Solana transaction is signed by at least its fee payer/,
    );
  });

  it("refuses one carrying fewer signatures than its message's signers", async () => {
    await expect(send(solanaWire([7], 2, 2))).rejects.toThrow(
      /transaction 1 carries 1 signature, and its message has 2 signers \(\S+, \S+\): sign it with each/,
    );
    await expect(send(solanaWire([], 1, 1))).rejects.toThrow(
      /transaction 1 carries no signature, and its message has 1 signer/,
    );
  });

  it("refuses one its fee payer did not sign, by name", async () => {
    await expect(send(solanaWire([0, 7], 2, 2))).rejects.toThrow(
      /transaction 1 is not signed by its fee payer \S+: sign it with your wallet or signer first/,
    );
  });
});

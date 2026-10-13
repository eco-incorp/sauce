/**
 * `sauce send`'s reading of what it is given, before any endpoint: the chain each signed
 * transaction names, and the refusals — transactions signed for different chains in one call, a
 * legacy transaction that names no chain, bytes that are no transaction, a blob transaction and a
 * contract creation, and a Solana transaction whose signatures are not all there (none, fewer than
 * its message's signers, or not its fee payer's), each refused by name before anything is read.
 * And the wait for a transaction read back: mined, gone (missing twice in a row, not once), or still
 * pending when the wait runs out. And a plan's next step that cannot be built once something was
 * sent: what was sent stands, with the cursor to ask again; with nothing sent, the failure is the
 * answer.
 */
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address as SvmAddress,
  type Blockhash,
} from "@solana/kit";
import { serializeTransaction, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { minedOrGone, sendCommand, signedChain } from "../src/cli/send.js";
import { decodeCursor, encodeCursor, type SvmPlan } from "../src/cli/svm-plan.js";

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

describe("an EVM transaction sauce send does not broadcast", () => {
  const send = (transaction: Hex) =>
    sendCommand({
      chain: requireChain("ethereum"),
      rpcUrl: "http://127.0.0.1:9/",
      transactions: [transaction],
    });
  const fees = { nonce: 0, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n } as const;

  it("refuses a blob transaction, before the endpoint", async () => {
    const blob = await signer.signTransaction({
      ...fees,
      chainId: 1,
      type: "eip4844",
      to: RECIPIENT,
      value: 0n,
      gas: 21_000n,
      maxFeePerBlobGas: 1n,
      blobVersionedHashes: [`0x01${"00".repeat(31)}`],
    });
    await expect(send(blob)).rejects.toThrow(
      /transaction 1 carries blobs, which sauce send does not broadcast/,
    );
  });

  it("refuses a contract creation, before the endpoint", async () => {
    const creation = await signer.signTransaction({
      ...fees,
      chainId: 1,
      type: "eip1559",
      data: "0x6000",
      value: 0n,
      gas: 100_000n,
    });
    await expect(send(creation)).rejects.toThrow(
      /transaction 1 creates a contract; sauce send broadcasts calls/,
    );
  });
});

describe("the wait for a transaction read back", () => {
  const HASH: Hex = `0x${"ab".repeat(32)}`;
  /** A client whose chain answers each poll from `polls`: mined, pending, or not there. */
  const client = (polls: Array<"mined" | "pending" | "missing">): PublicClient => {
    let at = 0;
    const next = () => polls[Math.min(at++, polls.length - 1)]!;
    let now: "mined" | "pending" | "missing" = "pending";

    return {
      getTransactionReceipt: async () => {
        now = next();
        if (now !== "mined") throw new Error("no receipt");

        return {};
      },
      getTransaction: async () => {
        if (now === "missing") throw new Error("not found");

        return {};
      },
    } as unknown as PublicClient;
  };
  const quick = { pollMs: 1 };

  it("returns once it is mined", async () => {
    await expect(
      minedOrGone(client(["pending", "pending", "mined"]), HASH, "the cook", quick),
    ).resolves.toBeUndefined();
  });

  it("says it is gone once it is missing twice in a row, and not when it comes back", async () => {
    await expect(
      minedOrGone(client(["pending", "missing", "missing"]), HASH, "the cook", quick),
    ).rejects.toThrow(new RegExp(`the cook ${HASH} was seen, then not found: reorged or dropped`));
    // Missing once, between two backends that disagree, is not gone.
    await expect(
      minedOrGone(client(["missing", "pending", "missing", "mined"]), HASH, "the cook", quick),
    ).resolves.toBeUndefined();
  });

  it("says it is still pending when the wait runs out, and that it was not sent again", async () => {
    await expect(
      minedOrGone(client(["pending"]), HASH, "the cook", { pollMs: 1, mostMs: 20 }),
    ).rejects.toThrow(
      new RegExp(`the cook ${HASH} is still pending after 0.02 seconds; it was not sent again`),
    );
  });
});

describe("a plan's next step that cannot be built once something was sent", () => {
  const URL = "http://endpoint.invalid/secret-key";
  const key = (fill: number, bytes = 32): string =>
    getBase58Decoder().decode(new Uint8Array(bytes).fill(fill));
  const OWNER = key(7) as SvmAddress;
  const SIGNATURE = key(5, 64);
  /** A plan whose cook was handed out: its next step reads the block height first. */
  const plan: SvmPlan = {
    owner: OWNER,
    salt: `0x${"11".repeat(32)}`,
    via: "kitchen",
    tail: [],
    lookupTables: [],
    pot: "there",
    tokenAccounts: [],
    payload: new Uint8Array([1, 2, 3]),
    labels: [],
    cook: { blockhash: key(10), lastValidBlockHeight: 100n, slot: 1_000n },
  };
  /** A transaction of the owner's that is not the cook, landed. */
  const landed = getBase64EncodedWireTransaction(
    compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (message) => setTransactionMessageFeePayer(OWNER, message),
        (message) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: key(11) as Blockhash, lastValidBlockHeight: 1n },
            message,
          ),
        (message) =>
          appendTransactionMessageInstruction(
            {
              programAddress: address("11111111111111111111111111111111"),
              data: new Uint8Array([2, 0, 0, 0]),
            },
            message,
          ),
      ),
    ),
  );
  const answers: Record<string, unknown> = {
    getSignatureStatuses: {
      context: { slot: 1_001 },
      value: [{ slot: 1_001, confirmations: null, err: null, confirmationStatus: "confirmed" }],
    },
    getTransaction: {
      slot: 1_001,
      blockTime: null,
      transaction: [landed, "base64"],
      meta: { err: null, fee: 5_000, logMessages: [], computeUnitsConsumed: 150 },
    },
  };
  const original = globalThis.fetch;
  beforeAll(() => {
    // The endpoint answers the confirmation and the read back, and fails what the next step asks.
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      if (String(input) !== URL) return original(input as string, init as RequestInit);
      const { id, method } = JSON.parse(init!.body!) as { id: unknown; method: string };

      return method in answers
        ? Response.json({ jsonrpc: "2.0", id, result: answers[method] })
        : Response.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: `${method} is down at ${URL}` },
          });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = original;
  });
  const solana = requireChain("solana");

  it("keeps what was sent, and hands back the cursor to ask again", async () => {
    const output = await sendCommand({
      chain: solana,
      rpcUrl: URL,
      transactions: [],
      signatures: [SIGNATURE],
      cursor: encodeCursor(plan),
    });
    const json = output.json as {
      ok: boolean;
      sent: Array<{ hash: string; status: string }>;
      next: { step: string; cursor: string; notes: string[] };
    };
    expect(json.ok).toBe(true);
    expect(json.sent.map((one) => [one.hash, one.status])).toEqual([[SIGNATURE, "success"]]);
    expect(json.next.step).toBe("unknown");
    expect(decodeCursor(json.next.cursor)).toEqual(plan);
    expect(json.next.notes).toEqual([
      "the next step could not be built: reading the block height failed: JSON-RPC error: " +
        "Internal JSON-RPC error (getBlockHeight is down at <RPC_URL>); send the cursor alone to " +
        "ask again",
    ]);
    expect(output.notes).toEqual(json.next.notes);
    expect(JSON.stringify(output)).not.toContain(URL);
  });

  it("fails as the next step does, with nothing sent", async () => {
    const asked = sendCommand({
      chain: solana,
      rpcUrl: URL,
      transactions: [],
      cursor: encodeCursor(plan),
    });
    await expect(asked).rejects.toThrow(
      "reading the block height failed: JSON-RPC error: Internal JSON-RPC error (getBlockHeight " +
        "is down at <RPC_URL>)",
    );
  });
});

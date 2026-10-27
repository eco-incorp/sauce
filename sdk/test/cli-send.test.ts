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
  AccountRole,
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
import { parseTransaction, serializeTransaction, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { sendAndWait, simulate, type SignedCall } from "../src/cli/chain.js";
import { minedOrGone, sendCommand, signedChain } from "../src/cli/send.js";
import { decodeCursor, encodeCursor, type SvmPlan } from "../src/cli/svm-plan.js";
import { v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { derivePotPda, KITCHEN_DISCRIMINATORS } from "../src/svm/index.js";
import { releasedProgramAccounts, type RpcAccount } from "./svm/release-accounts.js";

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

  it("is the SVM chain given, else the plan's, else Solana's, for what names no cluster", async () => {
    const [solana, devnet] = [requireChain("solana"), requireChain("solana-devnet")];
    const cursorOn = (chain: CanonicalChain): string =>
      encodeCursor({
        chain,
        owner: getBase58Decoder().decode(new Uint8Array(32).fill(7)) as SvmAddress,
        salt: `0x${"11".repeat(32)}`,
        via: "kitchen",
        tail: [],
        lookupTables: [],
        pot: "there",
        tokenAccounts: [],
        payload: new Uint8Array([1]),
        labels: [],
      });
    const signature = getBase58Decoder().decode(new Uint8Array(64).fill(5));
    // A Solana transaction or a signature names no cluster: the SVM chain given, else Solana's.
    expect(signedChain({ transactions: ["AQABAgM="] }, devnet).slug).toBe("solana-devnet");
    expect(signedChain({ transactions: [], signatures: [signature] }, devnet).slug).toBe(
      "solana-devnet",
    );
    expect(signedChain({ transactions: [], signatures: [signature] }).slug).toBe("solana");
    // A plan's cursor names the chain it was made for, and what is sent with it is on that chain.
    expect(signedChain({ transactions: ["AQABAgM="], cursor: cursorOn(devnet) }).slug).toBe(
      "solana-devnet",
    );
    expect(signedChain({ transactions: [], cursor: cursorOn(solana) }).slug).toBe("solana");
    expect(() => signedChain({ transactions: [], cursor: cursorOn(devnet) }, solana)).toThrow(
      "the plan's cursor is solana-devnet's, not solana's",
    );
    expect(() =>
      signedChain({ transactions: ["AQABAgM="], cursor: cursorOn(solana) }, devnet),
    ).toThrow("the plan's cursor is solana's, not solana-devnet's");
    expect(() =>
      signedChain({ transactions: [], cursor: cursorOn(solana) }, requireChain("base")),
    ).toThrow("a plan's cursor and a signature are Solana's, not base's");
    // Sent on another chain than its own, a plan is refused before any endpoint is reached.
    await expect(
      sendCommand({
        chain: solana,
        rpcUrl: "http://127.0.0.1:9/",
        transactions: [],
        cursor: cursorOn(devnet),
      }),
    ).rejects.toThrow("the plan's cursor is solana-devnet's, not solana's");
  });

  // solana-devnet is a supported chain: a signed Solana transaction sent there passes the support
  // gate and goes on to the endpoint, where (nothing listening) it fails, sending nothing.
  it("lets a signed send on solana-devnet past the support gate", async () => {
    const sent = sendCommand({
      chain: requireChain("solana-devnet"),
      rpcUrl: "http://127.0.0.1:9/",
      transactions: [solanaWire([1], 1, 2)],
    });
    await expect(sent).rejects.toThrow();
    await expect(sent).rejects.not.toThrow(/preview chain|is refused/);
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

describe("an EVM transaction under the chain's minimum base fee", () => {
  const arc = requireChain("arc");
  const send = (transaction: Hex) =>
    sendCommand({ chain: arc, rpcUrl: "http://127.0.0.1:9/", transactions: [transaction] });
  const call = { chainId: arc.id, nonce: 0, to: RECIPIENT, value: 0n, gas: 21_000n } as const;

  it("is refused before the endpoint, its fee cap and Arc's 20 gwei named", async () => {
    const under = await signer.signTransaction({
      ...call,
      type: "eip1559",
      maxFeePerGas: 19_000_000_000n,
      maxPriorityFeePerGas: 0n,
    });
    await expect(send(under)).rejects.toThrow(
      /transaction 1 is signed with a fee cap of 19 gwei, below arc's minimum base fee of 20 gwei, so it would never be included: sign it again with a maxFeePerGas of at least 20 gwei/,
    );
    const legacy = await signer.signTransaction({ ...call, type: "legacy", gasPrice: 1n });
    await expect(send(legacy)).rejects.toThrow(/a fee cap of 0.000000001 gwei, below arc's/);
    // At the floor it goes on, to the endpoint, which is not there.
    const at = await signer.signTransaction({
      ...call,
      type: "eip1559",
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 0n,
    });
    await expect(send(at)).rejects.not.toThrow(/minimum base fee/);
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
    chain: requireChain("solana"),
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
  /** A transaction of the owner's, landed: a call that is not a cook, or a cook on `pot`. */
  const ownerTransaction = (pot?: SvmAddress): string =>
    getBase64EncodedWireTransaction(
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
              pot === undefined
                ? {
                    programAddress: address("11111111111111111111111111111111"),
                    data: new Uint8Array([2, 0, 0, 0]),
                  }
                : {
                    programAddress: address(v12SvmKitchenProgramId()),
                    // The Kitchen's cook names the Pot third.
                    accounts: [
                      { address: OWNER, role: AccountRole.WRITABLE_SIGNER },
                      { address: key(12) as SvmAddress, role: AccountRole.READONLY },
                      { address: pot, role: AccountRole.WRITABLE },
                    ],
                    data: new Uint8Array([...KITCHEN_DISCRIMINATORS.cook, ...new Uint8Array(40)]),
                  },
              message,
            ),
        ),
      ),
    );
  const landed = ownerTransaction();
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
  beforeAll(async () => {
    // A cluster running the release, as the check before each step reads it.
    const released: Record<string, RpcAccount> = await releasedProgramAccounts();
    // The endpoint answers the confirmation and the read back, and fails what the next step asks.
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      if (String(input) !== URL) return original(input as string, init as RequestInit);
      const { id, method, params } = JSON.parse(init!.body!) as {
        id: unknown;
        method: string;
        params: unknown[];
      };
      const program = method === "getAccountInfo" ? released[String(params[0])] : undefined;
      if (program !== undefined) {
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: { context: { slot: 1_001 }, value: program },
        });
      }

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

  const confirm = async (transaction: string, carried: SvmPlan) => {
    answers.getTransaction = {
      slot: 1_001,
      blockTime: null,
      transaction: [transaction, "base64"],
      meta: { err: null, fee: 5_000, logMessages: [], computeUnitsConsumed: 150 },
    };
    const output = await sendCommand({
      chain: solana,
      rpcUrl: URL,
      transactions: [],
      signatures: [SIGNATURE],
      cursor: encodeCursor(carried),
    });

    return (output.json as { next: { step: string; cursor?: string } }).next;
  };
  const { cook: _, ...fresh } = plan;
  const pot = async () =>
    (await derivePotPda(address(v12SvmKitchenProgramId()), OWNER, new Uint8Array(32).fill(0x11)))
      .address;

  it("learns how its own cook went from the cook's signature", async () => {
    const next = await confirm(ownerTransaction(await pot()), fresh);
    // It ran: nothing is left to build or close.
    expect(next.step).toBe("done");
  });

  it("learns nothing from a cook on another Pot, given beside its cursor", async () => {
    const next = await confirm(ownerTransaction(key(13) as SvmAddress), fresh);
    expect(next.step).toBe("unknown");
    expect(decodeCursor(next.cursor!).cooked).toBeUndefined();
  });
});

describe("the simulation of a transaction signed elsewhere", () => {
  const to = "0x5555555555555555555555555555555555555555";
  const from = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  /** A client whose `eth_call` and gas estimate answer, recording the arguments each was sent. */
  const recording = (estimate: bigint) => {
    const calls: Array<Record<string, unknown>> = [];
    const estimates: Array<Record<string, unknown>> = [];
    const client = {
      call: async (args: Record<string, unknown>) => {
        calls.push(args);

        return { data: "0x01" };
      },
      estimateGas: async (args: Record<string, unknown>) => {
        estimates.push(args);

        return estimate;
      },
    } as unknown as PublicClient;

    return { client, calls, estimates };
  };
  const FIELDS = ["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"];
  /** The gas and fee fields `args` carries, as strings: a failing BigInt comparison crashes jest. */
  const carried = (args: Record<string, unknown>) =>
    Object.fromEntries(
      FIELDS.filter((field) => args[field] !== undefined).map((f) => [f, String(args[f])]),
    );

  it("runs with the gas and the fees it was signed with, as an EIP-1559 transaction", async () => {
    const { client, calls, estimates } = recording(100_000n);
    const signedCall: SignedCall = {
      to,
      data: "0x1234",
      value: 0n,
      gas: 240_000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    };
    const result = await simulate(client, from, signedCall);

    expect({
      ok: result.ok,
      call: carried(calls[0]!),
      // The estimate is of what it needs: it carries neither the signed gas nor the fees.
      estimate: carried(estimates[0]!),
    }).toEqual({
      ok: true,
      call: { gas: "240000", maxFeePerGas: "3000000000", maxPriorityFeePerGas: "1000000000" },
      estimate: {},
    });
  });

  it("runs with the gas price it was signed with, as a legacy transaction, mixing no fee kinds", async () => {
    const { client, calls } = recording(100_000n);
    const signedCall: SignedCall = {
      to,
      data: "0x",
      value: 1n,
      gas: 120_000n,
      gasPrice: 7_000_000_000n,
    };
    await simulate(client, from, signedCall);

    expect(carried(calls[0]!)).toEqual({ gas: "120000", gasPrice: "7000000000" });
  });

  it("runs a gas limit below what it needs without that limit, leaving its refusal to the sender", async () => {
    // The signed limit is short of the estimate: the call would only fail out of gas, and say so
    // as a revert. The estimate is what the caller refuses it with, naming both.
    const { client, calls } = recording(100_000n);
    const signedCall: SignedCall = {
      to,
      data: "0x",
      value: 0n,
      gas: 50_000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    };
    const result = await simulate(client, from, signedCall);

    expect({ ok: result.ok, gas: result.ok ? String(result.gas) : undefined }).toEqual({
      ok: true,
      gas: "100000",
    });
    expect(carried(calls[0]!)).toEqual({
      maxFeePerGas: "3000000000",
      maxPriorityFeePerGas: "1000000000",
    });
  });

  it("runs a plain call with neither gas nor fees", async () => {
    const { client, calls, estimates } = recording(100_000n);
    await simulate(client, from, { to, data: "0x", value: 0n });

    expect([carried(calls[0]!), carried(estimates[0]!)]).toEqual([{}, {}]);
  });
});

describe("a signed transaction the endpoint refuses", () => {
  const URL = "http://endpoint.invalid/refusing-key";
  const to = "0x5555555555555555555555555555555555555555";
  let refusal = "";
  const received: Hex[] = [];
  const original = globalThis.fetch;
  beforeAll(() => {
    // An endpoint that prepares the transaction (chain, nonce, fees) and refuses its broadcast with
    // the node's own words, as JSON-RPC error -32000.
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      if (String(input) !== URL) return original(input as string, init as RequestInit);
      const { id, method, params } = JSON.parse(init!.body!) as {
        id: unknown;
        method: string;
        params: unknown[];
      };
      const results: Record<string, unknown> = {
        eth_chainId: "0x1",
        eth_getTransactionCount: "0x5",
        eth_maxPriorityFeePerGas: "0x3b9aca00",
        // `sauce send`'s simulation of its call, and its look for the transaction (not there).
        eth_call: "0x",
        eth_estimateGas: "0x186a0",
        eth_getTransactionByHash: null,
        eth_getBlockByNumber: {
          number: "0x64",
          hash: `0x${"11".repeat(32)}`,
          parentHash: `0x${"22".repeat(32)}`,
          timestamp: "0x6553f100",
          baseFeePerGas: "0x3b9aca00",
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          transactions: [],
        },
      };
      if (method === "eth_sendRawTransaction") received.push(params[0] as Hex);
      const body =
        method === "eth_sendRawTransaction"
          ? { jsonrpc: "2.0", id, error: { code: -32000, message: refusal } }
          : method in results
            ? { jsonrpc: "2.0", id, result: results[method] }
            : { jsonrpc: "2.0", id, error: { code: -32601, message: `no ${method}` } };

      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = original;
  });
  // The simulation before it: the call succeeds and needs 100,000 gas.
  const client = {
    call: async () => ({ data: "0x" }),
    estimateGas: async () => 100_000n,
  } as unknown as PublicClient;
  const refused = async (message: string) => {
    refusal = message;
    try {
      await sendAndWait(client, URL, signer, { to, data: "0x", value: 0n });

      return "sent";
    } catch (error) {
      return (error as Error).message;
    }
  };

  it("says why, as the node said it, not as a request with missing parameters", async () => {
    const said = {
      nonce: await refused("nonce too low: next nonce 6, tx nonce 5"),
      replaced: await refused("replacement transaction underpriced"),
      funds: await refused("insufficient funds for gas * price + value"),
    };
    // Each broadcast is the transaction as it was prepared: 1.2 times the estimate, the account's
    // next nonce, the chain, and the fees the endpoint gave.
    const signed = received.map((raw) => {
      const tx = parseTransaction(raw);

      return `${tx.chainId}/${tx.nonce}/${tx.gas}/${tx.maxPriorityFeePerGas}/${tx.type}`;
    });

    expect({ said, signed: [...new Set(signed)] }).toEqual({
      said: {
        nonce: expect.stringContaining(
          "sending failed: Nonce provided for the transaction (5) is lower than the current nonce",
        ) as unknown,
        replaced: "sending failed: replacement transaction underpriced",
        funds: expect.stringContaining(
          "sending failed: The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account",
        ) as unknown,
      },
      signed: ["1/5/120000/1000000000/eip1559"],
    });
    expect(Object.values(said).join("\n")).not.toMatch(
      /Missing or invalid parameters|refusing-key/,
    );
  });

  it("says why for a transaction signed elsewhere too, as sauce send broadcasts it", async () => {
    refusal = "replacement transaction underpriced";
    const raw = await signer.signTransaction({
      chainId: 1,
      type: "eip1559",
      to,
      value: 0n,
      nonce: 5,
      gas: 120_000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
    const said = await sendCommand({
      chain: requireChain("ethereum"),
      rpcUrl: URL,
      transactions: [raw],
    }).then(
      () => "sent",
      (error: unknown) => (error as Error).message,
    );

    expect(said).toBe("sending failed: replacement transaction underpriced");
  });
});

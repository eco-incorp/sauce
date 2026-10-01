import { address, generateKeyPairSigner, getSignatureFromTransaction } from "@solana/kit";
import type { Blockhash } from "@solana/kit";
import {
  buildComputeBudgetPrepend,
  buildExecuteInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  recommendedComputeUnitLimit,
  sendExecute,
  simulateExecute,
} from "../../src/svm/index.js";
import type { SignedExecuteTransaction } from "../../src/svm/index.js";

const PROGRAM_ID = address("Stake11111111111111111111111111111111111111");
const BLOCKHASH = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 10_000n,
};

type SimulateRpc = Parameters<typeof simulateExecute>[0];

let transaction: SignedExecuteTransaction;
let transactionWithPrepend: SignedExecuteTransaction; // [compute budget, heap frame, execute] — execute at index 2

beforeAll(async () => {
  const payer = await generateKeyPairSigner();
  const instruction = buildExecuteInstruction({
    programId: PROGRAM_ID,
    bytecode: new Uint8Array([0x00]),
    accounts: [],
  });
  transaction = await buildExecuteTransaction({
    payer,
    instructions: [buildHeapFramePrepend(), instruction],
    latestBlockhash: BLOCKHASH,
  });
  transactionWithPrepend = await buildExecuteTransaction({
    payer,
    instructions: [
      ...buildComputeBudgetPrepend({ unitLimit: 200_000 }),
      buildHeapFramePrepend(),
      instruction,
    ],
    latestBlockhash: BLOCKHASH,
  });
});

function simulateRpcStub(value: Record<string, unknown>): {
  rpc: SimulateRpc;
  args: () => unknown[];
} {
  let captured: unknown[] = [];
  const rpc = {
    simulateTransaction: (...args: unknown[]) => {
      captured = args;
      return { send: async () => ({ context: { slot: 1n }, value }) };
    },
  };

  return { rpc: rpc as unknown as SimulateRpc, args: () => captured };
}

describe("simulateExecute", () => {
  it("decodes returnData on success", async () => {
    const { rpc, args } = simulateRpcStub({
      err: null,
      logs: ["Program log: ok"],
      returnData: { data: ["3q2+7w==", "base64"], programId: PROGRAM_ID }, // 0xdeadbeef
      unitsConsumed: 777n,
    });

    const result = await simulateExecute(rpc, transaction);

    expect(result).toEqual({
      ok: true,
      unitsConsumed: 777n,
      returnData: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      logs: ["Program log: ok"],
    });
    // wire tx is sent base64-encoded with a replaced blockhash
    expect(args()[1]).toEqual({ encoding: "base64", replaceRecentBlockhash: true });
  });

  it("asks for the accounts given, and decodes their state after the transaction", async () => {
    const tracked = [
      address("Vote111111111111111111111111111111111111111"),
      address("Config1111111111111111111111111111111111111"),
    ];
    const { rpc, args } = simulateRpcStub({
      err: null,
      logs: [],
      returnData: null,
      unitsConsumed: 1n,
      accounts: [
        {
          data: ["3q2+7w==", "base64"],
          executable: false,
          lamports: 2_039_280,
          owner: PROGRAM_ID,
          rentEpoch: 0,
          space: 4,
        },
        null,
      ],
    });

    const result = await simulateExecute(rpc, transaction, { accounts: tracked });

    expect(args()[1]).toEqual({
      encoding: "base64",
      replaceRecentBlockhash: true,
      accounts: { addresses: tracked, encoding: "base64" },
    });
    expect(result.accounts).toEqual([
      {
        lamports: 2_039_280n,
        owner: PROGRAM_ID,
        data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        executable: false,
      },
      null,
    ]);
  });

  it("maps Custom(0) to a sauce revert with the returnData payload", async () => {
    // transaction = [heap frame, execute] — the execute instruction is index 1.
    const err = { InstructionError: [1, { Custom: 0 }] };
    const { rpc } = simulateRpcStub({
      err,
      logs: null,
      returnData: { data: ["AQI=", "base64"], programId: PROGRAM_ID }, // 0x0102
      unitsConsumed: 42n,
    });

    const result = await simulateExecute(rpc, transaction);

    expect(result.ok).toBe(false);
    expect(result.revert).toEqual({ payload: new Uint8Array([0x01, 0x02]) });
    expect(result.err).toBe(err);
  });

  it("surfaces a Custom(0) revert with an empty payload when returnData is absent", async () => {
    const { rpc } = simulateRpcStub({
      err: { InstructionError: [1, { Custom: 0 }] },
      logs: null,
      returnData: null,
      unitsConsumed: 42n,
    });

    const result = await simulateExecute(rpc, transaction);

    expect(result.revert).toEqual({ payload: new Uint8Array(0) });
  });

  it("does not mark a Custom(0) from a prepend instruction as a revert", async () => {
    // ATA InvalidOwner and SPL Token NotRentExempt are both Custom(0) — only
    // the execute instruction (last, index 2 here) can raise a sauce REVERT.
    const err = { InstructionError: [0, { Custom: 0 }] };
    const { rpc } = simulateRpcStub({ err, logs: null, returnData: null, unitsConsumed: 5n });

    const result = await simulateExecute(rpc, transactionWithPrepend);

    expect(result.ok).toBe(false);
    expect(result.revert).toBeUndefined();
    expect(result.err).toBe(err);
  });

  it("marks a Custom(0) from the execute instruction as a revert when prepends precede it", async () => {
    const err = { InstructionError: [2, { Custom: 0 }] };
    const { rpc } = simulateRpcStub({
      err,
      logs: null,
      returnData: { data: ["AQI=", "base64"], programId: PROGRAM_ID }, // 0x0102
      unitsConsumed: 42n,
    });

    const result = await simulateExecute(rpc, transactionWithPrepend);

    expect(result.revert).toEqual({ payload: new Uint8Array([0x01, 0x02]) });
  });

  it("honors an explicit executeInstructionIndex over the last-instruction default", async () => {
    const err = { InstructionError: [0, { Custom: 0 }] };
    const { rpc } = simulateRpcStub({ err, logs: null, returnData: null, unitsConsumed: 5n });

    const result = await simulateExecute(rpc, transactionWithPrepend, {
      executeInstructionIndex: 0,
    });

    expect(result.revert).toEqual({ payload: new Uint8Array(0) });
  });

  it("does not mark non-revert failures as reverts", async () => {
    const err = { InstructionError: [0, "InvalidInstructionData"] };
    const { rpc } = simulateRpcStub({
      err,
      logs: ["Program log: boom"],
      returnData: null,
      unitsConsumed: 10n,
    });

    const result = await simulateExecute(rpc, transaction);

    expect(result.ok).toBe(false);
    expect(result.revert).toBeUndefined();
    expect(result.err).toBe(err);
    expect(result.logs).toEqual(["Program log: boom"]);
  });
});

describe("sendExecute", () => {
  it("sends, confirms, and reads return data from the transaction meta", async () => {
    const signature = getSignatureFromTransaction(transaction);

    const pendingIterable = {
      // Not a generator: it never yields by design (it loses the confirmation race), and an
      // `async *` that cannot yield is what `require-yield` exists to catch.
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<never>(() => {}) };
      },
    };
    const rpc = {
      sendTransaction: () => ({ send: async () => signature }),
      getEpochInfo: () => ({ send: async () => ({ absoluteSlot: 100n, blockHeight: 90n }) }),
      getSignatureStatuses: () => ({
        send: async () => ({
          context: { slot: 100n },
          value: [{ confirmationStatus: "confirmed", confirmations: 1, err: null, slot: 100n }],
        }),
      }),
      getTransaction: (..._args: unknown[]) => ({
        send: async () => ({
          slot: 100n,
          blockTime: null,
          meta: {
            err: null,
            computeUnitsConsumed: 5555n,
            logMessages: ["Program log: done"],
            returnData: { data: ["3q2+7w==", "base64"], programId: PROGRAM_ID },
          },
          version: 0,
        }),
      }),
    };
    const rpcSubscriptions = {
      signatureNotifications: () => ({ subscribe: async () => pendingIterable }),
      slotNotifications: () => ({ subscribe: async () => pendingIterable }),
    };

    const result = await sendExecute({
      rpc: rpc as unknown as Parameters<typeof sendExecute>[0]["rpc"],
      rpcSubscriptions: rpcSubscriptions as unknown as Parameters<
        typeof sendExecute
      >[0]["rpcSubscriptions"],
      transaction,
    });

    expect(result).toEqual({
      signature,
      returnData: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      computeUnits: 5555n,
      logs: ["Program log: done"],
    });
  });
});

describe("recommendedComputeUnitLimit", () => {
  it("pads simulated units by 20%, rounding up", () => {
    expect(recommendedComputeUnitLimit(100n)).toBe(120);
    expect(recommendedComputeUnitLimit(101n)).toBe(122); // ceil(121.2)
  });

  it("caps at the 1.4M CU engine budget", () => {
    expect(recommendedComputeUnitLimit(2_000_000n)).toBe(1_400_000);
  });
});

/**
 * quoteViaSimulation units over a hand-rolled rpc stub (no network, no
 * LiteSVM): the quote is the outAta balance delta between the live
 * getAccountInfo read and the simulateTransaction post-state, the simulation
 * request carries replaceRecentBlockhash + the outAta post-state selector,
 * and every failure surface (missing account, non-token data, simulation
 * error, missing post-state) throws a named error.
 */
import { address, generateKeyPairSigner } from "@solana/kit";
import type { GetAccountInfoApi, Instruction, Rpc, SimulateTransactionApi } from "@solana/kit";
import { quoteViaSimulation } from "../../src/svm/quoteSim.js";

const OUT_ATA = address("CfWX7o2TswwbxusJ4hCaPobu2jLCb1hfXuXJQjVq3jQF");
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const swapIx: Instruction = {
  programAddress: MEMO_PROGRAM,
  data: new Uint8Array([1, 2, 3]),
};

/** 165-byte SPL token account image with `amount` as the u64 LE at offset 64. */
function tokenAccountBase64(amount: bigint): string {
  const data = new Uint8Array(165);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return Buffer.from(data).toString("base64");
}

type SimulateValue = {
  err: unknown;
  logs?: string[] | null;
  accounts?: ({ data: [string, string] } | null)[] | null;
};

interface StubCalls {
  getAccountInfo: unknown[][];
  simulateTransaction: unknown[][];
}

/** Rpc stub returning canned values and recording every call's arguments. */
function stubRpc(
  pre: { data: [string, string] } | null,
  sim: SimulateValue,
): { rpc: Rpc<SimulateTransactionApi & GetAccountInfoApi>; calls: StubCalls } {
  const calls: StubCalls = { getAccountInfo: [], simulateTransaction: [] };
  const rpc = {
    getAccountInfo: (...args: unknown[]) => {
      calls.getAccountInfo.push(args);
      return { send: async () => ({ value: pre }) };
    },
    simulateTransaction: (...args: unknown[]) => {
      calls.simulateTransaction.push(args);
      return { send: async () => ({ value: sim }) };
    },
  } as unknown as Rpc<SimulateTransactionApi & GetAccountInfoApi>;
  return { rpc, calls };
}

function simOk(postAmount: bigint): SimulateValue {
  return { err: null, logs: [], accounts: [{ data: [tokenAccountBase64(postAmount), "base64"] }] };
}

describe("quoteViaSimulation", () => {
  it("returns the outAta post − pre balance delta", async () => {
    const { rpc } = stubRpc({ data: [tokenAccountBase64(1_000n), "base64"] }, simOk(1_500n));
    const payer = await generateKeyPairSigner();

    const quote = await quoteViaSimulation({ rpc, swapIx, payer, outAta: OUT_ATA });
    expect(quote).toBe(500n);
  });

  it("requests base64 post-state for exactly the outAta with replaceRecentBlockhash", async () => {
    const { rpc, calls } = stubRpc({ data: [tokenAccountBase64(7n), "base64"] }, simOk(7n));
    const payer = await generateKeyPairSigner();

    const quote = await quoteViaSimulation({ rpc, swapIx, payer, outAta: OUT_ATA });
    expect(quote).toBe(0n); // no-op swap: delta 0, not an error

    expect(calls.getAccountInfo).toEqual([[OUT_ATA, { encoding: "base64" }]]);
    expect(calls.simulateTransaction).toHaveLength(1);
    const [wireTx, config] = calls.simulateTransaction[0];
    expect(typeof wireTx).toBe("string"); // base64 wire transaction
    expect((wireTx as string).length).toBeGreaterThan(0);
    expect(config).toEqual({
      encoding: "base64",
      replaceRecentBlockhash: true,
      accounts: { encoding: "base64", addresses: [OUT_ATA] },
    });
  });

  it("throws when the out token account does not exist", async () => {
    const { rpc } = stubRpc(null, simOk(1n));
    const payer = await generateKeyPairSigner();

    await expect(quoteViaSimulation({ rpc, swapIx, payer, outAta: OUT_ATA })).rejects.toThrow(
      `out token account ${OUT_ATA} not found`,
    );
  });

  it("throws when the pre-state is too short to be an SPL token account", async () => {
    const short = Buffer.from(new Uint8Array(64)).toString("base64");
    const { rpc } = stubRpc({ data: [short, "base64"] }, simOk(1n));
    const payer = await generateKeyPairSigner();

    await expect(quoteViaSimulation({ rpc, swapIx, payer, outAta: OUT_ATA })).rejects.toThrow(
      `out token account ${OUT_ATA} data is 64 bytes before the swap, expected an SPL token account`,
    );
  });

  it("throws the simulation error with its logs when the swap fails", async () => {
    const { rpc } = stubRpc(
      { data: [tokenAccountBase64(1n), "base64"] },
      {
        err: { InstructionError: [0, "Custom"] },
        logs: ["Program log: slippage exceeded"],
        accounts: null,
      },
    );
    const payer = await generateKeyPairSigner();

    await expect(quoteViaSimulation({ rpc, swapIx, payer, outAta: OUT_ATA })).rejects.toThrow(
      'swap simulation failed: {"InstructionError":[0,"Custom"]}\nProgram log: slippage exceeded',
    );
  });

  it("throws when the simulation returns no post-state for the outAta", async () => {
    const payer = await generateKeyPairSigner();
    for (const accounts of [null, [null]] as SimulateValue["accounts"][]) {
      const { rpc } = stubRpc(
        { data: [tokenAccountBase64(1n), "base64"] },
        { err: null, accounts },
      );
      await expect(quoteViaSimulation({ rpc, swapIx, payer, outAta: OUT_ATA })).rejects.toThrow(
        `swap simulation did not return the out token account ${OUT_ATA}`,
      );
    }
  });

  it("throws when the post-state is not an SPL token account", async () => {
    const short = Buffer.from(new Uint8Array(10)).toString("base64");
    const { rpc } = stubRpc(
      { data: [tokenAccountBase64(1n), "base64"] },
      { err: null, accounts: [{ data: [short, "base64"] }] },
    );
    const payer = await generateKeyPairSigner();

    await expect(quoteViaSimulation({ rpc, swapIx, payer, outAta: OUT_ATA })).rejects.toThrow(
      `out token account ${OUT_ATA} data is 10 bytes after the swap, expected an SPL token account`,
    );
  });
});

/**
 * `handoff`: what a wallet's own tool takes, written beside the unsigned EVM transactions a result
 * carries, in every shape `plannedTransactions` reads — and nowhere else. The tools' own results are
 * held to the wallets' input schemas by `mcp/test/handoff.e2e.test.ts`.
 */
import { handoff } from "../src/cli/handoff.js";
import { plannedTransactions } from "../src/cli/wallet-send.js";

const POT = "0xDAbdbbb26fbD62585c9aCC367e25146940d40417";
const KITCHEN = "0x19845b22989150E6B09dE55a661295Dd9188506b";
const PORTAL = "0x399Dbd5DF04f83103F77A58cBa2B7c4d3cdede97";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const cook = { to: POT, data: "0xb38dbf14", value: "1234" };
const deploy = { what: "Kitchen.deployPot", deploysPot: POT, to: KITCHEN, data: "0x5e3bd4b4" };

describe("handoff", () => {
  it("writes a single transaction's eth_sendTransaction object, and a batch of one", () => {
    expect(handoff({ chainId: 8453, ...cook })).toEqual({
      chainId: 8453,
      ...cook,
      sendTransaction: { chainId: "0x2105", to: POT, data: "0xb38dbf14", value: "0x4d2" },
      sendCalls: { chain: "base", calls: [{ to: POT, value: "0x4d2", data: "0xb38dbf14" }] },
    });
  });

  it("batches a plan's transactions in order, each with its own, gas in hex", () => {
    const plan = {
      chainId: 1,
      pot: POT,
      transactions: [
        { ...deploy, value: "0", gas: "250000" },
        { what: "cook", ...cook, gas: "91000" },
      ],
    };
    const out = handoff(plan);
    expect(out.sendCalls).toEqual({
      chain: "ethereum",
      calls: [
        { to: KITCHEN, value: "0x0", data: "0x5e3bd4b4" },
        { to: POT, value: "0x4d2", data: "0xb38dbf14" },
      ],
    });
    expect(out.transactions.map((tx) => (tx as Record<string, unknown>).sendTransaction)).toEqual([
      { chainId: "0x1", to: KITCHEN, data: "0x5e3bd4b4", value: "0x0", gas: "0x3d090" },
      { chainId: "0x1", to: POT, data: "0xb38dbf14", value: "0x4d2", gas: "0x16378" },
    ]);
    // What a result says beside them stays as it was.
    expect(out.transactions[0]).toMatchObject({ ...deploy, value: "0", gas: "250000" });
    // And it is the same plan to a wallet of this server's.
    expect(plannedTransactions(out)).toEqual(plannedTransactions(plan));
  });

  it("batches every intent's transactions together when they are one chain's", () => {
    const published = {
      chainId: 8453,
      portal: PORTAL,
      intents: [
        {
          intentHash: "0x01",
          transactions: [{ what: "approve", to: USDC, data: "0x095e", value: "0" }],
        },
        {
          intentHash: "0x02",
          transactions: [{ what: "publish", to: PORTAL, data: "0x01", value: "7" }],
        },
      ],
    };
    const out = handoff(published);
    expect(out.sendCalls?.calls.map((call) => call.to)).toEqual([USDC, PORTAL]);
    expect(out.intents.every((intent) => !("sendCalls" in intent))).toBe(true);
  });

  it("gives an intent of a result that spans chains a batch of its own", () => {
    const fills = {
      from: POT,
      intents: [
        { intentHash: "0x01", transactions: [{ chainId: 8453, chain: "base", ...cook }] },
        { intentHash: "0x02", transactions: [{ chainId: 1, chain: "ethereum", ...cook }] },
      ],
    };
    const out = handoff(fills) as typeof fills & { sendCalls?: unknown };
    expect(out.sendCalls).toBeUndefined();
    expect(
      out.intents.map((intent) => (intent as { sendCalls?: { chain: string } }).sendCalls?.chain),
    ).toEqual(["base", "ethereum"]);
  });

  it("leaves Solana transactions as they are: base64 is what a wallet takes", () => {
    const svm = {
      ready: true,
      transactions: [
        {
          chainId: 1399811149,
          chain: "solana",
          feePayer: POT,
          transaction: "AQID",
          value: "0",
          what: "prove",
        },
      ],
    };
    expect(handoff(svm)).toBe(svm);
  });

  it("writes nothing where nothing is to be sent: sent, simulated, not ready, or a Pot there already", () => {
    const sent = { transactions: [{ what: "cook", hash: "0xab", status: "success", ...cook }] };
    const simulated = { ok: true, transactions: [{ what: "cook", status: "success", ...cook }] };
    const notReady = { intents: [{ intentHash: "0x01", ready: false, why: "not yet" }] };
    const there = {
      chainId: 8453,
      pot: POT,
      to: KITCHEN,
      data: "0x5e3bd4b4",
      value: "0",
      deployed: true,
    };
    const read = {
      ...there,
      deployed: undefined,
      deployment: { pot: { address: POT, deployed: true } },
    };
    for (const json of [sent, simulated, notReady, there, read]) expect(handoff(json)).toBe(json);
  });

  it("names no batch on a chain Coinbase's send_calls does not take, nor for a transaction with no chain", () => {
    const celo = handoff({ chainId: 42220, ...cook });
    expect(celo.sendCalls).toBeUndefined();
    expect(celo.sendTransaction).toEqual({
      chainId: "0xa4ec",
      to: POT,
      data: "0xb38dbf14",
      value: "0x4d2",
    });
    expect(handoff({ ...cook })).toEqual(cook);
  });

  it("is idempotent", () => {
    const once = handoff({ chainId: 8453, transactions: [deploy, cook] });
    expect(handoff(once)).toEqual(once);
  });
});

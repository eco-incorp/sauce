/**
 * `handoff`: the `send_calls` batch of the unsigned EVM transactions a result carries, in every
 * shape `plannedTransactions` reads — and nowhere else. Each transaction is itself a wallet's
 * send-transaction input, written so by its command; the tools' own results are held to the
 * wallets' input schemas by `mcp/test/handoff.e2e.test.ts`.
 */
import { handoff, hexQuantity } from "../src/cli/handoff.js";
import { plannedTransactions } from "../src/cli/wallet-send.js";

const POT = "0xDAbdbbb26fbD62585c9aCC367e25146940d40417";
const KITCHEN = "0x19845b22989150E6B09dE55a661295Dd9188506b";
const PORTAL = "0x399Dbd5DF04f83103F77A58cBa2B7c4d3cdede97";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const cook = { to: POT, data: "0xb38dbf14", value: "0x4d2" };
const deploy = { what: "Kitchen.deployPot", deploysPot: POT, to: KITCHEN, data: "0x5e3bd4b4" };

describe("handoff", () => {
  it("writes an amount as a hex quantity", () => {
    expect([0n, 1234n, 10n ** 18n].map(hexQuantity)).toEqual(["0x0", "0x4d2", "0xde0b6b3a7640000"]);
  });

  it("batches a single transaction as one call", () => {
    expect(handoff({ chainId: 8453, ...cook })).toEqual({
      chainId: 8453,
      ...cook,
      sendCalls: { chain: "base", calls: [{ to: POT, value: "0x4d2", data: "0xb38dbf14" }] },
    });
  });

  it("batches a plan's transactions in order, leaving each as it is", () => {
    const plan = {
      chainId: 1,
      pot: POT,
      transactions: [
        { ...deploy, chainId: 1, value: "0x0", gas: "0x3d090" },
        { what: "cook", chainId: 1, ...cook, gas: "0x16378" },
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
    expect(out.transactions).toBe(plan.transactions);
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
          transactions: [{ what: "approve", to: USDC, data: "0x095e", value: "0x0" }],
        },
        {
          intentHash: "0x02",
          transactions: [{ what: "publish", to: PORTAL, data: "0x01", value: "0x7" }],
        },
      ],
    };
    const out = handoff(published);
    expect(out.sendCalls?.calls.map((call) => [call.to, call.value])).toEqual([
      [USDC, "0x0"],
      [PORTAL, "0x7"],
    ]);
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

  it("reads a decimal value as one too", () => {
    expect(handoff({ chainId: 8453, ...cook, value: "1234" }).sendCalls?.calls[0]?.value).toBe(
      "0x4d2",
    );
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

  it("batches nothing that is not to be sent: sent, simulated, not ready, or a Pot there already", () => {
    const sent = { transactions: [{ what: "cook", hash: "0xab", status: "success", ...cook }] };
    const simulated = { ok: true, transactions: [{ what: "cook", status: "success", ...cook }] };
    const notReady = { intents: [{ intentHash: "0x01", ready: false, why: "not yet" }] };
    const there = {
      chainId: 8453,
      pot: POT,
      to: KITCHEN,
      data: "0x5e3bd4b4",
      value: "0x0",
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
    expect(handoff({ chainId: 42220, ...cook }).sendCalls).toBeUndefined();
    expect(handoff({ ...cook })).toEqual(cook);
  });

  it("is idempotent", () => {
    const once = handoff({ chainId: 8453, transactions: [deploy, cook] });
    expect(handoff(once)).toEqual(once);
  });
});

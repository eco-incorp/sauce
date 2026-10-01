/**
 * A wallet's policy and its ledger, offline: the file read strictly, and every limit enforced on
 * what a transaction is MEASURED to move — the logs of its `eth_simulateV1` rehearsal, here given
 * by a client that answers with chosen logs — per transaction, per day from the ledger (released
 * reservations and anything older than 24 hours left out), by chain and by recipient, with each
 * refusal naming the limit it hit. Sending through the real gated stack is `cli-wallet.e2e.test.ts`.
 */
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  maxUint256,
  pad,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { v12PotAbi } from "../src/evm/engine.js";
import {
  guardOf,
  guardWallet,
  noPolicyNote,
  parsePolicy,
  PolicyRefusal,
  readPolicy,
  SendGuard,
} from "../src/cli/policy.js";
import { WalletStore, type WalletInfo } from "../src/cli/wallets.js";

const BASE = requireChain("base");
const USDC = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const OTHER_TOKEN = getAddress("0x1111111111111111111111111111111111111112");
const RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");
const POT = getAddress("0x7777777777777777777777777777777777777777");
const NATIVE = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

const word = (amount: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [amount]);
const topic = (address: Address): Hex => pad(address, { size: 32 });
const transfer = (token: Address, from: Address, to: Address, amount: bigint) => ({
  address: token,
  topics: [TRANSFER, topic(from), topic(to)] as Hex[],
  data: word(amount),
});
const approval = (token: Address, owner: Address, spender: Address, amount: bigint) => ({
  address: token,
  topics: [APPROVAL, topic(owner), topic(spender)] as Hex[],
  data: word(amount),
});

type Log = ReturnType<typeof transfer>;

/** A client whose rehearsal of every call answers `logs`; `null` for an endpoint without one. */
function client(logs: Log[] | null, decimals = 18): PublicClient {
  return {
    getChainId: async () => BASE.id,
    simulateBlocks: async ({ blocks }: { blocks: Array<{ calls: unknown[] }> }) => {
      if (logs === null) throw new Error("the method eth_simulateV1 does not exist");

      return [{ calls: blocks[0]!.calls.map(() => ({ status: "success", logs, data: "0x" })) }];
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "decimals") return decimals;
      throw new Error("no symbol");
    },
  } as unknown as PublicClient;
}

let dir: string;
let wallet: WalletInfo;
const WALLET = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sauce-policy-"));
  wallet = {
    name: "agent",
    kind: "evm",
    address: WALLET,
    path: join(dir, "agent.json"),
    policyPath: join(dir, "agent.policy.json"),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The guard of `wallet` with the policy `fields`. */
function guarded(fields: Record<string, unknown>): SendGuard {
  writeFileSync(wallet.policyPath, JSON.stringify(fields), { mode: 0o600 });

  return guardWallet(wallet, readPolicy(wallet));
}

const pay = { to: USDC, data: "0x" as Hex, value: 0n };
const ledger = (): Array<Record<string, unknown>> =>
  readFileSync(join(dir, "agent.ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

async function refused(promise: Promise<unknown>): Promise<PolicyRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PolicyRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the policy file", () => {
  it("is read strictly: an unknown field or a malformed amount is an error, never ignored", () => {
    const read = (fields: unknown) => () => parsePolicy(JSON.stringify(fields), "p.json");
    expect(read({ perTx: "1" })).toThrow(/perTx is not a policy field/);
    expect(read({ native: { perTx: "1" } })).toThrow(/native.perTx is not a limit/);
    expect(read({ native: { perDay: 1 } })).toThrow(/native.perDay is not an amount/);
    expect(read({ native: { perDay: "1,5" } })).toThrow(/is not an amount/);
    expect(read({ chains: ["nowhere"] })).toThrow(/chains names "nowhere", which is not a chain/);
    expect(read({ to: ["0x12"] })).toThrow(/to names "0x12", which is not an address/);
    expect(read({ tokens: { "a b": { perDay: "1" } } })).toThrow(/neither a token symbol/);
    expect(() => parsePolicy("{", "p.json")).toThrow(/p.json is not JSON/);
    const policy = parsePolicy(
      JSON.stringify({
        chains: ["base", 1],
        to: [RECIPIENT],
        native: { perTransaction: "0.01", perDay: "1000000000000000n" },
        tokens: { usdc: { perDay: "5" }, [OTHER_TOKEN]: { perTransaction: "1" } },
      }),
      "p.json",
    );
    expect(policy.chains?.map((chain) => chain.slug)).toEqual(["base", "ethereum"]);
    expect([...policy.tokens.keys()]).toEqual(["USDC", OTHER_TOKEN.toLowerCase()]);
  });

  it("is refused when others may write it, and absent is no policy", () => {
    expect(readPolicy(wallet)).toBeUndefined();
    writeFileSync(wallet.policyPath, "{}");
    chmodSync(wallet.policyPath, 0o666);
    expect(() => readPolicy(wallet)).toThrow(/can be written by others .* who could loosen it/);
    chmodSync(wallet.policyPath, 0o644);
    expect(readPolicy(wallet)?.tokens.size).toBe(0);
    expect(noPolicyNote(wallet)).toMatch(/no limits are set on what it sends/);
  });
});

describe("the guard", () => {
  it("guards a wallet by its address, whatever its case", () => {
    const guard = guardWallet(wallet, undefined);
    expect(guardOf(WALLET.toLowerCase())).toBe(guard);
    expect(guardOf(RECIPIENT)).toBeUndefined();
  });

  it("holds a token to its per-transaction limit, by symbol, naming the limit", async () => {
    const guard = guarded({ tokens: { USDC: { perTransaction: "1.5" } } });
    const over = client([transfer(USDC, WALLET, RECIPIENT, parseUnits("2", 6))]);
    const refusal = await refused(guard.evm(over, pay));
    expect(refusal.limit).toBe("tokens.USDC.perTransaction");
    expect(refusal.message).toMatch(
      /refused by the policy of wallet agent .*: tokens.USDC.perTransaction is 1.5 USDC, and this transaction sends 2 USDC/,
    );
    // What stays inside the wallet's accounts, and what comes in, is not spent.
    const inside = client([
      transfer(USDC, WALLET, POT, parseUnits("2", 6)),
      transfer(USDC, RECIPIENT, WALLET, parseUnits("9", 6)),
    ]);
    const cook = {
      to: POT,
      data: encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [RECIPIENT, "0x"] }),
      value: 0n,
    };
    await expect(guard.evm(inside, cook)).resolves.toBeDefined();
    // From the Pot it cooks on to anyone else, it is.
    const fromPot = client([transfer(USDC, POT, RECIPIENT, parseUnits("2", 6))]);
    expect((await refused(guard.evm(fromPot, cook))).limit).toBe("tokens.USDC.perTransaction");
  });

  it("counts the last 24 hours from the ledger, leaving out what was released or is older", async () => {
    const guard = guarded({ tokens: { USDC: { perDay: "5" } } });
    const two = client([transfer(USDC, WALLET, RECIPIENT, parseUnits("2", 6))]);
    const first = await guard.evm(two, pay);
    first.sent("0xaa");
    const second = await guard.evm(two, pay);
    // Not sent after all: what it reserved is given back.
    second.released("sending failed");
    (await guard.evm(two, pay)).sent("0xbb");
    const refusal = await refused(guard.evm(two, pay));
    expect(refusal.limit).toBe("tokens.USDC.perDay");
    expect(refusal.message).toMatch(
      /tokens.USDC.perDay is 5 USDC; 4 USDC went in the last 24 hours, and this transaction sends 2 USDC/,
    );
    expect(ledger().map((line) => line.state)).toEqual([
      "reserved",
      "sent",
      "reserved",
      "released",
      "reserved",
      "sent",
    ]);
    // A day-old reservation no longer counts.
    const lines = readFileSync(join(dir, "agent.ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { state: string; time: string });
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(dir, "agent.ledger.jsonl"),
      `${lines.map((line) => JSON.stringify(line.state === "reserved" ? { ...line, time: old } : line)).join("\n")}\n`,
    );
    await expect(guard.evm(two, pay)).resolves.toBeDefined();
  });

  it("refuses to count a ledger with a broken line", async () => {
    const guard = guarded({ tokens: { USDC: { perDay: "5" } } });
    appendFileSync(join(dir, "agent.ledger.jsonl"), '{"v":1,"id":"x","state":"res');
    await expect(guard.evm(client([transfer(USDC, WALLET, RECIPIENT, 1n)]), pay)).rejects.toThrow(
      /has a line that is not JSON: the day's spending cannot be counted/,
    );
  });

  it("holds native value per transaction, and refuses what it cannot measure", async () => {
    const guard = guarded({ native: { perTransaction: "0.01" } });
    const value = parseUnits("0.02", 18);
    const traced = client([transfer(NATIVE, WALLET, RECIPIENT, value)]);
    const refusal = await refused(guard.evm(traced, { to: RECIPIENT, data: "0x", value }));
    expect(refusal.message).toMatch(
      /native.perTransaction is 0.01 ETH, and this transaction sends 0.02 ETH/,
    );
    // Untraced, a plain transfer is its value; a cook's Pot is not seen, so a cook is refused.
    const untraced = client([]);
    expect((await refused(guard.evm(untraced, { to: RECIPIENT, data: "0x", value }))).limit).toBe(
      "native.perTransaction",
    );
    const cook = {
      to: POT,
      data: encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [RECIPIENT, "0x"] }),
      value: 1n,
    };
    expect((await refused(guard.evm(untraced, cook))).message).toMatch(
      /native is limited, and the endpoint does not trace native transfers/,
    );
  });

  it("refuses an approval above the limit, but not one to Permit2", async () => {
    const guard = guarded({ tokens: { USDC: { perTransaction: "10" } } });
    const unlimited = client([approval(USDC, WALLET, RECIPIENT, maxUint256)]);
    const refusal = await refused(guard.evm(unlimited, pay));
    expect(refusal.message).toMatch(
      new RegExp(
        `this transaction approves ${RECIPIENT} for .* more than the 10 USDC tokens.USDC leaves room for`,
      ),
    );
    await expect(
      guard.evm(client([approval(USDC, WALLET, PERMIT2, maxUint256)]), pay),
    ).resolves.toBeDefined();
    await expect(
      guard.evm(client([approval(USDC, WALLET, RECIPIENT, parseUnits("10", 6))]), pay),
    ).resolves.toBeDefined();
  });

  it("holds a token named by address, its decimals read from it", async () => {
    const guard = guarded({ tokens: { [OTHER_TOKEN]: { perTransaction: "1" } } });
    const over = client([transfer(OTHER_TOKEN, WALLET, RECIPIENT, parseUnits("1.5", 8))], 8);
    expect((await refused(guard.evm(over, pay))).limit).toBe(
      `tokens.${OTHER_TOKEN.toLowerCase()}.perTransaction`,
    );
  });

  it("refuses a token limit an endpoint without eth_simulateV1 cannot measure", async () => {
    const guard = guarded({ tokens: { USDC: { perDay: "5" } } });
    expect((await refused(guard.evm(client(null), pay))).message).toMatch(
      /tokens.USDC is limited, and the endpoint did not run eth_simulateV1/,
    );
  });

  it("allows only the chains and recipients it names", async () => {
    const onEthereum = guarded({ chains: ["ethereum"] });
    const refusal = await refused(onEthereum.evm(client([]), pay));
    expect(refusal.limit).toBe("chains");
    expect(refusal.message).toMatch(/chains allows ethereum, and this transaction is on base/);
    const toRecipient = guarded({ to: [RECIPIENT] });
    expect((await refused(toRecipient.evm(client([]), pay))).message).toMatch(
      new RegExp(`to allows 1 address\\(es\\), and this transaction goes to ${USDC.toLowerCase()}`),
    );
    await expect(
      toRecipient.evm(client([]), { to: RECIPIENT, data: "0x", value: 0n }),
    ).resolves.toBeDefined();
  });

  it("checks a whole plan before any of it is sent, its transactions counted together", async () => {
    const guard = guarded({ tokens: { USDC: { perDay: "3" } } });
    const two = client([transfer(USDC, WALLET, RECIPIENT, parseUnits("2", 6))]);
    const { measureEvm } = await import("../src/cli/policy.js");
    const measured = await measureEvm(two, BASE, WALLET, [pay, pay]);
    expect((await refused(guard.preflight(measured))).message).toMatch(
      /2 USDC went in the last 24 hours, and this transaction sends 2 USDC/,
    );
    // A preflight reserves nothing.
    expect(() => readFileSync(join(dir, "agent.ledger.jsonl"))).toThrow();
  });

  it("guards a real wallet the store unlocked by the same address", async () => {
    const store = new WalletStore(join(dir, "wallets"));
    const { info } = await store.create("real", "evm", "throwaway-password");
    const guard = guardWallet(info, readPolicy(info));
    expect(guardOf(info.address)).toBe(guard);
    expect(guard.policy).toBeUndefined();
  }, 60_000);
});

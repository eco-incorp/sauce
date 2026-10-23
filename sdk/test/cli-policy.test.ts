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
import { v12KitchenAddress } from "../src/deployments/index.js";
import { v12PredictPot } from "../src/deployments/pot.js";
import { v12Kitchen, v12KitchenAbi, v12PotAbi } from "../src/evm/engine.js";
import {
  guardOf,
  guardWallet,
  noPolicyNote,
  ownPotDeployed,
  parsePolicy,
  PolicyRefusal,
  readPolicy,
  SendGuard,
} from "../src/cli/policy.js";
import { PreviewChainError } from "../src/cli/support.js";
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
    expect(policy.notes).toEqual([]);
  });

  it("takes whole tokens, and base units ending in n", () => {
    const policy = parsePolicy(
      JSON.stringify({ tokens: { USDC: { perTransaction: "1.5", perDay: "1500000n" } } }),
      "p.json",
    );
    expect(policy.tokens.get("USDC")).toEqual({
      perTransaction: { units: "1.5" },
      perDay: { base: 1_500_000n },
    });
    expect(policy.notes).toEqual([]);
  });

  it("takes a Solana key in base58 or as the 32 bytes of hex the command prints, kept in base58", () => {
    const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const usdcHex = "0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61";
    const policy = parsePolicy(
      JSON.stringify({ to: [usdc, usdcHex], tokens: { [usdcHex]: { perTransaction: "1" } } }),
      "p.json",
    );
    expect(policy.to).toEqual([usdc, usdc]);
    expect([...policy.tokens.keys()]).toEqual([usdc]);
  });

  it("says when a bare integer of whole tokens reads like base units: a note, not a refusal", () => {
    const policy = parsePolicy(
      JSON.stringify({
        tokens: { USDC: { perTransaction: "1500000", perDay: "999999" } },
        // The native coin has 18 decimals on an EVM chain and 9 on Solana: nothing to judge by.
        native: { perDay: "1000000000000" },
      }),
      "p.json",
    );
    expect(policy.tokens.get("USDC")?.perTransaction).toEqual({ units: "1500000" });
    expect(policy.notes).toEqual([
      'p.json: tokens.USDC.perTransaction: "1500000" is 1.5 million USDC; for base units write ' +
        '"1500000n"',
    ]);
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

  describe("on Arc, whose native USDC is also its ERC-20", () => {
    const ARC_USDC = getAddress("0x3600000000000000000000000000000000000000");
    // Arc logs every native movement itself, from EIP-7708's system address, in 18 decimals.
    const CHAIN = getAddress("0xfffffffffffffffffffffffffffffffffffffffe");
    const onArc = (logs: Log[]): PublicClient =>
      ({ ...client(logs), getChainId: async () => requireChain("arc").id }) as PublicClient;
    // `usdc` sent as value: the trace and the chain both report it.
    const asValue = (usdc: string) => {
      const wei = parseUnits(usdc, 18);

      return {
        moved: onArc([
          transfer(NATIVE, WALLET, RECIPIENT, wei),
          transfer(CHAIN, WALLET, RECIPIENT, wei),
        ]),
        call: { to: RECIPIENT, data: "0x" as Hex, value: wei },
      };
    };
    // `usdc` sent through the ERC-20: the chain and the token both report it.
    const asToken = (usdc: string) => ({
      moved: onArc([
        transfer(CHAIN, WALLET, RECIPIENT, parseUnits(usdc, 18)),
        transfer(ARC_USDC, WALLET, RECIPIENT, parseUnits(usdc, 6)),
      ]),
      call: pay,
    });

    it("holds USDC to the native limit and the USDC limit, however it leaves", async () => {
      const byToken = guarded({ tokens: { USDC: { perTransaction: "1.5" } } });
      for (const { moved, call } of [asValue("2"), asToken("2")]) {
        expect((await refused(byToken.evm(moved, call))).message).toMatch(
          /tokens.USDC.perTransaction is 1.5 USDC, and this transaction sends 2 USDC/,
        );
      }
      const byNative = guarded({ native: { perTransaction: "1.5" } });
      for (const { moved, call } of [asValue("2"), asToken("2")]) {
        expect((await refused(byNative.evm(moved, call))).message).toMatch(
          /native.perTransaction is 1.5 USDC, and this transaction sends 2 USDC/,
        );
      }
      // Each movement counts once: 2 USDC, not the 4 its two reports add up to.
      const roomy = guarded({
        native: { perTransaction: "3" },
        tokens: { USDC: { perTransaction: "3" } },
      });
      for (const { moved, call } of [asValue("2"), asToken("2")]) {
        await expect(roomy.evm(moved, call)).resolves.toBeDefined();
      }
    });

    it("reads a USDC limit in base units as the token's, for transfers and approvals", async () => {
      const guard = guarded({ tokens: { USDC: { perTransaction: "1500000n" } } });
      for (const { moved, call } of [asValue("2"), asToken("2")]) {
        expect((await refused(guard.evm(moved, call))).message).toMatch(
          /tokens.USDC.perTransaction is 1.5 USDC, and this transaction sends 2 USDC/,
        );
      }
      for (const { moved, call } of [asValue("1"), asToken("1")]) {
        await expect(guard.evm(moved, call)).resolves.toBeDefined();
      }
      const approves = (usdc: string) =>
        onArc([approval(ARC_USDC, WALLET, RECIPIENT, parseUnits(usdc, 6))]);
      expect((await refused(guard.evm(approves("2"), pay))).message).toMatch(
        /approves .* for 2 USDC, more than the 1.5 USDC tokens.USDC leaves room for/,
      );
      await expect(guard.evm(approves("1"), pay)).resolves.toBeDefined();
    });

    it("counts a day's USDC with every other chain's", async () => {
      const guard = guarded({ tokens: { USDC: { perDay: "5" } } });
      (await guard.evm(client([transfer(USDC, WALLET, RECIPIENT, parseUnits("2", 6))]), pay)).sent(
        "0xaa",
      );
      const value = asValue("2");
      (await guard.evm(value.moved, value.call)).sent("0xbb");
      expect((await refused(guard.evm(value.moved, value.call))).message).toMatch(
        /tokens.USDC.perDay is 5 USDC; 4 USDC went in the last 24 hours, and this transaction sends 2 USDC/,
      );
    });
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

  it("counts the Kitchen's deploy of the wallet's own Pot, for `to`, as a transaction to that Pot", async () => {
    const salt = pad("0x01", { size: 32 });
    const ownPot = getAddress(v12PredictPot(WALLET, salt) as Address);
    const deploy = (owner: Address, value = 0n) => ({
      to: getAddress(v12KitchenAddress()),
      data: v12Kitchen.encodeDeployPot(owner, salt),
      value,
    });
    expect(ownPotDeployed(deploy(WALLET), WALLET)).toBe(ownPot);
    // Another owner's Pot, a value, the three-argument deploy and any other call stay the Kitchen's.
    expect(ownPotDeployed(deploy(RECIPIENT), WALLET)).toBeUndefined();
    expect(ownPotDeployed(deploy(WALLET, 1n), WALLET)).toBeUndefined();
    const pinned = encodeFunctionData({
      abi: v12KitchenAbi,
      functionName: "deployPot",
      args: [WALLET, salt, true],
    });
    expect(ownPotDeployed({ ...deploy(WALLET), data: pinned }, WALLET)).toBeUndefined();
    expect(ownPotDeployed({ ...deploy(WALLET), to: USDC }, WALLET)).toBeUndefined();
    // So a policy that lets the wallet cook on its Pot lets it deploy that Pot first...
    await expect(guarded({ to: [ownPot] }).evm(client([]), deploy(WALLET))).resolves.toBeDefined();
    // ...and one that does not refuses the deploy, naming the Pot, not the Kitchen.
    const refusal = await refused(guarded({ to: [RECIPIENT] }).evm(client([]), deploy(WALLET)));
    expect(refusal.limit).toBe("to");
    expect(refusal.message).toContain(
      `this transaction deploys the wallet's Pot ${ownPot}, which is not one of them`,
    );
    // Another owner's Pot is a transaction to the Kitchen, which `to` does not name.
    expect(
      (await refused(guarded({ to: [ownPot] }).evm(client([]), deploy(RECIPIENT)))).message,
    ).toMatch(/and this transaction goes to 0x/);
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

  it("sends from a wallet only on a chain the release supports, policy or not", async () => {
    const onArbitrum = {
      ...client([]),
      getChainId: async () => requireChain("arbitrum").id,
      simulateBlocks: async () => {
        throw new Error("a preview chain is refused before anything is simulated");
      },
    } as unknown as PublicClient;
    for (const guard of [guardWallet(wallet, undefined), guarded({})]) {
      await expect(guard.evm(onArbitrum, pay)).rejects.toThrow(PreviewChainError);
      await expect(guard.evm(onArbitrum, pay)).rejects.toThrow(
        /sending from a wallet is refused: it involves arbitrum/,
      );
    }
  });

  it("guards a real wallet the store unlocked by the same address", async () => {
    const store = new WalletStore(join(dir, "wallets"));
    const { info } = await store.create("real", "evm", "throwaway-password");
    const guard = guardWallet(info, readPolicy(info));
    expect(guardOf(info.address)).toBe(guard);
    expect(guard.policy).toBeUndefined();
  }, 60_000);
});

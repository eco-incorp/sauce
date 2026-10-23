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
  ContractFunctionZeroDataError,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  maxUint256,
  pad,
  parseUnits,
  toBytes,
  toFunctionSelector,
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
const WALLET = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
/** The wallet's own Pot, at its default salt, which the client below answers for as a Pot does. */
const POT = getAddress(v12PredictPot(WALLET) as Address);
/** Another owner's Pot, as genuine as the wallet's: RECIPIENT's. */
const OTHERS_POT = getAddress(v12PredictPot(RECIPIENT) as Address);
const POT_OWNERS: Record<Address, Address> = { [POT]: WALLET, [OTHERS_POT]: RECIPIENT };
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

/** The selectors of `allowance` on an ERC-20 and on Permit2, which a measurement reads after. */
const ALLOWANCE_READS = [
  toFunctionSelector("function allowance(address owner, address spender)"),
  toFunctionSelector("function allowance(address user, address token, address spender)"),
];

/** A client whose rehearsal of every call answers `logs`; `null` for an endpoint without one. Its
 *  tokens have `decimals`, or, where `null`, a decimals() that reads nothing. A contract with no
 *  such function answers with no data, as viem reports it; a read of a contract in `unreadable`
 *  fails at the endpoint instead, before any contract answers. An `allowance` read in a rehearsal
 *  answers `remaining` (the allowance the transaction leaves), or fails where it is `null`; left
 *  out, it answers no data. */
function client(
  logs: Log[] | null,
  decimals: number | null = 18,
  unreadable: readonly Address[] = [],
  remaining?: bigint | null,
): PublicClient {
  return {
    getChainId: async () => BASE.id,
    simulateBlocks: async ({ blocks }: { blocks: Array<{ calls: Array<{ data?: Hex }> }> }) => {
      if (logs === null) throw new Error("the method eth_simulateV1 does not exist");

      return [
        {
          calls: blocks[0]!.calls.map((call) =>
            remaining !== undefined &&
            ALLOWANCE_READS.some((read) => call.data?.toLowerCase().startsWith(read))
              ? remaining === null
                ? { status: "failure", logs: [], data: "0x" }
                : { status: "success", logs: [], data: word(remaining) }
              : { status: "success", logs, data: "0x" },
          ),
        },
      ];
    },
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      if (unreadable.includes(getAddress(address))) throw new Error("fetch failed: 429");
      if (functionName === "decimals" && decimals !== null) return decimals;
      // A Pot answers for itself: its owner, its salt (the default) and its Kitchen.
      const owner = POT_OWNERS[getAddress(address)];
      if (owner !== undefined && functionName === "owner") return owner;
      if (owner !== undefined && functionName === "userSalt") return pad("0x00", { size: 32 });
      if (owner !== undefined && functionName === "kitchen") return getAddress(v12KitchenAddress());
      throw new ContractFunctionZeroDataError({ functionName });
    },
  } as unknown as PublicClient;
}

let dir: string;
let wallet: WalletInfo;

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

  it("refuses a cook on a Pot it cannot tell is the wallet's own, where a native or token limit needs it", async () => {
    // The wallet's own Pot, whose owner(), userSalt() and kitchen() the endpoint fails to read: a
    // cook on it spends the Pot's coin and USDC to another key.
    const cook = {
      to: POT,
      data: encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [RECIPIENT, "0x"] }),
      value: 0n,
    };
    const verdict = (guard: SendGuard, logs: Log[]) =>
      guard.evm(client(logs, 18, [POT]), cook).then(
        () => "let through",
        (error: unknown) => (error instanceof PolicyRefusal ? error.message : String(error)),
      );
    const native = await verdict(guarded({ native: { perTransaction: "0.01" } }), [
      transfer(NATIVE, POT, RECIPIENT, parseUnits("0.02", 18)),
    ]);
    const usdc = await verdict(guarded({ tokens: { USDC: { perTransaction: "1.5" } } }), [
      transfer(NATIVE, POT, RECIPIENT, 0n),
      transfer(USDC, POT, RECIPIENT, parseUnits("2", 6)),
    ]);
    // Where no native or token limit is set, nothing it cannot measure is limited.
    const open = await verdict(guarded({ chains: ["base"] }), [
      transfer(USDC, POT, RECIPIENT, parseUnits("2", 6)),
    ]);

    expect({ native, usdc, open }).toEqual({
      native: expect.stringContaining(
        `native is limited, and could not tell whether ${POT}, which the transaction cooks on, is the wallet's own Pot`,
      ) as unknown,
      usdc: expect.stringContaining(
        `tokens.USDC is limited, and could not tell whether ${POT}, which the transaction cooks on, is the wallet's own Pot`,
      ) as unknown,
      open: "let through",
    });
  });

  it("counts what the wallet pays a contract that is not its own Pot, whatever its calldata says", async () => {
    const guard = guarded({
      native: { perTransaction: "0.01" },
      tokens: { USDC: { perTransaction: "1.5" } },
    });
    const value = parseUnits("0.02", 18);
    const cookShaped = (to: Address, signed: boolean, paid: bigint) => ({
      to,
      data: signed
        ? encodeFunctionData({
            abi: v12PotAbi,
            functionName: "cookSigned",
            args: [RECIPIENT, "0x", 0n, 0n, 0n, WALLET, "0x"],
          })
        : encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [RECIPIENT, "0x"] }),
      value: paid,
    });
    // A contract that is no Pot, sent a cook's calldata, and another owner's genuine Pot sent a
    // signed cook: the native coin and the USDC the wallet pays either leave the wallet. (The node
    // traces native transfers: a zero-value one beside the USDC says so.)
    const verdicts = [];
    for (const [to, signed] of [
      [RECIPIENT, false],
      [OTHERS_POT, true],
    ] as const) {
      for (const [moved, paid] of [
        [client([transfer(NATIVE, WALLET, to, value)]), value],
        [
          client([
            transfer(NATIVE, WALLET, to, 0n),
            transfer(USDC, WALLET, to, parseUnits("2", 6)),
          ]),
          0n,
        ],
      ] as const) {
        verdicts.push(
          await guard.evm(moved, cookShaped(to, signed, paid)).then(
            () => "let through",
            (error: unknown) => (error instanceof PolicyRefusal ? error.limit : String(error)),
          ),
        );
      }
    }
    expect(verdicts).toEqual([
      "native.perTransaction",
      "tokens.USDC.perTransaction",
      "native.perTransaction",
      "tokens.USDC.perTransaction",
    ]);
    // The wallet's own Pot is its own: what it pays in stays the wallet's.
    await expect(
      guard.evm(client([transfer(NATIVE, WALLET, POT, value)]), cookShaped(POT, false, value)),
    ).resolves.toBeDefined();
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

    it("holds native USDC sent and a USDC allowance left together, as one token", async () => {
      // 6 USDC sent as value and 6 more left allowed on the ERC-20: one balance, so 12 against 10.
      const SPENDER = getAddress("0x5555555555555555555555555555555555555555");
      const sent = parseUnits("6", 18);
      const moved = onArc([
        transfer(NATIVE, WALLET, RECIPIENT, sent),
        transfer(CHAIN, WALLET, RECIPIENT, sent),
        approval(ARC_USDC, WALLET, SPENDER, parseUnits("6", 6)),
      ]);
      const call = { to: RECIPIENT, data: "0x" as Hex, value: sent };
      const capped = await guarded({ tokens: { USDC: { perTransaction: "10" } } })
        .evm(moved, call)
        .then(
          () => "let through",
          (error: unknown) => (error instanceof PolicyRefusal ? error.message : String(error)),
        );
      // With room for both, the day's total records both.
      rmSync(join(dir, "agent.ledger.jsonl"), { force: true });
      (await guarded({ tokens: { USDC: { perDay: "20" } } }).evm(moved, call)).sent("0xaa");
      const spend = ledger().find((line) => line.state === "reserved")?.spend as Record<
        string,
        { amount: string; decimals: number }
      >;

      expect({ capped, spend: spend["tokens.USDC"] }).toEqual({
        capped: expect.stringContaining(
          "tokens.USDC.perTransaction is 10 USDC, and this transaction sends 12 USDC",
        ) as unknown,
        spend: { amount: String(parseUnits("12", 18)), decimals: 18 },
      });
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

  it("holds a standing allowance granted through Permit2 to the token's limit", async () => {
    // Permit2's AllowanceTransfer: the wallet's approve (or a permit it signed) lets a spender take
    // up to the amount of the token through Permit2, with no later signature, wherever the wallet
    // approved Permit2 for the token, as run --fund permit2 leaves it. Its events are Permit2's own,
    // whose topics its deployed code carries.
    const PERMIT2_APPROVAL = keccak256(toBytes("Approval(address,address,address,uint160,uint48)"));
    const PERMIT2_PERMIT = keccak256(
      toBytes("Permit(address,address,address,uint160,uint48,uint48)"),
    );
    const runtime = (
      JSON.parse(readFileSync(new URL("./fixtures/cli/Permit2.json", import.meta.url), "utf8")) as {
        runtime: string;
      }
    ).runtime.toLowerCase();
    expect([PERMIT2_APPROVAL, PERMIT2_PERMIT].map((one) => runtime.includes(one.slice(2)))).toEqual(
      [true, true],
    );
    const grant = (event: Hex, spender: Address, amount: bigint) => ({
      address: PERMIT2,
      topics: [event, topic(WALLET), topic(USDC), topic(spender)] as Hex[],
      data:
        event === PERMIT2_APPROVAL
          ? encodeAbiParameters([{ type: "uint160" }, { type: "uint48" }], [amount, 2 ** 40])
          : encodeAbiParameters(
              [{ type: "uint160" }, { type: "uint48" }, { type: "uint48" }],
              [amount, 2 ** 40, 0],
            ),
    });
    const guard = guarded({ tokens: { USDC: { perTransaction: "10" } } });
    const verdict = (logs: Log[]) =>
      guard.evm(client(logs), { to: PERMIT2, data: "0x", value: 0n }).then(
        () => "let through",
        (error: unknown) => (error instanceof PolicyRefusal ? error.message : String(error)),
      );
    const over = 2n ** 160n - 1n;

    expect({
      approved: await verdict([grant(PERMIT2_APPROVAL, RECIPIENT, over)]),
      permitted: await verdict([grant(PERMIT2_PERMIT, RECIPIENT, over)]),
      within: await verdict([grant(PERMIT2_APPROVAL, RECIPIENT, parseUnits("10", 6))]),
    }).toEqual({
      approved: expect.stringContaining(`this transaction approves ${RECIPIENT} for `) as unknown,
      permitted: expect.stringContaining(`this transaction approves ${RECIPIENT} for `) as unknown,
      within: "let through",
    });
  });

  it("holds each allowance as its own permission, whoever grants it and through which contract", async () => {
    // An allowance on the token and one through Permit2 are two permissions; so are the wallet's and
    // its Pot's. A change to one leaves the others as they are, and they share one cap.
    const SPENDER = getAddress("0x5555555555555555555555555555555555555555");
    const PERMIT2_APPROVAL = keccak256(toBytes("Approval(address,address,address,uint160,uint48)"));
    const viaPermit2 = (owner: Address, amount: bigint) => ({
      address: PERMIT2,
      topics: [PERMIT2_APPROVAL, topic(owner), topic(USDC), topic(SPENDER)] as Hex[],
      data: encodeAbiParameters([{ type: "uint160" }, { type: "uint48" }], [amount, 2 ** 40]),
    });
    const cook = {
      to: POT,
      data: encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [RECIPIENT, "0x"] }),
      value: 0n,
    };
    const guard = guarded({ tokens: { USDC: { perTransaction: "10" } } });
    const verdict = (logs: Log[]) =>
      guard.evm(client(logs), cook).then(
        () => "let through",
        (error: unknown) => (error instanceof PolicyRefusal ? error.limit : String(error)),
      );
    const twenty = parseUnits("20", 6);
    const six = parseUnits("6", 6);

    expect({
      erc20ThenPermit2Zero: await verdict([
        approval(USDC, POT, SPENDER, twenty),
        viaPermit2(POT, 0n),
      ]),
      permit2ZeroThenErc20: await verdict([
        viaPermit2(POT, 0n),
        approval(USDC, POT, SPENDER, twenty),
      ]),
      walletAndPot: await verdict([
        approval(USDC, WALLET, SPENDER, six),
        approval(USDC, POT, SPENDER, six),
      ]),
      erc20AndPermit2: await verdict([approval(USDC, POT, SPENDER, six), viaPermit2(POT, six)]),
    }).toEqual({
      erc20ThenPermit2Zero: "tokens.USDC",
      permit2ZeroThenErc20: "tokens.USDC",
      walletAndPot: "tokens.USDC.perTransaction",
      erc20AndPermit2: "tokens.USDC.perTransaction",
    });
  });

  it("counts the allowance a transaction leaves, as the chain holds it after, not the last it reported", async () => {
    // A spender pulls what it was allowed with no Approval of what is left (Permit2 never reports
    // one, nor do many tokens), or Permit2's lockdown zeroes it: the allowance after the transaction,
    // read in the same rehearsal, is what the spender keeps.
    const SPENDER = getAddress("0x5555555555555555555555555555555555555555");
    const PERMIT2_APPROVAL = keccak256(toBytes("Approval(address,address,address,uint160,uint48)"));
    const LOCKDOWN = keccak256(toBytes("Lockdown(address,address,address)"));
    const viaPermit2 = (amount: bigint) => ({
      address: PERMIT2,
      topics: [PERMIT2_APPROVAL, topic(POT), topic(USDC), topic(SPENDER)] as Hex[],
      data: encodeAbiParameters([{ type: "uint160" }, { type: "uint48" }], [amount, 2 ** 40]),
    });
    const lockdown = {
      address: PERMIT2,
      topics: [LOCKDOWN, topic(POT)] as Hex[],
      data: encodeAbiParameters([{ type: "address" }, { type: "address" }], [USDC, SPENDER]),
    };
    const cook = {
      to: POT,
      data: encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [RECIPIENT, "0x"] }),
      value: 0n,
    };
    const guard = guarded({ tokens: { USDC: { perTransaction: "7" } } });
    const verdict = (logs: Log[], remaining?: bigint | null) =>
      guard.evm(client(logs, 18, [], remaining), cook).then(
        () => "let through",
        (error: unknown) => (error instanceof PolicyRefusal ? error.limit : String(error)),
      );
    const usdc = (whole: string) => parseUnits(whole, 6);
    const spent = (amount: bigint) => transfer(USDC, POT, SPENDER, amount);

    expect({
      // 6 allowed and all of it pulled: 6 moved, nothing left (not 6 + 6 = 12 against 7).
      pulledWhole: await verdict([approval(USDC, POT, SPENDER, usdc("6")), spent(usdc("6"))], 0n),
      // 6 allowed and 2 pulled: 2 moved and 4 left, 6 in all (not 6 + 2 = 8).
      pulledPart: await verdict(
        [approval(USDC, POT, SPENDER, usdc("6")), spent(usdc("2"))],
        usdc("4"),
      ),
      throughPermit2: await verdict([viaPermit2(usdc("6")), spent(usdc("6"))], 0n),
      // 20 allowed through Permit2, then locked down: nothing left to take.
      lockedDown: await verdict([viaPermit2(usdc("20")), lockdown], 0n),
      revoked: await verdict(
        [approval(USDC, POT, SPENDER, usdc("20")), approval(USDC, POT, SPENDER, 0n)],
        0n,
      ),
      // Where the allowance after cannot be read, the last one reported counts.
      unread: await verdict([approval(USDC, POT, SPENDER, usdc("6")), spent(usdc("6"))], null),
    }).toEqual({
      pulledWhole: "let through",
      pulledPart: "let through",
      throughPermit2: "let through",
      lockedDown: "let through",
      revoked: "let through",
      unread: "tokens.USDC.perTransaction",
    });
  });

  it("holds an approval and a transfer of a token together, and reserves the approval in the day's total", async () => {
    const SPENDER = getAddress("0x5555555555555555555555555555555555555555");
    const six = parseUnits("6", 6);
    const verdict = (guard: SendGuard, logs: Log[]) =>
      guard.evm(client(logs), pay).then(
        (reservation) => {
          reservation.sent("0xaa");

          return "let through";
        },
        (error: unknown) => (error instanceof PolicyRefusal ? error.limit : String(error)),
      );
    // 6 USDC sent and 6 more approved: each within 10, together past it.
    const together = await verdict(guarded({ tokens: { USDC: { perTransaction: "10" } } }), [
      transfer(USDC, WALLET, RECIPIENT, six),
      approval(USDC, WALLET, SPENDER, six),
    ]);
    // A day's 10: an approval of 6, reserved, leaves room for 4, so a second approval of 6 is
    // refused.
    rmSync(join(dir, "agent.ledger.jsonl"), { force: true });
    const perDay = guarded({ tokens: { USDC: { perDay: "10" } } });
    const first = await verdict(perDay, [approval(USDC, WALLET, SPENDER, six)]);
    const reserved = ledger().find((line) => line.state === "reserved")?.spend;
    const second = await verdict(perDay, [approval(USDC, WALLET, RECIPIENT, six)]);
    // An approval spent in the same transaction counts once, as what it moved: the allowance the
    // token reports last is what the spender keeps. And one to the wallet's own Pot gives no other
    // key anything.
    rmSync(join(dir, "agent.ledger.jsonl"), { force: true });
    const capped = guarded({ tokens: { USDC: { perTransaction: "10" } } });
    const spentAtOnce = await verdict(capped, [
      approval(USDC, WALLET, SPENDER, six),
      transfer(USDC, WALLET, RECIPIENT, six),
      approval(USDC, WALLET, SPENDER, 0n),
    ]);
    const toOwnPot = await verdict(capped, [approval(USDC, WALLET, POT, maxUint256)]);

    expect({ together, first, reserved, second, spentAtOnce, toOwnPot }).toEqual({
      together: "tokens.USDC.perTransaction",
      first: "let through",
      reserved: { "tokens.USDC": { amount: String(six), decimals: 6 } },
      second: "tokens.USDC",
      spentAtOnce: "let through",
      toOwnPot: "let through",
    });
  });

  it("holds a token named by address, its decimals read from it", async () => {
    const guard = guarded({ tokens: { [OTHER_TOKEN]: { perTransaction: "1" } } });
    const over = client([transfer(OTHER_TOKEN, WALLET, RECIPIENT, parseUnits("1.5", 8))], 8);
    expect((await refused(guard.evm(over, pay))).limit).toBe(
      `tokens.${OTHER_TOKEN.toLowerCase()}.perTransaction`,
    );
  });

  it("refuses an approval of a token whose decimals cannot be read, where that token is limited", async () => {
    // A token outside the registry, named by address, whose decimals() reads nothing: a limit
    // cannot weigh what its approval gives, so it refuses it rather than let it through.
    const approves = (spender: Address) =>
      client([approval(OTHER_TOKEN, WALLET, spender, maxUint256)], null);
    const byAddress = guarded({ tokens: { [OTHER_TOKEN]: { perTransaction: "1" } } });
    const verdict = (guard: SendGuard, spender: Address) =>
      guard.evm(approves(spender), pay).then(
        () => "let through",
        (error: unknown) => (error instanceof PolicyRefusal ? error.message : String(error)),
      );
    const limited = await verdict(byAddress, RECIPIENT);
    // An approval of Permit2 still moves nothing without a later signature; another token's limit
    // has nothing to say.
    const toPermit2 = await verdict(byAddress, PERMIT2);
    const elsewhere = await verdict(
      guarded({ tokens: { USDC: { perTransaction: "1" } } }),
      RECIPIENT,
    );
    expect({ limited, toPermit2, elsewhere }).toEqual({
      limited: expect.stringContaining(
        `the decimals of ${OTHER_TOKEN} could not be read, so it cannot be held to the limit`,
      ) as unknown,
      toPermit2: "let through",
      elsewhere: "let through",
    });
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

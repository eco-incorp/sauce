/**
 * `--fund` signs and sends only for the wallet's own Pot, offline.
 *
 * `planFunding` is where every funding signature and transaction is made: a Permit2 transfer or an
 * EIP-2612 permit signed naming the Pot as its spender, an approval of the Pot or a transfer to it
 * sent. A contract whose `owner()` answers the wallet is not the wallet's Pot: whoever deployed it
 * could redeem what is signed for it. Each case gives `planFunding` a client that answers for a
 * chosen contract, and an account that records every signature asked of it; a refusal leaves that
 * record empty. The same refusals from `sauce run` and `sauce simulate`, on a chain, in every mode,
 * are in `cli-funding.e2e.test.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContractFunctionZeroDataError,
  getAddress,
  maxUint256,
  pad,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { parseFund, planFunding, type FundingInput } from "../src/cli/funding.js";
import { guardWallet, PolicyRefusal, readPolicy } from "../src/cli/policy.js";
import type { WalletInfo } from "../src/cli/wallets.js";
import { v12KitchenAddress } from "../src/deployments/index.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";

const ETHEREUM = requireChain("ethereum");
const RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");
const SALT = pad("0x00", { size: 32 });
/** An address no Pot is at. */
const SPOOF = getAddress("0x5900000000000000000000000000000000000001");
const FAILING = new Error("fetch failed: 429");

/** A fresh key, wrapped to record each signature asked of it (`signTypedData`, `signTransaction`). */
function recording(): { account: PrivateKeyAccount; calls: string[] } {
  const calls: string[] = [];
  const account = new Proxy(privateKeyToAccount(generatePrivateKey()), {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== "string" || !property.startsWith("sign")) return value;

      return (...args: unknown[]) => {
        calls.push(property);

        return (value as (...given: unknown[]) => unknown).apply(target, args);
      };
    },
  });

  return { account, calls };
}

/** What the contract at the Pot's address answers to each getter: a value, or the endpoint failing.
 *  A getter left out answers no data, as a contract without it (or no contract) does. */
interface Contract {
  readonly owner?: Address | Error;
  readonly userSalt?: Hex | Error;
  readonly kitchen?: Address | Error;
}

/** A client that answers for the Pot as `contract`, and for a token the wallet holds plenty of with
 *  Permit2 already approved: the first thing a Permit2 funding does then is to sign. */
function client(contract: Contract): PublicClient {
  return {
    getBlock: async () => ({ timestamp: 1_000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "balanceOf":
          return 10n ** 12n;
        case "allowance":
          return maxUint256;
        case "nonceBitmap":
          return 0n;
        case "owner":
        case "userSalt":
        case "kitchen": {
          const answer = contract[functionName];
          if (answer instanceof Error) throw answer;
          if (answer === undefined) throw new ContractFunctionZeroDataError({ functionName });

          return answer;
        }
        default:
          throw new ContractFunctionZeroDataError({ functionName });
      }
    },
  } as unknown as PublicClient;
}

/** The funding of 1 USDC by Permit2 that `sauce run --fund USDC:1` plans, signed by `account`. */
const funding = (
  account: PrivateKeyAccount | undefined,
  pot: Address,
  contract: Contract,
  deploySalt?: Hex,
): FundingInput => ({
  chain: ETHEREUM,
  client: client(contract),
  rpcUrl: "http://127.0.0.1:1",
  owner: account?.address ?? RECIPIENT,
  pot,
  mode: "permit2",
  requests: [parseFund("USDC:1", ETHEREUM)],
  sweep: false,
  ...(account === undefined ? {} : { account }),
  ...(deploySalt === undefined ? {} : { deploySalt }),
  send: true,
  approver: { auto: true, canAsk: false, approve: async () => true },
});

/** The Pot `wallet` owns at the zero salt, and what it answers, as a Pot of the release does. */
const own = (wallet: Address): { pot: Address; contract: Contract } => ({
  pot: getAddress(v12PredictPot(wallet, SALT) as Address),
  contract: { owner: wallet, userSalt: SALT, kitchen: getAddress(v12KitchenAddress()) },
});

const notOwn = /is not 0x[0-9a-fA-F]{40}'s own Pot of a release this sauce records/;

describe("--fund signs and sends only for the wallet's own Pot", () => {
  it("signs for a Pot the chain shows is the wallet's: its owner, salt and Kitchen derive its address", async () => {
    const { account, calls } = recording();
    const { pot, contract } = own(account.address);
    const planned = await planFunding(funding(account, pot, contract));
    expect(calls).toEqual(["signTypedData"]);
    expect(planned.signed).toBe(true);
  });

  it("refuses a contract whose owner() is the wallet at an address no release's Kitchen derives, before signing", async () => {
    const { account, calls } = recording();
    // What anyone can deploy: it says it is the wallet's, at the wallet's salt under the released
    // Kitchen, and that Kitchen never minted anything at SPOOF.
    const { contract } = own(account.address);
    await expect(planFunding(funding(account, SPOOF, contract))).rejects.toThrow(
      `Pot ${SPOOF} is not ${account.address}'s own Pot of a release this sauce records`,
    );
    expect(calls).toEqual([]);
  });

  it("refuses a contract at the wallet's address that names a Kitchen no release records, before signing", async () => {
    const { account, calls } = recording();
    const { pot, contract } = own(account.address);
    await expect(
      planFunding(funding(account, pot, { ...contract, kitchen: SPOOF })),
    ).rejects.toThrow(notOwn);
    expect(calls).toEqual([]);
  });

  it("refuses another owner's Pot, a contract that is no Pot, and an address with no code, before signing", async () => {
    const { account, calls } = recording();
    const { pot, contract } = own(account.address);
    for (const [at, answers] of [
      [pot, { ...contract, owner: RECIPIENT }],
      [SPOOF, {}],
      [pot, {}],
    ] as const) {
      await expect(planFunding(funding(account, at, answers))).rejects.toThrow(notOwn);
    }
    expect(calls).toEqual([]);
  });

  it.each([
    ["owner()", { owner: FAILING }],
    ["userSalt()", { userSalt: FAILING }],
    ["kitchen()", { kitchen: FAILING }],
  ] as const)(
    "refuses a Pot whose %s the endpoint failed to read, before signing",
    async (_getter, broken) => {
      const { account, calls } = recording();
      const { pot, contract } = own(account.address);
      await expect(planFunding(funding(account, pot, { ...contract, ...broken }))).rejects.toThrow(
        `could not tell whether Pot ${pot} is ${account.address}'s own`,
      );
      expect(calls).toEqual([]);
    },
  );

  it("signs for the Pot the same run deploys first: no code yet, at the wallet's v12PredictPot for the salt", async () => {
    const { account, calls } = recording();
    const salt = potSalt("deployed-first");
    const pot = getAddress(v12PredictPot(account.address, salt) as Address);
    await planFunding(funding(account, pot, {}, salt));
    expect(calls).toEqual(["signTypedData"]);
    // Another salt does not put the wallet's Pot there, and neither does another owner's.
    await expect(planFunding(funding(account, pot, {}, potSalt("elsewhere")))).rejects.toThrow(
      notOwn,
    );
    const others = getAddress(v12PredictPot(RECIPIENT, salt) as Address);
    await expect(planFunding(funding(account, others, {}, salt))).rejects.toThrow(notOwn);
    expect(calls).toEqual(["signTypedData"]);
  });

  it("leaves a simulation with no key as it was: it signs nothing, and credits the Pot", async () => {
    const planned = await planFunding(funding(undefined, SPOOF, {}));
    expect(planned.credit?.map((each) => [each.label, each.amount.toString()])).toEqual([
      ["USDC", "1000000"],
    ]);
  });
});

describe("--fund is held to the wallet's policy before it signs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-funding-auth-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Guards `account`'s wallet with the policy `fields`. */
  const guard = (account: PrivateKeyAccount, fields: Record<string, unknown>): void => {
    const info: WalletInfo = {
      name: "agent",
      kind: "evm",
      address: account.address,
      path: join(dir, "agent.json"),
      policyPath: join(dir, "agent.policy.json"),
    };
    writeFileSync(info.policyPath, JSON.stringify(fields), { mode: 0o600 });
    guardWallet(info, readPolicy(info));
  };

  it("refuses a wallet whose policy's `to` leaves out its own Pot, before any signature", async () => {
    const { account, calls } = recording();
    const { pot, contract } = own(account.address);
    guard(account, { to: [RECIPIENT.toLowerCase()] });
    const refusal = await planFunding(funding(account, pot, contract)).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(PolicyRefusal);
    expect((refusal as PolicyRefusal).limit).toBe("to");
    expect((refusal as PolicyRefusal).message).toMatch(
      /^refused by the policy of wallet agent \(.*\): to allows 1 address\(es\), and this funding is for Pot /,
    );
    expect(calls).toEqual([]);
  });

  it("refuses a wallet whose policy's `chains` leaves out the chain, before any signature", async () => {
    const { account, calls } = recording();
    const { pot, contract } = own(account.address);
    guard(account, { chains: ["base"] });
    await expect(planFunding(funding(account, pot, contract))).rejects.toThrow(
      /refused by the policy of wallet agent \(.*\): chains allows base, and this funding is on ethereum/,
    );
    expect(calls).toEqual([]);
  });

  it("signs for a wallet whose policy allows its Pot: native and token limits are its cook's to weigh", async () => {
    const { account, calls } = recording();
    const { pot, contract } = own(account.address);
    guard(account, {
      to: [pot.toLowerCase()],
      native: { perTransaction: "1" },
      tokens: { USDC: { perTransaction: "5" } },
    });
    await planFunding(funding(account, pot, contract));
    expect(calls).toEqual(["signTypedData"]);
  });
});

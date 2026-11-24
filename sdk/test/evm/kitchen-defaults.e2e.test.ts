/**
 * The SDK's default prediction is the Kitchen's own (the acceptance of SAU-141): on the stack the
 * SDK pins, stood up from the release's creation code on a local anvil, `v12PredictPot` gives every
 * Pot where the Kitchen says it places it — a Private Pot, one with its Router fixed, a Shared Pot —
 * and the Kitchen's `deployPot` lands the Pot there, a 2,886-byte contract with its owner, salt and
 * Kitchen as the SDK says.
 *
 * Funds sent to a predicted address are safe only if a Pot is deployed there, and no SDK can know
 * that without the Kitchen's own word: SDK 1.1.0 predicted CREATE2 under the Pot's init-code hash
 * while every chain's Kitchen placed Pots by CREATE3, so its default addresses could never hold a
 * Pot. This suite holds the default to what the release's own Kitchen does.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { DEFAULT_POT_SALT, potSalt, v12PredictPot } from "../../src/deployments/pot.js";
import { v12KitchenAbi, v12PotAbi } from "../../src/evm/engine.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { startGatedEngine, type GatedEngine } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}

/** Anvil's first dev account: the harness's deployer and the Kitchen's owner. */
const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** Owners whose Pots are placed and deployed: any account may deploy a Pot for any owner. */
const OWNERS: readonly Address[] = [
  DEPLOYER.address,
  getAddress("0x000000000000000000000000000000000000dEaD"),
];
const SALTS: readonly Hex[] = [DEFAULT_POT_SALT, potSalt("treasury")];
/** The size of the released Pot's runtime, every kind. */
const POT_CODE_BYTES = 2_886;

const PORT = freePortSync();
const transport = http(`http://127.0.0.1:${PORT}`, {
  fetchOptions: { headers: { connection: "close" } },
});
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: DEPLOYER, transport });

let anvil: ChildProcess;
let stack: GatedEngine;

const predictPot = (owner: Address, salt: Hex, routerFixed?: boolean): Promise<Address> =>
  routerFixed === undefined
    ? publicClient.readContract({
        abi: v12KitchenAbi,
        address: stack.kitchen,
        functionName: "predictPot",
        args: [owner, salt],
      })
    : publicClient.readContract({
        abi: v12KitchenAbi,
        address: stack.kitchen,
        functionName: "predictPot",
        args: [owner, salt, routerFixed],
      });

/** Sends `data` to the Kitchen and returns the runtime code at `pot` afterwards. */
async function deployedAt(data: Hex, pot: Address): Promise<Hex | undefined> {
  const hash = await walletClient.sendTransaction({
    account: DEPLOYER,
    chain: null,
    data,
    gas: 10_000_000n,
    to: stack.kitchen,
  });
  const { status } = await publicClient.waitForTransactionReceipt({ hash });
  expect(status).toBe("success");

  return publicClient.getCode({ address: pot });
}

const bytesOf = (code: Hex | undefined): number | undefined =>
  code === undefined ? undefined : (code.length - 2) / 2;

describeEvm("the default prediction is the Kitchen's own", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    stack = await startGatedEngine(
      { publicClient, testClient, walletClient },
      DEPLOYER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it.each(OWNERS.flatMap((owner) => SALTS.map((salt) => [owner, salt] as const)))(
    "v12PredictPot(%s, %s) is where the Kitchen places the Pot, and deployPot lands it there",
    async (owner, salt) => {
      const predicted = getAddress(v12PredictPot(owner, salt));
      expect(predicted).toBe(getAddress(await predictPot(owner, salt)));
      expect(await publicClient.getCode({ address: predicted })).toBeUndefined();

      const code = await deployedAt(
        encodeFunctionData({ abi: v12KitchenAbi, functionName: "deployPot", args: [owner, salt] }),
        predicted,
      );
      expect(bytesOf(code)).toBe(POT_CODE_BYTES);
      // The Pot says whose it is, under which salt, from which Kitchen: what the SDK told it by.
      const read = (functionName: "owner" | "userSalt" | "kitchen") =>
        publicClient.readContract({ abi: v12PotAbi, address: predicted, functionName });
      expect(getAddress((await read("owner")) as Address)).toBe(owner);
      expect(await read("userSalt")).toBe(salt);
      expect(getAddress((await read("kitchen")) as Address)).toBe(stack.kitchen);
    },
    60_000,
  );

  it.each(OWNERS.flatMap((owner) => SALTS.map((salt) => [owner, salt] as const)))(
    "{ routerFixed: true } for (%s, %s) is the Kitchen's fixed-Router Pot",
    async (owner, salt) => {
      const predicted = getAddress(v12PredictPot(owner, salt, { routerFixed: true }));
      expect(predicted).toBe(getAddress(await predictPot(owner, salt, true)));
      // Another Pot than the mutable-Router one at the same owner and salt.
      expect(predicted).not.toBe(getAddress(v12PredictPot(owner, salt)));

      const code = await deployedAt(
        encodeFunctionData({
          abi: v12KitchenAbi,
          functionName: "deployPot",
          args: [owner, salt, true],
        }),
        predicted,
      );
      expect(bytesOf(code)).toBe(POT_CODE_BYTES);
    },
    60_000,
  );

  it.each(SALTS)(
    "the zero owner at %s is the Kitchen's Shared Pot",
    async (salt) => {
      const predicted = getAddress(v12PredictPot(zeroAddress, salt));
      const shared = await publicClient.readContract({
        abi: v12KitchenAbi,
        address: stack.kitchen,
        functionName: "predictSharedPot",
        args: [salt],
      });
      expect(predicted).toBe(getAddress(shared));

      const code = await deployedAt(
        encodeFunctionData({ abi: v12KitchenAbi, functionName: "deploySharedPot", args: [salt] }),
        predicted,
      );
      expect(bytesOf(code)).toBe(POT_CODE_BYTES);
    },
    60_000,
  );
});

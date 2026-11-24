/**
 * `setUpStack` on a chain that already runs the release: the stack there is used as it is and
 * nothing is deployed over it. SDK 1.1.0's kit compared only the Kitchen's `potInitCodeHash()` with
 * the engine's gate, so on a fork of a chain past kitchen-evm 1.4.0's rollout it redeployed the
 * release it pinned over the live one. The stack counts as live only when the Kitchen also places
 * Pots where this package's `v12PredictPot` does.
 *
 * Runs wherever anvil does; skips without it locally, and fails under CI, where it must run.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  http,
  keccak256,
  pad,
  stringToBytes,
  type Abi,
  type Address,
  type Hex,
  type TestClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { local, type TestChain } from "../../src/testing/index.js";
import { deployReleaseStack } from "../../src/testing/sdk.js";
import { setUpStack } from "../../src/testing/stack.js";
import { anvilMissing } from "./support.js";

/** EIP-1967's implementation slot, which the Kitchen's UUPS proxy delegates through. */
const IMPLEMENTATION_SLOT: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** Where the mispredicting Kitchen says every Pot is: an address with no code. */
const ELSEWHERE = getAddress("0x00000000000000000000000000000000005e1f00");
/** A Kitchen implementation that delegates to the real one but places every Pot at ELSEWHERE and
 *  reports the Pot init-code hash it is given (`sdk/test/evm/fixtures`). */
const MISPREDICTING = JSON.parse(
  readFileSync(
    new URL("../../../sdk/test/evm/fixtures/MispredictingKitchen.json", import.meta.url),
    "utf8",
  ),
) as { abi: Abi; creationCode: Hex };

describe("setUpStack on a chain that runs the release", { skip: anvilMissing() }, () => {
  let chain: TestChain;
  before(async () => {
    chain = await local();
  });
  after(() => chain?.stop());

  const setUp = () => setUpStack(chain.rpcUrl, chain.client, chain.test, chain.account(0).address);

  /** The Kitchen's implementation, and the code of every contract of the stack, as they stand. */
  const stackNow = async () => {
    const slot = await chain.client.getStorageAt({
      address: chain.kitchen,
      slot: IMPLEMENTATION_SLOT,
    });
    const implementation = getAddress(`0x${(slot ?? "0x").slice(-40)}`);
    const codes = await Promise.all(
      [chain.engine, chain.router, chain.kitchen, implementation].map((address) =>
        chain.client.getCode({ address }),
      ),
    );

    return { slot, implementation, codes };
  };

  /** Points the Kitchen proxy at a mispredicting implementation that reports `reported`. */
  const plant = async (reported: Hex): Promise<void> => {
    const { implementation } = await stackNow();
    const wallet = createWalletClient({
      account: privateKeyToAccount(chain.account(0).privateKey),
      transport: http(chain.rpcUrl),
    });
    const hash = await wallet.deployContract({
      abi: MISPREDICTING.abi,
      bytecode: MISPREDICTING.creationCode,
      args: [implementation, ELSEWHERE, reported],
      chain: null,
    });
    const planted = (await chain.client.waitForTransactionReceipt({ hash })).contractAddress;
    assert.ok(planted, "the mispredicting Kitchen was not deployed");
    await chain.test.setStorageAt({
      address: chain.kitchen,
      index: IMPLEMENTATION_SLOT,
      value: pad(planted as Address),
    });
  };

  it("on a fork past its rollout the kit uses the live stack and deploys nothing", async () => {
    // `local()` deployed the release here; the chain is now as a fork of one that runs it.
    assert.equal(chain.stack.origin, "deployed");
    const before = await stackNow();
    assert.ok(before.codes.every((code) => code !== undefined && code !== "0x"));
    const again = await setUp();
    assert.equal(again.origin, "live");
    assert.equal(again.kitchen, chain.kitchen);
    assert.equal(again.engine, chain.engine);
    assert.equal(again.router, chain.router);
    assert.equal(again.scheme, "create3");
    // Not one byte of the stack, and not the Kitchen's implementation, moved.
    assert.deepEqual(await stackNow(), before);
  });

  it("deploys over a Kitchen that places a Pot elsewhere than this package predicts, though it reports the same hash", async () => {
    // Only the Kitchen's own `predictPot` tells it from the release's.
    await plant(chain.stack.potInitCodeHash);
    const stack = await setUp();
    assert.equal(stack.origin, "deployed");
    // The deployment put the release back: the next call finds it live.
    assert.equal((await setUp()).origin, "live");
  });

  it("deploys over a Kitchen that reports another Pot init-code hash", async () => {
    await plant(keccak256(stringToBytes("a Pot release no SDK records")));
    const stack = await setUp();
    assert.equal(stack.origin, "deployed");
    assert.equal((await setUp()).origin, "live");
  });
});

/** The 1.4.0 release's artifacts, which `sync-engine-artifacts` writes for the SDK's suites. */
const EARLIER = new URL("../../../sdk/src/artifacts/legacy/2.6.3/", import.meta.url);
const earlierPresent = existsSync(new URL("V12RuntimeBytecode.json", EARLIER));
if (!earlierPresent && process.env.CI) {
  throw new Error(
    "the 1.4.0 release's artifacts (sdk/src/artifacts/legacy/2.6.3) are missing in CI. This suite " +
      'must never skip here — see the "Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}
const earlier = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`${name}.json`, EARLIER), "utf8")) as T;

describe(
  "setUpStack on a fork whose Kitchen hands out an earlier Router",
  {
    skip:
      anvilMissing() || (earlierPresent ? false : "the 1.4.0 release's artifacts are not synced"),
  },
  () => {
    let chain: TestChain;
    before(async () => {
      chain = await local();
    });
    after(() => chain?.stop());

    it("on a fork of a Kitchen that hands out an earlier Router, the kit switches it and clears no code", async () => {
      const owner = chain.account(0).address;
      const wallet = createWalletClient({ transport: http(chain.rpcUrl) });
      const clients = { publicClient: chain.client, walletClient: wallet, testClient: chain.test };
      const codeOf = async (address: Address): Promise<Hex> =>
        (await chain.client.getCode({ address })) ?? "0x";

      // The chain as a fork of one before its switch: the release's engine and Router are not there
      // (the rollout adds them, each by CREATE3 through a proxy child CreateX makes, which is not
      // there either), and the Kitchen runs the 1.4.0 release, a dynamic Pot minted on it.
      const [engine, router] = [chain.engine, chain.router];
      const installed = JSON.parse(
        readFileSync(
          new URL("../../../sdk/dist/artifacts/V12Deployments.json", import.meta.url),
          "utf8",
        ),
      ) as {
        evm: { factory: Address; contracts: Record<"engine" | "router", { guardedSalt: Hex }> };
      };
      const childOf = (guardedSalt: Hex): Address =>
        getCreate2Address({
          bytecodeHash: keccak256("0x67363d3d37363d34f03d5260086018f3"),
          from: installed.evm.factory,
          salt: guardedSalt,
        });
      for (const address of [
        engine,
        router,
        childOf(installed.evm.contracts.engine.guardedSalt),
        childOf(installed.evm.contracts.router.guardedSalt),
      ]) {
        await chain.test.setCode({ address, bytecode: "0x" });
      }
      const stack = await deployReleaseStack(clients, owner, {
        deployments: earlier<{ evm: Parameters<typeof deployReleaseStack>[2]["deployments"] }>(
          "V12Deployments",
        ).evm,
        runtimeCreationCode: earlier<{ runtimeCreationCode: Hex }>("V12RuntimeBytecode")
          .runtimeCreationCode,
        routerBytecode: earlier<{ bytecode: Hex }>("Router").bytecode,
        kitchen: earlier<{ abi: Abi; bytecode: Hex }>("V12Kitchen"),
        kitchenProxyBytecode: earlier<{ bytecode: Hex }>("V12KitchenProxy").bytecode,
      });
      assert.equal(stack.kitchen, chain.kitchen);
      assert.notEqual(stack.router, router);
      const kitchenAbi = earlier<{ abi: Abi }>("V12Kitchen").abi;
      const salt = pad("0x07");
      const minted = await chain.client.waitForTransactionReceipt({
        hash: await wallet.sendTransaction({
          account: owner,
          chain: null,
          to: stack.kitchen,
          data: encodeFunctionData({
            abi: kitchenAbi,
            functionName: "deployPot",
            args: [owner, salt],
          }),
          gas: 30_000_000n,
        }),
      });
      assert.equal(minted.status, "success");
      const pot = (await chain.client.readContract({
        abi: kitchenAbi,
        address: stack.kitchen,
        functionName: "predictPot",
        args: [owner, salt],
      })) as Address;
      const routerOf = (at: Address) =>
        chain.client.readContract({ abi: kitchenAbi, address: at, functionName: "router" });
      assert.equal(
        await routerOf(pot),
        stack.router,
        "a Pot starts on the Router the Kitchen hands out",
      );

      const slotOf = () =>
        chain.client.getStorageAt({ address: stack.kitchen, slot: IMPLEMENTATION_SLOT });
      const implementation = getAddress(`0x${((await slotOf()) ?? "0x").slice(-40)}`);
      const before = {
        kitchen: await codeOf(stack.kitchen),
        implementation: await codeOf(implementation),
        engine: await codeOf(stack.engine),
        router: await codeOf(stack.router),
        pot: await codeOf(pot),
        slot: await slotOf(),
      };

      // The kit sets the chain up, its test client recording every `setCode` and whether code was
      // there: clearing code that exists and creating it again is what a redeploy does, and unchanged
      // bytes afterwards would not show it.
      const cleared: Array<{ address: Address; hadCode: boolean }> = [];
      const recording = new Proxy(chain.test, {
        get(target, property, receiver) {
          if (property !== "setCode") return Reflect.get(target, property, receiver);

          return async (args: Parameters<TestClient["setCode"]>[0]) => {
            const code = await chain.client.getCode({ address: args.address });
            cleared.push({ address: args.address, hadCode: code !== undefined && code !== "0x" });

            return target.setCode(args);
          };
        },
      }) as TestClient;
      const now = await setUpStack(chain.rpcUrl, chain.client, recording, owner);

      // (1) Nothing that had code was cleared and created again, and nothing of the earlier stack or
      // the Kitchen was touched.
      assert.deepEqual(
        cleared.filter(
          (call) =>
            call.hadCode ||
            [stack.kitchen, implementation, stack.engine, stack.router].includes(call.address),
        ),
        [],
      );
      // (2) The kit switched the Kitchen to the release's Router and put the release's engine there.
      assert.equal(now.origin, "deployed");
      assert.equal(await routerOf(chain.kitchen), router);
      assert.equal(now.router, router);
      assert.equal(now.engine, engine);
      assert.notEqual(await codeOf(engine), "0x");
      assert.notEqual(await codeOf(router), "0x");
      // (3) The Kitchen's proxy and what it delegates to are as they were, and the Pot keeps the
      // Router it was minted with.
      assert.equal(await codeOf(stack.kitchen), before.kitchen);
      assert.equal(await slotOf(), before.slot);
      assert.equal(await codeOf(implementation), before.implementation);
      assert.equal(await codeOf(stack.engine), before.engine);
      assert.equal(await codeOf(stack.router), before.router);
      assert.equal(await codeOf(pot), before.pot);
      assert.equal(await routerOf(pot), stack.router);
      // The next call finds the release live.
      assert.equal(
        (await setUpStack(chain.rpcUrl, chain.client, chain.test, owner)).origin,
        "live",
      );
    });
  },
);

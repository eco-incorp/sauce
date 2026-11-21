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
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
  pad,
  stringToBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { local, type TestChain } from "../../src/testing/index.js";
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

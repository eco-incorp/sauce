/**
 * Stands up the released v12 EVM stack on an anvil — engine, Router, Kitchen implementation and
 * Kitchen proxy — for suites that execute compiler-emitted bytecode.
 *
 * NOT a `.test.ts`, so jest never collects it.
 *
 * **The engine cannot be called directly.** It re-derives `CREATE2(KITCHEN, gateSalt(potId),
 * POT_INITCODEHASH)` and runs only when that lands on its caller, so an `eth_call` straight to the
 * engine reverts with empty returndata — no reason string, nothing to match on. Both constants are
 * baked into the released artifact, so the caller has to be a REAL Pot, minted by CREATE2 from the
 * one Kitchen address the engine was built against, with init code hashing to exactly the pinned
 * hash.
 *
 * **Everything is deployed from its creation code, at its release address**, by
 * `src/evm/release-stack.ts#deployReleaseStack` — CreateX's CREATE3 proxy child installed at each
 * release salt's address and sent the creation code — which `@eco-incorp/sauce/testing` deploys
 * with too. This reads the synced artifacts for it, checks the Kitchen landed where the engine gates,
 * and mints the harness Pot. The Kitchen is left with its owner (the harness account) and a zero
 * execution fee, so no cook needs `value`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
} from "viem";
import type { Abi, Address, Hex, PublicClient, TestClient, WalletClient } from "viem";

import { deployReleaseStack, type ReleaseStackArtifacts } from "../../src/evm/release-stack.js";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");

const artifact = (name: string): { abi: Abi; bytecode: Hex } =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")) as {
    abi: Abi;
    bytecode: Hex;
  };

/** `kitchen` and `potInitCodeHash`, written by `sync-engine-artifacts` from the engine release's
 *  own manifest: the two anchors the released engine gates every cook on. */
export const gateAnchors = (): { kitchen: Address; potInitCodeHash: Hex } =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, "V12EngineGate.json"), "utf8")) as {
    kitchen: Address;
    potInitCodeHash: Hex;
  };

/** The release's CREATE3 inputs, from `V12Deployments.json`. */
const deployments = (): ReleaseStackArtifacts["deployments"] =>
  (
    JSON.parse(readFileSync(resolve(ARTIFACTS, "V12Deployments.json"), "utf8")) as {
      evm: ReleaseStackArtifacts["deployments"];
    }
  ).evm;

/** The Pot salt every harness mints under. One Pot is enough: suites name their own accounts. */
export const POT_SALT = `0x${"00".repeat(31)}07` as Hex;

export interface GatedEngine {
  /** The engine, at its release address (`v12EngineAddress()`), deployed from creation code: its
   *  constructor bound that identity for the Pot's `EVAL` relay. */
  engine: Address;
  /** The Router the Kitchen hands every new Pot, at its release address. */
  router: Address;
  /** The Kitchen proxy, at the address the engine's gate hashes. Owned by the harness account. */
  kitchen: Address;
  /** The Pot every program runs as. `ctx.self()` is this, not the engine. */
  pot: Address;
  /** Wraps a program in the `cook` the Pot expects. */
  cookData: (program: Hex) => Hex;
  /** What a cook must pay. Zero here: the harness sets the Kitchen's fee to zero. */
  fee: bigint;
}

/**
 * Deploys the stack at its release addresses and mints the harness Pot.
 *
 * `owner` must be an account the caller can send from AND set as the `from` of an `eth_call`:
 * `Pot.cook` is `onlyOwner`, and viem's `publicClient.call` sends no `from` by default, so a read
 * that omits it reverts with `NotOwner()` rather than running anything. It also owns the Kitchen.
 */
export const startGatedEngine = async (
  clients: { publicClient: PublicClient; walletClient: WalletClient; testClient: TestClient },
  owner: Address,
  runtimeCreationCode: Hex,
): Promise<GatedEngine> => {
  const { publicClient, walletClient } = clients;
  const { kitchen: gateKitchen, potInitCodeHash } = gateAnchors();
  const kitchenAbi = artifact("V12Kitchen").abi;

  const send = async (to: Address, data: Hex): Promise<void> => {
    const hash = await walletClient.sendTransaction({
      account: owner,
      chain: null,
      data,
      gas: 30_000_000n,
      to,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`a harness transaction to ${to} reverted`);
  };

  const { engine, router, kitchen } = await deployReleaseStack(clients, owner, {
    deployments: deployments(),
    runtimeCreationCode,
    routerBytecode: artifact("Router").bytecode,
    kitchen: artifact("V12Kitchen"),
    kitchenProxyBytecode: artifact("V12KitchenProxy").bytecode,
  });
  if (kitchen !== getAddress(gateKitchen)) {
    throw new Error(`the Kitchen landed at ${kitchen}, but the engine gates on ${gateKitchen}`);
  }

  // The assertion that makes a mismatched Kitchen fail HERE, naming the cause, rather than surfacing
  // as an unexplained empty revert from the gate in whichever test runs first.
  const live = (await publicClient.readContract({
    abi: kitchenAbi,
    address: kitchen,
    functionName: "potInitCodeHash",
  })) as Hex;
  if (live.toLowerCase() !== potInitCodeHash.toLowerCase()) {
    throw new Error(
      `the Kitchen at ${kitchen} reports potInitCodeHash ${live}, but the engine was built ` +
        `against ${potInitCodeHash}: every Pot it mints would land at an address the gate rejects.`,
    );
  }

  await send(
    kitchen,
    encodeFunctionData({ abi: kitchenAbi, functionName: "deployPot", args: [owner, POT_SALT] }),
  );
  const pot = getCreate2Address({
    bytecodeHash: potInitCodeHash,
    from: kitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, POT_SALT]),
    ),
  });
  if (!(await publicClient.getCode({ address: pot }))) {
    throw new Error(`no Pot was minted at the derived address ${pot}`);
  }

  const potRouter = await publicClient.readContract({
    abi: artifact("V12Pot").abi,
    address: pot,
    functionName: "router",
  });
  if (String(potRouter).toLowerCase() !== router.toLowerCase()) {
    throw new Error("the Pot did not inherit the Kitchen's configured Router");
  }

  const fee = (await publicClient.readContract({
    abi: kitchenAbi,
    address: kitchen,
    functionName: "executionFee",
  })) as bigint;

  return {
    cookData: (program) =>
      encodeFunctionData({
        abi: artifact("V12Pot").abi,
        args: [engine, program],
        functionName: "cook",
      }),
    engine,
    fee,
    kitchen,
    pot,
    router,
  };
};

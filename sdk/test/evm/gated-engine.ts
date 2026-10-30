/**
 * Real artifact-backed local fixtures: explicit LOCAL CREATE3 candidates or retained published stacks.
 * Published stacks reconstruct pre-cutover deployed state only; they are not a future deployment lane.
 * Each contract runs its constructor at its recorded address through deployReleaseStack.
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
  zeroAddress,
} from "viem";
import type { Abi, Address, Hex, PublicClient, TestClient, WalletClient } from "viem";

import { deployReleaseStack, type ReleaseStackArtifacts } from "../../src/evm/release-stack.js";
import { v12PotGateSalt, v12PredictPot } from "../../src/deployments/pot.js";
import { v12ReleaseSet } from "../../src/deployments/releases.js";
import {
  verifyPotBinding,
  type EvmPotBinding,
  type EvmPotBindingInput,
} from "../../src/evm/pot-binding.js";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");

const artifact = (name: string): { abi: Abi; bytecode: Hex } =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")) as {
    abi: Abi;
    bytecode: Hex;
  };

/** Historical gate anchors, or the explicitly selected LOCAL candidate's Kitchen. */
export const gateAnchors = (): { kitchen: Address; potInitCodeHash?: Hex } => {
  const candidatePath = process.env.SAUCE_LOCAL_CANDIDATE;
  const directory = candidatePath ? dirname(resolve(candidatePath)) : ARTIFACTS;

  return JSON.parse(readFileSync(resolve(directory, "V12EngineGate.json"), "utf8")) as {
    kitchen: Address;
    potInitCodeHash?: Hex;
  };
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
  bindingOf: (pot: Address) => Promise<EvmPotBinding>;
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
  const bindingReader =
    (
      template: Omit<EvmPotBindingInput, "pot" | "owner" | "userSalt" | "kind" | "chainId">,
      abi: Abi,
    ) =>
    async (pot: Address): Promise<EvmPotBinding> => {
      const [owner, userSalt, gateSalt, router] = (await Promise.all(
        ["owner", "userSalt", "gateSalt", "router"].map((functionName) =>
          publicClient.readContract({ address: pot, abi, functionName }),
        ),
      )) as [Address, Hex, Hex, Address];
      const fixed = gateSalt.toLowerCase() === v12PotGateSalt(owner, userSalt, true).toLowerCase();

      return verifyPotBinding(publicClient, {
        ...template,
        pot,
        owner,
        userSalt,
        router,
        kind:
          getAddress(owner) === zeroAddress ? "shared" : fixed ? "private-fixed-router" : "private",
        chainId: await publicClient.getChainId(),
      });
    };
  const candidatePath = process.env.SAUCE_LOCAL_CANDIDATE;
  if (candidatePath) {
    const directory = dirname(resolve(candidatePath));
    const candidate = JSON.parse(readFileSync(resolve(candidatePath), "utf8")) as Omit<
      EvmPotBindingInput,
      "pot" | "owner" | "userSalt" | "kind" | "chainId"
    > & { source: string; deployments: ReleaseStackArtifacts["deployments"] };
    if (candidate.source !== "LOCAL" || candidate.profile?.scheme !== "create3") {
      throw new Error("expected an explicitly ingested LOCAL CREATE3 candidate");
    }
    const localArtifact = <T>(name: string): T =>
      JSON.parse(readFileSync(resolve(directory, `${name}.json`), "utf8")) as T;
    const kitchenArtifact = localArtifact<{ abi: Abi; bytecode: Hex }>("V12Kitchen");
    const potAbi = localArtifact<{ abi: Abi }>("V12Pot").abi;
    const actualCreation = localArtifact<{ runtimeCreationCode: Hex }>(
      "V12RuntimeBytecode",
    ).runtimeCreationCode;
    if (runtimeCreationCode.toLowerCase() !== actualCreation.toLowerCase()) {
      throw new Error("candidate engine creation bytes do not match the selected runtime fixture");
    }
    const { engine, router, kitchen } = await deployReleaseStack(clients, owner, {
      deployments: candidate.deployments,
      runtimeCreationCode,
      routerBytecode: localArtifact<{ bytecode: Hex }>("Router").bytecode,
      kitchen: kitchenArtifact,
      kitchenProxyBytecode: localArtifact<{ bytecode: Hex }>("V12KitchenProxy").bytecode,
    });
    const pot = getAddress(v12PredictPot(owner, POT_SALT, kitchen));
    const hash = await walletClient.sendTransaction({
      account: owner,
      chain: null,
      to: kitchen,
      data: encodeFunctionData({
        abi: kitchenArtifact.abi,
        functionName: "deployPot",
        args: [owner, POT_SALT],
      }),
    });
    if ((await publicClient.waitForTransactionReceipt({ hash })).status !== "success") {
      throw new Error("candidate CREATE3 Pot deployment reverted");
    }
    await verifyPotBinding(publicClient, {
      ...candidate,
      pot,
      owner,
      userSalt: POT_SALT,
      kind: "private",
      chainId: await publicClient.getChainId(),
    });

    return {
      engine,
      router,
      kitchen,
      pot,
      fee: 0n,
      bindingOf: bindingReader(candidate, potAbi),
      cookData: (program) =>
        encodeFunctionData({ abi: potAbi, functionName: "cook", args: [engine, program] }),
    };
  }
  // Published fixtures exercise retained old-deployed execution, not the current factory API.
  const { kitchen: gateKitchen, potInitCodeHash } = gateAnchors();
  if (!potInitCodeHash)
    throw new Error("retained published fixture is missing its historical gate hash");
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
    bindingOf: bindingReader(
      {
        compiler: "2.6.1",
        engine,
        kitchen,
        router,
        engineCodeHash: keccak256((await publicClient.getCode({ address: engine }))!),
        routerCodeHash: keccak256((await publicClient.getCode({ address: router }))!),
        release: {
          compiler: "2.6.1",
          "v12-evm": v12ReleaseSet("2.6.1")["v12-evm"].version,
          "kitchen-evm": v12ReleaseSet("2.6.1")["kitchen-evm"].version,
        },
        wireProfile: "sauce-compiler-2.6.1",
        storageProfile: "kitchen-evm-retained",
      },
      artifact("V12Pot").abi,
    ),
    pot,
    router,
  };
};

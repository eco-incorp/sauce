/**
 * The released v12 EVM stack — engine, Router, Kitchen — on a local node, at the release addresses.
 *
 * On a fork of a chain that already runs the release, the stack there is used as it is: its
 * Kitchen keeps its owner and execution fee (`zeroFee` impersonates the owner to clear it). Anywhere
 * else — an empty node, or a fork of a chain without the release — it is deployed from the release's
 * creation code by the SDK's `deployReleaseStack` (`sdk/src/evm/release-stack.ts`), the deployment
 * the SDK's own suites run through `sdk/test/evm/gated-engine.ts`. The Kitchen is then owned by
 * `owner` and charges no fee.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
} from "viem";

import { rpc } from "./node.js";
import {
  ARTIFACTS,
  deployReleaseStack,
  sdkCompilerVersion,
  type EvmPotBindingInput,
} from "./sdk.js";

function artifact<T>(name: string, directory = ARTIFACTS): T {
  try {
    return JSON.parse(readFileSync(resolve(directory, `${name}.json`), "utf8")) as T;
  } catch {
    throw new Error(
      `${name}.json is not in ${directory}: the package's engine artifacts are missing ` +
        "(ingest a LOCAL candidate, then set SAUCE_LOCAL_CANDIDATE to its V12LocalCandidate.json)",
    );
  }
}

type Deployments = Parameters<typeof deployReleaseStack>[2]["deployments"];

type StackBinding = Omit<EvmPotBindingInput, "pot" | "owner" | "userSalt" | "kind" | "chainId">;
interface Candidate extends StackBinding {
  readonly source: "LOCAL";
  readonly deployments: Deployments;
}

export interface Stack {
  readonly engine: Address;
  readonly router: Address;
  readonly kitchen: Address;
  readonly binding: StackBinding;
  readonly kitchenAbi: Abi;
  readonly potAbi: Abi;
  /** "live": the chain already ran the release; "deployed": it was deployed here. */
  readonly origin: "live" | "deployed";
}

export async function setUpStack(
  url: string,
  client: PublicClient,
  test: TestClient,
  owner: Address,
  options: { zeroFee?: boolean; candidatePath?: string } = {},
): Promise<Stack> {
  const candidatePath = options.candidatePath;
  if (!candidatePath)
    throw new Error("Pass candidatePath for an explicitly ingested LOCAL CREATE3 descriptor");
  const directory = dirname(resolve(candidatePath));
  const candidate = JSON.parse(readFileSync(resolve(candidatePath), "utf8")) as Candidate;
  if (candidate.source !== "LOCAL" || candidate.profile?.scheme !== "create3") {
    throw new Error("new local Pots require an explicitly ingested CREATE3 candidate profile");
  }
  if (candidate.compiler !== sdkCompilerVersion()) {
    throw new Error("LOCAL candidate compiler does not match the SDK compiler artifact");
  }
  const evm = candidate.deployments;
  const kitchenArtifact = artifact<{ abi: Abi; bytecode: Hex }>("V12Kitchen", directory);
  const kitchenAbi = kitchenArtifact.abi;
  const potAbi = artifact<{ abi: Abi }>("V12Pot", directory).abi;
  const engine = getAddress(candidate.engine);
  const router = getAddress(candidate.router);
  const kitchen = getAddress(candidate.kitchen);

  const has = async (address: Address) => ((await client.getCode({ address })) ?? "0x") !== "0x";
  const read = (functionName: string) =>
    client.readContract({ abi: kitchenAbi, address: kitchen, functionName });

  // A candidate must match actual engine and Router code, not an introspection hash.
  let live = (await has(engine)) && (await has(router)) && (await has(kitchen));
  if (live) {
    const [engineCode, routerCode, kitchenRouter] = await Promise.all([
      client.getCode({ address: engine }),
      client.getCode({ address: router }),
      read("router"),
    ]);
    live =
      keccak256(engineCode!).toLowerCase() === candidate.engineCodeHash.toLowerCase() &&
      keccak256(routerCode!).toLowerCase() === candidate.routerCodeHash.toLowerCase() &&
      getAddress(kitchenRouter as Address) === router;
  }

  if (live) {
    if (options.zeroFee) {
      const kitchenOwner = getAddress((await read("owner")) as Address);
      await test.impersonateAccount({ address: kitchenOwner });
      await test.setBalance({ address: kitchenOwner, value: 10n ** 18n });
      const hash = (await rpc(url, "eth_sendTransaction", [
        {
          from: kitchenOwner,
          to: kitchen,
          data: encodeFunctionData({
            abi: kitchenAbi,
            functionName: "setExecutionFee",
            args: [0n],
          }),
        },
      ])) as Hex;
      const receipt = await client.waitForTransactionReceipt({ hash });
      await test.stopImpersonatingAccount({ address: kitchenOwner });
      if (receipt.status !== "success") throw new Error("clearing the Kitchen's fee reverted");
    }
  } else {
    // `owner` is a dev account the node signs for, so a wallet with no local key sends as it.
    const walletClient = createWalletClient({ transport: http(url) });
    const deployed = await deployReleaseStack(
      { publicClient: client, walletClient, testClient: test },
      owner,
      {
        deployments: evm,
        runtimeCreationCode: artifact<{ runtimeCreationCode: Hex }>("V12RuntimeBytecode", directory)
          .runtimeCreationCode,
        routerBytecode: artifact<{ bytecode: Hex }>("Router", directory).bytecode,
        kitchen: kitchenArtifact,
        kitchenProxyBytecode: artifact<{ bytecode: Hex }>("V12KitchenProxy", directory).bytecode,
      },
    );
    if (deployed.kitchen !== kitchen) {
      throw new Error(
        `the Kitchen landed at ${deployed.kitchen}, but the engine gates on ${kitchen}`,
      );
    }
  }
  const [engineCode, routerCode, kitchenRouter] = await Promise.all([
    client.getCode({ address: engine }),
    client.getCode({ address: router }),
    read("router"),
  ]);
  if (
    !engineCode ||
    !routerCode ||
    keccak256(engineCode).toLowerCase() !== candidate.engineCodeHash.toLowerCase() ||
    keccak256(routerCode).toLowerCase() !== candidate.routerCodeHash.toLowerCase() ||
    getAddress(kitchenRouter as Address) !== router
  ) {
    throw new Error("local stack engine, Router or Kitchen does not match the CREATE3 descriptor");
  }

  return {
    engine,
    router,
    kitchen,
    binding: candidate,
    kitchenAbi,
    potAbi,
    origin: live ? "live" : "deployed",
  };
}

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
import { resolve } from "node:path";
import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
} from "viem";

import { rpc } from "./node.js";
import { ARTIFACTS, deployReleaseStack } from "./sdk.js";

function artifact<T>(name: string): T {
  try {
    return JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")) as T;
  } catch {
    throw new Error(
      `${name}.json is not in ${ARTIFACTS}: the package's engine artifacts are missing ` +
        "(in the repository, run `pnpm build`)",
    );
  }
}

type Deployments = Parameters<typeof deployReleaseStack>[2]["deployments"];

export interface Stack {
  readonly engine: Address;
  readonly router: Address;
  readonly kitchen: Address;
  readonly potInitCodeHash: Hex;
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
  options: { zeroFee?: boolean } = {},
): Promise<Stack> {
  const { evm } = artifact<{ evm: Deployments }>("V12Deployments");
  const gate = artifact<{ kitchen: Address; potInitCodeHash: Hex }>("V12EngineGate");
  const kitchenArtifact = artifact<{ abi: Abi; bytecode: Hex }>("V12Kitchen");
  const kitchenAbi = kitchenArtifact.abi;
  const potAbi = artifact<{ abi: Abi }>("V12Pot").abi;
  const engine = getAddress(evm.contracts.engine.address);
  const router = getAddress(evm.contracts.router.address);
  const kitchen = getAddress(gate.kitchen);

  const has = async (address: Address) => ((await client.getCode({ address })) ?? "0x") !== "0x";
  const read = (functionName: string) =>
    client.readContract({ abi: kitchenAbi, address: kitchen, functionName });

  // The release is live when every contract has code and the Kitchen mints the Pots the engine
  // accepts, on the Router a new Pot starts with.
  let live = (await has(engine)) && (await has(router)) && (await has(kitchen));
  if (live) {
    const [hash, kitchenRouter] = (await Promise.all([
      read("potInitCodeHash"),
      read("router"),
    ])) as [Hex, Address];
    live =
      hash.toLowerCase() === gate.potInitCodeHash.toLowerCase() &&
      getAddress(kitchenRouter) === router;
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
        runtimeCreationCode: artifact<{ runtimeCreationCode: Hex }>("V12RuntimeBytecode")
          .runtimeCreationCode,
        routerBytecode: artifact<{ bytecode: Hex }>("Router").bytecode,
        kitchen: kitchenArtifact,
        kitchenProxyBytecode: artifact<{ bytecode: Hex }>("V12KitchenProxy").bytecode,
      },
    );
    if (deployed.kitchen !== kitchen) {
      throw new Error(
        `the Kitchen landed at ${deployed.kitchen}, but the engine gates on ${kitchen}`,
      );
    }
    // The check that makes a mismatched Kitchen fail here, naming the cause, rather than as an
    // empty revert from the engine's gate on the first cook.
    const hash = (await read("potInitCodeHash")) as Hex;
    if (hash.toLowerCase() !== gate.potInitCodeHash.toLowerCase()) {
      throw new Error(
        `the deployed Kitchen reports potInitCodeHash ${hash}, but the engine gates on ` +
          `${gate.potInitCodeHash}: every Pot it mints would be refused`,
      );
    }
  }

  return {
    engine,
    router,
    kitchen,
    potInitCodeHash: gate.potInitCodeHash,
    kitchenAbi,
    potAbi,
    origin: live ? "live" : "deployed",
  };
}

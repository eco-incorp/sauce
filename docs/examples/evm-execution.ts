import { routes } from "@eco-incorp/sauce";
import { v12EngineAddress, v12KitchenAddress } from "@eco-incorp/sauce/deployments";
import { v12Kitchen, v12Pot } from "@eco-incorp/sauce/evm/engine";
import { getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";

const portalAbi = parseAbi(["function executor() view returns (address)"]);
const feeAbi = parseAbi(["function executionFee() view returns (uint256)"]);
const potKitchenAbi = parseAbi(["function kitchen() view returns (address)"]);

// Call with a client for the destination chain. Importing this example performs no RPC.
export async function prepareDestinationPot(client: PublicClient, portal: Address, salt: Hex) {
  const kitchen = getAddress(v12KitchenAddress());
  const engine = getAddress(v12EngineAddress());
  const [kitchenCode, engineCode] = await Promise.all([
    client.getCode({ address: kitchen }),
    client.getCode({ address: engine }),
  ]);
  if (!kitchenCode || kitchenCode === "0x" || !engineCode || engineCode === "0x") {
    throw new Error("Current Kitchen and engine must be deployed on the destination chain");
  }

  const executor = await client.readContract({
    address: portal,
    abi: portalAbi,
    functionName: "executor",
  });
  const pot = await client.readContract({
    address: kitchen,
    abi: v12Kitchen.abi,
    functionName: "predictPot",
    args: [executor, salt],
  });
  const executionFee = await client.readContract({
    address: kitchen,
    abi: feeAbi,
    functionName: "executionFee",
  });
  const context = { kitchen, engine, executor, pot, executionFee };
  const code = await client.getCode({ address: pot });
  if (!code || code === "0x") {
    const deploy = routes.sauceEvmDeployPotCall({ kitchen, owner: executor, salt });
    // Send this destination-chain request with your signer, wait for a successful receipt,
    // then call prepareDestinationPot again. Do not build a route until ready is true.
    return {
      ...context,
      ready: false as const,
      deployment: { to: kitchen, data: deploy.data, value: 0n },
    };
  }

  const [owner, actualKitchen] = await Promise.all([
    client.readContract({ address: pot, abi: v12Pot.abi, functionName: "owner" }),
    client.readContract({ address: pot, abi: potKitchenAbi, functionName: "kitchen" }),
  ]);
  if (getAddress(owner) !== getAddress(executor) || getAddress(actualKitchen) !== kitchen) {
    throw new Error("Pot must belong to this Portal Executor and the current Kitchen");
  }
  return { ...context, ready: true as const };
}

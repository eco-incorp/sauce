// Your Pot on an EVM chain, before your first cook: checks that the released Kitchen and engine are
// there, predicts your Pot from your address and a salt, and either hands back its deployment for
// your wallet to send or checks that the Pot is yours and runs its Kitchen's current Router. Also
// reads the Kitchen's fee, the value every cook carries. `sauce pot --chain <chain> --owner
// <address>` reads the same.
//
// Call it with a client for the Pot's chain; importing this example performs no RPC.
import { DEFAULT_POT_SALT, routes, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress, v12KitchenAddress } from "@eco-incorp/sauce/deployments";
import { potRouterUpdate, v12Kitchen, v12Pot } from "@eco-incorp/sauce/evm/engine";
import { getAddress, type Address, type Hex, type PublicClient } from "viem";

// The salt names one of the owner's Pots; the default, zero, is the Pot every owner has.
export async function preparePot(
  client: PublicClient,
  owner: Address,
  salt: Hex = DEFAULT_POT_SALT,
) {
  const kitchen = getAddress(v12KitchenAddress());
  const engine = getAddress(v12EngineAddress());
  const [kitchenCode, engineCode] = await Promise.all([
    client.getCode({ address: kitchen }),
    client.getCode({ address: engine }),
  ]);
  if (!kitchenCode || kitchenCode === "0x" || !engineCode || engineCode === "0x") {
    throw new Error("The released Kitchen and engine are not deployed on this chain");
  }

  const pot = v12PredictPot(owner, salt);
  const executionFee = await client.readContract({
    address: kitchen,
    abi: v12Kitchen.abi,
    functionName: "executionFee",
  });
  const context = { kitchen, engine, owner, pot, executionFee };

  const code = await client.getCode({ address: pot });
  if (!code || code === "0x") {
    // Anyone may send it; the Pot is the owner's either way. `sauce run` sends it for you.
    const deploy = routes.sauceEvmDeployPotCall({ owner, salt });
    return {
      ...context,
      ready: false as const,
      deployment: { to: deploy.to, data: deploy.data, value: 0n },
    };
  }

  const [potOwner, potKitchen] = await Promise.all([
    client.readContract({ address: pot, abi: v12Pot.abi, functionName: "owner" }),
    client.readContract({ address: pot, abi: v12Pot.abi, functionName: "kitchen" }),
  ]);
  if (getAddress(potOwner) !== getAddress(owner) || getAddress(potKitchen) !== kitchen) {
    throw new Error("This Pot belongs to another owner or Kitchen");
  }
  // After a Router rollout: the owner's setRouter call, or undefined when the Pot is current.
  const routerUpdate = await potRouterUpdate(client, pot);
  return { ...context, ready: true as const, routerUpdate };
}

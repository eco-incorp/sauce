import { v12RouterAddress } from "@eco-incorp/sauce/deployments";
import { potRouterUpdate, v12PotAbi } from "@eco-incorp/sauce/evm/engine";
import { getAddress, type Address, type PublicClient } from "viem";

// Call with a client for the Pot's chain. Importing this example performs no RPC.
export async function potRouter(client: PublicClient, pot: Address) {
  // Reads pot.router() and its Kitchen's router(). Throws only for an address no known release
  // derives.
  const update = await potRouterUpdate(client, pot);
  if (update === undefined) {
    // Nothing to propose: the Pot is current, its Router is fixed, or its Kitchen has no newer one.
    // Compare release addresses, not a generation number.
    const router = (await client.readContract({
      address: pot,
      abi: v12PotAbi,
      functionName: "router",
    })) as Address;

    return { current: getAddress(router) === getAddress(v12RouterAddress()), router };
  }

  // Only the Pot's owner can send this; anyone else reverts with NotOwner(). Send it with the
  // owner's signer, wait for a successful receipt, then call potRouter again.
  return { current: false as const, update: { ...update, value: 0n } };
}

import { v12RouterAddress } from "@eco-incorp/sauce/deployments";
import { potRouterUpdate } from "@eco-incorp/sauce/evm/engine";
import type { Address, PublicClient } from "viem";

// Call with a client for the Pot's chain. Importing this example performs no RPC.
export async function potRouter(client: PublicClient, pot: Address) {
  // Reads pot.router() and its Kitchen's router(). Throws for a Pot of an earlier Kitchen release,
  // which has no setRouter and keeps its Router for good.
  const update = await potRouterUpdate(client, pot);
  if (update === undefined) {
    // The Pot runs its Kitchen's current Router. Compare release addresses, not a generation number.
    return { current: true as const, router: v12RouterAddress() };
  }

  // Only the Pot's owner can send this; anyone else reverts with NotOwner(). Send it with the
  // owner's signer, wait for a successful receipt, then call potRouter again.
  return { current: false as const, update: { ...update, value: 0n } };
}

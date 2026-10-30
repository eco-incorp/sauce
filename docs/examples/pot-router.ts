import {
  potRouterUpdate,
  verifyPotBinding,
  type EvmPotBindingInput,
} from "@eco-incorp/sauce/evm/engine";
import type { PublicClient } from "viem";

// Only call when the owner explicitly wants to consider a Router change.
// Importing this example performs no RPC and changes no saved binding.
export async function potRouter(client: PublicClient, input: EvmPotBindingInput) {
  const binding = await verifyPotBinding(client, input);
  const update = await potRouterUpdate(client, binding.pot, binding);
  if (update === undefined) {
    return { current: true as const, router: binding.router };
  }

  // After an approved update, verify the explicitly selected new binding before persisting it.
  return { current: false as const, update: { ...update, value: 0n } };
}

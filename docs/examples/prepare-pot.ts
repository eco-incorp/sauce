// Load an explicit service binding after deployment; never replace a missing saved Pot.
// Call with the binding's chain client. Importing this example performs no RPC.
import {
  verifyPotBinding,
  v12Kitchen,
  type EvmPotBindingInput,
} from "@eco-incorp/sauce/evm/engine";
import type { PublicClient } from "viem";

export async function preparePot(client: PublicClient, input: EvmPotBindingInput) {
  const binding = await verifyPotBinding(client, input);
  const executionFee = await client.readContract({
    address: binding.kitchen,
    abi: v12Kitchen.abi,
    functionName: "executionFee",
  });

  // Persist a newly verified binding before funding, approvals or signing.
  return { binding, executionFee };
}

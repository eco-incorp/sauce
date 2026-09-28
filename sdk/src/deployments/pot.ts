/**
 * Where a Sauce Pot lives, without asking a chain.
 *
 * A Pot is CREATE2 from the Kitchen, so its address is a pure function of its OWNER and a salt —
 * `V12Deployments.json` ships the deployer and init-code hash that complete the formula, and
 * `V12EngineGate.json` records the Kitchen the released engine will accept Pots from. Nothing here
 * reads the network.
 *
 * DERIVING IS NOT DEPLOYING. The address exists as arithmetic the moment you know the owner; the
 * contract exists once somebody has called the Kitchen's `deployPot`, a permissionless call per
 * (owner, salt) that `sauceEvmDeployPotCall` encodes. Nothing the SDK builds makes that call: an
 * intent's Pot must exist before it is fulfilled, and the solver deploys it (`routes/intent-pot.ts`).
 */
import { encodeAbiParameters, getAddress, getCreate2Address, keccak256, type Hex } from "viem";

import gate from "../artifacts/V12EngineGate.json" with { type: "json" };
import { v12PotDerivation } from "./v12-addresses.js";

/**
 * The salt of the one Pot every intent on a chain shares: zero.
 *
 * A Pot is fixed by its (owner, salt) pair, so this is not a namespace: whoever calls
 * `Kitchen.deployPot(executor, 0)` creates this same Pot, owned by the Executor, and nobody can
 * create a different one there. That sharing is the intent. The owner is the destination
 * `Portal.executor()`, which every intent through that Portal already shares, and the solver
 * deploys exactly this Pot, one per Portal, with salt zero. Deriving it here gives the SDK the
 * solver's Pot rather than a second one that nothing funds or deploys.
 *
 * `test/deployments-pot.test.ts` pins the result against what the released Kitchen reports on-chain
 * for the production Portal.
 */
export const SAUCE_INTENT_POT_SALT: Hex = `0x${"00".repeat(32)}`;

/** The Kitchen the released engine accepts Pots from — the one its gate re-derives against. */
export const v12GateKitchen = (): Hex => getAddress((gate as { kitchen: string }).kitchen) as Hex;

/**
 * `CREATE2(kitchen, keccak256(abi.encode(owner, salt)), initCodeHash)` — the formula
 * `V12Deployments.json` records, applied.
 *
 * Chain-independent, like every CREATE2 address: the same owner and salt give the same Pot on every
 * chain the Kitchen is deployed at that address on.
 */
export function v12PredictPot(
  owner: Hex,
  salt: Hex = SAUCE_INTENT_POT_SALT,
  kitchen: Hex = v12GateKitchen(),
): Hex {
  const derivation = v12PotDerivation();

  return getCreate2Address({
    from: kitchen,
    bytecodeHash: derivation.initCodeHash as Hex,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [getAddress(owner), salt]),
    ),
  });
}

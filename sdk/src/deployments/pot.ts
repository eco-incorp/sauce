/**
 * Where a Sauce Pot lives, without asking a chain.
 *
 * A Pot is CREATE2 from the Kitchen, so its address is a pure function of its OWNER and a salt —
 * `V12Deployments.json` ships the deployer and init-code hash that complete the formula, and
 * `V12EngineGate.json` records the Kitchen the released engine will accept Pots from. Nothing here
 * reads the network.
 *
 * DERIVING IS NOT DEPLOYING. The address exists as arithmetic the moment you know the owner; the
 * contract exists once somebody has called the Kitchen's `deployPot`. A cook against a derived but
 * undeployed Pot reverts, which `routes-nest-dynamic.e2e.test.ts` shows both ways. Deployment is a
 * one-time, permissionless transaction per (owner, salt) — `sauceEvmDeployPotCall` encodes it.
 */
import { encodeAbiParameters, getAddress, getCreate2Address, keccak256, type Hex } from "viem";

import gate from "../artifacts/V12EngineGate.json" with { type: "json" };
import { v12PotDerivation } from "./v12-addresses.js";

/**
 * The salt every Pot the SDK derives for itself uses.
 *
 * One constant rather than one per intent, deliberately. The owner is already the destination
 * `Portal.executor()`, which is shared by every intent on that chain, so a per-intent salt would
 * mint a fresh Pot per intent — each needing its own deployment transaction before anything could
 * run, and each an empty contract afterwards. A constant gives one canonical Pot per (Kitchen,
 * Executor) pair: deployed once, reused, and the same address for everyone who derives it.
 *
 * Tagged rather than zero so it cannot collide with a Pot somebody deployed for their own use with
 * the obvious default salt.
 */
export const SAUCE_INTENT_POT_SALT: Hex = keccak256(
  new TextEncoder().encode("sauce.intent.pot.v1"),
);

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

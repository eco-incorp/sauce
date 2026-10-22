/**
 * Where a Sauce Pot lives, without asking a chain.
 *
 * A Pot is CREATE2 from the Kitchen, so its address is a pure function of its OWNER and a salt —
 * `V12Deployments.json` ships the deployer (the Kitchen proxy) and the init-code hash that complete
 * the formula, both from the kitchen release's own `addresses.json`; the sync refuses a Kitchen or a
 * hash that is not the one the released engine gates on. Nothing here reads the network.
 *
 * DERIVING IS NOT DEPLOYING. The address exists as arithmetic the moment you know the owner; the
 * contract exists once somebody has called the Kitchen's `deployPot`, a permissionless call per
 * (owner, salt) that `sauceEvmDeployPotCall` encodes.
 */
import {
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  keccak256,
  stringToBytes,
  type Hex,
} from "viem";

import { v12PotDerivation } from "./v12-addresses.js";

/**
 * The salt of an owner's default Pot: zero.
 *
 * A Pot is fixed by its (owner, salt) pair, so this is not a namespace: whoever calls
 * `Kitchen.deployPot(owner, 0)` creates this same Pot, owned by `owner`, and nobody can create a
 * different one there.
 */
export const DEFAULT_POT_SALT: Hex = `0x${"00".repeat(32)}`;

/**
 * The salt of the Pot an owner names `label`: `keccak256(utf8(label))`.
 *
 * An owner has one Pot per salt. The zero salt ({@link DEFAULT_POT_SALT}) is the convention
 * for the one Pot an owner has by default, and a label names any other:
 * `v12PredictPot(owner, potSalt("treasury"))`. Hashing gives any label a full 32-byte salt, the
 * same everywhere: the `sauce` command's `--salt treasury` is this. An exact salt needs no helper;
 * pass the 32 bytes to `v12PredictPot` as they are.
 */
export function potSalt(label: string): Hex {
  if (label === "") {
    throw new Error(
      "potSalt: a label names a Pot, so it cannot be empty — the default Pot's salt is " +
        "DEFAULT_POT_SALT",
    );
  }

  return keccak256(stringToBytes(label));
}

/**
 * `CREATE2(kitchen, keccak256(abi.encode(owner, salt)), initCodeHash)` — the formula
 * `V12Deployments.json` records, applied. `kitchen` defaults to the pinned release's Kitchen proxy,
 * the Pots' deployer; the init-code hash is always the pinned release's, never a constant here.
 *
 * Chain-independent, like every CREATE2 address: the same owner and salt give the same Pot on every
 * chain the Kitchen is deployed at that address on. A Kitchen upgrade that moves the init-code hash
 * moves every Pot minted after it — the reason this reads the hash from the release.
 */
export function v12PredictPot(
  owner: Hex,
  salt: Hex = DEFAULT_POT_SALT,
  kitchen: Hex = getAddress(v12PotDerivation().deployer) as Hex,
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

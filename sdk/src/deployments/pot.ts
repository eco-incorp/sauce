/**
 * Where a Sauce Pot lives, without asking a chain.
 *
 * Defaults use the deployed Kitchen's CREATE2 recipe. Explicit release selection uses the
 * selected Kitchen's CREATE3 recipe. Neither recipe checks for deployed code.
 */
import {
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  stringToBytes,
  zeroAddress,
  type Hex,
} from "viem";

import { v12ReleaseSet } from "./releases.js";
import { v12PotDerivation } from "./v12-addresses.js";

/**
 * The salt of an owner's default Pot: zero.
 *
 * For the default Kitchen, anyone calling `Kitchen.deployPot(owner, 0)` creates this same Pot,
 * owned by `owner`.
 */
export const DEFAULT_POT_SALT: Hex = `0x${"00".repeat(32)}`;

/**
 * The salt of the Pot an owner names `label`: `keccak256(utf8(label))`.
 *
 * Zero is the convention for an owner's default Pot; a label names another:
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
 * Predict an EVM Pot without reading a chain. With no third argument or a Kitchen address, use
 * the deployed default's CREATE2 init-code hash, as in `v12PotDerivation()`.
 *
 * Pass `{ compiler, routerFixed? }` to select a CREATE3 Kitchen from the SDK release table.
 * For private Pots `routerFixed` defaults to false. Use the zero address for a shared Pot,
 * which always has a fixed Router. Prediction does not attest to the Kitchen or Pot on a chain.
 */
export function v12PredictPot(
  owner: Hex,
  salt: Hex = DEFAULT_POT_SALT,
  kitchen: Hex | { compiler: string; routerFixed?: boolean } = getAddress(
    v12PotDerivation().deployer,
  ),
): Hex {
  const account = getAddress(owner);
  const gateTypes = [{ type: "address" }, { type: "bytes32" }] as const;
  if (typeof kitchen === "string") {
    return getCreate2Address({
      from: kitchen,
      bytecodeHash: v12PotDerivation().initCodeHash as Hex,
      salt: keccak256(encodeAbiParameters(gateTypes, [account, salt])),
    });
  }

  if (!kitchen.compiler) {
    throw new Error("v12PredictPot: select a compiler for the CREATE3 Kitchen");
  }
  const pin = v12ReleaseSet(kitchen.compiler)["kitchen-evm"];
  if (pin.kitchen === null || pin.potProxyInitCodeHash === undefined) {
    throw new Error(`v12PredictPot: compiler ${kitchen.compiler} has no pinned CREATE3 Kitchen`);
  }
  const shared = account === zeroAddress;
  if (shared && kitchen.routerFixed === false) {
    throw new Error("v12PredictPot: shared Pots always have a fixed Router");
  }
  const gate =
    shared || kitchen.routerFixed === true
      ? encodeAbiParameters([...gateTypes, { type: "bool" }], [account, salt, true])
      : encodeAbiParameters(gateTypes, [account, salt]);
  const proxy = getCreate2Address({
    from: getAddress(pin.kitchen),
    bytecodeHash: pin.potProxyInitCodeHash as Hex,
    salt: keccak256(gate),
  });
  return getContractAddress({ from: proxy, nonce: 1n });
}

/** Offline CREATE3 prediction. A predicted address is not authenticated deployed code. */
import {
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  getContractAddress,
  keccak256,
  stringToBytes,
  zeroAddress,
  type Hex,
} from "viem";

import { v12KitchenAddress } from "./v12-addresses.js";

export const DEFAULT_POT_SALT: Hex = `0x${"00".repeat(32)}`;
export const POT_CREATE3_HELPER_INIT_CODE_HASH: Hex =
  "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";

/** The CLI's named-salt convention; an exact bytes32 salt can be passed directly. */
export function potSalt(label: string): Hex {
  if (label === "") {
    throw new Error("potSalt: a label cannot be empty — use DEFAULT_POT_SALT for the default Pot");
  }

  return keccak256(stringToBytes(label));
}

export function v12PotGateSalt(owner: Hex, salt: Hex, routerFixed: boolean): Hex {
  return routerFixed
    ? keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }, { type: "bool" }],
          [getAddress(owner), salt, true],
        ),
      )
    : keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [getAddress(owner), salt]),
      );
}

/** New factory predictions use CREATE3 only. Existing deployed Pots keep their persisted address. */
export function v12PredictPot(
  owner: Hex,
  salt: Hex = DEFAULT_POT_SALT,
  kitchen: Hex = getAddress(v12KitchenAddress()),
  routerFixed = false,
): Hex {
  const helper = getCreate2Address({
    from: kitchen,
    bytecodeHash: POT_CREATE3_HELPER_INIT_CODE_HASH,
    salt: v12PotGateSalt(owner, salt, routerFixed),
  });

  return getContractAddress({ from: helper, nonce: 1n });
}

export function v12PredictSharedPot(
  salt: Hex = DEFAULT_POT_SALT,
  kitchen: Hex = getAddress(v12KitchenAddress()),
): Hex {
  return v12PredictPot(zeroAddress, salt, kitchen, true);
}

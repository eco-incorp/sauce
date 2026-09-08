// @eco-incorp/sauce-sdk/evm/engine — viem-native view of the EVM Sauce engine contracts.
//
// Mirrors ./svm/engine (a consumer-facing engine subpath) for the EVM side. The SDK vendored the
// V12Pot / V12Kitchen ABIs (src/artifacts/*.json) but never exported them, so viem consumers
// (eco-solver) re-declare them by hand. This exports them as viem `parseAbi` objects plus
// ready-to-use handles with calldata encoders, so a consumer imports the final thing instead of
// re-writing the ABI.
//
// deployPot uses the CANONICAL engine signature deployPot(address owner, bytes32 salt) — matching
// engine/src/V12Kitchen.sol and the vendored V12Kitchen.json. (Some consumers hand-wrote a
// salt-only form; the engine has no such variant.) Drift-guarded against src/artifacts/*.json by
// test/evm/engine.test.ts.

import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

/** V12Pot — `cook()` is onlyOwner; the bytecodes are the `ingredients`. */
export const v12PotAbi = parseAbi([
  "function cook(bytes[] ingredients) payable returns (bytes)",
  "function owner() view returns (address)",
  "function router() view returns (address)",
  "function v12Runtime() view returns (address)",
]);

/** V12Kitchen — CREATE2 Pot factory. `deployPot` bakes `owner` into the Pot's CREATE2 address. */
export const v12KitchenAbi = parseAbi([
  "function deployPot(address owner, bytes32 salt) returns (address pot)",
  "function predictPot(address owner, bytes32 salt) view returns (address)",
  "function router() view returns (address)",
  "function v12Runtime() view returns (address)",
]);

/** Ready-to-use V12Pot handle: the viem ABI plus calldata encoders for route/batch legs. */
export const v12Pot = {
  abi: v12PotAbi,
  /** Encode `cook(ingredients)` calldata; each ingredient is a compiled sauce bytecode blob. */
  encodeCook: (ingredients: readonly Hex[]): Hex =>
    encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [ingredients as Hex[]] }),
} as const;

/** Ready-to-use V12Kitchen handle: the viem ABI plus calldata encoders. */
export const v12Kitchen = {
  abi: v12KitchenAbi,
  /** Encode `deployPot(owner, salt)` calldata. `owner` is baked into the Pot's CREATE2 address. */
  encodeDeployPot: (owner: Address, salt: Hex): Hex =>
    encodeFunctionData({ abi: v12KitchenAbi, functionName: "deployPot", args: [owner, salt] }),
  /** Encode `predictPot(owner, salt)` calldata (a view call returning the Pot address). */
  encodePredictPot: (owner: Address, salt: Hex): Hex =>
    encodeFunctionData({ abi: v12KitchenAbi, functionName: "predictPot", args: [owner, salt] }),
} as const;

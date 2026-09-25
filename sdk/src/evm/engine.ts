// @eco-incorp/sauce/evm/engine — viem-native view of the EVM Sauce engine contracts.
//
// Mirrors ./svm/engine (a consumer-facing engine subpath) for the EVM side. The SDK vendored the
// V12Pot / V12Kitchen ABIs (src/artifacts/*.json) but never exported them, so viem consumers
// (eco-solver) re-declare them by hand. This exports them as viem `parseAbi` objects plus
// ready-to-use handles with calldata encoders, so a consumer imports the final thing instead of
// re-writing the ABI.
//
// deployPot uses the CANONICAL engine signature deployPot(address owner, bytes32 salt) — matching
// the released Kitchen ABI. (Some consumers hand-wrote a salt-only form; the engine has no such
// variant.) Drift-guarded against src/artifacts/*.json by test/evm/engine.test.ts — those artifacts
// come from the v12 release, so a signature change there fails here rather than at run time.

import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

/**
 * V12Pot — `cook()` is onlyOwner.
 *
 * **The engine is named per cook.** A Pot holds no engine: `cook(address engine, bytes program)`
 * takes the interpreter as an argument, and `inFlightEngine()` reports the engine of the cook
 * currently executing — it is `address(0)` outside one. The SVM kitchen takes an `engine_program`
 * account per call for the same reason: which interpreter runs is the caller's choice at call time.
 *
 * A cook runs exactly ONE program.
 */
export const v12PotAbi = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
  "function inFlightEngine() view returns (address)",
  "function owner() view returns (address)",
  "function kitchen() view returns (address)",
  "function router() view returns (address)",
]);

/** V12Kitchen — CREATE2 Pot factory. `deployPot` bakes `owner` into the Pot's CREATE2 address. */
export const v12KitchenAbi = parseAbi([
  "function deployPot(address owner, bytes32 salt) returns (address pot)",
  "function predictPot(address owner, bytes32 salt) view returns (address)",
  "function executionFee() view returns (uint256)",
  "function router() view returns (address)",
]);

/** Ready-to-use V12Pot handle: the viem ABI plus calldata encoders for route/batch legs. */
export const v12Pot = {
  abi: v12PotAbi,
  /**
   * Encode `cook(engine, program)` calldata.
   *
   * `engine` is the interpreter this cook runs on — the Pot no longer holds one. `program` is a
   * single compiled sauce blob, where this used to take an array whose first element was the only
   * one ever executed.
   */
  encodeCook: (engine: Address, program: Hex): Hex =>
    encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [engine, program] }),
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

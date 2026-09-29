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
// variant.) Drift-guarded against src/artifacts/*.json by test/evm/engine.test.ts: each ABI below
// is the released contract's COMPLETE ABI — every entry of the release appears here and nothing
// else does, with the same signature — so a release that adds, drops or changes an entry fails
// there rather than leaving a consumer to read the artifact by hand.

import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { v12PredictPot } from "../deployments/pot.js";
import { assertEngineRunsCompiler } from "../deployments/releases.js";

/**
 * V12Pot — `cook()` is onlyOwner.
 *
 * **The engine is named per cook.** A Pot holds no engine: `cook(address engine, bytes program)`
 * takes the interpreter as an argument, and `inFlightEngine()` reports the engine of the cook
 * currently executing — it is `address(0)` outside one. The SVM kitchen takes an `engine_program`
 * account per call for the same reason: which interpreter runs is the caller's choice at call time.
 *
 * A cook runs exactly ONE program.
 *
 * **The Router is the Pot's own.** Its fallback delegatecalls `router()`: the Router the Kitchen had
 * when the Pot was minted, until the Pot's OWNER names another with `setRouter`. Neither the Kitchen
 * nor its owner can move a deployed Pot. See {@link potRouterUpdate}.
 */
export const v12PotAbi = parseAbi([
  "constructor()",
  "fallback() external payable",
  "receive() external payable",
  "function cook(address engine, bytes program) payable returns (bytes)",
  "function gateSalt() view returns (bytes32)",
  "function inFlightEngine() view returns (address armed)",
  "function kitchen() view returns (address)",
  "function owner() view returns (address)",
  "function router() view returns (address)",
  "function setRouter(address newRouter)",
  "function userSalt() view returns (bytes32)",
  "event RouterSet(address indexed router)",
  "error EmptyProgram()",
  "error EngineHasNoCode()",
  "error FeeNotPaid(uint256 required, uint256 provided)",
  "error FeeTransferFailed()",
  "error NotOwner()",
  "error RouterHasNoCode()",
  "error RouterUnset()",
]);

/**
 * V12Kitchen — CREATE2 Pot factory behind a UUPS proxy. `deployPot` bakes `owner` into the Pot's
 * CREATE2 address.
 *
 * `router()` is the Router Pots minted FROM NOW ON start on. The Kitchen's owner moves it with
 * `setRouter`; that moves no Pot address, no engine gate and no deployed Pot. The owner-only
 * administration (`initialize`, `setExecutionFee`, `withdrawExecutionFees`, the two-step ownership
 * transfer, `upgradeToAndCall`) is part of the ABI too, so a deployment script needs no artifact.
 */
export const v12KitchenAbi = parseAbi([
  "constructor()",
  "receive() external payable",
  "function UPGRADE_INTERFACE_VERSION() view returns (string)",
  "function acceptOwnership()",
  "function deployPot(address owner, bytes32 salt) returns (address pot)",
  "function executionFee() view returns (uint256)",
  "function initialize(address initialOwner, uint256 initialExecutionFee)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function potInitCodeHash() view returns (bytes32)",
  "function potParameters() view returns (address owner, bytes32 salt)",
  "function predictPot(address owner, bytes32 salt) view returns (address)",
  "function proxiableUUID() view returns (bytes32)",
  "function renounceOwnership() pure",
  "function router() view returns (address)",
  "function setExecutionFee(uint256 fee)",
  "function setRouter(address newRouter)",
  "function transferOwnership(address newOwner)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function withdrawExecutionFees(address recipient, uint256 amount)",
  "event ExecutionFeeSet(uint256 fee)",
  "event ExecutionFeesWithdrawn(address indexed recipient, uint256 amount)",
  "event Initialized(uint64 version)",
  "event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event PotDeployed(address indexed owner, bytes32 indexed salt, address pot)",
  "event RouterSet(address indexed router)",
  "event Upgraded(address indexed implementation)",
  "error AddressEmptyCode(address target)",
  "error ERC1967InvalidImplementation(address implementation)",
  "error ERC1967NonPayable()",
  "error FailedCall()",
  "error InsufficientBalance(uint256 requested, uint256 available)",
  "error InvalidInitialization()",
  "error NotInitializing()",
  "error OwnableInvalidOwner(address owner)",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnershipIsPermanent()",
  "error RouterHasNoCode()",
  "error UUPSUnauthorizedCallContext()",
  "error UUPSUnsupportedProxiableUUID(bytes32 slot)",
  "error WithdrawalFailed()",
  "error ZeroInitialExecutionFee()",
  "error ZeroOwner()",
  "error ZeroRecipient()",
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
   *
   * Throws for an engine a v12 release set names for another compiler than the SDK's
   * (`assertEngineRunsCompiler`): that engine cannot run this SDK's programs.
   */
  encodeCook: (engine: Address, program: Hex): Hex => {
    assertEngineRunsCompiler("evm", engine);

    return encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [engine, program] });
  },
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

/** The one read {@link potRouterUpdate} needs from a client — viem's `PublicClient` has it. */
export type PotRouterClient = Pick<PublicClient, "readContract">;

/** The call that points a Pot at its Kitchen's current Router — for the Pot's OWNER to sign. */
export interface PotRouterUpdate {
  readonly to: Address;
  readonly data: Hex;
}

/**
 * Whether `pot` runs its Kitchen's current Router, and if not, the call that switches it.
 *
 * Reads `pot.router()` and the Kitchen's `router()` through `client` — the caller's, since the SDK
 * holds no RPC endpoint — and returns `undefined` when they are the same Router, or the
 * `pot.setRouter(kitchenRouter)` call otherwise. It never sends anything, and the Router's address
 * never passes through the caller: the Kitchen names it.
 *
 * **Only the Pot's owner can make this call** — `setRouter` has `cook`'s gate and reverts
 * `NotOwner()` for anyone else — and nothing makes it on the owner's behalf: **the Kitchen cannot
 * move an existing Pot.** Its owner's `setRouter` changes the Router Pots minted afterwards start on,
 * never a deployed Pot's, so a Router rollout reaches an existing Pot only when its owner signs this.
 *
 * Throws for a Pot this SDK's release does not mint: one minted before the Router moved into Pot
 * storage has no `setRouter` at all and keeps its Router for good, so any call built for it would
 * revert. A Pot is this release's when its address derives from its owner and salt under the pinned
 * init-code hash, which is read, not assumed.
 */
export async function potRouterUpdate(
  client: PotRouterClient,
  pot: Address,
): Promise<PotRouterUpdate | undefined> {
  const [current, kitchen, owner, salt] = await Promise.all([
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "router" }),
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "kitchen" }),
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "owner" }),
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "userSalt" }),
  ]);
  if (v12PredictPot(owner, salt, kitchen) !== getAddress(pot)) {
    throw new Error(
      `potRouterUpdate: ${pot} is not a Pot of the pinned Kitchen release — its address does not ` +
        "derive from its owner and salt under the release's Pot init-code hash. A Pot minted " +
        "before the Router moved into Pot storage has no setRouter and keeps its Router for good.",
    );
  }
  const target = await client.readContract({
    address: kitchen,
    abi: v12KitchenAbi,
    functionName: "router",
  });
  if (getAddress(current) === getAddress(target)) return undefined;

  return {
    to: getAddress(pot),
    data: encodeFunctionData({ abi: v12PotAbi, functionName: "setRouter", args: [target] }),
  };
}

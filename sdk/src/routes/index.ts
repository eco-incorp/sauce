/**
 * eco-routes cross-chain intent DSL — top-level chain globals generated from
 * `../chains/canonical.js`, each BOTH callable and a namespace.
 *
 * ```ts
 * import { chainAccessors } from "@eco-incorp/sauce-sdk/routes"; // or routes namespace, see sdk/src/index.ts
 * const { Base, Solana } = chainAccessors;
 * const built = Base("return 1n;", { pot, deadline, portal }).reward({ source: Solana.chain, creator, prover, deadline });
 * // identically: Base.route("return 1n;", {...}).reward({...})
 * ```
 */
export { chain, chainAccessors, pascalOfSlug } from "./accessors.js";
export type { PascalOf } from "./accessors.js";

export {
  createChainGlobals,
  makeChainGlobal,
} from "./builder.js";
export type {
  ChainGlobal,
  ChainGlobals,
  ChainRef,
  ChainRoute,
} from "./builder.js";

export { assembleIntent } from "./intent.js";

export { emptyRoute, toBigInt, toUniversalAddress } from "./normalize.js";

export {
  denormalizeToEvm,
  encodeIntent,
  encodeReward,
  encodeRewardEvm,
  encodeRewardSvm,
  encodeRoute,
  encodeRouteEvm,
  encodeRouteSvm,
  decodeReward,
  decodeRewardEvm,
  decodeRewardSvm,
  decodeRoute,
  decodeRouteEvm,
  decodeRouteSvm,
  hashIntent,
  kindOf,
  rewardHash,
  routeHash,
  EVM_ROUTE_PARAM,
  EVM_REWARD_PARAM,
  svmCallCodec,
  svmRewardCodec,
  svmRouteCodec,
  svmTokenAmountCodec,
} from "./encode.js";
export type { ChainKindRef, IntentHashes } from "./encode.js";

export type {
  AddressInput,
  Call,
  CallInput,
  Hex,
  Intent,
  Reward,
  RewardInput,
  Route,
  RouteInput,
  TokenAmount,
  TokenAmountInput,
  UniversalAddress,
} from "./types.js";

export {
  assertSauceEvmLive,
  buildSauceCall,
  buildSauceCalls,
  buildSauceEvmCall,
  buildSauceEvmCalls,
  buildSauceSvmCall,
  buildSauceSvmCalls,
  mergeSvmAccountFlags,
  sauceEvmDeployPotCall,
  sauceSvmStagingPlan,
} from "./sauce-calls.js";
export type {
  SauceEvmCallParams,
  SauceEvmCallsParams,
  SauceEvmDeployPotCallParams,
  SauceSvmAccountMeta,
  SauceSvmCallParams,
  SauceSvmCallsParams,
  SauceSvmExecution,
  StagedBufferRef,
  SvmAddressInput,
} from "./sauce-calls.js";

// --- cross-chain intent DSL (S1) ---

export { compileSauceRoute, wrapSauceBody } from "./sauce-route.js";
export type {
  CompiledSauceRoute,
  SauceCompileOptions,
  SauceEvmExecutionInput,
  SauceSvmExecutionInput,
} from "./sauce-route.js";

export { predictVaultAddress, vaultInitCodeHash } from "./vault.js";
export type { VaultConfig } from "./vault.js";

export { openRoute } from "./intent-dsl.js";
export type { BuiltIntent, IntentOptions, PendingSauceRoute, RewardArg, SauceBody, SauceRewardSpec } from "./intent-dsl.js";

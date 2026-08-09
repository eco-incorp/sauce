/**
 * eco-routes fluent builder — top-level chain accessors generated from
 * `../chains/canonical.js`.
 *
 * ```ts
 * import { chainAccessors } from "@eco-incorp/sauce-sdk/routes"; // or routes namespace, see sdk/src/index.ts
 * const { Base, Solana, Ethereum } = chainAccessors;
 * const intents = Base.route(rewardA).Solana(routeA).route(rewardB).Ethereum();
 * ```
 */
export { chain, chainAccessors, pascalOfSlug } from "./accessors.js";
export type { PascalOf } from "./accessors.js";

export {
  createChainAccessors,
  makeChainOrigin,
} from "./builder.js";
export type {
  Assembler,
  ChainAccessors,
  ChainOrigin,
  ChainRef,
  ChainStage,
  DestinationMethod,
  DestinationSelectors,
  PendingLeg,
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

export { intentOn } from "./intent-dsl.js";
export type { BuiltIntent, PendingSauceRoute, SauceIntentOrigin, SauceRewardSpec, SauceRouteSpec } from "./intent-dsl.js";

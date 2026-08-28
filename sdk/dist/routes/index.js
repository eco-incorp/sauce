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
export { createChainAccessors, makeChainOrigin, } from "./builder.js";
export { assembleIntent } from "./intent.js";
export { emptyRoute, toBigInt, toUniversalAddress } from "./normalize.js";
export { denormalizeToEvm, encodeIntent, encodeReward, encodeRewardEvm, encodeRewardSvm, encodeRoute, encodeRouteEvm, encodeRouteSvm, decodeReward, decodeRewardEvm, decodeRewardSvm, decodeRoute, decodeRouteEvm, decodeRouteSvm, hashIntent, kindOf, rewardHash, routeHash, EVM_ROUTE_PARAM, EVM_REWARD_PARAM, svmCallCodec, svmRewardCodec, svmRouteCodec, svmTokenAmountCodec, } from "./encode.js";
export { assertSauceEvmLive, buildSauceCall, buildSauceCalls, buildSauceEvmCall, buildSauceEvmCalls, buildSauceSvmCall, buildSauceSvmCalls, mergeSvmAccountFlags, sauceEvmDeployPotCall, sauceSvmStagingPlan, } from "./sauce-calls.js";
//# sourceMappingURL=index.js.map
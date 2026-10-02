/**
 * eco-routes cross-chain intent DSL — one chain accessor per canonical chain,
 * generated from `../chains/canonical.js`, each BOTH callable and a namespace.
 *
 * The composed accessors (callable + `.chain`/`.route` + the native contract
 * tree) are named exports of the package root; `chainAccessors` below is the
 * BARE record, carrying `.chain`/`.route` and nothing else.
 *
 * ```ts
 * import { Base, Solana } from "@eco-incorp/sauce";
 * const built = Base("function main() { return 1n; }", { pot, engine, deadline, portal }).reward({ source: Solana.chain, creator, prover, deadline });
 * // identically: Base.route("function main() { return 1n; }", {...}).reward({...})
 * ```
 */
export { chain, chainAccessors, pascalOfSlug } from "./accessors.js";
export type { PascalOf } from "./accessors.js";

export { createChainGlobals, makeChainGlobal } from "./builder.js";
export { composedChainGlobal, composedChainGlobals } from "./composed.js";
export type { ChainGlobal, ChainGlobals, ChainRef, ChainRoute } from "./builder.js";

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
  evmRouteTuple,
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
  buildSauceCall,
  buildSauceCalls,
  buildSauceEvmCall,
  buildSauceEvmCalls,
  buildSauceSvmCall,
  buildSauceSvmCalls,
  mergeSvmAccountFlags,
  sauceEvmDeployPotCall,
} from "./sauce-calls.js";
export type {
  SauceEvmCall,
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

export { compileSauceProgram, compileSauceRoute } from "./sauce-route.js";
export type {
  CompiledSauceProgram,
  CompiledSauceRoute,
  SauceCompileOptions,
  SauceProgramOptions,
  SauceEvmExecutionInput,
  SauceSvmExecutionInput,
} from "./sauce-route.js";
export { decodeEntryArguments, encodeEntryArguments } from "./entry.js";
export type { EntryParam, EntryValue } from "./entry.js";
export type { LoweredIntent } from "./intent-host.js";

export {
  ECO_ROUTES_VAULT_PROXY_CREATION_CODE,
  ecoRoutesVaultConfig,
  predictVaultAddress,
  vaultInitCodeHash,
} from "./vault.js";
export type { VaultConfig } from "./vault.js";

export { closureText, isSauceClosure } from "./closure.js";
export { chainAmbient, chainDefines } from "./ambient.js";
export type { AmbientDefinesOptions } from "./ambient.js";
export { sourceGlobals } from "./source-globals.js";
export type {
  SourceChainName,
  SourceContract,
  SourceGlobals,
  SourceInterface,
  SourceMethod,
  SourceModule,
  SourceNamespace,
  SourceToken,
} from "./source-globals.js";
export {
  knownTokenSymbols,
  registryTokenAddress,
  registryTokens,
  resolveTokenMap,
  SVM_TOKEN_REGISTRY,
  svmTokenRows,
  TOKEN_REGISTRY,
} from "./token-registry.js";
export type {
  RegistryToken,
  StockToken,
  SvmTokenCluster,
  SvmTokenRow,
  TokenRegistryRow,
} from "./token-registry.js";
export { STOCK_ISSUERS, stockSymbol } from "./stock-tokens.js";
export type { StockIssuer } from "./stock-tokens.js";
export { openRoute } from "./intent-dsl.js";
export { destinationPot } from "./intent-pot.js";
export type {
  BuiltIntent,
  IntentEvmExecution,
  IntentOptions,
  NestChildOrThunk,
  NestOptions,
  PendingSauceRoute,
  RewardArg,
  SauceBody,
  SauceRewardSpec,
} from "./intent-dsl.js";

export {
  approvalTxs,
  assertIntentVault,
  batchWithdrawTx,
  CANCELLED_CLAIMANT,
  CANCELLED_CLAIMANT_BYTES32,
  cancelAndProveTx,
  cancelTx,
  fulfillAndProveTx,
  fulfillApprovalTxs,
  fulfillmentCall,
  fulfillTx,
  fundTx,
  hyperlaneProverData,
  INTENT_FUND_VIA,
  intentFromPublished,
  intentHashCall,
  intentSourceTxs,
  IntentVaultMismatchError,
  intentVaultAddressCall,
  isIntentFundedCall,
  predictIntentVault,
  proofMessage,
  proofTypeCall,
  provenIntentCall,
  proverFeeCall,
  proveTx,
  publishAndFundTx,
  publishTx,
  refundTx,
  REWARD_STATUSES,
  rewardStatusCall,
  rewardVaultLegs,
  vaultTransferTx,
  vaultTransferTxs,
  withdrawTx,
} from "./portal.js";
export type {
  FulfillOptions,
  IntentFundVia,
  IntentSourceTxsOptions,
  PortalReadCall,
  PortalTarget,
  PortalTx,
  ProveOptions,
  ProvenPair,
  PublishedLog,
  RewardStatus,
  VaultLeg,
} from "./portal.js";

export { assertNestingInvariants, assertStaticChild, nestedChildCalls } from "./nest.js";
export type { AssertNestingInvariantsArgs, NestChild, NestedChildOptions } from "./nest.js";

// --- DYNAMIC nesting: a child intent created on-chain from a runtime measurement ---
//
// Unlike the transfer codegen (`nestedTransferProgram`, internal to `intent-dsl.ts`), these ARE
// public: a caller cannot build a dynamic child at all without the placeholder sentinels, since the
// sentinels are what it writes into the child's amount fields before handing it to `.nest()`.

export {
  assertDynamicChild,
  dynamicChildProgram,
  dynamicChildStatements,
  dynamicChildTemplate,
  renderDynamicChild,
  AMOUNT_IN_PLACEHOLDER,
  AMOUNT_OUT_PLACEHOLDER,
  AMOUNT_IN_PLACEHOLDER_U64,
  AMOUNT_OUT_PLACEHOLDER_U64,
  WAD,
} from "./nest-dynamic.js";
export type { AmountMeasurement, DynamicChildOptions, DynamicNestEntry } from "./nest-dynamic.js";

export {
  emitTemplate,
  encodeFixedWidth,
  maxScalableBase,
  renderTemplate,
  scaleAmount,
  splitByPlaceholders,
} from "./template.js";
export type {
  AmountSource,
  ByteTemplate,
  PlaceholderSpec,
  TemplateEmitOptions,
  TemplateEmitResult,
  TemplateSlot,
} from "./template.js";

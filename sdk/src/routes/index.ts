/**
 * eco-routes cross-chain intents — one chain accessor per canonical chain, generated from
 * `../chains/canonical.js`: `.chain` and `.hop`.
 *
 * The composed accessors (`.chain`, `.hop`, `.Portal` and the native contract tree) are named
 * exports of the package root; `chainAccessors` below is the BARE record, carrying `.chain`/`.hop`
 * alone.
 *
 * ```ts
 * import { Base, Ethereum } from "@eco-incorp/sauce";
 * const intent = Base.hop({
 *   source: Ethereum,
 *   send: { token, amount: 1_010_000n },
 *   receive: { token: usdcBase, amount: 1_000_000n },
 *   refundee: owner,
 *   fee: kitchenFee,
 * }).then(() => { USDC.transfer(RECIPIENT, 1000000); });
 * const cook = intent.cook({ owner }, sourceKitchenFee); // { to, data, value }
 * ```
 */
export { chain, chainAccessors, pascalOfSlug } from "./accessors.js";
export type { PascalOf } from "./accessors.js";

export { createChainGlobals, makeChainGlobal } from "./builder.js";
export { composedChainGlobal, composedChainGlobals } from "./composed.js";
export type { ChainGlobal, ChainGlobals, ChainRef } from "./builder.js";

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
  CompiledBody,
  CompiledSauceProgram,
  CompiledSauceRoute,
  SauceCompileOptions,
  SauceProgramOptions,
  SauceEvmExecutionInput,
  SauceSvmExecutionInput,
} from "./sauce-route.js";
export { decodeEntryArguments, encodeEntryArguments } from "./entry.js";
export type { EntryParam, EntryValue } from "./entry.js";
export {
  ASYNC_PACKAGE,
  compileHandlers,
  handlersInstallSource,
  packageHandlerDeclarations,
  packageHandlers,
  packageInstall,
  packageInterfaces,
  packageReader,
} from "./handlers.js";
export type { CompiledHandler, HandlerDeclaration, PackageInstall } from "./handlers.js";
export {
  approvedHashSlot,
  ERC1271_HANDLER,
  ERC1271_NAMESPACE,
  erc1271Abi,
  POT_SIGNER_DOMAIN,
  potMessageDigest,
  potMessageTypedData,
} from "./erc1271.js";
export {
  SIGNED_DOMAIN,
  SIGNED_NAMESPACE,
  SIGNED_PACKAGE,
  cancelSaltsSource,
  encodeExecute,
  encodeExecuteAcross,
  executeAcrossTypedData,
  executeTypedData,
  executionHash,
  signedAbi,
  signedProgram,
  signedSalt,
  signedSaltSlot,
} from "./signed.js";
export type { SignedAcross, SignedCall, SignedExecution } from "./signed.js";

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
export { chainHop } from "./host-intent.js";
export { loggedIntents } from "./published.js";
export type { IntentLog, LoggedIntent } from "./published.js";
export { destinationPot } from "./intent-pot.js";
export type {
  ChainHop,
  HopAddress,
  HopCaughtBytes,
  HopChain,
  HopConfig,
  HopDelivery,
  HopOpened,
  HopSend,
  HopSendItem,
  HopTokenAmount,
  HostHop,
  HostIntent,
  PotTarget,
} from "./host-intent.js";
export type { SauceBody } from "./closure.js";
export {
  DEFAULT_FILL_WINDOW,
  DEFAULT_REFUND_WINDOW,
  randomSalt,
  type IntentDefaults,
} from "./intent-defaults.js";
export {
  HOP_FIELDS,
  HOP_STAGES,
  type HopField,
  type HopFieldName,
  type HopStage,
  type HopStep,
} from "./intent-syntax.js";

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

/**
 * Compiling a program for a chain, and the chain accessors: one per canonical chain, generated from
 * `../chains/canonical.js`, each a namespace carrying `.chain`.
 *
 * The composed accessors (`.chain` and the native contract tree) are named exports of the package
 * root; `chainAccessors` below is the BARE record, carrying `.chain` alone.
 */
export { chain, chainAccessors, pascalOfSlug } from "./accessors.js";
export type { PascalOf } from "./accessors.js";

export { createChainGlobals, makeChainGlobal } from "./builder.js";
export { composedChainGlobal, composedChainGlobals } from "./composed.js";
export type { ChainGlobal, ChainGlobals, ChainRef } from "./builder.js";

export { toBigInt, toUniversalAddress } from "./normalize.js";

export { denormalizeToEvm, kindOf } from "./encode.js";
export type { ChainKindRef } from "./encode.js";

export type { AddressInput, CallInput, Hex, UniversalAddress } from "./types.js";

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

// --- compiling a program for a chain ---

export { compileSauceProgram, compileSauceRoute } from "./sauce-route.js";
export type {
  CompiledSauceProgram,
  CompiledSauceRoute,
  SauceCompileOptions,
  SauceProgramOptions,
  SauceEvmExecutionInput,
  SauceSvmExecutionInput,
  SourcePosition,
} from "./sauce-route.js";
export { decodeEntryArguments, encodeEntryArguments } from "./entry.js";
export type { EntryParam, EntryValue } from "./entry.js";

export { isSauceClosure, sauceBodyToSource } from "./closure.js";
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
  SourceVenue,
} from "./source-globals.js";
export type { SvmAccountExpression } from "./svm-account-expressions.js";
export { rewriteTokenMembers, REWRITABLE_METHODS, tokenImportLines } from "./token-rewrite.js";
export type { SafeWrite, TokenImports, TokenRewriteResult, TokenSymbols } from "./token-rewrite.js";
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

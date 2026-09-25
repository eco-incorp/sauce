/**
 * Contract descriptor layer — links a protocol's addresses.ts role key, its
 * abis.ts export, and a human contract name into one queryable
 * ContractDescriptor, with a chain-keyed forward/reverse index on top.
 *
 * See links.ts for the linkage table and its module doc comment for scope
 * (a starter set of 15 protocols, not all ~128), and query.ts for the query
 * API. `describeContract`/`requireContract` are the thin resolver the
 * fluent accessor tree (`Base.Uniswap.UniversalRouter.method`, a separate,
 * later piece of work) is built on top of.
 */
export type {
  ContractDescriptor,
  ContractCoverage,
  ContractKind,
  DescriptorMethod,
  ResolvedContract,
  StateMutability,
} from "./types.js";
export type { ContractLink, ContractLinkEntry } from "./links.js";
export { CONTRACT_LINKS } from "./links.js";
export { DESCRIPTORS, byChain, byProtocol, byProtocolAndContract } from "./registry.js";
export {
  addressOn,
  contractsOnChain,
  describeContract,
  descriptorChains,
  getDescriptor,
  listContracts,
  listDescriptors,
  listInterfaces,
  methodOf,
  protocolsOnChain,
  requireContract,
  selectorOf,
} from "./query.js";
export {
  buildDescriptor,
  buildMethods,
  buildPerChainAddress,
  deriveChainSlugs,
  deriveContractName,
} from "./derive.js";

// E2.3: the native accessor tree (`Base.Uniswap.UniversalRouter.method(...)`).
export { chainContracts, on, type ChainContracts, type ContractAccessor } from "./accessors.js";
export {
  makeContractCall,
  CONTRACT_BASE_DIRS,
  type ContractCall,
  type EncodeOptions,
  type SauceScriptOptions,
} from "./call.js";
export type {
  ContractNameOf,
  FamilyContracts,
  FamilyKey,
  FamilyOf,
  ProtocolNamespaceKey,
  ProtocolSlug,
} from "./names.js";

/**
 * Contract descriptor layer — links a protocol's addresses.ts role key, its
 * abis.ts export, and a human contract name into one queryable
 * ContractDescriptor, with a chain-keyed forward/reverse index on top.
 *
 * See links.ts for where the table comes from (every registry protocol, generated from the
 * binding its ABI evidence is captured for) and query.ts for the query API.
 * `describeContract`/`requireContract` are the thin resolver the fluent accessor tree
 * (`Base.Uniswap.UniversalRouter.method`) is built on top of.
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

// The native accessor tree (`Base.Uniswap.UniversalRouter.method(...)`).
export {
  chainContracts,
  on,
  type AddressOnlyContract,
  type ChainContracts,
  type Contract,
  type ContractAccessor,
  type ContractMethod,
  type ContractMethods,
  type InterfaceContract,
} from "./accessors.js";
export {
  makeContractCall,
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

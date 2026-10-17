import type { ContractKind } from "./types.js";

/**
 * One registry contract: a protocol's addresses.ts role key, its abis.ts export, and the name it has
 * in a namespace (`Base.UniswapV3.QuoterV2`, `UniswapV3.QuoterV2` in a program).
 *
 * The table is GENERATED (`contracts.generated.ts`, by `scripts/gen-source-globals.mjs`) from the
 * binding the registry's ABI evidence is captured for, `test/fixtures/registry-abi/targets.json`: a
 * role is exposed with the ABI `registry-abi.test.ts` checks against its deployed code, and nothing
 * else. Every role with an EVM address is a contract:
 *  - `singleton` — a role bound to an ABI;
 *  - `address-only` — a role bound to no ABI, or to one the evidence marks `unverifiable` (its
 *    address only, no methods);
 *  - `interface` — an ABI bound to no role: no fixed address, so a caller binds one with `.at(...)`.
 *
 * A contract is named by its role key, first letter upper-cased, with the ABI export's spelling for
 * the role's leading words wherever the export spells the same words (`clFactory` under
 * `SlipstreamCLFactoryABI` is `CLFactory`). An interface, or a role bound to different ABIs on
 * different chains, is named after its ABI export (`deriveContractName`). The generator refuses a
 * name two contracts of one protocol would share.
 */
export interface ContractLink {
  readonly protocol: string;
  readonly roleKey?: string;
  readonly abiExport?: string;
  readonly contract: string;
  readonly kind: ContractKind;
  /** The chains this binding covers, where one role runs different ABIs on different chains. */
  readonly chains?: readonly number[];
  /** Default "exact". "widened" flags a vendored ABI using a wider-than-real type — the computed
   *  selector would NOT match the deployed contract. No registry ABI is widened. */
  readonly typeFidelity?: "widened";
  /** Where a deployment differs from the ABI, from the evidence's `exempt`/`unverified` records. */
  readonly caveats?: readonly string[];
}

/**
 * A registry function whose address output the registry knows the contract of: a factory's pool,
 * a pool's tokens, a vault's asset. GENERATED (`RETURNED_CONTRACTS`) from the `returns` of
 * `test/fixtures/registry-abi/targets.json`. Each names a sample call, and once the capture has
 * made it, `registry-abi.test.ts` holds the annotation to the contract that call returned, which
 * must dispatch every function of the ABI it names. One written before its capture says so
 * (`uncaptured`) until then.
 */
export interface ReturnedContractLink {
  readonly protocol: string;
  readonly abiExport: string;
  /** The function, canonical: `getPool(address,address,uint24)`. */
  readonly signature: string;
  /** Where the address is in what the function returns: `[]` for its one output, else the field
   *  names that lead to it (`["LBPair"]`). */
  readonly path: readonly string[];
  /** The contract the address is, as its namespace names it: `{ protocol: "uniswap-v3", contract:
   *  "Pool" }` is `UniswapV3.Pool`. */
  readonly returns: { readonly protocol: string; readonly contract: string };
}

export { CONTRACT_LINKS, RETURNED_CONTRACTS } from "./contracts.generated.js";
import type { CONTRACT_LINKS } from "./contracts.generated.js";

export type ContractLinkEntry = (typeof CONTRACT_LINKS)[number];

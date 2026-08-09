/**
 * Chain-scoped scalar ambient defines — `chainId`/protocol-contract addresses/caller token symbols,
 * threaded into `compile()`'s `defines` underneath a caller's own `IntentOptions.compile.defines`
 * (caller wins on a key collision; a user's own `let X = ...` inside the body wins over both, via
 * the compiler's own `getConstant`-only-when-`getVar`-is-undefined precedence).
 *
 * HARD FINDING: this SDK has no EVM token address registry (`protocols/erc20/addresses.ts` is
 * deliberately empty — "ERC20 is a standard interface, not a specific deployment") — so `USDC`
 * resolves ONLY from a caller-supplied `tokens` map. Shipping an unverified token address here would
 * be a direct value-loss hazard; a curated, separately-verified token registry is its own later
 * unit.
 *
 * Deliberately NOT here: `self` (a runtime intrinsic, not a `bigint|boolean|number` constant — the
 * working spelling stays the compiler's own `address.self`); SVM venue programIds; family-alias
 * spellings (`Uniswap_UniversalRouter` alongside `UniswapV4_UniversalRouter`); qualified cross-scope
 * `Base.USDC` (needs nesting).
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { DESCRIPTORS } from "../descriptors/registry.js";
import { pascalOfSlug } from "./builder.js";
import type { AddressInput } from "./types.js";

export interface AmbientDefinesOptions {
  /** Caller-supplied token symbol -> address map, e.g. `{ USDC: "0x..." }`. */
  readonly tokens?: Readonly<Record<string, AddressInput>>;
}

function toBigIntAddress(input: AddressInput): bigint {
  return BigInt(input);
}

/**
 * The chain-scoped ambient defines map for `chain`: `chainId`/`CHAIN_ID`, every EVM protocol
 * contract address that has a real entry on `chain.id`, and any caller-supplied token symbols.
 */
export function chainDefines(
  chain: CanonicalChain,
  opts: AmbientDefinesOptions = {},
): Record<string, bigint | boolean | number> {
  const defines: Record<string, bigint | boolean | number> = {
    chainId: BigInt(chain.id),
    CHAIN_ID: BigInt(chain.id),
  };

  if (chain.kind === "evm") {
    for (const d of DESCRIPTORS) {
      const address = d.perChainAddress[chain.id];
      if (address === undefined) continue;
      const key = `${pascalOfSlug(d.protocol)}_${d.contract}`;
      defines[key] = toBigIntAddress(address);
    }
  }

  if (opts.tokens) {
    for (const [symbol, address] of Object.entries(opts.tokens)) {
      defines[symbol] = toBigIntAddress(address);
    }
  }

  return defines;
}

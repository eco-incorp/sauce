// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/gen-route-globals.mjs from src/chains/canonical.ts's
// CANONICAL_CHAINS. Regenerate with `node scripts/gen-route-globals.mjs` after
// a registry change; sdk/test/routes-globals-drift.test.ts fails CI on drift.
//
// Ambient only -- carries no runtime code (the runtime install lives in
// ./globals.ts, generated separately by enumerating `chainAccessors`). Typing
// each entry as `ChainGlobals["<Name>"]` rather than spelling out
// `ChainGlobal` buys a free structural cross-check: `ChainGlobals` is keyed
// by `PascalOf<ChainSlug>`, so a name that no longer exists in the registry
// fails `tsc` here before the drift test even runs. A `const` typed with a
// call-signature-bearing interface is callable in TS, so `Base(sauce)`
// typechecks zero-import through this ambient chain.
import type { ChainGlobals } from "./builder.js";
import type { ChainContracts } from "../descriptors/accessors.js";
import type { SvmVenueAccessors } from "../svm/accessors.js";
import type { TokenApi } from "../token/api.js";

declare global {
  /** eco-routes chain global for Ethereum (chain id 1). */
  const Ethereum: ChainGlobals["Ethereum"] & ChainContracts;
  /** eco-routes chain global for Optimism (chain id 10). */
  const Optimism: ChainGlobals["Optimism"] & ChainContracts;
  /** eco-routes chain global for BNB Chain (chain id 56). */
  const Bsc: ChainGlobals["Bsc"] & ChainContracts;
  /** eco-routes chain global for Polygon (chain id 137). */
  const Polygon: ChainGlobals["Polygon"] & ChainContracts;
  /** eco-routes chain global for Base (chain id 8453). */
  const Base: ChainGlobals["Base"] & ChainContracts;
  /** eco-routes chain global for Arbitrum One (chain id 42161). */
  const Arbitrum: ChainGlobals["Arbitrum"] & ChainContracts;
  /** eco-routes chain global for Celo (chain id 42220). */
  const Celo: ChainGlobals["Celo"] & ChainContracts;
  /** eco-routes chain global for Cronos (chain id 25). */
  const Cronos: ChainGlobals["Cronos"] & ChainContracts;
  /** eco-routes chain global for Gnosis (chain id 100). */
  const Gnosis: ChainGlobals["Gnosis"] & ChainContracts;
  /** eco-routes chain global for Fuse (chain id 122). */
  const Fuse: ChainGlobals["Fuse"] & ChainContracts;
  /** eco-routes chain global for Manta Pacific (chain id 169). */
  const Manta: ChainGlobals["Manta"] & ChainContracts;
  /** eco-routes chain global for opBNB (chain id 204). */
  const Opbnb: ChainGlobals["Opbnb"] & ChainContracts;
  /** eco-routes chain global for Fantom (chain id 250). */
  const Fantom: ChainGlobals["Fantom"] & ChainContracts;
  /** eco-routes chain global for Boba (chain id 288). */
  const Boba: ChainGlobals["Boba"] & ChainContracts;
  /** eco-routes chain global for zkSync Era (chain id 324). */
  const Zksync: ChainGlobals["Zksync"] & ChainContracts;
  /** eco-routes chain global for PulseChain (chain id 369). */
  const Pulsechain: ChainGlobals["Pulsechain"] & ChainContracts;
  /** eco-routes chain global for Metis (chain id 1088). */
  const Metis: ChainGlobals["Metis"] & ChainContracts;
  /** eco-routes chain global for Core (chain id 1116). */
  const Core: ChainGlobals["Core"] & ChainContracts;
  /** eco-routes chain global for Moonbeam (chain id 1284). */
  const Moonbeam: ChainGlobals["Moonbeam"] & ChainContracts;
  /** eco-routes chain global for Sei (chain id 1329). */
  const Sei: ChainGlobals["Sei"] & ChainContracts;
  /** eco-routes chain global for Kava (chain id 2222). */
  const Kava: ChainGlobals["Kava"] & ChainContracts;
  /** eco-routes chain global for Mantle (chain id 5000). */
  const Mantle: ChainGlobals["Mantle"] & ChainContracts;
  /** eco-routes chain global for ZetaChain (chain id 7000). */
  const Zetachain: ChainGlobals["Zetachain"] & ChainContracts;
  /** eco-routes chain global for Klaytn (chain id 8217). */
  const Klaytn: ChainGlobals["Klaytn"] & ChainContracts;
  /** eco-routes chain global for Evmos (chain id 9001). */
  const Evmos: ChainGlobals["Evmos"] & ChainContracts;
  /** eco-routes chain global for Mode (chain id 34443). */
  const Mode: ChainGlobals["Mode"] & ChainContracts;
  /** eco-routes chain global for Avalanche C-Chain (chain id 43114). */
  const Avalanche: ChainGlobals["Avalanche"] & ChainContracts;
  /** eco-routes chain global for Linea (chain id 59144). */
  const Linea: ChainGlobals["Linea"] & ChainContracts;
  /** eco-routes chain global for Berachain (chain id 80094). */
  const Berachain: ChainGlobals["Berachain"] & ChainContracts;
  /** eco-routes chain global for Blast (chain id 81457). */
  const Blast: ChainGlobals["Blast"] & ChainContracts;
  /** eco-routes chain global for Scroll (chain id 534352). */
  const Scroll: ChainGlobals["Scroll"] & ChainContracts;
  /** eco-routes chain global for Zora (chain id 7777777). */
  const Zora: ChainGlobals["Zora"] & ChainContracts;
  /** eco-routes chain global for Aurora (chain id 1313161554). */
  const Aurora: ChainGlobals["Aurora"] & ChainContracts;
  /** eco-routes chain global for Unichain (chain id 130). */
  const Unichain: ChainGlobals["Unichain"] & ChainContracts;
  /** eco-routes chain global for Monad (chain id 143). */
  const Monad: ChainGlobals["Monad"] & ChainContracts;
  /** eco-routes chain global for Sonic (chain id 146). */
  const Sonic: ChainGlobals["Sonic"] & ChainContracts;
  /** eco-routes chain global for Ronin (chain id 2020). */
  const Ronin: ChainGlobals["Ronin"] & ChainContracts;
  /** eco-routes chain global for Plasma (chain id 9745). */
  const Plasma: ChainGlobals["Plasma"] & ChainContracts;
  /** eco-routes chain global for Ink (chain id 57073). */
  const Ink: ChainGlobals["Ink"] & ChainContracts;
  /** eco-routes chain global for Solana (chain id 1399811149). */
  const Solana: ChainGlobals["Solana"] & ChainContracts & SvmVenueAccessors;
  /** Runtime-resolved origin: `chain('eth')`, `chain(8453)`. */
  const chain: typeof import("./accessors.js").chain;
  /** Universal token interface — ERC20 on EVM targets, SPL Token on svm. */
  const Token: TokenApi;
}

export {};

// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/gen-route-globals.mjs from src/chains/canonical.ts's
// CANONICAL_CHAINS. Regenerate with `node scripts/gen-route-globals.mjs` after
// a registry change; sdk/test/routes-globals-drift.test.ts fails CI on drift.
//
// Ambient only -- carries no runtime code (the runtime install lives in
// ./globals.ts, generated separately by enumerating `chainAccessors`). Typing
// each entry as `Accessors["<Name>"]` rather than spelling out
// `ChainOrigin<RouteInput, RewardInput>` buys a free structural cross-check:
// `ChainAccessors` is keyed by `PascalOf<ChainSlug>`, so a name that no longer
// exists in the registry fails `tsc` here before the drift test even runs.
import type { ChainAccessors } from "./builder.js";
import type { RewardInput, RouteInput } from "./types.js";
import type { ChainContracts } from "../descriptors/accessors.js";
import type { TokenApi } from "../token/api.js";

type Accessors = ChainAccessors<RouteInput, RewardInput>;

declare global {
  /** eco-routes origin accessor for Ethereum (chain id 1). */
  const Ethereum: Accessors["Ethereum"] & ChainContracts;
  /** eco-routes origin accessor for Optimism (chain id 10). */
  const Optimism: Accessors["Optimism"] & ChainContracts;
  /** eco-routes origin accessor for BNB Chain (chain id 56). */
  const Bsc: Accessors["Bsc"] & ChainContracts;
  /** eco-routes origin accessor for Polygon (chain id 137). */
  const Polygon: Accessors["Polygon"] & ChainContracts;
  /** eco-routes origin accessor for Base (chain id 8453). */
  const Base: Accessors["Base"] & ChainContracts;
  /** eco-routes origin accessor for Arbitrum One (chain id 42161). */
  const Arbitrum: Accessors["Arbitrum"] & ChainContracts;
  /** eco-routes origin accessor for Celo (chain id 42220). */
  const Celo: Accessors["Celo"] & ChainContracts;
  /** eco-routes origin accessor for Cronos (chain id 25). */
  const Cronos: Accessors["Cronos"] & ChainContracts;
  /** eco-routes origin accessor for Gnosis (chain id 100). */
  const Gnosis: Accessors["Gnosis"] & ChainContracts;
  /** eco-routes origin accessor for Fuse (chain id 122). */
  const Fuse: Accessors["Fuse"] & ChainContracts;
  /** eco-routes origin accessor for Manta Pacific (chain id 169). */
  const Manta: Accessors["Manta"] & ChainContracts;
  /** eco-routes origin accessor for opBNB (chain id 204). */
  const Opbnb: Accessors["Opbnb"] & ChainContracts;
  /** eco-routes origin accessor for Fantom (chain id 250). */
  const Fantom: Accessors["Fantom"] & ChainContracts;
  /** eco-routes origin accessor for Boba (chain id 288). */
  const Boba: Accessors["Boba"] & ChainContracts;
  /** eco-routes origin accessor for zkSync Era (chain id 324). */
  const Zksync: Accessors["Zksync"] & ChainContracts;
  /** eco-routes origin accessor for PulseChain (chain id 369). */
  const Pulsechain: Accessors["Pulsechain"] & ChainContracts;
  /** eco-routes origin accessor for Metis (chain id 1088). */
  const Metis: Accessors["Metis"] & ChainContracts;
  /** eco-routes origin accessor for Core (chain id 1116). */
  const Core: Accessors["Core"] & ChainContracts;
  /** eco-routes origin accessor for Moonbeam (chain id 1284). */
  const Moonbeam: Accessors["Moonbeam"] & ChainContracts;
  /** eco-routes origin accessor for Sei (chain id 1329). */
  const Sei: Accessors["Sei"] & ChainContracts;
  /** eco-routes origin accessor for Kava (chain id 2222). */
  const Kava: Accessors["Kava"] & ChainContracts;
  /** eco-routes origin accessor for Mantle (chain id 5000). */
  const Mantle: Accessors["Mantle"] & ChainContracts;
  /** eco-routes origin accessor for ZetaChain (chain id 7000). */
  const Zetachain: Accessors["Zetachain"] & ChainContracts;
  /** eco-routes origin accessor for Klaytn (chain id 8217). */
  const Klaytn: Accessors["Klaytn"] & ChainContracts;
  /** eco-routes origin accessor for Evmos (chain id 9001). */
  const Evmos: Accessors["Evmos"] & ChainContracts;
  /** eco-routes origin accessor for Mode (chain id 34443). */
  const Mode: Accessors["Mode"] & ChainContracts;
  /** eco-routes origin accessor for Avalanche C-Chain (chain id 43114). */
  const Avalanche: Accessors["Avalanche"] & ChainContracts;
  /** eco-routes origin accessor for Linea (chain id 59144). */
  const Linea: Accessors["Linea"] & ChainContracts;
  /** eco-routes origin accessor for Berachain (chain id 80094). */
  const Berachain: Accessors["Berachain"] & ChainContracts;
  /** eco-routes origin accessor for Blast (chain id 81457). */
  const Blast: Accessors["Blast"] & ChainContracts;
  /** eco-routes origin accessor for Scroll (chain id 534352). */
  const Scroll: Accessors["Scroll"] & ChainContracts;
  /** eco-routes origin accessor for Zora (chain id 7777777). */
  const Zora: Accessors["Zora"] & ChainContracts;
  /** eco-routes origin accessor for Aurora (chain id 1313161554). */
  const Aurora: Accessors["Aurora"] & ChainContracts;
  /** eco-routes origin accessor for Unichain (chain id 130). */
  const Unichain: Accessors["Unichain"] & ChainContracts;
  /** eco-routes origin accessor for Sonic (chain id 146). */
  const Sonic: Accessors["Sonic"] & ChainContracts;
  /** eco-routes origin accessor for Ronin (chain id 2020). */
  const Ronin: Accessors["Ronin"] & ChainContracts;
  /** eco-routes origin accessor for Plasma (chain id 9745). */
  const Plasma: Accessors["Plasma"] & ChainContracts;
  /** eco-routes origin accessor for Ink (chain id 57073). */
  const Ink: Accessors["Ink"] & ChainContracts;
  /** eco-routes origin accessor for Solana (chain id 1399811149). */
  const Solana: Accessors["Solana"] & ChainContracts;
  /** Runtime-resolved origin: `chain('eth')`, `chain(8453)`. */
  const chain: typeof import("./accessors.js").chain;
  /** Universal token interface — ERC20 on EVM targets, SPL Token on svm. */
  const Token: TokenApi;
}

export {};

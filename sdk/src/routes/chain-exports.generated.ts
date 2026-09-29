// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/gen-route-globals.mjs from src/chains/canonical.ts's
// CANONICAL_CHAINS. Regenerate with `node scripts/gen-route-globals.mjs` after
// a registry change; sdk/test/routes-globals-drift.test.ts fails CI on drift.
//
// One NAMED EXPORT per canonical chain: `import { Base, Solana } from "@eco-incorp/sauce"`.
// Nothing here touches `globalThis` -- see ./globals.ts for the opt-in install, and
// ./source-globals.generated.ts for the separate, compile-time names a SauceScript
// route BODY sees (`USDC`, `Uniswap`), which are not a TypeScript runtime surface.
//
// Typing each entry as `ChainGlobals["<Name>"]` rather than spelling out
// `ChainGlobal` buys a free structural cross-check: `ChainGlobals` is keyed
// by `PascalOf<ChainSlug>`, so a name that no longer exists in the registry
// fails `tsc` here before the drift test even runs.
//
// Composition is EAGER at module eval -- measured at ~1.4ms for all 40 chains,
// against ~180ms just to load the modules involved -- because every contract
// namespace underneath is a memoising getter, so composing only copies property
// descriptors and builds nothing under `Base.Uniswap` until it is touched. A
// lazily-evaluated named export is not expressible in ESM anyway.
//
// `Token` is re-exported here with `TokenFactory` intersected in, which is what makes
// `Token(addr).approve(...)` typecheck in a TYPED CLOSURE body and not only in one
// supplied as source text. It is intersected here rather than declared on `TokenApi`
// because the runtime `Token` value is a frozen object and is not callable -- the
// `Token(x)` spelling is rewritten to `IERC20.at(x)` before the compiler sees it and
// is never invoked by the host.
import type { ChainGlobals } from "./builder.js";
import type { ChainContracts } from "../descriptors/accessors.js";
import type { SvmVenueAccessors } from "../svm/accessors.js";
import type { TokenApi, TokenFactory } from "../token/api.js";
import { Token as tokenApi } from "../token/api.js";
import { composedChainGlobal } from "./composed.js";

/** What every chain accessor is: the eco-routes DSL for that chain (callable, plus
 *  `.chain`/`.route`) intersected with the chain-independent native contract tree.
 *  Naming the chain through `ChainGlobals` is the structural cross-check above. */
type Composed<N extends keyof ChainGlobals> = ChainGlobals[N] & ChainContracts;

/** eco-routes chain accessor for Ethereum (chain id 1). */
export const Ethereum = composedChainGlobal("Ethereum") as Composed<"Ethereum">;
/** eco-routes chain accessor for Optimism (chain id 10). */
export const Optimism = composedChainGlobal("Optimism") as Composed<"Optimism">;
/** eco-routes chain accessor for BNB Chain (chain id 56). */
export const Bsc = composedChainGlobal("Bsc") as Composed<"Bsc">;
/** eco-routes chain accessor for Polygon (chain id 137). */
export const Polygon = composedChainGlobal("Polygon") as Composed<"Polygon">;
/** eco-routes chain accessor for Base (chain id 8453). */
export const Base = composedChainGlobal("Base") as Composed<"Base">;
/** eco-routes chain accessor for Arbitrum One (chain id 42161). */
export const Arbitrum = composedChainGlobal("Arbitrum") as Composed<"Arbitrum">;
/** eco-routes chain accessor for Celo (chain id 42220). */
export const Celo = composedChainGlobal("Celo") as Composed<"Celo">;
/** eco-routes chain accessor for Cronos (chain id 25). */
export const Cronos = composedChainGlobal("Cronos") as Composed<"Cronos">;
/** eco-routes chain accessor for Gnosis (chain id 100). */
export const Gnosis = composedChainGlobal("Gnosis") as Composed<"Gnosis">;
/** eco-routes chain accessor for Fuse (chain id 122). */
export const Fuse = composedChainGlobal("Fuse") as Composed<"Fuse">;
/** eco-routes chain accessor for Manta Pacific (chain id 169). */
export const Manta = composedChainGlobal("Manta") as Composed<"Manta">;
/** eco-routes chain accessor for opBNB (chain id 204). */
export const Opbnb = composedChainGlobal("Opbnb") as Composed<"Opbnb">;
/** eco-routes chain accessor for Fantom (chain id 250). */
export const Fantom = composedChainGlobal("Fantom") as Composed<"Fantom">;
/** eco-routes chain accessor for Boba (chain id 288). */
export const Boba = composedChainGlobal("Boba") as Composed<"Boba">;
/** eco-routes chain accessor for zkSync Era (chain id 324). */
export const Zksync = composedChainGlobal("Zksync") as Composed<"Zksync">;
/** eco-routes chain accessor for PulseChain (chain id 369). */
export const Pulsechain = composedChainGlobal("Pulsechain") as Composed<"Pulsechain">;
/** eco-routes chain accessor for Metis (chain id 1088). */
export const Metis = composedChainGlobal("Metis") as Composed<"Metis">;
/** eco-routes chain accessor for Core (chain id 1116). */
export const Core = composedChainGlobal("Core") as Composed<"Core">;
/** eco-routes chain accessor for Moonbeam (chain id 1284). */
export const Moonbeam = composedChainGlobal("Moonbeam") as Composed<"Moonbeam">;
/** eco-routes chain accessor for Sei (chain id 1329). */
export const Sei = composedChainGlobal("Sei") as Composed<"Sei">;
/** eco-routes chain accessor for Kava (chain id 2222). */
export const Kava = composedChainGlobal("Kava") as Composed<"Kava">;
/** eco-routes chain accessor for Mantle (chain id 5000). */
export const Mantle = composedChainGlobal("Mantle") as Composed<"Mantle">;
/** eco-routes chain accessor for Arc (chain id 5042). */
export const Arc = composedChainGlobal("Arc") as Composed<"Arc">;
/** eco-routes chain accessor for ZetaChain (chain id 7000). */
export const Zetachain = composedChainGlobal("Zetachain") as Composed<"Zetachain">;
/** eco-routes chain accessor for Klaytn (chain id 8217). */
export const Klaytn = composedChainGlobal("Klaytn") as Composed<"Klaytn">;
/** eco-routes chain accessor for Evmos (chain id 9001). */
export const Evmos = composedChainGlobal("Evmos") as Composed<"Evmos">;
/** eco-routes chain accessor for Mode (chain id 34443). */
export const Mode = composedChainGlobal("Mode") as Composed<"Mode">;
/** eco-routes chain accessor for Avalanche C-Chain (chain id 43114). */
export const Avalanche = composedChainGlobal("Avalanche") as Composed<"Avalanche">;
/** eco-routes chain accessor for Linea (chain id 59144). */
export const Linea = composedChainGlobal("Linea") as Composed<"Linea">;
/** eco-routes chain accessor for Berachain (chain id 80094). */
export const Berachain = composedChainGlobal("Berachain") as Composed<"Berachain">;
/** eco-routes chain accessor for Blast (chain id 81457). */
export const Blast = composedChainGlobal("Blast") as Composed<"Blast">;
/** eco-routes chain accessor for Scroll (chain id 534352). */
export const Scroll = composedChainGlobal("Scroll") as Composed<"Scroll">;
/** eco-routes chain accessor for Zora (chain id 7777777). */
export const Zora = composedChainGlobal("Zora") as Composed<"Zora">;
/** eco-routes chain accessor for Aurora (chain id 1313161554). */
export const Aurora = composedChainGlobal("Aurora") as Composed<"Aurora">;
/** eco-routes chain accessor for Unichain (chain id 130). */
export const Unichain = composedChainGlobal("Unichain") as Composed<"Unichain">;
/** eco-routes chain accessor for Monad (chain id 143). */
export const Monad = composedChainGlobal("Monad") as Composed<"Monad">;
/** eco-routes chain accessor for Sonic (chain id 146). */
export const Sonic = composedChainGlobal("Sonic") as Composed<"Sonic">;
/** eco-routes chain accessor for Ronin (chain id 2020). */
export const Ronin = composedChainGlobal("Ronin") as Composed<"Ronin">;
/** eco-routes chain accessor for Plasma (chain id 9745). */
export const Plasma = composedChainGlobal("Plasma") as Composed<"Plasma">;
/** eco-routes chain accessor for Ink (chain id 57073). */
export const Ink = composedChainGlobal("Ink") as Composed<"Ink">;
/** eco-routes chain accessor for Solana (chain id 1399811149). */
export const Solana = composedChainGlobal("Solana") as Composed<"Solana"> & SvmVenueAccessors;

/** Runtime-resolved origin: `chain('eth')`, `chain(8453)`. */
export { chain } from "./accessors.js";

/** Universal token interface — ERC20 on EVM targets, SPL Token on svm. Callable as
 *  `Token(addr)` in a route body (the wrapper, rewritten to `IERC20.at(addr)`), and carries
 *  the runtime spec-object API for use outside one. */
export const Token: TokenApi & TokenFactory = tokenApi as TokenApi & TokenFactory;

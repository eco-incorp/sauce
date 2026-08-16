/**
 * Fluent builder stage machinery. Generic over `<TRoute, TReward>` and
 * parameterized by an `assemble` function, so a v3 reward-leg model can
 * instantiate a whole new builder without forking this file — only
 * `intent.ts` (and `types.ts`) need to change.
 *
 * Every stage is an immutable value: a transition allocates a new stage
 * rather than mutating one in place, so a `PendingLeg`/`ChainStage` can be
 * branched and reused safely (see `sdk/test/routes.test.ts`'s "stage
 * immutability" cases).
 */
import type { CanonicalChain, ChainSlug } from "../chains/canonical.js";
import type { Intent, RouteInput, RewardInput } from "./types.js";
export type ChainRef = number | string | CanonicalChain;
/**
 * `PascalOf<"bnb-chain">` = `"BnbChain"`. Matches the runtime `pascal()`
 * derivation in `accessors.ts` by construction (both reduce to
 * `Capitalize<S>` composed across `-`-separated segments) — re-exported from
 * `accessors.ts` so callers only need one import site.
 */
export type PascalOf<S extends string> = S extends `${infer H}-${infer T}` ? `${Capitalize<H>}${PascalOf<T>}` : Capitalize<S>;
/** One generated method per canonical chain slug, PascalCase-keyed. */
export type DestinationSelectors<R, W> = {
    readonly [S in ChainSlug as PascalOf<S>]: DestinationMethod<R, W>;
};
export interface DestinationMethod<R = RouteInput, W = RewardInput> {
    /** TERMINAL close: no destination route -> the chain is finished, intents are returned. */
    (): Intent[];
    /** CONTINUING close: attaches the destination route; this chain becomes the next leg's source. */
    (route: R): ChainStage<R, W>;
}
export interface ChainOrigin<R = RouteInput, W = RewardInput> {
    /** The registry record this accessor was generated from (or resolved via `chain(ref)`). */
    readonly chain: CanonicalChain;
    /** Opens a leg FROM this chain, escrowing `reward` here. */
    route(reward: W): PendingLeg<R, W>;
}
export interface PendingLeg<R = RouteInput, W = RewardInput> extends DestinationSelectors<R, W> {
    /** Dynamic destination (runtime-resolved chain). Mirrors the generated selectors' two arities. */
    to(ref: ChainRef): Intent[];
    to(ref: ChainRef, route: R): ChainStage<R, W>;
}
export interface ChainStage<R = RouteInput, W = RewardInput> extends Iterable<Intent> {
    /** The chain the previous leg landed on -- the SOURCE of the next leg. */
    readonly chain: CanonicalChain;
    /** Opens the next leg from `chain`. */
    route(reward: W): PendingLeg<R, W>;
    /** Finishes without another leg. Returns a fresh array each call. */
    build(): Intent[];
}
export type Assembler<R, W> = (source: CanonicalChain, destination: CanonicalChain, route: R | undefined, reward: W) => Intent;
/**
 * Builds the top-level `ChainOrigin` for `chain` -- what a generated
 * accessor (`chainAccessors.Base`) or `chain(ref)` returns.
 */
export declare function makeChainOrigin<R, W>(chain: CanonicalChain, assemble: Assembler<R, W>): ChainOrigin<R, W>;
/** One generated `ChainOrigin` per canonical chain, PascalCase-keyed. */
export type ChainAccessors<R = RouteInput, W = RewardInput> = {
    readonly [S in ChainSlug as PascalOf<S>]: ChainOrigin<R, W>;
};
/**
 * Generates the top-level chain accessors from `../chains/canonical.js`,
 * parameterized by `assemble` -- the v3-swappable seam. Adding a chain to
 * `CANONICAL_CHAINS` adds an accessor here with zero code changes; a
 * duplicate PascalCase key (two slugs colliding after casing) throws at
 * module-eval time rather than silently overwriting one accessor with
 * another.
 */
export declare function createChainAccessors<R, W>(assemble: Assembler<R, W>): ChainAccessors<R, W>;
/**
 * `PascalOf`'s runtime mirror: split on `-`, upper-case each segment's first
 * character, join. Agrees with the type-level `PascalOf` by construction
 * (both reduce to `Capitalize<S>` per `-`-separated segment) as long as a
 * slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` -- pinned by
 * `chains-canonical.test.ts`.
 */
export declare function pascalOfSlug(slug: string): string;
//# sourceMappingURL=builder.d.ts.map
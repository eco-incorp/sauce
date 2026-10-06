/**
 * The SVM twin of ../descriptors/accessors.ts: `Solana.<Venue>.<op>(...)`, a
 * native accessor over the SVM venue adapters registered in
 * ./venues/registry.ts, unified onto the SAME global `Solana` that already
 * carries `.route(...)` (see ../routes/globals.ts's svm branch).
 *
 * Registry-derived, walk-not-reimplement, same as its EVM counterpart: the
 * tree below enumerates `listVenues()`/`venueAdapter()` (registry.ts) — it
 * never duplicates an adapter's own logic. Every namespace and leaf is a
 * memoising GETTER (`Object.defineProperty`, never eager construction/
 * spread), so nothing is built until touched.
 *
 * SCOPE: only the TEN adapters actually registered in ./venues/registry.ts
 * (the SDK's own statement of what it supports — see that file's own
 * "Keys MUST equal adapter.slug" invariant, now enforced there). The other
 * ~77 venue directories under ./venues/ are exported but unregistered — they
 * stay reachable by name through the `/svm` subpath barrel
 * (`import { orcaWhirlpool } from '@eco-incorp/sauce/svm'`), just not on
 * this accessor tree. Registering an eleventh adapter in registry.ts makes
 * `Solana.<NewVenue>` appear here with zero code change — `SvmVenueSlug` is
 * `RegisteredVenueSlug` (`keyof` the registry table), and `venues()` walks
 * `listVenues()` directly.
 *
 * NO FAMILY ALIASES (unlike ../descriptors/accessors.ts's `-v<N>` stem
 * synthesis for EVM protocols) — one PascalCase name per registered adapter
 * slug, no invented groupings the registry does not itself assert.
 *
 * LEAF HONESTY: every member below is a thin, `this`-bound forward to the
 * IDENTICALLY-shaped SvmVenueAdapter member (types.ts) — same behavior, same
 * errors, same returned objects. Only two are renamed, and only to read as an
 * accessor rather than an internal: `buildSwap` -> `swap`, `emitQuote` ->
 * `quoteSource` (it returns SauceScript SOURCE TEXT, a string, not a number).
 * `fetchPoolConfig` -> `poolConfig` for the same reason: the accessor fetches
 * nothing itself — it calls whatever `AccountLoader` the caller hands it (RPC
 * in production, `fixtureLoader` in tests); it constructs no RPC client,
 * reads no env, holds no connection. `poolConfig` is consequently the ONE
 * async member of this leaf; every other member is a synchronous, pure
 * function of its arguments requiring a caller-supplied decoded `PoolConfig`
 * (and, for `referenceQuote`, a caller-supplied `AccountBytesMap` + `now`).
 *
 * NOT SURFACED, by design: pool discovery (no SVM pool address book exists —
 * a pool address is always a caller input, unlike EVM's `addressOn`), a
 * ladder/amount-parametric quote surface (the registry's ladder table is
 * EMPTY BY DESIGN — those were relocated to sauce-recipes), direction
 * inference, routing/splitting, transaction assembly, and `.at(address)`
 * rebinding (a venue is a program, not a per-chain contract instance).
 */
import type { Address } from "@solana/kit";
import type { PascalOf } from "../routes/builder.js";
import { pascalOfSlug } from "../routes/pascal.js";
import type { RegisteredVenueSlug } from "./venues/registry.js";
import { listVenues, venueAdapter } from "./venues/registry.js";
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from "./venues/types.js";

/** Registered venue slugs only — see this module's own header for why the other ~77 are excluded. */
export type SvmVenueSlug = RegisteredVenueSlug;

/**
 * One leaf: `Solana.<Venue>`. Every member forwards to the identically-shaped
 * `SvmVenueAdapter` member (`.adapter`) — an accessor call and a direct
 * adapter call are indistinguishable in behavior, errors, and returned
 * objects.
 */
export interface SvmVenueAccessor {
  readonly slug: SvmVenueSlug;
  readonly kind: SvmVenueAdapter["kind"];
  /** Mainnet program id. Zero I/O, resolvable at import. */
  readonly programId: Address;
  /** The real adapter object, by identity — the escape hatch for anything this leaf doesn't surface. */
  readonly adapter: SvmVenueAdapter;
  /** `adapter.fetchPoolConfig` — the ONE async member; `load` is caller-supplied, never constructed here. */
  poolConfig(load: AccountLoader, pool: Address): Promise<PoolConfig>;
  /** `adapter.quoteAccounts` — the read-only accounts the quote fragment reads. */
  quoteAccounts(cfg: PoolConfig): VenueAccount[];
  /** `adapter.emitQuote` — a SauceScript fragment; `amountIn` is baked as a compile-time literal, not amount-parametric. */
  quoteSource(cfg: PoolConfig, i: number, amountIn: bigint): string;
  /** `adapter.buildSwap` — pure encoding; `accounts` entries are refs the caller resolves, and venue-level min_out is 1. */
  swap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap;
  /** `adapter.referenceQuote` — the off-chain integer mirror; reads only the caller-supplied `state`. */
  referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, now: bigint): bigint;
}

/** The whole typed tree `venues()` returns — one namespace per registered adapter slug. */
export type SvmVenueAccessors = {
  readonly [S in SvmVenueSlug as PascalOf<S>]: SvmVenueAccessor;
};

function buildVenueAccessor(adapter: SvmVenueAdapter): SvmVenueAccessor {
  return {
    slug: adapter.slug as SvmVenueSlug,
    kind: adapter.kind,
    programId: adapter.programId,
    adapter,
    poolConfig: (load, pool) => adapter.fetchPoolConfig(load, pool),
    quoteAccounts: (cfg) => adapter.quoteAccounts(cfg),
    quoteSource: (cfg, i, amountIn) => adapter.emitQuote(cfg, i, amountIn),
    swap: (cfg, user, amountIn) => adapter.buildSwap(cfg, user, amountIn),
    referenceQuote: (cfg, state, amountIn, now) =>
      adapter.referenceQuote(cfg, state, amountIn, now),
  };
}

/**
 * Slug-based front door: `venue('raydium-cp-swap').swap(...)` — the
 * analogue of `descriptors/accessors.ts`'s `on(chainRef)`, for a caller
 * resolving a venue at run time rather than naming `Solana.RaydiumCpSwap`.
 */
export function venue(slug: SvmVenueSlug): SvmVenueAccessor {
  return buildVenueAccessor(venueAdapter(slug));
}

/**
 * The lazy, memoising tree the `Solana` global composes (see
 * ../routes/globals.ts). Builds zero adapter wrappers until a namespace is
 * actually touched; two reads of the same namespace off one `venues()` call
 * return the identical object.
 */
export function venues(): SvmVenueAccessors {
  const out: Record<string, unknown> = {};
  for (const slug of listVenues()) {
    const key = pascalOfSlug(slug);
    if (key in out) {
      throw new Error(`svm/accessors: duplicate venue namespace '${key}' (from slug '${slug}')`);
    }
    let memo: SvmVenueAccessor | undefined;
    Object.defineProperty(out, key, {
      enumerable: true,
      configurable: true,
      get(): SvmVenueAccessor {
        if (memo === undefined) memo = buildVenueAccessor(venueAdapter(slug));
        return memo;
      },
    });
  }
  return out as unknown as SvmVenueAccessors;
}

/**
 * Type-only literal-name derivation for the E2.3 native accessor tree
 * (`Base.Uniswap.UniversalRouter.method(...)`). No runtime code — every type
 * here is computed from `CONTRACT_LINKS as const` (links.ts), which is why
 * links.ts's 22 previously-derived-only entries gained an explicit
 * `contract:` field (see that file's module comment): `Extract<...>["contract"]`
 * is a type error on an entry that omits it entirely.
 */
import type { PascalOf } from "../routes/builder.js";
import type { CONTRACT_LINKS } from "./links.js";
export type { PascalOf };
type Links = (typeof CONTRACT_LINKS)[number];
/** The literal protocol-slug union underlying the starter set, e.g. "uniswap-v4" | ... | "erc4626". */
export type ProtocolSlug = Links["protocol"];
/** `PascalOf<ProtocolSlug>` — the CANONICAL namespace key, e.g. "UniswapV4". Always unambiguous. */
export type ProtocolNamespaceKey = PascalOf<ProtocolSlug>;
type LinkOf<P extends ProtocolSlug> = Extract<Links, {
    protocol: P;
}>;
/** Every contract literally linked under protocol `P`, e.g. `ContractNameOf<"uniswap-v4">` = "PoolManager" | "UniversalRouter" | "PositionManager". */
export type ContractNameOf<P extends ProtocolSlug> = LinkOf<P>["contract"];
/** `"uniswap-v4"` -> `"uniswap"`; a slug with no trailing `-v<N>` yields `never` (no family alias). */
type StripV<S extends string> = S extends `${infer H}-v${string}` ? H : never;
/** The PascalCase family alias a protocol slug belongs to, or `never` if it has none. */
export type FamilyOf<P extends ProtocolSlug> = StripV<P> extends never ? never : PascalOf<StripV<P>>;
/** Every family alias key actually present in the starter set, e.g. "Uniswap" | "Aave" | "Compound" | ... */
export type FamilyKey = {
    [P in ProtocolSlug]: FamilyOf<P>;
}[ProtocolSlug];
type MembersOf<F extends FamilyKey> = {
    [P in ProtocolSlug]: FamilyOf<P> extends F ? P : never;
}[ProtocolSlug];
type FamilyLinksOf<F extends FamilyKey> = Extract<Links, {
    protocol: MembersOf<F>;
}>;
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
/** True iff `T` is a union of 2+ members (as opposed to a single literal). */
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;
/**
 * Contract names safely exposed on family alias `F` — a strict ALLOWLIST:
 * a name owned by exactly ONE family member passes through; a name owned by
 * two or more (e.g. "Factory" under "Uniswap", present in both uniswap-v2
 * and uniswap-v3) resolves its own mapped-type branch to `never` and is
 * dropped from the union entirely. Fail-closed by construction, not by
 * enumerating known-bad names.
 */
export type FamilyContracts<F extends FamilyKey> = {
    [N in FamilyLinksOf<F>["contract"]]: IsUnion<Extract<FamilyLinksOf<F>, {
        contract: N;
    }>["protocol"]> extends true ? never : N;
}[FamilyLinksOf<F>["contract"]];
//# sourceMappingURL=names.d.ts.map
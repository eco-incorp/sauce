/**
 * A chain's or a protocol's name as a program and the package write it: `bnb-chain` is `BnbChain`.
 * A module of its own, importing nothing, so every module that names a chain can import it without
 * reaching the chain exports.
 */

/** `PascalOf<"bnb-chain">` = `"BnbChain"`: the type-level twin of {@link pascalOfSlug}. */
export type PascalOf<S extends string> = S extends `${infer H}-${infer T}`
  ? `${Capitalize<H>}${PascalOf<T>}`
  : Capitalize<S>;

/**
 * `PascalOf`'s runtime mirror: split on `-`, upper-case each segment's first character, join.
 * Agrees with the type-level `PascalOf` by construction (both reduce to `Capitalize<S>` per
 * `-`-separated segment) as long as a slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` -- pinned by
 * `chains-canonical.test.ts`.
 */
export function pascalOfSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

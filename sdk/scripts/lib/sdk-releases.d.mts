/** Every row of `changelog`'s version table, in its order, the Unreleased one included:
 *  `{ sdk, compiler, … }`. Throws, naming what is wrong, on a table it cannot read. */
export declare function versionTableOf(changelog: string): Array<Record<string, string>>;

/** Every released SDK of `changelog`'s version table, in its order: `{ sdk, compiler, … }`. Throws,
 *  naming what is wrong, on a table it cannot read. */
export declare function sdkReleasesOf(changelog: string): Array<Record<string, string>>;

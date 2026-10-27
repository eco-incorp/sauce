/** Every released SDK of `changelog`'s version table, in its order: `{ sdk, compiler, … }`. Throws,
 *  naming what is wrong, on a table it cannot read. */
export declare function sdkReleasesOf(changelog: string): Array<Record<string, string>>;

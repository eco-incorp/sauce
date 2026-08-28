import "./globals.generated.js";
export interface RouteGlobalsReport {
    /** Names this call actually defined. */
    readonly installed: readonly string[];
    /** Names already present on the target -- left untouched, never clobbered. */
    readonly skipped: readonly string[];
}
export interface InstallRouteGlobalsOptions {
    /** Defaults to `globalThis`. */
    readonly target?: object;
    /** Whether to also install the `chain(ref)` front door. Defaults to `true`. */
    readonly includeChain?: boolean;
    /** Whether to also install the universal `Token` global. Defaults to `true`. */
    readonly includeToken?: boolean;
}
export declare function installRouteGlobals(opts?: InstallRouteGlobalsOptions): RouteGlobalsReport;
/** Removes every name this module has installed (across all calls) from
 * `target` (default `globalThis`) and clears the internal bookkeeping, so a
 * later `installRouteGlobals()` reinstalls cleanly rather than skipping. */
export declare function uninstallRouteGlobals(target?: object): void;
/**
 * Install-on-import result -- this IS the default-globals behavior. A host
 * that must not have `globalThis` mutated can opt out before the SDK is
 * ever imported: `globalThis.__ECO_ROUTES_NO_GLOBALS__ = true`.
 */
export declare const routeGlobals: RouteGlobalsReport;
//# sourceMappingURL=globals.d.ts.map
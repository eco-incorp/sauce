/**
 * `@eco-incorp/sauce/deployments` — the addresses of the pinned v12 releases, read from
 * `V12Deployments.json` (see `v12-addresses.ts`). They are ADDRESSES, not liveness: the SDK reads no
 * chain, so check for code on the target chain before relying on one.
 */
export * from "./releases.js";
export * from "./v12-addresses.js";

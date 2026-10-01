// @eco-incorp/sauce - Sauce Protocol SDK for all on-chain protocols
export * from "./core/types.js";
// In a browser, `await ready()` once before the first compile: the compiler's WebAssembly loads
// asynchronously there. In Node it is ready on import.
export { ready, type WasmSource } from "./wasm-compiler.js";
export * from "./chains/index.js";
export {
  protocols,
  getProtocol,
  listProtocols,
  getProtocolsByCategory,
  getProtocolsByChain,
  listProtocolSlugs,
} from "./protocols/index.js";
export { getProtocolIndex, getProtocolSkill, listSkillSlugs } from "./skills/loader.js";
export * as routes from "./routes/index.js";
export * as deposit from "./deposit/index.js";
export * as token from "./token/index.js";
export * as contracts from "./descriptors/index.js";
export * as svmVenues from "./svm/accessors.js";

// One named export per canonical chain: `import { Base, Solana } from "@eco-incorp/sauce"`,
// each callable (`Base(body, opts).reward(...)`) and carrying `.chain`/`.route` plus the
// lazy contract tree (`Base.Uniswap...`). Also `chain` and `Token`. Importing the SDK
// installs NOTHING on `globalThis` -- see routes/globals.ts for the opt-in install.
export * from "./routes/chain-exports.generated.js";
// Compile-time names inside route bodies; this module installs no JavaScript values. The
// BARE import is load-bearing for TYPES: it is what tsc preserves verbatim into
// dist/index.d.ts, carrying the ambient `declare global` block (`USDC`, `Uniswap`, ...)
// into a consumer's type graph so their typed route closures check. Do not "clean it up".
import "./routes/source-globals.generated.js";
export { installRouteGlobals, uninstallRouteGlobals, routeGlobals } from "./routes/globals.js";
export { destinationExecutionFee } from "./evm/execution-fee.js";
export type { ExecutionFeeCall } from "./evm/execution-fee.js";
export { SAUCE_INTENT_POT_SALT, v12PredictPot } from "./deployments/pot.js";
export { destinationPot } from "./routes/intent-pot.js";

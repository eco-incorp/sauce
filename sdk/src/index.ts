// @eco-incorp/sauce-sdk - Sauce Protocol SDK for all on-chain protocols
export * from "./core/types.js";
export * from "./chains/index.js";
export {
  protocols,
  getProtocol,
  listProtocols,
  getProtocolsByCategory,
  getProtocolsByChain,
  listProtocolSlugs,
} from "./protocols/index.js";
export {
  getProtocolIndex,
  getProtocolSkill,
  listSkillSlugs,
  SKILLS_DIR,
} from "./skills/loader.js";
export * as routes from "./routes/index.js";
export * as swap from "./swap/index.js";
export * as deposit from "./deposit/index.js";
export * as token from "./token/index.js";
export * as contracts from "./descriptors/index.js";

// eco-routes chain accessors as default globals: `Base.route(reward).Solana(route)`
// with no import. The bare import both installs at runtime and -- load-bearing --
// carries the generated ambient `declare global` block into a consumer's type
// graph (dist/index.d.ts preserves a bare import verbatim through declaration
// emit). Delete these two lines to opt out; runtime install and ambient types
// revert together. See routes/globals.ts for the finer-grained escape hatches
// (a `globalThis.__ECO_ROUTES_NO_GLOBALS__` flag, `uninstallRouteGlobals()`).
import "./routes/globals.js";
export { installRouteGlobals, uninstallRouteGlobals, routeGlobals } from "./routes/globals.js";

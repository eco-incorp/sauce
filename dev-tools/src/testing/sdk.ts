/**
 * The one module through which the testing kit reaches the SDK: its built output, by a RELATIVE
 * path. It resolves both here (`dev-tools/src/testing` -> `sdk/dist`) and in the published package
 * (`dev-tools/dist/testing` -> `sdk/dist`), as `actions` and `mcp` reach it. Build the SDK first.
 *
 * Nothing here reaches into `sdk/src/cli`: the command's modules are the `sauce` bin's alone.
 */
export {
  requireChain,
  type CanonicalChain,
  type ChainRef,
} from "../../../sdk/dist/chains/canonical.js";
export { compileSauceProgram } from "../../../sdk/dist/routes/sauce-route.js";
export {
  encodeEntryArguments,
  mainReturnType,
  parseEntryType,
  type EntryType,
  type EntryValue,
} from "../../../sdk/dist/routes/entry.js";
export { decodeReturned, type Returned } from "../../../sdk/dist/routes/returned.js";
export { buildSauceEvmCall } from "../../../sdk/dist/routes/sauce-calls.js";
export { TOKEN_REGISTRY } from "../../../sdk/dist/routes/token-registry.js";
export { BalanceSlotError, balanceOverride } from "../../../sdk/dist/evm/balance-slot.js";
export { deployReleaseStack } from "../../../sdk/dist/evm/release-stack.js";
export {
  addressLabels,
  effectsOf,
  type Effects,
  type Movement,
  type RawLog,
} from "../../../sdk/dist/evm/effects.js";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The SDK's synced engine artifacts (`sdk/dist/artifacts`), which ship in the package. */
export const ARTIFACTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../sdk/dist/artifacts",
);

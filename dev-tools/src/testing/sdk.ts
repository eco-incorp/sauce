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
export {
  compileSauceProgram,
  type CompiledSauceProgram,
} from "../../../sdk/dist/routes/sauce-route.js";
export {
  encodeEntryArguments,
  entryReturnType,
  parseEntryType,
  type EntryType,
  type EntryValue,
} from "../../../sdk/dist/routes/entry.js";
export { decodeReturned, type Returned } from "../../../sdk/dist/routes/returned.js";
export { buildSauceEvmCall } from "../../../sdk/dist/routes/sauce-calls.js";
export { TOKEN_REGISTRY, svmTokenRows } from "../../../sdk/dist/routes/token-registry.js";
export { BalanceSlotError, balanceOverride } from "../../../sdk/dist/evm/balance-slot.js";
export { deployReleaseStack } from "../../../sdk/dist/evm/release-stack.js";
export {
  addressLabels,
  effectsOf,
  type Effects,
  type Movement,
  type RawLog,
} from "../../../sdk/dist/evm/effects.js";

// Solana: the release's program ids, the Kitchen's and the engine's instructions, the account names
// `sauce` takes (`svm/account-names.ts`), and the packaged engine and Kitchen binaries.
export {
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../../../sdk/dist/deployments/index.js";
export {
  buildAtaPrepend,
  buildCloseCodeBufferInstruction,
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildCreateCodeBufferInstruction,
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildFinalizeCodeBufferInstruction,
  buildGrowCodeBufferInstruction,
  buildHeapFramePrepend,
  buildWriteCodeBufferInstruction,
  decodeExecutionFeeConfig,
  deriveCodeBufferPda,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  ENGINE_GAS_LIMIT_CU,
  engineFaultName,
  EXECUTION_FEE_CONFIG_DISCRIMINATOR,
  GROWTH_STEP,
  LOOKUP_TABLE_MAX_ADDRESSES,
  MAX_POT_LEN,
  resolveAccounts,
  resolveSvmAccountName,
  resolveTokenProgramByOwner,
  SvmAccountNameError,
  svmTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TRANSACTION_SIZE_LIMIT,
  type AccountResolution,
  type ResolvedSvmAccountName,
} from "../../../sdk/dist/svm/index.js";
export { svmProgramStops, svmStopValues } from "../../../sdk/dist/svm/compute-stops.js";
export {
  svmEnginePath,
  svmKitchenIdlPath,
  svmKitchenPath,
} from "../../../sdk/dist/svm/engine-artifacts.js";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The SDK's synced engine artifacts (`sdk/dist/artifacts`), which ship in the package. */
export const ARTIFACTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../sdk/dist/artifacts",
);

/** The runtime packages' manifest the package ships (`sdk/runtime`): the LiteSVM version pinned. */
export const RUNTIME_MANIFEST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../sdk/runtime/package.json",
);

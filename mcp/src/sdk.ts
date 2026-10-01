/**
 * The one place this server reaches into the SDK: the `sauce` command's own modules, as the SDK's
 * build emits them. Every tool calls the function the matching `sauce` command calls — compile,
 * tx, simulate, pot, globals, inspect, verify, publish — with the same inputs, so the two front
 * ends cannot drift. Nothing here is reimplemented.
 *
 * By relative path into `sdk/dist` (and `actions/dist`), the one spelling that resolves in the
 * repository and in the published tarball, where `mcp/dist`, `sdk/dist` and `actions/dist` are
 * siblings (as `actions` reaches the SDK).
 */
export { actionSource, type ActionSource } from "../../actions/dist/source.js";
export {
  CliError,
  parseAddress,
  parseChain,
  parseDefineMap,
  parseSalt,
  parseUnixSeconds,
  parseWei,
  UsageError,
  type DefineValue,
} from "../../sdk/dist/cli/args.js";
export {
  connect,
  endpointFor,
  kitchenFee,
  potState,
  registeredBalances,
} from "../../sdk/dist/cli/chain.js";
export {
  compileCommand,
  compileProgram,
  potCommand,
  txCommand,
  type CliFiles,
  type CommandOutput,
  type CookInput,
  type ProgramInput,
} from "../../sdk/dist/cli/commands.js";
export { globalsCommand } from "../../sdk/dist/cli/globals.js";
export {
  assumedBalances,
  definesReach,
  fundingFor,
  potTarget,
  programChain,
} from "../../sdk/dist/cli/inputs.js";
export { inspectCommand, inspectFile } from "../../sdk/dist/cli/inspect.js";
export type { McpEntry, McpServeOptions, McpSetupOptions } from "../../sdk/dist/cli/mcp.js";
export {
  parsePriceToken,
  priceCommand,
  pricedChain,
  priceGiven,
} from "../../sdk/dist/cli/price.js";
export { publishCommand } from "../../sdk/dist/cli/publish.js";
export { scrub, secret } from "../../sdk/dist/cli/signer.js";
export { simulateCommand } from "../../sdk/dist/cli/simulate.js";
export { PACKAGED_SKILLS, targetsFor as skillTargets } from "../../sdk/dist/cli/skills.js";
export {
  parseAccounts,
  parsePubkey,
  svmPotCommand,
  svmPotExists,
  svmPotTokenAccounts,
  svmSimulateCommand,
  svmTxCommand,
  svmVerifyCommand,
  type SvmCookInput,
} from "../../sdk/dist/cli/solana.js";
export { parsePin, verifyCommand } from "../../sdk/dist/cli/verify.js";
export {
  CANONICAL_CHAINS,
  chainById,
  type CanonicalChain,
} from "../../sdk/dist/chains/canonical.js";

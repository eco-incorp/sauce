/**
 * The one place this server reaches into the SDK: the `sauce` command's own modules, as the SDK's
 * build emits them. Every tool calls the function the matching `sauce` command calls — compile,
 * tx, simulate, pot, globals, inspect, verify — with the same inputs, so the two front ends cannot
 * drift. Nothing here is reimplemented.
 *
 * By relative path into `sdk/dist`, the one spelling that resolves in the repository and in the
 * published tarball, where `mcp/dist` and `sdk/dist` are siblings (as `actions` reaches the SDK).
 * An actions document is lowered by the CLI's `actions.ts`, which loads `actions/dist` itself.
 */
export { actionsCommand, actionsProgram } from "../../sdk/dist/cli/actions.js";
export {
  addressDefinesOf,
  CliError,
  parseAddress,
  parseChain,
  parseDefineMap,
  parseLamports,
  parseSalt,
  parseVia,
  parseWei,
  UsageError,
} from "../../sdk/dist/cli/args.js";
export {
  connect,
  connectAt,
  endpointFor,
  kitchenFee,
  potState,
  registeredBalances,
} from "../../sdk/dist/cli/chain.js";
export {
  compileCommand,
  compileProgram,
  expectingRevert,
  potCommand,
  txCommand,
  type CliFiles,
  type CommandOutput,
  type CompileInput,
  type CookInput,
  type ProgramInput,
} from "../../sdk/dist/cli/commands.js";
export { globalsCommand } from "../../sdk/dist/cli/globals.js";
export {
  assumedBalances,
  definesReach,
  fundingFor,
  fundTransfers,
  potImportTarget,
  potOwner,
  potTarget,
  programChain,
  withoutShebang,
} from "../../sdk/dist/cli/inputs.js";
export { inspectCommand, inspectFile } from "../../sdk/dist/cli/inspect.js";
export { keeping, keepsAny, type LocalStores } from "../../sdk/dist/cli/keep.js";
export type {
  McpEntry,
  McpServeOptions,
  McpSetupOptions,
  McpStores,
  McpWallets,
} from "../../sdk/dist/cli/mcp.js";
export { MAX_V4_KEYS, parseV4Key, poolsCommand, readPoolAt } from "../../sdk/dist/cli/pools.js";
export {
  priceCommand,
  pricedChain,
  priceGiven,
  resolvePriceTokens,
  tokenGiven,
} from "../../sdk/dist/cli/price.js";
export { potImportCommand, potListCommand } from "../../sdk/dist/cli/pot-commands.js";
export { PotStore } from "../../sdk/dist/cli/pot-store.js";
export { publicEndpoints, type PublicEndpoints } from "../../sdk/dist/cli/public-endpoints.js";
export { reclaimCommand, TABLES_PER_RUN } from "../../sdk/dist/cli/reclaim.js";
export { sendCommand, signedChain } from "../../sdk/dist/cli/send.js";
export { scrub, secret } from "../../sdk/dist/cli/signer.js";
export {
  CHAIN_SUPPORT_ISSUES_URL,
  CHAIN_SUPPORT_NEW_ISSUE_URL,
  chainSupport,
  chainSupportRequest,
  previewRefusal,
  PreviewChainError,
  requireSupported,
  supportedChainNames,
  type PreviewChainRefusal,
} from "../../sdk/dist/cli/support.js";
export { HOT_WALLET, looksLikeKey, openWallet } from "../../sdk/dist/cli/wallet-commands.js";
export { handoff } from "../../sdk/dist/cli/handoff.js";
export { describeSource, ENV_NAME, type PasswordSource } from "../../sdk/dist/cli/password.js";
export {
  checkPlan,
  planChain,
  plannedCursor,
  plannedHandedOut,
  planFor,
  plannedTransactions,
  sendPlan,
  sendSvmPlan,
} from "../../sdk/dist/cli/wallet-send.js";
export { noPolicyNote, PolicyRefusal, readPolicy } from "../../sdk/dist/cli/policy.js";
export {
  generatedPasswordFile,
  generatePasswordFile,
  readImport,
  walletName,
  WalletStore,
  type WalletKind,
} from "../../sdk/dist/cli/wallets.js";
export { simulateCommand } from "../../sdk/dist/cli/simulate.js";
export { installedViem } from "../../sdk/dist/cli/init.js";
export { PACKAGED_SKILLS, targetsFor as skillTargets } from "../../sdk/dist/cli/skills.js";
export { svmPoolsCommand } from "../../sdk/dist/cli/pools-svm.js";
export {
  parseAccounts,
  parsePubkey,
  svmPotCommand,
  svmPotExists,
  svmAssumedBalances,
  svmPotTokenAccounts,
  svmSimulateCommand,
  svmTxCommand,
  svmVerifyCommand,
  type SvmCookInput,
} from "../../sdk/dist/cli/solana.js";
export { parsePin, verifyCommand } from "../../sdk/dist/cli/verify.js";
export {
  CANONICAL_CHAINS,
  requireChain,
  type CanonicalChain,
} from "../../sdk/dist/chains/canonical.js";
export { nativeErc20 } from "../../sdk/dist/chains/index.js";
export { nativeSymbol } from "../../sdk/dist/evm/effects.js";
export { forkSnapshot, type ForkSnapshot } from "../../sdk/dist/cli/svm-fork.js";

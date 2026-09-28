/**
 * The SDK modules the actions build on: protocol-registry ABIs for the bindings, and the SDK's
 * `SafeERC20` ERC-20 write lowering.
 *
 * Imported by RELATIVE path into the SDK's build output, not by package name, and that is the one
 * spelling that resolves in both layouts this code runs in: in the repository `actions/src/` and
 * `sdk/dist/` are siblings under the root, and in the published `@eco-incorp/sauce` tarball
 * `actions/dist/` and `sdk/dist/` are siblings under the package root. A package name would need the
 * private workspace package (`@eco-incorp/sauce-source`), which is not published. The cost is build
 * order: the SDK must be built before this package is typechecked, built or tested — `pnpm build`
 * orders the two, and CI builds the SDK first.
 *
 * Each registry module is a protocol's public entry (`@eco-incorp/sauce/protocols/<slug>`), not a
 * file inside it. `token/safe` is the SDK's own lowering of `approve`/`transfer` with OpenZeppelin
 * `SafeERC20` semantics (a USDT `approve` returns no `bool`, and a stale allowance is reset first);
 * every SDK token write uses the same one, so the SDK has one ERC-20 write path.
 */
export { ERC20ABI } from "../../sdk/dist/protocols/erc20/index.js";
export { PoolABI as AaveV3PoolABI } from "../../sdk/dist/protocols/aave-v3/index.js";
export { CometABI } from "../../sdk/dist/protocols/compound-v3/index.js";
export { AcrossSpokePoolABI } from "../../sdk/dist/protocols/across/index.js";
export { CrocSwapDexABI } from "../../sdk/dist/protocols/ambient/index.js";
export { BalancerV2VaultABI } from "../../sdk/dist/protocols/balancer-v2/index.js";
export { CurveThreePoolABI } from "../../sdk/dist/protocols/curve/index.js";
export { DODOV2ProxyABI } from "../../sdk/dist/protocols/dodo/index.js";
export { LidoABI, WstETHABI } from "../../sdk/dist/protocols/lido/index.js";
export { LiquidityPoolABI } from "../../sdk/dist/protocols/etherfi/index.js";
export { MaverickV2RouterABI } from "../../sdk/dist/protocols/maverick/index.js";
export { Permit2ABI } from "../../sdk/dist/protocols/permit2/index.js";
export { RETHABI, RocketDepositPoolABI } from "../../sdk/dist/protocols/rocket-pool/index.js";
export { TokenMessengerABI } from "../../sdk/dist/protocols/cctp/index.js";
export { UniswapV2RouterABI } from "../../sdk/dist/protocols/uniswap-v2/index.js";
export { UniswapV3SwapRouter02ABI } from "../../sdk/dist/protocols/uniswap-v3/index.js";
export {
  safeApproveStatements,
  safeTransferStatements,
  type WordArg,
} from "../../sdk/dist/token/safe.js";

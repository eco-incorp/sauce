/**
 * The ABI bindings action programs call through — one `Binding.at(address).method(...)` per call,
 * the shape SDK route bodies use.
 *
 * WHERE EACH ABI COMES FROM. The SDK's protocol registry (`sdk/src/protocols/<slug>/abis.ts`) is
 * used whenever it declares the exact function an action calls. "Exact" is checked, not assumed:
 * `sdk()` below looks the function up by its canonical signature and throws if the registry spells
 * it differently, because a different spelling is a different selector — a function the contract
 * does not have. The registry's own suite (`sdk/test/registry-abi.test.ts`) pins each of its
 * functions to the deployed contracts. Where the registry has no such function — the contract is
 * not in it, or it declares another overload — the binding declares its fragment here and says why
 * next to it.
 *
 * WHY OUTPUTS ARE DROPPED. A binding decodes every output its ABI declares, even one the program
 * never reads, and decoding from empty return data reverts. 3pool-era Curve pools return nothing
 * from `exchange`, so declaring that output would revert a swap that succeeded. The rule here is
 * therefore: declare an output only when an action reads it. Every other method is bound
 * output-free — the call must succeed, and nothing is decoded. ERC-20 `approve`/`transfer` are not
 * bindings at all: tokens such as USDT return nothing from them, and they go through the SDK's own
 * `SafeERC20` lowering, `token/safe` (see `to-sauce.ts#Lowering.erc20Write`).
 *
 * WHY SOME CALLS ARE STILL RAW. A binding call cannot attach native value, and the compiler has no
 * calldata builtin besides `abi.encode`. So a payable call carrying ETH (`WETH.deposit`, Lido
 * `submit`, a bridge fee) stays `evm.call(target, value, selector ++ abi.encode(args))`, with the
 * selector taken from the same ABI fragment a binding would use — see `valueCall` in `to-sauce.ts`.
 */
import {
  parseAbiItem,
  toFunctionSelector,
  type AbiFunction,
  type AbiParameter,
  type Hex,
} from "viem";

import { AaveV3PoolABI, AcrossSpokePoolABI, BalancerV2VaultABI, CometABI } from "./registry.js";
import { CrocSwapDexABI, CurveThreePoolABI, DODOV2ProxyABI, ERC20ABI } from "./registry.js";
import { LidoABI, LiquidityPoolABI, MaverickV2RouterABI, Permit2ABI } from "./registry.js";
import { RETHABI, RocketDepositPoolABI, TokenMessengerABI } from "./registry.js";
import { UniswapV2RouterABI, UniswapV3SwapRouter02ABI, WstETHABI } from "./registry.js";

/** A parsed ABI in the shape the compiler's `inlineContracts` and the SDK's `compile.contracts` take. */
export interface ActionContract {
  readonly abi: AbiFunction[];
}

/** ABI bindings by the name the emitted source uses for them. */
export type ActionContracts = Record<string, ActionContract>;

/** Where a binding's methods come from — kept per method, because some bindings mix both. */
export type MethodSource =
  | { readonly kind: "sdk"; readonly protocol: string; readonly abiExport: string }
  | { readonly kind: "local"; readonly reason: string };

export interface BoundMethod {
  readonly fn: AbiFunction;
  readonly source: MethodSource;
}

/** The canonical `name(type,...)` signature, tuples expanded — the string a selector hashes. */
export function canonicalSignature(fn: Pick<AbiFunction, "name" | "inputs">): string {
  return `${fn.name}(${fn.inputs.map(canonicalType).join(",")})`;
}

function canonicalType(param: AbiParameter): string {
  if (!param.type.startsWith("tuple")) return param.type;
  const components = (param as { components?: readonly AbiParameter[] }).components ?? [];

  return `(${components.map(canonicalType).join(",")})${param.type.slice("tuple".length)}`;
}

/** A deep, mutable copy — the registry's ABIs are `as const`, and the compiler gets plain JSON. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Outputs = "keep" | "drop";

/**
 * The registry function with exactly `signature`, from `abi` (the `abiExport` of `protocol`).
 * Throws when the registry has no such function — the signal that it changed under the action.
 */
function sdk(
  protocol: string,
  abiExport: string,
  abi: readonly unknown[],
  signature: string,
  outputs: Outputs,
): BoundMethod {
  const found = (abi as readonly AbiFunction[]).find(
    (item) => item.type === "function" && canonicalSignature(item) === signature,
  );
  if (found === undefined) {
    const spelled = (abi as readonly AbiFunction[])
      .filter((item) => item.type === "function" && item.name === signature.split("(")[0])
      .map(canonicalSignature);
    throw new Error(
      `actions: the SDK registry's ${protocol} ${abiExport} has no \`${signature}\`` +
        (spelled.length > 0 ? ` (it declares ${spelled.join(", ")})` : "") +
        " — the action would call a function the contract does not have.",
    );
  }
  const fn = plain(found);
  if (outputs === "drop") fn.outputs = [];

  return { fn, source: { kind: "sdk", protocol, abiExport } };
}

/** A fragment declared here, in viem's human-readable form, with the reason the registry's is not used. */
function local(signature: string, reason: string): BoundMethod {
  const fn = parseAbiItem(signature) as AbiFunction;

  return { fn: plain(fn), source: { kind: "local", reason } };
}

const NOT_IN_REGISTRY = "not in the SDK protocol registry";
const OUTPUT_UNREAD = "its output is measured as a balance delta, so it is bound output-free";

/**
 * Every binding, by the name emitted source calls it. The names start with `I` and contain no `_`,
 * so none can collide with an SDK protocol namespace (`AaveV3`, `Erc20`), a chain accessor (`Base`)
 * or a name the route rewrite synthesizes (`IAaveV3_Pool`) — `abis.unit.test.ts` checks all three.
 */
const CATALOG = {
  // Only the read: `approve`/`transfer` go through `token/safe`, which decodes no output.
  IErc20: () => ({
    balanceOf: sdk("erc20", "ERC20ABI", ERC20ABI, "balanceOf(address)", "keep"),
  }),
  IWeth9: () => ({
    withdraw: local("function withdraw(uint256 wad)", `WETH9 is ${NOT_IN_REGISTRY}`),
    deposit: local("function deposit() payable", `WETH9 is ${NOT_IN_REGISTRY}`),
  }),
  // Both return the amount they swapped out, which is the action's output.
  ISwapRouter02: () => ({
    exactInputSingle: sdk(
      "uniswap-v3",
      "UniswapV3SwapRouter02ABI",
      UniswapV3SwapRouter02ABI,
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      "keep",
    ),
    exactInput: sdk(
      "uniswap-v3",
      "UniswapV3SwapRouter02ABI",
      UniswapV3SwapRouter02ABI,
      "exactInput((bytes,address,uint256,uint256))",
      "keep",
    ),
  }),
  IUniversalRouter: () => ({
    execute: local(
      "function execute(bytes commands, bytes[] inputs) payable",
      "the registry declares the three-argument `execute` with a deadline; these actions carry no " +
        "deadline and call the two-argument overload (0x24856bc3), which the registry still omits " +
        "although every deployed Universal Router dispatches it",
    ),
  }),
  ICurvePool: () => ({
    // 3pool's `exchange` returns nothing, and a StableSwap-NG pool's `uint256` return is simply not
    // decoded: this output-free spelling suits every 4-argument pool. The output is a balance delta.
    exchange: sdk(
      "curve",
      "CurveThreePoolABI",
      CurveThreePoolABI,
      "exchange(int128,int128,uint256,uint256)",
      "drop",
    ),
  }),
  ICurveRouterNG: () => ({
    exchange: local(
      "function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools, address _receiver) returns (uint256)",
      "the registry declares the five-argument overload, which has no receiver; it still omits the " +
        "six-argument one (0xc872a3c5), which every deployed RouterNG dispatches",
    ),
  }),
  IBalancerV2Vault: () => ({
    swap: sdk(
      "balancer-v2",
      "BalancerV2VaultABI",
      BalancerV2VaultABI,
      "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
      "keep",
    ),
    batchSwap: local(
      "function batchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, int256[] limits, uint256 deadline) payable",
      `the registry declares \`poolId\` as \`uint256\`; the Vault takes \`bytes32\`; ${OUTPUT_UNREAD}`,
    ),
  }),
  IBalancerV3Router: () => ({
    swapSingleTokenExactIn: local(
      "function swapSingleTokenExactIn(address pool, address tokenIn, address tokenOut, uint256 exactAmountIn, uint256 minAmountOut, uint256 deadline, bool wethIsEth, bytes userData) payable returns (uint256 amountOut)",
      `Balancer V3 is ${NOT_IN_REGISTRY}`,
    ),
  }),
  IUniswapV2Router: () => ({
    // Fraxswap's router is UniswapV2-compatible for this function, so `fraxswapSwap` binds it too.
    swapExactTokensForTokens: sdk(
      "uniswap-v2",
      "UniswapV2RouterABI",
      UniswapV2RouterABI,
      "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
      "drop",
    ),
  }),
  ICrocSwapDex: () => ({
    userCmd: sdk("ambient", "CrocSwapDexABI", CrocSwapDexABI, "userCmd(uint16,bytes)", "drop"),
  }),
  IDodoProxy: () => ({
    dodoSwapV2TokenToToken: sdk(
      "dodo",
      "DODOV2ProxyABI",
      DODOV2ProxyABI,
      "dodoSwapV2TokenToToken(address,address,uint256,uint256,address[],uint256,bool,uint256)",
      "keep",
    ),
    dodoSwapV1: local(
      "function dodoSwapV1(address fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) payable returns (uint256 returnAmount)",
      "the registry declares only the proxy's V2 entry point",
    ),
  }),
  IMaverickV2Router: () => ({
    // The registry and the previous raw call both read the first return word as the output.
    exactInputSingle: sdk(
      "maverick",
      "MaverickV2RouterABI",
      MaverickV2RouterABI,
      "exactInputSingle(address,address,bool,uint256,uint256)",
      "keep",
    ),
    exactInputMultiHop: local(
      "function exactInputMultiHop(address recipient, bytes path, uint256 amountIn, uint256 amountOutMinimum) payable returns (uint256 amountOut)",
      "the registry declares only the single-pool entry point",
    ),
  }),
  ICarbonController: () => ({
    tradeBySourceAmount: local(
      "function tradeBySourceAmount(address sourceToken, address targetToken, (uint256 strategyId, uint128 amount)[] tradeActions, uint256 deadline, uint128 minReturn) payable returns (uint128)",
      `Carbon is ${NOT_IN_REGISTRY}`,
    ),
  }),
  IFluidDexT1: () => ({
    swapIn: local(
      "function swapIn(bool swap0to1, uint256 amountIn, uint256 amountOutMin, address to) payable returns (uint256 amountOut)",
      "the registry's fluid entry covers lending, not the DEX",
    ),
  }),
  IWstEth: () => ({
    // Both return the amount they minted or released, which is the action's output.
    wrap: sdk("lido", "WstETHABI", WstETHABI, "wrap(uint256)", "keep"),
    unwrap: sdk("lido", "WstETHABI", WstETHABI, "unwrap(uint256)", "keep"),
  }),
  ILido: () => ({
    submit: sdk("lido", "LidoABI", LidoABI, "submit(address)", "drop"),
  }),
  ILidoWithdrawalQueue: () => ({
    requestWithdrawals: local(
      "function requestWithdrawals(uint256[] amounts, address owner)",
      `Lido's withdrawal queue is ${NOT_IN_REGISTRY}`,
    ),
  }),
  IRocketDepositPool: () => ({
    deposit: sdk("rocket-pool", "RocketDepositPoolABI", RocketDepositPoolABI, "deposit()", "drop"),
  }),
  IRocketTokenReth: () => ({
    burn: sdk("rocket-pool", "RETHABI", RETHABI, "burn(uint256)", "drop"),
  }),
  IEtherFiLiquidityPool: () => ({
    deposit: sdk("etherfi", "LiquidityPoolABI", LiquidityPoolABI, "deposit()", "drop"),
  }),
  IAaveV3Pool: () => ({
    supply: sdk(
      "aave-v3",
      "PoolABI",
      AaveV3PoolABI,
      "supply(address,uint256,address,uint16)",
      "keep",
    ),
    withdraw: sdk("aave-v3", "PoolABI", AaveV3PoolABI, "withdraw(address,uint256,address)", "keep"),
    borrow: sdk(
      "aave-v3",
      "PoolABI",
      AaveV3PoolABI,
      "borrow(address,uint256,uint256,uint16,address)",
      "keep",
    ),
    repay: sdk(
      "aave-v3",
      "PoolABI",
      AaveV3PoolABI,
      "repay(address,uint256,uint256,address)",
      "drop",
    ),
  }),
  ICometMarket: () => ({
    supply: sdk("compound-v3", "CometABI", CometABI, "supply(address,uint256)", "keep"),
    withdraw: sdk("compound-v3", "CometABI", CometABI, "withdraw(address,uint256)", "keep"),
  }),
  IAcrossSpokePool: () => ({
    depositV3: sdk(
      "across",
      "AcrossSpokePoolABI",
      AcrossSpokePoolABI,
      "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
      "keep",
    ),
  }),
  IStargatePool: () => {
    const reason =
      "the registry declares the SendParam's `to` as `uint256`, which changes the selector; " +
      "the pool takes `bytes32`";
    const sendParam =
      "(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)";
    return {
      quoteSend: local(
        `function quoteSend(${sendParam} sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`,
        `${reason}, and has no \`quoteSend\``,
      ),
      send: local(
        `function send(${sendParam} sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable`,
        `${reason}; the receipts it returns are never read`,
      ),
    };
  },
  ICctpTokenMessenger: () => ({
    depositForBurn: sdk(
      "cctp",
      "TokenMessengerABI",
      TokenMessengerABI,
      "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
      "drop",
    ),
  }),
  IWarpRoute: () => {
    const reason = "the registry's hyperlane entry is the Mailbox, not a warp route";
    return {
      quoteGasPayment: local(
        "function quoteGasPayment(uint32 destinationDomain) view returns (uint256)",
        reason,
      ),
      transferRemote: local(
        "function transferRemote(uint32 destination, bytes32 recipient, uint256 amountOrId) payable",
        `${reason}; the message id it returns is never read`,
      ),
    };
  },
  IPermit2: () => ({
    approve: sdk(
      "permit2",
      "Permit2ABI",
      Permit2ABI,
      "approve(address,address,uint160,uint48)",
      "drop",
    ),
  }),
} satisfies Record<string, () => Record<string, BoundMethod>>;

export type BindingName = keyof typeof CATALOG;
type MethodsOf<B extends BindingName> = ReturnType<(typeof CATALOG)[B]>;
export type MethodName<B extends BindingName> = keyof MethodsOf<B> & string;

const resolved = new Map<BindingName, Record<string, BoundMethod>>();

/** A binding's methods, resolved (and registry-checked) on first use. */
export function bindingMethods(binding: BindingName): Readonly<Record<string, BoundMethod>> {
  let methods = resolved.get(binding);
  if (methods === undefined) {
    methods = CATALOG[binding]();
    resolved.set(binding, methods);
  }

  return methods;
}

/** Every binding name, for tests and documentation. */
export const BINDING_NAMES = Object.keys(CATALOG) as BindingName[];

/** The 4-byte selector of a binding's method, from the same fragment the binding compiles with. */
export function methodSelector<B extends BindingName>(binding: B, method: MethodName<B>): Hex {
  return toFunctionSelector(bindingMethods(binding)[method]!.fn);
}

/** The `contracts` map a program naming `bindings` compiles with. */
export function contractsFor(bindings: Iterable<BindingName>): ActionContracts {
  const out: ActionContracts = {};
  for (const binding of [...new Set(bindings)].sort()) {
    out[binding] = { abi: Object.values(bindingMethods(binding)).map((m) => plain(m.fn)) };
  }

  return out;
}

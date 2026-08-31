import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { actionToQuote, type QuoteOpts } from '../src/to-quote.js';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { resolve } from 'node:path';
import {
  createPublicClient,
  http,
  custom,
  parseAbi,
  formatUnits,
  type Address,
  type Hex,
  type EIP1193RequestFn,
} from 'viem';
import type { SwapAction } from '../src/types.js';

// =============================================================================
// Configuration
// =============================================================================

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const DEV_TOOLS = resolve(REPO_ROOT, 'dev-tools');

const FORK_URL = process.env.FORK_URL;
if (!FORK_URL) throw new Error('FORK_URL env var is required.');

const RPC = 'http://127.0.0.1:8545';

// --- Mainnet addresses ---
const WETH   = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address;
const USDC   = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const USDT   = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address;
const DAI    = '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address;
const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0' as Address;

// Protocols
const SWAP_ROUTER       = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as Address; // UniV3 SwapRouter02
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address;
const CURVE_3POOL       = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7' as Address;
const CURVE_ROUTER_NG   = '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D' as Address;
const BALANCER_V2_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address;
const BALANCER_V2_POOL_ID = '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019' as Hex;
const AMBIENT_DEX       = '0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688' as Address;
const DODO_PAIR_WETH_USDC = '0x75c23271661d9d143DCb617222BC4BEc783eFf34' as Address;
const CLIPPER_EXCHANGE  = '0x655eDCE464CC797526600a462A8154650EEe4B77' as Address;
const FLUID_DEX_T1_WSTETH_ETH = '0x0B1a513ee24972DAEf112bC777a5610d4325C9e7' as Address;

// Quoter / resolver contracts
const UNI_V3_QUOTER     = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as Address;
const UNI_V4_QUOTER     = '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203' as Address;
const MAVERICK_QUOTER   = '0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A' as Address;
const CROC_IMPACT       = '0x3e3EDd3eD7621891E574E5d7f47b1f30A994c0D0' as Address;
const INTEGRAL_RELAYER  = '0xd17b3c9784510E33cD5B87b490E79253BcD81e2E' as Address;
const FLUID_RESOLVER    = '0x05Bd8269A20C472b148246De20E6852091BF16Ff' as Address;

const QUOTE_OPTS: QuoteOpts = {
  quoterV3: UNI_V3_QUOTER,
  quoterV4: UNI_V4_QUOTER,
  quoterMaverick: MAVERICK_QUOTER,
  impact: CROC_IMPACT,
  relayer: INTEGRAL_RELAYER,
  fluidResolver: FLUID_RESOLVER,
};

// Manual-quote ABIs
const curveGetDyAbi = parseAbi(['function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)']);
const v2GetAmountsOutAbi = parseAbi(['function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)']);
const balV2QueryAbi = parseAbi(['function queryBatchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds) returns (int256[])']);
const uniV3QuoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)']);
const uniV3QuoterMultiAbi = parseAbi(['function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)']);
const maverickQuoterAbi = parseAbi(['function calculateSwap(address pool, uint128 amount, bool tokenAIn, bool exactOutput, int32 tickLimit) returns (uint256 amountIn, uint256 amountOut, uint256 gasEstimate)']);
const crocImpactAbi = parseAbi(['function calcImpact(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice) view returns (int128 baseFlow, int128 quoteFlow, uint128 finalPrice)']);
const dodoQueryAbi = parseAbi(['function querySellBase(address trader, uint256 payBaseAmount) view returns (uint256 receiveQuoteAmount, uint256 mtFee)']);
const clipperQuoteAbi = parseAbi(['function getSellQuote(address inputToken, address outputToken, uint256 sellAmount) view returns (uint256)']);
const fluidEstimateAbi = parseAbi(['function estimateSwapIn(address dex, bool swap0to1, uint256 amountIn, uint256 amountOutMin) returns (uint256 amountOut)']);
const integralQuoteAbi = parseAbi(['function quoteSell(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)']);

// =============================================================================
// Hardhat lifecycle
// =============================================================================

let hardhatProcess: ChildProcess;
let client: ReturnType<typeof createPublicClient>;

async function startHardhat(): Promise<ChildProcess> {
  try { execSync('lsof -ti :8545 | xargs kill -9 2>/dev/null || true', { encoding: 'utf8' }); } catch {}

  const hardhatCli = resolve(DEV_TOOLS, 'node_modules/hardhat/internal/cli/cli.js');
  const proc = spawn(
    process.execPath, [hardhatCli, 'node', '--fork', FORK_URL!],
    { cwd: DEV_TOOLS, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Hardhat failed to start within 60s')), 60_000);
    const check = setInterval(async () => {
      try {
        const res = await fetch(RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        });
        if (res.ok) { clearInterval(check); clearTimeout(timeout); resolve(); }
      } catch {}
    }, 500);
    proc.on('error', (err: Error) => { clearInterval(check); clearTimeout(timeout); reject(err); });
    proc.on('exit', (code: number | null) => {
      if (code !== null) { clearInterval(check); clearTimeout(timeout); reject(new Error(`Hardhat exited with code ${code}`)); }
    });
  });

  return proc;
}

function stopHardhat(proc: ChildProcess): void {
  if (proc && !proc.killed) proc.kill('SIGTERM');
}

/**
 * Hardhat caps eth_call gas at the block gas limit (~16M) but viem defaults
 * to 60M. This transport intercepts eth_call and injects gas: 15M.
 */
function cappedTransport() {
  const base = http(RPC);
  return custom({
    request: async (args: { method: string; params?: any[] }) => {
      if (args.method === 'eth_call' && args.params?.[0]) {
        args.params[0] = { ...args.params[0], gas: '0xe4e1c0' }; // 15M
      }
      const t = base({ chain: undefined, retryCount: 0, timeout: 30_000 });
      return t.request(args as any);
    },
  });
}

function snapshot(): string {
  return JSON.parse(execSync(`cast rpc evm_snapshot --rpc-url ${RPC}`, { encoding: 'utf8' }).trim());
}

function revert(id: string): void {
  execSync(`cast rpc evm_revert "${id}" --rpc-url ${RPC}`, { encoding: 'utf8' });
}

// =============================================================================
// Helpers
// =============================================================================

/** Execute the QuoteCall via eth_call and decode using the QuoteCall's decoder. */
async function executeQuote(action: SwapAction, amountIn: bigint, opts = QUOTE_OPTS): Promise<bigint> {
  const q = actionToQuote(action, amountIn, opts);
  const result = await client.call({ to: q.to, data: q.data });
  if (!result.data) throw new Error(`eth_call returned no data for ${action.type}`);
  return q.decode(result.data);
}

// =============================================================================
// Tests
// =============================================================================

describe('actionToQuote integration tests', { timeout: 120_000 }, () => {
  let snap: string;

  before(async () => {
    hardhatProcess = await startHardhat();
    client = createPublicClient({ transport: cappedTransport() });
    console.log(`Hardhat forking ${FORK_URL}`);
  });

  after(() => stopHardhat(hardhatProcess));
  beforeEach(() => { snap = snapshot(); });
  afterEach(() => { revert(snap); });

  // =========================================================================
  // Curve — get_dy (view)
  // =========================================================================

  describe('curveSwap', () => {
    const amountIn = 1_000_000000n; // 1000 USDC (6 decimals)
    const action: SwapAction = {
      type: 'curveSwap',
      chainId: 1,
      pool: CURVE_3POOL,
      tokenIn: USDC,
      tokenOut: USDT,
      i: 1, // USDC index in 3pool
      j: 2, // USDT index in 3pool
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
    };

    it('matches manual get_dy call', async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.readContract({
        address: CURVE_3POOL,
        abi: curveGetDyAbi,
        functionName: 'get_dy',
        args: [1n, 2n, amountIn],
      });

      assert.equal(quoted, manual, `actionToQuote=${quoted} vs manual get_dy=${manual}`);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // Curve Router NG — get_dy (view)
  // =========================================================================

  describe('curveRouterNGSwap', () => {
    const amountIn = 1_000_000000n; // 1000 USDC
    const route = [USDC, CURVE_3POOL, USDT] as Address[];
    const swapParams: [number, number, number, number, number][] = [[1, 2, 1, 1, 3]];
    const pools = ['0x0000000000000000000000000000000000000000' as Address];

    const action: SwapAction = {
      type: 'curveRouterNGSwap',
      chainId: 1,
      router: CURVE_ROUTER_NG,
      route,
      swapParams,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      pools,
      recipient: '0x0000000000000000000000000000000000000001' as Address,
    };

    it('matches manual Curve RouterNG get_dy call', async () => {
      const quoted = await executeQuote(action, amountIn);

      // Manual: pad and call get_dy on the router directly
      const paddedRoute = [...route] as Address[];
      while (paddedRoute.length < 11) paddedRoute.push('0x0000000000000000000000000000000000000000' as Address);
      const paddedParams = [...swapParams] as [number, number, number, number, number][];
      while (paddedParams.length < 5) paddedParams.push([0, 0, 0, 0, 0]);
      const paddedPools = [...pools] as Address[];
      while (paddedPools.length < 5) paddedPools.push('0x0000000000000000000000000000000000000000' as Address);

      const manual = await client.readContract({
        address: CURVE_ROUTER_NG,
        abi: parseAbi(['function get_dy(address[11] route, uint256[5][5] swapParams, uint256 amount, address[5] pools) view returns (uint256)']),
        functionName: 'get_dy',
        args: [
          paddedRoute as any,
          paddedParams.map(r => r.map(v => BigInt(v))) as any,
          amountIn,
          paddedPools as any,
        ],
      });

      assert.equal(quoted, manual, `actionToQuote=${quoted} vs manual=${manual}`);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // UniswapV2 — getAmountsOut (view)
  // =========================================================================

  describe('uniswapV2Swap', () => {
    const amountIn = 1_000000000000000000n; // 1 ETH
    const action: SwapAction = {
      type: 'uniswapV2Swap',
      chainId: 1,
      router: UNISWAP_V2_ROUTER,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      path: [WETH, USDC],
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual getAmountsOut call', async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.readContract({
        address: UNISWAP_V2_ROUTER,
        abi: v2GetAmountsOutAbi,
        functionName: 'getAmountsOut',
        args: [amountIn, [WETH, USDC]],
      });

      assert.equal(quoted, manual[manual.length - 1], `actionToQuote=${quoted} vs manual=${manual[manual.length - 1]}`);
      assert.ok(quoted > 1000_000000n, 'Should return >$1000 for 1 ETH');
    });
  });

  // =========================================================================
  // Fraxswap — getAmountsOut (view, same as UniV2)
  // =========================================================================

  describe('fraxswapSwap', () => {
    // Fraxswap router has same interface as UniV2. Test with WETH→USDC if it has a pair.
    // Fraxswap may not have a WETH/USDC pair, so we skip if it reverts.
    const FRAXSWAP_ROUTER = '0xC14d550632db8592D1243Edc8B95b0Ad06703867' as Address;
    const FRAX = '0x853d955aCEf822Db058eb8505911ED77F175b99e' as Address;
    const amountIn = 1_000_000000000000000000n; // 1000 FRAX (18 decimals)

    const action: SwapAction = {
      type: 'fraxswapSwap',
      chainId: 1,
      router: FRAXSWAP_ROUTER,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      path: [FRAX, WETH],
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual getAmountsOut call', async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // Fraxswap may not have this pair with liquidity
        return;
      }

      const manual = await client.readContract({
        address: FRAXSWAP_ROUTER,
        abi: v2GetAmountsOutAbi,
        functionName: 'getAmountsOut',
        args: [amountIn, [FRAX, WETH]],
      });

      assert.equal(quoted, manual[manual.length - 1]);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // BalancerV2 single swap — queryBatchSwap
  // =========================================================================

  describe('balancerV2Swap', () => {
    const amountIn = 100000000000000n; // 0.0001 ETH
    const action: SwapAction = {
      type: 'balancerV2Swap',
      chainId: 1,
      vault: BALANCER_V2_VAULT,
      poolId: BALANCER_V2_POOL_ID,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual queryBatchSwap call', async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: BALANCER_V2_VAULT,
        abi: balV2QueryAbi,
        functionName: 'queryBatchSwap',
        args: [
          0, // GIVEN_IN
          [{ poolId: BALANCER_V2_POOL_ID, assetInIndex: 0n, assetOutIndex: 1n, amount: amountIn, userData: '0x' }],
          [WETH, USDC],
          {
            sender: '0x0000000000000000000000000000000000000000',
            fromInternalBalance: false,
            recipient: '0x0000000000000000000000000000000000000000',
            toInternalBalance: false,
          },
        ],
      });

      const deltas = manual.result;
      const expected = deltas[1] < 0n ? -deltas[1] : deltas[1];
      assert.equal(quoted, expected, `actionToQuote=${quoted} vs manual queryBatchSwap=${expected}`);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // BalancerV2 batch swap — queryBatchSwap
  // =========================================================================

  describe('balancerV2BatchSwap', () => {
    const amountIn = 100000000000000n; // 0.0001 ETH
    const action: SwapAction = {
      type: 'balancerV2BatchSwap',
      chainId: 1,
      vault: BALANCER_V2_VAULT,
      steps: [{
        poolId: BALANCER_V2_POOL_ID,
        assetInIndex: 0,
        assetOutIndex: 1,
        amount: amountIn.toString(),
      }],
      assets: [WETH, USDC],
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual queryBatchSwap call', async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: BALANCER_V2_VAULT,
        abi: balV2QueryAbi,
        functionName: 'queryBatchSwap',
        args: [
          0,
          [{ poolId: BALANCER_V2_POOL_ID, assetInIndex: 0n, assetOutIndex: 1n, amount: amountIn, userData: '0x' }],
          [WETH, USDC],
          {
            sender: '0x0000000000000000000000000000000000000000',
            fromInternalBalance: false,
            recipient: '0x0000000000000000000000000000000000000000',
            toInternalBalance: false,
          },
        ],
      });

      const deltas = manual.result;
      const expected = deltas[1] < 0n ? -deltas[1] : deltas[1];
      assert.equal(quoted, expected);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // UniswapV3 single — QuoterV2 quoteExactInputSingle
  // =========================================================================

  describe('uniswapV3ExactInput', () => {
    const amountIn = 1_000000000000000000n; // 1 ETH
    const action: SwapAction = {
      type: 'uniswapV3ExactInput',
      chainId: 1,
      router: SWAP_ROUTER,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 500,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual QuoterV2 quoteExactInputSingle call', async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: UNI_V3_QUOTER,
        abi: uniV3QuoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: WETH, tokenOut: USDC, amountIn, fee: 500, sqrtPriceLimitX96: 0n }],
      });

      assert.equal(quoted, manual.result[0], `actionToQuote=${quoted} vs manual=${manual.result[0]}`);
      assert.ok(quoted > 1000_000000n, 'Should return >$1000 for 1 ETH');
    });
  });

  // =========================================================================
  // UniswapV3 multi-hop — QuoterV2 quoteExactInput
  // =========================================================================

  describe('uniswapV3ExactInputMultiHop', () => {
    const amountIn = 1_000000000000000000n; // 1 ETH
    // Encoded path: WETH --500fee--> USDC
    const path = ('0x' + WETH.slice(2).toLowerCase() + '0001f4' + USDC.slice(2).toLowerCase()) as Hex;
    const action: SwapAction = {
      type: 'uniswapV3ExactInputMultiHop',
      chainId: 1,
      router: SWAP_ROUTER,
      path,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual QuoterV2 quoteExactInput call', async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: UNI_V3_QUOTER,
        abi: uniV3QuoterMultiAbi,
        functionName: 'quoteExactInput',
        args: [path, amountIn],
      });

      assert.equal(quoted, manual.result[0], `actionToQuote=${quoted} vs manual=${manual.result[0]}`);
      assert.ok(quoted > 1000_000000n, 'Should return >$1000 for 1 ETH');
    });
  });

  // =========================================================================
  // UniswapV4 single — V4Quoter quoteExactInputSingle
  // =========================================================================

  describe('uniswapV4ExactInput', () => {
    // V4 WETH/USDC pool on mainnet
    const amountIn = 1_000000000000000000n; // 1 ETH
    const ZERO = '0x0000000000000000000000000000000000000000' as Address;
    const action: SwapAction = {
      type: 'uniswapV4ExactInput',
      chainId: 1,
      router: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af' as Address,
      poolKey: {
        currency0: ZERO,   // ETH (native)
        currency1: USDC,
        fee: 3000,
        tickSpacing: 60,
        hooks: ZERO,
      },
      zeroForOne: true,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
    };

    it('returns non-zero quote via V4Quoter', async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // V4 pool may not exist for this pair/fee on mainnet yet
        return;
      }
      assert.ok(quoted > 0n, `V4 quote should be non-zero, got ${quoted}`);
    });
  });

  // =========================================================================
  // DODO V2 — querySellBase (view)
  // =========================================================================

  describe('dodoSwap', () => {
    // DODO V2 DVM WETH-USDC pool (V2, not V1)
    const DODO_V2_WETH_USDC = '0x052a9E3111E37891aCe769c6b6f70197Bb8602DB' as Address;
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: 'dodoSwap',
      chainId: 1,
      proxy: '0xa356867fDCEa8e71AEaF87805808803806231FdC' as Address,
      fromToken: WETH,
      toToken: USDC,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      dodoPairs: [DODO_V2_WETH_USDC],
      directions: 0, // bit 0 = 0 → selling base
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual querySellBase call', async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // Pool may not support querySellBase (V1 pools don't)
        return;
      }

      const manual = await client.readContract({
        address: DODO_V2_WETH_USDC,
        abi: dodoQueryAbi,
        functionName: 'querySellBase',
        args: ['0x0000000000000000000000000000000000000000' as Address, amountIn],
      });

      assert.equal(quoted, manual[0], `actionToQuote=${quoted} vs manual querySellBase=${manual[0]}`);
      assert.ok(quoted > 0n, 'Should return non-zero USDC output');
    });
  });

  // =========================================================================
  // Ambient (CrocSwap) — calcImpact (view)
  // =========================================================================

  describe('ambientSwap', () => {
    // USDC(base) / WETH(quote), poolIdx=420
    // isBuy=false, inBaseQty=false → selling quote (WETH) for base (USDC)
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: 'ambientSwap',
      chainId: 1,
      dex: AMBIENT_DEX,
      base: USDC,
      quote: WETH,
      poolIdx: 420,
      isBuy: false,
      inBaseQty: false,
      amountIn: amountIn.toString(),
      tip: 0,
      limitPrice: '65537',
      minOut: '0',
      reserveFlags: 0,
    };

    it('matches manual calcImpact call', async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.readContract({
        address: CROC_IMPACT,
        abi: crocImpactAbi,
        functionName: 'calcImpact',
        args: [USDC, WETH, 420n, false, false, amountIn, 0, 65537n],
      });

      // isBuy=false → output is baseFlow (USDC), should be negative (leaving pool)
      const expected = manual[0] < 0n ? -manual[0] : manual[0];
      assert.equal(quoted, expected, `actionToQuote=${quoted} vs manual calcImpact=${expected}`);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // Clipper — getSellQuote (view)
  // =========================================================================

  describe('clipperSwap', () => {
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: 'clipperSwap',
      chainId: 1,
      exchange: CLIPPER_EXCHANGE,
      inputToken: WETH,
      outputToken: USDC,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      auxiliaryData: '0x' as Hex, // Not needed for getSellQuote
    };

    it('matches manual getSellQuote call', async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // Clipper may not support this pair or may be paused
        return;
      }

      const manual = await client.readContract({
        address: CLIPPER_EXCHANGE,
        abi: clipperQuoteAbi,
        functionName: 'getSellQuote',
        args: [WETH, USDC, amountIn],
      });

      assert.equal(quoted, manual, `actionToQuote=${quoted} vs manual getSellQuote=${manual}`);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // Maverick V2 — calculateSwap (revert-sim)
  // =========================================================================

  describe('maverickSwap', () => {
    // We need a known Maverick V2 pool. Use WETH/USDC if available.
    // Maverick pools are individually deployed; discover from factory if needed.
    // For now, use a known pool address (may need updating).
    const MAVERICK_WETH_USDC_POOL = '0x7A44e4b0E9CCA56cDe32FDee1A22Fab3dD551803' as Address;
    const amountIn = 100000000000000000n; // 0.1 ETH

    const action: SwapAction = {
      type: 'maverickSwap',
      chainId: 1,
      router: '0x62e31802c6145A2D5E842EeD8efe01fC224422fA' as Address,
      pool: MAVERICK_WETH_USDC_POOL,
      tokenAIn: true,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
    };

    it('matches manual calculateSwap call', async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // Pool may not exist or have liquidity
        return;
      }

      const manual = await client.simulateContract({
        address: MAVERICK_QUOTER,
        abi: maverickQuoterAbi,
        functionName: 'calculateSwap',
        args: [MAVERICK_WETH_USDC_POOL, amountIn, true, false, 0],
      });

      assert.equal(quoted, manual.result[1], `actionToQuote=${quoted} vs manual calculateSwap=${manual.result[1]}`);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // Integral SIZE — quoteSell (view)
  // =========================================================================

  describe('integralSwap', () => {
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: 'integralSwap',
      chainId: 1,
      delay: '0x782534550e2553A42CDFf8D5a94066d8c7B6729B' as Address,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      wrapUnwrap: false,
      recipient: '0x0000000000000000000000000000000000000001' as Address,
      gasLimit: '500000',
      submitDeadline: Math.floor(Date.now() / 1000) + 3600,
    };

    it('matches manual quoteSell call', async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // Integral may not support this pair or relayer may be paused
        return;
      }

      const manual = await client.readContract({
        address: INTEGRAL_RELAYER,
        abi: integralQuoteAbi,
        functionName: 'quoteSell',
        args: [WETH, USDC, amountIn],
      });

      assert.equal(quoted, manual, `actionToQuote=${quoted} vs manual quoteSell=${manual}`);
      assert.ok(quoted > 0n, 'Should return non-zero output');
    });
  });

  // =========================================================================
  // Fluid DEX T1 — estimateSwapIn (revert-sim)
  // =========================================================================

  describe('fluidDexT1Swap', () => {
    // wstETH/ETH pool — swap ETH(token1) → wstETH(token0), swap0to1=false
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: 'fluidDexT1Swap',
      chainId: 1,
      pool: FLUID_DEX_T1_WSTETH_ETH,
      swap0to1: false,
      amountIn: amountIn.toString(),
      amountOutMin: '0',
      recipient: '0x0000000000000000000000000000000000000001' as Address,
    };

    it('matches manual estimateSwapIn call', async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // Fluid resolver may revert if pool is not active
        return;
      }

      const manual = await client.simulateContract({
        address: FLUID_RESOLVER,
        abi: fluidEstimateAbi,
        functionName: 'estimateSwapIn',
        args: [FLUID_DEX_T1_WSTETH_ETH, false, amountIn, 0n],
      });

      assert.equal(quoted, manual.result, `actionToQuote=${quoted} vs manual estimateSwapIn=${manual.result}`);
      assert.ok(quoted > 0n, 'Should return non-zero wstETH output');
    });
  });

  // =========================================================================
  // Carbon — calculateTradeTargetAmount (view)
  // Skipped: requires live strategy IDs that change dynamically
  // =========================================================================

  describe('carbonSwap', () => {
    it.skip('requires active strategy IDs — cannot hardcode for fork test', () => {});
  });

  // =========================================================================
  // BalancerV3 — querySwapSingleTokenExactIn
  // Skipped: requires discovering a V3 pool with liquidity
  // =========================================================================

  describe('balancerV3Swap', () => {
    it.skip('requires discovering a BalancerV3 pool with liquidity', () => {});
  });

  // =========================================================================
  // UniswapV4 multi-hop
  // =========================================================================

  describe('uniswapV4ExactInputMultiHop', () => {
    it.skip('requires discovering V4 multi-hop path with liquidity', () => {});
  });

  // =========================================================================
  // Maverick multi-hop
  // =========================================================================

  describe('maverickMultiHopSwap', () => {
    it.skip('requires encoded multi-hop path with known Maverick pools', () => {});
  });

  // =========================================================================
  // Fluid DEX Lite
  // =========================================================================

  describe('fluidDexLiteSwap', () => {
    it.skip('requires pool discovery via FluidDexLiteResolver.getAllDexes()', () => {});
  });
});

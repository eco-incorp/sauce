/**
 * Split a swap across multiple DEX pools, weighted by on-chain price quotes.
 *
 * Discovers pools at runtime for any ERC-20 token pair by querying on-chain
 * factories and registries:
 *   - Uniswap V3 (all fee tiers: 0.01%, 0.05%, 0.3%, 1%)
 *   - Uniswap V2
 *   - SushiSwap
 *   - Curve (via MetaRegistry)
 *
 * 1. Starts a Hardhat fork of Ethereum mainnet.
 * 2. Deploys the Sauce contract and funds it with tokenIn.
 * 3. Discovers all on-chain pools for the token pair.
 * 4. Quotes each pool at incremental chunk sizes to build a marginal-rate curve.
 * 5. Greedily allocates chunks to the pool with the best marginal rate.
 * 6. Executes the split swap and compares against single-pool swaps.
 *
 * Usage:
 *   FORK_URL=https://eth-mainnet.g.alchemy.com/v2/<key> npx tsx scripts/split-swap.ts <tokenIn> <tokenOut> [amounts...]
 *
 * Tokens can be addresses or well-known symbols: USDC, USDT, WETH, DAI, WBTC, etc.
 *
 * Examples:
 *   npx tsx scripts/split-swap.ts USDC USDT
 *   npx tsx scripts/split-swap.ts USDC USDT 1000000 5000000 10000000
 *   npx tsx scripts/split-swap.ts 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 0xdAC17F958D2ee523a2206206994597C13D831ec7
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  getAddress,
  defineChain,
  type Address,
  type Hex,
  type PublicClient,
  keccak256 as viemKeccak,
  encodePacked,
  pad,
  toHex as viemToHex,
  numberToHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { actionsToSauce } from '../src/to-sauce.js';
import type { RoutingAction } from '../src/types.js';

// ---------------------------------------------------------------------------
// Well-known mainnet tokens (for CLI convenience)
// ---------------------------------------------------------------------------

const TOKEN_SYMBOLS: Record<string, Address> = {
  USDC:   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT:   '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  DAI:    '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  WETH:   '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  WBTC:   '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  STETH:  '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  WSTETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  FRAX:   '0x853d955aCEf822Db058eb8505911ED77F175b99e',
  LUSD:   '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0',
  MKR:    '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
  UNI:    '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  LINK:   '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  AAVE:   '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  CRV:    '0xD533a949740bb3306d119CC777fa900bA034cd52',
  COMP:   '0xc00e94Cb662C3520282E6f5717214004A7f26888',
  CRVUSD: '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E',
  GHO:    '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f',
};

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function resolveToken(input: string): Address {
  if (input.startsWith('0x')) return getAddress(input);
  const upper = input.toUpperCase();
  const addr = TOKEN_SYMBOLS[upper];
  if (!addr) {
    console.error(`Unknown token symbol "${input}". Use an address or one of: ${Object.keys(TOKEN_SYMBOLS).join(', ')}`);
    process.exit(1);
  }
  return addr;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: npx tsx scripts/split-swap.ts <tokenIn> <tokenOut> [amounts...]');
  console.error('  Tokens: address or symbol (USDC, USDT, WETH, DAI, WBTC, ...)');
  console.error('  Amounts: human-readable (e.g. 1000000 for 1M). Defaults provided if omitted.');
  process.exit(1);
}

const TOKEN_IN = resolveToken(args[0]);
const TOKEN_OUT = resolveToken(args[1]);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FORK_URL = process.env.FORK_URL || process.env.RPC_URL;
if (!FORK_URL) {
  console.error('Set FORK_URL or RPC_URL env var.');
  process.exit(1);
}

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const DEV_TOOLS = resolve(REPO_ROOT, 'dev-tools');
const RPC = 'http://127.0.0.1:8545';
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const SLIPPAGE_BPS = 10n; // 0.1%
const MIN_TVL_USD = 50_000; // minimum TVL in human units (ignoring decimals precision)

// ---------------------------------------------------------------------------
// DEX addresses
// ---------------------------------------------------------------------------

const UNISWAP_V3_FACTORY: Address = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const UNISWAP_V3_QUOTER: Address  = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
const UNISWAP_V3_ROUTER: Address  = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
const UNISWAP_V2_FACTORY: Address = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_ROUTER: Address  = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const SUSHI_FACTORY: Address       = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
const SUSHI_ROUTER: Address        = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';
const CURVE_META_REGISTRY: Address = '0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC';
const CURVE_ROUTER_NG: Address     = '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D';

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

const uniV3FactoryAbi = parseAbi([
  'function getPool(address, address, uint24) view returns (address)',
]);

const uniV3QuoterAbi = parseAbi([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)',
]);

const uniV2FactoryAbi = parseAbi([
  'function getPair(address, address) view returns (address)',
]);

const uniV2PairAbi = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
]);

const curveMetaRegistryAbi = parseAbi([
  'function find_pools_for_coins(address, address) view returns (address[])',
  'function get_coin_indices(address, address, address) view returns (int128, int128, bool)',
  'function get_n_coins(address) view returns (uint256)',
]);

const curvePoolAbi = parseAbi([
  'function balances(uint256) view returns (uint256)',
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
]);

// ---------------------------------------------------------------------------
// Hardhat lifecycle
// ---------------------------------------------------------------------------

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

async function deploySauce(): Promise<Address> {
  const artifactPath = resolve(REPO_ROOT, 'engine/out/Sauce.sol/Sauce.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  const bytecode = artifact.bytecode.object as Hex;
  const abi = artifact.abi;

  const account = privateKeyToAccount(PK);
  const publicClient = makeClient();
  const walletClient = createWalletClient({ account, chain: localChain, transport: http(RPC) });

  const hash = await walletClient.deployContract({ abi, bytecode, account, chain: localChain });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error('Sauce deployment failed');
  return receipt.contractAddress;
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex');
}

function cookSend(sauce: Address, bytecode: Uint8Array, value?: string): Hex {
  const hex = toHex(bytecode);
  const valueFlag = value ? `--value ${value}` : '';
  const result = execSync(
    `cast send ${sauce} "cook(bytes[])" "[${hex}]" --rpc-url ${RPC} --private-key ${PK} ${valueFlag} --gas-limit 10000000 --json 2>&1`,
    { encoding: 'utf8' },
  ).trim();
  const tx = JSON.parse(result);
  if (tx.status !== '0x1') {
    throw new Error(`Transaction reverted: ${tx.transactionHash}`);
  }
  return tx.transactionHash as Hex;
}

function snapshot(): string {
  const raw = execSync(`cast rpc evm_snapshot --rpc-url ${RPC}`, { encoding: 'utf8' }).trim();
  return JSON.parse(raw);
}

function revert(id: string): void {
  execSync(`cast rpc evm_revert "${id}" --rpc-url ${RPC}`, { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// Token info
// ---------------------------------------------------------------------------

interface TokenInfo {
  address: Address;
  decimals: number;
  symbol: string;
}

async function getTokenInfo(client: PublicClient, token: Address): Promise<TokenInfo> {
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => token.slice(0, 10)),
  ]);
  return { address: token, decimals, symbol };
}

// ---------------------------------------------------------------------------
// Storage slot finder — for funding arbitrary ERC-20 tokens
// ---------------------------------------------------------------------------

/**
 * Brute-force find the storage slot for an ERC-20's balanceOf mapping.
 * Tries Solidity (keccak256(abi.encode(addr, slot))) and Vyper
 * (keccak256(abi.encode(slot, addr))) packing for slots 0-20.
 */
async function findBalanceSlot(
  token: Address,
  probe: Address,
): Promise<{ slot: number; isVyper: boolean } | null> {
  const snap = snapshot();

  for (let s = 0; s <= 20; s++) {
    for (const isVyper of [false, true]) {
      const storageSlot = isVyper
        ? viemKeccak(encodePacked(
            ['bytes32', 'bytes32'],
            [pad(numberToHex(s), { size: 32 }), pad(probe, { size: 32 })],
          ))
        : viemKeccak(encodePacked(
            ['bytes32', 'bytes32'],
            [pad(probe, { size: 32 }), pad(numberToHex(s), { size: 32 })],
          ));

      const testValue = pad(numberToHex(123456789n), { size: 32 });
      try {
        execSync(
          `cast rpc hardhat_setStorageAt ${token} ${storageSlot} ${testValue} --rpc-url ${RPC}`,
          { encoding: 'utf8' },
        );
        const client = makeClient();
        const balance = await client.readContract({
          address: token, abi: erc20Abi, functionName: 'balanceOf', args: [probe],
        });
        revert(snap);
        if (balance === 123456789n) {
          return { slot: s, isVyper };
        }
      } catch {
        // Try next
      }
    }
  }

  revert(snap);
  return null;
}

function computeStorageKey(
  addr: Address,
  slot: number,
  isVyper: boolean,
): Hex {
  return isVyper
    ? viemKeccak(encodePacked(
        ['bytes32', 'bytes32'],
        [pad(numberToHex(slot), { size: 32 }), pad(addr, { size: 32 })],
      ))
    : viemKeccak(encodePacked(
        ['bytes32', 'bytes32'],
        [pad(addr, { size: 32 }), pad(numberToHex(slot), { size: 32 })],
      ));
}

// ---------------------------------------------------------------------------
// Pool descriptor
// ---------------------------------------------------------------------------

interface PoolCandidate {
  name: string;
  tvl: bigint;
  /** Token-in decimals-scaled TVL for filtering (approximate USD value for stables). */
  tvlHuman: number;
  buildActions: (amountIn: bigint, recipient: Address) => RoutingAction[];
  quote: (amountIn: bigint) => Promise<bigint | null>;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

let localChain: ReturnType<typeof defineChain>;

async function initLocalChain(): Promise<void> {
  const tempClient = createPublicClient({ transport: http(RPC) });
  const chainId = await tempClient.getChainId();
  localChain = defineChain({
    id: chainId,
    name: 'Local',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
    contracts: {},
  });
}


/**
 * Hardhat defaults eth_call gas to 60M which exceeds its own 16M block cap
 * when no gas is specified. Use a custom transport that injects a gas limit.
 */
function cappedTransport() {
  const base = http(RPC)({ chain: localChain });
  return {
    ...base,
    async request(args: any) {
      if (args.method === 'eth_call' && args.params?.[0] && !args.params[0].gas) {
        args = { ...args, params: [{ ...args.params[0], gas: '0xe4e1c0' /* 15M */ }, ...args.params.slice(1)] };
      }
      return base.request(args);
    },
  };
}

function makeClient(): PublicClient {
  return createPublicClient({ chain: localChain, transport: () => cappedTransport() }) as PublicClient;
}

// ---------------------------------------------------------------------------
// Pool discovery: Uniswap V3
// ---------------------------------------------------------------------------

async function discoverUniV3Pools(
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
): Promise<PoolCandidate[]> {
  const client = makeClient();
  const fees = [100, 500, 3000, 10000] as const;
  const feeLabels: Record<number, string> = { 100: '0.01%', 500: '0.05%', 3000: '0.3%', 10000: '1%' };
  const results: PoolCandidate[] = [];

  for (const fee of fees) {
    const pool = await safe(() =>
      client.readContract({
        address: UNISWAP_V3_FACTORY, abi: uniV3FactoryAbi,
        functionName: 'getPool', args: [tokenIn.address, tokenOut.address, fee],
      })
    );
    if (!pool || pool === '0x0000000000000000000000000000000000000000') continue;

    const [balIn, balOut] = await Promise.all([
      client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }),
      client.readContract({ address: tokenOut.address, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }),
    ]);

    const tvlHuman = Number(formatUnits(balIn, tokenIn.decimals)) + Number(formatUnits(balOut, tokenOut.decimals));

    results.push({
      name: `Uniswap V3 (${feeLabels[fee]})`,
      tvl: balIn + balOut,
      tvlHuman,
      buildActions: (amountIn, recipient) => [
        { type: 'approve' as const, chainId: 1, token: tokenIn.address, spender: UNISWAP_V3_ROUTER, amount: amountIn.toString() },
        {
          type: 'uniswapV3ExactInput' as const,
          chainId: 1, router: UNISWAP_V3_ROUTER,
          tokenIn: tokenIn.address, tokenOut: tokenOut.address, fee,
          amountIn: amountIn.toString(),
          amountOutMin: ((amountIn * (10000n - SLIPPAGE_BPS)) / 10000n).toString(),
          recipient,
          deadline: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      quote: async (amountIn) => safe(() =>
        client.readContract({
          address: UNISWAP_V3_QUOTER, abi: uniV3QuoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [tokenIn.address, tokenOut.address, fee, amountIn, 0n],
        })
      ),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Pool discovery: Uniswap V2 / SushiSwap (share the same interface)
// ---------------------------------------------------------------------------

async function discoverV2Pool(
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
  factory: Address,
  router: Address,
  dexName: string,
): Promise<PoolCandidate | null> {
  const client = makeClient();
  const pair = await safe(() =>
    client.readContract({ address: factory, abi: uniV2FactoryAbi, functionName: 'getPair', args: [tokenIn.address, tokenOut.address] })
  );
  if (!pair || pair === '0x0000000000000000000000000000000000000000') return null;

  const token0 = await client.readContract({ address: pair, abi: uniV2PairAbi, functionName: 'token0' });
  const [reserve0, reserve1] = await client.readContract({ address: pair, abi: uniV2PairAbi, functionName: 'getReserves' });

  const isToken0In = token0.toLowerCase() === tokenIn.address.toLowerCase();
  const reserveIn = isToken0In ? reserve0 : reserve1;
  const reserveOut = isToken0In ? reserve1 : reserve0;

  const tvlHuman = Number(formatUnits(reserveIn, tokenIn.decimals)) + Number(formatUnits(reserveOut, tokenOut.decimals));

  return {
    name: dexName,
    tvl: reserveIn + reserveOut,
    tvlHuman,
    buildActions: (amountIn, recipient) => [
      { type: 'approve' as const, chainId: 1, token: tokenIn.address, spender: router, amount: amountIn.toString() },
      {
        type: 'uniswapV2Swap' as const,
        chainId: 1, router,
        amountIn: amountIn.toString(),
        amountOutMin: ((amountIn * (10000n - SLIPPAGE_BPS)) / 10000n).toString(),
        path: [tokenIn.address, tokenOut.address],
        recipient,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      },
    ],
    quote: async (amountIn) => {
      // Constant-product AMM formula
      const amountInWithFee = amountIn * 997n;
      const numerator = amountInWithFee * reserveOut;
      const denominator = reserveIn * 1000n + amountInWithFee;
      return numerator / denominator;
    },
  };
}

// ---------------------------------------------------------------------------
// Pool discovery: Curve (via MetaRegistry)
// ---------------------------------------------------------------------------

async function discoverCurvePools(
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
): Promise<PoolCandidate[]> {
  const client = makeClient();
  const results: PoolCandidate[] = [];

  const pools = await safe(() =>
    client.readContract({
      address: CURVE_META_REGISTRY, abi: curveMetaRegistryAbi,
      functionName: 'find_pools_for_coins',
      args: [tokenIn.address, tokenOut.address],
    })
  );
  if (!pools || pools.length === 0) return [];

  for (const pool of pools) {
    if (pool === '0x0000000000000000000000000000000000000000') continue;

    // Get coin indices
    const indices = await safe(() =>
      client.readContract({
        address: CURVE_META_REGISTRY, abi: curveMetaRegistryAbi,
        functionName: 'get_coin_indices',
        args: [pool, tokenIn.address, tokenOut.address],
      })
    );
    if (!indices) continue;
    const [i, j] = indices;

    // Get number of coins
    const nCoins = await safe(() =>
      client.readContract({
        address: CURVE_META_REGISTRY, abi: curveMetaRegistryAbi,
        functionName: 'get_n_coins', args: [pool],
      })
    );
    if (!nCoins) continue;

    // Query TVL via balances
    const [balIn, balOut] = await Promise.all([
      safe(() => client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'balanceOf', args: [pool] })),
      safe(() => client.readContract({ address: tokenOut.address, abi: erc20Abi, functionName: 'balanceOf', args: [pool] })),
    ]);
    if (balIn == null || balOut == null) continue;

    const tvlHuman = Number(formatUnits(balIn, tokenIn.decimals)) + Number(formatUnits(balOut, tokenOut.decimals));
    const poolShort = pool.slice(0, 10) + '...';

    results.push({
      name: `Curve (${poolShort})`,
      tvl: balIn + balOut,
      tvlHuman,
      buildActions: (amountIn, recipient) => [
        { type: 'approve' as const, chainId: 1, token: tokenIn.address, spender: CURVE_ROUTER_NG, amount: amountIn.toString() },
        {
          type: 'curveRouterNGSwap' as const,
          chainId: 1, router: CURVE_ROUTER_NG,
          route: [tokenIn.address, pool, tokenOut.address] as Address[],
          swapParams: [[Number(i), Number(j), 1, 1, Number(nCoins)]] as [number, number, number, number, number][],
          amountIn: amountIn.toString(),
          amountOutMin: ((amountIn * (10000n - SLIPPAGE_BPS)) / 10000n).toString(),
          pools: ['0x0000000000000000000000000000000000000000' as Address],
          recipient,
        },
      ],
      quote: async (amountIn) => safe(() =>
        client.readContract({
          address: pool, abi: curvePoolAbi,
          functionName: 'get_dy', args: [i, j, amountIn],
        })
      ),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Discover all pools
// ---------------------------------------------------------------------------

async function discoverAllPools(
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
): Promise<PoolCandidate[]> {
  const [v3Pools, uniV2, sushi, curvePools] = await Promise.all([
    discoverUniV3Pools(tokenIn, tokenOut),
    discoverV2Pool(tokenIn, tokenOut, UNISWAP_V2_FACTORY, UNISWAP_V2_ROUTER, 'Uniswap V2'),
    discoverV2Pool(tokenIn, tokenOut, SUSHI_FACTORY, SUSHI_ROUTER, 'SushiSwap'),
    discoverCurvePools(tokenIn, tokenOut),
  ]);

  const all: PoolCandidate[] = [
    ...v3Pools,
    ...(uniV2 ? [uniV2] : []),
    ...(sushi ? [sushi] : []),
    ...curvePools,
  ];

  return all.sort((a, b) => (b.tvlHuman > a.tvlHuman ? 1 : b.tvlHuman < a.tvlHuman ? -1 : 0));
}

// ---------------------------------------------------------------------------
// Greedy chunk-based allocation
// ---------------------------------------------------------------------------

const globalQuoteCache = new Map<PoolCandidate, Map<string, bigint>>();

async function greedyAllocate(
  pools: PoolCandidate[],
  totalRaw: bigint,
  decimals: number,
  symbol: string,
  verbose = true,
): Promise<{ pool: PoolCandidate; amount: bigint }[]> {
  const chunkSize = totalRaw / 40n > 0n ? totalRaw / 40n : totalRaw;
  const numChunks = Number(totalRaw / chunkSize);
  const alloc = new Map<PoolCandidate, bigint>();

  for (const p of pools) {
    alloc.set(p, 0n);
    if (!globalQuoteCache.has(p)) {
      const m = new Map<string, bigint>();
      m.set('0', 0n);
      globalQuoteCache.set(p, m);
    }
  }

  async function getCachedQuote(p: PoolCandidate, amount: bigint): Promise<bigint> {
    const cache = globalQuoteCache.get(p)!;
    const key = amount.toString();
    if (cache.has(key)) return cache.get(key)!;
    const result = await p.quote(amount);
    const out = result ?? 0n;
    cache.set(key, out);
    return out;
  }

  if (verbose) console.log(`  Greedy: ${numChunks} chunks of ${formatUnits(chunkSize, decimals)} ${symbol}`);

  for (let chunk = 0; chunk < numChunks; chunk++) {
    const marginals = await Promise.all(
      pools.map(async (p) => {
        const current = alloc.get(p)!;
        const next = current + chunkSize;
        const [outCurrent, outNext] = await Promise.all([
          getCachedQuote(p, current),
          getCachedQuote(p, next),
        ]);
        return { pool: p, marginal: outNext - outCurrent };
      }),
    );

    marginals.sort((a, b) => (b.marginal > a.marginal ? 1 : b.marginal < a.marginal ? -1 : 0));
    const best = marginals[0];
    alloc.set(best.pool, alloc.get(best.pool)! + chunkSize);
  }

  const result = pools
    .filter((p) => alloc.get(p)! > 0n)
    .map((p) => ({ pool: p, amount: alloc.get(p)! }));

  if (verbose) {
    for (const { pool, amount } of result) {
      const pct = Number((amount * 10000n) / totalRaw) / 100;
      console.log(`    ${pool.name.padEnd(30)} ${formatUnits(amount, decimals).padStart(15)} ${symbol}  (${pct.toFixed(1)}%)`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Swap execution + reporting
// ---------------------------------------------------------------------------

interface SwapResult {
  outReceived: bigint;
  inSpent: bigint;
  error?: string;
}

async function executeSwap(
  client: PublicClient,
  sauce: Address,
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
  allocations: { pool: PoolCandidate; amount: bigint }[],
): Promise<SwapResult> {
  const [outBefore, inBefore] = await Promise.all([
    client.readContract({ address: tokenOut.address, abi: erc20Abi, functionName: 'balanceOf', args: [sauce] }),
    client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'balanceOf', args: [sauce] }),
  ]);

  const allActions: RoutingAction[] = allocations.flatMap(({ pool, amount }) =>
    pool.buildActions(amount, sauce),
  );

  const bytecode = actionsToSauce(allActions);
  try {
    cookSend(sauce, bytecode);
  } catch (err: any) {
    return { outReceived: 0n, inSpent: 0n, error: err.message?.slice(0, 120) };
  }

  const [outAfter, inAfter] = await Promise.all([
    client.readContract({ address: tokenOut.address, abi: erc20Abi, functionName: 'balanceOf', args: [sauce] }),
    client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'balanceOf', args: [sauce] }),
  ]);

  return {
    outReceived: outAfter - outBefore,
    inSpent: inBefore - inAfter,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface SizeResult {
  label: string;
  totalRaw: bigint;
  splitAlloc: string;
  splitReceived: bigint;
  splitRate: number;
  poolResults: { name: string; received: bigint; rate: number; error?: string }[];
}

async function main() {
  console.log('\nStarting Hardhat fork...');
  const hardhatProcess = await startHardhat();

  try {
    await initLocalChain();
    const client = makeClient();
    const block = await client.getBlockNumber();
    console.log(`Forked at block ${block}`);

    // Get token info
    const [tokenInInfo, tokenOutInfo] = await Promise.all([
      getTokenInfo(client, TOKEN_IN),
      getTokenInfo(client, TOKEN_OUT),
    ]);

    console.log(`\nToken In:  ${tokenInInfo.symbol} (${tokenInInfo.address}, ${tokenInInfo.decimals} decimals)`);
    console.log(`Token Out: ${tokenOutInfo.symbol} (${tokenOutInfo.address}, ${tokenOutInfo.decimals} decimals)`);

    // Parse swap sizes from CLI or use defaults
    const defaultSizes = [1_000n, 10_000n, 100_000n, 1_000_000n, 10_000_000n];
    const swapSizesHuman = args.length > 2
      ? args.slice(2).map((a) => BigInt(a))
      : defaultSizes;

    // Deploy Sauce
    console.log('\nDeploying Sauce contract...');
    const SAUCE = await deploySauce();
    console.log(`Sauce deployed at ${SAUCE}`);

    // Find storage slot for tokenIn's balanceOf mapping
    console.log(`\nFinding storage slot for ${tokenInInfo.symbol}...`);
    const slotInfo = await findBalanceSlot(tokenInInfo.address, SAUCE);
    if (!slotInfo) {
      throw new Error(`Could not find balanceOf storage slot for ${tokenInInfo.symbol}. Token may use a non-standard storage layout.`);
    }
    console.log(`  Found: slot ${slotInfo.slot} (${slotInfo.isVyper ? 'Vyper' : 'Solidity'} packing)`);

    // Fund Sauce with tokenIn
    const unit = 10n ** BigInt(tokenInInfo.decimals);
    const maxSize = swapSizesHuman[swapSizesHuman.length - 1] * unit;
    const targetBalance = maxSize + maxSize / 10n; // 10% buffer

    const storageKey = computeStorageKey(SAUCE, slotInfo.slot, slotInfo.isVyper);
    const valueHex = pad(numberToHex(targetBalance), { size: 32 });

    console.log(`Funding Sauce with ${formatUnits(targetBalance, tokenInInfo.decimals)} ${tokenInInfo.symbol} (direct storage set)...`);
    execSync(
      `cast rpc hardhat_setStorageAt ${tokenInInfo.address} ${storageKey} ${valueHex} --rpc-url ${RPC}`,
      { encoding: 'utf8' },
    );

    const balance = await client.readContract({
      address: tokenInInfo.address, abi: erc20Abi, functionName: 'balanceOf', args: [SAUCE],
    });
    console.log(`Sauce ${tokenInInfo.symbol} balance: ${formatUnits(balance, tokenInInfo.decimals)}\n`);
    if (balance < maxSize) {
      throw new Error(`Funding failed: have ${formatUnits(balance, tokenInInfo.decimals)}, need ${formatUnits(maxSize, tokenInInfo.decimals)}`);
    }

    // Discover pools
    console.log('Discovering pools...');
    const pools = await discoverAllPools(tokenInInfo, tokenOutInfo);

    if (pools.length === 0) {
      throw new Error(`No pools found for ${tokenInInfo.symbol} → ${tokenOutInfo.symbol}`);
    }

    console.log(`\nDiscovered ${pools.length} Pools:`);
    for (const p of pools) {
      const status = p.tvlHuman >= MIN_TVL_USD ? '✓' : '✗';
      console.log(`  ${status} ${p.name.padEnd(30)} TVL: ${p.tvlHuman.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(18)}`);
    }

    const viable = pools.filter((p) => p.tvlHuman >= MIN_TVL_USD);
    if (viable.length === 0) {
      console.log(`\nNo pools with TVL >= ${MIN_TVL_USD.toLocaleString()}. Trying all pools...`);
      viable.push(...pools);
    }

    // Snapshot after funding
    const fundedSnap = snapshot();

    // Run each swap size
    const allResults: SizeResult[] = [];

    for (const sizeHuman of swapSizesHuman) {
      const totalRaw = sizeHuman * unit;
      const label = formatCompact(sizeHuman);

      console.log(`\n${'═'.repeat(75)}`);
      console.log(`  ${label} ${tokenInInfo.symbol} → ${tokenOutInfo.symbol}`);
      console.log('═'.repeat(75));

      if (balance < totalRaw) {
        console.log(`  SKIP — insufficient ${tokenInInfo.symbol}`);
        continue;
      }

      // Greedy allocation
      const allocations = await greedyAllocate(viable, totalRaw, tokenInInfo.decimals, tokenInInfo.symbol);
      const allocStr = allocations
        .map(({ pool, amount }) => {
          const pct = Number((amount * 100n) / totalRaw);
          return `${pool.name.split('(')[0].trim()} ${pct}%`;
        })
        .join(', ');

      // Execute split swap
      revert(fundedSnap);
      let snap = snapshot();
      const splitResult = await executeSwap(client, SAUCE, tokenInInfo, tokenOutInfo, allocations);
      revert(snap);

      const splitRate = splitResult.error
        ? 0
        : Number(splitResult.outReceived) / Number(splitResult.inSpent);

      if (!splitResult.error) {
        console.log(`  Split: ${formatUnits(splitResult.outReceived, tokenOutInfo.decimals)} ${tokenOutInfo.symbol} (rate: ${splitRate.toFixed(6)})`);
      } else {
        console.log(`  Split: REVERTED`);
      }

      // Single-pool comparisons
      const poolResults: SizeResult['poolResults'] = [];
      for (const pool of viable) {
        revert(fundedSnap);
        snap = snapshot();
        const result = await executeSwap(client, SAUCE, tokenInInfo, tokenOutInfo, [{ pool, amount: totalRaw }]);
        revert(snap);

        if (result.error) {
          console.log(`  ${pool.name}: REVERTED`);
          poolResults.push({ name: pool.name, received: 0n, rate: 0, error: result.error });
        } else {
          const rate = Number(result.outReceived) / Number(result.inSpent);
          console.log(`  ${pool.name}: ${formatUnits(result.outReceived, tokenOutInfo.decimals)} ${tokenOutInfo.symbol} (rate: ${rate.toFixed(6)})`);
          poolResults.push({ name: pool.name, received: result.outReceived, rate });
        }
      }

      allResults.push({
        label,
        totalRaw,
        splitAlloc: allocStr,
        splitReceived: splitResult.outReceived,
        splitRate,
        poolResults,
      });
    }

    // -----------------------------------------------------------------------
    // Final combined table
    // -----------------------------------------------------------------------
    const poolNames = [...new Set(allResults.flatMap((r) => r.poolResults.map((p) => p.name)))];

    console.log('\n\n' + '═'.repeat(100));
    console.log(`  COMBINED RESULTS — ${tokenOutInfo.symbol} received per strategy`);
    console.log('═'.repeat(100));

    const hdr = ['Size', '** Split **', ...poolNames.map((n) => n.split('(')[0].trim())];
    console.log('  ' + hdr.map((h, i) => i === 0 ? h.padEnd(10) : h.padStart(18)).join(''));
    console.log('  ' + '─'.repeat(10 + 18 * (poolNames.length + 1)));

    for (const r of allResults) {
      const splitStr = r.splitRate === 0 ? 'REVERTED' : formatUnits(r.splitReceived, tokenOutInfo.decimals);
      const cols = [r.label.padEnd(10), splitStr.padStart(18)];
      for (const name of poolNames) {
        const pr = r.poolResults.find((p) => p.name === name);
        cols.push(pr && !pr.error ? formatUnits(pr.received, tokenOutInfo.decimals).padStart(18) : 'REVERTED'.padStart(18));
      }
      console.log('  ' + cols.join(''));
    }

    // Rate table
    console.log('\n  ' + '─'.repeat(10 + 18 * (poolNames.length + 1)));
    console.log(`  Effective rates (${tokenOutInfo.symbol}/${tokenInInfo.symbol}):`);
    console.log('  ' + hdr.map((h, i) => i === 0 ? h.padEnd(10) : h.padStart(18)).join(''));
    console.log('  ' + '─'.repeat(10 + 18 * (poolNames.length + 1)));

    for (const r of allResults) {
      const splitStr = r.splitRate === 0 ? '—' : r.splitRate.toFixed(6);
      const cols = [r.label.padEnd(10), splitStr.padStart(18)];
      for (const name of poolNames) {
        const pr = r.poolResults.find((p) => p.name === name);
        cols.push(pr && !pr.error ? pr.rate.toFixed(6).padStart(18) : '—'.padStart(18));
      }
      console.log('  ' + cols.join(''));
    }

    // Split advantage table
    console.log('\n  ' + '─'.repeat(10 + 18 * (poolNames.length + 1)));
    console.log(`  Split advantage (${tokenOutInfo.symbol} gained vs single-pool):`);
    const hdr2 = ['Size', ...poolNames.map((n) => n.split('(')[0].trim())];
    console.log('  ' + hdr2.map((h, i) => i === 0 ? h.padEnd(10) : h.padStart(18)).join(''));
    console.log('  ' + '─'.repeat(10 + 18 * poolNames.length));

    for (const r of allResults) {
      const cols = [r.label.padEnd(10)];
      for (const name of poolNames) {
        const pr = r.poolResults.find((p) => p.name === name);
        if (!pr || pr.error || r.splitRate === 0) {
          cols.push('—'.padStart(18));
        } else {
          const diff = r.splitReceived - pr.received;
          const s = (diff >= 0n ? '+' : '') + formatUnits(diff, tokenOutInfo.decimals);
          cols.push(s.padStart(18));
        }
      }
      console.log('  ' + cols.join(''));
    }

    // Allocation table
    console.log('\n  ' + '─'.repeat(60));
    console.log('  Split allocations:');
    for (const r of allResults) {
      console.log(`  ${r.label.padEnd(10)} ${r.splitAlloc}`);
    }

    console.log('═'.repeat(100));
    console.log();

  } finally {
    hardhatProcess.kill('SIGTERM');
  }
}

function formatCompact(n: bigint): string {
  const num = Number(n);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(0)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(0)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toString();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

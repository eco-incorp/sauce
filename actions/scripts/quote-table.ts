import { createPublicClient, http, type Address, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionToQuote } from '../src/index.js';
import type { SwapAction } from '../src/index.js';

// Load FORK_URL from actions/.env.
(function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
})();

const URL = process.env.FORK_URL;
if (!URL) throw new Error('FORK_URL env var required (set it in actions/.env)');

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address;
const SWAP_ROUTER_V3 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as Address;
const QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as Address;
const CURVE_3POOL = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7' as Address;
const CALLER = '0x0000000000000000000000000000000000000001' as Address;

const client = createPublicClient({ chain: mainnet, transport: http(URL, { timeout: 120_000 }) });

const deadline = Math.floor(Date.now() / 1000) + 3600;

type Pool = { label: string; make: (a: bigint) => SwapAction };
const pools: Pool[] = [
  {
    label: 'UniV3 100bps',
    make: (a) => ({
      type: 'uniswapV3ExactInput', chainId: 1, router: SWAP_ROUTER_V3,
      tokenIn: USDC, tokenOut: USDT, fee: 100,
      amountIn: a.toString(), amountOutMin: '1', recipient: CALLER, deadline,
    }),
  },
  {
    label: 'UniV3 500bps',
    make: (a) => ({
      type: 'uniswapV3ExactInput', chainId: 1, router: SWAP_ROUTER_V3,
      tokenIn: USDC, tokenOut: USDT, fee: 500,
      amountIn: a.toString(), amountOutMin: '1', recipient: CALLER, deadline,
    }),
  },
  {
    label: 'Curve 3pool',
    make: (a) => ({
      type: 'curveSwap', chainId: 1, pool: CURVE_3POOL,
      tokenIn: USDC, tokenOut: USDT, i: 1, j: 2,
      amountIn: a.toString(), amountOutMin: '1', recipient: CALLER,
    }),
  },
];

const STEP = 200_000n * 1_000_000n; // 200,000 USDC (6 decimals)
const STEPS = 10; // 200k .. 2M

async function main() {
  const amounts = Array.from({ length: STEPS }, (_, i) => BigInt(i + 1) * STEP);

  // outputs[pool][step] = USDT received (in 6-decimal units), or null on error.
  const outputs: (bigint | null)[][] = pools.map(() => []);

  for (let p = 0; p < pools.length; p++) {
    for (let i = 0; i < amounts.length; i++) {
      const a = amounts[i];
      const q = actionToQuote(pools[p].make(a), a, { quoterV3: QUOTER_V2 });
      try {
        const res = await client.call({ to: q.to, data: q.data });
        outputs[p].push(q.decode(res.data as Hex));
      } catch (e) {
        outputs[p].push(null);
      }
    }
  }

  // Format numbers with underscores for readability.
  const fmt = (v: bigint | null, w = 14): string => {
    if (v === null) return 'ERR'.padStart(w);
    const s = v.toString();
    // Group from the right in 3s.
    const groups: string[] = [];
    for (let i = s.length; i > 0; i -= 3) groups.unshift(s.slice(Math.max(0, i - 3), i));
    return groups.join('_').padStart(w);
  };

  const headerCells = ['in (USDC)', ...pools.map((p) => p.label)];
  const widths = [12, 18, 18, 18];
  const renderRow = (cells: string[]) =>
    '  ' + cells.map((c, i) => c.padStart(widths[i])).join(' | ');

  console.log('\n=== USDT received (6-decimal) ===');
  console.log(renderRow(headerCells));
  console.log('  ' + '-'.repeat(widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * 3));
  for (let i = 0; i < amounts.length; i++) {
    const inUsdc = (amounts[i] / 1_000_000n).toString();
    const row = [inUsdc, ...pools.map((_, p) => fmt(outputs[p][i]))];
    console.log(renderRow(row));
  }

  console.log('\n=== Marginal Δ (this step - previous step) ===');
  console.log(renderRow(headerCells));
  console.log('  ' + '-'.repeat(widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * 3));
  for (let i = 0; i < amounts.length; i++) {
    const inUsdc = (amounts[i] / 1_000_000n).toString();
    const deltas = pools.map((_, p) => {
      const cur = outputs[p][i];
      if (cur === null) return null;
      if (i === 0) return cur; // step 1's Δ is just the value itself
      const prev = outputs[p][i - 1];
      if (prev === null) return null;
      return cur - prev;
    });
    const row = [inUsdc, ...deltas.map((d) => fmt(d))];
    console.log(renderRow(row));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

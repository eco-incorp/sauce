/**
 * spl-token-swap-forks Token-2022 handling. The classic spl-token-swap `Swap`
 * instruction takes ONE token program (used for both vaults and the pool mint),
 * so a per-side program does not exist for this family — a pool mixing legacy +
 * T22 mints cannot function under this program. This proves the adapter threads
 * the pool's OWN stored token_program (offset 3), so a Token-2022 pool routes
 * with T22 threaded through (no hardcoded-legacy assumption), a legacy pool is
 * byte-identical, and buildSwap forwards the resolved program verbatim. The quote
 * math depends only on vault reserves + fees, so the two quote identically.
 */
import { getAddressDecoder, getAddressEncoder } from '@solana/kit';
import type { Address } from '@solana/kit';
import { makeSplTokenSwapForkAdapter, TOKEN_SWAP_V1_PROGRAM_ID } from '../../../src/svm/venues/spl-token-swap-forks/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';

const dec = getAddressDecoder();
const aenc = getAddressEncoder();
const addr = (s: string): Address => s as unknown as Address;
const addrFromByte = (b: number): Address => dec.decode(new Uint8Array(32).fill(b));
const putAddr = (data: Uint8Array, offset: number, a: Address): void => data.set(new Uint8Array(aenc.encode(a)), offset);

const TOKEN_PROGRAM = addr('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = addr('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const POOL = addrFromByte(1);
const VAULT_IN = addrFromByte(4);
const VAULT_OUT = addrFromByte(5);
const POOL_MINT = addrFromByte(6);
const MINT_A = addrFromByte(11);
const MINT_B = addrFromByte(13);
const FEE_ACCOUNT = addrFromByte(7);

const RESERVE = 1_000_000_000n;

/** SwapVersion::SwapV1 (324 bytes). tokenProgram @3 is what this test varies. */
function pool(tokenProgram: Address): Uint8Array {
  const data = new Uint8Array(324);
  data[0] = 1; // version SwapV1
  data[1] = 1; // initialized
  data[2] = 254; // bump (arbitrary; off-curve derivation is not exercised here)
  putAddr(data, 3, tokenProgram);
  putAddr(data, 35, VAULT_IN);
  putAddr(data, 67, VAULT_OUT);
  putAddr(data, 99, POOL_MINT);
  putAddr(data, 131, MINT_A);
  putAddr(data, 163, MINT_B);
  putAddr(data, 195, FEE_ACCOUNT);
  // trade/owner fee numerators = 0 (denominators 0 is legal with a 0 numerator)
  data[291] = 0; // curve_type = ConstantProduct
  return data;
}

/** An SPL token account: amount u64 LE at offset 64. */
function vault(amount: bigint): Uint8Array {
  const data = new Uint8Array(165);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return data;
}

function loaderOf(entries: Array<[Address, Uint8Array]>): AccountLoader {
  const map = new Map(entries.map(([a, d]) => [a as string, d]));
  return async (a) => {
    const d = map.get(a as string);
    return d === undefined ? null : new Uint8Array(d);
  };
}

const adapter = makeSplTokenSwapForkAdapter('token-swap-v1', TOKEN_SWAP_V1_PROGRAM_ID);
const state = { [VAULT_IN as string]: vault(RESERVE), [VAULT_OUT as string]: vault(RESERVE) };

describe('spl-token-swap-forks Token-2022 handling', () => {
  it('decodes a legacy pool and threads the legacy token program (baseline)', async () => {
    const cfg = await adapter.fetchPoolConfig(loaderOf([[POOL, pool(TOKEN_PROGRAM)]]), POOL);
    expect(cfg.tokenProgram).toBe(TOKEN_PROGRAM);
    expect(adapter.referenceQuote(cfg, state, 1_000_000n, 0n)).toBeGreaterThan(0n);
  });

  it('ROUTES a Token-2022 pool (not dropped) and threads T22 through decode + buildSwap', async () => {
    const legacyCfg = await adapter.fetchPoolConfig(loaderOf([[POOL, pool(TOKEN_PROGRAM)]]), POOL);
    const legacyQuote = adapter.referenceQuote(legacyCfg, state, 1_000_000n, 0n);

    const cfg = await adapter.fetchPoolConfig(loaderOf([[POOL, pool(TOKEN_2022_PROGRAM)]]), POOL);
    expect(cfg.tokenProgram).toBe(TOKEN_2022_PROGRAM);
    // The swap-ix account list forwards the resolved (T22) program, not legacy.
    const swap = adapter.buildSwap(cfg, { owner: 'owner', inAta: 'in', outAta: 'out' }, 1_000_000n);
    const tokenProgAccount = swap.accounts[swap.accounts.length - 1];
    expect(tokenProgAccount.address).toBe(TOKEN_2022_PROGRAM);
    // A T22 pool with the same reserves/fees quotes identically to the legacy one.
    expect(adapter.referenceQuote(cfg, state, 1_000_000n, 0n)).toBe(legacyQuote);
  });
});

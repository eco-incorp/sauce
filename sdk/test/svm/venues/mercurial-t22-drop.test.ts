/**
 * mercurial Token-2022 self-drop: a 2-coin SwapV2 pool whose vault-A mint is a
 * Token-2022 (or un-routable) mint must drop; a classic legacy pool (vault
 * owners matching the derived authority) still decodes normally.
 */
import { createHash } from 'node:crypto';
import { address, getAddressDecoder, getAddressEncoder, isOffCurveAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { fetchMercurialPoolConfig, MERCURIAL_PROGRAM_ID } from '../../../src/svm/venues/mercurial/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const enc = getAddressEncoder();
const dec = getAddressDecoder();

const SWAP_STATE_LEN = 265;
const SPL_TOKEN_ACCOUNT_LEN = 165;
const OFF_NONCE = 2;
const OFF_TOKENS_LEN = 27;
const OFF_VAULT_A = 71;
const OFF_VAULT_B = 103;

const POOL = address('So11111111111111111111111111111111111111112');
const VAULT_A = address('SysvarC1ock11111111111111111111111111111111');
const VAULT_B = address('SysvarRent111111111111111111111111111111111');

function addrFromByte(b: number): Address {
  return dec.decode(new Uint8Array(32).fill(b));
}

/** Same off-curve PDA scheme as the adapter's deriveMercurialAuthority. */
function deriveAuthority(pool: Address, nonce: number): Address {
  const digest = createHash('sha256')
    .update(enc.encode(pool) as Uint8Array)
    .update(Uint8Array.of(nonce))
    .update(enc.encode(MERCURIAL_PROGRAM_ID) as Uint8Array)
    .update('ProgramDerivedAddress')
    .digest();
  return dec.decode(digest);
}

function findOffCurveNonce(pool: Address): { nonce: number; authority: Address } {
  for (let nonce = 0; nonce < 256; nonce++) {
    const authority = deriveAuthority(pool, nonce);
    if (isOffCurveAddress(authority)) return { nonce, authority };
  }
  throw new Error('no off-curve nonce found');
}

function buildPool(nonce: number): Uint8Array {
  const data = new Uint8Array(SWAP_STATE_LEN);
  data[0] = 2; // SwapV2 version tag
  data[1] = 1; // initialized
  data[OFF_NONCE] = nonce;
  new DataView(data.buffer).setUint32(OFF_TOKENS_LEN, 2, true); // 2 coin slots
  data.set(enc.encode(VAULT_A), OFF_VAULT_A);
  data.set(enc.encode(VAULT_B), OFF_VAULT_B);
  return data;
}

function buildVault(mint: Address, owner: Address): Uint8Array {
  const data = new Uint8Array(SPL_TOKEN_ACCOUNT_LEN);
  data.set(enc.encode(mint), 0);
  data.set(enc.encode(owner), 32);
  return data;
}

function loaderOf(entries: Array<[Address, Uint8Array]>): AccountLoader {
  const map = new Map(entries.map(([a, d]) => [a as string, d]));
  return async (addr) => {
    const d = map.get(addr as string);
    return d === undefined ? null : new Uint8Array(d);
  };
}

describe('mercurial Token-2022 self-drop', () => {
  const { nonce, authority } = findOffCurveNonce(POOL);
  const mintA = addrFromByte(11);
  const mintB = addrFromByte(13);

  it('drops a pool whose vault-A mint is a Token-2022 mint', async () => {
    const load = loaderOf([
      [POOL, buildPool(nonce)],
      [VAULT_A, buildVault(mintA, authority)],
      [VAULT_B, buildVault(mintB, authority)],
      [mintA, makeT22Mint()],
      [mintB, makeLegacyMint()],
    ]);
    await expect(fetchMercurialPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it('drops a pool whose vault-A mint carries an un-routable extension', async () => {
    const load = loaderOf([
      [POOL, buildPool(nonce)],
      [VAULT_A, buildVault(mintA, authority)],
      [VAULT_B, buildVault(mintB, authority)],
      [mintA, makeT22Mint(NON_TRANSFERABLE_TLV)],
      [mintB, makeLegacyMint()],
    ]);
    await expect(fetchMercurialPoolConfig(load, POOL)).rejects.toThrow(/Token-2022|un-routable/);
  });

  it('decodes a classic legacy pool unchanged', async () => {
    const load = loaderOf([
      [POOL, buildPool(nonce)],
      [VAULT_A, buildVault(mintA, authority)],
      [VAULT_B, buildVault(mintB, authority)],
      [mintA, makeLegacyMint()],
      [mintB, makeLegacyMint()],
    ]);
    const cfg = await fetchMercurialPoolConfig(load, POOL);
    expect(cfg.venue).toBe('mercurial');
    expect(cfg.mintA).toBe(mintA);
    expect(cfg.mintB).toBe(mintB);
    expect(cfg.authority).toBe(authority);
  });
});

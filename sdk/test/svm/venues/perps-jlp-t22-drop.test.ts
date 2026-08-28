/**
 * perps-jlp Token-2022 self-drop: a synthesized (otherwise valid) directed JLP
 * swap whose mintOut is a Token-2022 mint must make fetchPerpsJlpConfig REJECT
 * (the graceful self-drop signal). The Token-2022 gate runs after both custody
 * decodes / allowSwap checks and before the Doves feed reads, so a legacy pair
 * passes the gate and only then fails on the (deliberately absent) feeds.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import type { AccountLoader } from '../../../src/svm/index.js';
import { fetchPerpsJlpConfig, JLP_POOL_ADDRESS, CUSTODY_ACCOUNT_SIZE, custodyPda } from '../../../src/svm/venues/perps-jlp/index.js';
import { makeT22Mint, makeLegacyMint } from '../fixtures/token-2022/synth.js';

const MINT_IN = address('So11111111111111111111111111111111111111112'); // WSOL
const MINT_OUT = address('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'); // drop target
const TOKEN_ACCOUNT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const ORACLE = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const DOVES = address('orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE');

const CUSTODY_DISCRIMINATOR = [0x01, 0xb8, 0x30, 0x51, 0x5d, 0x83, 0x3f, 0x91];
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];

const codec = getAddressCodec();
function writePubkey(buf: Uint8Array, off: number, addr: Address): void {
  buf.set(new Uint8Array(codec.encode(addr)), off);
}

function buildCustody(mint: Address): Uint8Array {
  const data = new Uint8Array(CUSTODY_ACCOUNT_SIZE);
  data.set(CUSTODY_DISCRIMINATOR, 0);
  writePubkey(data, 40, mint); // OFF_MINT
  writePubkey(data, 72, TOKEN_ACCOUNT); // OFF_TOKEN_ACCOUNT
  data[104] = 6; // decimals
  data[105] = 0; // isStable
  writePubkey(data, 106, ORACLE); // OFF_ORACLE_ACCOUNT
  data[199] = 1; // allowSwap = true
  writePubkey(data, 320, DOVES); // OFF_DOVES_ORACLE
  return data;
}

function buildPool(custodyIn: Address, custodyOut: Address): Uint8Array {
  const data = new Uint8Array(256);
  data.set(POOL_DISCRIMINATOR, 0);
  // nameLen u32 @8 = 4, name "Pool"
  data[8] = 4;
  data.set(new TextEncoder().encode('Pool'), 12);
  // custodyCount u32 @16 = 2
  data[16] = 2;
  writePubkey(data, 20, custodyIn);
  writePubkey(data, 52, custodyOut);
  // remainder (aumUsd + Limit + fees) is zero-filled — decodePool reads it fine
  return data;
}

function loaderFrom(map: Record<string, Uint8Array>): AccountLoader {
  return async (addr: Address) => map[addr] ?? null;
}

describe('perps-jlp Token-2022 self-drop', () => {
  it('REJECTS a pair whose mintOut is a Token-2022 mint', async () => {
    const custodyIn = await custodyPda(JLP_POOL_ADDRESS, MINT_IN);
    const custodyOut = await custodyPda(JLP_POOL_ADDRESS, MINT_OUT);
    const load = loaderFrom({
      [custodyIn]: buildCustody(MINT_IN),
      [custodyOut]: buildCustody(MINT_OUT),
      [JLP_POOL_ADDRESS]: buildPool(custodyIn, custodyOut),
      [MINT_IN]: makeLegacyMint(),
      [MINT_OUT]: makeT22Mint(),
    });
    await expect(fetchPerpsJlpConfig(load, custodyIn, MINT_OUT)).rejects.toThrow(/Token-2022/);
  });

  it('classic-legacy mints pass the Token-2022 gate (fails later on the Doves feeds)', async () => {
    const custodyIn = await custodyPda(JLP_POOL_ADDRESS, MINT_IN);
    const custodyOut = await custodyPda(JLP_POOL_ADDRESS, MINT_OUT);
    const load = loaderFrom({
      [custodyIn]: buildCustody(MINT_IN),
      [custodyOut]: buildCustody(MINT_OUT),
      [JLP_POOL_ADDRESS]: buildPool(custodyIn, custodyOut),
      [MINT_IN]: makeLegacyMint(),
      [MINT_OUT]: makeLegacyMint(),
      // Doves feed (DOVES) intentionally not vendored
    });
    await expect(fetchPerpsJlpConfig(load, custodyIn, MINT_OUT)).rejects.toThrow(/Doves/);
  });
});

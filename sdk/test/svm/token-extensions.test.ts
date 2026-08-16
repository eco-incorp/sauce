/**
 * Token-2022 mint extension parsing + transfer-fee math units (no engine, no
 * RPC). Every mint is hand-constructed from raw bytes here — these synthetic
 * byte builders ARE the fixtures; no mainnet mint address is used. The expected
 * fee values are computed by hand from the spl-token-2022 formula
 * (min(maximum_fee, ceil(amount * bps / 10_000)); newer if epoch >= newer.epoch).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calcTransferFee,
  getEpochFee,
  netTransferAmount,
  parseMintExtensions,
} from '../../src/svm/token-extensions.js';
import type { TransferFeeConfig } from '../../src/svm/token-extensions.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// --- little-endian byte builders ---
function u16le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}
function u64le(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** One TransferFee struct (18 bytes): epoch u64, maximum_fee u64, bps u16. */
function transferFee(epoch: bigint, maximumFee: bigint, bps: number): Uint8Array {
  const out = new Uint8Array(18);
  out.set(u64le(epoch), 0);
  out.set(u64le(maximumFee), 8);
  out.set(u16le(bps), 16);
  return out;
}

/** TransferFeeConfig value (108 bytes): authorities + withheld left zero. */
function transferFeeConfigValue(older: Uint8Array, newer: Uint8Array): Uint8Array {
  const out = new Uint8Array(108);
  out.set(older, 72);
  out.set(newer, 90);
  return out;
}

/** A single TLV entry: type u16, length u16, value. */
function tlvEntry(type: number, value: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  out.set(u16le(type), 0);
  out.set(u16le(value.length), 2);
  out.set(value, 4);
  return out;
}

/** A Token-2022 mint carrying the given TLV entries. */
function t22MintWith(...entries: Uint8Array[]): Uint8Array {
  const tlvLen = entries.reduce((s, e) => s + e.length, 0);
  const out = new Uint8Array(166 + tlvLen);
  out[165] = 1; // account_type = Mint
  let off = 166;
  for (const e of entries) {
    out.set(e, off);
    off += e.length;
  }
  return out;
}

const MAX_FEE = 1_000_000n;
// older: fee active for epoch < 10 — 1% (100 bps). newer: for epoch >= 10 — 2% (200 bps).
const feeConfigMint = (): Uint8Array =>
  t22MintWith(
    tlvEntry(1, transferFeeConfigValue(transferFee(0n, MAX_FEE, 100), transferFee(10n, MAX_FEE, 200))),
  );

describe('parseMintExtensions — TransferFeeConfig', () => {
  it('parses both fee schedules and the two epochs', () => {
    const ext = parseMintExtensions(feeConfigMint());
    expect(ext.transferFee).toBeDefined();
    const cfg = ext.transferFee as TransferFeeConfig;
    expect(cfg.olderTransferFee).toEqual({ epoch: 0n, maximumFee: MAX_FEE, transferFeeBasisPoints: 100 });
    expect(cfg.newerTransferFee).toEqual({ epoch: 10n, maximumFee: MAX_FEE, transferFeeBasisPoints: 200 });
    expect(ext.blocking).toEqual([]);
  });

  it('returns empty extensions for a legacy 82-byte mint', () => {
    const ext = parseMintExtensions(new Uint8Array(82));
    expect(ext.transferFee).toBeUndefined();
    expect(ext.transferHook).toBeUndefined();
    expect(ext.blocking).toEqual([]);
  });
});

describe('calcTransferFee / netTransferAmount', () => {
  const cfg = parseMintExtensions(feeConfigMint()).transferFee as TransferFeeConfig;

  it('below the cap: bps applies with ceiling rounding', () => {
    // epoch 5 < 10 -> older (1%). 12_345 * 100 / 10_000 = 123.45 -> ceil 124.
    expect(calcTransferFee(12_345n, cfg, 5n)).toBe(124n);
    expect(netTransferAmount(12_345n, cfg, 5n)).toBe(12_345n - 124n);
  });

  it('above the cap: maximum_fee applies', () => {
    // epoch 5 -> older (1%). 1e9 * 1% = 1e7, capped at MAX_FEE.
    expect(calcTransferFee(1_000_000_000n, cfg, 5n)).toBe(MAX_FEE);
    expect(netTransferAmount(1_000_000_000n, cfg, 5n)).toBe(1_000_000_000n - MAX_FEE);
  });

  it('epoch boundary: older below newer.epoch, newer at and above it', () => {
    // 10_000 units: older 1% = 100, newer 2% = 200 (both exact, no ceiling).
    expect(calcTransferFee(10_000n, cfg, 9n)).toBe(100n); // older
    expect(calcTransferFee(10_000n, cfg, 10n)).toBe(200n); // newer (epoch == newer.epoch)
    expect(calcTransferFee(10_000n, cfg, 11n)).toBe(200n); // newer
    expect(getEpochFee(cfg, 9n).transferFeeBasisPoints).toBe(100);
    expect(getEpochFee(cfg, 10n).transferFeeBasisPoints).toBe(200);
  });

  it('zero amount yields zero fee (and full net)', () => {
    expect(calcTransferFee(0n, cfg, 5n)).toBe(0n);
    expect(calcTransferFee(0n, cfg, 20n)).toBe(0n);
    expect(netTransferAmount(0n, cfg, 5n)).toBe(0n);
  });

  it('zero-bps schedule yields zero fee', () => {
    const zeroCfg = parseMintExtensions(
      t22MintWith(tlvEntry(1, transferFeeConfigValue(transferFee(0n, MAX_FEE, 0), transferFee(0n, MAX_FEE, 0)))),
    ).transferFee as TransferFeeConfig;
    expect(calcTransferFee(1_000_000n, zeroCfg, 5n)).toBe(0n);
  });
});

describe('parseMintExtensions — blocking (genuinely un-routable) extensions', () => {
  it('flags NonTransferable as blocking', () => {
    const ext = parseMintExtensions(t22MintWith(tlvEntry(9, new Uint8Array(0))));
    expect(ext.blocking.some((r) => r.startsWith('NonTransferable'))).toBe(true);
  });

  it('flags DefaultAccountState only when frozen (value 2)', () => {
    const frozen = parseMintExtensions(t22MintWith(tlvEntry(6, new Uint8Array([2]))));
    const initialized = parseMintExtensions(t22MintWith(tlvEntry(6, new Uint8Array([1]))));
    expect(frozen.blocking.some((r) => r.startsWith('DefaultAccountState'))).toBe(true);
    expect(initialized.blocking).toEqual([]);
  });
});

describe('parseMintExtensions — advisories (present-but-routable) do NOT block', () => {
  // PermanentDelegate + ConfidentialTransferMint are carried by the flagship
  // tradeable T22 stablecoins (PYUSD/USDG) yet transfer normally everywhere.
  // Blocking them would self-drop those pools and defeat T22 support.
  it('PermanentDelegate is an advisory, not blocking', () => {
    const ext = parseMintExtensions(t22MintWith(tlvEntry(12, new Uint8Array(32))));
    expect(ext.blocking).toEqual([]);
    expect(ext.advisories.some((r) => r.startsWith('PermanentDelegate'))).toBe(true);
  });

  it('ConfidentialTransferMint is an advisory, not blocking', () => {
    const ext = parseMintExtensions(t22MintWith(tlvEntry(4, new Uint8Array(97))));
    expect(ext.blocking).toEqual([]);
    expect(ext.advisories.some((r) => r.startsWith('ConfidentialTransferMint'))).toBe(true);
  });
});

describe('parseMintExtensions — real mainnet mints (vendored fixture)', () => {
  // Regression guard: the two flagship Token-2022 stablecoins the brief names
  // must NOT be dropped. Bytes captured live (owner == Token-2022) into
  // fixtures/token-2022/real-mints.json.
  const realMints = JSON.parse(
    readFileSync(join(HERE, 'fixtures/token-2022/real-mints.json'), 'utf8'),
  ) as Record<string, { mint: string; owner: string; space: number; dataBase64: string }>;

  for (const name of ['pyusd', 'usdg']) {
    it(`${name}: routable (no blocking extensions), fee 0 bps, hook program nil`, () => {
      const data = Uint8Array.from(Buffer.from(realMints[name].dataBase64, 'base64'));
      const ext = parseMintExtensions(data);
      expect(ext.blocking).toEqual([]); // MUST route — the whole point of T22 support
      // both carry PermanentDelegate + ConfidentialTransferMint as advisories
      expect(ext.advisories.some((r) => r.startsWith('PermanentDelegate'))).toBe(true);
      expect(ext.advisories.some((r) => r.startsWith('ConfidentialTransferMint'))).toBe(true);
      // fee schedule present but zero bps -> netting is a no-op
      expect(ext.transferFee).toBeDefined();
      expect(calcTransferFee(1_000_000_000n, ext.transferFee as TransferFeeConfig, 10_000n)).toBe(0n);
      // hook authority is set but program is nil -> no extra accounts needed
      expect(ext.transferHook).toBeUndefined();
    });
  }
});

describe('parseMintExtensions — TransferHook', () => {
  it('captures a non-nil hook program and ignores a nil one', () => {
    const nonNil = new Uint8Array(64);
    nonNil.fill(7, 32, 64); // program_id non-zero
    const withHook = parseMintExtensions(t22MintWith(tlvEntry(14, nonNil)));
    expect(withHook.transferHook?.programId).toBeDefined();
    expect(withHook.transferHook?.extraAccountMetaListPda).toBeUndefined();

    const nilHook = parseMintExtensions(t22MintWith(tlvEntry(14, new Uint8Array(64))));
    expect(nilHook.transferHook).toBeUndefined();
  });
});

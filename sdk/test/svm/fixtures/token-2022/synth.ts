/**
 * Synthetic Token-2022 / legacy mint byte builders for venue drop-detection
 * tests. Not a test file (no *.test.ts suffix) — a shared helper the per-venue
 * T22-drop tests import. No mainnet addresses; every mint is hand-built bytes.
 */

/** A classic SPL mint is exactly 82 bytes. */
export function makeLegacyMint(): Uint8Array {
  return new Uint8Array(82);
}

/** One TLV entry: extension_type u16 LE, length u16 LE, then value. */
export function tlvEntry(type: number, value: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  out[0] = type & 0xff;
  out[1] = (type >> 8) & 0xff;
  out[2] = value.length & 0xff;
  out[3] = (value.length >> 8) & 0xff;
  out.set(value, 4);
  return out;
}

/**
 * A Token-2022 mint: 165-byte base, account-type byte (== 1, Mint) at offset
 * 165, then the given TLV region (>= 166 bytes total, so it classifies as T22).
 * With no TLV it is still a valid, routable extensionless-shaped T22 mint for
 * detection purposes (length 166).
 */
export function makeT22Mint(...tlv: Uint8Array[]): Uint8Array {
  const tlvLen = tlv.reduce((s, e) => s + e.length, 0);
  const out = new Uint8Array(166 + tlvLen);
  out[165] = 1; // account_type = Mint
  let off = 166;
  for (const e of tlv) {
    out.set(e, off);
    off += e.length;
  }
  return out;
}

/** NonTransferable (ExtensionType 9) — a genuinely un-routable, blocking mint. */
export const NON_TRANSFERABLE_TLV = tlvEntry(9);

/**
 * PermanentDelegate (ExtensionType 12) — an ADVISORY (not blocking) extension:
 * PYUSD/USDG carry it and trade normally, so it must NOT self-drop a pool.
 * 32-byte value (the delegate authority pubkey; contents irrelevant here).
 */
export const PERMANENT_DELEGATE_TLV = tlvEntry(12, new Uint8Array(32));

/**
 * A TransferFeeConfig (ExtensionType 1, 108-byte value) with `bps` basis points
 * on BOTH the older and newer schedules. `bps === 0` builds a present-but-zero
 * fee config (routes identically to a plain mint); `bps > 0` is a fee-bearing
 * mint. Value layout (spl-token-2022): +72 older TransferFee, +90 newer
 * TransferFee, each { epoch u64, maximum_fee u64, bps u16 } (18 bytes).
 */
export function transferFeeConfigTlv(bps = 0, maximumFee = 0n, epoch = 0n): Uint8Array {
  const value = new Uint8Array(108);
  const writeFee = (o: number): void => {
    for (let i = 0; i < 8; i++) value[o + i] = Number((epoch >> BigInt(8 * i)) & 0xffn);
    for (let i = 0; i < 8; i++) value[o + 8 + i] = Number((maximumFee >> BigInt(8 * i)) & 0xffn);
    value[o + 16] = bps & 0xff;
    value[o + 17] = (bps >> 8) & 0xff;
  };
  writeFee(72);
  writeFee(90);
  return tlvEntry(1, value);
}

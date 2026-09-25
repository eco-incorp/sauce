/**
 * Orca Whirlpools tick math — exact transcription of
 * programs/whirlpool/src/math/tick_math.rs sqrt_price_from_tick_index:
 * positive ticks accumulate in Q96 with (r*C) >> 96 steps and a final >> 32,
 * negative ticks accumulate in Q64 with (r*C) >> 64 steps. Verified against
 * the source's own pinned bit-value test table (see the unit suite).
 *
 * Shared by fetchPoolConfig (deriving the shipped boundary sqrt prices), the
 * ladder mirror and the test fixtures. sqrt_price_from_tick_index is a pure
 * function of the tick, which is why a prepare-shipped sqrt price is exact
 * by construction — the engine-side fragment never recomputes it (an in-VM
 * bit ladder costs ~54k CU per call on the interpreter).
 */

export const MIN_TICK_INDEX = -443636;
export const MAX_TICK_INDEX = 443636;
export const MIN_SQRT_PRICE = 4_295_048_016n;
export const MAX_SQRT_PRICE = 79_226_673_515_401_279_992_447_579_055n;

const POS_TABLE: readonly bigint[] = [
  79232123823359799118286999567n, // bit 0 (initial when set)
  79236085330515764027303304731n,
  79244008939048815603706035061n,
  79259858533276714757314932305n,
  79291567232598584799939703904n,
  79355022692464371645785046466n,
  79482085999252804386437311141n,
  79736823300114093921829183326n,
  80248749790819932309965073892n,
  81282483887344747381513967011n,
  83390072131320151908154831281n,
  87770609709833776024991924138n,
  97234110755111693312479820773n,
  119332217159966728226237229890n,
  179736315981702064433883588727n,
  407748233172238350107850275304n,
  2098478828474011932436660412517n,
  55581415166113811149459800483533n,
  38992368544603139932233054999993551n,
];
const POS_ONE = 79228162514264337593543950336n; // 2^96

const NEG_TABLE: readonly bigint[] = [
  18445821805675392311n, // bit 0 (initial when set)
  18444899583751176498n,
  18443055278223354162n,
  18439367220385604838n,
  18431993317065449817n,
  18417254355718160513n,
  18387811781193591352n,
  18329067761203520168n,
  18212142134806087854n,
  17980523815641551639n,
  17526086738831147013n,
  16651378430235024244n,
  15030750278693429944n,
  12247334978882834399n,
  8131365268884726200n,
  3584323654723342297n,
  696457651847595233n,
  26294789957452057n,
  37481735321082n,
];
const NEG_ONE = 18446744073709551616n; // 2^64

/** sqrt_price_from_tick_index (Q64.64) over the UNBIASED tick. */
export function whirlpoolSqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK_INDEX || tick > MAX_TICK_INDEX) {
    throw new Error(`whirlpoolSqrtPriceAtTick: tick ${tick} out of range`);
  }
  if (tick >= 0) {
    const t = BigInt(tick);
    let r = (t & 1n) !== 0n ? POS_TABLE[0] : POS_ONE;
    for (let bit = 1; bit < POS_TABLE.length; bit++) {
      if ((t & (1n << BigInt(bit))) !== 0n) r = (r * POS_TABLE[bit]) >> 96n;
    }
    return r >> 32n;
  }
  const t = BigInt(-tick);
  let r = (t & 1n) !== 0n ? NEG_TABLE[0] : NEG_ONE;
  for (let bit = 1; bit < NEG_TABLE.length; bit++) {
    if ((t & (1n << BigInt(bit))) !== 0n) r = (r * NEG_TABLE[bit]) >> 64n;
  }
  return r;
}

/**
 * Input/output vectors for the bin-step DLMM math (meteora-dlmm, saros-dlmm) and HumidiFi's
 * instruction obfuscation. The DLMM prices are the venues' own: the same values the deployed
 * programs store and swap at (the svm-exact-in and svm-dlmm suites hold the swaps to them).
 */
import {
  amountIn,
  amountOut,
  binPrice,
  mulShr,
  pow,
  shlDiv,
} from "../../../src/svm/venues/dlmm-math.js";
import { ONE, priceFromId } from "../../../src/svm/venues/meteora-dlmm/bin-math.js";
import {
  CENTER_BIN_ID,
  priceFromId as sarosPriceFromId,
} from "../../../src/svm/venues/saros-dlmm/index.js";
import {
  HUMIDIFI_AMOUNT_XOR_MASK,
  humidifiDeobfuscate,
  humidifiKeystream,
} from "../../../src/svm/venues/humidifi/index.js";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("bin-step DLMM math", () => {
  it.each<[number, number, bigint]>([
    [0, 4, 18446744073709551616n],
    [1, 4, 18454122771339035436n],
    [-1, 4, 18439368326379000016n],
    [1, 1, 18448588748116922571n],
    [-1, 1, 18444899583751176498n],
    [3, 5, 18474428027184014234n],
    [-3, 5, 18419101604673949486n],
    [100, 25, 23678699809202413098n],
    [-100, 25, 14370821441331513819n],
    [-4000, 4, 3725525056397554795n],
    [887, 100, 125596711293410453609357n],
    [-887, 100, 2709325454597247n],
    [443636, 1, 340282366920938463463374607431768211455n],
    [-443636, 1, 1n],
  ])("binPrice(%i, %i) is %s", (exponent, binStep, price) => {
    expect(binPrice(exponent, binStep)).toBe(price);
  });

  it.each<[number, number]>([
    [5000, 100],
    [-5000, 100],
    [524287, 1],
    [524288, 1],
    [-524288, 1],
  ])("binPrice(%i, %i) cannot be represented", (exponent, binStep) => {
    expect(binPrice(exponent, binStep)).toBeNull();
  });

  it.each<[bigint, number, bigint | null]>([
    [ONE, 0, ONE],
    [ONE + 1n, 0x80000, null],
    [ONE + 1n, -0x80000, null],
    [ONE + 1n, 0x7ffff, 18446744073710075903n],
    [1n << 63n, 1, 9223372036854775808n],
    [1n << 63n, -1, 36893488147419103231n],
    [1n << 63n, 2, 4611686018427387904n],
    [1n << 65n, 1, 36893488147419103236n],
    [1n << 65n, -1, 9223372036854775807n],
    [1n, 5, null],
    [0n, 5, null],
  ])("pow(%s, %i) is %s", (base, exp, result) => {
    expect(pow(base, exp)).toBe(result);
  });

  it("rounds the fixed-point products and quotients as asked", () => {
    expect(mulShr(3n, 1n << 63n, "down")).toBe(1n);
    expect(mulShr(3n, 1n << 63n, "up")).toBe(2n);
    expect(mulShr(4n, 1n << 63n, "up")).toBe(2n);
    expect(shlDiv(1n, 3n, "down")).toBe(6148914691236517205n);
    expect(shlDiv(1n, 3n, "up")).toBe(6148914691236517206n);
    expect(shlDiv(3n, 1n << 64n, "up")).toBe(3n);
  });

  it("converts amounts at a bin's price, both directions, both roundings", () => {
    const price = 23678699809202413098n;
    expect(amountOut(1000n, price, true, "down")).toBe(1283n);
    expect(amountOut(1000n, price, true, "up")).toBe(1284n);
    expect(amountOut(1000n, price, false, "down")).toBe(779n);
    expect(amountOut(1000n, price, false, "up")).toBe(780n);
    expect(amountIn(1000n, price, true, "down")).toBe(779n);
    expect(amountIn(1000n, price, true, "up")).toBe(780n);
    expect(amountIn(1000n, price, false, "down")).toBe(1283n);
    expect(amountIn(1000n, price, false, "up")).toBe(1284n);
  });

  it("meteora-dlmm prices a bin by its id, within ±443636", () => {
    expect(priceFromId(100, 25)).toBe(23678699809202413098n);
    expect(priceFromId(-443636, 1)).toBe(1n);
    expect(() => priceFromId(443637, 1)).toThrow("priceFromId: bin id 443637 out of range");
    expect(() => priceFromId(0.5, 4)).toThrow("priceFromId: bin id 0.5 out of range");
    expect(() => priceFromId(5000, 100)).toThrow("priceFromId: pow overflow for bin 5000 step 100");
  });

  it("saros-dlmm prices a bin by its id less CENTER_BIN_ID", () => {
    expect(sarosPriceFromId(CENTER_BIN_ID + 100, 25)).toBe(23678699809202413098n);
    expect(sarosPriceFromId(CENTER_BIN_ID - 3, 5)).toBe(18419101604673949486n);
    expect(() => sarosPriceFromId(CENTER_BIN_ID + 524288, 1)).toThrow(
      "saros-dlmm priceFromId: pow overflow for bin 8912896 step 1",
    );
  });
});

describe("HumidiFi instruction obfuscation", () => {
  it.each<[number, string]>([
    [0, "3aff2fffe2baebc3"],
    [1, "3bff2effe3baeac3"],
    [2, "38ff2dffe0bae9c3"],
    [3, "39ff2cffe1bae8c3"],
    [255, "c5ffd0ff1dba14c3"],
    [256, "3afe2ffee2bbebc2"],
    [258, "38fe2dfee0bbe9c2"],
    [65535, "c500d0001d45143c"],
  ])("the keystream of chunk %i is %s", (pos, keystream) => {
    expect(hex(humidifiKeystream(pos))).toBe(keystream);
  });

  it("the amount mask is chunk 1's keystream as a little-endian u64", () => {
    const keystream = humidifiKeystream(1);
    let mask = 0n;
    for (let i = 7; i >= 0; i--) mask = (mask << 8n) | BigInt(keystream[i]!);
    expect(mask).toBe(HUMIDIFI_AMOUNT_XOR_MASK);
  });

  it("deobfuscates whole and partial chunks", () => {
    const bytes = Uint8Array.from({ length: 25 }, (_, i) => i);
    expect(hex(humidifiDeobfuscate(bytes))).toBe(
      "3afe2dfce6bfedc433f624f4efb7e4cc28ee3fecf4afffd421",
    );
    expect(hex(humidifiDeobfuscate(Uint8Array.from([1, 2, 3])))).toBe("3bfd2c");
    expect(humidifiDeobfuscate(new Uint8Array(0))).toEqual(new Uint8Array(0));
    // Applying it twice gives the input back.
    expect(humidifiDeobfuscate(humidifiDeobfuscate(bytes))).toEqual(bytes);
  });
});

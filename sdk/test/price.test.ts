/**
 * `sqrtPriceX96FromPrice` / `priceFromSqrtPriceX96`: a human price as a V3/V4 pool's sqrtPriceX96,
 * and back — pinned against values computed independently of the module, and against each other.
 */
import {
  MAX_SQRT_PRICE_X96,
  MIN_SQRT_PRICE_X96,
  priceFromSqrtPriceX96,
  sqrtPriceX96FromPrice,
  type PoolPriceTokens,
} from "../src/index.js";

const Q96 = 1n << 96n;
/** 2,700 USDC per WETH, as on Base and Arbitrum, where WETH is the lower address. */
const WETH_USDC: PoolPriceTokens = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: true };

describe("sqrtPriceX96FromPrice", () => {
  it("is 2^96 at a price of one, between tokens of equal decimals, in either order", () => {
    for (const baseIsToken0 of [true, false]) {
      expect(
        sqrtPriceX96FromPrice("1", { baseDecimals: 18, quoteDecimals: 18, baseIsToken0 }),
      ).toBe(Q96);
    }
  });

  it("matches the integer square root of token1 units per token0 unit, times 2^192", () => {
    // 1,500 USDC per WETH: 1500e6 USDC units per 1e18 WETH units.
    expect(sqrtPriceX96FromPrice("1500", WETH_USDC)).toBe(3068493539683605256287027n);
    // The same pool, with USDC as the base: 1/1500 WETH per USDC is the same pool price.
    expect(
      sqrtPriceX96FromPrice("0.000666666666666666666666666666666667", {
        baseDecimals: 6,
        quoteDecimals: 18,
        baseIsToken0: false,
      }),
    ).toBe(3068493539683605256287027n);
    // When the base is token1 the pool price inverts: 2,700 USDC per WETH, USDC the lower address.
    const inverted = sqrtPriceX96FromPrice("2700", { ...WETH_USDC, baseIsToken0: false });
    expect(inverted * inverted <= (Q96 * Q96 * 10n ** 18n) / (2700n * 10n ** 6n)).toBe(true);
    expect((inverted + 1n) ** 2n > (Q96 * Q96 * 10n ** 18n) / (2700n * 10n ** 6n)).toBe(true);
  });

  it("takes a decimal string, a number or a bigint, the same value each way", () => {
    const expected = sqrtPriceX96FromPrice("2700", WETH_USDC);
    for (const price of [2700, 2700n, "2700.0", "2.7e3", " 2700 "]) {
      expect(sqrtPriceX96FromPrice(price, WETH_USDC)).toBe(expected);
    }
    expect(sqrtPriceX96FromPrice("0.5", { ...WETH_USDC, quoteDecimals: 18 })).toBe(
      sqrtPriceX96FromPrice(0.5, { ...WETH_USDC, quoteDecimals: 18 }),
    );
  });

  it("refuses what is not a price a pool can hold", () => {
    for (const price of ["0", "-1", "abc", "", ".", "1e", Number.NaN, Infinity, -2n]) {
      expect(() => sqrtPriceX96FromPrice(price, WETH_USDC)).toThrow(RangeError);
    }
    expect(() => sqrtPriceX96FromPrice("1e-40", WETH_USDC)).toThrow(/outside the range/);
    expect(() => sqrtPriceX96FromPrice("1e40", { ...WETH_USDC, quoteDecimals: 18 })).toThrow(
      /outside the range/,
    );
    expect(() => sqrtPriceX96FromPrice("1", { ...WETH_USDC, baseDecimals: 1.5 })).toThrow(
      /decimals/,
    );
  });
});

describe("priceFromSqrtPriceX96", () => {
  it("reads 2^96 as one, and a limit back as the price it was made from", () => {
    expect(
      priceFromSqrtPriceX96(Q96, { baseDecimals: 6, quoteDecimals: 6, baseIsToken0: true }),
    ).toBe("1");
    for (const price of ["2700", "1500", "0.25", "123456.789", "0.000001"]) {
      for (const baseIsToken0 of [true, false]) {
        const tokens = { ...WETH_USDC, baseIsToken0 };
        expect(priceFromSqrtPriceX96(sqrtPriceX96FromPrice(price, tokens), tokens)).toBe(price);
      }
    }
  });

  it("rounds to the fraction digits asked for, half up, without trailing zeros", () => {
    const tokens: PoolPriceTokens = { baseDecimals: 0, quoteDecimals: 0, baseIsToken0: true };
    // sqrtPriceX96 = sqrt(2) * 2^96, floored: 1.41421356… squared, a hair under 2.
    const sqrt2 = 112045541949572279837463876454n;
    expect(priceFromSqrtPriceX96(sqrt2, tokens)).toBe("2");
    expect(priceFromSqrtPriceX96(sqrt2, tokens, { fractionDigits: 40 })).toMatch(/^1\.9999999/);
    expect(priceFromSqrtPriceX96(Q96 + Q96 / 2n, tokens, { fractionDigits: 1 })).toBe("2.3");
    expect(priceFromSqrtPriceX96(Q96 + Q96 / 2n, tokens, { fractionDigits: 0 })).toBe("2");
  });

  it("is the inverse of sqrtPriceX96FromPrice across the whole range a pool holds", () => {
    const tokens: PoolPriceTokens = { baseDecimals: 18, quoteDecimals: 18, baseIsToken0: true };
    for (const sqrt of [
      MIN_SQRT_PRICE_X96 + 1n,
      Q96,
      MAX_SQRT_PRICE_X96 - 1n,
      3068493539683605256287027n,
    ]) {
      const price = priceFromSqrtPriceX96(sqrt, tokens, { fractionDigits: 60 });
      const back = sqrtPriceX96FromPrice(price, tokens);
      // Rounding the price to 60 places moves the square root by at most one unit either way.
      expect(back >= sqrt - 1n && back <= sqrt + 1n).toBe(true);
    }
    expect(() => priceFromSqrtPriceX96(0n, tokens)).toThrow(RangeError);
  });
});

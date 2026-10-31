/**
 * `sauce units`: an amount in whole tokens and in the smallest unit, read from the chain's own
 * token registry, and the amounts and tokens it refuses rather than rounds or guesses.
 */
import { requireChain } from "../src/chains/canonical.js";
import { UsageError } from "../src/cli/args.js";
import { unitsCommand } from "../src/cli/units.js";

const base = requireChain("base");
const solana = requireChain("solana");

describe("sauce units", () => {
  it("turns whole tokens into the smallest unit, by symbol in any case", () => {
    const out = unitsCommand({ chain: base, amount: "1.5", token: "usdc", base: false });
    expect(out.json).toMatchObject({
      token: "USDC",
      decimals: 6,
      amount: "1.5",
      baseUnits: "1500000",
    });
    expect(out.text).toContain("For --args: 1500000");
  });

  it("reads the smallest unit back as whole tokens", () => {
    const out = unitsCommand({ chain: base, amount: "1500000", token: "USDC", base: true });
    expect(out.json).toMatchObject({ amount: "1.5", baseUnits: "1500000" });
  });

  it("uses the chain's decimals: WETH 18 on Base, WSOL 9 on Solana", () => {
    expect(
      unitsCommand({ chain: base, amount: "1", token: "WETH", base: false }).json,
    ).toMatchObject({ baseUnits: "1000000000000000000" });
    expect(
      unitsCommand({ chain: solana, amount: "0.25", token: "WSOL", base: false }).json,
    ).toMatchObject({
      baseUnits: "250000000",
      address: "So11111111111111111111111111111111111111112",
    });
  });

  it("takes any token by address with --decimals", () => {
    const out = unitsCommand({
      chain: base,
      amount: "2",
      token: "0x0000000000000000000000000000000000000001",
      base: false,
      decimals: 8,
    });
    expect(out.json).toMatchObject({ decimals: 8, baseUnits: "200000000" });
  });

  it("refuses what it would have to round or guess", () => {
    expect(() =>
      unitsCommand({ chain: base, amount: "1.2345678", token: "USDC", base: false }),
    ).toThrow(/7 decimal places; USDC has 6/);
    expect(() => unitsCommand({ chain: base, amount: "1.5", token: "USDC", base: true })).toThrow(
      UsageError,
    );
    expect(() => unitsCommand({ chain: base, amount: "1", token: "NOPE", base: false })).toThrow(
      /has no token NOPE/,
    );
    expect(() =>
      unitsCommand({ chain: base, amount: "1", token: "USDC", base: false, decimals: 18 }),
    ).toThrow(/USDC on base has 6/);
  });
});

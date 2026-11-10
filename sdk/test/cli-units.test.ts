/**
 * `sauce units`: an amount in whole tokens and in the smallest unit, read from the chain's own
 * token registry, and the amounts and tokens it refuses rather than rounds or guesses.
 */
import { requireChain } from "../src/chains/canonical.js";
import { UsageError } from "../src/cli/args.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { findToken, unitsCommand } from "../src/cli/units.js";
import type { SourceToken } from "../src/routes/source-globals.js";

const base = requireChain("base");
const solana = requireChain("solana");

describe("sauce units", () => {
  it("turns whole tokens into the smallest unit, by symbol in any case", () => {
    const out = unitsCommand({ chain: base, amount: "1.5", token: "usdc" });
    expect(out.json).toMatchObject({
      token: "USDC",
      decimals: 6,
      amount: "1.5",
      baseUnits: "1500000",
    });
    expect(out.text).toContain("For --args: 1500000");
  });

  it("reads base units ending in n back as whole tokens, as --fund writes them", () => {
    const out = unitsCommand({ chain: base, amount: "1500000n", token: "USDC" });
    expect(out.json).toMatchObject({ amount: "1.5", baseUnits: "1500000" });
    expect(out.text).toContain("Whole tokens: 1.5");
    expect(out.notes).toBeUndefined();
  });

  it("notes a bare integer at or above 10^decimals, the note --fund gives", () => {
    const out = unitsCommand({ chain: base, amount: "1500000", token: "USDC" });
    expect(out.json).toMatchObject({ amount: "1500000", baseUnits: "1500000000000" });
    expect(out.notes).toEqual([
      "1500000 USDC: that is 1.5 million USDC; for base units write 1500000n",
    ]);
    expect(out.json.note).toBe(out.notes?.[0]);
    for (const amount of ["999999", "1.5", "1000000.5"]) {
      expect(unitsCommand({ chain: base, amount, token: "USDC" }).notes).toBeUndefined();
    }
    expect(unitsCommand({ chain: base, amount: "1000000", token: "USDC" }).notes).toHaveLength(1);
  });

  it("uses the chain's decimals: WETH 18 on Base, WSOL 9 on Solana", () => {
    expect(unitsCommand({ chain: base, amount: "1", token: "WETH" }).json).toMatchObject({
      baseUnits: "1000000000000000000",
    });
    expect(unitsCommand({ chain: solana, amount: "0.25", token: "WSOL" }).json).toMatchObject({
      baseUnits: "250000000",
      address: "So11111111111111111111111111111111111111112",
    });
  });

  it("takes any token by address with --decimals", () => {
    const out = unitsCommand({
      chain: base,
      amount: "2",
      token: "0x0000000000000000000000000000000000000001",
      decimals: 8,
    });
    expect(out.json).toMatchObject({
      address: "0x0000000000000000000000000000000000000001",
      decimals: 8,
      baseUnits: "200000000",
    });
    const mint = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    expect(
      unitsCommand({ chain: solana, amount: "1", token: mint, decimals: 6 }).json,
    ).toMatchObject({ address: mint, decimals: 6, baseUnits: "1000000" });
  });

  it("takes --decimals only with an address or mint, so a misspelled symbol is still refused", () => {
    for (const token of ["USCD", "0x123", "0x00000000000000000000000000000000000000zz"]) {
      expect(() => unitsCommand({ chain: base, amount: "1", token, decimals: 6 })).toThrow(
        /--decimals requires a token address or mint, not a symbol/,
      );
    }
    for (const token of ["WSLO", "0x0000000000000000000000000000000000000001"]) {
      expect(() => unitsCommand({ chain: solana, amount: "1", token, decimals: 9 })).toThrow(
        /--decimals requires a token address or mint, not a symbol/,
      );
    }
    expect(() => unitsCommand({ chain: base, amount: "1", token: "USCD" })).toThrow(
      /has no token USCD.*: give its address with --decimals <n>/,
    );
  });

  it("asks for --decimals, not an address, when an address the registry lacks has none", () => {
    expect(() =>
      unitsCommand({
        chain: base,
        amount: "1",
        token: "0x0000000000000000000000000000000000000001",
      }),
    ).toThrow(
      "Base has no token 0x0000000000000000000000000000000000000001 in its registry: pass " +
        "--decimals <n> for a token the registry doesn't have",
    );
    expect(() =>
      unitsCommand({
        chain: solana,
        amount: "1",
        token: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      }),
    ).toThrow(/in its registry: pass --decimals <n>/);
  });

  it("refuses an amount larger than the chain's token amounts hold", () => {
    const uint256Max = 2n ** 256n - 1n;
    expect(
      unitsCommand({ chain: base, amount: `${uint256Max}n`, token: "USDC" }).json,
    ).toMatchObject({ baseUnits: uint256Max.toString() });
    expect(() =>
      unitsCommand({ chain: base, amount: `${uint256Max + 1n}n`, token: "USDC" }),
    ).toThrow(/more than a uint256 holds/);
    expect(() => unitsCommand({ chain: base, amount: `${uint256Max}`, token: "USDC" })).toThrow(
      /more than a uint256 holds/,
    );
    const u64Max = 2n ** 64n - 1n;
    expect(unitsCommand({ chain: solana, amount: `${u64Max}n`, token: "WSOL" }).json).toMatchObject(
      { baseUnits: u64Max.toString() },
    );
    expect(() => unitsCommand({ chain: solana, amount: `${u64Max + 1n}n`, token: "WSOL" })).toThrow(
      /more than a u64 holds/,
    );
  });

  it("refuses what it would have to round or guess", () => {
    expect(() => unitsCommand({ chain: base, amount: "1.2345678", token: "USDC" })).toThrow(
      /7 decimal places; USDC has 6/,
    );
    expect(() => unitsCommand({ chain: base, amount: "1.5n", token: "USDC" })).toThrow(UsageError);
    expect(() => unitsCommand({ chain: base, amount: "1", token: "NOPE" })).toThrow(
      /has no token NOPE/,
    );
    expect(() => unitsCommand({ chain: base, amount: "1", token: "USDC", decimals: 18 })).toThrow(
      /USDC on base has 6/,
    );
  });

  it("refuses a malformed amount rather than reading it as another number", () => {
    for (const amount of ["1,5", "1,,5", "1.2,3", "1_000", "-1", "1e6", ".5", "1.", ""]) {
      expect(() => unitsCommand({ chain: base, amount, token: "USDC" })).toThrow(
        /is not an amount/,
      );
    }
    for (const amount of ["1,500,000n", "1_500_000n", "-1n", "1e6n", "1.5n", "n", "1500000N"]) {
      expect(() => unitsCommand({ chain: base, amount, token: "USDC" })).toThrow(
        /is not an amount/,
      );
    }
  });

  it("refuses a symbol that matches two tokens in different cases, unless the case is exact", () => {
    const tokens: SourceToken[] = [
      { symbol: "uSDC", address: "0x0000000000000000000000000000000000000001", decimals: 6 },
      { symbol: "Usdc", address: "0x0000000000000000000000000000000000000002", decimals: 18 },
    ];
    expect(() => findToken(tokens, "USDC", "Base")).toThrow(UsageError);
    expect(() => findToken(tokens, "USDC", "Base")).toThrow(
      /2 tokens named USDC in different cases/,
    );
    expect(findToken(tokens, "Usdc", "Base")?.decimals).toBe(18);
    expect(findToken(tokens, "0x0000000000000000000000000000000000000001", "Base")?.symbol).toBe(
      "uSDC",
    );
  });
});

describe("sauce units from the command line", () => {
  async function sauce(
    ...argv: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      canAsk: () => false,
      confirm: async () => undefined,
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };
    const code = await runCli(["--no-update-check", ...argv], io);

    return { code, stdout, stderr };
  }

  it("takes exactly the amount and the token", async () => {
    for (const positionals of [["1.5"], ["1.5", "USDC", "extra"]]) {
      const run = await sauce("units", "--chain", "base", ...positionals);
      expect(run.code).not.toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("give the amount and the token");
    }
  });

  it("refuses --decimals that is not a number of decimals", async () => {
    for (const decimals of ["six", "1.5", "100"]) {
      const run = await sauce(
        "units",
        "--chain",
        "base",
        "1",
        "0x0000000000000000000000000000000000000001",
        "--decimals",
        decimals,
      );
      expect(run.code).not.toBe(0);
      expect(run.stderr).toContain(`--decimals: ${decimals} is not a number of decimals`);
    }
  });

  it("prints JSON on stdout and the note on stderr under --json", async () => {
    const run = await sauce("units", "--chain", "base", "1500000", "USDC", "--json");
    expect(run.code).toBe(0);
    const json = JSON.parse(run.stdout) as Record<string, unknown>;
    const note = "1500000 USDC: that is 1.5 million USDC; for base units write 1500000n";
    expect(json).toMatchObject({ token: "USDC", baseUnits: "1500000000000", note });
    expect(run.stderr).toContain(note);
  });
});

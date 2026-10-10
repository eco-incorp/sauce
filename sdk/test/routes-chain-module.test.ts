/**
 * A compile's modules (`src/routes/chain-module.ts`): the names module, one text for every chain of a
 * target, written once and kept; and a level module per program, where its intents open, which is
 * the compile's own and differs between compiles only in its salt.
 */
import { requireChain } from "../src/chains/canonical.js";
import {
  chainModuleSource,
  forgetChainModules,
  levelModuleSource,
} from "../src/routes/chain-module.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const SALT_A = `0x${"5a".repeat(32)}`;
const SALT_B = `0x${"a5".repeat(32)}`;

/** The branch of a level module that opens a hop to the chain whose id is `id`. */
const hopTo = (module: string, id: number): string =>
  new RegExp(`if \\(id == ${id}\\) \\{ ([^}]*(?:\\{[^}]*\\}[^}]*)*) \\}`).exec(module)![1]!;

describe("the names module", () => {
  it("is one text for every chain of a target, written afresh or kept", () => {
    forgetChainModules();
    const base = chainModuleSource(requireChain("base"), {});
    expect(chainModuleSource(requireChain("ethereum"), {})).toBe(base);
    expect(chainModuleSource(requireChain("arbitrum"), {})).toBe(base);
    forgetChainModules();
    expect(chainModuleSource(requireChain("base"), {})).toBe(base);
    const solana = chainModuleSource(requireChain("solana"), {});
    expect(solana).not.toBe(base);
  });

  it("declares the same names on both targets", () => {
    const exported = (text: string) =>
      [...text.matchAll(/^export const (\w+) =/gm)].map(([, name]) => name).sort();
    const evm = exported(chainModuleSource(requireChain("base"), {}));
    const svm = exported(chainModuleSource(requireChain("solana"), {}));
    // `Token(address)` is the EVM's alone.
    expect(evm.filter((name) => name !== "Token")).toEqual(svm);
  });

  it("chooses a compile's own values for its chain alone", () => {
    const tokens = { USDT: "0x2222222222222222222222222222222222222222" } as const;
    const own = chainModuleSource(requireChain("base"), { tokens });
    expect(own).not.toBe(chainModuleSource(requireChain("base"), {}));
    expect(own).toMatch(/== 8453 \? new TokenOf\("USDT", 0x2222/);
  });

  it("says what a namespace is once, in its class", () => {
    const module = chainModuleSource(requireChain("base"), {});
    expect(module.split("'UniswapV3' has Factory,").length - 1).toBe(1);
    expect(() =>
      compileSauceProgram("base", "function main(): Uint256 { return Optimism.Abracadabra + 1; }"),
    ).toThrow("'Abracadabra' is abracadabra.DegenBox, which this chain has no deployment of");
  });
});

describe("a level module", () => {
  it.each(["base", "ethereum", "solana"])(
    "on %s differs between compiles only in its salt",
    (slug) => {
      const chain = requireChain(slug);
      const a = levelModuleSource(chain, {}, SALT_A);
      expect(levelModuleSource(chain, {}, SALT_A)).toBe(a);
      expect(levelModuleSource(chain, {}, SALT_B).replaceAll(SALT_B, SALT_A)).toBe(a);
    },
  );

  it("takes a destination's facts from the intent defaults, and reads a fee given as a function each time", () => {
    const base = requireChain("base");
    const fee = (amount: bigint) => ({ intents: { executionFee: amount } });
    expect(hopTo(levelModuleSource(base, fee(7n), SALT_A), 1)).toContain("fee: 7,");
    expect(hopTo(levelModuleSource(base, fee(9n), SALT_A), 1)).toContain("fee: 9,");
    let read = 11n;
    const asked = { intents: { executionFee: () => read } };
    expect(hopTo(levelModuleSource(base, asked, SALT_A), 1)).toContain("fee: 11,");
    read = 12n;
    expect(hopTo(levelModuleSource(base, asked, SALT_A), 1)).toContain("fee: 12,");
  });

  it("holds no token table: a hop reads the destination's token by its name there", () => {
    const fromBase = hopTo(levelModuleSource(requireChain("base"), {}, SALT_A), 1);
    expect(fromBase).not.toMatch(/\btokens: /);
    expect(fromBase).not.toMatch(/\bUSDC: 0x/);
  });

  it("on Solana opens no intent, and says why", () => {
    expect(levelModuleSource(requireChain("solana"), {}, SALT_A)).toContain(
      "a program on solana opens no intent",
    );
  });
});

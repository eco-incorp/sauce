/**
 * Opening an intent is coming soon (`routes/coming-soon.ts`): every place that used to open one
 * refuses in one sentence, and nothing else changes.
 *
 * - a program's source, `<Chain>.hop(…)` or the earlier `<Chain>(…)`, through every compile entry;
 * - `sauce intent publish`, whatever it is given (the MCP tool is `mcp/test/intents.test.ts`'s);
 * - TypeScript: a chain export's call and `.route`, `routes.openRoute(…)` (the actions package's
 *   `programIntent(…)` is `actions/tests/coming-soon.unit.test.ts`'s).
 *
 * A program that names a chain's contracts, `Ethereum.UniswapV3.Factory`, is untouched: the check
 * never rewrites, and a source with no chain called is never parsed for it.
 */
import { Base, Ethereum, IntentsComingSoonError } from "../src/index.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { HOP_SYNTAX, intentsComingSoon, refuseIntentSyntax } from "../src/routes/coming-soon.js";
import { chain, compileSauceProgram, compileSauceRoute, openRoute } from "../src/routes/index.js";
import { chainAccessorNames } from "../src/routes/sauce-route.js";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const POT = "0x2222222222222222222222222222222222222222";
const ENGINE = "0x3333333333333333333333333333333333333333";

/** Every refusal's words but its site and its "until then". */
const SHARED = (site: string): string =>
  `${site}: opening an intent is coming soon. It will be written ${HOP_SYNTAX}; until then, `;

const HOP = [
  "function main(recipient: Address, refundTo: Address, amount: Uint256) {",
  "  Ethereum.hop({",
  "    send: { token: USDC, amount },",
  "    receive: { token: USDC, amount },",
  "    refundee: refundTo,",
  "  }).then(() => {",
  "    USDC.transfer(recipient, amount);",
  "  });",
  "}",
  "",
].join("\n");

const EARLIER = [
  "function main(recipient: Address, amount: Uint256) {",
  "  Arbitrum(() => {",
  "    USDC.transfer(recipient, amount);",
  "  }).reward({ tokens: [{ token: USDC, amount }] });",
  "}",
  "",
].join("\n");

/** What `compile` threw, as `IntentsComingSoonError`. */
function refusal(compile: () => unknown): IntentsComingSoonError {
  try {
    compile();
  } catch (error) {
    expect(error).toBeInstanceOf(IntentsComingSoonError);
    return error as IntentsComingSoonError;
  }
  throw new Error("compiled");
}

describe("a program that opens an intent", () => {
  it("<Chain>.hop(…) is refused at its line, by a program compile, on every kind of chain", () => {
    for (const on of ["base", "ethereum", "solana"]) {
      const error = refusal(() => compileSauceProgram(on, HOP));
      expect(error.site).toBe("`Ethereum.hop(…)` at line 2");
      expect(error.code).toBe("intents-coming-soon");
      expect(error.message).toBe(
        intentsComingSoon(
          "`Ethereum.hop(…)` at line 2",
          "an intent that already exists can be filled, proven, claimed, refunded and cancelled",
        ),
      );
      expect(error.message.startsWith(SHARED(error.site))).toBe(true);
    }
  });

  it("the earlier <Chain>(() => { … }) is refused the same way", () => {
    expect(refusal(() => compileSauceProgram("base", EARLIER)).site).toBe(
      "`Arbitrum(…)` at line 2",
    );
  });

  it("a script, a route body and a program given main's arguments are refused at the line written", () => {
    const script =
      "\n\nBase.hop({ send: { token: USDC, amount: 1 }, refundee: ctx.self() }).then(() => {});\n";
    expect(refusal(() => compileSauceProgram("ethereum", script)).site).toBe(
      "`Base.hop(…)` at line 3",
    );
    expect(
      refusal(() => compileSauceRoute("base", script, { pot: POT, engine: ENGINE }, { tokens: {} }))
        .site,
    ).toBe("`Base.hop(…)` at line 3");
    expect(
      refusal(() => compileSauceProgram("base", HOP, { args: [RECIPIENT, RECIPIENT, 5n] })).site,
    ).toBe("`Ethereum.hop(…)` at line 2");
  });

  it("a name the program binds itself is its own, and a comment is no call", () => {
    const names = chainAccessorNames();
    expect(() =>
      refuseIntentSyntax(
        "function Base(x: Uint256): Uint256 { return x; }\nfunction main() { Base(1); }\n",
        names,
      ),
    ).not.toThrow();
    expect(() =>
      refuseIntentSyntax("function main(Ethereum: Address) { Ethereum.hop(1); }\n", names),
    ).not.toThrow();
    // A source the parser refuses is the compiler's to report.
    expect(() => refuseIntentSyntax("Base( {{", names)).not.toThrow();
    const commented = [
      "// Ethereum(() => { … }) once opened an intent here; Base.hop( will.",
      "function main(to: Address, amount: Uint256) {",
      "  USDC.transfer(to, amount);",
      "}",
      "",
    ].join("\n");
    expect(compileSauceProgram("base", commented).bytecode.length).toBeGreaterThan(0);
  });

  it("a program that names a chain's contracts compiles as written: the check rewrites nothing", () => {
    const qualified = [
      "function main(): Address {",
      "  const pool = Ethereum.UniswapV3.Factory.getPool(USDC, WETH, 500);",
      '  require(pool != Base.UniswapV3.Factory, "same");',
      "  return pool;",
      "}",
      "",
    ].join("\n");
    expect(() => refuseIntentSyntax(qualified, chainAccessorNames())).not.toThrow();
    for (const on of ["base", "ethereum"]) {
      const program = compileSauceProgram(on, qualified);
      expect(program.bytecode.length).toBeGreaterThan(0);
      expect(program.source).not.toContain("hop");
    }
    // Solana's own accounts are member calls of another name, and stay what they were.
    expect(() =>
      refuseIntentSyntax(
        "function main() { const p = Solana.pda(ctx.self()); }\n",
        chainAccessorNames(),
      ),
    ).not.toThrow();
  });
});

describe("TypeScript's entry points", () => {
  const TS_TODAY =
    "the routes Portal helpers act on intents that already exist (`intentFromPublished`, " +
    "`fulfillTx`, `proveTx`, `withdrawTx`, `refundTx`, `cancelTx`)";

  it("a chain's call, its .route, chain(ref)'s and openRoute refuse, each naming itself", () => {
    const calls: Array<readonly [string, () => unknown]> = [
      ["`Base(…)`", () => Base("function main() {}", {})],
      ["`Ethereum.route(…)`", () => Ethereum.route("function main() {}")],
      ["`Optimism(…)`", () => chain("optimism")()],
      ["`routes.openRoute(…)`", () => openRoute("base", "function main() {}", {})],
    ];
    for (const [site, call] of calls) {
      const error = refusal(call);
      expect(error.site).toBe(site);
      expect(error.message).toBe(`${SHARED(site)}${TS_TODAY}.`);
    }
  });

  it("the namespace is what it was: .chain, the contract tree and the tokens", () => {
    expect(Base.chain.slug).toBe("base");
    expect(Base.UniswapV3.Factory.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(Base.USDC.symbol).toBe("USDC");
  });
});

describe("sauce intent publish", () => {
  async function sauce(
    ...argv: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };
    const code = await runCli(argv, io);

    return { code, stdout, stderr };
  }

  const CLI = `${SHARED("sauce intent publish")}\`sauce intent\` acts on intents that already exist: import, status, fill, prove, claim, refund and cancel.\n`;

  it("refuses with no arguments, and with a command line written for what it did, exiting 1", async () => {
    for (const argv of [
      [],
      ["bridge.sauce.ts", "--chain", "ethereum", "--intent-deadline", "2000000000"],
      ["--source", "ethereum", "--destination", "base", "--private-key", "0x01"],
      ["--json"],
    ]) {
      const run = await sauce("intent", "publish", ...argv);
      expect(run.code).toBe(1);
      expect(run.stderr).toBe(CLI);
      expect(run.stdout).toBe("");
    }
  });

  it("--help says it is coming soon, and the verbs list it so", async () => {
    const help = await sauce("intent", "publish", "--help");
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Coming soon: open an intent, from a program");
    expect(help.stdout).toContain(HOP_SYNTAX);
    const verbs = await sauce("intent", "--help");
    expect(verbs.stdout).toMatch(/^ {2}publish +Coming soon: open an intent, from a program$/m);
  });

  it("a program compiled by the command meets the same refusal", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const work = mkdtempSync(join(tmpdir(), "sauce-coming-soon-"));
    try {
      const file = join(work, "hop.sauce.ts");
      writeFileSync(file, HOP);
      const run = await sauce("compile", file, "--chain", "base");
      expect(run.code).toBe(1);
      expect(run.stderr).toContain(`${SHARED("`Ethereum.hop(…)` at line 2")}an intent that`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

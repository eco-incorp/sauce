/**
 * ERC20 token member rewrite — a symbol write `USDC.transfer(to, amount)` -> `@sauce/token`'s
 * SafeERC20 `transfer(USDC, to, amount)` (imported as `__sauce_transfer`), the read
 * `USDC.balanceOf(x)` -> `IERC20.at(USDC).balanceOf(x)`, plus the balance sugar `pot.USDC` ->
 * `IERC20.at(USDC).balanceOf(ctx.self())`, the same read, and `<holder>.balance`, the native coin.
 */
import { compileProgram as compile, SDK_SOURCE_DIRS } from "./helpers";
import type { Abi } from "viem";
import { requireChain } from "../src/chains/canonical.js";
import { getDescriptor } from "../src/descriptors/query.js";
// Through the public `routes` barrel: a caller of `rewriteTokenMembers` needs `tokenImportLines`
// beside it to compile the result.
import { rewriteTokenMembers, tokenImportLines } from "../src/routes/index.js";
import {
  registryTokenAddress,
  resolveTokenMap,
  SVM_TOKEN_REGISTRY,
} from "../src/routes/token-registry.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";

// Base USDC -- pinned fixture, matching src/verify/vectors.ts's own Base USDC constant.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const TO = "0x6666666666666666666666666666666666666666" as const;

/** The same write, spelled as a direct `@sauce/token` call against a literal token address. */
function libraryProgram(token: string, write: string, args: string): number[] {
  const compiled = compileSauceRoute(
    "base",
    `import { ${write} } from "@sauce/token";\nfunction main() { ${write}(${token}, ${args}); }`,
    { pot: POT, engine: ENGINE },
  );
  return Array.from(compiled.compiled.bytecode[0]!);
}

describe("rewriteTokenMembers", () => {
  it("USDC.transfer(to, amount) lowers to @sauce/token's transfer(USDC, to, amount)", () => {
    const source = `function main() { USDC.transfer(${TO}, 5n); }`;
    const result = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(result.rewrote).toBe(true);
    expect(result.source).toBe(`function main() { __sauce_transfer(USDC, ${TO}, 5n); }`);
    expect([...result.writes]).toEqual(["transfer"]);
    expect(result.erc20).toBe(false);
    expect(tokenImportLines(result)).toEqual([
      'import { transfer as __sauce_transfer } from "@sauce/token";',
    ]);
  });

  it.each([
    ["transfer", `${TO}, 5n`],
    ["approve", `${TO}, 5n`],
    ["transferFrom", `${TO}, ${TO}, 5n`],
  ])("USDC.%s compiles to the same bytes as the direct @sauce/token call", (write, args) => {
    const compiled = compileSauceRoute("base", `USDC.${write}(${args});`, {
      pot: POT,
      engine: ENGINE,
    });
    expect(Array.from(compiled.compiled.bytecode[0]!)).toEqual(libraryProgram(USDC, write, args));
  });

  it("a write whose result is read is refused: SafeERC20 returns nothing", () => {
    expect(() =>
      rewriteTokenMembers(
        `function main() { const ok = USDC.approve(${TO}, 5n); }`,
        new Set(["USDC"]),
      ),
    ).toThrow(/`USDC\.approve\(\.\.\.\)` returns nothing/);
  });

  it("a write with the wrong arguments is refused in the terms it was written", () => {
    expect(() =>
      rewriteTokenMembers(`function main() { USDC.transferFrom(${TO}, 5n); }`, new Set(["USDC"])),
    ).toThrow(/`USDC\.transferFrom\(\.\.\.\)` takes 3 arguments \(from, to, amount\), got 2/);
  });

  it("a user's own `transfer` is untouched and does not collide with the lowering", () => {
    const source = `function transfer(a) { return a; }\nfunction main() { USDC.transfer(${TO}, transfer(5n)); }`;
    const { source: out } = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(out).toContain("function transfer(a) { return a; }");
    expect(out).toContain(`__sauce_transfer(USDC, ${TO}, transfer(5n))`);
    const compiled = compileSauceRoute("base", source, { pot: POT, engine: ENGINE });
    expect(compiled.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("a program declaring the reserved import name is refused, by name", () => {
    expect(() =>
      rewriteTokenMembers(
        `function main() { const __sauce_transfer = 1n; USDC.transfer(${TO}, 5n); }`,
        new Set(["USDC"]),
      ),
    ).toThrow(/`__sauce_transfer` is reserved/);
  });

  it("an explicit IERC20.at(x).transfer(...) is the raw ABI call and is left alone", () => {
    const source = `function main() { IERC20.at(USDC).transfer(${TO}, 5n); }`;
    expect(rewriteTokenMembers(source, new Set(["USDC"])).rewrote).toBe(false);
  });

  it("a local `let USDC = 1n;` suppresses the rewrite", () => {
    const source = `function main() { let USDC = 1n; USDC.transfer(${TO}, 5n); }`;
    const { rewrote } = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(rewrote).toBe(false);
  });

  it("an unknown symbol is left untouched", () => {
    const source = `function main() { NOTATOKEN.transfer(${TO}, 5n); }`;
    const { source: out, rewrote } = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("balanceOf in expression position stays on the typed binding", () => {
    const source = `function main() { return USDC.balanceOf(${TO}); }`;
    const result = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(result.rewrote).toBe(true);
    expect(result.source).toContain(`IERC20.at(USDC).balanceOf(${TO})`);
    expect(result.erc20).toBe(true);
    expect(result.writes.size).toBe(0);
  });

  it("no rewrite when the token symbol set is empty", () => {
    const source = `function main() { USDC.transfer(${TO}, 5n); }`;
    const { rewrote, source: out } = rewriteTokenMembers(source, new Set());
    expect(rewrote).toBe(false);
    expect(out).toBe(source);
  });

  it("one import names every write used, once, in a fixed order", () => {
    const source = `function main() { USDC.approve(${TO}, 5n); USDC.transfer(${TO}, 5n); USDC.approve(${TO}, 6n); }`;
    const result = rewriteTokenMembers(source, new Set(["USDC"]));
    expect(tokenImportLines(result)).toEqual([
      'import { transfer as __sauce_transfer, approve as __sauce_approve } from "@sauce/token";',
    ]);
  });
});

describe("compileSauceRoute: token member rewrite end to end", () => {
  it("compiles USDC.transfer(...) with options.tokens and produces one cook() call", () => {
    const built = compileSauceRoute(
      "ethereum",
      `USDC.transfer(${TO}, 5n);`,
      { pot: POT, engine: ENGINE },
      { tokens: { USDC } },
    );
    expect(built.calls).toHaveLength(1);
  });

  it("an svm destination gives a script's token write the main its accounts go to", () => {
    const key = `0x${"66".repeat(32)}`;
    // A route takes no accounts a cook derives, so the refusal names the main the script was given.
    expect(() =>
      compileSauceRoute(
        "solana",
        `USDC.transfer(${key}, 5n);`,
        { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        { tokens: { USDC } },
      ),
    ).toThrow(/add accounts to main \(.*\) that a cook derives/);
    const compiled = compileSauceProgram("solana", `USDC.transfer(${key}, 5n);`);
    expect(compiled.derivedAccounts).toMatchObject({ potUSDC: "authority:USDC", pot: "authority" });
  });
});

// --- registry default: bare USDC.transfer with NO tokenDefines at all ---------------------------

describe("THE DECISIVE STEP (b): registry default -- a bare USDC.transfer with NO tokenDefines", () => {
  it("compiles via the registry default and produces exactly one cook() call", () => {
    const built = compileSauceRoute("base", `USDC.transfer(${TO}, 5n);`, {
      pot: POT,
      engine: ENGINE,
    });
    expect(built.calls).toHaveLength(1);
  });

  it("compileSauceRoute with NO options.tokens at all rewrites via the registry and matches the literal program", () => {
    const compiled = compileSauceRoute("base", `USDC.transfer(${TO}, 5n);`, {
      pot: POT,
      engine: ENGINE,
    });
    expect(compiled.source).toContain(`__sauce_transfer(USDC, ${TO}, 5n)`);
    expect(Array.from(compiled.compiled.bytecode[0]!)).toEqual(
      libraryProgram(`${USDC}n`, "transfer", `${TO}, 5n`),
    );
  });

  it("options.tokens still OVERRIDES the registry default, per-key", () => {
    const OTHER = "0x5555555555555555555555555555555555555555" as const;
    const compiled = compileSauceRoute(
      "base",
      `USDC.transfer(${TO}, 5n);`,
      { pot: POT, engine: ENGINE },
      { tokens: { USDC: OTHER } },
    );
    const bytecode = Array.from(compiled.compiled.bytecode[0]!);
    expect(bytecode).toEqual(libraryProgram(`${OTHER}n`, "transfer", `${TO}, 5n`));
    expect(bytecode).not.toEqual(libraryProgram(`${USDC}n`, "transfer", `${TO}, 5n`));
  });

  it("an unregistered chain (no registry rows, no tokenDefines) leaves a bare USDC untouched, and the compile names it", () => {
    // The point is that the rewrite declines and the compile FAILS CLOSED rather than emitting a
    // program with an unbound symbol -- and says which name the chain does not have, at the use.
    expect(() =>
      compileSauceRoute("ronin", `USDC.transfer(${TO}, 5n);`, { pot: POT, engine: ENGINE }),
    ).toThrow(/`USDC` is not a token on ronin\.[\s\S]*--> main\.js:1:1/);
  });
});

// --- USDT0: Tether's migrated USDT, by its registry symbol -------------------------------------

describe("USDT0: Tether's token on the chains whose USDT is USDT0", () => {
  const IMPORT = 'import { IERC20 } from "./artifacts/IERC20.json";';
  const READ = `${IMPORT}\nfunction main(): Uint256 { return IERC20.at(USDT0).balanceOf(${TO}); }`;
  const route = (chain: string, source: string) =>
    compileSauceRoute(chain, source, { pot: POT, engine: ENGINE });

  it.each(["arbitrum", "polygon"])(
    "on %s, USDT0.transfer is @sauce/token's SafeERC20 transfer of the registry's USDT0",
    (slug) => {
      const usdt0 = registryTokenAddress(requireChain(slug), "USDT0")!;
      const literal = route(
        slug,
        `import { transfer } from "@sauce/token";\nfunction main() { transfer(0x${usdt0.toString(16)}n, ${TO}, 5n); }`,
      );
      const compiled = route(slug, `USDT0.transfer(${TO}, 5n);`);
      expect(compiled.source).toContain(`__sauce_transfer(USDT0, ${TO}, 5n)`);
      expect(Array.from(compiled.compiled.bytecode[0]!)).toEqual(
        Array.from(literal.compiled.bytecode[0]!),
      );
    },
  );

  it.each(["arbitrum", "polygon"])("on %s, IERC20.at(USDT0) reads the token", (slug) => {
    expect(route(slug, READ).compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("is refused by name on a chain that has none, and USDT where the token is USDT0", () => {
    expect(() => route("base", `USDT0.transfer(${TO}, 5n);`)).toThrow(
      "`USDT0` is not a token on base.",
    );
    expect(() => route("base", READ)).toThrow("`USDT0` is not a token on base.");
    expect(() => route("arbitrum", `USDT.transfer(${TO}, 5n);`)).toThrow(
      "`USDT` is not a token on arbitrum. Did you mean `USDC` or `USDT0`?",
    );
  });
});

// --- balance sugar: <holder>.<TOKEN> -> IERC20.at(<TOKEN>).balanceOf(<holder>) -------------------

describe("balance sugar: rewriteTokenMembers with the Map form", () => {
  const BASE = requireChain("base");
  const tokens = resolveTokenMap(BASE); // { USDC: <addr>n, WETH: <addr>n }

  it("pot.USDC rewrites to IERC20.at(USDC).balanceOf(ctx.self()), what USDC.balanceOf lowers to", () => {
    const source = `function main() { return pot.USDC; }`;
    const { source: out, rewrote, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(rewrote).toBe(true);
    expect(balanceSites).toBe(1);
    expect(out).toBe(`function main() { return IERC20.at(USDC).balanceOf(ctx.self()); }`);
    expect(out).toBe(
      rewriteTokenMembers(`function main() { return USDC.balanceOf(ctx.self()); }`, tokens).source,
    );
  });

  it("a hex-address-literal holder emits the EXACT address (catches the float64 round-trip)", () => {
    const holder = "0x1111111111111111111111111111111111111122";
    const source = `function main() { return ${holder}.USDC; }`;
    const { source: out, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(balanceSites).toBe(1);
    expect(out).toContain(`IERC20.at(USDC).balanceOf(${BigInt(holder).toString()}n)`);
  });

  it("an n-suffixed hex-address-literal holder is accepted identically", () => {
    const holder = "0x1111111111111111111111111111111111111122n";
    const source = `function main() { return ${holder}.USDC; }`;
    const result = rewriteTokenMembers(source, tokens);
    expect(result.balanceSites).toBe(1);
    expect(result.source).toContain(
      `IERC20.at(USDC).balanceOf(${BigInt("0x1111111111111111111111111111111111111122").toString()}n)`,
    );
  });

  it("a variable holder is dropped in verbatim", () => {
    const source = `function main() { let x = 0x1111111111111111111111111111111111111122n; return x.USDC; }`;
    const { source: out, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(balanceSites).toBe(1);
    expect(out).toContain(`IERC20.at(USDC).balanceOf(x)`);
  });

  it("a program's own `pot` is an ordinary holder: pot.USDC reads the local, as on Solana", () => {
    const source = `function main() { const pot = ctx.self(); return pot.USDC; }`;
    const { source: out, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(balanceSites).toBe(1);
    expect(out).toContain(`IERC20.at(USDC).balanceOf(pot)`);
    expect(out).not.toContain("balanceOf(ctx.self())");
  });

  it("with a declared pot, pot.USDC compiles to exactly USDC.balanceOf(pot)", () => {
    const body = (read: string) =>
      `function main(to: Address) { const pot = ctx.self(); require(to != pot); return ${read}; }`;
    const options = { pot: POT, engine: ENGINE };
    const sugar = compileSauceRoute("base", body("pot.USDC"), options);
    const method = compileSauceRoute("base", body("USDC.balanceOf(pot)"), options);
    expect(Array.from(sugar.compiled.bytecode[0]!)).toEqual(
      Array.from(method.compiled.bytecode[0]!),
    );
  });

  it("a program that declares its own `self` owns the name: self.USDC reads the local", () => {
    const body = (read: string) =>
      `function main(to: Address) { const self = ctx.self(); require(to != self); return ${read}; }`;
    const options = { pot: POT, engine: ENGINE };
    const sugar = compileSauceRoute("base", body("self.USDC"), options);
    const method = compileSauceRoute("base", body("USDC.balanceOf(self)"), options);
    expect(Array.from(sugar.compiled.bytecode[0]!)).toEqual(
      Array.from(method.compiled.bytecode[0]!),
    );
  });

  it("both spellings compile byte-identically: pot.USDC vs USDC.balanceOf(ctx.self())", () => {
    const sugarSource = `function main() { return pot.USDC; }`;
    // bare `pot` alone isn't valid SauceScript (it needs the protocol-accessor pass's OWN pot
    // sugar -> `ctx.self()`, a separate mechanism this test isn't exercising) -- spell it out
    // directly so this is an apples-to-apples comparison of the TOKEN rewrite alone.
    const u4Source = `function main() { return USDC.balanceOf(ctx.self()); }`;
    const sugar = rewriteTokenMembers(sugarSource, tokens);
    const u4 = rewriteTokenMembers(u4Source, tokens);
    expect(sugar.rewrote).toBe(true);
    expect(u4.rewrote).toBe(true);

    const sugarCompiled = compile(
      `import { IERC20 } from "./artifacts/IERC20.json";\n${sugar.source}`,
      {
        baseDirs: [...SDK_SOURCE_DIRS],
        defines: { USDC: BigInt(USDC) },
      },
    );
    const u4Compiled = compile(`import { IERC20 } from "./artifacts/IERC20.json";\n${u4.source}`, {
      baseDirs: [...SDK_SOURCE_DIRS],
      defines: { USDC: BigInt(USDC) },
    });
    expect(Array.from(sugarCompiled.bytecode[0]!)).toEqual(Array.from(u4Compiled.bytecode[0]!));
  });

  it("THE DECISIVE STEP (a): pot.USDC for a real chain reads the real Base USDC", () => {
    const compiled = compileSauceRoute("base", `function main() { return pot.USDC; }`, {
      pot: POT,
      engine: ENGINE,
    });
    expect(compiled.source).toContain(`IERC20.at(USDC).balanceOf(ctx.self())`);
    expect(Buffer.from(compiled.compiled.bytecode[0]!).toString("hex")).toContain(
      USDC.slice(2).toLowerCase(),
    );
  });

  it("chain-scoped: Base USDC != Ethereum USDC in the compiled program", () => {
    const hex = (chain: "base" | "ethereum") =>
      Buffer.from(
        compileSauceRoute(chain, `function main() { return pot.USDC; }`, {
          pot: POT,
          engine: ENGINE,
        }).compiled.bytecode[0]!,
      ).toString("hex");
    expect(hex("base")).toContain(USDC.slice(2).toLowerCase());
    expect(hex("ethereum")).not.toContain(USDC.slice(2).toLowerCase());
  });

  it("a define given for the symbol reaches both spellings alike, as `--define USDC=` does", () => {
    const other = 0x1111111111111111111111111111111111111122n;
    const program = (read: string) =>
      compileSauceProgram("base", `function main() { return ${read}; }`, {
        defines: { USDC: other },
      }).bytecode;
    const sugar = program("pot.USDC");
    expect(Array.from(sugar)).toEqual(Array.from(program("USDC.balanceOf(ctx.self())")));
    const hex = Buffer.from(sugar).toString("hex");
    expect(hex).toContain(other.toString(16));
    expect(hex).not.toContain(USDC.slice(2).toLowerCase());
  });

  describe("value-position guard: a call/lvalue shape is NOT rewritten", () => {
    const shapes = [
      `pot.USDC(1n, 2n);`,
      `pot.USDC = 1n;`,
      `pot.USDC++;`,
      `pot.USDC.transfer(${TO}, 5n);`,
      `pot.balance(1n);`,
      `pot.balance = 1n;`,
    ];
    for (const stmt of shapes) {
      it(`leaves '${stmt}' byte-for-byte untouched`, () => {
        const source = `function main() { ${stmt} }`;
        const { source: out, balanceSites } = rewriteTokenMembers(source, tokens);
        expect(balanceSites).toBe(0);
        expect(out).toBe(source);
      });
    }

    it("a destructuring-assignment target is not rewritten", () => {
      const source = `function main() { let a = 0n; [a] = [pot.USDC]; }`;
      // `pot.USDC` here is a plain array element (VALUE position, not the assignment target itself)
      // -- verifies the exclusion is scoped to the LEFT side only, not a false-positive on the whole statement.
      const { balanceSites } = rewriteTokenMembers(source, tokens);
      expect(balanceSites).toBe(1);
    });
  });

  describe("unresolvable, rejected or a token's own contract", () => {
    it("pot.NOTATOKEN (unknown symbol)", () => {
      const source = `function main() { return pot.NOTATOKEN; }`;
      const { source: out, rewrote } = rewriteTokenMembers(source, tokens);
      expect(rewrote).toBe(false);
      expect(out).toBe(source);
    });

    it("x.USDC on a chain with no USDC row", () => {
      const ronin = requireChain("ronin");
      const roninTokens = resolveTokenMap(ronin);
      expect(roninTokens.size).toBe(0);
      const source = `function main() { let x = 1n; return x.USDC; }`;
      const { rewrote } = rewriteTokenMembers(source, roninTokens);
      expect(rewrote).toBe(false);
    });

    it("a local `let USDC = 1n;` suppresses pot.USDC where it is in scope", () => {
      const source = `function main() { let USDC = 1n; return pot.USDC; }`;
      const { rewrote } = rewriteTokenMembers(source, tokens);
      expect(rewrote).toBe(false);
    });

    it("a `USDC` or `pot` another function or an inner block declares leaves this one's", () => {
      const helper =
        "function held(): Uint256 { const USDC = 1; const pot = 2; return USDC + pot; }\n";
      const { source: out } = rewriteTokenMembers(
        `${helper}function main(c: bool) { if (c) { const pot = 3; return pot; } USDC.transfer(${TO}, pot.USDC); }`,
        tokens,
      );
      expect(out).toBe(
        `${helper}function main(c: bool) { if (c) { const pot = 3; return pot; } ` +
          `__sauce_transfer(USDC, ${TO}, IERC20.at(USDC).balanceOf(ctx.self())); }`,
      );
    });

    it("a helper's own `pot` record leaves another function's `pot` the Pot, `.balance` included", () => {
      const helper =
        "function held(): Uint256 { const pot = { balance: 7 }; return pot.balance; }\n";
      const program = (body: string) => `${helper}function main(): Uint256 { return ${body}; }`;
      const native = { symbol: "ETH", chain: "base" };
      expect(rewriteTokenMembers(program("pot.USDC + pot.balance"), tokens, native).source).toBe(
        program("IERC20.at(USDC).balanceOf(ctx.self()) + ctx.selfBalance()"),
      );
      const hex = (source: string) =>
        Buffer.from(compileSauceProgram("base", source).bytecode).toString("hex");
      expect(hex(program("pot.USDC + pot.balance + held()"))).toBe(
        hex(program("USDC.balanceOf(ctx.self()) + ctx.selfBalance() + held()")),
      );
      expect(() => compileSauceProgram("base", program("pot.ETH"))).toThrow(
        "`pot.ETH`: a holder's native coin is `.balance`: write `pot.balance`.",
      );
    });

    it("USDC.WETH -- a token's own contract is a holder: the WETH the USDC contract holds", () => {
      const source = `function main() { return USDC.WETH; }`;
      const { source: out, memberSites, balanceSites } = rewriteTokenMembers(source, tokens);
      expect(memberSites).toBe(0);
      expect(balanceSites).toBe(1);
      expect(out).toBe(`function main() { return IERC20.at(WETH).balanceOf(USDC); }`);
    });

    it("Uniswap.USDC and Base.USDC -- a namespace/chain-key holder is untouched", () => {
      const source = `function main() { return Uniswap.USDC; }`;
      const { rewrote } = rewriteTokenMembers(source, tokens);
      expect(rewrote).toBe(false);
    });
  });

  describe("Set form (no addresses): both rewrites, the symbol left for the defines", () => {
    it("USDC.transfer(...) still rewrites with a bare Set", () => {
      const source = `function main() { USDC.transfer(${TO}, 5n); }`;
      const { rewrote, memberSites, balanceSites } = rewriteTokenMembers(source, new Set(["USDC"]));
      expect(rewrote).toBe(true);
      expect(memberSites).toBe(1);
      expect(balanceSites).toBe(0);
    });

    it("pot.USDC rewrites with a bare Set too: it needs the symbol, not its address", () => {
      const source = `function main() { return pot.USDC; }`;
      const { source: out, balanceSites } = rewriteTokenMembers(source, new Set(["USDC"]));
      expect(balanceSites).toBe(1);
      expect(out).toBe(`function main() { return IERC20.at(USDC).balanceOf(ctx.self()); }`);
    });
  });
});

// --- U4 + protocol-accessor composition: the swapped-order regression lock ----------------------

// --- any address-valued holder, and the native coin ----------------------------------------------

describe("the balance shorthand on any address, and the native coin", () => {
  const HOLDER = "0x6666666666666666666666666666666666666666";
  const PROGRAM = (body: string) =>
    'import { IERC20 as Pool } from "./artifacts/IERC20.json";\n' +
    "function ownerOf(id: Uint256): Address {\n  return UniswapV4.StateView.poolManager() + id;\n}\n" +
    "function main(who: Address, id: Uint256, holders: Address[], p: { to: Address; bps: Uint256 }): Uint256 {\n" +
    `  ${body}\n}\n`;
  const bytecode = (chain: "base" | "ethereum", body: string) =>
    Buffer.from(compileSauceProgram(chain, PROGRAM(body)).bytecode).toString("hex");

  // Each shorthand beside what it is short for.
  const SAME: Array<[short: string, long: string]> = [
    ["return pot.USDC;", "return USDC.balanceOf(ctx.self());"],
    ["return ctx.self().USDC;", "return USDC.balanceOf(ctx.self());"],
    ["return who.USDC;", "return USDC.balanceOf(who);"],
    [`return ${HOLDER}.WETH;`, `return WETH.balanceOf(${HOLDER});`],
    ["return UniswapV4.PoolManager.WETH;", "return WETH.balanceOf(UniswapV4.PoolManager);"],
    ["return Aave.Pool.USDC;", "return USDC.balanceOf(Aave.Pool);"],
    [
      "return UniswapV4.StateView.poolManager().USDC;",
      "return USDC.balanceOf(UniswapV4.StateView.poolManager());",
    ],
    ["return UniswapV3.Pool(who).USDC;", "return USDC.balanceOf(who);"],
    ["return UniswapV3.Pool.at(who).USDC;", "return USDC.balanceOf(who);"],
    ["return Pool.at(who).USDC;", "return USDC.balanceOf(who);"],
    [
      "const pool = Pool.at(who); return pool.USDC;",
      "const pool = Pool.at(who); return USDC.balanceOf(pool);",
    ],
    ["return ownerOf(id).USDC;", "return USDC.balanceOf(ownerOf(id));"],
    ["return holders[0].USDC;", "return USDC.balanceOf(holders[0]);"],
    ["return p.to.USDC;", "return USDC.balanceOf(p.to);"],
    ["return ownerOf(who.USDC).WETH;", "return WETH.balanceOf(ownerOf(USDC.balanceOf(who)));"],
    ["return pot;", "return ctx.self();"],
    ["return pot.balance;", "return ctx.selfBalance();"],
    ["return ctx.self().balance;", "return ctx.selfBalance();"],
    ["return who.balance;", "return ctx.balance(who);"],
    [`return ${HOLDER}.balance;`, `return ctx.balance(${HOLDER});`],
    ["return UniswapV4.PoolManager.balance;", "return ctx.balance(UniswapV4.PoolManager);"],
    [
      "return UniswapV4.StateView.poolManager().balance;",
      "return ctx.balance(UniswapV4.StateView.poolManager());",
    ],
    [
      "const manager = UniswapV4.StateView.poolManager(); return manager.balance;",
      "const manager = UniswapV4.StateView.poolManager(); return ctx.balance(manager);",
    ],
    ["return UniswapV3.Pool(who).balance;", "return ctx.balance(who);"],
    ["return Pool.at(who).balance;", "return ctx.balance(who);"],
    ["return ownerOf(id).balance;", "return ctx.balance(ownerOf(id));"],
    ["return holders[0].balance;", "return ctx.balance(holders[0]);"],
    ["return p.to.balance;", "return ctx.balance(p.to);"],
    ["const pot = who; return pot.balance;", "const pot = who; return ctx.balance(pot);"],
    [
      "const balance = 7; return pot.balance + balance;",
      "const balance = 7; return ctx.selfBalance() + balance;",
    ],
    ["return USDC.WETH;", "return WETH.balanceOf(USDC);"],
    ["return WETH.balance;", "return ctx.balance(WETH);"],
  ];
  for (const chain of ["base", "ethereum"] as const) {
    for (const [short, long] of SAME) {
      it(`on ${chain}, \`${short}\` compiles to \`${long}\``, () => {
        expect(bytecode(chain, short)).toBe(bytecode(chain, long));
      });
    }
  }

  describe("`.at`, `.view` and `.lib` unwrap only on a contract type", () => {
    // A contract whose own methods are named like the binding constructors, each returning an
    // address: on a contract already bound, `.at(who)` is that method, and its result the holder.
    const OTHER = ["at", "view", "lib"].map((name) => ({
      type: "function" as const,
      name,
      stateMutability: "view" as const,
      inputs: [{ name: "who", type: "address" }],
      outputs: [{ name: "", type: "address" }],
    }));
    const hexOf = (chain: "base" | "ethereum", body: string) =>
      Buffer.from(
        compileSauceProgram(chain, `function main(who: Address): Uint256 {\n  ${body}\n}\n`, {
          contracts: { Other: { abi: OTHER } },
        }).bytecode,
      ).toString("hex");
    const MODULES: Readonly<Record<string, string>> = {
      "./function.ts": "export function helper(who: Address): Address {\n  return who;\n}\n",
      "./constant.ts": "export const LIMIT = 5;\n",
    };
    const modulesHex = (chain: "base" | "ethereum", source: string) =>
      Buffer.from(
        compileSauceProgram(chain, source, {
          contracts: { Different: { abi: OTHER } },
          resolve: (path: string) =>
            MODULES[path] === undefined ? undefined : new TextEncoder().encode(MODULES[path]),
        }).bytecode,
      ).toString("hex");
    for (const chain of ["base", "ethereum"] as const) {
      for (const method of ["at", "view", "lib"]) {
        it(`on ${chain}, a bound contract's own \`${method}(who)\` is a call whose result holds`, () => {
          const call = `Other.at(ctx.self()).${method}(who)`;
          expect(hexOf(chain, `return ${call}.USDC;`)).toBe(
            hexOf(chain, `return USDC.balanceOf(${call});`),
          );
          expect(hexOf(chain, `return ${call}.USDC;`)).not.toBe(
            hexOf(chain, "return USDC.balanceOf(who);"),
          );
        });
      }
      it(`on ${chain}, so is one on a contract bound to a local`, () => {
        expect(hexOf(chain, "const o = Other.at(ctx.self()); return o.at(who).USDC;")).toBe(
          hexOf(chain, "const o = Other.at(ctx.self()); return USDC.balanceOf(o.at(who));"),
        );
      });
      // A name bound to a value is that value, an import of the same name shadowed by it, and an
      // import is a contract type only from an ABI: a function or a constant is not one.
      for (const [kind, line] of [
        ["function", 'import { helper as Holder } from "./function.ts";'],
        ["constant", 'import { LIMIT as Holder } from "./constant.ts";'],
      ] as const) {
        for (const method of ["at", "view", "lib"]) {
          it(`on ${chain}, a local shadowing an imported ${kind} keeps its own \`${method}(who)\``, () => {
            const program = (read: string) =>
              `${line}\nfunction main(who: Address): Uint256 {\n` +
              `  const Holder = Different.at(ctx.self());\n  return ${read};\n}\n`;
            const hex = (read: string) => modulesHex(chain, program(read));
            expect(hex(`Holder.${method}(who).USDC`)).toBe(
              hex(`USDC.balanceOf(Holder.${method}(who))`),
            );
            expect(hex(`Holder.${method}(who).USDC`)).not.toBe(hex("USDC.balanceOf(who)"));
          });
        }
      }
      it(`on ${chain}, the same local with no import keeps its call too`, () => {
        const program = (read: string) =>
          "function main(who: Address): Uint256 {\n" +
          `  const Holder = Different.at(ctx.self());\n  return ${read};\n}\n`;
        expect(modulesHex(chain, program("Holder.at(who).USDC"))).toBe(
          modulesHex(chain, program("USDC.balanceOf(Holder.at(who))")),
        );
      });
      it(`on ${chain}, an imported ABI and a caller's binding still bind to the address`, () => {
        const imported = (read: string) =>
          'import { IERC20 as Pool } from "./artifacts/IERC20.json";\n' +
          `function main(who: Address): Uint256 {\n  return ${read};\n}\n`;
        expect(modulesHex(chain, imported("Pool.at(who).USDC"))).toBe(
          modulesHex(chain, imported("USDC.balanceOf(who)")),
        );
        const caller = (read: string) =>
          `function main(who: Address): Uint256 {\n  return ${read};\n}\n`;
        expect(modulesHex(chain, caller("Different.view(who).USDC"))).toBe(
          modulesHex(chain, caller("USDC.balanceOf(who)")),
        );
      });
      it(`on ${chain}, a contract type bound to an address still unwraps to it`, () => {
        expect(hexOf(chain, "return Other.at(who).USDC;")).toBe(
          hexOf(chain, "return USDC.balanceOf(who);"),
        );
        expect(hexOf(chain, "return Other.view(who).balance;")).toBe(
          hexOf(chain, "return ctx.balance(who);"),
        );
      });
    }
  });

  it("refuses what is not an address, by name", () => {
    const refusal = (body: string) => {
      try {
        compileSauceProgram("base", PROGRAM(body));
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`compiled: ${body}`);
    };
    expect(refusal("return UniswapV3.Pool.WETH;")).toBe(
      "`UniswapV3.Pool.WETH`: `UniswapV3.Pool` is an interface, with no address of its own: give it the address, `UniswapV3.Pool(<address>).WETH`.",
    );
    expect(refusal("return p.USDC;")).toBe(
      "`p.USDC`: `p` is a record, not an address, and `USDC` names a token: `<holder>.USDC` reads a holder's USDC balance, so the name is reserved for that and cannot be a field. Name the field otherwise (`usdc`), or read the balance of an address it holds (`p.<field>.USDC`).",
    );
    expect(refusal("return holders.USDC;")).toMatch(
      /^`holders\.USDC`: `holders` is a list, not an address/,
    );
    expect(refusal("return ({ USDC: 1 }).USDC;")).toMatch(/is a record, not an address/);
    expect(refusal("return UniswapV3.Pool.balance;")).toBe(
      "`UniswapV3.Pool.balance`: `UniswapV3.Pool` is an interface, with no address of its own: give it the address, `UniswapV3.Pool(<address>).balance`.",
    );
    expect(refusal('return abi.decode(hex`00`, ["Address"]).USDC;')).toMatch(/is a record/);
  });

  it("on Arc, whose native coin is USDC, pot.USDC is the token and pot.balance the coin", () => {
    const arc = (body: string) =>
      Buffer.from(
        compileSauceProgram("arc", `function main(who: Address): Uint256 { ${body} }`).bytecode,
      ).toString("hex");
    expect(arc("return pot.USDC;")).toBe(arc("return USDC.balanceOf(ctx.self());"));
    expect(arc("return who.USDC;")).toBe(arc("return USDC.balanceOf(who);"));
    expect(arc("return pot.balance;")).toBe(arc("return ctx.selfBalance();"));
    expect(arc("return who.balance;")).toBe(arc("return ctx.balance(who);"));
    expect(arc("return pot.USDC;")).not.toBe(arc("return pot.balance;"));
  });

  it("names a misspelled balance as the method form does, and leaves a record's field to the compiler", () => {
    const message = (body: string) => {
      try {
        compileSauceProgram(
          "base",
          `function main(who: Address, p: { a: Uint256 }): Uint256 { ${body} }`,
        );
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`compiled: ${body}`);
    };
    expect(message("return pot.USDCC;")).toMatch(
      /^compileSauceRoute: `USDCC` is not a token on base\. Did you mean `USDC`\? `<holder>\.<TOKEN>` reads the holder's balance of a token the chain registers, and `<holder>\.balance` its native coin/,
    );
    expect(message("return who.WETHH;")).toMatch(
      /`WETHH` is not a token on base.*Did you mean `WETH`\?/,
    );
    expect(message("return pot.balanse;")).toMatch(/Did you mean `balance`\?/);
    expect(message("return p.USDCC;")).toMatch(/`USDCC` is not a field of this tuple/);
  });
});

// --- the old spellings, refused by name -----------------------------------------------------------

describe("the Pot's old name and the native coin's old spelling are refused, naming the new", () => {
  const refusal = (chain: string, body: string) => {
    try {
      compileSauceProgram(chain, `function main(who: Address): Uint256 { ${body} }`);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error(`compiled: ${body}`);
  };
  const SELF = (site: string, instead: string) =>
    `\`${site}\`: the Pot is \`pot\`, not \`self\`: write \`${instead}\` (\`pot\` is the Pot's ` +
    "address, `pot.<TOKEN>` its balance of a token, `pot.balance` its native coin).";
  const NATIVE = (site: string, symbol: string, chain: string, instead: string) =>
    `\`${site}\`: a holder's native coin is \`.balance\`: write \`${instead}\`. \`.${symbol}\` ` +
    `is not a token on ${chain}, and \`.<SYMBOL>\` reads only a token the chain registers.`;

  it.each([
    ["return self;", SELF("self", "pot")],
    ["require(who != self); return 0;", SELF("self", "pot")],
    ["return self.USDC;", SELF("self.USDC", "pot.USDC")],
    ["return self.ETH;", SELF("self.ETH", "pot.balance")],
    ["return self.balance;", SELF("self.balance", "pot.balance")],
    ["return who.ETH;", NATIVE("who.ETH", "ETH", "base", "who.balance")],
    ["return pot.ETH;", NATIVE("pot.ETH", "ETH", "base", "pot.balance")],
    ["return ctx.self().ETH;", NATIVE("ctx.self().ETH", "ETH", "base", "pot.balance")],
    ["return WETH.ETH;", NATIVE("WETH.ETH", "ETH", "base", "WETH.balance")],
    [
      "return UniswapV4.PoolManager.ETH;",
      NATIVE("UniswapV4.PoolManager.ETH", "ETH", "base", "UniswapV4.PoolManager.balance"),
    ],
    ["const self = who; return self.ETH;", NATIVE("self.ETH", "ETH", "base", "self.balance")],
  ])("on base, `%s` is refused", (body, message) => {
    expect(refusal("base", body)).toBe(message);
  });

  it("names ctx.balance where `.balance` would read a contract call's result's field", () => {
    expect(refusal("base", "return UniswapV4.StateView.poolManager().ETH;")).toBe(
      NATIVE(
        "UniswapV4.StateView.poolManager().ETH",
        "ETH",
        "base",
        "ctx.balance(UniswapV4.StateView.poolManager())",
      ),
    );
  });

  it("refuses each chain's own native symbol", () => {
    expect(refusal("avalanche", "return who.AVAX;")).toBe(
      NATIVE("who.AVAX", "AVAX", "avalanche", "who.balance"),
    );
    expect(refusal("bsc", "return pot.BNB;")).toBe(NATIVE("pot.BNB", "BNB", "bsc", "pot.balance"));
  });

  it("refuses bare `self` with the protocol rewrite off too", () => {
    expect(() =>
      compileSauceProgram("base", "function main(): Uint256 { return self.balanceOf; }", {
        accessors: false,
      }),
    ).toThrow(SELF("self", "pot"));
  });
});

// --- a name the caller binds is the caller's ------------------------------------------------------

describe("a `pot` or `self` the caller binds is the caller's, not the Pot's", () => {
  const HOLDER = "0x6666666666666666666666666666666666666666";
  const hex = (source: string, options: Parameters<typeof compileSauceProgram>[2] = {}) =>
    Buffer.from(compileSauceProgram("base", source, options).bytecode).toString("hex");
  const served = (modules: Readonly<Record<string, string>>) => ({
    resolve: (path: string) =>
      modules[path] === undefined ? undefined : new TextEncoder().encode(modules[path]),
  });
  const main = (body: string) => `function main(): Uint256 { ${body} }`;

  it.each(["pot", "self"])("a define of `%s` is what it reads", (name) => {
    const defines = { [name]: BigInt(HOLDER) };
    expect(hex(main(`return ${name};`), { defines })).toBe(hex(main(`return ${HOLDER};`)));
  });

  it.each(["pot", "self"])(
    "a define of `%s` is the holder of its `.USDC` and `.balance`",
    (name) => {
      const defines = { [name]: BigInt(HOLDER) };
      expect(hex(main(`return ${name}.USDC;`), { defines })).toBe(
        hex(main(`return USDC.balanceOf(${HOLDER});`)),
      );
      expect(hex(main(`return ${name}.balance;`), { defines })).toBe(
        hex(main(`return ctx.balance(${HOLDER});`)),
      );
    },
  );

  it.each(["pot", "self"])("an ambient module's export `%s` is what it reads", (name) => {
    const options = {
      ambient: ["./holder.ts"],
      ...served({ "./holder.ts": `export const ${name} = ${HOLDER};` }),
    };
    expect(hex(main(`return ${name};`), options)).toBe(hex(main(`return ${HOLDER};`)));
    expect(hex(main(`return ${name}.USDC;`), options)).toBe(
      hex(main(`return USDC.balanceOf(${HOLDER});`)),
    );
    expect(hex(main(`return ${name}.balance;`), options)).toBe(
      hex(main(`return ctx.balance(${HOLDER});`)),
    );
  });

  it("an ambient package's target arm is the module read", () => {
    const options = {
      ambient: ["@caller/holder"],
      resolvePackage: (specifier: string) =>
        specifier === "@caller/holder" ? "./holder/index.js" : undefined,
      ...served({
        "./holder/index.evm.js": `export const pot = ${HOLDER};`,
        "./holder/index.js": "export const other = 1;",
      }),
    };
    expect(hex(main("return pot;"), options)).toBe(hex(main(`return ${HOLDER};`)));
  });

  it.each([
    ["a bare specifier only `resolve` serves", "holder", {}, "holder"],
    [
      "a bare specifier `resolvePackage` declines",
      "@caller/holder",
      { resolvePackage: () => undefined },
      "@caller/holder",
    ],
    ["a bare `.js` specifier, at its target arm", "holder.js", {}, "holder.evm.js"],
    ["a relative specifier written with `..`", "./sub/../holder.ts", {}, "./holder.ts"],
  ])("an ambient module found as the compiler finds it: %s", (_form, specifier, own, path) => {
    const options = {
      ambient: [specifier],
      ...own,
      ...served({ [path]: `export const pot = ${HOLDER};\nexport const self = ${HOLDER};` }),
    };
    expect(hex(main("return pot;"), options)).toBe(hex(main(`return ${HOLDER};`)));
    expect(hex(main("return self.USDC;"), options)).toBe(
      hex(main(`return USDC.balanceOf(${HOLDER});`)),
    );
  });

  it.each(["pot", "self"])("an imported `%s` is what it reads", (name) => {
    const options = served({ "./constants.js": `export const ${name} = ${HOLDER};` });
    const program = (body: string) => `import { ${name} } from "./constants.js";\n${main(body)}`;
    expect(hex(program(`return ${name};`), options)).toBe(hex(main(`return ${HOLDER};`)));
    expect(hex(program(`return ${name}.USDC;`), options)).toBe(
      hex(main(`return USDC.balanceOf(${HOLDER});`)),
    );
  });

  it.each(["pot", "self"])("a contract binding the caller names `%s` is its own", (name) => {
    const erc20: Abi = [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ];
    const program = (binding: string) =>
      `function main(token: Address, holder: Address): Uint256 { return ${binding}.at(token).balanceOf(holder); }`;
    expect(hex(program(name), { contracts: { [name]: { abi: erc20 } } })).toBe(
      hex(program("Other"), { contracts: { Other: { abi: erc20 } } }),
    );
  });

  it("the Pot's names are the Pot's where the caller binds neither", () => {
    const defines = { other: BigInt(HOLDER), balance: 5n };
    expect(hex(main("return pot;"), { defines })).toBe(hex(main("return ctx.self();")));
    expect(hex(main("return pot.USDC;"), { defines })).toBe(
      hex(main("return USDC.balanceOf(ctx.self());")),
    );
    // `.balance` is a member, which a define of `balance` is not: it reads the Pot's native coin.
    expect(hex(main("return balance + pot.balance;"), { defines })).toBe(
      hex(main("return 5 + ctx.selfBalance();")),
    );
  });

  it.each(["pot", "self"])("on Solana, a define of `%s` is what it reads", (name) => {
    const key = BigInt(`0x${"06".repeat(32)}`);
    const solana = (source: string, defines: Record<string, bigint> = {}) => {
      const compiled = compileSauceProgram("solana", source, { defines });
      return {
        bytecode: Buffer.from(compiled.bytecode).toString("hex"),
        manifest: compiled.manifest,
      };
    };
    expect(solana(`function main(): Address { return ${name}; }`, { [name]: key })).toEqual(
      solana(`function main(): Address { return ${key}; }`),
    );
  });

  it("on Solana, a bare ambient module only `resolve` serves binds `pot`", () => {
    const key = BigInt(`0x${"06".repeat(32)}`);
    const solana = (source: string, options: Parameters<typeof compileSauceProgram>[2] = {}) => {
      const compiled = compileSauceProgram("solana", source, options);
      return {
        bytecode: Buffer.from(compiled.bytecode).toString("hex"),
        manifest: compiled.manifest,
      };
    };
    expect(
      solana("function main(): Address { return pot; }", {
        ambient: ["holder"],
        ...served({ holder: `export const pot = ${key};` }),
      }),
    ).toEqual(solana(`function main(): Address { return ${key}; }`));
  });
});

// --- `.balance` keeps every meaning it had --------------------------------------------------------

describe("`.balance` is a field wherever it was one", () => {
  const BASE = requireChain("base");
  const tokens = resolveTokenMap(BASE);
  const native = { symbol: "ETH", chain: "base" };
  const untouched = (source: string) => {
    const out = rewriteTokenMembers(source, tokens, native);
    expect(out.balanceSites).toBe(0);
    expect(out.source).toBe(source);
  };
  const hex = (source: string, contracts?: Record<string, { abi: Abi }>) =>
    Buffer.from(
      compileSauceProgram("base", source, contracts === undefined ? {} : { contracts }).bytecode,
    ).toString("hex");

  it("a record literal's field", () => {
    untouched("function main(): Uint256 { const o = { balance: 5 }; return o.balance; }");
    expect(hex("function main(): Uint256 { const o = { balance: 5 }; return o.balance; }")).toBe(
      hex("function main(): Uint256 { const o = { amount: 5 }; return o.amount; }"),
    );
  });

  it("a main parameter record's field, typed inline or by an interface", () => {
    untouched("function main(order: { balance: Uint256 }): Uint256 { return order.balance; }");
    const inline = (field: string) =>
      `function main(order: { ${field}: Uint256; to: Address }): Uint256 { return order.${field}; }`;
    expect(hex(inline("balance"))).toBe(hex(inline("amount")));
    const typed = (field: string) =>
      `interface Order { ${field}: Uint256; to: Address }\n` +
      `function main(order: Order): Uint256 { return order.${field}; }`;
    untouched(typed("balance"));
    expect(hex(typed("balance"))).toBe(hex(typed("amount")));
  });

  it("a field of a list's record, and of a record returned by the program's own function", () => {
    untouched(
      "interface Leg { balance: Uint256 }\n" +
        "function main(legs: Leg[]): Uint256 { let t = 0; for (const leg of legs) { t += leg.balance; } return legs[0].balance + t; }",
    );
    untouched(
      "interface Leg { balance: Uint256 }\n" +
        "function leg(): Leg { return { balance: 1 }; }\nfunction main(): Uint256 { return leg().balance; }",
    );
  });

  it("abi.decode's result", () => {
    untouched('function main(d: bytes): Uint256 { return abi.decode(d, ["Uint256"]).balance; }');
    untouched(
      'function main(d: bytes): Uint256 { const r = abi.decode(d, ["Uint256"]); return r.balance; }',
    );
  });

  it("a record's field selected by its position", () => {
    const program = (field: string, read: string) =>
      `function main(row: { wallet: { ${field}: Uint256 }; to: Address }): Uint256 { return ${read}; }`;
    untouched(program("balance", "row[0].balance"));
    expect(hex(program("balance", "row[0].balance"))).toBe(
      hex(program("amount", "row.wallet.amount")),
    );
    // The position names a field whose type is an address: its native coin.
    expect(hex(program("balance", "row[1].balance"))).toBe(
      hex(program("balance", "ctx.balance(row.to)")),
    );
  });

  it("a list of records, and a list in a record, selected by position", () => {
    const rows = (field: string, read: string) =>
      `function main(rows: { wallet: { ${field}: Uint256 }; to: Address }[]): Uint256 { return ${read}; }`;
    untouched(rows("balance", "rows[0][0].balance"));
    expect(hex(rows("balance", "rows[0][0].balance"))).toBe(
      hex(rows("amount", "rows[0].wallet.amount")),
    );
    expect(hex(rows("balance", "rows[0][1].balance"))).toBe(
      hex(rows("balance", "ctx.balance(rows[0].to)")),
    );
    const legs = (field: string, read: string) =>
      `interface Leg { ${field}: Uint256 }\n` +
      `function main(row: { legs: Leg[] }): Uint256 { return ${read}; }`;
    untouched(legs("balance", "row[0][0].balance"));
    expect(hex(legs("balance", "row[0][0].balance"))).toBe(
      hex(legs("amount", "row.legs[0].amount")),
    );
  });

  it("an element of abi.decode's result, by its shape", () => {
    untouched(
      'function main(d: bytes): Uint256 { return abi.decode(d, ["{Uint256, Uint256}"])[0].balance; }',
    );
    untouched(
      'function main(d: bytes): Uint256 { return abi.decode(d, ["{Uint256, Uint256}[]"])[0][0].balance; }',
    );
    expect(
      hex('function main(d: bytes): Uint256 { return abi.decode(d, ["Address"])[0].balance; }'),
    ).toBe(
      hex(
        'function main(d: bytes): Uint256 { return ctx.balance(abi.decode(d, ["Address"])[0]); }',
      ),
    );
  });

  it("a destructured record's field, by its position", () => {
    const program = (field: string, read: string) =>
      `function main(row: { wallet: { ${field}: Uint256 }; to: Address }): Uint256 {\n` +
      `  const [wallet, to] = row;\n  return ${read};\n}`;
    untouched(program("balance", "wallet.balance"));
    expect(hex(program("balance", "wallet.balance"))).toBe(hex(program("amount", "wallet.amount")));
    expect(hex(program("balance", "to.balance"))).toBe(hex(program("balance", "ctx.balance(to)")));
    const skipped = (read: string) =>
      `function main(row: { to: Address; wallet: { balance: Uint256 } }): Uint256 {\n` +
      `  const [, wallet] = row;\n  return ${read};\n}`;
    untouched(skipped("wallet.balance"));
  });

  it("a destructured element of abi.decode's result, by its shape", () => {
    untouched(
      'function main(d: bytes): Uint256 { const [w, n] = abi.decode(d, ["{Uint256, Uint256}", "Uint256"]); return w.balance + n; }',
    );
    const decoded = (read: string) =>
      `function main(d: bytes): Uint256 { const [a] = abi.decode(d, ["Address"]); return ${read}; }`;
    expect(hex(decoded("a.balance"))).toBe(hex(decoded("ctx.balance(a)")));
  });

  it("an element of a contract call's result: a struct's field", () => {
    const positions = (field: string): Abi => [
      {
        type: "function",
        name: "positions",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [
          {
            name: "position",
            type: "tuple",
            components: [
              { name: field, type: "uint128" },
              { name: "other", type: "uint128" },
            ],
          },
          { name: "count", type: "uint256" },
        ],
      },
    ];
    const program = (field: string) =>
      `function main(market: Address, who: Address): Uint256 {\n` +
      `  return Book.at(market).positions(who)[0].${field};\n}\n`;
    untouched(program("balance"));
    expect(hex(program("balance"), { Book: { abi: positions("balance") } })).toBe(
      hex(program("amount"), { Book: { abi: positions("amount") } }),
    );
  });

  it("a struct a contract call returns, as Compound's userCollateral: the field", () => {
    const comet = (field: string): Abi => [
      {
        type: "function",
        name: "userCollateral",
        stateMutability: "view",
        inputs: [
          { name: "account", type: "address" },
          { name: "asset", type: "address" },
        ],
        outputs: [
          { name: field, type: "uint128" },
          { name: "_reserved", type: "uint128" },
        ],
      },
    ];
    const program = (field: string) =>
      `function main(market: Address, who: Address): Uint256 {\n` +
      `  const c = Comet.at(market);\n  const direct = c.userCollateral(who, WETH).${field};\n` +
      `  const held = c.userCollateral(who, WETH);\n  return direct + held.${field};\n}\n`;
    untouched(program("balance"));
    expect(hex(program("balance"), { Comet: { abi: comet("balance") } })).toBe(
      hex(program("amount"), { Comet: { abi: comet("amount") } }),
    );
  });

  it("a contract's own `balance()` method, and a namespace's or chain's own member", () => {
    untouched("function main(who: Address): Uint256 { return Other.at(who).balance(); }");
    untouched("function main(): Uint256 { return Aave.balance + Base.balance; }");
    const other: Abi = [
      {
        type: "function",
        name: "balance",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
      },
    ];
    expect(
      hex("function main(who: Address): Uint256 { return Other.at(who).balance(); }", {
        Other: { abi: other },
      }),
    ).not.toBe(hex("function main(who: Address): Uint256 { return ctx.balance(who); }"));
  });

  it("an imported value's member is the module's, and `.ETH` on a record is a field now", () => {
    untouched(
      'import { pool } from "./pool.sauce.ts";\nfunction main(): Uint256 { return pool.balance; }',
    );
    untouched("function main(p: { ETH: Uint256 }): Uint256 { return p.ETH; }");
  });

  it("a local named `balance` leaves `pot.balance` the Pot's coin", () => {
    const { source } = rewriteTokenMembers(
      "function main(): Uint256 { const balance = 1; return pot.balance + balance; }",
      tokens,
      native,
    );
    expect(source).toBe(
      "function main(): Uint256 { const balance = 1; return ctx.selfBalance() + balance; }",
    );
  });
});

describe("composition: token pass + the chain's names in ONE compile", () => {
  it("a body using BOTH Uniswap.UniversalRouter.execute(...) and pot.USDC compiles, the router the chain's name, ERC20 import exactly once", () => {
    const body = (router: string) =>
      `function main() { ${router}.execute("0x0a", ["0x00"], 0n); return pot.USDC; }`;
    const compiled = compileSauceRoute("base", body("Uniswap.UniversalRouter"), {
      pot: POT,
      engine: ENGINE,
    });
    // The router is the chain's names module's, which the compiler reads as written.
    expect(compiled.source).toContain("Uniswap.UniversalRouter.execute(");
    expect(compiled.source).toContain(`IERC20.at(USDC).balanceOf(ctx.self())`);
    const count = (
      compiled.source.match(/import \{ IERC20 \} from "\.\/artifacts\/IERC20\.json";/g) ?? []
    ).length;
    expect(count).toBe(1);
    const router = getDescriptor("uniswap-v4", "UniversalRouter")!;
    const bound = compileSauceRoute(
      "base",
      body(`IUniswapV4_UniversalRouter.at(${router.perChainAddress[8453]!})`),
      { pot: POT, engine: ENGINE },
      { contracts: { IUniswapV4_UniversalRouter: { abi: router.abi } } },
    );
    expect(Array.from(compiled.compiled.bytecode[0]!)).toEqual(
      Array.from(bound.compiled.bytecode[0]!),
    );
  });
});

// --- SVM: the same syntax lowers to the SVM arm, with the accounts a cook derives ---------------
// (routes-svm-token-methods.test.ts holds the lowering itself; these hold the route path to it.)

describe("svm: the token syntax on a route, whose accounts are the caller's", () => {
  it("pot.USDC lowers, and a route refuses the accounts it adds, which only a cook derives", () => {
    for (const accessors of [false, undefined]) {
      expect(() =>
        compileSauceRoute(
          "solana",
          `function main() { return pot.USDC; }`,
          { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
          accessors === undefined ? {} : { accessors },
        ),
      ).toThrow(/add accounts to main \(potUSDC, pot\) that a cook derives/);
    }
  });

  it("a bare registered symbol is the mint's key, a value the program compiles with", () => {
    const usdc = SVM_TOKEN_REGISTRY["mainnet-beta"].find((row) => row.symbol === "USDC")!;
    const compiled = compileSauceRoute(
      "solana",
      `function main(account: Account): Uint256 { return balanceOf(USDC, account); }`,
      { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
      { ambient: ["@sauce/token"] },
    );
    expect(Buffer.from(compiled.compiled.bytecode[0]!).toString("hex")).toContain(
      usdc.address.slice(2),
    );
  });

  it("a script's token write gets a main, and a 20-byte recipient is still refused by name", () => {
    expect(() =>
      compileSauceRoute(
        "solana",
        `USDC.transfer(${TO}, 5n);`,
        { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        { tokens: { USDC } },
      ),
    ).toThrow(
      /`USDC.transfer\(…\)` on Solana: the recipient must be known when the transaction is built/,
    );
    const script = compileSauceProgram("solana", "require(pot.USDC >= 5);");
    expect(script.derivedAccounts).toMatchObject({ potUSDC: "pot:USDC", pot: "pot" });
  });
});

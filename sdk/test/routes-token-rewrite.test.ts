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
import { ambientNamesOf } from "../src/routes/rs-compile.js";
import { chainAmbient } from "../src/routes/ambient.js";
import { ambientPotRefusal } from "../src/routes/pot-sugar.js";
import { POT_OWNER_ABI } from "../src/routes/pot-owner.js";

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

  it("a write through parentheses, around its method or an argument, keeps them matched", () => {
    const bytes = (call: string) =>
      Buffer.from(
        compileSauceProgram("base", `function main(to: Address, amount: Uint256) { ${call}; }`)
          .bytecode,
      ).toString("hex");
    for (const [plain, written] of [
      ["USDC.transfer(to, amount)", "(USDC.transfer)(to, amount)"],
      ["USDC.transfer(to, amount)", "((USDC.transfer))((to), (amount))"],
      ["USDC.approve(to, amount)", "USDC.approve((to), amount)"],
      ["Token(USDC).transfer(to, amount)", "(Token(USDC).transfer)((to), amount)"],
      ["Token(USDC).transfer(to, amount)", "(Token((USDC))).transfer(/* to */ (to), amount)"],
      [
        "const t = Token(USDC); t.transfer(to, amount)",
        "const t = Token(USDC); (t.transfer)((to), amount)",
      ],
    ]) {
      expect(bytes(written!)).toBe(bytes(plain!));
    }
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
    [
      "const pool = Pool.at(who); return pool.balance;",
      "const pool = Pool.at(who); return ctx.balance(pool);",
    ],
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
    [
      "return (who == 0 ? who : pot).ETH;",
      NATIVE("(who == 0 ? who : pot).ETH", "ETH", "base", "(who == 0 ? who : pot).balance"),
    ],
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

  it.each([
    "pot.owner.ETH",
    "(pot.owner as Address).ETH",
    "pot.owner!.ETH",
    "(pot.owner satisfies Address).ETH",
    "(<Address>pot.owner).ETH",
    "(pot.owner<Address>).ETH",
  ])("keeps the native-coin advice on the public owner expression in %s", (expression) => {
    const message = refusal("base", `return ${expression};`);
    expect(message).toContain("write `pot.owner.balance`");
    expect(message).not.toContain("__sauce_Pot");
  });

  it("on Arc, whose native coin is the token USDC, pot.owner.USDC is the token and pot.owner.balance the coin", () => {
    const owner = { contracts: { PotOwner: { abi: [...POT_OWNER_ABI] } } };
    const hex = (body: string, options = {}) =>
      Buffer.from(
        compileSauceProgram("arc", `function main(): Uint256 { ${body} }`, options).bytecode,
      ).toString("hex");
    expect(hex("return pot.owner.USDC;")).toBe(
      hex("return USDC.balanceOf(PotOwner.view(ctx.self()).owner());", owner),
    );
    expect(hex("return pot.owner.balance;")).toBe(
      hex("return ctx.balance(PotOwner.view(ctx.self()).owner());", owner),
    );
    expect(hex("return pot.owner.USDC;")).not.toBe(hex("return pot.owner.balance;"));
  });

  it("refuses bare `self` with the protocol rewrite off too", () => {
    expect(() =>
      compileSauceProgram("base", "function main(): Uint256 { return self.balanceOf; }", {
        accessors: false,
      }),
    ).toThrow(SELF("self", "pot"));
  });

  // A label is no read of a name: one named `pot` or `self` is a label like any other, which the
  // compiler refuses as SauceScript has none, on every chain.
  it.each(["pot", "self"])("a label named `%s` is refused as any label is", (name) => {
    const source = (label: string) =>
      `function main(): Uint256 {\n  ${label}: for (let i = 0; i < 2; i++) {\n    continue ${label};\n  }\n  return 1;\n}\n`;
    for (const chain of ["base", "solana"]) {
      let message = "";
      try {
        compileSauceProgram(chain, source(name));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("this statement is not supported in SauceScript");
      expect(() => compileSauceProgram(chain, source("outer"))).toThrow(
        "this statement is not supported in SauceScript",
      );
    }
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

  it("an ambient module's export `self` is what it reads", () => {
    const options = {
      ambient: ["./holder.ts"],
      ...served({ "./holder.ts": `export const self = ${HOLDER};` }),
    };
    expect(hex(main("return self;"), options)).toBe(hex(main(`return ${HOLDER};`)));
    expect(hex(main("return self.USDC;"), options)).toBe(
      hex(main(`return USDC.balanceOf(${HOLDER});`)),
    );
    expect(hex(main("return self.balance;"), options)).toBe(
      hex(main(`return ctx.balance(${HOLDER});`)),
    );
  });

  it("a `pot` only an ambient module exports is refused where the program reads it", () => {
    const options = {
      ambient: ["./holder.ts"],
      ...served({ "./holder.ts": `export const pot = ${HOLDER};` }),
    };
    for (const body of ["return pot;", "return pot.USDC;", "return pot.balance;"]) {
      expect(() => hex(main(`const a = 1;\n  ${body}`), options)).toThrow(
        "`pot` at line 2, column 10: an ambient module exports `pot`, and the program reads it " +
          "with no import, so it would read that module's value and not the Pot. Write " +
          '`ctx.self()` for the Pot, or import it by name (`import { pot } from "<module>"`) for ' +
          "the module's value.",
      );
    }
    // Imported by name, a define, or declared by the program: its own, as written.
    expect(hex(`import { pot } from "./holder.ts";\n${main("return pot;")}`, options)).toBe(
      hex(main(`return ${HOLDER};`)),
    );
    expect(hex(main("return pot;"), { ...options, defines: { pot: BigInt(HOLDER) } })).toBe(
      hex(main(`return ${HOLDER};`)),
    );
    expect(hex(main(`const pot = ${HOLDER};\n  return pot;`), options)).toBe(
      hex(main(`const pot = ${HOLDER};\n  return pot;`)),
    );
    // `ctx.self()` is the Pot, whatever a module exports.
    expect(hex(main("return ctx.self();"), options)).toBe(hex(main("return pot;")));
  });

  it("an ambient package's target arm is the module read", () => {
    const options = {
      ambient: ["@caller/holder"],
      resolvePackage: (specifier: string) =>
        specifier === "@caller/holder" ? "./holder/index.js" : undefined,
      ...served({
        "./holder/index.evm.js": `export const self = ${HOLDER};`,
        "./holder/index.js": "export const other = 1;",
      }),
    };
    expect(hex(main("return self;"), options)).toBe(hex(main(`return ${HOLDER};`)));
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
    expect(() => hex(main("return pot;"), options)).toThrow("an ambient module exports `pot`");
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

  it("on Solana, a bare ambient module only `resolve` serves binds `self`, and its `pot` is refused", () => {
    const key = BigInt(`0x${"06".repeat(32)}`);
    const solana = (source: string, options: Parameters<typeof compileSauceProgram>[2] = {}) => {
      const compiled = compileSauceProgram("solana", source, options);
      return {
        bytecode: Buffer.from(compiled.bytecode).toString("hex"),
        manifest: compiled.manifest,
      };
    };
    const options = {
      ambient: ["holder"],
      ...served({ holder: `export const self = ${key};\nexport const pot = ${key};` }),
    };
    expect(solana("function main(): Address { return self; }", options)).toEqual(
      solana(`function main(): Address { return ${key}; }`),
    );
    expect(() => solana("function main(): Address { return pot; }", options)).toThrow(
      "an ambient module exports `pot`",
    );
  });
});

// --- the compiler, not the SDK, finds a caller's ambient module ----------------------------------

describe.each([
  ["base", "evm", "0x6666666666666666666666666666666666666666"],
  ["solana", "svm", `0x${"06".repeat(32)}`],
])("on %s, the compiler says which `pot` an ambient module exports", (chain, arm, holder) => {
  type Options = Parameters<typeof compileSauceProgram>[2];
  /** The compile's outcome: its bytecode, manifest and accounts, or the message it is refused with. */
  const build = (
    source: string,
    options: Options = {},
  ): { bytecode: string; manifest: unknown; derivedAccounts: unknown } | { refused: string } => {
    try {
      const compiled = compileSauceProgram(chain, source, options);
      return {
        bytecode: Buffer.from(compiled.bytecode).toString("hex"),
        manifest: compiled.manifest,
        derivedAccounts: compiled.derivedAccounts,
      };
    } catch (error) {
      return { refused: (error as Error).message };
    }
  };
  const served = (modules: Readonly<Record<string, string>>) => ({
    resolve: (path: string) =>
      modules[path] === undefined ? undefined : new TextEncoder().encode(modules[path]),
  });
  const refusal = (source: string, options: Options): string => {
    const outcome = build(source, options);
    if ("refused" in outcome) return outcome.refused;
    throw new Error("the compile was not refused");
  };
  const PROGRAM = "function main(): Address { return pot; }";
  const POT = `export const pot = ${holder};`;
  const OTHER = "export const other = 7;";
  const callers = () => build(`function main(): Address { return ${holder}; }`);
  const pots = () => build(PROGRAM);
  /** The refusal of `source`'s free `pot`, which an ambient module exports: at its `return pot`. */
  const exported = (source = PROGRAM) => {
    const lines = source.slice(0, source.indexOf("return p") + "return ".length).split("\n");
    return {
      refused: ambientPotRefusal(lines.length, lines[lines.length - 1]!.length + 1).message,
    };
  };

  // Each module exports a `pot` where the compiler reads it, and the other module, which the
  // compiler does not read, exports something else; then the other way round. The first is
  // refused, a module's export standing in for the Pot, the second the Pot.
  // Every row has five columns: jest takes a test function with more parameters than its row has
  // columns for one that calls `done`.
  it.each<
    [
      string,
      string,
      ((specifier: string) => string | undefined) | undefined,
      string,
      string | undefined,
    ]
  >([
    [
      "a bare specifier with an empty subpath: `holder/` is `holder`",
      "holder/",
      (specifier) => (specifier === "holder" ? "./holder.js" : undefined),
      "./holder.js",
      "holder/",
    ],
    [
      "a package entry with no per-target arm: `.cjs`",
      "holder",
      (specifier) => (specifier === "holder" ? "./holder.cjs" : undefined),
      "./holder.cjs",
      `./holder.${arm}.cjs`,
    ],
    ["a bare specifier only `resolve` serves", "holder", undefined, "holder", undefined],
    [
      "a bare specifier `resolvePackage` declines",
      "@caller/holder",
      () => undefined,
      "@caller/holder",
      undefined,
    ],
    [
      "a package entry, at its per-target arm",
      "@caller/holder",
      (specifier) => (specifier === "@caller/holder" ? "./holder/index.js" : undefined),
      `./holder/index.${arm}.js`,
      "./holder/index.js",
    ],
    [
      "a bare `.js` specifier, at its per-target arm",
      "holder.js",
      undefined,
      `holder.${arm}.js`,
      "holder.js",
    ],
    [
      "a relative specifier, at its per-target arm",
      "./holder.js",
      undefined,
      `./holder.${arm}.js`,
      "./holder.js",
    ],
    ["a relative specifier with no arm", "./holder.js", undefined, "./holder.js", undefined],
    [
      "a relative specifier written with `..`",
      "./sub/../holder.ts",
      undefined,
      "./holder.ts",
      "./sub/holder.ts",
    ],
    [
      "a relative specifier climbing twice",
      "./a/b/../../holder.js",
      undefined,
      "./holder.js",
      "./a/holder.js",
    ],
  ])("%s", (_form, specifier, resolvePackage, read, unread) => {
    const options = (atRead: string, atUnread: string): Options => ({
      ambient: [specifier],
      ...(resolvePackage === undefined ? {} : { resolvePackage }),
      ...served({ [read]: atRead, ...(unread === undefined ? {} : { [unread]: atUnread }) }),
    });
    expect(build(PROGRAM, options(POT, OTHER))).toEqual(exported());
    expect(build(PROGRAM, options(OTHER, POT))).toEqual(pots());
  });

  it.each([
    ["stops exporting `pot`", POT, OTHER, exported, pots],
    ["starts exporting `pot`", OTHER, POT, pots, exported],
  ])(
    "one `resolve` whose module %s is asked again on the next compile",
    (_, first, then, before, after) => {
      const modules: Record<string, string> = { "./holder.js": first };
      const options: Options = { ambient: ["./holder.js"], ...served(modules) };
      expect(build(PROGRAM, options)).toEqual(before());
      modules["./holder.js"] = then;
      expect(build(PROGRAM, options)).toEqual(after());
    },
  );

  it("one compile reads a module's bytes as first served, though the resolver reuses its buffer", () => {
    // Each module written into one buffer, the bytes returned a view of it: a later module's
    // write changes an earlier one's bytes.
    const scratch = new Uint8Array(256);
    const texts: Record<string, string> = {
      "./holder.js": POT,
      "./other.js": "export const fee = 1;",
    };
    const resolve = (path: string) => {
      const text = texts[path];
      if (text === undefined) return undefined;
      return scratch.subarray(0, new TextEncoder().encodeInto(text, scratch).written);
    };
    expect(build(PROGRAM, { ambient: ["./holder.js", "./other.js"], resolve })).toEqual(exported());
  });

  // A resolver that answers one way the first time it is asked and another way after. Within one
  // compile, the probe of the names it binds and the compile read its first answer, so the program
  // is the one that answer makes: the probe's and the compile's alike. The next compile asks again.
  // `fee` makes each answer's bytecode its own.
  const FEE = "function main(x: Uint256): Address { require(x > fee); return pot; }";
  const NONE = "export const fee = 1;";
  const LATER_POT = `export const fee = 2;\n${POT}`;
  const FIRST_POT = `export const fee = 1;\n${POT}`;
  const LATER_NONE = "export const fee = 2;";
  const encode = (text: string) => new TextEncoder().encode(text);
  it.each([
    ["a module without `pot`, then with it", NONE, LATER_POT],
    ["a module with `pot`, then without it", FIRST_POT, LATER_NONE],
  ])("one compile reads a `resolve` that serves %s as it first answered", (_, first, later) => {
    const asked = new Map<string, number>();
    const resolve = (path: string) => {
      if (path !== "./holder.js") return undefined;
      const times = asked.get(path) ?? 0;
      asked.set(path, times + 1);
      return encode(times === 0 ? first : later);
    };
    const options: Options = { ambient: ["./holder.js"], resolve };
    const serving = (text: string): Options => ({
      ambient: ["./holder.js"],
      ...served({ "./holder.js": text }),
    });
    expect(build(FEE, options)).toEqual(build(FEE, serving(first)));
    expect(build(FEE, options)).toEqual(build(FEE, serving(later)));
  });

  it.each([
    ["a module without `pot`, then one with it", NONE, LATER_POT],
    ["a module with `pot`, then one without it", FIRST_POT, LATER_NONE],
  ])(
    "one compile reads a `resolvePackage` that maps to %s as it first answered",
    (_, first, later) => {
      let mapped = 0;
      const modules = served({ "./first.js": first, "./later.js": later });
      const options: Options = {
        ambient: ["holder"],
        resolvePackage: (specifier: string) =>
          specifier === "holder" ? (mapped++ === 0 ? "./first.js" : "./later.js") : undefined,
        ...modules,
      };
      const mapping = (path: string): Options => ({
        ambient: ["holder"],
        resolvePackage: (specifier: string) => (specifier === "holder" ? path : undefined),
        ...modules,
      });
      expect(build(FEE, options)).toEqual(build(FEE, mapping("./first.js")));
      expect(build(FEE, options)).toEqual(build(FEE, mapping("./later.js")));
    },
  );

  it("a resolver that throws on its second call fails the compile with its error, as it is", () => {
    const throwing = (): Options => {
      let calls = 0;
      return {
        ambient: ["./holder.js"],
        resolve: (path: string) => {
          calls += 1;
          if (calls === 2) throw new Error("the resolver failed on its second call");
          return path === "./holder.js" ? encode(OTHER) : undefined;
        },
      };
    };
    const message = refusal(PROGRAM, throwing());
    expect(message).toContain("the resolver failed on its second call");
    // As a compile with nothing to probe fails.
    expect(message).toBe(refusal("function main(): Uint256 { return 7; }", throwing()));
  });

  it("an escaped spelling of `pot` or `self` is the name it spells, bound or free", () => {
    const spelled = { pot: "p\\u006ft", self: "s\\u0065lf" };
    const both: Options = {
      ambient: ["./holder.js"],
      ...served({ "./holder.js": `${POT}\nexport const self = ${holder};` }),
    };
    expect(build(`function main(): Address { return ${spelled.pot}; }`, both)).toEqual(
      exported(`function main(): Address { return ${spelled.pot}; }`),
    );
    expect(build(`function main(): Address { return ${spelled.self}; }`, both)).toEqual(callers());
    expect(build(`function main(): Address { return ${spelled.pot}; }`)).toEqual(pots());
    expect(refusal(`function main(): Address { return ${spelled.self}; }`, {})).toContain(
      "the Pot is `pot`, not `self`",
    );
  });

  it("a define of `pot` and an import of it are the caller's; a define of another name is not", () => {
    expect(build(PROGRAM, { defines: { pot: BigInt(holder) } })).toEqual(callers());
    expect(
      build(`import { pot } from "./constants.js";\n${PROGRAM}`, served({ "./constants.js": POT })),
    ).toEqual(callers());
    expect(build(PROGRAM, { defines: { other: BigInt(holder) } })).toEqual(pots());
  });

  it("a refusal the probe meets is the compile's own, as it is", () => {
    const unrelated = "function main(): Uint256 { return 7; }";
    // A module above the root, a name two caller modules export, and a module at the probe's own
    // path, which the SDK's standard library holds and no caller serves: refused either way.
    for (const options of [
      { ambient: ["../holder.js"], ...served({ "../holder.js": POT }) },
      { ambient: ["./a.js", "./b.js"], ...served({ "./a.js": OTHER, "./b.js": OTHER }) },
      {
        ambient: ["./@eco-incorp/sauce/std/__sauce_probe.js"],
        ...served({ "./@eco-incorp/sauce/std/__sauce_probe.js": POT }),
      },
    ]) {
      expect(refusal(PROGRAM, options)).toBe(refusal(unrelated, options));
    }
  });

  it.each([
    ["is named like the probe's module", { "./__sauce_probe.js": POT }, "./__sauce_probe.js"],
    [
      "imports one named like it",
      {
        "./holder.js": `import { base } from "./__sauce_probe.js";\n${POT}`,
        "./__sauce_probe.js": "export const base = 1;",
      },
      "./holder.js",
    ],
  ])("a caller's module that %s is the caller's own", (_, modules, specifier) => {
    expect(build(PROGRAM, { ambient: [specifier], ...served(modules) })).toEqual(exported());
  });

  // The probe's own helper function, which the compiler would refuse beside a define, an import or a
  // contract binding of its name, is named apart from every name the compile binds. Each is asked
  // with a caller ambient module that does not export `pot` (the Pot, as with no ambient module to
  // probe) and one that does (refused). On Solana a program may declare no `__sauce_` name the
  // lowering might bring in, so an import of one is refused there however the probe answers.
  const HELPER = "__sauce_probe";
  it.each<[string, string, Options]>([
    ["a define", "", { defines: { [HELPER]: 5n } }],
    ["a value import", `import { other as ${HELPER} } from "./lib.js";\n`, {}],
    ["an ABI import", `import ${HELPER} from "./abi.json";\n`, {}],
    ["a JSON document import", `import ${HELPER} from "./data.json" with { type: "json" };\n`, {}],
    ["a contract binding", "", { contracts: { [HELPER]: { abi: [] } } }],
  ])("%s named like the probe's helper leaves the answer the probe's", (_, prefix, extra) => {
    const program = `${prefix}${PROGRAM}`;
    const options = (text: string): Options => ({
      ambient: ["./holder.js"],
      ...extra,
      ...served({
        "./holder.js": text,
        "./lib.js": "export const other = 1;",
        "./abi.json": "[]",
        "./data.json": '{"a": 1}',
      }),
    });
    const free =
      arm === "svm" && prefix !== ""
        ? { refused: expect.stringContaining(`\`${HELPER}\` is reserved`) }
        : pots();
    expect(build(program, { ...options(OTHER), ambient: [] })).toEqual(free);
    expect(build(program, options(OTHER))).toEqual(free);
    expect(build(program, options(POT))).toEqual(exported(program));
  });

  it("a caller ambient export named like the probe's helper is hidden by it, as by any local", () => {
    for (const [text, expected] of [
      [`export const ${HELPER} = 3;`, pots],
      [`export function ${HELPER}(): Uint256 { return 3; }`, pots],
      [`export const ${HELPER} = 3;\n${POT}`, exported],
    ] as const) {
      expect(
        build(PROGRAM, { ambient: ["./holder.js"], ...served({ "./holder.js": text }) }),
      ).toEqual(expected());
    }
  });

  // The program imports a dependency that imports a package the compile also takes as ambient, which
  // `resolvePackage` maps by importer. The compiler loads an entry's imports before the ambient
  // modules and a module once, so the ambient package is the module the dependency's import loaded.
  const DEPENDENT =
    'import { dep } from "./dep.js";\nfunction main(): Address { require(dep() > 0); return pot; }';
  const byImporter = (fromDependency: string, fromEntry: string | undefined): Options => ({
    ambient: ["holder"],
    resolvePackage: (specifier: string, importer: string) => {
      if (specifier !== "holder") return undefined;
      if (importer.endsWith("dep.js")) return "./dep-holder.js";
      if (fromEntry === undefined) throw new Error("holder is not installed for the program");
      return "./app-holder.js";
    },
    ...served({
      "./dep.js": 'import { base } from "holder";\nexport function dep(): Uint256 { return base; }',
      "./dep-holder.js": fromDependency,
      ...(fromEntry === undefined ? {} : { "./app-holder.js": fromEntry }),
    }),
  });
  const BASE = "export const base = 1;";
  const theirs = DEPENDENT.replace("return pot", `return ${holder}`);

  it.each([
    ["only the dependency's", `${BASE}\n${POT}`, BASE],
    ["the dependency's, the program's own mapping refused", `${BASE}\n${POT}`, undefined],
  ])("a `pot` %s package exports is found, and refused", (_, fromDependency, fromEntry) => {
    const options = byImporter(fromDependency, fromEntry);
    expect(build(DEPENDENT, options)).toEqual(exported(DEPENDENT));
    // The same module read for a name the program imports is its own, as written.
    expect(build(theirs, options)).not.toHaveProperty("refused");
  });

  it("a `pot` only the program's own mapping exports, which the compile never loads, is the Pot", () => {
    const options = byImporter(BASE, `${BASE}\n${POT}`);
    expect(build(DEPENDENT, options)).toEqual(build(DEPENDENT, { ...options, ambient: [] }));
  });

  // A compile with a closure lowers only what `main` reaches; the probe of one must not lower the
  // rest, which may be a function only another target's program can compile.
  it("a program with a closure is probed as it compiles, lowering only what it reaches", () => {
    const elsewhere =
      arm === "evm"
        ? "export function elsewhere(a: Account): Uint256 { return svm.sload(a, 0, 8).toLe(); }"
        : "export function elsewhere(): Uint256 { return evm.sload(0); }";
    const program =
      "function main(): Address { const code = program(() => 1).code; require(code.length > 0); return pot; }";
    const holding = (text: string): Options => ({
      ambient: ["./holder.js"],
      ...served({ "./holder.js": `${text}\n${elsewhere}` }),
    });
    expect(build(program, holding(OTHER))).toEqual(build(program));
    expect(build(program, holding(POT))).toEqual(exported(program));
  });

  it("the SDK's own ambient modules export neither of the Pot's names", () => {
    const ambient = [
      ...chainAmbient(requireChain(chain)),
      ...(arm === "evm" ? ["@sauce/router"] : []),
    ];
    expect(
      ambientNamesOf({ target: arm === "svm" ? "svm" : "v12", ambient }, ["pot", "self"], [], []),
    ).toEqual(new Set());
  });

  it("the probe asks again after each name it finds, so it finds every name asked", () => {
    const input = {
      target: arm === "svm" ? ("svm" as const) : ("v12" as const),
      ambient: ["./holder.js"],
      resolve: (path: string) =>
        path === "./holder.js"
          ? new TextEncoder().encode(`${POT}\nexport const self = ${holder};\n${OTHER}`)
          : undefined,
    };
    // The compiler refuses one name exported twice at a time: two answers need two refusals.
    expect(ambientNamesOf(input, ["pot", "self", "absent"], [], [])).toEqual(
      new Set(["pot", "self"]),
    );
    expect(ambientNamesOf(input, ["self", "absent"], [], [])).toEqual(new Set(["self"]));
  });

  it("a probe refused for the program's own fault reports that fault, not a refusal of `self`", () => {
    const options: Options = {
      ambient: ["./holder.js"],
      ...served({
        "./holder.js": `export const self = ${holder};`,
        "./lib.js": "export const other = 1;",
      }),
    };
    const program = 'import { nope } from "./lib.js";\nfunction main(): Address { return self; }';
    const message = refusal(program, options);
    expect(message).toContain("`nope` is not exported by module");
    expect(message).not.toContain("the Pot is `pot`, not `self`");
    // Written right, the caller's `self` is its own.
    expect(build(program.replace("nope", "other"), options)).toEqual(callers());
  });

  // A host `resolve` that changes the caller's own options object as the compile first asks it for
  // a module. A compile reads its options once, as they were when it began, for the probe and the
  // compile alike, so neither answers for an input the other did not see: the result is the one the
  // options as given produce.
  type Given = NonNullable<Options>;
  const MUTABLE_MODULES: Readonly<Record<string, string>> = {
    "./holder.js": POT,
    "./second.js": POT,
    "./other.js": OTHER,
  };
  const mutations: Array<[string, () => Given, (given: Given) => void]> = [
    [
      "empties its `ambient`",
      () => ({ ambient: ["./holder.js"] }),
      (given) => {
        given.ambient!.length = 0;
      },
    ],
    [
      "adds to its `ambient` a second module that exports `pot`",
      () => ({ ambient: ["./holder.js"] }),
      (given) => {
        given.ambient!.push("./second.js");
      },
    ],
    [
      "replaces its `ambient`",
      () => ({ ambient: ["./holder.js"] }),
      (given) => {
        given.ambient = [];
      },
    ],
    [
      "adds `pot` to its `defines`",
      () => ({ ambient: ["./other.js"], defines: {} }),
      (given) => {
        given.defines!.pot = BigInt(holder);
      },
    ],
    [
      "adds a `pot` binding to its `contracts`",
      () => ({ ambient: ["./other.js"], contracts: {} }),
      (given) => {
        given.contracts!.pot = { abi: [] };
      },
    ],
    [
      "turns its accessor pass off",
      () => ({ ambient: ["./other.js"] }),
      (given) => {
        given.accessors = false;
      },
    ],
  ];
  /** `make()`'s options, with a `resolve` that applies `mutate` to them as it is first asked. */
  const mutating = (make: () => Given, mutate: (given: Given) => void) => {
    const given = make();
    let mutated = false;
    given.resolve = (path: string) => {
      if (!mutated) {
        mutated = true;
        mutate(given);
      }
      const text = MUTABLE_MODULES[path];
      return text === undefined ? undefined : new TextEncoder().encode(text);
    };
    return { given, mutated: () => mutated };
  };
  const asGiven = (make: () => Given): Given => ({ ...make(), ...served(MUTABLE_MODULES) });

  it.each(mutations)(
    "compileSauceProgram, whose resolver %s, reads them as they were given",
    (_, make, mutate) => {
      const { given, mutated } = mutating(make, mutate);
      const built = build(PROGRAM, given);
      expect(mutated()).toBe(true);
      expect(built).toEqual(build(PROGRAM, asGiven(make)));
    },
  );

  // A route on Solana takes no account a cook derives, which `pot` is there: EVM only.
  (arm === "evm" ? it.each(mutations) : it.skip.each(mutations))(
    "compileSauceRoute, whose resolver %s, reads them as they were given",
    (_, make, mutate) => {
      const execution = {
        pot: "0x1111111111111111111111111111111111111111",
        engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      } as const;
      const route = (options: Given) => {
        try {
          return Array.from(
            compileSauceRoute("base", PROGRAM, execution, options).compiled.bytecode[0]!,
          );
        } catch (error) {
          return (error as Error).message;
        }
      };
      const { given, mutated } = mutating(make, mutate);
      const built = route(given);
      expect(mutated()).toBe(true);
      expect(built).toEqual(route(asGiven(make)));
    },
  );

  // The same for the options the rewrites read after the probe has run the caller's `resolve`: a
  // swap's `stops` (Solana) and an `accessors` record (EVM). `tokens` is resolved before any
  // callback runs, so no mutation reaches it today; its row holds the outcome should that move.
  const SWAP =
    "function main(amountIn: Uint256, limit: Uint256): Uint256 {\n" +
    '  require(pot.balance >= 0, "no Pot");\n' +
    "  return Raydium.CLMM.swap(Raydium.CLMM.pool(USDC, WSOL, 400), USDC, WSOL, amountIn, limit, 0);\n}\n";
  const TOKEN = "function main(): Uint256 { return FOO.balanceOf(pot); }";
  const later: Array<[string, string, () => Given, (given: Given) => void]> =
    arm === "svm"
      ? [
          [
            "adds a stop to its `stops`",
            SWAP,
            () => ({ ambient: ["./other.js"], stops: [] }),
            (given) => {
              (given.stops as string[]).push(compileSauceProgram(chain, SWAP).stoppable![0]!);
            },
          ],
        ]
      : [
          [
            "turns off the `pot` sugar in its `accessors` record",
            PROGRAM,
            () => ({ ambient: ["./other.js"], accessors: {} }),
            (given) => {
              if (typeof given.accessors === "object") given.accessors.potSugar = false;
            },
          ],
          [
            "gives a symbol of its `tokens` another address",
            TOKEN,
            () => ({
              ambient: ["./other.js"],
              tokens: { FOO: "0x5555555555555555555555555555555555555555" },
            }),
            (given) => {
              (given.tokens as Record<string, string>).FOO =
                "0x7777777777777777777777777777777777777777";
            },
          ],
        ];

  it.each(later)(
    "compileSauceProgram, whose resolver %s, reads it as it was given",
    (_, source, make, mutate) => {
      const asMade = build(source, asGiven(make));
      expect(asMade).not.toHaveProperty("refused");
      const { given, mutated } = mutating(make, mutate);
      const built = build(source, given);
      expect(mutated()).toBe(true);
      expect(built).toEqual(asMade);
      // What the mutation would have compiled, had the compile read it: another program.
      const changed = make();
      mutate(changed);
      expect(build(source, { ...changed, ...served(MUTABLE_MODULES) })).not.toEqual(asMade);
    },
  );

  it("the probe reads only the compiler's refusal of an asked name two ambient modules export", () => {
    const missing: Parameters<typeof ambientNamesOf>[0] = {
      target: arm === "svm" ? "svm" : "v12",
      ambient: ["./missing.js"],
    };
    // Any other refusal is no answer: it is thrown as the compiler raised it.
    expect(() => ambientNamesOf(missing, ["pot"], [], [])).toThrow("./missing.js");
    let thrown: unknown;
    try {
      ambientNamesOf(missing, ["pot"], [], []);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { diagnostics?: unknown }).diagnostics).toBeDefined();
    // As a compile of a program that reads `pot` reports it, and one with nothing to probe.
    const options = { ambient: ["./missing.js"] };
    expect(refusal(PROGRAM, options)).toBe(
      refusal("function main(): Uint256 { return 7; }", options),
    );
  });
});

describe("on Solana, the accounts the lowering adds are named apart from what the caller binds", () => {
  const KEY = `0x${"06".repeat(32)}`;
  const TRANSFER = "function main(to: Address) { USDC.transfer(to, 1); }";

  it("a contract binding the caller names `pot`", () => {
    expect(
      compileSauceProgram("solana", TRANSFER, { contracts: { pot: { abi: [] } } }).derivedAccounts,
    ).toMatchObject({ pot2: "authority", potUSDC: "authority:USDC" });
  });

  it("an ambient module's export the program reads", () => {
    const compiled = compileSauceProgram(
      "solana",
      "function main(to: Address): Address { USDC.transfer(to, 1); return tokenProgram; }",
      {
        ambient: ["./consts.js"],
        resolve: (path: string) =>
          path === "./consts.js"
            ? new TextEncoder().encode(`export const tokenProgram = ${KEY};`)
            : undefined,
      },
    );
    expect(compiled.derivedAccounts).toMatchObject({
      tokenProgram2: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    });
    expect(compiled.source).toContain("return tokenProgram; }");
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

  it("is the binding in scope where it is read: a shape in one function, or a loop, is that binding's", () => {
    // A record in a helper says nothing of main's `Address` parameter of the same name.
    const helper =
      "function helper(): Uint256 {\n  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);\n  return pool.WETH;\n}\n";
    expect(
      hex(
        `${helper}function main(pool: Address): Uint256 {\n  return pool.balance + helper();\n}\n`,
      ),
    ).toBe(
      hex(
        `${helper}function main(pool: Address): Uint256 {\n  return ctx.balance(pool) + helper();\n}\n`,
      ),
    );
    // A loop's record hides the parameter in the loop's body only.
    const legs = (after: string) =>
      "interface Leg { balance: Uint256 }\n" +
      `function main(a: Address, legs: Leg[]): Uint256 { let t = 0; for (const a of legs) { t += a.balance; } return t + ${after}; }`;
    expect(hex(legs("a.balance"))).toBe(hex(legs("ctx.balance(a)")));
    untouched(legs("0"));
  });

  it("abi.decode's result", () => {
    untouched('function main(d: bytes): Uint256 { return abi.decode(d, ["Uint256"]).balance; }');
    untouched(
      'function main(d: bytes): Uint256 { const r = abi.decode(d, ["Uint256"]); return r.balance; }',
    );
  });

  describe("a holder only an ambient module declares", () => {
    const HOLDER = "0x6666666666666666666666666666666666666666";
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ambient = (module: string) => ({
      ambient: ["./lib.js"],
      resolve: (path: string) =>
        path === "./lib.js" ? new TextEncoder().encode(module) : undefined,
    });
    const build = (module: string, source: string) =>
      Buffer.from(compileSauceProgram("base", source, ambient(module)).bytecode).toString("hex");
    const refused = (module: string, source: string) => {
      try {
        compileSauceProgram("base", source, ambient(module));
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`compiled: ${source}`);
    };
    const RECORD = "export const limits = { balance: 5, cap: 7 };";

    it("an address: its .balance is its native coin", () => {
      const module = `export const limits = ${HOLDER};`;
      expect(build(module, "function main(): Uint256 { return limits.balance; }")).toBe(
        build(module, `function main(): Uint256 { return ctx.balance(${HOLDER}); }`),
      );
    });

    it("anything else is refused naming the read, and an import by name reads its field", () => {
      const why = (read: string) =>
        `compileSauceRoute: \`${read}\` read a balance of \`limits\`, taking it for an address, and the ` +
        "compiler refused `limits` there: ";
      const field =
        " The program does not declare `limits`, so its text does not say what it is (an ambient " +
        'module\'s export, a define): for a field of a record, import it by name (`import { limits } from "<module>"`), ' +
        "and its `.balance` is that field.";
      expect(refused(RECORD, "function main(): Uint256 { return limits.balance; }")).toMatch(
        new RegExp(
          `^${escape(why("limits.balance"))}a module-scope lookup table .*${escape(field)}$`,
        ),
      );
      expect(
        refused(
          "export function limits(): Uint256 { return 1; }",
          "function main(): Uint256 { return limits.balance + 1; }",
        ),
      ).toBe(`${why("limits.balance")}\`limits\` is not a declared variable.${field}`);
      // A token's balance is read of an address only: no field takes the name.
      expect(refused(RECORD, "function main(): Uint256 { return limits.USDC; }")).toMatch(
        new RegExp(
          `^${escape(why("limits.USDC"))}a module-scope lookup table [^]*has no run-time form[^]*\\.$`,
        ),
      );
      // Imported by name, its type is the module's, and `.balance` the record's field.
      const imported = 'import { limits } from "./lib.js";\n';
      expect(build(RECORD, `${imported}function main(): Uint256 { return limits.balance; }`)).toBe(
        build(
          "export const limits = { amount: 5, cap: 7 };",
          `${imported}function main(): Uint256 { return limits.amount; }`,
        ),
      );
    });
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

  // Through the compile, not the token pass alone: each program that keeps `.balance` a field
  // compiles as the same program with the field named otherwise does, bytes or refusal alike.
  it.each([
    [
      "a list's record",
      "interface Leg { balance: Uint256 }\n" +
        "function main(legs: Leg[]): Uint256 { let t = 0; for (const leg of legs) { t += leg.balance; } return legs[0].balance + t; }",
    ],
    [
      "a record the program's own function returns",
      "interface Leg { balance: Uint256 }\n" +
        "function leg(): Leg { return { balance: 1 }; }\nfunction main(): Uint256 { return leg().balance; }",
    ],
    [
      "abi.decode's result",
      'function main(d: bytes): Uint256 { return abi.decode(d, ["Uint256"]).balance; }',
    ],
    [
      "a local bound to abi.decode's result",
      'function main(d: bytes): Uint256 { const r = abi.decode(d, ["Uint256"]); return r.balance; }',
    ],
    [
      "an element of abi.decode's result",
      'function main(d: bytes): Uint256 { return abi.decode(d, ["{Uint256, Uint256}"])[0].balance; }',
    ],
    [
      "a local destructured from abi.decode's result",
      'function main(d: bytes): Uint256 { const [w, n] = abi.decode(d, ["{Uint256, Uint256}", "Uint256"]); return w.balance + n; }',
    ],
    [
      "a record destructured past a skipped element",
      "function main(row: { to: Address; wallet: { balance: Uint256 } }): Uint256 {\n" +
        "  const [, wallet] = row;\n  return wallet.balance;\n}",
    ],
  ])("%s compiles as a field named otherwise does", (_what, source) => {
    const outcome = (text: string): string => {
      try {
        return hex(text);
      } catch (error) {
        return `refused: ${(error as Error).message}`;
      }
    };
    // `deposit` is as long as `balance`, so a refusal's byte offsets are the same.
    const renamed = outcome(source.replace(/\bbalance\b/g, "deposit"));
    expect(outcome(source)).toBe(renamed.replace(/\bdeposit\b/g, "balance"));
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

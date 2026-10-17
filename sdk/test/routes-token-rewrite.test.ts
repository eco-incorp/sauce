/**
 * ERC20 token member rewrite — a symbol write `USDC.transfer(to, amount)` -> `@sauce/token`'s
 * SafeERC20 `transfer(USDC, to, amount)` (imported as `__sauce_transfer`), the read
 * `USDC.balanceOf(x)` -> `IERC20.at(USDC).balanceOf(x)`, plus the balance sugar `self.USDC` ->
 * `IERC20.at(USDC).balanceOf(ctx.self())`, the same read.
 */
import { compileProgram as compile, SDK_SOURCE_DIRS } from "./helpers";
import { requireChain } from "../src/chains/canonical.js";
// Through the public `routes` barrel: a caller of `rewriteTokenMembers` needs `tokenImportLines`
// beside it to compile the result.
import { rewriteTokenMembers, tokenImportLines } from "../src/routes/index.js";
import {
  registryTokenAddress,
  resolveTokenMap,
  SVM_TOKEN_REGISTRY,
} from "../src/routes/token-registry.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { compileSauceProgram, compileSauceRoute } from "../src/routes/sauce-route.js";

// Base USDC -- pinned fixture, matching src/verify/vectors.ts's own Base USDC constant.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
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

function evmOptions() {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base" as const,
    creator: "0x3333333333333333333333333333333333333333" as const,
    prover: "0x4444444444444444444444444444444444444444" as const,
    rewardDeadline: 1000n,
  };
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

describe("openRoute: token member rewrite end to end", () => {
  it("compiles USDC.transfer(...) with options.tokenDefines and produces one cook() call", () => {
    const built = openRoute("ethereum", `USDC.transfer(${TO}, 5n);`, {
      ...evmOptions(),
      tokenDefines: { USDC },
    }).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
  });

  it("an svm destination refuses a script's token write by name: its accounts go to main", () => {
    expect(() =>
      openRoute("solana", `USDC.transfer(${TO}, 5n);`, {
        execution: { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: "0x3333333333333333333333333333333333333333",
        prover: "0x4444444444444444444444444444444444444444",
        rewardDeadline: 1000n,
        tokenDefines: { USDC },
      }),
    ).toThrow(/`USDC.transfer\(…\)` on Solana: .* this program has no main/);
  });
});

// --- registry default: bare USDC.transfer with NO tokenDefines at all ---------------------------

describe("THE DECISIVE STEP (b): registry default -- a bare USDC.transfer with NO tokenDefines", () => {
  it("compiles via the registry default and produces exactly one cook() call", () => {
    const built = openRoute("base", `USDC.transfer(${TO}, 5n);`, evmOptions()).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
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
    // program with an unbound symbol -- and says which name the chain does not have, rather than
    // leaving the compiler to report an un-lowerable call expression.
    expect(() =>
      compileSauceRoute("ronin", `USDC.transfer(${TO}, 5n);`, { pot: POT, engine: ENGINE }),
    ).toThrow("`USDC` is not a token or protocol on ronin");
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
      "`USDT0` is not a token or protocol on base.",
    );
    expect(() => route("base", READ)).toThrow("`USDT0` is not a declared variable");
    expect(() => route("arbitrum", `USDT.transfer(${TO}, 5n);`)).toThrow(
      "`USDT` is not a token or protocol on arbitrum. Did you mean `USDC` or `USDT0`?",
    );
  });
});

// --- balance sugar: <holder>.<TOKEN> -> IERC20.at(<TOKEN>).balanceOf(<holder>) -------------------

describe("balance sugar: rewriteTokenMembers with the Map form", () => {
  const BASE = requireChain("base");
  const tokens = resolveTokenMap(BASE); // { USDC: <addr>n, WETH: <addr>n }

  it("self.USDC rewrites to IERC20.at(USDC).balanceOf(ctx.self()), what USDC.balanceOf lowers to", () => {
    const source = `function main() { return self.USDC; }`;
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

  it("a program's own `self` is an ordinary holder: self.USDC reads the local, as on Solana", () => {
    const source = `function main() { const self = ctx.self(); return self.USDC; }`;
    const { source: out, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(balanceSites).toBe(1);
    expect(out).toContain(`IERC20.at(USDC).balanceOf(self)`);
    expect(out).not.toContain("balanceOf(ctx.self())");
  });

  it("with a declared self, self.USDC compiles to exactly USDC.balanceOf(self)", () => {
    const body = (read: string) =>
      `function main(to: Address) { const self = ctx.self(); require(to != self); return ${read}; }`;
    const options = { pot: POT, engine: ENGINE };
    const sugar = compileSauceRoute("base", body("self.USDC"), options);
    const method = compileSauceRoute("base", body("USDC.balanceOf(self)"), options);
    expect(Array.from(sugar.compiled.bytecode[0]!)).toEqual(
      Array.from(method.compiled.bytecode[0]!),
    );
  });

  it("both spellings compile byte-identically: self.USDC vs USDC.balanceOf(self)", () => {
    const sugarSource = `function main() { return self.USDC; }`;
    // bare `self` alone isn't valid SauceScript (it needs the protocol-accessor pass's OWN self
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

  it("THE DECISIVE STEP (a): self.USDC for a real chain reads the real Base USDC", () => {
    const compiled = compileSauceRoute("base", `function main() { return self.USDC; }`, {
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
        compileSauceRoute(chain, `function main() { return self.USDC; }`, {
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
    const sugar = program("self.USDC");
    expect(Array.from(sugar)).toEqual(Array.from(program("USDC.balanceOf(ctx.self())")));
    const hex = Buffer.from(sugar).toString("hex");
    expect(hex).toContain(other.toString(16));
    expect(hex).not.toContain(USDC.slice(2).toLowerCase());
  });

  describe("value-position guard: a call/lvalue shape is NOT rewritten", () => {
    const shapes = [
      `self.USDC(1n, 2n);`,
      `self.USDC = 1n;`,
      `self.USDC++;`,
      `self.USDC.transfer(${TO}, 5n);`,
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
      const source = `function main() { let a = 0n; [a] = [self.USDC]; }`;
      // `self.USDC` here is a plain array element (VALUE position, not the assignment target itself)
      // -- verifies the exclusion is scoped to the LEFT side only, not a false-positive on the whole statement.
      const { balanceSites } = rewriteTokenMembers(source, tokens);
      expect(balanceSites).toBe(1);
    });
  });

  describe("unresolvable / rejected -- left byte-for-byte untouched", () => {
    it("self.NOTATOKEN (unknown symbol)", () => {
      const source = `function main() { return self.NOTATOKEN; }`;
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

    it("a local `let USDC = 1n;` suppresses self.USDC too (whole-program shadow rule)", () => {
      const source = `function main() { let USDC = 1n; return self.USDC; }`;
      const { rewrote } = rewriteTokenMembers(source, tokens);
      expect(rewrote).toBe(false);
    });

    it("USDC.WETH -- a token-symbol holder is ambiguous, and refused with the spelling to use", () => {
      const source = `function main() { return USDC.WETH; }`;
      expect(() => rewriteTokenMembers(source, tokens)).toThrow(
        "`USDC.WETH`: a token's symbol is not taken for a holder, since `USDC.WETH` would read as a member of the token. For the WETH the USDC contract holds, write `WETH.balanceOf(USDC)`.",
      );
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

    it("self.USDC rewrites with a bare Set too: it needs the symbol, not its address", () => {
      const source = `function main() { return self.USDC; }`;
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
    ["return self.USDC;", "return USDC.balanceOf(ctx.self());"],
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
    ["return self.ETH;", "return ctx.selfBalance();"],
    ["return ctx.self().ETH;", "return ctx.selfBalance();"],
    ["return who.ETH;", "return ctx.balance(who);"],
    ["return UniswapV4.PoolManager.ETH;", "return ctx.balance(UniswapV4.PoolManager);"],
    [
      "return UniswapV4.StateView.poolManager().ETH;",
      "return ctx.balance(UniswapV4.StateView.poolManager());",
    ],
    ["const self = who; return self.ETH;", "const self = who; return ctx.balance(self);"],
  ];
  for (const chain of ["base", "ethereum"] as const) {
    for (const [short, long] of SAME) {
      it(`on ${chain}, \`${short}\` compiles to \`${long}\``, () => {
        expect(bytecode(chain, short)).toBe(bytecode(chain, long));
      });
    }
  }

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
    expect(
      refusal(
        "let total = 0; for (const leg of [{ to: who }]) { total += leg.ETH; } return total;",
      ),
    ).toMatch(/^`leg\.ETH`: `leg` is a record, not an address, and `ETH` names the native coin/);
    expect(refusal('return abi.decode(hex`00`, ["Address"]).USDC;')).toMatch(/is a record/);
  });

  it("refuses a symbol that is both the native coin and a token: Arc's USDC", () => {
    expect(() =>
      compileSauceProgram("arc", "function main(): Uint256 { return self.USDC; }"),
    ).toThrow(
      /^`self\.USDC`: on arc, USDC is both the native coin and the token at .*: write `ctx\.balance\(<holder>\)`/,
    );
    // The method form still says which.
    expect(
      compileSauceProgram("arc", "function main(): Uint256 { return USDC.balanceOf(ctx.self()); }")
        .bytecode.length,
    ).toBeGreaterThan(0);
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
    expect(message("return self.USDCC;")).toMatch(
      /^compileSauceRoute: `USDCC` is not a token on base, nor its native coin, ETH\. Did you mean `USDC`\?/,
    );
    expect(message("return who.WETHH;")).toMatch(
      /`WETHH` is not a token on base.*Did you mean `WETH`\?/,
    );
    expect(message("return self.ETHH;")).toMatch(/Did you mean `ETH`\?/);
    expect(message("return p.USDCC;")).toMatch(/`USDCC` is not a field of this tuple/);
  });
});

describe("composition: token pass + protocol-accessor pass in ONE compile", () => {
  it("a body using BOTH Uniswap.UniversalRouter.execute(...) and self.USDC compiles, both rewritten, ERC20 import exactly once", () => {
    const compiled = compileSauceRoute(
      "base",
      `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); return self.USDC; }`,
      { pot: POT, engine: ENGINE },
    );
    expect(compiled.source).toContain("IUniswapV4_UniversalRouter.at(");
    expect(compiled.source).toContain(`IERC20.at(USDC).balanceOf(ctx.self())`);
    const count = (
      compiled.source.match(/import \{ IERC20 \} from "\.\/artifacts\/IERC20\.json";/g) ?? []
    ).length;
    expect(count).toBe(1);
    expect(compiled.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

// --- SVM: the same syntax lowers to the SVM arm, with the accounts a cook derives ---------------
// (routes-svm-token-methods.test.ts holds the lowering itself; these hold the route path to it.)

describe("svm: the token syntax on a route, whose accounts are the caller's", () => {
  it("self.USDC lowers, and a route refuses the accounts it adds, which only a cook derives", () => {
    for (const accessors of [false, undefined]) {
      expect(() =>
        compileSauceRoute(
          "solana",
          `function main() { return self.USDC; }`,
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

  it("a script's token write is refused by name: its accounts go to main, which it has not", () => {
    expect(() =>
      compileSauceRoute(
        "solana",
        `USDC.transfer(${TO}, 5n);`,
        { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        { tokens: { USDC } },
      ),
    ).toThrow(/`USDC.transfer\(…\)` on Solana: .* this program has no main/);
  });
});

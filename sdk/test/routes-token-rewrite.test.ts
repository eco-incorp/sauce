/**
 * ERC20 token member rewrite — a symbol write `USDC.transfer(to, amount)` -> `@sauce/token`'s
 * SafeERC20 `transfer(USDC, to, amount)` (imported as `__sauce_transfer`), the read
 * `USDC.balanceOf(x)` -> `IERC20.at(USDC).balanceOf(x)`, plus the balance sugar `self.USDC` ->
 * `IERC20.at(<addr>n).balanceOf(ctx.self())`.
 */
import { compileProgram as compile, SDK_SOURCE_DIRS } from "./helpers";
import { requireChain } from "../src/chains/canonical.js";
// Through the public `routes` barrel: a caller of `rewriteTokenMembers` needs `tokenImportLines`
// beside it to compile the result.
import { rewriteTokenMembers, tokenImportLines } from "../src/routes/index.js";
import { resolveTokenMap } from "../src/routes/token-registry.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";

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

  it("an svm destination throws the named error", () => {
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
    ).toThrow(/svm/i);
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

  it("an unregistered chain (no registry rows, no tokenDefines) leaves a bare USDC untouched -- the base compiler's own error", () => {
    // The point is that the rewrite declines and the compile FAILS CLOSED rather than emitting a
    // program with an unbound symbol. The compiler reports a member call on an undeclared name as an
    // un-lowerable call expression rather than naming the identifier, so match either shape.
    expect(() =>
      compileSauceRoute("ronin", `USDC.transfer(${TO}, 5n);`, { pot: POT, engine: ENGINE }),
    ).toThrow(/`USDC` is not a declared variable|cannot be lowered to IR yet/);
  });
});

// --- balance sugar: <holder>.<TOKEN> -> IERC20.at(<addr>n).balanceOf(<holder>) -------------------

describe("balance sugar: rewriteTokenMembers with the Map form", () => {
  const BASE = requireChain("base");
  const tokens = resolveTokenMap(BASE); // { USDC: <addr>n, WETH: <addr>n }

  it("self.USDC rewrites to IERC20.at(<addr>n).balanceOf(ctx.self())", () => {
    const source = `function main() { return self.USDC; }`;
    const { source: out, rewrote, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(rewrote).toBe(true);
    expect(balanceSites).toBe(1);
    expect(out).toContain(`IERC20.at(${BigInt(USDC).toString()}n).balanceOf(ctx.self())`);
  });

  it("a hex-address-literal holder emits the EXACT address (catches the float64 round-trip)", () => {
    const holder = "0x1111111111111111111111111111111111111122";
    const source = `function main() { return ${holder}.USDC; }`;
    const { source: out, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(balanceSites).toBe(1);
    expect(out).toContain(
      `IERC20.at(${BigInt(USDC).toString()}n).balanceOf(${BigInt(holder).toString()}n)`,
    );
  });

  it("an n-suffixed hex-address-literal holder is accepted identically", () => {
    const holder = "0x1111111111111111111111111111111111111122n";
    const source = `function main() { return ${holder}.USDC; }`;
    const result = rewriteTokenMembers(source, tokens);
    expect(result.balanceSites).toBe(1);
    expect(result.source).toContain(
      `IERC20.at(${BigInt(USDC).toString()}n).balanceOf(${BigInt("0x1111111111111111111111111111111111111122").toString()}n)`,
    );
  });

  it("a variable holder is dropped in verbatim", () => {
    const source = `function main() { let x = 0x1111111111111111111111111111111111111122n; return x.USDC; }`;
    const { source: out, balanceSites } = rewriteTokenMembers(source, tokens);
    expect(balanceSites).toBe(1);
    expect(out).toContain(`IERC20.at(${BigInt(USDC).toString()}n).balanceOf(x)`);
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
      },
    );
    const u4Compiled = compile(`import { IERC20 } from "./artifacts/IERC20.json";\n${u4.source}`, {
      baseDirs: [...SDK_SOURCE_DIRS],
      defines: { USDC: BigInt(USDC) },
    });
    expect(Array.from(sugarCompiled.bytecode[0]!)).toEqual(Array.from(u4Compiled.bytecode[0]!));
  });

  it("THE DECISIVE STEP (a): self.USDC for a real chain rewrites to IERC20.at(<real Base USDC>n).balanceOf(ctx.self()) and compiles", () => {
    const compiled = compileSauceRoute("base", `function main() { return self.USDC; }`, {
      pot: POT,
      engine: ENGINE,
    });
    expect(compiled.source).toContain(
      `IERC20.at(${BigInt(USDC).toString()}n).balanceOf(ctx.self())`,
    );
    expect(compiled.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("chain-scoped: Base USDC != Ethereum USDC in the emitted literal", () => {
    const baseCompiled = compileSauceRoute("base", `function main() { return self.USDC; }`, {
      pot: POT,
      engine: ENGINE,
    });
    const ethCompiled = compileSauceRoute("ethereum", `function main() { return self.USDC; }`, {
      pot: POT,
      engine: ENGINE,
    });
    expect(baseCompiled.source).not.toBe(ethCompiled.source);
    expect(baseCompiled.source).toContain(`${BigInt(USDC).toString()}n`);
    expect(ethCompiled.source).not.toContain(`${BigInt(USDC).toString()}n`);
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

    it("USDC.WETH -- a token-symbol holder is ambiguous, claimed by neither feature", () => {
      const source = `function main() { return USDC.WETH; }`;
      const { rewrote, memberSites, balanceSites } = rewriteTokenMembers(source, tokens);
      expect(rewrote).toBe(false);
      expect(memberSites).toBe(0);
      expect(balanceSites).toBe(0);
    });

    it("Uniswap.USDC and Base.USDC -- a namespace/chain-key holder is untouched", () => {
      const source = `function main() { return Uniswap.USDC; }`;
      const { rewrote } = rewriteTokenMembers(source, tokens);
      expect(rewrote).toBe(false);
    });
  });

  describe("Set form (no addresses): U4 still works, sugar declines", () => {
    it("USDC.transfer(...) still rewrites with a bare Set", () => {
      const source = `function main() { USDC.transfer(${TO}, 5n); }`;
      const { rewrote, memberSites, balanceSites } = rewriteTokenMembers(source, new Set(["USDC"]));
      expect(rewrote).toBe(true);
      expect(memberSites).toBe(1);
      expect(balanceSites).toBe(0);
    });

    it("self.USDC does NOT rewrite with a bare Set (no address to inline)", () => {
      const source = `function main() { return self.USDC; }`;
      const { rewrote, balanceSites } = rewriteTokenMembers(source, new Set(["USDC"]));
      expect(rewrote).toBe(false);
      expect(balanceSites).toBe(0);
    });
  });
});

// --- U4 + protocol-accessor composition: the swapped-order regression lock ----------------------

describe("composition: token pass + protocol-accessor pass in ONE compile", () => {
  it("a body using BOTH Uniswap.UniversalRouter.execute(...) and self.USDC compiles, both rewritten, ERC20 import exactly once", () => {
    const compiled = compileSauceRoute(
      "base",
      `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); return self.USDC; }`,
      { pot: POT, engine: ENGINE },
    );
    expect(compiled.source).toContain("IUniswapV4_UniversalRouter.at(");
    expect(compiled.source).toContain(
      `IERC20.at(${BigInt(USDC).toString()}n).balanceOf(ctx.self())`,
    );
    const count = (
      compiled.source.match(/import \{ IERC20 \} from "\.\/artifacts\/IERC20\.json";/g) ?? []
    ).length;
    expect(count).toBe(1);
    expect(compiled.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });
});

// --- SVM: registry-default token/balance-sugar behavior must never SILENTLY rewrite -------------

describe("svm: the token/balance-sugar pass never rewrites for an svm destination (registry has no svm rows)", () => {
  it("with accessors:false, self.USDC is completely untouched by THIS feature -- the base compiler's own error on bare `self` fires instead (unrelated to tokens)", () => {
    // Isolates the token/balance-sugar pass from the protocol-accessor pass's OWN (pre-existing,
    // unrelated) self-sugar, which would otherwise also touch the bare `self` here.
    expect(() =>
      compileSauceRoute(
        "solana",
        `function main() { return self.USDC; }`,
        { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        { accessors: false },
      ),
    ).toThrow(/`self` is not a declared variable|property 'USDC' access not supported/);
  });

  it("with accessors default ON, the pre-existing self-sugar rewrite fires and the existing svm guard throws -- a safe, named failure, never a silent drop", () => {
    expect(() =>
      compileSauceRoute("solana", `function main() { return self.USDC; }`, {
        code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        accounts: [],
      }),
    ).toThrow(/svm/i);
  });

  it("the tokenDefines-on-svm named error still fires when the caller explicitly supplies tokens", () => {
    expect(() =>
      compileSauceRoute(
        "solana",
        `USDC.transfer(${TO}, 5n);`,
        { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        { tokens: { USDC } },
      ),
    ).toThrow(/svm/i);
  });
});

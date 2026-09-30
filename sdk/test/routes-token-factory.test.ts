/**
 * `Token(addr)` — the DSL's global token WRAPPER. `token-rewrite.ts#rewriteTokenFactory` lowers it
 * before the compiler sees it: a write (`transfer`/`approve`/`transferFrom`) to the `@sauce/token`
 * function of the same name, which has OpenZeppelin `SafeERC20` semantics, and a read to the typed
 * `IERC20.at(addr)` binding. A local bound once to `Token(addr)` and only ever called is lowered the
 * same way; every other `Token(...)` is refused rather than left as the unchecked typed call.
 *
 * What the lowered programs DO on a chain — a standard token, USDT's empty return, a `false`
 * return, no code — is `test/std/token/evm.e2e.test.ts`'s matrix. This file pins the rewrite.
 */
import { rewriteTokenFactory } from "../src/routes/token-rewrite.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { openRoute } from "../src/routes/index.js";
import type { IntentOptions } from "../src/routes/index.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const SPENDER = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
/** `approve(address,uint256)` selector — present iff the wrapper lowered to a real ERC20 approve. */
const APPROVE_SELECTOR = "095ea7b3";
/** `allowance(address,address)` — only the SafeERC20 approve reads it, for its zero-first reset. */
const ALLOWANCE_SELECTOR = "dd62ed3e";

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
    ...overrides,
  };
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const compileRoute = (body: string) =>
  compileSauceRoute("base", body, { pot: POT, engine: ENGINE });
const bytes = (body: string): number[] => Array.from(compileRoute(body).compiled.bytecode[0]!);

describe("rewriteTokenFactory (unit)", () => {
  it("lowers a write to the @sauce/token function, the token first", () => {
    const out = rewriteTokenFactory("Token(0x1).approve(a, b);");
    expect(out.rewrote).toBe(true);
    expect(out.sites).toBe(1);
    expect(out.source).toBe("__sauce_approve(0x1, a, b);");
    expect([...out.writes]).toEqual(["approve"]);
    expect(out.erc20).toBe(false);
  });

  it("lowers each of the three writes", () => {
    expect(rewriteTokenFactory("Token(t).transfer(a, b);").source).toBe(
      "__sauce_transfer(t, a, b);",
    );
    expect(rewriteTokenFactory("Token(t).transferFrom(a, b, c);").source).toBe(
      "__sauce_transferFrom(t, a, b, c);",
    );
  });

  it("keeps a read on the typed binding", () => {
    const out = rewriteTokenFactory("x = Token(0x1).balanceOf(a);");
    expect(out.source).toBe("x = IERC20.at(0x1).balanceOf(a);");
    expect(out.erc20).toBe(true);
    expect(out.writes.size).toBe(0);
  });

  it("fires on ANY argument shape — a variable or an ambient symbol, not just a literal", () => {
    expect(rewriteTokenFactory("Token(USDC).approve(a, b);").source).toBe(
      "__sauce_approve(USDC, a, b);",
    );
    expect(rewriteTokenFactory("Token(tokens[i]).transfer(a, b);").source).toBe(
      "__sauce_transfer(tokens[i], a, b);",
    );
  });

  it("rewrites every site, including one nested in another's arguments", () => {
    const out = rewriteTokenFactory("Token(0x1).transfer(c, Token(0x2).balanceOf(d));");
    expect(out.sites).toBe(2);
    expect(out.source).toBe("__sauce_transfer(0x1, c, IERC20.at(0x2).balanceOf(d));");
  });

  describe("a bound Token(...)", () => {
    it("holds the address, and each call on it is lowered by name", () => {
      const out = rewriteTokenFactory(
        "const t = Token(0x1);\nt.approve(a, b);\nx = t.balanceOf(c);",
      );
      expect(out.source).toBe(
        "const t = 0x1;\n__sauce_approve(t, a, b);\nx = IERC20.at(t).balanceOf(c);",
      );
      expect([...out.writes]).toEqual(["approve"]);
      expect(out.erc20).toBe(true);
    });

    it("accepts `let` as well as `const`", () => {
      expect(rewriteTokenFactory("let t = Token(USDC); t.transfer(a, b);").source).toBe(
        "let t = USDC; __sauce_transfer(t, a, b);",
      );
    });

    it.each([
      ["reassigned", "let t = Token(0x1); t = 0x2; t.approve(a, b);", /`t` is reassigned/],
      ["updated", "let t = Token(0x1); t++; t.approve(a, b);", /`t` is reassigned/],
      ["passed to a function", "const t = Token(0x1); f(t);", /`t` is used other than/],
      ["returned", "function f() { const t = Token(0x1); return t; }", /`t` is used other than/],
      [
        "declared twice",
        "const t = Token(0x1); function g(t) { t.approve(a, b); }",
        /more than once/,
      ],
      ["destructured", "const [t] = Token(0x1);", /destructured/],
    ])("is refused when %s, naming the safe spellings", (_why, src, reason) => {
      expect(() => rewriteTokenFactory(src)).toThrow(reason);
      expect(() => rewriteTokenFactory(src)).toThrow(/SafeERC20/);
      expect(() => rewriteTokenFactory(src)).toThrow(/`Token\(addr\)\.transfer\(to, amount\)`/);
    });
  });

  it.each([
    ["an argument", "f(Token(0x1));"],
    ["an array element", "const xs = [Token(0x1)];"],
    ["a member that is not called", "const f = Token(0x1).transfer;"],
    ["a computed member", 'Token(0x1)["transfer"](a, b);'],
    ["an assignment", "let t = 0n; t = Token(0x1);"],
  ])("refuses a Token(...) used as %s instead of passing the typed binding through", (_w, src) => {
    expect(() => rewriteTokenFactory(src)).toThrow(/is used as a value, not called or bound/);
  });

  it("refuses a write whose result is read: it returns nothing", () => {
    expect(() => rewriteTokenFactory("const ok = Token(0x1).approve(a, b);")).toThrow(
      /`Token\(\.\.\.\)\.approve\(\.\.\.\)` returns nothing/,
    );
    expect(() => rewriteTokenFactory("const t = Token(0x1); if (t.transfer(a, b)) {}")).toThrow(
      /`t\.transfer\(\.\.\.\)` returns nothing/,
    );
  });

  it("refuses a write with the wrong number of arguments, in the caller's terms", () => {
    expect(() => rewriteTokenFactory("Token(0x1).transfer(a);")).toThrow(
      /`Token\(\.\.\.\)\.transfer\(\.\.\.\)` takes 2 arguments \(to, amount\), got 1/,
    );
    expect(() => rewriteTokenFactory("Token(0x1, 0x2).transfer(a, b);")).toThrow(
      /takes one argument/,
    );
  });

  it("refuses a program that declares the name a write is imported under", () => {
    expect(() =>
      rewriteTokenFactory("const __sauce_approve = 1n; Token(0x1).approve(a, b);"),
    ).toThrow(/`__sauce_approve` is reserved/);
  });

  it("is shadow-safe: a user-declared `Token` owns the name — nothing is rewritten", () => {
    // acorn (plain JS) parse, same as rewriteTokenMembers — route bodies carry no type annotations.
    const src = "function Token(x) { return x; }\nlet y = Token(5n);";
    expect(rewriteTokenFactory(src)).toMatchObject({ source: src, rewrote: false, sites: 0 });
  });

  // Every form that BINDS the name, not just the two that were originally checked. `import` and
  // `class` used to fall through and get rewritten, which silently redirected a user's own `Token`
  // call to an ERC20 they never named — the worst shape of this bug, since it produces working
  // bytecode for the wrong contract rather than an error.
  it.each([
    ["let", "let Token = mine;"],
    ["const", "const Token = mine;"],
    ["var", "var Token = mine;"],
    ["function declaration", "function Token(x) { return x; }"],
    ["class declaration", "class Token {}"],
    ["named import", 'import { Token } from "./mine.js";'],
    ["aliased import", 'import { thing as Token } from "./mine.js";'],
    ["default import", 'import Token from "./mine.js";'],
    ["namespace import", 'import * as Token from "./mine.js";'],
    ["object destructure", "const { Token } = mine;"],
    ["renamed object destructure", "const { thing: Token } = mine;"],
    ["array destructure", "const [Token] = mine;"],
    ["defaulted destructure", "const { Token = fallback } = mine;"],
    ["rest destructure", "const { ...Token } = mine;"],
  ])("leaves every `Token(...)` alone when the name is bound by a %s", (_form, declaration) => {
    const src = `${declaration}\nconst x = Token(0x11n).approve(a, b);`;
    expect(rewriteTokenFactory(src)).toMatchObject({ source: src, rewrote: false, sites: 0 });
  });

  it.each([
    ["a parameter", "function f(Token) { return Token(0x11n).approve(a, b); }"],
    ["a destructured parameter", "function f({ Token }) { return Token(0x11n).approve(a, b); }"],
    ["a catch parameter", "try { g(); } catch (Token) { Token(0x11n).approve(a, b); }"],
  ])("leaves every `Token(...)` alone when the name is bound by %s", (_form, src) => {
    expect(rewriteTokenFactory(src)).toMatchObject({ source: src, rewrote: false, sites: 0 });
  });

  it("no `Token` at all: a no-op that never even parses", () => {
    const src = "IERC20.at(0x1).approve(a, b);";
    expect(rewriteTokenFactory(src)).toMatchObject({ source: src, rewrote: false, sites: 0 });
  });

  it("leaves a bare `Token` value (not a call) untouched", () => {
    // Only a Token(...) CALL is the wrapper; a bare value is left to fail closed as an undeclared name.
    expect(rewriteTokenFactory("let t = Token;").rewrote).toBe(false);
  });
});

describe("Token(addr) through compileSauceRoute", () => {
  it("imports only what the lowering names, under the reserved names", () => {
    const { source } = compileRoute(
      `const t = Token(${USDC});\nt.approve(${SPENDER}, 5n);\nt.transfer(${SPENDER}, t.balanceOf(${SPENDER}));`,
    );
    expect(source.split("\n").slice(0, 2)).toEqual([
      'import { IERC20 } from "./artifacts/IERC20.json";',
      'import { transfer as __sauce_transfer, approve as __sauce_approve } from "@sauce/token";',
    ]);
  });

  it("a write alone needs no IERC20 import", () => {
    expect(compileRoute(`Token(${USDC}).transfer(${SPENDER}, 5n);`).source).not.toContain("IERC20");
  });

  it("Token(addr).approve is the SafeERC20 approve, with forceApprove's allowance read", () => {
    const code = hex(compileRoute(`Token(${USDC}).approve(${SPENDER}, 5n);`).compiled.bytecode[0]!);
    expect(code.includes(APPROVE_SELECTOR)).toBe(true);
    expect(code.includes(ALLOWANCE_SELECTOR)).toBe(true);
  });

  it("compiles the same bytes as a direct @sauce/token call, for every write", () => {
    const writes = [
      ["transfer", `${SPENDER}, 5n`],
      ["approve", `${SPENDER}, 5n`],
      ["transferFrom", `${SPENDER}, ${SPENDER}, 5n`],
    ] as const;
    for (const [write, args] of writes) {
      const library = bytes(
        `import { ${write} } from "@sauce/token";\nfunction main() { ${write}(${USDC}, ${args}); }`,
      );
      expect(bytes(`Token(${USDC}).${write}(${args});`)).toEqual(library);
    }
  });

  it("the binding form compiles the same bytes as the direct chain", () => {
    expect(bytes(`let t = Token(${USDC});\nt.approve(${SPENDER}, 5n);`)).toEqual(
      bytes(`Token(${USDC}).approve(${SPENDER}, 5n);`),
    );
  });

  it("a user's own `transfer`/`approve` is untouched and does not collide", () => {
    const body =
      "function transfer(a) { return a; }\nfunction approve(a) { return a; }\n" +
      `function main() { Token(${USDC}).transfer(${SPENDER}, transfer(5n)); Token(${USDC}).approve(${SPENDER}, approve(6n)); }`;
    expect(bytes(body).length).toBeGreaterThan(0);
  });

  it("the ambient `@sauce/token` openRoute adds does not collide with the aliased import", () => {
    const built = openRoute(
      "base",
      `Token(${USDC}).approve(${BigInt(SPENDER)}n, 5n);\ntransfer(${USDC}, ${SPENDER}, 1n);`,
      evmOptions(),
    ).reward(0n);
    expect(hex(built.compiled.bytecode[0]!).includes(APPROVE_SELECTOR)).toBe(true);
  });

  it("Token(USDC) resolves its argument through the ambient chain define", () => {
    // `USDC` here is not a literal — it is the chain-scoped ambient define, resolved underneath.
    const built = openRoute(
      "base",
      `Token(USDC).transfer(${BigInt(SPENDER)}n, 5n);`,
      evmOptions(),
    ).reward(0n);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("an svm destination rejects Token(addr) with the EVM-only error", () => {
    expect(() =>
      openRoute("solana", `Token(${USDC}).approve(${BigInt(SPENDER)}n, 5n);`, {
        execution: { code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: "0x3333333333333333333333333333333333333333",
        prover: "0x4444444444444444444444444444444444444444",
        rewardDeadline: 1000n,
      }).reward(0n),
    ).toThrow(/svm/);
  });
});

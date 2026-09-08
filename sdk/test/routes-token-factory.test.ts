/**
 * `Token(addr)` — the DSL's global token WRAPPER. `token-rewrite.ts#rewriteTokenFactory` rewrites
 * `Token(<expr>)` -> `IERC20.at(<expr>)` before the compiler sees it, so `Token(addr).approve(...)`
 * and `let t = Token(addr); t.approve(...)` compile in a route body with no import — the same
 * textual-rewrite mechanism the `<Sym>.transfer(...)` sugar uses, and the reason this needs no
 * compiler feature (the compiler only ever sees the supported `IERC20.at(addr)` binding, never a
 * method call on a `Token(...)` result).
 */
import { rewriteTokenFactory } from "../src/routes/token-rewrite.js";
import { openRoute } from "../src/routes/index.js";
import type { IntentOptions } from "../src/routes/index.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const SPENDER = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
/** `approve(address,uint256)` selector — present iff the wrapper lowered to a real ERC20 approve. */
const APPROVE_SELECTOR = "095ea7b3";

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
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

describe("rewriteTokenFactory (unit)", () => {
  it("rewrites Token(addr) -> IERC20.at(addr) in a direct call chain", () => {
    const out = rewriteTokenFactory("Token(0x1).approve(a, b);");
    expect(out.rewrote).toBe(true);
    expect(out.sites).toBe(1);
    expect(out.source).toBe("IERC20.at(0x1).approve(a, b);");
  });

  it("rewrites the binding form, leaving the later method call to the compiler", () => {
    const out = rewriteTokenFactory("let t = Token(0x1);\nt.approve(a, b);");
    expect(out.source).toBe("let t = IERC20.at(0x1);\nt.approve(a, b);");
  });

  it("fires on ANY argument shape — a variable or an ambient symbol, not just a literal", () => {
    expect(rewriteTokenFactory("Token(USDC).approve(a, b);").source).toBe("IERC20.at(USDC).approve(a, b);");
    expect(rewriteTokenFactory("Token(addr).transfer(a, b);").source).toBe("IERC20.at(addr).transfer(a, b);");
  });

  it("rewrites every site", () => {
    const out = rewriteTokenFactory("Token(0x1).approve(a, b);\nToken(0x2).transfer(c, d);");
    expect(out.sites).toBe(2);
    expect(out.source).toBe("IERC20.at(0x1).approve(a, b);\nIERC20.at(0x2).transfer(c, d);");
  });

  it("is shadow-safe: a user-declared `Token` owns the name — nothing is rewritten", () => {
    // acorn (plain JS) parse, same as rewriteTokenMembers — route bodies carry no type annotations.
    const src = "function Token(x) { return x; }\nlet y = Token(5n);";
    expect(rewriteTokenFactory(src)).toEqual({ source: src, rewrote: false, sites: 0 });
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
    expect(rewriteTokenFactory(src)).toEqual({ source: src, rewrote: false, sites: 0 });
  });

  it.each([
    ["a parameter", "function f(Token) { return Token(0x11n).approve(a, b); }"],
    ["a destructured parameter", "function f({ Token }) { return Token(0x11n).approve(a, b); }"],
    ["a catch parameter", "try { g(); } catch (Token) { Token(0x11n).approve(a, b); }"],
  ])("leaves every `Token(...)` alone when the name is bound by %s", (_form, src) => {
    expect(rewriteTokenFactory(src)).toEqual({ source: src, rewrote: false, sites: 0 });
  });

  it("no `Token` at all: a no-op that never even parses", () => {
    const src = "IERC20.at(0x1).approve(a, b);";
    expect(rewriteTokenFactory(src)).toEqual({ source: src, rewrote: false, sites: 0 });
  });

  it("leaves a bare `Token` value (not a call) untouched", () => {
    // Only a Token(...) CALL is the wrapper; a bare value is left to fail closed as an undeclared name.
    expect(rewriteTokenFactory("let t = Token;").rewrote).toBe(false);
  });
});

describe("Token(addr) through openRoute", () => {
  it("Token(addr).approve(spender, amt) compiles and contains the ERC20 approve selector", () => {
    const built = openRoute("base", `Token(${USDC}).approve(${BigInt(SPENDER)}n, 5n);`, evmOptions()).reward(0n);
    const code = hex(built.compiled.bytecode[0]!);
    expect(code.length).toBeGreaterThan(0);
    expect(code.includes(APPROVE_SELECTOR)).toBe(true);
  });

  it("the binding form `let t = Token(addr); t.approve(...)` compiles the same bytes as the direct chain", () => {
    const direct = openRoute("base", `Token(${USDC}).approve(${BigInt(SPENDER)}n, 5n);`, evmOptions()).reward(0n);
    const bound = openRoute("base", `let t = Token(${USDC});\nt.approve(${BigInt(SPENDER)}n, 5n);`, evmOptions()).reward(0n);
    expect(Array.from(bound.compiled.bytecode[0]!)).toEqual(Array.from(direct.compiled.bytecode[0]!));
  });

  it("Token(USDC) resolves its argument through the ambient chain define", () => {
    // `USDC` here is not a literal — it is the chain-scoped ambient define, resolved underneath.
    const built = openRoute("base", `Token(USDC).transfer(${BigInt(SPENDER)}n, 5n);`, evmOptions()).reward(0n);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("an svm destination rejects Token(addr) with the EVM-only error", () => {
    expect(() =>
      openRoute("solana", `Token(${USDC}).approve(${BigInt(SPENDER)}n, 5n);`, {
        execution: { buffer: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", accounts: [] },
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

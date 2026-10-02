// SauceScript's boundary, checked against the compiler the SDK ships: what compiles, what the
// compiler refuses, what differs per target, and what compiling for a chain adds.
//
//   node saucescript.mts
import { stripVTControlCharacters } from "node:util";

import { routes } from "@eco-incorp/sauce";
import { compile, type CompileResult } from "@eco-incorp/sauce/compiler";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

function build(source: string, target: "evm" | "svm" = "evm") {
  const bytes = new TextEncoder().encode(source);
  return compile({
    target,
    entry: "main.ts",
    resolve: (p) => (p === "main.ts" ? bytes : undefined),
  });
}

function rejects(source: string, target: "evm" | "svm" = "evm"): string {
  try {
    build(source, target);
  } catch (error) {
    // Diagnostics carry ANSI styling; strip it before matching.
    return stripVTControlCharacters(String((error as Error).message));
  }
  throw new Error(`expected the compiler to reject:\n${source}`);
}

// A guarded program: a module const, a loop, a helper, `require` and `throw`.
// Either failure reverts the WHOLE surrounding transaction; nothing before it survives.
const guarded = `
const FLOOR = 1;

function sum(xs: Uint256[]): Uint256 {
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  return total;
}

function main(amounts: Uint256[], deadline: Uint256): Uint256 {
  if (ctx.timestamp() > deadline) {
    throw "expired";
  }
  const total = sum(amounts);
  require(total >= FLOOR);
  return total;
}
`;

const a: CompileResult = build(guarded);
check(a.entryEncoding === "abi-v1", "entry arguments default to ABI-v1");

// Outside the subset. Each one is a compile error, never a silently different program.
check(
  /unsupported construct/.test(
    rejects("function main(x: Uint256): Uint256 { switch (x) { case 1: return 1; } return 0; }"),
  ),
  "switch",
);
check(
  /unsupported construct/.test(
    rejects("function main(): void { try { require(false); } catch (e) {} }"),
  ),
  "try/catch",
);
check(
  /unsupported construct/.test(
    rejects('function main(x: Uint256): void { throw new Error("no"); }'),
  ),
  "throw new Error",
);
check(
  /not a context builtin/.test(rejects("function main(): Address { return ctx.caller(); }")),
  "the caller is ctx.msgSender(), not ctx.caller()",
);
// A negative amount is `-x`, two's complement, on both targets; `~x + 1` overflows at x = 0.
for (const target of ["evm", "svm"] as const)
  build("function main(x: Uint256): Uint256 { return -x; }", target);
check(
  /overflows 256 bits/.test(rejects("function main(): Uint256 { return ~0 + 1; }")),
  "~0 + 1 overflows",
);
check(
  /not a valid 256-bit literal/.test(rejects("function main(): Uint256 { return 1.5; }")),
  "no floats",
);
check(
  /overflows 256 bits/.test(rejects("function main(): Uint256 { return 0 - 1; }")),
  "checked arithmetic",
);

// Target differences: EVM-only context reads are refused on Solana with a reason.
check(
  /not available on the svm target/.test(
    rejects("function main(): Uint256 { return ctx.msgValue(); }", "svm"),
  ),
  "svm msgValue",
);
const svm = build(
  "function main(vault: Account<Writable>, amount: Uint256): Uint256 { return amount; }",
  "svm",
);
check(svm.manifest?.accounts[0]?.kind === "slot", "SVM Account parameters become manifest slots");

// A file compiled for a chain (`sauce compile --chain`, `routes.compileSauceProgram`) gets the
// chain's names and the token syntax lowered, and otherwise reaches the compiler as written.
const forChain = (source: string) => {
  try {
    return routes.compileSauceProgram("base", source);
  } catch (error) {
    return stripVTControlCharacters(String((error as Error).message));
  }
};
const compiled = (source: string) => {
  const result = forChain(source);
  check(typeof result !== "string", `compiles for a chain:\n${source}\n${String(result)}`);
  return result;
};
const typed = compiled(
  "function half(x: Uint256): Uint256 { return x / 2; }\nfunction main(to: Address, amount, items: { amount: Uint256, to: Address }[]) { USDC.transfer(to, half(amount)); require(items.length > 0); }",
);
check(
  typed.entryParams.map((p) => `${p.name}: ${p.type}`).join(", ") ===
    "to: Address, amount: Uint256, items: { amount: Uint256, to: Address }[]",
  "a parameter with no annotation is a Uint256",
);
compiled("function main(x: Uint256) { let y: Uint256 = x; require(y > 0); }"); // an annotated local
const records = compiled(
  "interface Order { amount: Uint256; to: Address; }\nfunction main(orders: Order[]) { for (const o of orders) { USDC.transfer(o.to, o.amount); } }",
);
check(
  records.entryParams[0]?.type === "{ amount: Uint256, to: Address }[]",
  "an interface parameter is encoded as the record it names",
);
compiled("function main(\n  a: Uint256,\n  b: Uint256,\n) { require(a > b); }"); // a trailing comma
// A script: its statements are the entry, beside its imports and helpers.
compiled(
  'import { balanceOf as held } from "@sauce/token";\nfunction twice(x: Uint256): Uint256 { return x * 2; }\nrequire(twice(held(USDC, ctx.self())) >= 0);',
);
compiled("require(chainId == 8453);");
// ...and its top-level consts are its own locals, which a helper cannot read.
check(
  /`FEE` is not a declared variable/.test(
    String(
      forChain(
        "const FEE = 3;\nfunction f(x: Uint256): Uint256 { return x * FEE; }\nrequire(f(1) == 3);",
      ),
    ),
  ),
  "a helper cannot read a script's const",
);

console.log(`guarded program: ${a.bytecode.length} bytes`);
console.log(`svm manifest: ${JSON.stringify(svm.manifest?.accounts)}`);

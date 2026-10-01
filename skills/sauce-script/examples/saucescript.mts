// SauceScript's boundary, checked against the compiler the SDK ships: what compiles, what a
// define changes, what the compiler refuses, what differs per target, and what compiling for a
// chain adds.
//
//   node saucescript.mts
import { stripVTControlCharacters } from "node:util";

import { routes } from "@eco-incorp/sauce";
import { compile, type CompileResult } from "@eco-incorp/sauce/compiler";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

function build(source: string, target: "evm" | "svm" = "evm", defines: [string, string][] = []) {
  const bytes = new TextEncoder().encode(source);
  return compile({
    target,
    entry: "main.ts",
    resolve: (p) => (p === "main.ts" ? bytes : undefined),
    defines,
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

// A guarded program: module const, a define-overridable floor, a loop, a helper, `require` and `throw`.
// Either failure reverts the WHOLE surrounding transaction; nothing before it survives.
const guarded = `
const FLOOR = 1n;

function sum(xs: Uint256[]): Uint256 {
  let total = 0n;
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
const b = build(guarded, "evm", [["FLOOR", "1000000"]]);
check(a.entryEncoding === "abi-v1", "entry arguments default to ABI-v1");
// A define is folded into the bytecode: a different value is a different program (and hash).
check(Buffer.compare(a.bytecode, b.bytecode) !== 0, "a define changes the bytecode");

// Outside the subset. Each one is a compile error, never a silently different program.
check(
  /unsupported construct/.test(
    rejects("function main(x: Uint256): Uint256 { switch (x) { case 1n: return 1n; } return 0n; }"),
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
// A negative amount is `-x`, two's complement, on both targets; `~x + 1n` overflows at x = 0.
for (const target of ["evm", "svm"] as const)
  build("function main(x: Uint256): Uint256 { return -x; }", target);
check(
  /overflows 256 bits/.test(rejects("function main(): Uint256 { return ~0n + 1n; }")),
  "~0n + 1n overflows",
);
check(
  /not a valid 256-bit literal/.test(rejects("function main(): Uint256 { return 1.5; }")),
  "no floats",
);
check(
  /overflows 256 bits/.test(rejects("function main(): Uint256 { return 0n - 1n; }")),
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

// A file compiled for a chain (`sauce compile --chain`, `routes.compileSauceProgram`) is read as
// JavaScript first, which adds rules of its own on top of the language.
const forChain = (source: string) => {
  try {
    return routes.compileSauceProgram("base", source);
  } catch {
    return undefined;
  }
};
const typed = forChain(
  "function half(x: Uint256): Uint256 { return x / 2n; }\nfunction main(to: Address, amount, items: { amount: Uint256, to: Address }[]) { USDC.transfer(to, half(amount)); require(items.length > 0n); }",
);
check(typed !== undefined, "annotations on main's and a helper's signature compile");
check(
  typed.entryParams.map((p) => `${p.name}: ${p.type}`).join(", ") ===
    "to: Address, amount: Uint256, items: { amount: Uint256, to: Address }[]",
  "a parameter with no annotation is a Uint256",
);
check(
  forChain("function main(x: Uint256) { let y: Uint256 = x; require(y > 0n); }") === undefined,
  "no annotation on a local",
);
check(
  forChain(
    "interface Order { amount: Uint256; }\nfunction main(x: Uint256) { require(x > 0n); }",
  ) === undefined,
  "no interface: an inline object type in a signature instead",
);
check(
  forChain("function main(\n  a: Uint256,\n  b: Uint256,\n) { require(a > b); }") === undefined,
  "no trailing comma after main's last parameter",
);
check(
  forChain("function twice(x) { return x * 2n; }\nrequire(twice(1n) == 2n);") === undefined,
  "a top-level script declares no function: a program with helpers declares main",
);
check(
  forChain("require(chainId == 8453n);") !== undefined,
  "a top-level script runs its statements",
);

console.log(
  `guarded program: ${a.bytecode.length} bytes (FLOOR=1) vs ${b.bytecode.length} (FLOOR=1e6)`,
);
console.log(`svm manifest: ${JSON.stringify(svm.manifest?.accounts)}`);

/**
 * The SauceScript reference's language cases: programs behind what `docs/api/saucescript.md` says
 * about the language itself — literals, operators, statements, functions, imports, limits — and
 * every rejection it quotes that no builtin's `unavailable` entry in `builtins.json` already
 * produces. `docs-saucescript.test.ts` compiles each one and holds the reference to them.
 *
 * A case either compiles on each of its `targets`, or, with `error`, fails on each with a message
 * containing it.
 */

export type Target = "evm" | "svm";

export interface LanguageCase {
  readonly name: string;
  readonly targets: readonly Target[];
  readonly source: string;
  /** A substring of the compiler's message; absent, the program must compile. */
  readonly error?: string;
  /** ABI bindings, by name, from `builtins.json`'s `abis` or `EXTRA_ABIS`. */
  readonly contracts?: readonly string[];
  /** Further modules the program imports, by path. */
  readonly files?: Readonly<Record<string, string>>;
  /** ABI files the program imports, by path: the name of an ABI in `abis` or `EXTRA_ABIS`. */
  readonly abiFiles?: Readonly<Record<string, string>>;
}

/** ABIs the cases bind beyond `builtins.json`'s. */
export const EXTRA_ABIS: Readonly<Record<string, string>> = {
  Router: JSON.stringify([
    {
      type: "function",
      name: "swap",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "tokenIn", type: "address" },
            { name: "amountIn", type: "uint256" },
            { name: "recipient", type: "address" },
          ],
        },
      ],
      outputs: [{ name: "amountOut", type: "uint256" }],
    },
  ]),
  Pair: JSON.stringify([
    {
      type: "function",
      name: "getReserves",
      stateMutability: "view",
      inputs: [],
      outputs: [
        { name: "reserve0", type: "uint112" },
        { name: "reserve1", type: "uint112" },
        { name: "blockTimestampLast", type: "uint32" },
      ],
    },
  ]),
};

const both: readonly Target[] = ["evm", "svm"];
const evm: readonly Target[] = ["evm"];
const svm: readonly Target[] = ["svm"];

const params = (n: number) => Array.from({ length: n }, (_, i) => `p${i}: Uint256`).join(", ");
const reads = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`).join(" + ");
const callWith = (n: number) =>
  `function main(a: Uint256): Uint256 { return f(${Array.from({ length: n }, (_, i) => `a + ${i}n`).join(", ")}); }`;

export const LANGUAGE_CASES: readonly LanguageCase[] = [
  // ---- §1 types ------------------------------------------------------------------------------
  {
    name: "an Account role is a compile error on the EVM",
    targets: evm,
    source: "function main(a: Account<Writable, Signer>): Uint256 { return a.address; }",
    error: "`an Account role` is not available on the evm target",
  },
  {
    name: "Account alone is an address on the EVM",
    targets: evm,
    source: "function main(a: Account): Uint256 { return a.address; }",
  },
  {
    name: "Account roles on the SVM",
    targets: svm,
    source: "function main(a: Account<Writable, Signer>, d: bytes): void { svm.sstore(a, 0n, d); }",
  },
  {
    name: "a Solidity type name",
    targets: evm,
    source: "function main(a: uint256): Uint256 { return a; }",
    error: "`uint256` is not a type",
  },
  {
    name: "a union type",
    targets: evm,
    source: "function main(a: Uint256 | bool): Uint256 { return 0n; }",
    error: "a union type is not supported",
  },
  {
    name: "Array<T>",
    targets: evm,
    source: "function main(a: Array<Uint256>): Uint256 { return 0n; }",
    error: "`Array` is not a type",
  },
  {
    name: "bytes where a scalar is needed",
    targets: evm,
    source: "function main(a: bytes, b: bytes): bool { return a == b; }",
    error: "a comparison operator requires a scalar value",
  },
  {
    name: "a value where bytes are needed",
    targets: evm,
    source: "function main(): void { revert(1n); }",
    error: "a revert payload requires a bytes value",
  },
  {
    name: "a bool where a number is needed",
    targets: evm,
    source: "function main(b: bool): Uint256 { return b + 1n; }",
    error: "expected a number, found a bool",
  },
  {
    name: "a value where an account is needed",
    targets: svm,
    source: "function main(a: Uint256): bytes { return svm.sload(a, 0n, 8n); }",
    error: "expected an account, found a value",
  },
  {
    name: "an interface",
    targets: both,
    source: "interface P { a: Uint256; b: bool }\nfunction main(p: P): Uint256 { return p.a; }",
  },

  // ---- §2 literals ---------------------------------------------------------------------------
  {
    name: "integer literals",
    targets: both,
    source:
      "const ONE_TOKEN = 1000000000000000000n;\nfunction main(): Uint256 { return ONE_TOKEN + 0xffn + 1_000n + 1 + 0xff + 1_000_000; }",
  },
  {
    name: "a bool literal",
    targets: both,
    source: "function main(): bool { let filled = true; return filled; }",
  },
  {
    name: "a text literal",
    targets: both,
    source: 'function main(held: Uint256): void { if (held == 0n) { throw "below floor"; } }',
  },
  {
    name: "an array literal",
    targets: both,
    source: "function main(): Uint256[] { const amounts = [100n, 200n]; return amounts; }",
  },
  {
    name: "a record literal with a shorthand field",
    targets: both,
    source:
      "function main(amount: Uint256, to: Address): Uint256 { const order = { amount, recipient: to }; return order.recipient; }",
  },
  {
    name: "an exponent literal",
    targets: evm,
    source: "function main(): Uint256 { return 1e18; }",
    error: "not a valid integer literal",
  },
  {
    name: "a decimal literal",
    targets: evm,
    source: "function main(): Uint256 { return 1.5; }",
    error: "`1.5` is not a valid 256-bit literal",
  },
  {
    name: "null",
    targets: evm,
    source: "function main(): Uint256 { let x = null; return 0n; }",
    error: "is not supported",
  },
  {
    name: "an untagged template literal",
    targets: both,
    source: "function main(): bytes { return `text`; }",
    error: "not supported",
  },
  {
    name: "an untagged template literal with a substitution",
    targets: evm,
    source: "function main(b: Uint256): bytes { return `a${b}`; }",
    error: "not supported",
  },
  {
    name: "a bad hex literal",
    targets: evm,
    source: "function main(): bytes { return hex`abc`; }",
    error: "is not a valid hex literal",
  },
  {
    name: "an untyped empty array",
    targets: evm,
    source: "function main(): Uint256 { let a = []; return 0n; }",
    error: "an array literal must have at least one element",
  },
  {
    name: "a typed empty array",
    targets: both,
    source: "function main(): Uint256 { let xs: Uint256[] = []; return xs.length; }",
  },
  {
    name: "a mixed array",
    targets: evm,
    source: "function main(): Uint256 { const a = [1n, true]; return 0n; }",
    error: "every element of an array literal must have the same type",
  },

  // ---- §3 operators --------------------------------------------------------------------------
  {
    name: "arithmetic and bitwise operators",
    targets: both,
    source:
      "function main(a: Uint256, b: Uint256): Uint256 { return ((a + b) * (a - b) / b % 7n) ** 2n + (a & b | a ^ b) + (a << 2n) + (b >> 1n) + ~a; }",
  },
  {
    name: "a constant overflow",
    targets: evm,
    source: "function main(): Uint256 { return 0n - 1n; }",
    error: "constant `-` expression overflows 256 bits",
  },
  {
    name: "a constant division by zero",
    targets: evm,
    source: "function main(): Uint256 { return 1n / 0n; }",
    error: "constant `/` expression divides by zero",
  },
  {
    name: "negation with -x",
    targets: both,
    source: "function main(x: Uint256): Uint256 { return -x; }",
  },
  {
    name: "-1n is the maximum value",
    targets: both,
    source: "function main(): Uint256 { return -1n; }",
  },
  {
    name: "~x + 1n is a checked add, and a constant one overflows",
    targets: evm,
    source: "function main(): Uint256 { return ~0n + 1n; }",
    error: "constant `+` expression overflows 256 bits",
  },
  {
    name: "comparisons and logic",
    targets: both,
    source:
      "function main(a: Uint256, b: Uint256): bool { return (a < b || a <= b) && (a > b || a >= b) && a == b && a === b && a != b && a !== b && !(a > 1n); }",
  },
  {
    name: "the two arms of ?:",
    targets: evm,
    source: 'function main(a: Uint256): Uint256 { return a > 1n ? a : "x"; }',
    error: "the two arms of `? :` must have the same type",
  },
  {
    name: "compound assignment",
    targets: both,
    source:
      "function main(i: Uint256): Uint256 { i += 1n; i -= 1n; i *= 2n; i /= 2n; i %= 9n; i **= 2n; i &= 7n; i |= 1n; i ^= 2n; i <<= 1n; i >>= 1n; return i; }",
  },
  {
    name: "a compound assignment to an array element",
    targets: evm,
    source: "function main(a: Uint256[]): Uint256 { a[0] += 1n; return a[0]; }",
    error: "a compound assignment to an array element",
  },
  {
    name: "a compound assignment to a tuple field",
    targets: evm,
    source: "function main(): Uint256 { const t = { f: 1n }; t.f += 1n; return t.f; }",
    error: "a compound assignment to a tuple field",
  },
  {
    name: "++ as a statement",
    targets: both,
    source: "function main(i: Uint256): Uint256 { i++; ++i; i--; --i; return i; }",
  },
  {
    name: "++ as a value",
    targets: evm,
    source: "function main(i: Uint256): Uint256 { return i++; }",
    error: "`++`/`--` as a value",
  },
  {
    name: "accounts ordered",
    targets: svm,
    source: "function main(a: Account, b: Account): bool { return a < b; }",
    error: "accounts compare for identity only",
  },
  {
    name: ">>>",
    targets: evm,
    source: "function main(a: Uint256, b: Uint256): Uint256 { return a >>> b; }",
    error: "the `>>>` operator is not supported",
  },
  {
    name: "??",
    targets: evm,
    source: "function main(a: Uint256): Uint256 { return a ?? 1n; }",
    error: "the `??` operator is not supported",
  },
  {
    name: "typeof",
    targets: evm,
    source: "function main(a: Uint256): Uint256 { return typeof a; }",
    error: "the `typeof` operator is not supported",
  },
  {
    name: "unary +",
    targets: evm,
    source: "function main(a: Uint256): Uint256 { return +a; }",
    error: "the `+` operator is not supported",
  },

  // ---- §4 variables, control flow, functions, modules ----------------------------------------
  {
    name: "reassigning another type",
    targets: evm,
    source: "function main(): Uint256 { let a = 1n; a = hex`01`; return 0n; }",
    error: "`a` cannot be reassigned a value of a different type",
  },
  {
    name: "reassigning a const",
    targets: evm,
    source: "function main(): Uint256 { const a = 1n; a = 2n; return a; }",
    error: "`a` is declared `const` and cannot be reassigned",
  },
  {
    name: "a computed tuple index",
    targets: evm,
    source: "function main(i: Uint256): Uint256 { const t = { a: 1n, b: 2n }; return t[i]; }",
    error: "a tuple index must be a number literal or a `const` bound to one",
  },
  {
    name: "an out-of-range constant index",
    targets: evm,
    source: "function main(): Uint256 { const a = [1n, 2n]; a[5] = 3n; return 0n; }",
    error: "array index 5 is out of range",
  },
  {
    name: "destructuring a call that produces a record",
    targets: evm,
    contracts: ["Pair"],
    source:
      "function main(p: Address): Uint256 { const [a, b, c] = Pair.at(p).getReserves(); return a + b + c; }",
  },
  {
    name: "destructuring an array literal",
    targets: evm,
    source: "function main(): Uint256 { const [a, b] = [1n, 2n]; return a; }",
    error: "a destructuring binding needs an initializer that produces a tuple",
  },
  {
    name: "destructuring an array variable",
    targets: evm,
    source: "function main(xs: Uint256[]): Uint256 { const [a] = xs; return a; }",
    error: "a destructuring binding needs an initializer that produces a tuple",
  },
  {
    name: "new Array",
    targets: both,
    source:
      "function main(n: Uint256): Uint256[] { const xs = new Array(n); xs[0] = 1n; return xs; }",
  },
  {
    name: "control flow",
    targets: both,
    source:
      "function main(xs: Uint256[]): Uint256 { let s = 0n; for (const x of xs) { s += x; } for (let i = 0n; i < 10n; i++) { if (i == 3n) { continue; } if (i == 7n) { break; } s += i; } while (s > 100n) { s -= 1n; } if (s > 5n) { s = 5n; } else { s = 0n; } return s; }",
  },
  {
    name: "recursion and helpers calling helpers",
    targets: both,
    source:
      "function g(x: Uint256): Uint256 { return x + 1n; }\nfunction f(x: Uint256): Uint256 { if (x == 0n) { return 0n; } return g(x) + f(x - 1n); }\nfunction main(a: Uint256): Uint256 { return f(a); }",
  },
  {
    name: "an unannotated bytes return",
    targets: evm,
    source: "function f() { return hex`01`; }\nfunction main(): bytes { return f(); }",
    error:
      "returning a bytes value from a function other than `main` needs a return-type annotation",
  },
  {
    name: "a missing return",
    targets: evm,
    source:
      "function f(a: Uint256): Uint256 { if (a > 1n) { return 1n; } }\nfunction main(): Uint256 { return f(2n); }",
    error: "`f` does not return on every path",
  },
  {
    name: "a bare return in a void function",
    targets: both,
    source: "function main(): void { return; }",
  },
  {
    name: "a void call as a value",
    targets: evm,
    source: "function f(): void { }\nfunction main(): Uint256 { let x = f(); return 0n; }",
    error: "a call to a `: void` function produces no value, so its result can't be used as one",
  },
  {
    name: "calling main",
    targets: evm,
    source: "function f(): Uint256 { return main(); }\nfunction main(): Uint256 { return 0n; }",
    error: "the entry point (`main`) cannot be called",
  },
  {
    name: "seventeen parameters, each read once",
    targets: both,
    source: `function f(${params(17)}): Uint256 { return ${reads(17)}; }\n${callWith(17)}`,
  },
  {
    name: "seventeen parameters with the first read again",
    targets: both,
    source: `function f(${params(17)}): Uint256 { return ${reads(17)} + p0; }\n${callWith(17)}`,
    error: "`f` does not fit",
  },
  {
    name: "sixteen parameters with a local held beside them",
    targets: both,
    source: `function f(${params(16)}): Uint256 { const k = p0 * 2n; return ${reads(16)} + k; }\n${callWith(16)}`,
    error: "`f` does not fit",
  },
  {
    name: "main is not limited to sixteen parameters",
    targets: both,
    source: `function main(${params(20)}): Uint256 { return ${reads(20)} + p0; }`,
  },
  { name: "a script", targets: both, source: "const x = ctx.timestamp();\nlog(x.toBytesBe(32n));" },
  {
    name: "a script's top-level const is a local of its entry",
    targets: evm,
    source: "const FEE = 5n;\nfunction f(): Uint256 { return FEE; }\nrequire(f() > 0n);",
    error: "`FEE` is not a declared variable",
  },
  { name: "a script cannot return", targets: evm, source: "return 7n;", error: "parsing produced" },
  {
    name: "a module's const is read by its functions",
    targets: both,
    source:
      "const FEE = 5n;\nfunction f(): Uint256 { return FEE; }\nfunction main(): void { require(f() > 0n); }",
  },
  {
    name: "a module-level let is scratch space",
    targets: both,
    source:
      "let counter = 5n;\nfunction bump(): void { counter = counter + 1n; }\nfunction main(): Uint256 { bump(); return counter; }",
  },
  {
    name: "a module const from other consts",
    targets: both,
    source: "const A = 2n;\nconst B = A * 3n;\nfunction main(): Uint256 { return B; }",
  },
  {
    name: "named imports of a module",
    targets: both,
    files: {
      "lib.ts":
        "export const FEE = 30n;\nexport interface P { a: Uint256 }\nexport function f(x: Uint256): Uint256 { return x + FEE; }",
    },
    source:
      'import { f, FEE, P } from "./lib.ts";\nfunction main(p: P): Uint256 { return f(p.a) + FEE; }',
  },
  {
    name: "a JSON data import",
    targets: evm,
    files: { "config.json": '{"fee": 30}' },
    source:
      'import cfg from "./config.json" with { type: "json" };\nfunction main(): Uint256 { return cfg.fee; }',
  },
  {
    name: "an ABI import",
    targets: evm,
    abiFiles: { "erc20.abi.json": "ERC20" },
    source:
      'import ERC20 from "./erc20.abi.json";\nfunction main(t: Address): Uint256 { return ERC20.at(t).balanceOf(ctx.self()); }',
  },
  {
    name: "a package import",
    targets: evm,
    source:
      'import { approve } from "@sauce/token";\nfunction main(t: Address, s: Address, a: Uint256): void { approve(t, s, a); }',
  },
  {
    name: "a subpath import",
    targets: evm,
    source: 'import { approve } from "@sauce/token/token.evm.js";\nfunction main(): void { }',
    error: "subpath imports are not supported",
  },
  {
    name: "a default import of a module",
    targets: evm,
    files: { "lib.js": "export function f(x: Uint256): Uint256 { return x; }" },
    source: 'import L from "./lib.js";\nfunction main(): Uint256 { return 0n; }',
    error: "a `.js` module import must be named",
  },
  {
    name: "main's array and record arguments",
    targets: both,
    source:
      "function main(xs: Uint256[], o: { a: Uint256, b: bytes }): Uint256 { return xs[0] + o.a; }",
  },

  // ---- §5 require, revert, throw, log, eval --------------------------------------------------
  {
    name: "require with a payload",
    targets: both,
    source:
      'function main(out: Uint256, minOut: Uint256): void { require(out >= minOut, "slippage"); }',
  },
  {
    name: "require with three arguments",
    targets: evm,
    source: 'function main(x: Uint256): void { require(x > 0n, "a", "b"); }',
    error: "`require` takes 1 or 2 arguments (a condition and an optional bytes payload), got 3",
  },
  {
    name: "require on bytes",
    targets: evm,
    source: "function main(d: bytes): void { require(d); }",
    error: "a `require` condition requires a scalar value",
  },
  {
    name: "require as a value",
    targets: evm,
    source: "function main(x: Uint256): Uint256 { let y = require(x > 0n); return x; }",
    error: "`require` aborts execution and produces no value — use it as a statement",
  },
  {
    name: "revert with two arguments",
    targets: evm,
    source: 'function main(): void { revert("a", "b"); }',
    error: "`revert` takes at most 1 argument (an optional bytes payload), got 2",
  },
  {
    name: "throw a number",
    targets: evm,
    source: "function main(): void { throw 1n; }",
    error: "a `throw` payload requires a bytes value",
  },
  {
    name: "log with topics on the EVM",
    targets: evm,
    source:
      "const TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efn;\nfunction main(from: Address, to: Address, amount: Uint256): void { log(abi.encode(from, to, amount), TRANSFER_TOPIC); }",
  },
  {
    name: "log with topics on the SVM",
    targets: svm,
    source: "function main(d: bytes): void { log(d, 1n); }",
    error: "`log with topics` is not available on the svm target",
  },
  {
    name: "log with nothing",
    targets: evm,
    source: "function main(): void { log(); }",
    error: "`log` requires a bytes data payload — `log()` records nothing",
  },
  {
    name: "log with five topics",
    targets: evm,
    source: "function main(d: bytes): void { log(d, 1n, 2n, 3n, 4n, 5n); }",
    error: "`log` carries at most 4 indexed topics after its data payload, got 5",
  },
  {
    name: "eval with nothing",
    targets: evm,
    source: "function main(): bytes { return eval(); }",
    error: "`eval` requires bytecode to run — `eval()` has nothing to execute",
  },
  {
    name: "eval with seventeen arguments",
    targets: evm,
    source: `function main(c: bytes): bytes { return eval(c, ${Array.from({ length: 17 }, (_, i) => `${i}n`).join(", ")}); }`,
    error: "`eval` takes at most 16 arguments after its bytecode, got 17",
  },
  {
    name: "eval with a bytes argument",
    targets: evm,
    source: "function main(c: bytes): bytes { return eval(c, c); }",
    error: "an eval argument requires a scalar value",
  },
  {
    name: "a function named log",
    targets: evm,
    source:
      "function log(x: Uint256): Uint256 { return x; }\nfunction main(): Uint256 { return 1n; }",
    error: "`log` is a reserved builtin and cannot be a function name",
  },

  // ---- §6 ctx --------------------------------------------------------------------------------
  {
    name: "ctx read without a call",
    targets: evm,
    source: "function main(): Uint256 { return ctx.self; }",
    error: "`ctx` is not a declared variable",
  },
  {
    name: "ctx.balance of an account",
    targets: svm,
    source: "function main(a: Account): Uint256 { return ctx.balance(a); }",
    error: "ctx.balance's address: expected a value, found an account",
  },
  {
    name: "ctx with an argument too many",
    targets: evm,
    source: "function main(): Uint256 { return ctx.timestamp(1n); }",
    error: "`ctx.timestamp` takes 0 argument(s), but this call passes 1",
  },
  {
    name: "an unknown ctx read",
    targets: evm,
    source: "function main(): Uint256 { return ctx.origin(); }",
    error: "`ctx.origin` is not a context builtin",
  },
  {
    name: "a bare gasLeft()",
    targets: evm,
    source: "function main(): Uint256 { return gasLeft(); }",
    error: "write `ctx.gasLeft()` instead",
  },

  // ---- §7 crypto -----------------------------------------------------------------------------
  {
    name: "keccak256 of a number",
    targets: evm,
    source: "function main(): Uint256 { return crypto.keccak256(1n); }",
    error: "keccak256's argument requires a bytes value",
  },
  {
    name: "ecdsaVerify with a number signature",
    targets: evm,
    source: "function main(h: Uint256): bool { return crypto.ecdsaVerify(h, 1n, 2n); }",
    error: "ecdsaVerify's signature requires a bytes value",
  },
  {
    name: "findPDA as a value",
    targets: evm,
    source:
      "function main(p: Uint256): Uint256 { let x = crypto.findPDA(p, [hex`01`]); return 0n; }",
    error: "`crypto.findPDA` produces two values — bind them by destructuring",
  },
  {
    name: "findPDA's bump alone",
    targets: both,
    source:
      "function main(p: Uint256): Uint256 { const [, bump] = crypto.findPDA(p, [hex`01`]); return bump; }",
  },
  {
    name: "findPDA with number seeds",
    targets: evm,
    source:
      "function main(p: Uint256): Uint256 { const [a, b] = crypto.findPDA(p, [1n, 2n]); return a; }",
    error: "`crypto.findPDA`'s seeds argument must be a `bytes[]`, got",
  },
  {
    name: "an unknown crypto function",
    targets: evm,
    source: "function main(d: bytes): Uint256 { return crypto.sha256(d); }",
    error: "`crypto.sha256` is not a crypto intrinsic",
  },

  // ---- §8 Math -------------------------------------------------------------------------------
  {
    name: "Math.min",
    targets: evm,
    source: "function main(a: Uint256, b: Uint256): Uint256 { return Math.min(a, b); }",
    error: "`Math.min` is not a Math intrinsic",
  },
  {
    name: "a signed comparison returned as a bool",
    targets: evm,
    source: "function main(a: Uint256, b: Uint256): bool { return Math.sLt(a, b); }",
    error: "a return value: expected a bool, found a number",
  },
  {
    name: "Math with an argument too many",
    targets: evm,
    source: "function main(a: Uint256): Uint256 { return Math.sqrt(a, a); }",
    error: "`Math.sqrt` takes 1 argument(s), but this call passes 2",
  },

  // ---- §9 abi --------------------------------------------------------------------------------
  {
    name: "abi.encode of nothing",
    targets: evm,
    source: "function main(): bytes { return abi.encode(); }",
    error: "abi.encode requires at least one value to encode",
  },
  {
    name: "abi.encode of 256 values",
    targets: evm,
    source: `function main(a: Uint256): bytes { return abi.encode(${Array.from({ length: 256 }, () => "a").join(", ")}); }`,
    error: "abi.encode has 256 arguments, beyond the 255",
  },
  {
    name: "abi.decode with a Solidity field type",
    targets: evm,
    source:
      'function main(d: bytes): Uint256 { const t = abi.decode(d, ["uint256"]); return t[0]; }',
    error: "`uint256` is not an abi.decode field type",
  },
  {
    name: "abi.decode with one argument",
    targets: evm,
    source: "function main(d: bytes): Uint256 { const t = abi.decode(d); return t[0]; }",
    error: "abi.decode takes exactly 2 arguments (data, shape), got 1",
  },
  {
    name: "abi.decode of a number",
    targets: evm,
    source: 'function main(): Uint256 { const t = abi.decode(1n, ["Uint256"]); return t[0]; }',
    error: "abi.decode's first argument must be bytes",
  },
  {
    name: "abi.decode with shapes in a variable",
    targets: evm,
    source:
      'function main(d: bytes): Uint256 { const s = ["Uint256"]; const t = abi.decode(d, s); return t[0]; }',
    error: "abi.decode's second argument must be an array literal of shape strings",
  },
  {
    name: "a name on an abi.decode result",
    targets: evm,
    source:
      'function main(d: bytes): Uint256 { const t = abi.decode(d, ["Uint256"]); return t.amount; }',
    error: "field(s) are unnamed, so `.amount` resolves against nothing",
  },
  {
    name: "abi.decode shapes",
    targets: evm,
    source:
      'function main(d: bytes): bool { const t = abi.decode(d, ["Uint256", "Address", "bool", "bytes", "string", "number", "bigint", "boolean", "Uint256[]", "{Uint256, bool}"]); return t[2]; }',
  },

  // ---- §10 evm -------------------------------------------------------------------------------
  {
    name: "evm.call with two arguments",
    targets: evm,
    source: "function main(a: Uint256, d: bytes): bytes { return evm.call(a, d); }",
    error: "`evm.call()` expects 3 argument(s), but this call passes 2",
  },
  {
    name: "evm.call with number calldata",
    targets: evm,
    source: "function main(a: Uint256): bytes { return evm.call(a, 0n, 1n); }",
    error: "`evm.call()`'s calldata argument must be bytes",
  },
  {
    name: "evm.sstore as a value",
    targets: evm,
    source: "function main(s: Uint256): Uint256 { let x = evm.sstore(s, 1n); return 0n; }",
    error: "`evm.sstore` writes storage and produces no value — use it as a statement",
  },
  {
    name: "an unknown evm function",
    targets: evm,
    source: "function main(): Uint256 { return evm.create(1n); }",
    error: "`evm.create` is not an evm builtin; `evm` is a reserved namespace root",
  },

  // ---- §11 svm -------------------------------------------------------------------------------
  {
    name: "svm.sstore to a plain account",
    targets: svm,
    source: "function main(state: Account, d: bytes): void { svm.sstore(state, 0n, d); }",
    error: "`state` is not declared writable, so `svm.sstore` may not write it",
  },
  {
    name: "svm.sstore to a writable account",
    targets: svm,
    source: "function main(state: Account<Writable>, d: bytes): void { svm.sstore(state, 0n, d); }",
    error: "`state` is not declared a signer, so `svm.sstore` may not write it",
  },
  {
    name: "svm.sstore of a number",
    targets: svm,
    source: "function main(state: Account<Writable, Signer>): void { svm.sstore(state, 0n, 5n); }",
    error: "svm.sstore's value requires a bytes value",
  },
  {
    name: "svm.call to a number",
    targets: svm,
    source: "function main(d: bytes): bytes { return svm.call(1n, [], d); }",
    error: "svm.call's program — declare the callee as an `Account` param",
  },
  {
    name: "svm.call with numbers for accounts",
    targets: svm,
    source: "function main(p: Account, d: bytes): bytes { return svm.call(p, [0n, 1n], d); }",
    error: "`svm.call`'s accounts argument must be an array of accounts",
  },
  {
    name: "svm.call with no accounts",
    targets: svm,
    source: "function main(p: Account, d: bytes): bytes { return svm.call(p, [], d); }",
  },
  {
    name: "svm.remainingAccount with two indexes",
    targets: svm,
    source: "function main(): Uint256 { return svm.remainingAccount(0n, 1n).address; }",
    error: "`svm.remainingAccount` takes one index, got 2",
  },
  {
    name: "svm.remainingAccounts as a value",
    targets: svm,
    source:
      "function main(p: Account, d: bytes): bytes { return svm.call(p, svm.remainingAccounts(), d); }",
    error: "`svm.remainingAccounts()` can only initialize a `let`/`const`",
  },
  {
    name: "an unknown svm function",
    targets: svm,
    source: "function main(): Uint256 { return svm.rent(); }",
    error: "`svm.rent` is not an svm builtin; `svm` is a reserved namespace root",
  },

  // ---- §12 methods and account properties ----------------------------------------------------
  {
    name: "slice on an array",
    targets: evm,
    source: "function main(xs: Uint256[]): Uint256[] { return xs.slice(0n, 1n); }",
    error: "a bytes method's receiver requires a bytes value",
  },
  {
    name: "slice with one argument",
    targets: evm,
    source: "function main(b: bytes): bytes { return b.slice(1n); }",
    error: "`.slice` takes exactly 2 arguments (start, end), got 1",
  },
  {
    name: "concat of a number",
    targets: evm,
    source: "function main(b: bytes): bytes { return b.concat(1n); }",
    error: "a `.concat` argument requires a bytes value",
  },
  {
    name: "a width of 33",
    targets: evm,
    source: "function main(x: Uint256): bytes { return x.toBytesBe(33n); }",
    error: "a `.toBytesBe`/`.toBytesLe` width must be between 1 and 32 bytes, got 33",
  },
  {
    name: "length on a record",
    targets: evm,
    source: "function main(): Uint256 { const t = { a: 1n, b: 2n }; return t.length; }",
    error: "`length` is not a field of this tuple",
  },
  {
    name: "a method on a literal",
    targets: evm,
    source: "function main(d: bytes): bytes { return hex`a9059cbb`.concat(d); }",
    error: "calling anything other than a plain function name",
  },
  {
    name: "writing an account property",
    targets: svm,
    source: "function main(a: Account): void { a.owner = 1n; }",
    error: "`.owner` is read-only",
  },
  {
    name: "an account returned",
    targets: svm,
    source: "function main(a: Account): Account { return a; }",
    error: "a return value can't be an account",
  },
  {
    name: "an account in arithmetic",
    targets: svm,
    source: "function main(a: Account): Uint256 { return a + 1n; }",
    error: "expected a number, found an account",
  },
  {
    name: "accounts compared for identity",
    targets: both,
    source: "function main(a: Account, b: Account): void { require(a != b); }",
  },

  // ---- §13 contract bindings and .catch() ----------------------------------------------------
  {
    name: "a record of several outputs",
    targets: evm,
    contracts: ["Pair"],
    source:
      "function main(p: Address): Uint256 { return Pair.at(p).getReserves().reserve1 + Pair.at(p).getReserves()[0]; }",
  },
  {
    name: "a bound call's bool output is a number",
    targets: evm,
    contracts: ["ERC20"],
    source: "function main(t: Address, to: Address): bool { return ERC20.at(t).transfer(to, 5n); }",
    error: "a return value: expected a bool, found a number",
  },
  {
    name: "comparing a bound call's bool output",
    targets: evm,
    contracts: ["ERC20"],
    source:
      "function main(t: Address, to: Address, x: Uint256): bool { return ERC20.at(t).transfer(to, x) == 1n; }",
  },
  {
    name: "a struct argument as a record in any order",
    targets: evm,
    contracts: ["Router"],
    source:
      "function main(r: Address, to: Address): Uint256 { return Router.at(r).swap({ recipient: to, amountIn: 1n, tokenIn: r }); }",
  },
  {
    name: "an unknown method",
    targets: evm,
    contracts: ["ERC20"],
    source: "function main(t: Address): Uint256 { return ERC20.at(t).allowance(t, t); }",
    error: "`ERC20` has no method named `allowance`",
  },
  {
    name: "a method with too few arguments",
    targets: evm,
    contracts: ["ERC20"],
    source: "function main(t: Address): Uint256 { return ERC20.at(t).transfer(t); }",
    error: "`ERC20.transfer()` expects 2 argument(s), but this call passes 1",
  },
  {
    name: ".at with two arguments",
    targets: evm,
    contracts: ["ERC20"],
    source: "function main(t: Address): Uint256 { return ERC20.at(t, t).totalSupply(); }",
    error: "`.at()` (a contract binding) takes exactly 1 argument (the address)",
  },
  {
    name: "a .catch handler parameter",
    targets: evm,
    contracts: ["ERC20"],
    source:
      "function main(t: Address, s: Address): void { ERC20.at(t).approve(s, 1n).catch((e) => { }); }",
    error: "a `.catch()` handler parameter (the caught error is not supported)",
  },
  {
    name: "a .catch handler that returns in the statement form",
    targets: evm,
    contracts: ["ERC20"],
    source:
      "function main(t: Address, o: Address): Uint256 { let v = 0n; ERC20.at(t).balanceOf(o).catch(() => { v = 1n; return 0n; }); return v; }",
    error: "a `return` in a `.catch()` handler",
  },
  {
    name: "a captured .catch without a return",
    targets: evm,
    contracts: ["ERC20"],
    source:
      'function main(t: Address, o: Address): Uint256 { const v = ERC20.at(t).balanceOf(o).catch(() => { log("x"); }); return v; }',
    error: "a captured `.catch()` requires exactly `return <constant scalar>;` in its handler",
  },
  {
    name: "a .catch fallback that is not constant",
    targets: evm,
    contracts: ["ERC20"],
    source:
      "function main(t: Address, o: Address, k: Uint256): Uint256 { return ERC20.at(t).balanceOf(o).catch(() => { return k; }); }",
    error:
      "the `.catch()` fallback must be a constant scalar that fits the declared ABI result width",
  },
  {
    name: "a .catch handler too long",
    targets: evm,
    contracts: ["ERC20"],
    source: `function main(t: Address, s: Address): Uint256 { let v = 0n; ERC20.at(t).approve(s, 1n).catch(() => { ${Array.from({ length: 60 }, (_, i) => `v = v + ${i}n;`).join(" ")} }); return v; }`,
    error: "a `.catch()` handler is",
  },
  {
    name: "a .catch on something other than an external call",
    targets: svm,
    source: "function main(p: Account, d: bytes): void { svm.call(p, [], d).catch(() => { }); }",
    error: "a `.catch()` on something other than an external contract call",
  },
  {
    name: ".catch on a raw evm.call",
    targets: evm,
    source: "function main(a: Address, d: bytes): void { evm.call(a, 0n, d).catch(() => { }); }",
  },

  // ---- §14 not supported ---------------------------------------------------------------------
  {
    name: "switch",
    targets: evm,
    source: "function main(a: Uint256): Uint256 { switch (a) { case 1n: return 1n; } return 0n; }",
    error: "a `switch` statement is not supported",
  },
  {
    name: "do/while",
    targets: evm,
    source: "function main(): Uint256 { do { } while (false); return 1n; }",
    error: "a `do`/`while` loop is not supported",
  },
  {
    name: "try/catch",
    targets: evm,
    source: "function main(): void { try { } catch (e) { } }",
    error: "a `try`/`catch` statement is not supported",
  },
  {
    name: "a nested function",
    targets: evm,
    source: "function main(): Uint256 { function f(): Uint256 { return 1n; } return f(); }",
    error: "a nested function declaration is not supported",
  },
  {
    name: "a type alias",
    targets: evm,
    source: "type P = { a: Uint256 };\nfunction main(): Uint256 { return 1n; }",
    error: "a `type` alias declaration",
  },
  {
    name: "as",
    targets: evm,
    source: "function main(a: Uint256): Uint256 { return a as Uint256; }",
    error: "an `as` cast is not supported",
  },
  {
    name: "object destructuring",
    targets: evm,
    source: "function main(): Uint256 { const { a } = { a: 1n }; return a; }",
    error: "a destructuring binding (bind a plain variable instead)",
  },
  {
    name: "a spread",
    targets: evm,
    source: "function main(a: Uint256[]): Uint256[] { return [...a]; }",
    error: "a spread element in an array literal",
  },
  {
    name: "optional chaining",
    targets: evm,
    source: "function main(t: { a: Uint256 }): Uint256 { return t?.a; }",
    error: "an optional member access",
  },
  {
    name: "Math.pow",
    targets: evm,
    source: "function main(): Uint256 { return Math.pow(2n, 3n); }",
    error: "`Math.pow` is not a Math intrinsic",
  },
  {
    name: "throw new Error",
    targets: evm,
    source: 'function main(): void { throw new Error("x"); }',
    error: "`new` on anything other than `Array`",
  },
];

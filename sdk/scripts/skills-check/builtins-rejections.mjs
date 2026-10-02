// The rejections the SauceScript reference (skills/sauce-script/references/builtins.md) documents, each as
// a minimal program the compiler must refuse. `quotes` are error messages copied verbatim from the
// reference, where `N`, `…` and a `<placeholder>` stand for text it elides; `row` is the first cell
// of a row of its "Not supported" table. The checker compiles every program on its targets and
// requires the failure, requires the compiler's message to match each quote, and requires every
// message the reference quotes and every row of that table to be claimed here.

const ERC20 = JSON.stringify([
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
]);
const contracts = [["ERC20", ERC20]];
const many = (n, value) => Array.from({ length: n }, () => value).join(", ");
const long = Array.from({ length: 60 }, (_, i) => `v = v + ${i}n;`).join(" ");

export const rejections = [
  // Types and literals
  {
    quotes: [
      "`an Account role` is not available on the evm target; an `Account` is an address value on the EVM — write `Account` alone",
    ],
    targets: ["evm"],
    src: "function main(a: Account<Writable>): void { }",
  },
  {
    quotes: [
      "`uint256` is not a type — write `Uint256`, `Address`, `Account`, `bool`, `bytes` or `string`, an array `T[]`, an inline object type `{ a: Uint256 }` for a tuple …",
    ],
    targets: ["evm"],
    src: "function main(a: uint256): void { }",
  },
  {
    quotes: ["`<what>` requires a scalar value", "a `require` condition requires a scalar value"],
    targets: ["evm", "svm"],
    src: "function main(d: bytes): void { require(d); }",
  },
  {
    quotes: ["`<what>` requires a bytes value", "keccak256's argument requires a bytes value"],
    targets: ["evm", "svm"],
    src: "function main(): Uint256 { return crypto.keccak256(1n); }",
  },
  {
    quotes: ["`<what>`: expected a number, found a bool"],
    targets: ["evm", "svm"],
    src: "function main(flag: bool): Uint256 { return flag + 1n; }",
  },
  // A bool passed to a parameter with no annotation, which is therefore a number.
  {
    quotes: ["a function argument: expected a number, found a bool"],
    targets: ["evm", "svm"],
    src: "function pick(a: Uint256, b: Uint256, first) { if (first) { return a; } return b; } function main(a: Uint256, b: Uint256): Uint256 { return pick(a, b, a > b); }",
  },
  {
    quotes: [
      "`<what>`: expected an account, found a value",
      "svm.sload's account: expected an account, found a value",
    ],
    targets: ["svm"],
    src: "function main(a: Uint256): bytes { return svm.sload(a, 0n, 8n); }",
  },
  {
    quotes: [
      "`<name>` is not available on the `<evm|svm>` target",
      "`abi.encode` is not available on the svm target",
    ],
    targets: ["svm"],
    src: "function main(a: Uint256): bytes { return abi.encode(a); }",
  },
  {
    quotes: ["not a valid integer literal"],
    row: "`1e18`, `1.5`, `null`, `undefined`",
    targets: ["evm"],
    src: "function main(): Uint256 { return 1e18; }",
  },
  {
    quotes: ["`1.5` is not a valid 256-bit literal"],
    row: "`1e18`, `1.5`, `null`, `undefined`",
    targets: ["evm"],
    src: "function main(): Uint256 { return 1.5; }",
  },
  {
    row: "`1e18`, `1.5`, `null`, `undefined`",
    targets: ["evm"],
    src: "function main(): Uint256 { const x = null; return 0n; }",
  },
  {
    quotes: [
      "`hex`…`` is not a valid hex literal (expected an even number of `[0-9a-fA-F]` digits, optional `0x` prefix)",
    ],
    targets: ["evm"],
    src: "function main(): bytes { return hex`abc`; }",
  },
  {
    quotes: ["an array literal must have at least one element"],
    targets: ["evm"],
    src: "function main(): Uint256 { const xs = []; return 0n; }",
  },
  {
    quotes: ["every element of an array literal must have the same type — …"],
    targets: ["evm"],
    src: "function main(): Uint256 { const xs = [1n, true]; return 0n; }",
  },
  {
    row: "template strings",
    targets: ["evm", "svm"],
    src: "function main(): bytes { return `text`; }",
  },

  // Operators
  {
    quotes: ["constant `-` expression overflows 256 bits"],
    targets: ["evm"],
    src: "function main(): Uint256 { return 0n - 1n; }",
  },
  {
    quotes: ["constant `/` expression divides by zero"],
    targets: ["evm"],
    src: "function main(): Uint256 { return 1n / 0n; }",
  },
  {
    quotes: ["a comparison operator requires a scalar value"],
    row: "comparing bytes with `==`",
    targets: ["evm"],
    src: "function main(a: bytes, b: bytes): bool { return a == b; }",
  },
  {
    quotes: ["the two arms of `? :` must have the same type — …"],
    targets: ["evm"],
    src: "function main(c: bool, d: bytes): Uint256 { const x = c ? 1n : d; return 0n; }",
  },
  {
    quotes: ["a compound assignment to an array element …"],
    row: "`a[i] += v`, `t.f += v`, `a[i]++`",
    targets: ["evm"],
    src: "function main(): Uint256 { let a = [1n, 2n]; a[0] += 1n; return a[0]; }",
  },
  {
    quotes: ["a compound assignment to a tuple field …"],
    row: "`a[i] += v`, `t.f += v`, `a[i]++`",
    targets: ["evm"],
    src: "function main(): Uint256 { let t = { f: 1n }; t.f += 1n; return t.f; }",
  },
  {
    row: "`a[i] += v`, `t.f += v`, `a[i]++`",
    targets: ["evm"],
    src: "function main(): Uint256 { let a = [1n, 2n]; a[0]++; return a[0]; }",
  },
  {
    quotes: ["`++`/`--` as a value (they are statement-only here — write `i += 1n`)"],
    row: "`i++` used as a value",
    targets: ["evm"],
    src: "function main(): Uint256 { let i = 0n; const j = i++; return j; }",
  },
  {
    quotes: ["accounts compare for identity only — `==` and `!=`. …"],
    targets: ["svm"],
    src: "function main(a: Account, b: Account): bool { return a < b; }",
  },
  {
    row: "`>>>`, `typeof`, `instanceof`, `in`, `delete`, `void`, unary `+`",
    targets: ["evm"],
    src: "function main(a: Uint256, b: Uint256): Uint256 { return a >>> b; }",
  },
  {
    row: "`>>>`, `typeof`, `instanceof`, `in`, `delete`, `void`, unary `+`",
    targets: ["evm"],
    src: "function main(a: Uint256): Uint256 { return +a; }",
  },
  {
    row: "`>>>=`, `||=`, `&&=`, `??=`",
    targets: ["evm"],
    src: "function main(a: Uint256): Uint256 { let x = a; x >>>= 1n; return x; }",
  },
  {
    row: "`>>>=`, `||=`, `&&=`, `??=`",
    targets: ["evm"],
    src: "function main(a: Uint256): Uint256 { let x = a; x ||= 1n; return x; }",
  },
  {
    row: "`?.`, `??`, `x!`, `as`, `satisfies`",
    targets: ["evm"],
    src: "function main(a: Uint256): Uint256 { return a ?? 1n; }",
  },
  {
    row: "`?.`, `??`, `x!`, `as`, `satisfies`",
    targets: ["evm"],
    src: "function main(a: Uint256): Uint256 { return a as Uint256; }",
  },

  // Variables, functions and modules
  {
    quotes: ["`a` cannot be reassigned a value of a different type — …"],
    targets: ["evm"],
    src: "function main(): Uint256 { let a = 1n; a = hex`01`; return 0n; }",
  },
  {
    quotes: ["`a` is declared `const` and cannot be reassigned"],
    targets: ["evm"],
    src: "function main(): Uint256 { const a = 1n; a = 2n; return a; }",
  },
  {
    quotes: ["a tuple index must be a number literal or a `const` bound to one — …"],
    targets: ["evm"],
    src: "function main(i: Uint256): Uint256 { const t = { a: 1n, b: 2n }; return t[i]; }",
  },
  {
    row: "`t[0] = v` on a record",
    targets: ["evm"],
    src: "function main(): Uint256 { const t = { a: 1n }; t[0] = 2n; return t.a; }",
  },
  {
    quotes: ["array index 5 is out of range — this array has 2 element(s). …"],
    targets: ["evm"],
    src: "function main(): Uint256 { const a = [1n, 2n]; a[5] = 3n; return 0n; }",
  },
  {
    quotes: [
      "a destructuring binding needs an initializer that produces a tuple — this one does not, so bind it to one name instead",
    ],
    targets: ["evm"],
    src: "function main(): Uint256 { const [a, b] = [1n, 2n]; return a; }",
  },
  {
    row: "object destructuring `const { a } = t`",
    targets: ["evm"],
    src: "function main(): Uint256 { const t = { a: 1n }; const { a } = t; return a; }",
  },
  {
    quotes: [
      "returning a bytes value from a function other than `main` needs a return-type annotation — …",
    ],
    targets: ["evm"],
    src: "function f() { return hex`01`; } function main(): bytes { return f(); }",
  },
  {
    quotes: ["`f` does not return on every path"],
    targets: ["evm"],
    src: "function f(a: Uint256): Uint256 { if (a > 1n) { return 1n; } } function main(): Uint256 { return f(2n); }",
  },
  {
    quotes: [
      "a call to a `: void` function produces no value, so its result can't be used as one — call it as a statement instead",
    ],
    targets: ["evm"],
    src: "function f(): void { } function main(): Uint256 { let x = f(); return 0n; }",
  },
  {
    quotes: ["f keeps too many values in use at once …"],
    targets: ["evm"],
    src: `function f(${Array.from({ length: 17 }, (_, i) => `p${i}: Uint256`).join(", ")}): Uint256 { return ${Array.from({ length: 17 }, (_, i) => `p${i}`).join(" + ")} + p0; } function main(a: Uint256): Uint256 { return f(${Array.from({ length: 17 }, (_, i) => `a + ${i}n`).join(", ")}); }`,
  },
  // A function with no return annotation returns a number, even when it returns a comparison.
  {
    quotes: ["a return value: expected a bool, found a number"],
    targets: ["evm", "svm"],
    src: "function f(a: Uint256, b: Uint256) { return a > b; } function main(): bool { return f(1n, 2n); }",
  },
  // A helper fills the caller's array in place; it cannot rebind the parameter to a new one.
  {
    quotes: [
      "`<name>` cannot be reassigned a value of a different type — expected an element count known only at run time, found N element(s)",
    ],
    targets: ["evm", "svm"],
    src: "function f(xs: Uint256[]): void { xs = new Array(2); } function main(): Uint256 { let xs = [1n, 2n]; f(xs); return xs[0]; }",
  },
  // Module scope: a `let` starts as a scalar literal, and a `const` array is a lookup table.
  {
    quotes: [
      "a module-scope `let <name>` must be initialized with a literal — a number, address or boolean literal. …",
    ],
    targets: ["evm", "svm"],
    src: "let xs = [1n, 2n]; function main(): Uint256 { return xs[0]; }",
  },
  {
    quotes: [
      "a module-scope `let <name>` must be initialized with a literal — a number, address or boolean literal. …",
    ],
    targets: ["evm"],
    src: "let x = 1n << 160n; function main(): Uint256 { return x; }",
  },
  {
    quotes: [
      "a module-scope `let <name>` must be initialized with a literal — a number, address or boolean literal. …",
    ],
    targets: ["evm"],
    src: "let x = -1n; function main(): Uint256 { return x; }",
  },
  {
    quotes: [
      "a module-scope `let <name>` must be initialized with a literal — a number, address or boolean literal. …",
    ],
    targets: ["evm"],
    src: "let x = ctx.chainId(); function main(): Uint256 { return x; }",
  },
  {
    quotes: [
      "a module-scope `let <name>` must be initialized with a literal — a number, address or boolean literal. …",
    ],
    targets: ["evm"],
    src: 'let b = "text"; function main(): Uint256 { return b.length; }',
  },
  {
    quotes: [
      "a module-scope lookup table `<name>` can only be read by a literal index or a field name …",
    ],
    targets: ["evm", "svm"],
    src: "const FEES = [100n, 500n]; function main(): Uint256 { let t = 0n; for (const f of FEES) { t += f; } return t; }",
  },
  {
    quotes: [
      "a module-scope lookup table `<name>` can only be read by a literal index or a field name …",
    ],
    targets: ["evm"],
    src: "const FEES = [100n, 500n]; function main(): Uint256 { return FEES.length; }",
  },
  {
    quotes: [
      "a module-scope lookup table can only be indexed by a non-negative integer literal or a `const` bound to one …",
    ],
    targets: ["evm", "svm"],
    src: "const FEES = [100n, 500n]; function main(i: Uint256): Uint256 { return FEES[i]; }",
  },
  {
    row: "default parameters, rest parameters, destructuring parameters",
    targets: ["evm"],
    src: "function f(a: Uint256 = 1n): Uint256 { return a; } function main(): Uint256 { return f(2n); }",
  },
  {
    row: "default parameters, rest parameters, destructuring parameters",
    targets: ["evm"],
    src: "function f(...a: Uint256[]): Uint256 { return 0n; } function main(): Uint256 { return f(2n); }",
  },
  {
    row: "spread `[...xs]`, `f(...xs)`",
    targets: ["evm"],
    src: "function main(): Uint256 { const a = [1n]; const b = [...a]; return b[0]; }",
  },
  {
    row: "arrow functions, function expressions, nested functions",
    targets: ["evm"],
    src: "function main(): Uint256 { const f = () => 1n; return 1n; }",
  },
  {
    row: "arrow functions, function expressions, nested functions",
    targets: ["evm"],
    src: "function main(): Uint256 { function g(): Uint256 { return 1n; } return g(); }",
  },
  {
    row: "`class`, `enum`, `type` aliases, generics, `namespace`",
    targets: ["evm"],
    src: "class C { } function main(): Uint256 { return 0n; }",
  },
  {
    row: "`class`, `enum`, `type` aliases, generics, `namespace`",
    targets: ["evm"],
    src: "enum E { A } function main(): Uint256 { return 0n; }",
  },
  {
    row: "`class`, `enum`, `type` aliases, generics, `namespace`",
    targets: ["evm"],
    src: "type T = Uint256; function main(): Uint256 { return 0n; }",
  },
  {
    row: "`class`, `enum`, `type` aliases, generics, `namespace`",
    targets: ["evm"],
    src: "function f<T>(a: Uint256): Uint256 { return a; } function main(): Uint256 { return 0n; }",
  },
  {
    row: "`async function`, `await`",
    targets: ["evm"],
    src: "function main(): Uint256 { const x = await 1n; return x; }",
  },
  {
    quotes: ["subpath imports are not supported: …"],
    targets: ["evm"],
    sdkPackages: true,
    src: 'import { approve } from "@sauce/token/token.evm.js"; function main(): void { }',
  },
  {
    quotes: ["a `.js` module import must be named — … has no `default` export"],
    targets: ["evm"],
    files: { "lib.js": "export function f(x: Uint256): Uint256 { return x; }" },
    src: 'import L from "./lib.js"; function main(): Uint256 { return 0n; }',
  },
  {
    row: "`export default`, `export { … }`, `import * as X`",
    targets: ["evm"],
    src: 'import * as X from "./x.js"; function main(): Uint256 { return 0n; }',
  },

  // Statements and control flow
  {
    row: "`switch`",
    targets: ["evm"],
    src: "function main(x: Uint256): Uint256 { switch (x) { case 1n: return 1n; } return 0n; }",
  },
  {
    row: "`do { } while (…)`",
    targets: ["evm"],
    src: "function main(): Uint256 { let i = 0n; do { i += 1n; } while (i < 3n); return i; }",
  },
  {
    row: "`for (k in obj)`, `for await`",
    targets: ["evm"],
    src: "function main(): Uint256 { const t = { a: 1n }; for (const k in t) { } return 0n; }",
  },
  {
    row: "`try { } catch { }`, `throw new Error(…)`",
    targets: ["evm"],
    src: "function main(): void { try { } catch (e) { } }",
  },
  {
    row: "`try { } catch { }`, `throw new Error(…)`",
    targets: ["evm"],
    src: 'function main(): void { throw new Error("no"); }',
  },
  {
    row: "labeled statements, labeled `break`/`continue`",
    targets: ["evm"],
    src: "function main(): Uint256 { outer: while (true) { break outer; } return 0n; }",
  },
  {
    row: "computed object keys, object methods",
    targets: ["evm"],
    src: "function main(k: Uint256): Uint256 { const t = { [k]: 1n }; return 0n; }",
  },
  {
    row: "`xs.push(v)`, `console.log`, any JavaScript library",
    targets: ["evm"],
    src: "function main(): Uint256 { console.log(1n); return 0n; }",
  },
  {
    row: "`xs.push(v)`, `console.log`, any JavaScript library",
    targets: ["evm"],
    src: "function main(): Uint256 { let xs = [1n]; xs.push(2n); return 0n; }",
  },

  // require, revert, throw, log, eval
  {
    quotes: ["`log` is a reserved builtin and cannot be a function name"],
    targets: ["evm"],
    src: "function log(x: Uint256): Uint256 { return x; } function main(): Uint256 { return 1n; }",
  },
  {
    quotes: ["`require` takes 1 or 2 arguments (a condition and an optional bytes payload), got N"],
    targets: ["evm"],
    src: 'function main(x: Uint256): void { require(x > 0n, "a", "b"); }',
  },
  {
    quotes: ["`require` aborts execution and produces no value — use it as a statement"],
    targets: ["evm"],
    src: "function main(x: Uint256): Uint256 { let y = require(x > 0n); return x; }",
  },
  {
    quotes: ["`revert` takes at most 1 argument (an optional bytes payload), got 2"],
    targets: ["evm"],
    src: 'function main(): void { revert("a", "b"); }',
  },
  {
    quotes: ["a revert payload requires a bytes value"],
    targets: ["evm"],
    src: "function main(): void { revert(1n); }",
  },
  {
    quotes: ["a `throw` payload requires a bytes value"],
    targets: ["evm"],
    src: "function main(): void { throw 1n; }",
  },
  {
    quotes: [
      "`log with topics` is not available on the svm target; … call log(data) alone and fold any event discriminator into data (concat or abi.encode it in front of the fields)",
    ],
    targets: ["svm"],
    src: "function main(d: bytes): void { log(d, 1n); }",
  },
  {
    quotes: ["`log` requires a bytes data payload — `log()` records nothing"],
    targets: ["evm"],
    src: "function main(): void { log(); }",
  },
  {
    quotes: ["`log` carries at most 4 indexed topics after its data payload, got 5"],
    targets: ["evm"],
    src: "function main(d: bytes): void { log(d, 1n, 2n, 3n, 4n, 5n); }",
  },
  {
    quotes: ["`eval` requires bytecode to run — `eval()` has nothing to execute"],
    targets: ["evm"],
    src: "function main(): bytes { return eval(); }",
  },
  {
    quotes: ["`eval` takes at most 16 arguments after its bytecode, got 17"],
    targets: ["evm"],
    src: `function main(c: bytes): bytes { return eval(c, ${many(17, "1n")}); }`,
  },
  {
    quotes: ["an eval argument requires a scalar value"],
    targets: ["evm"],
    src: "function main(c: bytes, d: bytes): bytes { return eval(c, d); }",
  },

  // ctx
  {
    quotes: ["`ctx` is not a declared variable"],
    targets: ["evm"],
    src: "function main(): Uint256 { return ctx.self; }",
  },
  {
    quotes: ["ctx.balance's address: expected a value, found an account"],
    targets: ["svm"],
    src: "function main(a: Account): Uint256 { return ctx.balance(a); }",
  },
  {
    quotes: [
      "…; pass the amount as an argument and move the lamports with a system-program transfer through svm.call",
    ],
    targets: ["svm"],
    src: "function main(): Uint256 { return ctx.msgValue(); }",
  },
  {
    quotes: ["`ctx.timestamp` takes 0 argument(s), but this call passes 1"],
    targets: ["evm"],
    src: "function main(): Uint256 { return ctx.timestamp(1n); }",
  },
  {
    quotes: ["`ctx.origin` is not a context builtin"],
    targets: ["evm"],
    src: "function main(): Uint256 { return ctx.origin(); }",
  },
  {
    quotes: ["… is called but never declared; write `ctx.gasLeft()` instead"],
    targets: ["evm"],
    src: "function main(): Uint256 { return gasLeft(); }",
  },

  // crypto, Math
  {
    quotes: ["ecdsaVerify's signature requires a bytes value"],
    targets: ["evm"],
    src: "function main(h: Uint256): bool { return crypto.ecdsaVerify(h, 1n, 2n); }",
  },
  {
    quotes: [
      "`crypto.findPDA` produces two values — bind them by destructuring, as `const [address, bump] = crypto.findPDA(programId, seeds)`",
    ],
    targets: ["evm"],
    src: "function main(p: Uint256): Uint256 { let x = crypto.findPDA(p, [hex`01`]); return 0n; }",
  },
  {
    quotes: ["`crypto.findPDA`'s seeds argument must be a `bytes[]`, got …"],
    targets: ["evm"],
    src: "function main(p: Uint256): Uint256 { const [a, b] = crypto.findPDA(p, [1n, 2n]); return a; }",
  },
  {
    quotes: ["`crypto.sha256` is not a crypto intrinsic"],
    targets: ["evm"],
    src: "function main(d: bytes): Uint256 { return crypto.sha256(d); }",
  },
  {
    quotes: ["`Math.min` is not a Math intrinsic"],
    row: "`Math.min`, `max`, `abs`, `pow`",
    targets: ["evm"],
    src: "function main(a: Uint256, b: Uint256): Uint256 { return Math.min(a, b); }",
  },
  {
    row: "`Math.min`, `max`, `abs`, `pow`",
    targets: ["evm"],
    src: "function main(a: Uint256, b: Uint256): Uint256 { return Math.pow(a, b); }",
  },
  {
    quotes: ["a return value: expected a bool, found a number"],
    targets: ["evm"],
    src: "function main(a: Uint256, b: Uint256): bool { return Math.sLt(a, b); }",
  },
  {
    quotes: ["`Math.sqrt` takes 1 argument(s), but this call passes 2"],
    targets: ["evm"],
    src: "function main(a: Uint256): Uint256 { return Math.sqrt(a, a); }",
  },

  // abi
  {
    quotes: ["abi.encode requires at least one value to encode"],
    targets: ["evm"],
    src: "function main(): bytes { return abi.encode(); }",
  },
  {
    quotes: ["abi.encode takes at most 255 arguments, got N"],
    targets: ["evm"],
    src: `function main(): bytes { return abi.encode(${many(256, "1n")}); }`,
  },
  {
    quotes: ["`uint256` is not an abi.decode field type — …"],
    targets: ["evm"],
    src: 'function main(d: bytes): Uint256 { const t = abi.decode(d, ["uint256"]); return t[0]; }',
  },
  {
    quotes: ["abi.decode takes exactly 2 arguments (data, shape), got N"],
    targets: ["evm"],
    src: "function main(d: bytes): Uint256 { const t = abi.decode(d); return t[0]; }",
  },
  {
    quotes: ["abi.decode's first argument must be bytes"],
    targets: ["evm"],
    src: 'function main(): Uint256 { const t = abi.decode(1n, ["Uint256"]); return t[0]; }',
  },
  {
    quotes: [
      'abi.decode\'s second argument must be an array literal of shape strings, e.g. ["Uint256", "bytes[]"]',
    ],
    targets: ["evm"],
    src: 'function main(d: bytes): Uint256 { const s = ["Uint256"]; const t = abi.decode(d, s); return t[0]; }',
  },
  {
    quotes: [
      "this tuple's N field(s) are unnamed, so `.name` resolves against nothing — read a field by position instead (`t[0]`)",
    ],
    targets: ["evm"],
    src: 'function main(d: bytes): Uint256 { const t = abi.decode(d, ["Uint256"]); return t.name; }',
  },

  // evm
  {
    quotes: ["`evm.<name>` is not available on the svm target"],
    targets: ["svm"],
    src: "function main(a: Uint256, d: bytes): bytes { return evm.call(a, 0n, d); }",
  },
  {
    quotes: ["`evm.call()` expects 3 argument(s), but this call passes 2"],
    targets: ["evm"],
    src: "function main(a: Uint256, d: bytes): bytes { return evm.call(a, d); }",
  },
  {
    quotes: ["`evm.call()`'s calldata argument must be bytes"],
    targets: ["evm"],
    src: "function main(a: Uint256): bytes { return evm.call(a, 0n, 1n); }",
  },
  {
    quotes: ["`evm.sstore` writes storage and produces no value — use it as a statement"],
    targets: ["evm"],
    src: "function main(s: Uint256): Uint256 { let x = evm.sstore(s, 1n); return 0n; }",
  },
  {
    quotes: ["`evm.nope` is not an evm builtin; `evm` is a reserved namespace root"],
    targets: ["evm"],
    src: "function main(): Uint256 { return evm.nope(1n); }",
  },

  // svm
  {
    quotes: ["`svm.<name>` is not available on the evm target"],
    targets: ["evm"],
    src: "function main(p: Account, d: bytes): bytes { return svm.call(p, [], d); }",
  },
  {
    quotes: [
      "`state` is not declared writable, so `svm.sstore` may not write it — declare it `Account<Writable>` (or `Account<Writable, Signer>`)",
    ],
    targets: ["svm"],
    src: "function main(state: Account, d: bytes): void { svm.sstore(state, 0n, d); }",
  },
  {
    quotes: [
      "`state` is not declared a signer, so `svm.sstore` may not write it — … declare it `Account<Writable, Signer>`",
    ],
    targets: ["svm"],
    src: "function main(state: Account<Writable>, d: bytes): void { svm.sstore(state, 0n, d); }",
  },
  {
    quotes: ["svm.sstore's value requires a bytes value"],
    targets: ["svm"],
    src: "function main(a: Account<Writable, Signer>): void { svm.sstore(a, 0n, 5n); }",
  },
  {
    quotes: ["svm.call's program — declare the callee as an `Account` param: …"],
    targets: ["svm"],
    src: "function main(d: bytes): bytes { return svm.call(1n, [], d); }",
  },
  {
    quotes: [
      "`svm.call`'s accounts argument must be an array of accounts, e.g. `[a, b]` of `Account` params",
    ],
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): bytes { return svm.call(p, [0n, 1n], d); }",
  },
  {
    quotes: ["`svm.remainingAccount` takes one index, got N"],
    targets: ["svm"],
    src: "function main(a: Account): Uint256 { return svm.sload(svm.remainingAccount(), 0n, 8n).toLe(); }",
  },
  {
    quotes: [
      "svm.remainingAccounts() can only initialize a let/const — bind it first (const rest = svm.remainingAccounts();), then use the binding",
    ],
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): bytes { return svm.call(p, svm.remainingAccounts(), d); }",
  },
  {
    quotes: ["`svm.rent` is not an svm builtin; `svm` is a reserved namespace root"],
    targets: ["svm"],
    src: "function main(): Uint256 { return svm.rent(); }",
  },

  // Methods and account properties
  {
    quotes: ["a bytes method's receiver requires a bytes value"],
    targets: ["evm"],
    src: "function main(): Uint256 { const xs = [1n, 2n]; const ys = xs.slice(0n, 1n); return 0n; }",
  },
  {
    quotes: ["`.slice` takes exactly 2 arguments (start, end), got N"],
    targets: ["evm"],
    src: "function main(b: bytes): bytes { return b.slice(1n); }",
  },
  {
    quotes: ["a `.concat` argument requires a bytes value"],
    targets: ["evm"],
    src: "function main(b: bytes): bytes { return b.concat(1n); }",
  },
  {
    quotes: ["a `.toBytesBe`/`.toBytesLe` width must be between 1 and 32 bytes, got 33"],
    targets: ["evm"],
    src: "function main(x: Uint256): bytes { return x.toBytesBe(33n); }",
  },
  {
    quotes: ["`length` is not a field of this tuple — …"],
    targets: ["evm"],
    src: "function main(): Uint256 { const t = { a: 1n }; return t.length; }",
  },
  {
    quotes: ["calling anything other than a plain function name …"],
    row: "a method on a literal (``hex`…`.concat(d)``)",
    targets: ["evm"],
    src: "function main(d: bytes): bytes { return hex`a9`.concat(d); }",
  },
  {
    quotes: [
      "`account.owner` is not available on the evm target; an address on the EVM is the code — check it with ctx.isContract",
    ],
    targets: ["evm"],
    src: "function main(a: Account): Uint256 { return a.owner; }",
  },
  {
    quotes: ["`.owner` is read-only — …"],
    targets: ["svm"],
    src: "function main(a: Account): void { a.owner = 1n; }",
  },
  {
    quotes: ["a return value can't be an account — …"],
    targets: ["svm"],
    src: "function main(a: Account): Account { return a; }",
  },
  {
    quotes: ["…: expected a number, found an account"],
    targets: ["svm"],
    src: "function main(a: Account): Uint256 { return a + 1n; }",
  },

  // Contract bindings and .catch()
  {
    quotes: ["a return value: expected a bool, found a number"],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, to: Uint256): bool { return ERC20.at(t).transfer(to, 5n); }",
  },
  {
    quotes: ["`ERC20` has no method named `totalSupply`"],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256): Uint256 { return ERC20.at(t).totalSupply(); }",
  },
  {
    quotes: ["`ERC20.transfer()` expects 2 argument(s), but this call passes 1"],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256): void { ERC20.at(t).transfer(1n); }",
  },
  {
    row: "sending value through a bound call",
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, to: Uint256): void { ERC20.at(t).transfer(to, 5n, { value: 1n }); }",
  },
  {
    quotes: ["`.at()` (a contract binding) takes exactly 1 argument (the address)"],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { return ERC20.at(t, o).balanceOf(o); }",
  },
  {
    quotes: [
      "`Contract.at` is not available on the svm target; invoke another program with svm.call(program, accounts, calldata), or import a library's SVM arm (@sauce/token)",
    ],
    targets: ["svm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { return ERC20.at(t).balanceOf(o); }",
  },
  {
    quotes: ["a `.catch()` handler parameter (the caught error is not supported)"],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, s: Uint256): void { ERC20.at(t).approve(s, 5n).catch((e) => { }); }",
  },
  {
    quotes: ["a `return` in a `.catch()` handler …"],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { let v = 0n; ERC20.at(t).balanceOf(o).catch(() => { v = 1n; return 0n; }); return v; }",
  },
  {
    quotes: ["a captured `.catch()` requires exactly `return <constant scalar>;` in its handler"],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { const b = ERC20.at(t).balanceOf(o).catch(() => { }); return b; }",
  },
  {
    quotes: [
      "the `.catch()` fallback must be a constant scalar that fits the declared ABI result width",
    ],
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256, k: Uint256): Uint256 { return ERC20.at(t).balanceOf(o).catch(() => { return k; }); }",
  },
  {
    quotes: ["a `.catch()` fallback: expected a bytes value, found a number"],
    targets: ["evm"],
    src: "function main(t: Address, d: bytes): bytes { const r = evm.static(t, d).catch(() => { return 0n; }); return r; }",
  },
  {
    quotes: ["a .catch() handler compiles to N bytes, over the 255-byte limit …"],
    targets: ["evm"],
    contracts,
    src: `function main(t: Uint256, s: Uint256): Uint256 { let v = 0n; ERC20.at(t).approve(s, 1n).catch(() => { ${long} }); return v; }`,
  },
  {
    quotes: ["a `.catch()` on something other than an external contract call …"],
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): void { svm.call(p, [], d).catch(() => { }); }",
  },
  {
    quotes: ["`.catch()` is not available on the svm target"],
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): Uint256 { return svm.call(p, [], d).toLe().catch(() => { return 0n; }); }",
  },
  {
    quotes: ["… is not supported"],
    targets: ["evm"],
    src: "function main(x: Uint256): Uint256 { switch (x) { case 1n: return 1n; } return 0n; }",
  },
];

// Minimal programs for unsupported forms, invalid types, bounds and target restrictions.
// `row` links a semantic example to the reference's "Not supported" table; compiler diagnostic
// wording is deliberately not part of this contract.

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
// A function taking a fixed-size array of 256 elements, and one returning it.
const BIG_ARRAY = JSON.stringify([
  {
    type: "function",
    name: "put",
    stateMutability: "nonpayable",
    inputs: [{ name: "xs", type: "uint256[256]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "get",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256[256]" }],
  },
]);
const many = (n, value) => Array.from({ length: n }, () => value).join(", ");
const long = Array.from({ length: 60 }, (_, i) => `v = v + ${i}n;`).join(" ");

export const rejections = [
  // Types and literals
  { targets: ["evm"], src: "function main(a: Account<Writable>): void { }" },
  { targets: ["evm"], src: "function main(a: uint256): void { }" },
  { targets: ["evm", "svm"], src: "function main(d: bytes): void { require(d); }" },
  { targets: ["evm", "svm"], src: "function main(): Uint256 { return crypto.keccak256(1n); }" },
  { targets: ["evm", "svm"], src: "function main(flag: bool): Uint256 { return flag + 1n; }" },
  // A bool passed to a parameter with no annotation, which is therefore a number.
  {
    targets: ["evm", "svm"],
    src: "function pick(a: Uint256, b: Uint256, first) { if (first) { return a; } return b; } function main(a: Uint256, b: Uint256): Uint256 { return pick(a, b, a > b); }",
  },
  { targets: ["svm"], src: "function main(a: Uint256): bytes { return svm.sload(a, 0n, 8n); }" },
  { targets: ["svm"], src: "function main(a: Uint256): bytes { return abi.encode(a); }" },
  {
    row: "`1e18`, `1.5`, `null`",
    targets: ["evm"],
    src: "function main(): Uint256 { return 1e18; }",
  },
  {
    row: "`1e18`, `1.5`, `null`",
    targets: ["evm"],
    src: "function main(): Uint256 { return 1.5; }",
  },
  {
    row: "`1e18`, `1.5`, `null`",
    targets: ["evm"],
    src: "function main(): Uint256 { const x = null; return 0n; }",
  },
  { targets: ["evm"], src: "function main(): bytes { return hex`abc`; }" },
  { targets: ["evm"], src: "function main(): Uint256 { const xs = [1n, true]; return 0n; }" },
  {
    row: "template strings",
    targets: ["evm", "svm"],
    src: "function main(): bytes { return `text`; }",
  },

  // Operators
  { targets: ["evm"], src: "function main(): Uint256 { return 0n - 1n; }" },
  { targets: ["evm"], src: "function main(): Uint256 { return 1n / 0n; }" },
  {
    row: "comparing bytes with `==`",
    targets: ["evm"],
    src: "function main(a: bytes, b: bytes): bool { return a == b; }",
  },
  {
    targets: ["evm"],
    src: "function main(c: bool, d: bytes): Uint256 { const x = c ? 1n : d; return 0n; }",
  },
  {
    row: "`a[i] += v`, `t.f += v`, `a[i]++`",
    targets: ["evm"],
    src: "function main(): Uint256 { let a = [1n, 2n]; a[0] += 1n; return a[0]; }",
  },
  {
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
    row: "`i++` used as a value",
    targets: ["evm"],
    src: "function main(): Uint256 { let i = 0n; const j = i++; return j; }",
  },
  { targets: ["svm"], src: "function main(a: Account, b: Account): bool { return a < b; }" },
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
  { targets: ["evm"], src: "function main(): Uint256 { let a = 1n; a = hex`01`; return 0n; }" },
  { targets: ["evm"], src: "function main(): Uint256 { const a = 1n; a = 2n; return a; }" },
  {
    targets: ["evm"],
    src: "function main(i: Uint256): Uint256 { const t = { a: 1n, b: 2n }; return t[i]; }",
  },
  {
    row: "`t[0] = v` on a record",
    targets: ["evm"],
    src: "function main(): Uint256 { const t = { a: 1n }; t[0] = 2n; return t.a; }",
  },
  {
    targets: ["evm"],
    src: "function main(): Uint256 { const a = [1n, 2n]; a[5] = 3n; return 0n; }",
  },
  { targets: ["evm"], src: "function main(): Uint256 { const [a, b] = [1n, 2n]; return a; }" },
  {
    row: "object destructuring `const { a } = t`",
    targets: ["evm"],
    src: "function main(): Uint256 { const t = { a: 1n }; const { a } = t; return a; }",
  },
  {
    targets: ["evm"],
    src: "function f() { return hex`01`; } function main(): bytes { return f(); }",
  },
  {
    targets: ["evm"],
    src: "function f(a: Uint256): Uint256 { if (a > 1n) { return 1n; } } function main(a: Uint256): Uint256 { return f(a); }",
  },
  {
    targets: ["evm"],
    src: "function f(): void { } function main(): Uint256 { let x = f(); return 0n; }",
  },
  {
    targets: ["evm"],
    src: `function f(${Array.from({ length: 17 }, (_, i) => `p${i}: Uint256`).join(", ")}): Uint256 { return ${Array.from({ length: 17 }, (_, i) => `p${i}`).join(" + ")} + p0; } function main(a: Uint256): Uint256 { return f(${Array.from({ length: 17 }, (_, i) => `a + ${i}n`).join(", ")}); }`,
  },
  // A function with no return annotation returns a number, even when it returns a comparison.
  {
    targets: ["evm", "svm"],
    src: "function f(a: Uint256, b: Uint256) { return a > b; } function main(): bool { return f(1n, 2n); }",
  },
  // A helper fills the caller's array in place; it cannot rebind the parameter to a new one.
  {
    targets: ["evm", "svm"],
    src: "function f(xs: Uint256[]): void { xs = new Array(2); } function main(): Uint256 { let xs = [1n, 2n]; f(xs); return xs[0]; }",
  },
  // Module scope: a `let` starts as a scalar literal, and a `const` array is a lookup table.
  { targets: ["evm", "svm"], src: "let xs = [1n, 2n]; function main(): Uint256 { return xs[0]; }" },
  { targets: ["evm"], src: "let x = 1n << 160n; function main(): Uint256 { return x; }" },
  { targets: ["evm"], src: "let x = ctx.chainId(); function main(): Uint256 { return x; }" },
  { targets: ["evm"], src: 'let b = "text"; function main(): Uint256 { return b.length; }' },
  {
    targets: ["evm", "svm"],
    src: "const FEES = [100n, 500n]; function main(): Uint256 { let t = 0n; for (const f of FEES) { t += f; } return t; }",
  },
  {
    targets: ["evm"],
    src: "const FEES = [100n, 500n]; function main(): Uint256 { return FEES.length; }",
  },
  {
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
    row: "arbitrary arrow functions, function expressions, nested functions",
    targets: ["evm"],
    src: "function main(): Uint256 { const f = () => 1n; return 1n; }",
  },
  {
    row: "arbitrary arrow functions, function expressions, nested functions",
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
    targets: ["evm"],
    sdkPackages: true,
    src: 'import { approve } from "@sauce/token/token.evm.js"; function main(): void { }',
  },
  {
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
    row: "`finally`, `throw new Error(…)`",
    targets: ["evm"],
    src: "function main(): void { try { } catch (e) { } finally { } }",
  },
  {
    row: "`finally`, `throw new Error(…)`",
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
    targets: ["evm"],
    src: "function log(x: Uint256): Uint256 { return x; } function main(): Uint256 { return 1n; }",
  },
  { targets: ["evm"], src: 'function main(x: Uint256): void { require(x > 0n, "a", "b"); }' },
  {
    targets: ["evm"],
    src: "function main(x: Uint256): Uint256 { let y = require(x > 0n); return x; }",
  },
  { targets: ["evm"], src: 'function main(): void { revert("a", "b"); }' },
  { targets: ["evm"], src: "function main(): void { revert(1n); }" },
  { targets: ["evm"], src: "function main(): void { throw 1n; }" },
  { targets: ["svm"], src: "function main(d: bytes): void { log(d, 1n); }" },
  { targets: ["evm"], src: "function main(): void { log(); }" },
  { targets: ["evm"], src: "function main(d: bytes): void { log(d, 1n, 2n, 3n, 4n, 5n); }" },
  { targets: ["evm"], src: "function main(): bytes { return eval(); }" },
  {
    targets: ["evm"],
    src: `function main(c: bytes): bytes { return eval(c, ${many(17, "1n")}); }`,
  },
  { targets: ["evm"], src: "function main(c: bytes, d: bytes): bytes { return eval(c, d); }" },

  // ctx
  { targets: ["evm"], src: "function main(): Uint256 { return ctx.self; }" },
  { targets: ["svm"], src: "function main(a: Account): Uint256 { return ctx.balance(a); }" },
  { targets: ["svm"], src: "function main(): Uint256 { return ctx.msgValue(); }" },
  { targets: ["evm"], src: "function main(): Uint256 { return ctx.timestamp(1n); }" },
  { targets: ["evm"], src: "function main(): Uint256 { return ctx.origin(); }" },
  { targets: ["evm"], src: "function main(): Uint256 { return gasLeft(); }" },

  // crypto, Math
  {
    targets: ["evm"],
    src: "function main(h: Uint256): bool { return crypto.ecdsaVerify(h, 1n, 2n); }",
  },
  {
    targets: ["evm"],
    src: "function main(p: Uint256): Uint256 { let x = crypto.findPDA(p, [hex`01`]); return 0n; }",
  },
  {
    targets: ["evm"],
    src: "function main(p: Uint256): Uint256 { const [a, b] = crypto.findPDA(p, [1n, 2n]); return a; }",
  },
  { targets: ["evm"], src: "function main(d: bytes): Uint256 { return crypto.sha256(d); }" },
  {
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
    targets: ["evm"],
    src: "function main(a: Uint256, b: Uint256): bool { return Math.sLt(a, b); }",
  },
  { targets: ["evm"], src: "function main(a: Uint256): Uint256 { return Math.sqrt(a, a); }" },

  // abi
  { targets: ["evm"], src: "function main(): bytes { return abi.encode(); }" },
  { targets: ["evm"], src: `function main(): bytes { return abi.encode(${many(256, "1n")}); }` },
  {
    targets: ["evm"],
    src: 'function main(d: bytes): Uint256 { const t = abi.decode(d, ["uint256"]); return t[0]; }',
  },
  {
    targets: ["evm"],
    src: "function main(d: bytes): Uint256 { const t = abi.decode(d); return t[0]; }",
  },
  {
    targets: ["evm"],
    src: 'function main(): Uint256 { const t = abi.decode(1n, ["Uint256"]); return t[0]; }',
  },
  {
    targets: ["evm"],
    src: 'function main(d: bytes): Uint256 { const s = ["Uint256"]; const t = abi.decode(d, s); return t[0]; }',
  },
  {
    targets: ["evm"],
    src: 'function main(d: bytes): Uint256 { const t = abi.decode(d, ["Uint256"]); return t.name; }',
  },

  // evm
  {
    targets: ["svm"],
    src: "function main(a: Uint256, d: bytes): bytes { return evm.call(a, 0n, d); }",
  },
  {
    targets: ["evm"],
    src: "function main(a: Uint256, d: bytes): bytes { return evm.call(a, d); }",
  },
  { targets: ["evm"], src: "function main(a: Uint256): bytes { return evm.call(a, 0n, 1n); }" },
  {
    targets: ["evm"],
    src: "function main(s: Uint256): Uint256 { let x = evm.sstore(s, 1n); return 0n; }",
  },
  { targets: ["evm"], src: "function main(): Uint256 { return evm.create(1n); }" },

  // svm
  {
    targets: ["evm"],
    src: "function main(p: Account, d: bytes): bytes { return svm.call(p, [], d); }",
  },
  {
    targets: ["svm"],
    src: "function main(state: Account, d: bytes): void { svm.sstore(state, 0n, d); }",
  },
  {
    targets: ["svm"],
    src: "function main(state: Account<Writable>, d: bytes): void { svm.sstore(state, 0n, d); }",
  },
  {
    targets: ["svm"],
    src: "function main(a: Account<Writable, Signer>): void { svm.sstore(a, 0n, 5n); }",
  },
  { targets: ["svm"], src: "function main(d: bytes): bytes { return svm.call(1n, [], d); }" },
  {
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): bytes { return svm.call(p, [0n, 1n], d); }",
  },
  {
    targets: ["svm"],
    src: "function main(a: Account): Uint256 { return svm.sload(svm.remainingAccount(), 0n, 8n).toLe(); }",
  },
  {
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): bytes { return svm.call(p, svm.remainingAccounts(), d); }",
  },
  { targets: ["svm"], src: "function main(): Uint256 { return svm.rent(); }" },

  // Methods and account properties
  {
    targets: ["evm"],
    src: "function main(): Uint256 { const xs = [1n, 2n]; const ys = xs.slice(0n, 1n); return 0n; }",
  },
  { targets: ["evm"], src: "function main(b: bytes): bytes { return b.slice(1n); }" },
  { targets: ["evm"], src: "function main(b: bytes): bytes { return b.concat(1n); }" },
  { targets: ["evm"], src: "function main(x: Uint256): bytes { return x.toBytesBe(33n); }" },
  { targets: ["evm"], src: "function main(): Uint256 { const t = { a: 1n }; return t.length; }" },
  { targets: ["evm"], src: "function main(a: Account): Uint256 { return a.owner; }" },
  { targets: ["svm"], src: "function main(a: Account): void { a.owner = 1n; }" },
  { targets: ["svm"], src: "function main(a: Account): Account { return a; }" },
  { targets: ["svm"], src: "function main(a: Account): Uint256 { return a + 1n; }" },

  // Contract bindings and .catch()
  {
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, to: Uint256): bool { return ERC20.at(t).transfer(to, 5n); }",
  },
  {
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256): Uint256 { return ERC20.at(t).totalSupply(); }",
  },
  {
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
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { return ERC20.at(t, o).balanceOf(o); }",
  },
  {
    targets: ["evm"],
    contracts: [["Big", BIG_ARRAY]],
    src: "function main(t: Address, xs: Uint256[]): void { Big.at(t).put(xs); }",
  },
  {
    targets: ["evm"],
    contracts: [["Big", BIG_ARRAY]],
    src: "function main(t: Address): void { Big.at(t).get(); }",
  },
  {
    targets: ["svm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { return ERC20.at(t).balanceOf(o); }",
  },
  {
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, s: Uint256): void { ERC20.at(t).approve(s, 5n).catch((e, other) => { }); }",
  },
  {
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { let v = 0n; ERC20.at(t).balanceOf(o).catch(() => { v = 1n; return 0n; }); return v; }",
  },
  {
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256): Uint256 { const b = ERC20.at(t).balanceOf(o).catch(() => { }); return b; }",
  },
  {
    targets: ["evm"],
    contracts,
    src: "function main(t: Uint256, o: Uint256, k: Uint256): Uint256 { return ERC20.at(t).balanceOf(o).catch(() => { return k; }); }",
  },
  {
    targets: ["evm"],
    src: "function main(t: Address, d: bytes): bytes { const r = evm.static(t, d).catch(() => { return 0n; }); return r; }",
  },
  {
    targets: ["evm"],
    contracts,
    src: `function main(t: Uint256, s: Uint256): Uint256 { let v = 0n; ERC20.at(t).approve(s, 1n).catch(() => { ${long} }); return v; }`,
  },
  {
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): void { svm.call(p, [], d).catch(() => { }); }",
  },
  {
    targets: ["svm"],
    src: "function main(p: Account, d: bytes): Uint256 { return svm.call(p, [], d).toLe().catch(() => { return 0n; }); }",
  },
  {
    targets: ["evm"],
    src: "function main(x: Uint256): Uint256 { switch (x) { case 1n: return 1n; } return 0n; }",
  },
];

// The two compiler asks #61 holds, each a pair of programs that should compile alike, on one or more
// compiler builds:
//   node held-asks.mjs <pkg> [<pkg> …]
//
// - A run-time field read in place: `new T(r.a).send(x, r.n)` reads `r.a` before its arguments where
//   `f(r.a, x, r.n)` does not, one byte more (the SDK's `Token(t.token).transfer(vault, t.amount)`).
// - A contract binding called with one address as its `.at(address)`: a namespace holding the import
//   gives `.at` and refuses the call, an arrow gives the call and has no `.at`.
import { createRequire } from "node:module";
import { join } from "node:path";

const COUNTER = JSON.stringify([
  {
    type: "function",
    name: "get",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
]);
const F = "function f(a, b, c) {\n  require(a != b);\n  return a + b * c;\n}\n";
const HOLDS = `import C from "./c.json";
class N { constructor(c) { this.Pool = c.Pool; } }
const U = new N({ Pool: C });
const V = new N({ Pool: (address) => C.at(address) });
`;
const PAIRS = {
  "a run-time field read in place": [
    `${F}class T {\n  constructor(a) { this.a = a; }\n  send(to, n) { return f(this.a, to, n); }\n}\nfunction main(r: { a: Uint256; n: Uint256 }, x: Uint256): Uint256 {\n  return new T(r.a).send(x, r.n) + f(x, x, 2);\n}\n`,
    `${F}function main(r: { a: Uint256; n: Uint256 }, x: Uint256): Uint256 {\n  return f(r.a, x, r.n) + f(x, x, 2);\n}\n`,
  ],
  "a held contract import, called": [
    `${HOLDS}function main(p: Address): Uint256 { return U.Pool(p).get(p); }\n`,
    `${HOLDS}function main(p: Address): Uint256 { return U.Pool.at(p).get(p); }\n`,
  ],
};

const require = createRequire(import.meta.url);
const strip = (text) => text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
for (const pkg of process.argv.slice(2)) {
  const { compile } = require(join(pkg, "node/sauce_wasm.js"));
  const size = (source) => {
    const files = { "main.js": source, "c.json": COUNTER };
    try {
      return compile({
        target: "evm",
        cache: false,
        resolve: (path) => {
          const text = files[path.replace(/^\.\//, "")];
          return text === undefined ? undefined : new TextEncoder().encode(text);
        },
      }).bytecode.length;
    } catch (error) {
      return strip(String(error.message))
        .split("\n")
        .filter((line) => /─▶/.test(line))
        .pop();
    }
  };
  console.log(pkg);
  for (const [ask, [held, written]] of Object.entries(PAIRS)) {
    console.log(`  ${ask}: ${size(held)} against ${size(written)}`);
  }
}

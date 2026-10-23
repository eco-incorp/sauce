// The registries a program author reads from TypeScript: which protocols exist and where, which
// contracts a program can call by name, the per-protocol documents, and how a protocol module's
// SauceScript template compiles. Compiles protocols.sauce.ts the way `sauce compile` does, for
// chains with and without PancakeSwap V3.
//
//   node protocols.mts
import { readFileSync } from "node:fs";

import {
  contracts,
  getProtocol,
  getProtocolSkill,
  getProtocolsByChain,
  listProtocols,
  listSkillSlugs,
  routes,
} from "@eco-incorp/sauce";
import { compile } from "@eco-incorp/sauce/compiler";
import * as aaveV3 from "@eco-incorp/sauce/protocols/aave-v3";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

// Catalogued on Base (metadata and deployments), a much larger set than the callable namespaces.
const onBase = getProtocolsByChain(8453);
check(getProtocol("pancakeswap-v3")?.slug === "pancakeswap-v3", "catalog lookup by slug");
check(contracts.on("base").AaveV3.Pool.available, "AaveV3.Pool is a namespace on Base");

// protocols.sauce.ts names PancakeSwap V3's factory by namespace, inside `if (PancakeswapV3.Factory)`:
// the program carries the factory where the chain has one, and compiles without it elsewhere, where
// the name is zero and the test leaves its branch out.
const source = readFileSync(new URL("./protocols.sauce.ts", import.meta.url), "utf8");
const sizes: string[] = [];
for (const [slug, hasPancake] of [
  ["base", true],
  ["arbitrum", true],
  ["optimism", false],
] as const) {
  const factory = contracts.on(slug).PancakeswapV3.Factory;
  check(factory.available === hasPancake, `PancakeswapV3.Factory on ${slug}: ${hasPancake}`);
  const program = routes.compileSauceProgram(slug, source);
  check(program.source.includes("__sauce_approve(USDC,"), "the approve is SafeERC20");
  const bytecode = Buffer.from(program.bytecode).toString("hex");
  check(
    hasPancake ===
      (factory.available && bytecode.includes(factory.address!.slice(2).toLowerCase())),
    `the program uses the factory on ${slug} only where it exists`,
  );
  sizes.push(`${slug} ${program.bytecode.length} bytes`);
}

// Outside a test, a contract the chain lacks is refused, at the use, naming the chain; a contract no
// chain has is refused even tested; and there is no `available` call: a program tests the name.
const refusal = (slug: string, body: string): string => {
  try {
    routes.compileSauceProgram(slug, body);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};
check(
  refusal(
    "optimism",
    "function main(): Address { return PancakeswapV3.Factory.getPool(WETH, USDC, 500); }",
  ).includes("`PancakeswapV3.Factory` is not deployed on optimism."),
  "an untested call on PancakeswapV3.Factory is refused on Optimism, naming the chain",
);
check(
  refusal(
    "base",
    "function main(): Uint256 { if (PancakeswapV3.Factroy) { return 1; } return 0; }",
  ).includes("`PancakeswapV3.Factroy` is not a contract of PancakeswapV3"),
  "a contract no chain has is an error, even tested",
);
check(
  refusal(
    "base",
    "function main(): Uint256 { if (available(PancakeswapV3.Factory)) { return 1; } return 0; }",
  ).includes("`available(X)` is removed"),
  "a program tests the name itself",
);

// The per-protocol documents ship as this skill's references/, and `getProtocolSkill` returns the
// same text. Every catalogued protocol has one.
const document = readFileSync(new URL("../references/pancakeswap-v3.md", import.meta.url), "utf8");
check(
  getProtocolSkill("pancakeswap-v3") === document,
  "references/ is what getProtocolSkill reads",
);
check(
  listSkillSlugs().length === listProtocols().length,
  "every catalogued protocol has a document",
);

// Templates are named exports; their `import { X as Y } from "./abis"` is a contract import, so
// the resolver serves `./abis` with the named ABI's JSON.
check(!("sauceFunctions" in aaveV3), "templates are exported by name");
const entry = new TextEncoder().encode(aaveV3.supply);
const abi = new TextEncoder().encode(JSON.stringify(aaveV3.PoolABI));
const template = compile({
  target: "evm",
  entry: "main.ts",
  resolve: (path) => (path === "main.ts" ? entry : path === "./abis" ? abi : undefined),
});

console.log(
  `${listProtocols().length} protocols catalogued, ${onBase.length} on Base, ${listSkillSlugs().length} documents`,
);
console.log(
  `protocols.sauce.ts: ${sizes.join(", ")}; aave-v3 supply template ${template.bytecode.length} bytes`,
);

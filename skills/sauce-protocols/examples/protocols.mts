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
  requireChain,
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

// protocols.sauce.ts names PancakeSwap V3's factory by namespace, behind `available(...)`: the
// program carries the factory where the chain has one, and compiles without it elsewhere.
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
  const pool = contracts.on(slug).AaveV3.Pool.address!;
  const usdc = `0x${routes.registryTokenAddress(requireChain(slug), "USDC")!.toString(16).padStart(40, "0")}`;
  const approve = (body: string, imports = "") =>
    Buffer.from(
      routes.compileSauceProgram(slug, `${imports}function main(amount: Uint256) { ${body} }`)
        .bytecode,
    );
  check(
    approve("USDC.approve(AaveV3.Pool, amount);").equals(
      approve(`approve(${usdc}, ${pool}, amount);`, 'import { approve } from "@sauce/token";\n'),
    ),
    "the approve is SafeERC20",
  );
  const bytecode = Buffer.from(program.bytecode).toString("hex");
  check(
    hasPancake ===
      (factory.available && bytecode.includes(factory.address!.slice(2).toLowerCase())),
    `the program uses the factory on ${slug} only where it exists`,
  );
  sizes.push(`${slug} ${program.bytecode.length} bytes`);
}

// The per-protocol documents ship as this skill's references/, and `getProtocolSkill` returns the
// same text. Not every catalogued protocol has one.
const document = readFileSync(new URL("../references/pancakeswap-v3.md", import.meta.url), "utf8");
check(
  getProtocolSkill("pancakeswap-v3") === document,
  "references/ is what getProtocolSkill reads",
);
check(listSkillSlugs().length < listProtocols().length, "some protocols have no document");

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

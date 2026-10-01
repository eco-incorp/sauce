// The registries a program author reads from TypeScript: which protocols exist and where, which
// contracts a program can call by name, the per-protocol documents, and how a protocol module's
// SauceScript template compiles. Compiles protocols.sauce.ts the way `sauce compile` does, with
// the registry's PancakeSwap V3 factory as the define `--define PANCAKE_V3_FACTORY=` passes.
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
import * as pancakeV3 from "@eco-incorp/sauce/protocols/pancakeswap-v3";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

// Catalogued on Base (metadata and deployments), a much larger set than the callable namespaces.
const onBase = getProtocolsByChain(8453);
check(getProtocol("pancakeswap-v3")?.slug === "pancakeswap-v3", "catalog lookup by slug");
check(contracts.on("base").AaveV3.Pool.available, "AaveV3.Pool is a namespace on Base");

// protocols.sauce.ts binds the ABI the SDK serves to the address the protocol module's
// `deployments` record for the chain, passed as a define; where there is none, the default 0 leaves
// the venue out.
const source = readFileSync(new URL("./protocols.sauce.ts", import.meta.url), "utf8");
const sizes: string[] = [];
for (const slug of ["base", "arbitrum"]) {
  const chain = routes.chain(slug).chain;
  const factory = pancakeV3.deployments.find((d) => d.chainId === chain.id)?.addresses.factory;
  check(factory !== undefined, `pancakeswap-v3 records a factory on ${slug}`);
  const program = routes.compileSauceProgram(slug, source, {
    defines: { PANCAKE_V3_FACTORY: BigInt(factory) },
  });
  check(program.source.includes("__sauce_approve(USDC,"), "the approve is SafeERC20");
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

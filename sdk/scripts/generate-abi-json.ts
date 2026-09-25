// Generates JSON ABI files from each protocol's abis.ts
// Run with: bun run scripts/generate-abi-json.ts

import { readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const protocolsDir = join(import.meta.dir, "../src/protocols");
const protocols = readdirSync(protocolsDir).filter((d) =>
  existsSync(join(protocolsDir, d, "abis.ts")),
);

let generated = 0;

for (const protocol of protocols) {
  const mod = await import(`../src/protocols/${protocol}/abis.ts`);
  for (const [name, value] of Object.entries(mod)) {
    if (!Array.isArray(value)) continue;
    const jsonPath = join(protocolsDir, protocol, `${name}.json`);
    writeFileSync(jsonPath, JSON.stringify({ abi: value }, null, 2) + "\n");
    generated++;
  }
}

console.log(`Generated ${generated} JSON ABI files across ${protocols.length} protocols`);

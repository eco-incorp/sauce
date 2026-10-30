import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Measure installed package artifacts; no compilation or network access occurs here. */
export function readInstalledCompilerProvenance(
  directory = dirname(dirname(require.resolve("sauce-compiler"))),
) {
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (
    manifest.name !== "@eco-incorp/sauce-compiler" ||
    typeof manifest.version !== "string" ||
    !manifest.version
  ) {
    throw new Error("Compiler provenance requires the actual @eco-incorp/sauce-compiler package");
  }
  const nodeDigest = createHash("sha256")
    .update(readFileSync(join(directory, "node/sauce_wasm_bg.wasm")))
    .digest("hex");
  const browserDigest = createHash("sha256")
    .update(readFileSync(join(directory, "web/sauce_wasm_bg.wasm")))
    .digest("hex");
  if (nodeDigest !== browserDigest) {
    throw new Error("Compiler Node/browser WASM artifacts differ; one digest cannot identify both");
  }

  return { compiler: manifest.version, wasmSha256: nodeDigest };
}

/** Produce the fixed public known-answer program from those exact measured compiler artifacts. */
export function compileInstalledCompilerProbe(
  directory = dirname(dirname(require.resolve("sauce-compiler"))),
) {
  const provenance = readInstalledCompilerProvenance(directory);
  const compiler = require(join(directory, "node/sauce_wasm.js"));
  const { bytecode } = compiler.compile({
    target: "evm",
    resolve: (path) =>
      path === "main.js"
        ? new TextEncoder().encode("function main(): Uint256 { return 42; }")
        : undefined,
  });
  const program = `0x${Buffer.from(bytecode).toString("hex")}`;
  if (program.length <= 2 || program.length > 2050) {
    throw new Error("Compiler compatibility program must contain 1..1024 bytes");
  }

  return { ...provenance, program };
}

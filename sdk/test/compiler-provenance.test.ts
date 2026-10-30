import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  compileInstalledCompilerProbe,
  readInstalledCompilerProvenance,
} from "../scripts/lib/compiler-provenance.mjs";
import {
  COMPILER_COMPATIBILITY_PROBES,
  COMPILER_PROVENANCE,
} from "../src/embedded/compiler.generated.js";

const require = createRequire(import.meta.url);

describe("actual compiler WASM provenance", () => {
  it("embeds the installed compiler version and actual identical Node/browser WASM digest", () => {
    const directory = dirname(dirname(require.resolve("sauce-compiler")));
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      version: string;
    };
    const digest = createHash("sha256")
      .update(readFileSync(join(directory, "node/sauce_wasm_bg.wasm")))
      .digest("hex");
    expect(readInstalledCompilerProvenance()).toEqual({
      compiler: manifest.version,
      wasmSha256: digest,
    });
    expect(COMPILER_PROVENANCE).toEqual({ compiler: manifest.version, wasmSha256: digest });
  });

  it("retains trusted exact probe bytes produced by the measured installed compiler", () => {
    const actual = compileInstalledCompilerProbe();
    expect(COMPILER_COMPATIBILITY_PROBES[actual.compiler]).toEqual({
      compilerWasmSha256: actual.wasmSha256,
      program: actual.program,
    });
  });

  it("refuses divergent backend bytes rather than reporting one false cross-platform identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "sauce-compiler-provenance-"));
    try {
      mkdirSync(join(directory, "node"));
      mkdirSync(join(directory, "web"));
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ name: "@eco-incorp/sauce-compiler", version: "2.6.1" }),
      );
      writeFileSync(join(directory, "node/sauce_wasm_bg.wasm"), "node bytes");
      writeFileSync(join(directory, "web/sauce_wasm_bg.wasm"), "different web bytes");
      expect(() => readInstalledCompilerProvenance(directory)).toThrow(/Node\/browser WASM/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

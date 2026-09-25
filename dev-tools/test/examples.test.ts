/**
 * Tests that all example scripts in sauce/js and sauce/ts compile successfully.
 * Run with: npm test
 */

import { join, dirname } from "path";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

// wasm-pack `--target nodejs` output: a CommonJS build reading its sibling `.wasm` at load, so
// Node's own CJS loader must resolve it.
const { compile: compileWasm } = createRequire(import.meta.url)("sauce-compiler") as {
  compile: (options: {
    target: "evm" | "svm";
    entry: string;
    resolve: (path: string) => Uint8Array | undefined;
  }) => { bytecode: Uint8Array };
};

const ENTRY = "main.js";

/** Compile one program, resolving any non-entry import off disk against `baseDirs`. */
function compile(source: string, baseDirs: readonly string[]): { bytecode: Uint8Array } {
  return compileWasm({
    target: "evm",
    entry: ENTRY,
    resolve: (path) => {
      const key = path.replace(/^\.\//, "");
      if (key === ENTRY) return Buffer.from(source);
      for (const dir of baseDirs) {
        const candidate = join(dir, key);
        if (existsSync(candidate)) return readFileSync(candidate);
      }

      return undefined;
    },
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const JS_DIR = join(ROOT, "sauce", "js");
const TS_DIR = join(ROOT, "sauce", "ts");
const BASE_DIRS = [ROOT, join(ROOT, "node_modules")];

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    console.log(`  ✕ ${name}`);
    console.log(`    ${(e as Error).message}`);
    failed++;
  }
}

function ok(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${expected}, got ${actual}`);
  }
}

console.log("\nexample scripts compile (sauce/js)");
const jsScripts = readdirSync(JS_DIR).filter((f) => f.endsWith(".js"));

for (const file of jsScripts) {
  test(`sauce/js/${file}`, () => {
    const source = readFileSync(join(JS_DIR, file), "utf-8");
    const result = compile(source, BASE_DIRS);
    ok(result.bytecode.length >= 1, "should produce a non-empty program");
    for (const seg of [result.bytecode]) {
      ok(seg.length > 0, "segment should not be empty");
    }
  });
}

console.log("\nexample scripts compile (sauce/ts)");
const tsScripts = readdirSync(TS_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

for (const file of tsScripts) {
  test(`sauce/ts/${file}`, () => {
    const source = readFileSync(join(TS_DIR, file), "utf-8");
    const result = compile(source, BASE_DIRS);
    ok(result.bytecode.length >= 1, "should produce a non-empty program");
    for (const seg of [result.bytecode]) {
      ok(seg.length > 0, "segment should not be empty");
    }
  });
}

console.log("\nts and js produce identical bytecodes");

for (const tsFile of tsScripts) {
  const jsFile = tsFile.replace(/\.ts$/, ".js");
  if (!jsScripts.includes(jsFile)) continue;
  test(`sauce/ts/${tsFile} matches sauce/js/${jsFile}`, () => {
    // The compiler reads the annotated source directly, so the .ts twin needs no strip step —
    // the annotations are erased by the frontend, which is exactly the parity being asserted.
    const jsSource = readFileSync(join(JS_DIR, jsFile), "utf-8");
    const tsSource = readFileSync(join(TS_DIR, tsFile), "utf-8");
    const jsHex = Buffer.from(compile(jsSource, BASE_DIRS).bytecode).toString("hex");
    const tsHex = Buffer.from(compile(tsSource, BASE_DIRS).bytecode).toString("hex");
    eq(jsHex, tsHex, "bytecode mismatch");
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

/**
 * Tests for the SauceScript runner (compilation + define injection).
 * Run with: npm run test:runner
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { compileScript, parseDefine } from "../src/runner";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ✕ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function ok(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function eq(actual: any, expected: any, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${expected}, got ${actual}`);
  }
}

// --- parseDefine ---

console.log("\nparseDefine");

test("splits NAME=VALUE", () => {
  const [name, value] = parseDefine("AMOUNT=42");
  eq(name, "AMOUNT");
  eq(value, "42");
});

test("keeps a 0x-hex value verbatim", () => {
  eq(parseDefine("ADDR=0xff")[1], "0xff");
});

test("rejects a pair with no '='", () => {
  let threw = false;
  try {
    parseDefine("AMOUNT");
  } catch {
    threw = true;
  }
  ok(threw, "should reject a bare name");
});

test("rejects a non-integer value early", () => {
  let threw = false;
  try {
    parseDefine("AMOUNT=notanumber");
  } catch {
    threw = true;
  }
  ok(threw, "should reject a value the compiler could not read");
});

// --- compileScript (no args) ---

console.log("\ncompileScript without args");

test("compiles add.js", () => {
  const result = compileScript(join(ROOT, "sauce/js/add.js"), ROOT);
  eq(result.bytecodes.length, 1, "should produce 1 segment");
  ok(result.bytecodes[0].startsWith("0x"), "bytecode should be hex");
  eq(result.warnings.length, 0, "should have no warnings");
});

test("compiles fibonacci.js", () => {
  const result = compileScript(join(ROOT, "sauce/js/fibonacci.js"), ROOT);
  ok(result.bytecodes.length >= 1, "should produce at least 1 segment");
  eq(result.warnings.length, 0, "should have no warnings");
});

test("compiles erc20.js", () => {
  const result = compileScript(join(ROOT, "sauce/js/erc20.js"), ROOT);
  ok(result.bytecodes.length >= 1, "should produce at least 1 segment");
  eq(result.warnings.length, 0, "should have no warnings");
});

// --- compileScript (with defines) ---

console.log("\ncompileScript with defines");

const FIXTURE = join(__dirname, "fixtures/defined.js");

test("a define overrides the script's own const and changes the bytecode", () => {
  const plain = compileScript(FIXTURE, ROOT);
  const defined = compileScript(FIXTURE, ROOT, { AMOUNT: 4242n });
  ok(plain.bytecodes[0] !== defined.bytecodes[0], "a define should change the emitted bytes");
});

test("the same define reproduces the same bytecode", () => {
  const a = compileScript(FIXTURE, ROOT, { AMOUNT: 7n });
  const b = compileScript(FIXTURE, ROOT, { AMOUNT: 7n });
  eq(a.bytecodes[0], b.bytecodes[0], "compilation should be deterministic");
});

test("a 0x-hex define value is accepted", () => {
  const result = compileScript(FIXTURE, ROOT, { AMOUNT: "0xff" });
  eq(result.bytecodes.length, 1, "should produce 1 segment");
  ok(result.bytecodes[0].startsWith("0x"), "bytecode should be hex");
});

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

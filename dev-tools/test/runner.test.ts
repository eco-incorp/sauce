/**
 * Tests for the SauceScript runner (compilation + define injection + runtime arg injection).
 * Run with: npm run test:runner
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { compileScript, parseArg, parseDefine } from "../src/runner";

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

// --- parseArg ---

console.log("\nparseArg");

test("parses integer as bigint", () => {
  eq(parseArg("42"), 42n);
});

test("parses negative integer as bigint", () => {
  eq(parseArg("-1"), -1n);
});

test("parses short hex as bigint", () => {
  // 0x followed by up to 64 hex chars (32 bytes) → bigint
  eq(parseArg("0xff"), 255n);
});

test("parses long hex as string", () => {
  // > 66 chars (0x + 64) → kept as string (bytes)
  const longHex = "0x" + "ab".repeat(33); // 68 chars
  eq(parseArg(longHex), longHex);
});

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

test("rejects an empty value", () => {
  // BigInt("") is 0n rather than a throw, so the guard cannot be the BigInt call alone.
  let threw = false;
  try {
    parseDefine("AMOUNT=");
  } catch {
    threw = true;
  }
  ok(threw, "should reject NAME= with no value");
});

test("rejects a reserved word as a name", () => {
  // Identifier SHAPE is not enough: `const=5` passes the regex, then the compiler refuses it with a
  // bare "compiling the program failed" that names nothing. Measured against the pinned compiler.
  for (const word of ["const", "class", "function", "return", "let", "void", "if"]) {
    let threw = false;
    try {
      parseDefine(`${word}=5`);
    } catch {
      threw = true;
    }
    ok(threw, `should reject reserved word ${JSON.stringify(word)}`);
  }
});

test("rejects an all-whitespace value", () => {
  // Same 0n trap as the empty case: BigInt(" ") and BigInt("\n") are both 0n.
  for (const spelling of ["AMOUNT= ", "AMOUNT=   ", "AMOUNT=\n", "AMOUNT=\t"]) {
    let threw = false;
    try {
      parseDefine(spelling);
    } catch {
      threw = true;
    }
    ok(threw, `should reject ${JSON.stringify(spelling)}`);
  }
});

test("rejects a negative value", () => {
  // BigInt("-5") is -5n and the minus sign survives normalization, so this needs its own guard.
  let threw = false;
  try {
    parseDefine("AMOUNT=-5");
  } catch {
    threw = true;
  }
  ok(threw, "a define is one unsigned 256-bit word");
});

test("accepts the largest 256-bit word", () => {
  const max = (1n << 256n) - 1n;
  eq(parseDefine(`AMOUNT=${max}`)[1], max.toString());
});

test("rejects a value above the largest 256-bit word", () => {
  // BigInt is unbounded, so 2^256 — the first value no word holds — and a 100-digit decimal both
  // read fine and stay in the compiler's grammar; only the ceiling guard stops them.
  for (const spelling of [`AMOUNT=${1n << 256n}`, `AMOUNT=${"9".repeat(100)}`]) {
    let threw = false;
    try {
      parseDefine(spelling);
    } catch {
      threw = true;
    }
    ok(threw, `should reject ${JSON.stringify(spelling)}`);
  }
});

test("trims the name", () => {
  const [name, value] = parseDefine(" A=5");
  eq(name, "A");
  eq(value, "5");
});

test("rejects a name that is not an identifier", () => {
  // A define replaces a module const of that name, so a name no source could have declared binds to
  // nothing. The '=' guard passes all of these: it only catches a missing or leading '='.
  for (const spelling of ["1BAD=5", "a-b=5", "A B=5"]) {
    let threw = false;
    try {
      parseDefine(spelling);
    } catch {
      threw = true;
    }
    ok(threw, `should reject ${JSON.stringify(spelling)}`);
  }
});

test("rejects an all-whitespace name", () => {
  // ' =5' has its '=' at index 1, so it clears the '=' guard and is empty only after trimming.
  for (const spelling of [" =5", "\t=5"]) {
    let threw = false;
    try {
      parseDefine(spelling);
    } catch {
      threw = true;
    }
    ok(threw, `should reject ${JSON.stringify(spelling)}`);
  }
});

// BigInt accepts more spellings than the compiler's `decimal or 0x-hex` define grammar, so every one
// of these used to pass parseDefine and then fail mid-compile. They are normalized instead.
test("normalizes the spellings the compiler's define grammar does not accept", () => {
  eq(parseDefine("AMOUNT=  12  ")[1], "12", "surrounding whitespace");
  eq(parseDefine("AMOUNT=0b101")[1], "5", "binary literal");
  eq(parseDefine("AMOUNT=0o7")[1], "7", "octal literal");
  eq(parseDefine("AMOUNT=+5")[1], "5", "leading plus");
  eq(parseDefine("AMOUNT=00042")[1], "42", "leading zeros");
  eq(parseDefine("AMOUNT=  0xff  ")[1], "0xff", "a padded hex literal keeps its radix, trimmed");
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
  const defined = compileScript(FIXTURE, ROOT, { defines: { AMOUNT: 4242n } });
  ok(plain.bytecodes[0] !== defined.bytecodes[0], "a define should change the emitted bytes");
});

test("the same define reproduces the same bytecode", () => {
  const a = compileScript(FIXTURE, ROOT, { defines: { AMOUNT: 7n } });
  const b = compileScript(FIXTURE, ROOT, { defines: { AMOUNT: 7n } });
  eq(a.bytecodes[0], b.bytecodes[0], "compilation should be deterministic");
});

test("a 0x-hex define value is accepted", () => {
  const result = compileScript(FIXTURE, ROOT, { defines: { AMOUNT: "0xff" } });
  eq(result.bytecodes.length, 1, "should produce 1 segment");
  ok(result.bytecodes[0].startsWith("0x"), "bytecode should be hex");
});

// --- compileScript (with runtime args) ---

console.log("\ncompileScript with runtime args");

const ADD = join(ROOT, "sauce/js/add.js");

test("args are APPENDED to the program, leaving the program bytes unchanged", () => {
  const plain = compileScript(ADD, ROOT);
  const withArgs = compileScript(ADD, ROOT, { args: [5n, 10n] });
  ok(withArgs.bytecodes[0].startsWith(plain.bytecodes[0]), "the program must be the same bytes");
  eq(
    withArgs.bytecodes[0].length - plain.bytecodes[0].length,
    128,
    "two scalar args should add two 32-byte words",
  );
});

test("a scalar arg lands as a 32-byte big-endian word", () => {
  const tail = compileScript(ADD, ROOT, { args: [5n, 10n] }).bytecodes[0].slice(-128);
  eq(tail.slice(0, 64), "5".padStart(64, "0"));
  eq(tail.slice(64), "a".padStart(64, "0"));
});

test("a negative arg lands as its two's complement word", () => {
  const tail = compileScript(ADD, ROOT, { args: [-1n, 0n] }).bytecodes[0].slice(-128);
  eq(tail.slice(0, 64), "f".repeat(64));
});

test("erc20.js — main(to, amount) — takes runtime args", () => {
  const result = compileScript(join(ROOT, "sauce/js/erc20.js"), ROOT, {
    args: [0x1111111111111111111111111111111111111111n, 1000n],
  });
  eq(result.warnings.length, 0, "should have no warnings");
  ok(result.bytecodes[0].length > 2, "bytecode should be hex");
});

test("a define folds into the program while an arg only extends its tail", () => {
  const fixture = join(__dirname, "fixtures/defined-args.js");
  const plain = compileScript(fixture, ROOT, { args: [1n] });
  const defined = compileScript(fixture, ROOT, { defines: { AMOUNT: 4242n }, args: [1n] });
  ok(plain.bytecodes[0] !== defined.bytecodes[0], "a define should change the emitted bytes");
  eq(plain.bytecodes[0].slice(-64), defined.bytecodes[0].slice(-64), "the arg word should be identical");
});

// Everything parseDefine accepts must actually COMPILE — the property the normalization above exists
// for. Each spelling is fed through the same path the CLI uses (parseDefine -> compileScript) and must
// produce the bytes of its canonical decimal form; a spelling the compiler refuses throws here.
test("every spelling parseDefine accepts compiles, and to the same bytes as its decimal form", () => {
  const compileWith = (pair: string) =>
    compileScript(FIXTURE, ROOT, { defines: Object.fromEntries([parseDefine(pair)]) }).bytecodes[0];
  const canonical = compileWith("AMOUNT=42");
  for (const spelling of ["AMOUNT=  42  ", "AMOUNT=0b101010", "AMOUNT=0o52", "AMOUNT=+42", "AMOUNT=00042", "AMOUNT=0x2a"]) {
    eq(compileWith(spelling), canonical, `${spelling} should compile to the bytes of AMOUNT=42`);
  }
});

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

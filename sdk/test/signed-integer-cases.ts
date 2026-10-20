/**
 * What SauceScript's signed integers do at run time, as programs and the word each returns, for
 * the two suites that execute them: `evm/signed-integers.e2e.test.ts` on the released gated engine
 * and `svm/signed-integers.e2e.test.ts` on the released Solana engine. One table, so the two
 * targets are held to the same answers.
 *
 * Compiling proves little. Whether a negative stays negative, whether a conversion keeps its value
 * or rejects it and whether an overflow reverts are run-time facts. Every program therefore takes
 * the bit pattern it works on as a `main` parameter, which keeps the compiler from folding it, and
 * each row names a negative value, a boundary or a revert.
 */

export const WORD = 2n ** 256n;
/** Int256's largest value. */
export const MAX = 2n ** 255n - 1n;
/** Int256's smallest value. */
export const MIN = -(2n ** 255n);
/** The word a signed value is. */
export const bits = (value: bigint): bigint => BigInt.asUintN(256, value);

export const REVERTS = "reverts";

export interface SignedCase {
  group: string;
  name: string;
  source: string;
  /** `main`'s parameters, each a word. */
  args: readonly bigint[];
  /** What `main` returns, read as signed when `signed`, or that the cook reverts. */
  returns: bigint | typeof REVERTS;
  signed?: boolean;
  /** The program uses a builtin only the EVM arm has. */
  evmOnly?: boolean;
}

const one = (source: string) => `function main(x: Uint256): ${source}`;
const two = (source: string) => `function main(a: Uint256, b: Uint256): ${source}`;

const toInt = one("Int256 { return Int256(x); }");
const fromBits = one("Int256 { return Int256.fromBits(x); }");
const toUint = one("Uint256 { return Uint256(Int256.fromBits(x)); }");
const toBits = one("Uint256 { return Uint256.fromBits(Int256.fromBits(x)); }");
const onSigned = (body: string) => one(`Int256 { const a = Int256.fromBits(x); ${body} }`);
const mixed = (operator: string) => two(`bool { return Int256.fromBits(a) ${operator} b; }`);
const signedLt = two("bool { return Int256.fromBits(a) < Int256.fromBits(b); }");
const lt = two("bool { return a < b; }");
const signedDiv = two("Int256 { return Int256.fromBits(a) / Int256.fromBits(b); }");
const signedMod = two("Int256 { return Int256.fromBits(a) % Int256.fromBits(b); }");
const signedShr = two("Int256 { return Int256.fromBits(a) >> Int256.fromBits(b); }");
const signExtend = two("Int256 { return Math.signExtend(a, b); }");
const negateSigned = one("Int256 { return -Int256(x); }");
const negateUnsigned = one("Uint256 { return -x; }");
const negativeWord = one("Uint256 { return Uint256.fromBits(-Int256(x)); }");

const row = (
  group: string,
  name: string,
  source: string,
  args: readonly bigint[],
  returns: bigint | typeof REVERTS,
  signed = false,
  evmOnly = false,
): SignedCase => ({ group, name, source, args, returns, signed, evmOnly });

export const SIGNED_CASES: readonly SignedCase[] = [
  // Int256(x) and Uint256(x) keep the value; they reject what does not fit.
  row("Int256(x)", "keeps 0", toInt, [0n], 0n, true),
  row("Int256(x)", "keeps the largest value, 2^255 - 1", toInt, [MAX], MAX, true),
  row("Int256(x)", "rejects 2^255", toInt, [MAX + 1n], REVERTS),
  row("Int256(x)", "rejects the largest unsigned word", toInt, [WORD - 1n], REVERTS),
  row("Uint256(x)", "keeps a non-negative value", toUint, [5n], 5n),
  row("Uint256(x)", "keeps 2^255 - 1", toUint, [MAX], MAX),
  row("Uint256(x)", "rejects -1", toUint, [bits(-1n)], REVERTS),
  row("Uint256(x)", "rejects the smallest value", toUint, [2n ** 255n], REVERTS),

  // fromBits keeps the bits.
  row("Int256.fromBits", "the all-ones word is -1", fromBits, [WORD - 1n], -1n, true),
  row("Int256.fromBits", "bit 255 alone is the smallest value", fromBits, [2n ** 255n], MIN, true),
  row("Int256.fromBits", "reads -8's word as -8", fromBits, [bits(-8n)], -8n, true),
  row("Int256.fromBits", "leaves 2^255 - 1 alone", fromBits, [MAX], MAX, true),
  row("Uint256.fromBits", "gives -1 the all-ones word", toBits, [bits(-1n)], WORD - 1n),
  row("Uint256.fromBits", "gives -8 its two's-complement word", toBits, [bits(-8n)], WORD - 8n),
  row("Uint256.fromBits", "leaves 7 alone", toBits, [7n], 7n),

  // Arithmetic on Int256.
  row("Int256 arithmetic", "a + -1 crosses zero", onSigned("return a + -1;"), [0n], -1n, true),
  row("Int256 arithmetic", "a + -1 on 5", onSigned("return a + -1;"), [5n], 4n, true),
  row("Int256 arithmetic", "a + -1 on -1", onSigned("return a + -1;"), [bits(-1n)], -2n, true),
  row(
    "Int256 arithmetic",
    "/ truncates toward zero",
    onSigned("return a / 2;"),
    [bits(-7n)],
    -3n,
    true,
  ),
  row(
    "Int256 arithmetic",
    "% takes the dividend's sign",
    onSigned("return a % 3;"),
    [bits(-7n)],
    -1n,
    true,
  ),
  row("Int256 arithmetic", "% by a negative divisor", onSigned("return a % -3;"), [7n], 1n, true),
  row(
    "Int256 arithmetic",
    "the smallest value / -1 reverts",
    onSigned("return a / -1;"),
    [bits(MIN)],
    REVERTS,
  ),
  row(
    "Int256 arithmetic",
    "negating the smallest value reverts",
    onSigned("return -a;"),
    [bits(MIN)],
    REVERTS,
  ),
  row("Int256 arithmetic", "negating -5 gives 5", onSigned("return -a;"), [bits(-5n)], 5n, true),
  row(
    "Int256 arithmetic",
    "one past the largest value reverts",
    onSigned("return a + 1;"),
    [MAX],
    REVERTS,
  ),
  row(
    "Int256 arithmetic",
    "one below the smallest value reverts",
    onSigned("return a - 1;"),
    [bits(MIN)],
    REVERTS,
  ),
  row(
    "Int256 arithmetic",
    ">> propagates the sign",
    onSigned("return a >> 1;"),
    [bits(-8n)],
    -4n,
    true,
  ),
  row(
    "Int256 arithmetic",
    ">> past 255 bits leaves -1",
    onSigned("return a >> 300;"),
    [bits(-8n)],
    -1n,
    true,
  ),
  row(
    "Uint256 arithmetic",
    ">> fills with zeros",
    one("Uint256 { return x >> 1; }"),
    [bits(-8n)],
    bits(-8n) >> 1n,
  ),

  // Comparisons are mathematical between signed and unsigned.
  row("comparison", "-1 is below 0", mixed("<"), [bits(-1n), 0n], 1n),
  row(
    "comparison",
    "-1 is below the word that holds its bits",
    mixed("<"),
    [bits(-1n), WORD - 1n],
    1n,
  ),
  row("comparison", "-1 equals no Uint256", mixed("=="), [bits(-1n), WORD - 1n], 0n),
  row(
    "comparison",
    "-1 differs from the word that holds its bits",
    mixed("!="),
    [bits(-1n), WORD - 1n],
    1n,
  ),
  row("comparison", "-1 is not at least 0", mixed(">="), [bits(-1n), 0n], 0n),
  row("comparison", "3 < 4", mixed("<"), [3n, 4n], 1n),
  row("comparison", "4 < 3", mixed("<"), [4n, 3n], 0n),
  row("comparison", "4 == 4", mixed("=="), [4n, 4n], 1n),
  row("comparison", "2^255 - 1 is below 2^255", mixed("<"), [MAX, 2n ** 255n], 1n),
  // A Uint256 word that holds signed bits compares as signed once read with fromBits; plain < reads it
  // as the largest number.
  row(
    "two's complement",
    "fromBits reads the all-ones word as below 0",
    signedLt,
    [WORD - 1n, 0n],
    1n,
  ),
  row("two's complement", "where < reads it as above", lt, [WORD - 1n, 0n], 0n),
  row("two's complement", "0 is not below the all-ones word", signedLt, [0n, WORD - 1n], 0n),

  // Signed division, remainder and shift on two words read with fromBits.
  row("two's complement", "-7 / 2 rounds toward zero", signedDiv, [bits(-7n), 2n], -3n, true),
  row("two's complement", "7 / -2", signedDiv, [7n, bits(-2n)], -3n, true),
  row(
    "two's complement",
    "the smallest value / -1 reverts",
    signedDiv,
    [bits(MIN), bits(-1n)],
    REVERTS,
  ),
  row("two's complement", "a zero divisor reverts", signedDiv, [1n, 0n], REVERTS),
  row("two's complement", "-7 % 3", signedMod, [bits(-7n), 3n], -1n, true),
  row("two's complement", "7 % -3", signedMod, [7n, bits(-3n)], 1n, true),
  row("two's complement", "a zero modulus reverts", signedMod, [1n, 0n], REVERTS),
  row("two's complement", "-8 >> 1", signedShr, [bits(-8n), 1n], -4n, true),
  row(
    "two's complement",
    "-1 >> 300, a run-time count past 255",
    signedShr,
    [bits(-1n), 300n],
    -1n,
    true,
  ),
  row("two's complement", "8 >> 1", signedShr, [8n, 1n], 4n, true),
  row(
    "two's complement",
    "a negative shift count reverts",
    signedShr,
    [bits(-8n), bits(-1n)],
    REVERTS,
  ),
  row("Math.signExtend", "0xff from byte 0 is -1", signExtend, [0xffn, 0n], -1n, true),
  row("Math.signExtend", "0x7f from byte 0 is 127", signExtend, [0x7fn, 0n], 127n, true),
  row("Math.signExtend", "0xfffe from byte 1 is -2", signExtend, [0xfffen, 1n], -2n, true),

  // Negation.
  row("negation", "-x on an Int256 is -5 for 5", negateSigned, [5n], -5n, true),
  row("negation", "-x on an Int256 is 0 for 0", negateSigned, [0n], 0n, true),
  row("negation", "-x on a Uint256 is 0 for 0", negateUnsigned, [0n], 0n),
  row("negation", "-x on a Uint256 reverts for 5", negateUnsigned, [5n], REVERTS),
  row(
    "negation",
    "-x on a Uint256 reverts for the largest word",
    negateUnsigned,
    [WORD - 1n],
    REVERTS,
  ),
  row(
    "negation",
    "a negative amount's word is Uint256.fromBits(-Int256(x))",
    negativeWord,
    [5n],
    WORD - 5n,
  ),
  row("negation", "and 0 stays 0", negativeWord, [0n], 0n),
  row("negation", "~x on an Int256 is -x - 1", onSigned("return ~a;"), [5n], -6n, true),

  // Kinds and contexts.
  row(
    "literal context",
    "a literal expression in an Int256 context is signed",
    one("Int256 { const d: Int256 = 1 - 2; return d + Int256(x); }"),
    [0n],
    -1n,
    true,
  ),
  row(
    "literal context",
    "beside a Uint256, 1 - 2 is an underflow",
    two("Uint256 { return a - b; }"),
    [0n, 1n],
    REVERTS,
  ),
  row(
    "annotation",
    "a Uint256 local given a non-negative Int256 keeps it",
    one("Uint256 { const d: Uint256 = Int256.fromBits(x); return d; }"),
    [5n],
    5n,
  ),
  row(
    "annotation",
    "a Uint256 local given a negative Int256 reverts",
    one("Uint256 { const d: Uint256 = Int256.fromBits(x); return d; }"),
    [bits(-1n)],
    REVERTS,
  ),
  row(
    "annotation",
    "a Uint256 return given a negative Int256 reverts",
    one("Uint256 { return Int256.fromBits(x); }"),
    [bits(-1n)],
    REVERTS,
  ),
  row(
    "annotation",
    "a Uint256 return given a non-negative Int256 keeps it",
    one("Uint256 { return Int256.fromBits(x); }"),
    [7n],
    7n,
  ),

  // The unsigned Math helpers convert an Int256 argument with a check.
  row(
    "Math.mulDiv",
    "takes a non-negative Int256",
    one("Uint256 { return Math.mulDiv(Int256.fromBits(x), 2, 1); }"),
    [5n],
    10n,
  ),
  row(
    "Math.mulDiv",
    "rejects a negative Int256",
    one("Uint256 { return Math.mulDiv(Int256.fromBits(x), 2, 1); }"),
    [bits(-1n)],
    REVERTS,
  ),
  row(
    "Math.sqrt",
    "takes a non-negative Int256",
    one("Uint256 { return Math.sqrt(Int256.fromBits(x)); }"),
    [16n],
    4n,
  ),
  row(
    "Math.sqrt",
    "rejects a negative Int256",
    one("Uint256 { return Math.sqrt(Int256.fromBits(x)); }"),
    [bits(-1n)],
    REVERTS,
  ),

  // abi.decode reads an "Int256" field as signed. EVM only: `abi` has no Solana arm.
  row(
    "abi.decode",
    "an Int256 field is signed",
    one('Int256 { const t = abi.decode(abi.encode(x), ["Int256"]); return t[0]; }'),
    [bits(-7n)],
    -7n,
    true,
    true,
  ),

  // A module-level let may start negative.
  row(
    "module let",
    "a negative literal is an Int256",
    "let n = -3; function main(): Int256 { return n; }",
    [],
    -3n,
    true,
  ),
];

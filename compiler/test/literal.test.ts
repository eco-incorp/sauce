import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

// Helper to extract hex bytes from compiled bytecode
const compileLiteral = (literal: string): string => {
  const source = `function main() { return ${literal}; }`;
  const result = compile(source);

  return Buffer.from(result.bytecode[0]).toString('hex');
};

describe('literal', () => {
  it('compiles positive integer', () => {
    const result = compile('function main() { const x = 42; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BYTE_1, 42]));
  });

  it('compiles negative integer', () => {
    const result = compile('function main() { const x = -5; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.NEG, OPS.BYTE_1, 5]),
    );
  });

  it('compiles bigint literal', () => {
    const result = compile('function main() { const x = 255n; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BYTE_1, 255]));
  });

  it('throws on floating point number', () => {
    expect(() => compile('function main() { const x = 1.5; }')).toThrow('floating point numbers are not supported');
  });

  it('throws on value exceeding 32 bytes', () => {
    const huge = '0x' + 'ff'.repeat(33);
    expect(() => compile(`function main() { const x = ${huge}n; }`)).toThrow('value exceeds 32 bytes (uint256 max)');
  });

  describe('hex literal precision', () => {
    it('preserves full precision for Ethereum address (USDC)', () => {
      // USDC address: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
      // This exceeds Number.MAX_SAFE_INTEGER and would lose precision if parsed as Number
      const bytecodeHex = compileLiteral('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      const expectedAddr = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      expect(bytecodeHex).toContain(expectedAddr);
    });

    it('preserves full precision for large hex value without n suffix', () => {
      // Another large hex literal that exceeds Number.MAX_SAFE_INTEGER
      const bytecodeHex = compileLiteral('0xdeadbeefcafebabe1234567890abcdef12345678');
      const expectedHex = 'deadbeefcafebabe1234567890abcdef12345678';
      expect(bytecodeHex).toContain(expectedHex);
    });

    it('preserves full precision for negative large hex literal', () => {
      // Tests the literalToInt() code path via unary minus
      const bytecodeHex = compileLiteral('-0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      // The bytecode should contain NEG opcode followed by the full address bytes
      const expectedAddr = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      expect(bytecodeHex).toContain(expectedAddr);
    });

    it('preserves precision for value just above MAX_SAFE_INTEGER', () => {
      // Number.MAX_SAFE_INTEGER = 9007199254740991 = 0x1FFFFFFFFFFFFF
      // Use a value just above it: 0x20000000000000 = 9007199254740992
      const bytecodeHex = compileLiteral('0x20000000000000');
      expect(bytecodeHex).toContain('20000000000000');
    });
  });

  describe('compile-time constant evaluation (const-eval.ts) precision', () => {
    // The tests above pin the RUNTIME-value emission path (processLiteral/literalToInt),
    // which already parsed a literal's `.raw` source text correctly. `const-eval.ts`'s
    // `literalToBigint` is a SEPARATE evaluator (registerTopLevelConsts -> ctx.getConstant,
    // consulted for every top-level `const` read AND if/ternary branch folding) that used to
    // receive only acorn's own already-lossy `.value` for a suffix-less huge numeric literal
    // — reproduces on a PLAIN `.js`/`.sauce` source, no ts-frontend involved at all.
    it('a top-level const from a huge suffix-less numeric literal preserves full precision when read as a runtime value', () => {
      // 2^200 + 12345 is deliberately NOT a round power of 2 so a lossy Number round-trip is
      // detectable (it would drop the `+ 12345` entirely, rounding to 2^200).
      const trueValue = 2n ** 200n + 12345n;
      const source = `
        const X = ${trueValue.toString()};
        function main() { return X; }
      `;
      const hex = Buffer.from(compile(source).bytecode[0]).toString('hex');

      expect(hex).toContain(trueValue.toString(16));
    });
  });
});

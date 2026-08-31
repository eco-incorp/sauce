import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** True if `needle` appears as a contiguous subsequence of `haystack`. */
function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;

  if (needle.length > haystack.length) return false;

  return bytesToHex(haystack).includes(bytesToHex(needle));
}

describe('$ inline', () => {
  it('compiles static template (no interpolations)', () => {
    const source = `
      function main() {
        const inner = $\`return 42;\`;
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    // inner is stored on heap (dynamic)
    expect(bytes).toContain(OPS.WRITE_HEAP);
    // inner contains BYTES with the compiled inner bytecodes
    expect(bytes).toContain(OPS.BYTES);
  });

  it('compiles template with scalar interpolation', () => {
    const source = `
      function main() {
        const addr = 1;
        const inner = $\`return \${addr};\`;
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    // Should contain CONCAT (for combining static segments + encoded expression)
    expect(bytes).toContain(OPS.CONCAT);
    // Should contain ABI_ENCODE (for encoding scalar as 32 bytes)
    expect(bytes).toContain(OPS.ABI_ENCODE);
    // inner stored on heap (dynamic)
    expect(bytes).toContain(OPS.WRITE_HEAP);
  });

  it('compiles template with dynamic interpolation', () => {
    const source = `
      function main() {
        const data = Uint8Array.from([0xaa, 0xbb]);
        const inner = $\`contract.call(1, 0, \${data});\`;
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    // Should contain CONCAT (for combining segments + dynamic encoding)
    expect(bytes).toContain(OPS.CONCAT);
    // inner stored on heap (dynamic)
    expect(bytes).toContain(OPS.WRITE_HEAP);
  });

  it('compiles template with mixed scalar and dynamic interpolations', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa]);
        const inner = $\`contract.call(\${addr}, 0, \${data});\`;
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.CONCAT);
    expect(bytes).toContain(OPS.WRITE_HEAP);
  });

  it('throws on non-$ tagged template', () => {
    expect(() =>
      compile(`
      function main() {
        const x = foo\`hello\`;
      }
    `),
    ).toThrow('tagged template expressions must use $`...`');
  });

  it('compiles template with contract call using outer contracts', () => {
    const erc20Abi = [
      {
        type: 'function' as const,
        name: 'balanceOf',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view' as const,
      },
    ];

    const source = `
      function main() {
        const addr = 1;
        const inner = $\`
          return IERC20.at(\${addr}).balanceOf(2);
        \`;
      }
    `;

    const result = compile(source, {
      contracts: { IERC20: { abi: erc20Abi } },
    });
    const bytes = result.bytecode[0];

    // Should compile successfully with CONCAT and STATIC (view call)
    expect(bytes).toContain(OPS.CONCAT);
  });

  it('inner source with throw compiles', () => {
    const source = `
      function main() {
        const inner = $\`throw abi.encode(42);\`;
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    // inner stored on heap
    expect(bytes).toContain(OPS.WRITE_HEAP);
  });

  it('threads the enclosing target into the inner $-fragment compile (v12, not v1)', () => {
    // The inner fragment must be compiled for the SAME target as the enclosing
    // program. Otherwise a v12 program embeds a v1-format fragment, which reverts
    // when delegatecalled into the v12 runtime. Regression test for the inner
    // compile() defaulting to v1 regardless of ctx.target.
    const innerSrc = 'return 42;';
    const wrappedInner = `function main() { ${innerSrc} }`;

    // Standalone reference compiles of the inner fragment at each target.
    const innerV12 = compile(wrappedInner, { target: 'v12' }).bytecode[0];
    const innerV1 = compile(wrappedInner, { target: 'v1' }).bytecode[0];

    // Sanity: the two target formats genuinely differ, so the assertions below
    // actually distinguish them.
    expect(bytesToHex(innerV12)).not.toEqual(bytesToHex(innerV1));

    // Enclosing program at target v12 with a no-interpolation $-fragment. The
    // inner bytes are embedded verbatim as a BYTES literal.
    const outer = compile(`function main() { const inner = $\`${innerSrc}\`; }`, {
      target: 'v12',
    }).bytecode[0];

    // The outer v12 program must embed the v12-compiled inner fragment ...
    expect(containsSubsequence(outer, innerV12)).toBe(true);
    // ... and must NOT embed the v1-compiled fragment.
    expect(containsSubsequence(outer, innerV1)).toBe(false);
  });

  it('multiple interpolations produce correct CONCAT structure', () => {
    const source = `
      function main() {
        const a = 1;
        const b = 2;
        const c = 3;
        const inner = $\`
          const x = \${a};
          const y = \${b};
          return \${c};
        \`;
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    // Should have CONCAT with multiple parts
    expect(bytes).toContain(OPS.CONCAT);
  });
});

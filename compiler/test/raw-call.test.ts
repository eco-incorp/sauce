import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('contract.call() builtin', () => {
  it('compiles contract.call(addr, value, data)', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = ctx.msgData();
        contract.call(addr, 0, data);
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.CALL);
  });

  it('emits CALL opcode with correct operand structure', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa, 0xbb]);
        contract.call(addr, 0, data);
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    // Should contain CALL opcode
    expect(bytes).toContain(OPS.CALL);

    // CALL target is READ_VALUE 0 (addr)
    const callIdx = bytes.indexOf(OPS.CALL);
    expect(callIdx).toBeGreaterThan(0);
  });

  it('throws on wrong arity', () => {
    expect(() => compile('function main() { contract.call(1, 2); }')).toThrow(
      'contract.call expects 3 argument(s), got 2',
    );

    expect(() => compile('function main() { contract.call(1, 2, 3, 4); }')).toThrow(
      'contract.call expects 3 argument(s), got 4',
    );
  });

  it('result is dynamic (bytes)', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa]);
        const result = contract.call(addr, 0, data);
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    // result stored in heap (WRITE_HEAP) since call returns dynamic
    expect(bytes).toContain(OPS.WRITE_HEAP);
  });
});

describe('contract.static() builtin', () => {
  it('compiles contract.static(addr, data)', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa, 0xbb]);
        contract.static(addr, data);
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.STATIC);
  });

  it('throws on wrong arity', () => {
    expect(() => compile('function main() { contract.static(1); }')).toThrow(
      'contract.static expects 2 argument(s), got 1',
    );

    expect(() => compile('function main() { contract.static(1, 2, 3); }')).toThrow(
      'contract.static expects 2 argument(s), got 3',
    );
  });
});

describe('contract.delegate() builtin', () => {
  it('compiles contract.delegate(addr, data)', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa, 0xbb]);
        contract.delegate(addr, data);
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.DELEGATE);
  });

  it('throws on wrong arity', () => {
    expect(() => compile('function main() { contract.delegate(1); }')).toThrow(
      'contract.delegate expects 2 argument(s), got 1',
    );

    expect(() => compile('function main() { contract.delegate(1, 2, 3); }')).toThrow(
      'contract.delegate expects 2 argument(s), got 3',
    );
  });
});

describe('raw call with .catch()', () => {
  it('contract.call with .catch() emits CATCH opcode', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa]);
        contract.call(addr, 0, data).catch(() => {});
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.CALL);
    expect(bytes).toContain(OPS.CATCH);
  });

  it('contract.static with .catch() emits CATCH opcode', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa]);
        contract.static(addr, data).catch(() => {});
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.STATIC);
    expect(bytes).toContain(OPS.CATCH);
  });

  it('contract.call with .catch(e) captures revert data', () => {
    const source = `
      function main() {
        const addr = 1;
        const data = Uint8Array.from([0xaa]);
        contract.call(addr, 0, data).catch((e) => {
          const x = e.length;
        });
      }
    `;

    const result = compile(source);
    const bytes = result.bytecode[0];

    expect(bytes).toContain(OPS.CALL);
    expect(bytes).toContain(OPS.CATCH);
    expect(bytes).toContain(OPS.WRITE_HEAP);
  });
});

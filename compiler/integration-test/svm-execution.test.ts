/**
 * SVM engine execution through THIS compiler: `target: 'svm'` bytecode built by
 * compile() runs on the real SVM engine in LiteSVM — the SVM twin of the
 * cast/anvil cook() harness (utils.ts). Covers pure compute, accountData/
 * writeAccountData over account data, revert payloads, CPI (system transfer +
 * pre-flight catch) and the chain context divergences (MSG_SENDER = payer,
 * synthetic CHAIN_ID).
 *
 * Runs against the vendored engine .so (artifacts/svm/engine.so, committed —
 * see svm-utils.ts) by default; SAUCE_ENGINE_SO overrides it. Skips only if
 * that binary is somehow missing.
 */
import { getAddressCodec } from '@solana/kit';
import { compile } from '../src/index.js';
import { canRunSvm, randomSvmAddress, startSvm, svmCook, svmHex, svmUint, SYSTEM_PROGRAM } from './svm-utils.js';
import type { SvmCookResult, SvmHarness } from './svm-utils.js';

const describeSvm = canRunSvm() ? describe : describe.skip;

const expectFail = (r: SvmCookResult): { revertData?: Uint8Array; err: string; logs: string[] } => {
  if (r.ok) throw new Error('expected the transaction to fail, but it succeeded');

  return r;
};

describeSvm('integration: svm pure compute', () => {
  let h: SvmHarness;

  beforeAll(async () => {
    h = await startSvm();
  });

  const cases: { name: string; src: string; expected: bigint }[] = [
    { name: 'arithmetic precedence', src: 'function main() { return 3 + 4 * 5 }', expected: 23n },
    { name: 'division and modulo', src: 'function main() { return (17 / 5) * 5 + (17 % 5) }', expected: 17n },
    { name: 'exponentiation', src: 'function main() { return 2 ** 10 }', expected: 1024n },
    {
      // Trailing zero byte in the 32-byte word — guards the return-data path
      // against trailing-zero truncation.
      name: 'scalar with trailing zero byte',
      src: 'function main() { return 256 }',
      expected: 256n,
    },
    { name: 'sqrt truncates', src: 'function main() { return Math.sqrt(10) }', expected: 3n },
    { name: 'mulDiv', src: 'function main() { return Math.mulDiv(100, 50, 25) }', expected: 200n },
    {
      name: 'mulDiv full precision (no intermediate overflow)',
      src: 'function main() { return Math.mulDiv(2 ** 255, 2, 2 ** 255) }',
      expected: 2n,
    },
    {
      name: 'negative intermediate (NEG encoding)',
      src: 'function main() { const a = -5; return a + 10 }',
      expected: 5n,
    },
    { name: 'bitwise and/or/xor', src: 'function main() { return (0xf0 & 0xff) | (0x0f ^ 0x03) }', expected: 0xfcn },
    { name: 'shifts', src: 'function main() { return (1 << 8) + (256 >> 4) }', expected: 272n },
    {
      // Ternaries must sit directly in an assignment (transpiler constraint).
      name: 'ternary',
      src: 'function main() { let x = 5 > 3 ? 20 : 30; let y = x > 10 ? x + 1 : 0; return y }',
      expected: 21n,
    },
    {
      name: 'if/else',
      src: 'function main() { let r = 0; if (5 > 3) { r = 1 } else { r = 2 } return r }',
      expected: 1n,
    },
    {
      name: 'for loop accumulation',
      src: 'function main() { let s = 0; for (let i = 0; i < 5; i++) { s += i } return s }',
      expected: 10n,
    },
    {
      // break/continue are not supported on the v12 dialect yet — plain while.
      name: 'while loop',
      src: 'function main() { let s = 0; let i = 0; while (i < 5) { s += i; i++ } return s }',
      expected: 10n,
    },
    {
      name: 'nested loops',
      src: 'function main() { let s = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 4; j++) { s += 1 } } return s }',
      expected: 12n,
    },
    {
      name: 'function with params',
      src: 'function add(a, b) { return a + b }\nfunction main() { return add(3, 7) }',
      expected: 10n,
    },
    {
      name: 'nested function calls',
      src: 'function f(x) { return x + 1 }\nfunction g(x) { return x * 2 }\nfunction main() { return f(g(3)) }',
      expected: 7n,
    },
    {
      // Helpers with locals force distinct frame strides (SDUP depth paths).
      name: 'two helpers with locals (SDUP stride paths)',
      src: 'function inc(x) { const y = x + 1; return y }\nfunction dbl(x) { let z = x * 2; return z }\nfunction main() { let a = inc(3); let b = dbl(4); return a + b }',
      expected: 12n,
    },
    {
      name: 'unused call result dropped',
      src: 'function noise(x) { return x + 1 }\nfunction main() { noise(41); return 7 }',
      expected: 7n,
    },
    {
      name: 'string concat length',
      src: 'function main() { const a = "hello"; const b = "world"; return a.concat(b).length }',
      expected: 10n,
    },
    { name: 'string char code', src: 'function main() { const s = "abc"; return s[1] }', expected: 98n },
    {
      name: 'bytes slice',
      src: 'function main() { const b = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]); const s = b.slice(1, 3); return s.length * 256 + s[0] }',
      expected: 2n * 256n + 0xbbn,
    },
    {
      name: 'array literal index + loop sum',
      src: 'function main() { const arr = [1, 2, 3, 4, 5]; let s = 0; for (let i = 0; i < arr.length; i++) { s += arr[i] } return s }',
      expected: 15n,
    },
    {
      name: 'new Array + set index (NEW_ARRAY/SET_INDEX)',
      src: 'function main() { let a = new Array(3); a[1] = 99; return a[1] + a[0] }',
      expected: 99n,
    },
    {
      name: 'array compound assignment',
      src: 'function main() { let a = new Array(3); a[0] = 4; a[0] += 10; return a[0] }',
      expected: 14n,
    },
    {
      name: 'tuple field set (object literal)',
      src: 'function main() { let p = { x: 5, y: 9 }; p.x = 42; return p.x + p.y }',
      expected: 51n,
    },
    {
      name: 'abi encode/decode round-trip',
      src: 'function main() { const d = abi.decode(abi.encode(1, 2, 3), "uint256", "uint256", "uint256"); return d[0] + d[1] + d[2] }',
      expected: 6n,
    },
    // ── same-file function return-kind inference (regression lock) ──
    // The v1 fix (compiler/src/processor/return-kind.ts + inference.ts) — see CLAUDE.md's
    // "Same-file user-function return-kind inference" note — was needed because v1 stores
    // a dynamic value's descriptor in a bare 32-byte VALUE slot if the storage kind is
    // wrong, which silently destroys it. svm (a v12 dialect) already worked BEFORE that
    // fix, for an unrelated reason: `V12Saucer.store` derives its kind straight from
    // `value.isDynamic`, never consulting the (wrong, pre-fix) inferred `_kind` parameter
    // at all — a dynamic value is a single 32-byte descriptor word here, so even a
    // VALUE-region store/read round-trips it losslessly. These lock in that this stays
    // true now that v1 has been fixed to agree.
    {
      name: 'helper returns new Array(n); main mutates arr[0] and combines with arr[1]',
      src: 'function helper() { let a = new Array(3); a[0] = 1; a[1] = 2; a[2] = 3; return a }\nfunction main() { let arr = helper(); arr[0] = 42; return arr[0] + arr[1] * 10 }',
      expected: 62n,
    },
    {
      name: 'helper returns new Array(n); main reads an element with no mutation',
      src: 'function helper() { let a = new Array(3); a[0] = 1; a[1] = 2; a[2] = 3; return a }\nfunction main() { let arr = helper(); return arr[1] }',
      expected: 2n,
    },
    {
      name: 'plain aliasing of a dynamic local (no function call)',
      src: 'function main() { let a = new Array(3); a[1] = 2; let b = a; b[0] = 42; return b[0] + b[1] * 10 }',
      expected: 62n,
    },
    // ── dynamic value passed as a CALL ARGUMENT (regression lock — svm already
    // worked here, UNLIKE v1, which has a known, deliberately-unfixed gap; see
    // CLAUDE.md's "Same-file user-function return-kind inference" note and
    // compiler/integration-test/function-return-kind.test.ts's "KNOWN GAP
    // (unfixed, v1-only)" test. svm is a v12 dialect: a parameter is an ordinary
    // stack value and a dynamic value is a single 32-byte descriptor word, so
    // there is no funcHeap/funcValues index-space split for a wrong argument
    // index to corrupt.) Mirrors v12-execution.test.ts's `callarg_*` vectors.
    {
      name: 'callarg: dynamic param read',
      src: 'function h(a) { return a[1] }\nfunction main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; return h(arr) }',
      expected: 2n,
    },
    {
      name: 'callarg: dynamic param stored to a local then read',
      src: 'function h(a) { let b = a; return b[1] }\nfunction main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; return h(arr) }',
      expected: 2n,
    },
    {
      name: 'callarg: dynamic param stored to a local then mutated',
      src: 'function h(a) { let b = a; b[0] = 9; return b[0] + b[1] * 10 }\nfunction main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; return h(arr) }',
      expected: 29n,
    },
    {
      name: 'callarg: mixed dynamic+scalar param order (both orders)',
      src: 'function h(a, s) { return a[1] + s }\nfunction g(s, a) { return s + a[1] }\nfunction main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; return h(arr, 21) + g(21, arr) }',
      expected: 46n, // 23 + 23
    },
    {
      name: 'callarg: helper chain (outer forwards the dynamic param to inner)',
      src: 'function inner(a) { return a[1] }\nfunction outer(a) { return inner(a) }\nfunction main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; return outer(arr) }',
      expected: 2n,
    },
    {
      name: 'callarg: .length on a dynamic param',
      src: 'function h(a) { return a.length }\nfunction main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; return h(arr) }',
      expected: 3n,
    },
    {
      name: 'callarg: a helper-returned dynamic value passed as another call argument',
      src: 'function f() { let a = new Array(2); a[0] = 3; a[1] = 8; return a }\nfunction g(a) { return a[1] }\nfunction main() { return g(f()) }',
      expected: 8n,
    },
    {
      name: 'callarg: a dynamic argument round-trips through a recursive call',
      src: 'function walk(a, n) { if (n === 0) { return a[1] } return walk(a, n - 1) }\nfunction main() { const arr = new Array(2); arr[0] = 1; arr[1] = 4; return walk(arr, 3) }',
      expected: 4n,
    },
    {
      name: 'recursive same-file function returning a dynamic value (self-recursion)',
      src: 'function build(n) { if (n === 0) { let a = new Array(3); a[0] = 5; return a } let inner = build(n - 1); return inner }\nfunction main() { let r = build(2); return r[0] }',
      expected: 5n,
    },
    {
      name: 'recursive same-file functions returning a dynamic value (mutual recursion)',
      src: 'function isEven(n) { if (n === 0) { let a = new Array(1); a[0] = 5; return a } return isOdd(n - 1) }\nfunction isOdd(n) { if (n === 0) { let a = new Array(1); a[0] = 9; return a } return isEven(n - 1) }\nfunction main() { let r = isEven(4); return r[0] }',
      expected: 5n,
    },
    // ── v12/svm parameter-WRITE fix regression lock (saucer-v12.ts's `store()`
    // isParam branch — see CLAUDE.md's "v12/svm parameter WRITE" note). Before
    // the fix a scalar param write silently returned the PRE-write value (no
    // revert), and a dynamic (element) write reverted outright.
    {
      name: 'param write: scalar param reassigned inside a helper',
      src: 'function h(x) { x = x + 1; return x }\nfunction main() { return h(5) }',
      expected: 6n,
    },
    {
      name: 'param write: the middle of three params',
      src: 'function h(a, b, c) { b = 100; return a + b + c }\nfunction main() { return h(1, 2, 3) }',
      expected: 104n,
    },
    {
      name: 'param write: inside an if body',
      src: 'function h(x, cond) { if (cond === 1) { x = 15 } return x }\nfunction main() { return h(5, 1) }',
      expected: 15n,
    },
    {
      name: 'param write: inside a while loop',
      src: 'function h(x) { let i = 0; while (i < 3) { x = x + 1; i = i + 1 } return x }\nfunction main() { return h(5) }',
      expected: 8n,
    },
    {
      name: 'param write: twice to the same param',
      src: 'function h(x) { x = x + 1; x = x + 1; return x }\nfunction main() { return h(10) }',
      expected: 12n,
    },
    {
      name: 'param write: dynamic element write through a param',
      src: 'function h(a) { a[0] = 9; return a[0] }\nfunction main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; return h(arr) }',
      expected: 9n,
    },
    {
      name: 'param write: mutated two call frames deep',
      src: 'function inner(a) { a[0] = 9; return a[0] }\nfunction outer(a) { return inner(a) }\nfunction main() { const arr = new Array(2); arr[0] = 1; arr[1] = 2; return outer(arr) }',
      expected: 9n,
    },
    {
      // v1-only KNOWN GAP (see dynamic-kind-sweep.test.ts): compound assignment on a
      // dynamic parameter's element reverts on v1; on svm it is the ordinary
      // INDEX-read + SET_INDEX-write pattern through a stack param.
      name: 'callarg: compound assignment on a dynamic param element',
      src: 'function h(a) { a[0] += 10; return a[0] }\nfunction main() { const arr = new Array(1); arr[0] = 2; return h(arr) }',
      expected: 12n,
    },
    {
      // v1-only SILENT-wrong-answer half of the call-argument gap (see
      // dynamic-kind-sweep.test.ts): a string param's `.length` reads the scalar word
      // width (32) on v1 instead of the real length; svm reads it correctly.
      name: 'callarg: string param .length reads the real length',
      src: 'function h(s) { return s.length }\nfunction main() { return h("AB") }',
      expected: 2n,
    },
    // ── ADVERSARIAL-AUDIT FINDING (this branch): object-literal field applying a
    // SCALAR-producing postfix op to a dynamic base — v12/svm false positive ──
    //
    // `assertNoDynamicVariableObjectField` (processor/collection.ts) used to reject
    // `.length` of an existing dynamic array as an object field value on svm too (the
    // postfix encoding's `[READ_HEAP, slot, LENGTH]` shape has READ_HEAP as its LEADING
    // byte even though the overall expression is a genuine scalar) — before the fix,
    // this program wouldn't even COMPILE on `target: 'svm'`. Fixed by also requiring
    // `_bytes.length === 2` (a bare dynamic-variable read is always exactly 2 bytes on
    // every target). See test/struct.test.ts's "object literal field applying a
    // SCALAR-producing postfix op" describe block for the compile-time-shape proof.
    {
      name: 'object literal field reads .length of an existing dynamic array (was a compile-time false positive)',
      src: 'function main() { let a = new Array(3); a[0] = 11; a[1] = 22; a[2] = 33; let s = { x: a.length, y: 5 }; return s.x }',
      expected: 3n,
    },
  ];

  for (const { name, src, expected } of cases) {
    it(name, async () => {
      expect(svmUint(await svmCook(h, src))).toBe(expected);
    });
  }

  it('compile-time args reach main (arg-prologue path)', async () => {
    const r = await svmCook(h, 'function main(a, b) { return a * b }', { args: [6n, 7n] });

    expect(svmUint(r)).toBe(42n);
  });
});

describeSvm('integration: svm accountData / writeAccountData', () => {
  let h: SvmHarness;

  beforeAll(async () => {
    h = await startSvm();
  });

  it('reads an [offset, len] slice of fixture bytes', async () => {
    const fixture = Uint8Array.from({ length: 64 }, (_, i) => i);
    const r = await svmCook(h, `function main() { return accountData('pool', 4, 8) }`, {
      accounts: [{ ref: 'pool', data: fixture }],
    });

    expect(svmHex(r)).toBe('0x0405060708090a0b');
  });

  it('decodes a 32-byte read to a scalar and computes on it', async () => {
    const fixture = new Uint8Array(64);
    fixture[31] = 42; // word at offset 0 = 42 (big-endian)
    const src = `function main() { const d = abi.decode(accountData('pool', 0, 32), "uint256"); return d[0] + 1 }`;
    const r = await svmCook(h, src, { accounts: [{ ref: 'pool', data: fixture }] });

    expect(svmUint(r)).toBe(43n);
  });

  it('indexes single bytes out of account data', async () => {
    const r = await svmCook(h, `function main() { const d = accountData('pool', 2, 3); return d[1] }`, {
      accounts: [{ ref: 'pool', data: Uint8Array.from([0, 0, 0xaa, 0xbb, 0xcc]) }],
    });

    expect(svmUint(r)).toBe(0xbbn);
  });

  it('out-of-bounds read fails the transaction', async () => {
    const r = await svmCook(h, `function main() { return accountData('pool', 60, 8) }`, {
      accounts: [{ ref: 'pool', data: new Uint8Array(64) }],
    });

    expectFail(r);
  });

  it('writeAccountData into ANY engine-owned account is refused (ProtectedAccount)', async () => {
    // Wave D: every engine-owned target is bytecode-unwritable, unconditionally
    // — that is what keeps finalized buffers unscribblable from any transaction.
    const r = await svmCook(h, `function main() { writeAccountData('vault', 40, Uint8Array.from([0xde, 0xad])) }`, {
      accounts: [{ ref: 'vault', data: new Uint8Array(64) }], // engine-owned by default
    });

    expect(expectFail(r).logs.join('\n')).toContain(`Program ${h.programId} invoke`);
  });

  it('writeAccountData to a foreign-owned writable account fails at the runtime wall', async () => {
    // The engine performs the write, then the runtime rejects the data
    // modification (the engine does not own the account) — so SSTORE has NO
    // effectively-writable target class on SVM; it stays in the ISA for fork
    // parity and a future sanctioned scratch class.
    const r = await svmCook(h, `function main() { writeAccountData('vault', 8, Uint8Array.from([0x01])) }`, {
      accounts: [{ ref: 'vault', data: new Uint8Array(64), owner: SYSTEM_PROGRAM }],
    });

    expectFail(r);
  });

  it('plan meta order IS the user-account index space (refs resolve by name, not position)', async () => {
    // First-use order interns 'a' at plan index 0 and 'b' at 1; the accounts
    // are PROVIDED in reversed order — each read must still hit its own
    // fixture, proving svmCook places metas by plan index, not list position.
    const src = `function main() { const a = accountData('a', 0, 1); const b = accountData('b', 0, 1); return a[0] * 256 + b[0] }`;
    const r = await svmCook(h, src, {
      accounts: [
        { ref: 'b', data: Uint8Array.from([0xbb]) },
        { ref: 'a', data: Uint8Array.from([0xaa]) },
      ],
    });

    expect(svmUint(r)).toBe(0xaabbn);
  });

  it('raw positional indices map to the provided account order', async () => {
    // Raw mode: the plan is empty and the provided accounts ARE user indices
    // 0..n-1 in list order (the payer is appended after them). Each raw read
    // must hit its own fixture — the success-path proof of the raw mapping.
    const src =
      'function main() { const a = accountData(0, 0, 1); const b = accountData(1, 0, 1); return a[0] * 256 + b[0] }';
    const r = await svmCook(h, src, {
      accounts: [
        { ref: 'first', data: Uint8Array.from([0x11]) },
        { ref: 'second', data: Uint8Array.from([0x22]) },
      ],
    });

    expect(svmUint(r)).toBe(0x1122n);
  });

  it('raw-index write to a writable engine-owned account is refused too (same wall)', async () => {
    const vault = randomSvmAddress();
    const r = await svmCook(h, 'function main() { writeAccountData(0, 36, Uint8Array.from([0xbe, 0xef])) }', {
      accounts: [{ ref: 'vault', address: vault, data: new Uint8Array(48), writable: true }],
    });

    expectFail(r);
  });

  it('write to a non-writable account fails the transaction', async () => {
    // Raw index 0 = the first provided account, passed with a READONLY meta
    // (raw mode: the caller owns the ordering and the flags).
    const r = await svmCook(h, 'function main() { writeAccountData(0, 0, Uint8Array.from([0x01])) }', {
      accounts: [{ ref: 'target', data: new Uint8Array(8) }],
    });

    // Engine data-path errors all surface as InvalidInstructionData, so the
    // logs only pin that the failure happened inside the engine program.
    expect(expectFail(r).logs.join('\n')).toContain(`Program ${h.programId} invoke`);
  });
});

describeSvm('integration: svm uint / accountUint (CAST_LE 0x55)', () => {
  let h: SvmHarness;

  beforeAll(async () => {
    h = await startSvm();
  });

  it('accountUint reads a u64 LE field at a non-zero offset in ONE op (CAST_LE, never CAST_BE)', async () => {
    const src = `function main() { return accountUint('pool', 16, 8) }`;
    // The LE read must not lean on a byte-reverse + CAST_BE chain: the emitted
    // bytecode carries CAST_LE (0x55) and no CAST_BE (0x54) anywhere.
    const { bytecode } = compile(src, { target: 'svm' });

    expect(bytecode[0]).toContain(0x55);
    expect(bytecode[0]).not.toContain(0x54);

    const data = new Uint8Array(64);
    data.set([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01], 16); // 0x0102030405060708 stored LE

    const r = await svmCook(h, src, { accounts: [{ ref: 'pool', data }] });

    expect(svmUint(r)).toBe(0x0102030405060708n);
  });

  it('SPL-token amount pattern: u64 LE at offset 64 of a 165-byte account', async () => {
    // SPL token account layout: mint(32) + owner(32) + amount u64 LE at 64.
    const amount = 123_456_789n;
    const data = new Uint8Array(165);
    new DataView(data.buffer).setBigUint64(64, amount, true);

    const r = await svmCook(h, `function main() { return accountUint('token', 64, 8) }`, {
      accounts: [{ ref: 'token', data }],
    });

    expect(svmUint(r)).toBe(amount);
  });

  it('uint(bytes literal) diverges from v12 in EXACTLY the cast byte and evaluates LE on-chain', async () => {
    const src = 'function main() { return uint(Uint8Array.from([0x01, 0x02])) }';
    const svmBytes = compile(src, { target: 'svm' }).bytecode[0];
    const v12Bytes = compile(src, { target: 'v12' }).bytecode[0];

    // Same source, same shape — the ONLY diverging byte is the platform-native
    // cast: CAST_LE (0x55) on svm where v12 emits CAST_BE (0x54).
    expect(svmBytes.length).toBe(v12Bytes.length);
    const diffs = [...svmBytes].flatMap((b, i) => (b !== v12Bytes[i] ? [i] : []));
    expect(diffs).toHaveLength(1);
    expect(svmBytes[diffs[0]]).toBe(0x55);
    expect(v12Bytes[diffs[0]]).toBe(0x54);
    // byte[0] is least significant: [0x01, 0x02] → 0x0201 (0x0102 would mean a BE read).
    expect(svmUint(await svmCook(h, src))).toBe(0x0201n);
  });
});

describeSvm('integration: svm revert paths', () => {
  let h: SvmHarness;

  beforeAll(async () => {
    h = await startSvm();
  });

  it('throw with a payload: tx fails and revertData carries the payload', async () => {
    const r = await svmCook(h, 'function main() { throw "fail" }');

    expect(Buffer.from(expectFail(r).revertData ?? new Uint8Array()).toString('utf8')).toBe('fail');
  });

  it('minOut-style require: reverts under the floor, passes at it', async () => {
    const src = 'function main(out, minOut) { if (out < minOut) { throw "minOut" } return out }';
    const below = await svmCook(h, src, { args: [100n, 200n] });

    expect(Buffer.from(expectFail(below).revertData ?? new Uint8Array()).toString('utf8')).toBe('minOut');

    const at = await svmCook(h, src, { args: [200n, 200n] });

    expect(svmUint(at)).toBe(200n);
  });
});

describeSvm('integration: svm contract.call (CPI)', () => {
  let h: SvmHarness;

  beforeAll(async () => {
    h = await startSvm();
  });

  it('system transfer CPI moves lamports payer → recipient', async () => {
    const recipient = randomSvmAddress();
    const amount = 1_000_000n; // 0x0f4240
    // SystemInstruction::Transfer: u32 LE discriminant 2 + u64 LE lamports.
    // Target scalar 0 = 32 zero bytes = the system program id; the program's
    // account is attached via the unplanned 'system' ref (present in the user
    // list, never referenced by index).
    const src = `function main() {
      contract.call(0, Uint8Array.from([2, 0, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]), [
        { ref: 'payer', writable: true, signer: true },
        { ref: 'recipient', writable: true },
      ]);
    }`;
    // svmCook creates the recipient with 1 SOL, so the post-balance is
    // creation amount + transferred amount.
    const funded = 1_000_000_000n;
    const r = await svmCook(h, src, {
      accounts: [
        { ref: 'recipient', address: recipient, lamports: funded, owner: SYSTEM_PROGRAM },
        { ref: 'system', address: SYSTEM_PROGRAM },
      ],
    });

    expect(r.ok).toBe(true);
    expect(h.svm.getBalance(recipient)).toBe(funded + amount);
  });

  it("reserved 'payer' ref maps the payer into its PLAN slot, not appended", async () => {
    // Intern 'recipient' FIRST (plan index 0) with a zero-length read, so
    // 'payer' lands at plan index 1 — the CALL accounts array becomes [1, 0].
    // If the harness appended the payer instead of mapping it in place, user
    // index 1 would be the wrong account and the transfer could not move
    // lamports from the payer.
    const recipient = randomSvmAddress();
    const amount = 2_000_000n; // 0x1e8480
    const funded = 1_000_000_000n;
    const src = `function main() {
      accountData('recipient', 0, 0);
      contract.call(0, Uint8Array.from([2, 0, 0, 0, 0x80, 0x84, 0x1e, 0, 0, 0, 0, 0]), [
        { ref: 'payer', writable: true, signer: true },
        { ref: 'recipient', writable: true },
      ]);
    }`;
    const r = await svmCook(h, src, {
      accounts: [
        { ref: 'recipient', address: recipient, lamports: funded, owner: SYSTEM_PROGRAM },
        { ref: 'system', address: SYSTEM_PROGRAM },
      ],
    });

    expect(r.ok).toBe(true);
    expect(h.svm.getBalance(recipient)).toBe(funded + amount);
  });

  it('catch on a SUCCEEDING call skips the handler (transfer still lands)', async () => {
    // CATCH's success path SKIPS the handler bytes via the compiler-emitted
    // skip immediate — a wrong skip count would run the handler (r = 99) or
    // land mid-instruction and fail the tx.
    const recipient = randomSvmAddress();
    const amount = 3_000_000n; // 0x2dc6c0
    const funded = 1_000_000_000n;
    const src = `function main() {
      let r = 1;
      contract.call(0, Uint8Array.from([2, 0, 0, 0, 0xc0, 0xc6, 0x2d, 0, 0, 0, 0, 0]), [
        { ref: 'payer', writable: true, signer: true },
        { ref: 'recipient', writable: true },
      ]).catch(() => { r = 99; });
      return r;
    }`;
    const res = await svmCook(h, src, {
      accounts: [
        { ref: 'recipient', address: recipient, lamports: funded, owner: SYSTEM_PROGRAM },
        { ref: 'system', address: SYSTEM_PROGRAM },
      ],
    });

    expect(svmUint(res)).toBe(1n);
    expect(h.svm.getBalance(recipient)).toBe(funded + amount);
  });

  it('pre-flight failure (target program not attached): catch handler runs, tx ok', async () => {
    const src = `function main() {
      let r = 1;
      contract.call(7, Uint8Array.from([0xaa]), ['pool']).catch(() => { r = 42; });
      return r;
    }`;
    const res = await svmCook(h, src, { accounts: [{ ref: 'pool' }] });

    expect(svmUint(res)).toBe(42n);
  });
});

describeSvm('integration: svm chain context', () => {
  let h: SvmHarness;

  beforeAll(async () => {
    h = await startSvm();
  });

  it('ctx.msgSender() returns the payer address (formerly msg.sender)', async () => {
    const r = await svmCook(h, 'function main() { return ctx.msgSender() }');
    const payerBytes = getAddressCodec().encode(h.payer.address);

    expect(svmHex(r)).toBe('0x' + Buffer.from(payerBytes).toString('hex'));
  });

  it('ctx.chainId() returns the synthetic devnet chain id (formerly block.chainId)', async () => {
    // Default (non-mainnet) engine build reports 1399811150.
    expect(svmUint(await svmCook(h, 'function main() { return ctx.chainId() }'))).toBe(1399811150n);
  });

  it('ctx.msgData().length returns non-zero (formerly msg.data.length — new ctx.* member, §1.5)', async () => {
    expect(svmUint(await svmCook(h, 'function main() { return ctx.msgData().length }'))).toBeGreaterThan(0n);
  });

  // KNOWN GAP, investigated for ECO-2163 (compiler-parity §1.5): the EVM-only code-inspection reads
  // (codeSize/codeHash/isContract/isEOA) plus `ctx.msgValue` live under the portable `ctx.*`
  // namespace as of NS-CONVERGE (#141), but are `assertCapability`-GATED EVM-only — so they cannot
  // even compile for target 'svm' (a clean compile error, never a compiles-but-reverts surface). That
  // gate is correct because IS_CONTRACT (0x75) / IS_EOA (0x76) — like BALANCE (0x70) — are in the same
  // "context-unary" opcode block, and the VENDORED svm engine.so rejects that whole calling
  // convention at REAL EXECUTION with `InvalidInstructionData` (contrast SLOAD/SSTORE/CALL, which
  // svm-profile.ts documents as having an explicit `ctx.isSvm` reinterpretation to an account-INDEX
  // operand — BALANCE/IS_CONTRACT/IS_EOA have no such reinterpretation). The surprising part, and the
  // actual still-open GAP: the ALREADY-SHIPPED, UNGATED, PORTABLE `ctx.balance()` (BALANCE, 0x70)
  // hits the same wall — it DOES compile for svm and then reverts, confirmed directly below. Whether
  // `ctx.balance` needs an svm-side fix or should itself become gated is the live question flagged to
  // the team lead. (IS_EOA (0x76) itself isn't independently re-probed here — the gated ctx.* surface
  // has no svm-reachable path to it; a one-off manual probe during this investigation showed it fails
  // identically to IS_CONTRACT, both InvalidInstructionData, but that isn't re-asserted as its own test.
  it('KNOWN GAP: ctx.balance() (BALANCE 0x70, shipped/ungated since #141) reverts InvalidInstructionData on real svm execution, despite compiling cleanly', async () => {
    const addr = randomSvmAddress();
    const bytes = getAddressCodec().encode(addr);
    const big = BigInt('0x' + Buffer.from(bytes).toString('hex'));
    const r = await svmCook(h, 'function main(a){ return ctx.balance(a) }', { args: [big] });

    expect(r.ok).toBe(false);
    expect(r.err).toContain('InvalidInstructionData');
  });
});

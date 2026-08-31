/**
 * THE PARTNER REPRODUCIBILITY GUARD.
 *
 * The reproducibility claim is that compiling `settle.sauce.ts` with the in-repo TypeScript compiler
 * (`compiler/`) and these options yields byte-for-byte the program we hand a partner — the bytes
 * committed as `SETTLE_VECTORS`. This test IS the snippet that claim rests on, run for real: if it
 * stops reproducing our bytes — a changed program, a compiler change, a moved artifact, a different
 * default — this goes red instead of a partner discovering it. It is the ONLY thing that recompiles
 * the vectors, so their status as a live pin (rather than a transcription) is this file.
 *
 * The published Rust compiler is a different lineage and does not reproduce these bytes: it has no
 * compile-time `args`, and folds the params into the body instead of a decodable prologue. That is
 * why this guard names `compiler/` explicitly rather than "the compiler".
 *
 * There is deliberately no `compileSettleProgram` wrapper. A bespoke compile helper hid the four
 * options that actually determine the output (`target`, `treeshake`, `tsSource`, and the `args`
 * order) behind a function signature, so a partner reproducing the bytes could not see what they had
 * to match. The options are literal below for exactly that reason — this file must keep spelling
 * them out rather than importing them from a constant.
 *
 * `SAUCE_BASE_DIRS` here is load-bearing beyond this suite: it reads `sdk/src/artifacts/`, which is
 * GENERATED (by `sdk/scripts/sync-engine-artifacts.mjs`) and gitignored. Without this assertion a
 * fresh checkout that skipped that step fails a dozen suites with a bare ENOENT and nothing naming
 * the cause.
 */
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { keccak256 } from 'viem';
import { compile } from '../../compiler/dist/index.js';
import { settleSource, SAUCE_BASE_DIRS, SETTLE_SOURCE_PATH } from '../src/recipes/index.js';
import { decodeSettleProgram, SETTLE_VECTORS, SETTLE_WIRE, scanMinimalPush } from '../src/verify/index.js';

const TOKENS = ['0x00000000000000000000000000000000000000aa', '0x00000000000000000000000000000000000000bb'] as const;
const MIN_OUT = 12345n;
const RECIPIENT = '0x0000000000000000000000000000000000000022';

/** THE SNIPPET — kept verbatim-equivalent to the one in `recipes/index.ts`'s docstring. */
function partnerCompile(tokens: readonly string[], minOut: bigint, recipient: string): `0x${string}` {
  const { bytecode } = compile(settleSource(), {
    baseDirs: [...SAUCE_BASE_DIRS],
    target: 'v12',
    treeshake: true,
    tsSource: true,
    args: [tokens.map((t) => BigInt(t)), minOut, BigInt(recipient)],
  });
  return ('0x' + Buffer.from(bytecode[0]!).toString('hex')) as `0x${string}`;
}

/** Skip the (tokens, minOut, recipient) prologue, returning the constant body. Uses the package's
 *  OWN wire scanner (`scanMinimalPush` takes bytes, not hex) rather than a private re-implementation,
 *  so this guard exercises the same primitive a partner would. */
function bodyOf(program: `0x${string}`): `0x${string}` {
  const bytes = Buffer.from(program.slice(2), 'hex');
  let pos = 0;
  for (;;) {
    const scan = scanMinimalPush(bytes, pos);
    if (!scan.ok) break;
    pos = scan.next;
  }
  expect(bytes[pos]).toBe(SETTLE_WIRE.TUPLE_OP);
  pos += 2; // TUPLE opcode + arity
  for (let i = 0; i < 2; i++) {
    const scan = scanMinimalPush(bytes, pos);
    expect(scan.ok).toBe(true);
    if (scan.ok) pos = scan.next;
  }
  return ('0x' + bytes.subarray(pos).toString('hex')) as `0x${string}`;
}

describe('partner reproducibility — the ordinary compiler reproduces our program', () => {
  it('the documented snippet reproduces the SHIPPED golden vectors byte-for-byte', () => {
    // The vectors in vectors.ts are the committed record of what this program compiles to. Checking
    // the snippet against THEM (rather than a hash constant) means the thing under test is the same
    // artifact partners are handed, and a compiler re-pin or program edit shows up as a real diff.
    for (const v of SETTLE_VECTORS) {
      const produced = partnerCompile(v.tokens as unknown as string[], v.minOut, v.recipient);
      expect(produced.toLowerCase()).toBe(v.program.toLowerCase());
    }
  });

  it('the body is a function of the program and compiler pin ONLY — never of the arguments', () => {
    const shapes: Array<[readonly string[], bigint, string]> = [
      [[TOKENS[0]], 0n, RECIPIENT],
      [TOKENS, MIN_OUT, RECIPIENT],
      [[...TOKENS, '0x00000000000000000000000000000000000000cc'], 1n << 200n, '0x0000000000000000000000000000000000000033'],
    ];
    const hashes = new Set(shapes.map(([t, m, r]) => keccak256(bodyOf(partnerCompile(t, m, r)))));
    expect(hashes.size).toBe(1);
    // ...and it is the same body the shipped vectors carry.
    expect([...hashes][0]).toBe(decodeSettleProgram(SETTLE_VECTORS[0]!.program).bodyHash);
  });

  it('round-trips: what we compiled in is what /verify decodes out', () => {
    const decoded = decodeSettleProgram(partnerCompile(TOKENS, MIN_OUT, RECIPIENT));
    expect(decoded.tokens.map((t) => t.toLowerCase())).toEqual(TOKENS.map((t) => t.toLowerCase()));
    expect(decoded.minOut).toBe(MIN_OUT);
    expect(decoded.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
  });
});

describe('the shipped program source', () => {
  it('settleSource() returns the exact on-disk settle.sauce.ts', () => {
    const onDisk = readFileSync(resolve(process.cwd(), 'src/recipes/settle.sauce.ts'), 'utf-8');
    expect(settleSource()).toBe(onDisk);
  });

  it('SAUCE_BASE_DIRS resolves the program\'s ./artifacts/IERC20.json import', () => {
    // The one entry is the dist/src ROOT, not the programs dir — that is where `./artifacts/` lives.
    expect(SAUCE_BASE_DIRS).toHaveLength(1);
    expect(readFileSync(join(SAUCE_BASE_DIRS[0]!, 'artifacts', 'IERC20.json'), 'utf-8').length).toBeGreaterThan(0);
    expect(dirname(SETTLE_SOURCE_PATH)).not.toBe(SAUCE_BASE_DIRS[0]);
  });
});

/**
 * v12 bytecode parity: the TypeScript `V12Saucer` builder emits byte-identical
 * bytecode to the Solidity `V12Saucer.sol` builder that the engine-v12 Huff
 * runtime executes against. This is the byte-level half of the compiler↔engine
 * guarantee (the execution half is v12-execution.test.ts): if the TS output
 * equals the Solidity builder, and the Solidity builder's output runs on the
 * runtime, then the TS output runs on the runtime.
 *
 * The Solidity side is produced by `forge script V12SaucerVectors.s.sol --sig
 * runAll()`, which logs `VEC <name> <0xhex>` per scenario. We then build the
 * SAME scenario with `V12Saucer` and compare raw expression bytes (`._bytes`).
 *
 * Requires a COMPLETE engine-v12 checkout (script/ + lib/forge-std) and Foundry.
 * The published `sauce` dep ships a trimmed engine-v12, so by default this skips;
 * point SAUCE_ENGINE_V12 at a full checkout (e.g. ../sauce/engine-v12) to run.
 *
 * SET_INDEX (arr[i] = x / obj.field = x) and NEW_ARRAY (new Array(n)) ARE asserted
 * here (the `setIndex` / `newArray` scenarios) against the matching `VEC` lines the
 * engine repo's `V12SaucerVectors.s.sol` emits. Other Solidity builder conveniences
 * (ARRAY_FROM_UINTS) remain out of scope — no local compiler surface.
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { V12Saucer } from '../src/saucer/index.js';
import { CompilerContext } from '../src/context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_V12 = process.env.SAUCE_ENGINE_V12 ?? join(__dirname, '../node_modules/sauce/engine-v12');
const SCRIPT = join(ENGINE_V12, 'script/V12SaucerVectors.s.sol');
const FORGE_STD = join(ENGINE_V12, 'lib/forge-std');

const canRun = (): boolean => {
  try {
    execSync('forge --version', { stdio: 'pipe' });

    return existsSync(SCRIPT) && existsSync(FORGE_STD);
  } catch {
    return false;
  }
};

const describeIfForge = canRun() ? describe : describe.skip;

// ── builders mirroring the Solidity scenarios (raw expression bytes) ──

const ctx = () => new CompilerContext([], {}, 'v12');
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const cat = (...xs: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of xs) {
    out.set(x, p);
    p += x.length;
  }

  return out;
};
const fromHex = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, '');
  const a = new Uint8Array(s.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);

  return a;
};
const pad = (v: bigint, n: number): Uint8Array => {
  const b = new Uint8Array(n);
  let x = v;
  for (let i = n - 1; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }

  return b;
};
const ADDR = '0x1234567890abcdef1234567890abcdef12345678';

const U = (c: CompilerContext, v: number | bigint) => new V12Saucer(c).int(BigInt(v));
const A = (c: CompilerContext) => new V12Saucer(c).int(BigInt(ADDR)); // 20-byte → BYTE_20, == Solidity ADDR
const B = (c: CompilerContext, h: string) => new V12Saucer(c).bytes(fromHex(h));
const B32 = (c: CompilerContext, v: number | bigint) =>
  new V12Saucer(c, cat(new Uint8Array([0x20]), pad(BigInt(v), 32)), 1, false);
const BN = (c: CompilerContext, v: number | bigint, n: number) =>
  new V12Saucer(c, cat(new Uint8Array([n]), pad(BigInt(v), n)), 1, false);
const S = (c: CompilerContext) => new V12Saucer(c);

const scenarios: Record<string, (c: CompilerContext) => Uint8Array> = {
  uintConst: (c) => U(c, 0xdeadbeef)._bytes,
  uintSmall: (c) => U(c, 5)._bytes,
  addrConst: (c) => A(c)._bytes,
  bytesConst: (c) => B(c, '123456')._bytes,
  bytes32Const: (c) => B32(c, 0xabcd)._bytes,
  bytes4Const: (c) => BN(c, 0xdeadbeef, 4)._bytes,

  add: (c) => S(c).add(U(c, 5), U(c, 3))._bytes,
  sub: (c) => S(c).sub(U(c, 10), U(c, 3))._bytes,
  mul: (c) => S(c).mul(U(c, 5), U(c, 3))._bytes,
  div: (c) => S(c).div(U(c, 12), U(c, 4))._bytes,
  mod: (c) => S(c).mod(U(c, 12), U(c, 5))._bytes,
  sqrt: (c) => S(c).sqrt(U(c, 16))._bytes,
  neg: (c) => S(c).neg(U(c, 5))._bytes,
  mulDiv: (c) => S(c).mulDiv(U(c, 6), U(c, 7), U(c, 2))._bytes,
  addMod: (c) => S(c).addMod(U(c, 6), U(c, 7), U(c, 5))._bytes,
  mulMod: (c) => S(c).mulMod(U(c, 6), U(c, 7), U(c, 5))._bytes,
  exp: (c) => S(c).exp(U(c, 2), U(c, 10))._bytes,

  sDiv: (c) => S(c).sDiv(U(c, 12), U(c, 4))._bytes,
  sMod: (c) => S(c).sMod(U(c, 12), U(c, 5))._bytes,
  sAr: (c) => S(c).sShr(U(c, 256), U(c, 2))._bytes,
  // signExtend(value, fromByte); emits [value][fromByte][SIGN_EXTEND] — same bytes the
  // Solidity reference vector encodes (byte index on top / popped first).
  signExtend: (c) => S(c).signExtend(U(c, 255), U(c, 0))._bytes,
  signedComparisons: (c) =>
    cat(
      S(c).sGt(U(c, 5), U(c, 3))._bytes,
      S(c).sLt(U(c, 5), U(c, 3))._bytes,
      S(c).sGte(U(c, 5), U(c, 3))._bytes,
      S(c).sLte(U(c, 5), U(c, 3))._bytes,
    ),

  boolComparisons: (c) =>
    cat(
      S(c).gt(U(c, 5), U(c, 3))._bytes,
      S(c).lt(U(c, 5), U(c, 3))._bytes,
      S(c).gte(U(c, 5), U(c, 3))._bytes,
      S(c).lte(U(c, 5), U(c, 3))._bytes,
      S(c).eq(U(c, 5), U(c, 3))._bytes,
      S(c).neq(U(c, 5), U(c, 3))._bytes,
    ),
  // Solidity $$.AND/OR/XOR/NOT are the BITWISE ops (the local logical &&/||/! map
  // to BOOL_AND/OR/NOT separately) — so mirror with bitAnd/bitOr/bitXor/bitNot.
  boolLogic: (c) =>
    cat(
      S(c).bitAnd(U(c, 1), U(c, 0))._bytes,
      S(c).bitOr(U(c, 1), U(c, 0))._bytes,
      S(c).bitXor(U(c, 1), U(c, 0))._bytes,
      S(c).bitNot(U(c, 1))._bytes,
      S(c).isZero(U(c, 0))._bytes,
      S(c).isNotZero(U(c, 1))._bytes,
    ),
  isContractEoa: (c) => cat(S(c).isContract(A(c))._bytes, S(c).isEOA(A(c))._bytes),

  bitwise: (c) =>
    cat(
      S(c).bitAnd(U(c, 0xff), U(c, 0x0f))._bytes,
      S(c).bitOr(U(c, 0xff), U(c, 0x0f))._bytes,
      S(c).bitXor(U(c, 0xff), U(c, 0x0f))._bytes,
      S(c).bitNot(U(c, 0xff))._bytes,
      S(c).shl(U(c, 1), U(c, 4))._bytes,
      S(c).shr(U(c, 256), U(c, 4))._bytes,
    ),

  contextOps: (c) =>
    cat(
      S(c).msgSender()._bytes,
      S(c).txOrigin()._bytes,
      S(c).gasLeft()._bytes,
      S(c).blockChainId()._bytes,
      S(c).addressSelf()._bytes,
      S(c).blockNumber()._bytes,
      S(c).blockTimestamp()._bytes,
      S(c).blockCoinbase()._bytes,
      S(c).blockPrevrandao()._bytes,
      S(c).blockGasLimit()._bytes,
    ),
  contextExtras: (c) =>
    cat(
      S(c).addressBalance()._bytes,
      S(c).msgValue()._bytes,
      S(c).blockBaseFee()._bytes,
      S(c).txGasPrice()._bytes,
      S(c).blockBlobBaseFee()._bytes,
      S(c).msgData()._bytes,
    ),
  contextWithInput: (c) =>
    cat(
      S(c).balanceOf(A(c))._bytes,
      S(c).blockHash(U(c, 100))._bytes,
      S(c).codeSize(A(c))._bytes,
      S(c).codeHash(A(c))._bytes,
      S(c).blobHash(U(c, 0))._bytes,
    ),

  keccakDynamic: (c) => S(c).keccak256(B(c, '1234'))._bytes,
  keccakScalar: (c) => S(c).keccak256(U(c, 5))._bytes,
  ecdsaVerify: (c) => S(c).ecdsaVerify(A(c), B32(c, 0xabcd), B(c, '3333'))._bytes,

  sliceDynamic: (c) => S(c).slice(B(c, '1234'), U(c, 0), U(c, 2))._bytes,
  sliceScalar: (c) => S(c).slice(B32(c, 0xabcd), U(c, 0), U(c, 2))._bytes,
  concat: (c) => S(c).concat([B(c, '1234'), B(c, '5678')])._bytes,
  concatScalar: (c) => S(c).concat([U(c, 5), U(c, 7)])._bytes,
  length: (c) => S(c).length(B(c, '123456'))._bytes,
  castBe: (c) => S(c).castBe(B(c, '1234'))._bytes,

  index: (c) => S(c).index(S(c).array([U(c, 0x10), U(c, 0x20), U(c, 0x30)]), U(c, 1))._bytes,
  tuple: (c) => S(c).tuple([B(c, '1234'), B(c, '5678')])._bytes,

  // In-place mutation: must match V12SaucerVectors.s.sol — SET_INDEX(TUPLE(42,100), 1, 999)
  // and NEW_ARRAY(5). setIndex(array, index, value); v12 emits [value][index][array][SET_INDEX].
  setIndex: (c) => S(c).setIndex(S(c).tuple([U(c, 42), U(c, 100)]), U(c, 1), U(c, 999))._bytes,
  newArray: (c) => S(c).newArray(U(c, 5))._bytes,

  abiEncode: (c) => S(c).abiEncode(S(c).tuple([B(c, '1234'), B(c, '5678')]))._bytes,
  abiDecode: (c) => S(c).abiDecode(2, B(c, '1234'), [0x20, 0x20])._bytes,

  externalCall: (c) => S(c).externalCall(A(c), U(c, 0), B(c, 'abcd'))._bytes,
  staticCall: (c) => S(c).staticCall(A(c), B(c, 'abcd'))._bytes,
  delegateCall: (c) => S(c).delegateCall(A(c), B(c, 'abcd'))._bytes,

  sstore: (c) => S(c).sstore(U(c, 1), U(c, 42))._bytes,
  sload: (c) => S(c).sload(U(c, 1))._bytes,
  tstore: (c) => S(c).tstore(U(c, 1), U(c, 42))._bytes,
  tload: (c) => S(c).tload(U(c, 1))._bytes,

  create: (c) => S(c).create(U(c, 0), B(c, '6000'))._bytes,
  create2: (c) => S(c).create2(U(c, 0), B32(c, 1), B(c, '6000'))._bytes,
  create3: (c) => S(c).create3(U(c, 0), B32(c, 1), B(c, '6000'))._bytes,
  create3Address: (c) => S(c).create3Address(B32(c, 1))._bytes,
  createAddress: (c) => S(c).createAddress(A(c), U(c, 1))._bytes,
  create2Address: (c) => S(c).create2Address(A(c), B32(c, 1), B32(c, 2))._bytes,

  bytesFixedWidths: (c) =>
    cat(
      BN(c, 0xaa, 1)._bytes,
      BN(c, 0xaabb, 2)._bytes,
      BN(c, 0xdeadbeef, 4)._bytes,
      BN(c, 0xaabbccddeeffn, 6)._bytes,
      BN(c, 0xaabbccddeeff0011n, 8)._bytes,
    ),

  jump: () => new Uint8Array([0xb2, 1, 0xb4, 2]), // JUMP(1), JUMP_BACK(2)
  revert: (c) => S(c).revert(B(c, 'abcd'))._bytes,
  log: (c) => S(c).log(B(c, '1234'), [B32(c, 0xaa)])._bytes,
};

function readSolidityVectors(): Record<string, string> {
  const out = execSync('forge script script/V12SaucerVectors.s.sol --sig "runAll()" 2>&1', {
    cwd: ENGINE_V12,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const map: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = line.match(/VEC (\S+) (0x\S*)/);

    if (m) map[m[1]] = m[2].replace(/^0x/, '');
  }

  if (Object.keys(map).length === 0) throw new Error(`no VEC lines parsed from forge output:\n${out}`);

  return map;
}

describeIfForge('v12 builder parity (V12Saucer.ts == V12Saucer.sol)', () => {
  let sol: Record<string, string>;

  beforeAll(() => {
    sol = readSolidityVectors();
  }, 300_000);

  for (const name of Object.keys(scenarios)) {
    it(name, () => {
      expect(sol[name]).toBeDefined();
      expect(hex(scenarios[name](ctx()))).toBe(sol[name]);
    });
  }
});

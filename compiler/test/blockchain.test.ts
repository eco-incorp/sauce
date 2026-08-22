import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('blockchain context', () => {
  it('compiles msg.sender', () => {
    const result = compile('function main() { const x = msg.sender; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.MSG_SENDER]));
  });

  it('compiles msg.value', () => {
    const result = compile('function main() { const x = msg.value; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CALL_VALUE]));
  });

  it('compiles msg.data to heap slot', () => {
    const result = compile('function main() { const data = msg.data; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.CALLDATA]));
  });

  it('compiles block.number', () => {
    const result = compile('function main() { const x = block.number; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BLOCK_NUMBER]));
  });

  it('compiles block.timestamp', () => {
    const result = compile('function main() { const x = block.timestamp; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.TIMESTAMP]));
  });

  it('compiles block.coinbase', () => {
    const result = compile('function main() { const x = block.coinbase; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.COINBASE]));
  });

  it('compiles block.prevrandao', () => {
    const result = compile('function main() { const x = block.prevrandao; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.PREVRANDAO]));
  });

  it('compiles block.gasLimit', () => {
    const result = compile('function main() { const x = block.gasLimit; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.GAS_LIMIT]));
  });

  it('compiles block.baseFee', () => {
    const result = compile('function main() { const x = block.baseFee; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BASE_FEE]));
  });

  it('compiles block.blobBaseFee', () => {
    const result = compile('function main() { const x = block.blobBaseFee; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BLOB_BASE_FEE]));
  });

  it('compiles block.chainId', () => {
    const result = compile('function main() { const x = block.chainId; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CHAIN_ID]));
  });

  it('compiles tx.origin', () => {
    const result = compile('function main() { const x = tx.origin; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.TX_ORIGIN]));
  });

  it('compiles tx.gasPrice', () => {
    const result = compile('function main() { const x = tx.gasPrice; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.GAS_PRICE]));
  });

  it('compiles address.self', () => {
    const result = compile('function main() { const x = address.self; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.THIS_ADDRESS]));
  });

  it('compiles address.balance', () => {
    const result = compile('function main() { const x = address.balance; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.SELF_BALANCE]));
  });

  it('compiles gasLeft()', () => {
    const result = compile('function main() { const g = gasLeft(); }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.GAS_LEFT]));
  });

  it('compiles blockHash(n)', () => {
    const result = compile('function main() { const h = blockHash(100); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BLOCK_HASH, OPS.BYTE_1, 100]),
    );
  });

  it('compiles blobHash(n)', () => {
    const result = compile('function main() { const h = blobHash(0); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BLOB_HASH, OPS.BYTE_1, 0]),
    );
  });

  it('compiles address.balanceOf(addr)', () => {
    const result = compile('function main() { const b = address.balanceOf(42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BALANCE, OPS.BYTE_1, 42]),
    );
  });

  it('compiles address.codeSize(addr)', () => {
    const result = compile('function main() { const s = address.codeSize(42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.EXT_CODE_SIZE, OPS.BYTE_1, 42]),
    );
  });

  it('compiles address.codeHash(addr)', () => {
    const result = compile('function main() { const h = address.codeHash(42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.EXT_CODE_HASH, OPS.BYTE_1, 42]),
    );
  });

  it('compiles address.isContract(addr)', () => {
    const result = compile('function main() { const c = address.isContract(42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.IS_CONTRACT, OPS.BYTE_1, 42]),
    );
  });

  it('compiles address.isEOA(addr)', () => {
    const result = compile('function main() { const e = address.isEOA(42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.IS_EOA, OPS.BYTE_1, 42]),
    );
  });

  it('compiles context in arithmetic expression', () => {
    const result = compile('function main() { const x = block.number + 1; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.ADD, OPS.BLOCK_NUMBER, OPS.BYTE_1, 1]),
    );
  });

  it('compiles blockHash with variable argument', () => {
    const result = compile('function main() { const n = 10; const h = blockHash(n); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        10,
        OPS.WRITE_VALUE,
        1,
        OPS.BLOCK_HASH,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });

  it('throws on gasLeft with arguments', () => {
    expect(() => compile('function main() { const g = gasLeft(1); }')).toThrow(
      'gasLeft() expects 0 argument(s), got 1',
    );
  });

  it('throws on blockHash with no arguments', () => {
    expect(() => compile('function main() { const h = blockHash(); }')).toThrow(
      'blockHash() expects exactly 1 argument',
    );
  });

  it('throws on address.balanceOf with no arguments', () => {
    expect(() => compile('function main() { const b = address.balanceOf(); }')).toThrow(
      'address.balanceOf() expects exactly 1 argument',
    );
  });

  // §1.8 / decision 0.4: `msg`/`block` are member-access-only globals (`msg.sender`,
  // `block.number`), not namespace roots, so a plain value binding cannot shadow them
  // — RS accepts the binding and now so does TS. (Full matrix in the dedicated
  // "reserved-name narrowing" describe block below.)
  it('allows a variable named msg (member-access-only global)', () => {
    expect(() => compile('function main() { const msg = 5n; return msg; }')).not.toThrow();
  });

  it('allows a variable named block (member-access-only global)', () => {
    expect(() => compile('function main() { const block = 5n; return block; }')).not.toThrow();
  });

  it('throws on function named tx', () => {
    // A function DECLARATION keeps the broader callable reservation (RESERVED_NAMES),
    // so `tx` is still refused here even though `let tx` is now allowed.
    // Called from main — treeshake defaults to true, so an unreferenced function is
    // dropped (never compiled, never validated); this must stay reachable to fire.
    expect(() => compile('function tx() { return 1; }\nfunction main() { return tx(); }')).toThrow(
      "'tx' is a reserved name",
    );
  });

  it('allows a function parameter named address (former global)', () => {
    // A parameter is a value binding — `address` is not a namespace root, so it is
    // now accepted, matching RS.
    expect(() =>
      compile('function foo(address) { return address; }\nfunction main() { return foo(1n); }'),
    ).not.toThrow();
  });

  it('throws on variable named Math (namespace root)', () => {
    expect(() => compile('function main() { const Math = 5; }')).toThrow("'Math' is a reserved name");
  });

  it('allows a variable named gasLeft (call-only builtin)', () => {
    expect(() => compile('function main() { const gasLeft = 5n; return gasLeft; }')).not.toThrow();
  });

  it('allows a variable named Uint8Array (constructor-only global)', () => {
    expect(() => compile('function main() { const Uint8Array = 5n; return Uint8Array; }')).not.toThrow();
  });

  it('throws on variable named abi (namespace root)', () => {
    expect(() => compile('function main() { const abi = 5; }')).toThrow("'abi' is a reserved name");
  });

  it('allows a variable named blockHash (call-only builtin)', () => {
    expect(() => compile('function main() { const blockHash = 5n; return blockHash; }')).not.toThrow();
  });

  it('allows a variable named blobHash (call-only builtin)', () => {
    expect(() => compile('function main() { const blobHash = 5n; return blobHash; }')).not.toThrow();
  });

  it('throws on calling a property as a method', () => {
    expect(() => compile('function main() { const x = msg.sender(); }')).toThrow('not implemented: msg.sender');
  });

  it('throws on blobHash with no arguments', () => {
    expect(() => compile('function main() { const h = blobHash(); }')).toThrow('blobHash() expects exactly 1 argument');
  });

  it('throws on Math.sqrt with no arguments', () => {
    expect(() => compile('function main() { const x = Math.sqrt(); }')).toThrow('Math.sqrt expects exactly 1 argument');
  });

  it('throws on unknown global property', () => {
    expect(() => compile('function main() { const x = msg.foo(); }')).toThrow('not implemented: msg.foo');
  });

  // crypto tests
  it('compiles crypto.keccak256 with bytes', () => {
    const result = compile('function main() { const h = crypto.keccak256(msg.data); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.KECCAK256, OPS.CALLDATA]),
    );
  });

  it('throws on crypto.keccak256 with no arguments', () => {
    expect(() => compile('function main() { const h = crypto.keccak256(); }')).toThrow(
      'crypto.keccak256 expects exactly 1 argument',
    );
  });

  it('compiles crypto.ecdsaVerify', () => {
    const result = compile('function main() { const valid = crypto.ecdsaVerify(42, 100, msg.data); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.ECDSA_VERIFY,
        OPS.BYTE_1,
        42,
        OPS.BYTE_1,
        100,
        OPS.CALLDATA,
      ]),
    );
  });

  it('throws on crypto.ecdsaVerify with wrong arity', () => {
    expect(() => compile('function main() { const v = crypto.ecdsaVerify(1, 2); }')).toThrow(
      'crypto.ecdsaVerify expects 3 argument(s), got 2',
    );
  });

  it('throws on variable named crypto (namespace root)', () => {
    expect(() => compile('function main() { const crypto = 5; }')).toThrow("'crypto' is a reserved name");
  });

  // storage tests
  it('compiles storage.read', () => {
    const result = compile('function main() { const v = storage.read(0); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.SLOAD, OPS.BYTE_1, 0]),
    );
  });

  it('compiles storage.write', () => {
    const result = compile('function main() { const v = storage.write(0, 42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.SSTORE, OPS.BYTE_1, 0, OPS.BYTE_1, 42]),
    );
  });

  it('compiles storage.tRead', () => {
    const result = compile('function main() { const v = storage.tRead(0); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.TLOAD, OPS.BYTE_1, 0]),
    );
  });

  it('compiles storage.tWrite', () => {
    const result = compile('function main() { const v = storage.tWrite(0, 42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.TSTORE, OPS.BYTE_1, 0, OPS.BYTE_1, 42]),
    );
  });

  it('throws on storage.read with wrong arity', () => {
    expect(() => compile('function main() { const v = storage.read(); }')).toThrow(
      'storage.read expects exactly 1 argument',
    );
  });

  it('throws on storage.write with wrong arity', () => {
    expect(() => compile('function main() { const v = storage.write(0); }')).toThrow(
      'storage.write expects 2 argument(s), got 1',
    );
  });

  it('allows a variable named storage (member-access-only global)', () => {
    expect(() => compile('function main() { const storage = 5n; return storage; }')).not.toThrow();
  });

  // contract.* tests
  it('compiles contract.create', () => {
    const result = compile('function main() { const a = contract.create(0, Uint8Array.from([0x60, 0x00])); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CREATE, OPS.BYTE_1, 0, OPS.BYTES, 2, 0x60, 0x00]),
    );
  });

  it('compiles contract.create2', () => {
    const result = compile('function main() { const a = contract.create2(0, 123, Uint8Array.from([0x60, 0x00])); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CREATE2,
        OPS.BYTE_1,
        0,
        OPS.BYTE_1,
        123,
        OPS.BYTES,
        2,
        0x60,
        0x00,
      ]),
    );
  });

  it('compiles contract.create3', () => {
    const result = compile('function main() { const a = contract.create3(0, 456, Uint8Array.from([0x60, 0x00])); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CREATE3,
        OPS.BYTE_1,
        0,
        OPS.BYTE_2,
        1,
        200,
        OPS.BYTES,
        2,
        0x60,
        0x00,
      ]),
    );
  });

  it('compiles contract.predictCreate', () => {
    const result = compile('function main() { const a = contract.predictCreate(42, 1); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CREATE_ADDRESS, OPS.BYTE_1, 42, OPS.BYTE_1, 1]),
    );
  });

  it('compiles contract.predictCreate2', () => {
    const result = compile('function main() { const a = contract.predictCreate2(42, 123, 456); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CREATE2_ADDRESS,
        OPS.BYTE_1,
        42,
        OPS.BYTE_1,
        123,
        OPS.BYTE_2,
        1,
        200,
      ]),
    );
  });

  it('compiles contract.predictCreate3', () => {
    const result = compile('function main() { const a = contract.predictCreate3(99); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CREATE3_ADDRESS, OPS.BYTE_1, 99]),
    );
  });

  it('throws on contract.create with wrong arity', () => {
    expect(() => compile('function main() { const a = contract.create(0); }')).toThrow(
      'contract.create expects 2 argument(s), got 1',
    );
  });

  it('throws on contract.predictCreate3 with wrong arity', () => {
    expect(() => compile('function main() { const a = contract.predictCreate3(); }')).toThrow(
      'contract.predictCreate3 expects exactly 1 argument',
    );
  });

  it('allows a variable named contract (member-access-only global)', () => {
    expect(() => compile('function main() { const contract = 5n; return contract; }')).not.toThrow();
  });

  // emit tests
  it('compiles emit with signature and data', () => {
    const result = compile('function main() { emit("Foo(uint256)", {value: 42}); }');
    // LOG with 1 topic (signature hash), data is ABI-encoded {value: 42}
    expect(result.bytecode[0]).toContain(OPS.LOG);
    // Topic0 should be the keccak256 hash (32 bytes)
    expect(result.bytecode[0]).toContain(OPS.BYTE_32);
  });

  it('compiles emit with indexed fields', () => {
    const result = compile('function main() { emit("Transfer(address,uint256)", {to: 1, value: 42}, "to"); }');
    // LOG with 2 topics (signature hash + indexed "to")
    expect(result.bytecode[0]).toContain(OPS.LOG);
  });

  it('throws on emit with non-string signature', () => {
    expect(() => compile('function main() { emit(123, {value: 1}); }')).toThrow(
      'emit() signature must be a string literal',
    );
  });

  it('throws on emit with non-object data', () => {
    expect(() => compile('function main() { emit("Foo()", 123); }')).toThrow('emit() data must be an object literal');
  });

  it('throws on emit with more than 3 indexed fields', () => {
    expect(() =>
      compile('function main() { emit("Foo(uint256,uint256,uint256,uint256)", {a:1,b:2,c:3,d:4}, "a","b","c","d"); }'),
    ).toThrow('emit() supports at most 3 indexed fields');
  });

  it('throws on emit with unknown indexed field', () => {
    expect(() => compile('function main() { emit("Foo(uint256)", {value: 1}, "unknown"); }')).toThrow(
      "indexed field 'unknown' not found in data",
    );
  });

  it('allows a variable named emit (call-only builtin)', () => {
    expect(() => compile('function main() { const emit = 5n; return emit; }')).not.toThrow();
  });

  it('throws on emit with no arguments', () => {
    expect(() => compile('function main() { emit(); }')).toThrow('emit() requires at least a signature');
  });

  it('compiles emit with no data (empty event)', () => {
    const result = compile('function main() { emit("Ping()"); }');
    expect(result.bytecode[0]).toContain(OPS.LOG);
  });

  // eval tests
  it('compiles eval with string literal', () => {
    const result = compile('function main() { const x = eval("return 42"); }');
    expect(result.bytecode[0][0]).toBe(OPS.ALLOCATE_VALUE);
    expect(result.bytecode[0]).toContain(OPS.EVAL);
  });

  it('compiles eval with non-string argument (dynamic eval)', () => {
    const result = compile('function main() { const x = eval(42); }');
    expect(result.bytecode[0]).toContain(OPS.EVAL);
  });

  it('compiles eval with variable argument (dynamic eval)', () => {
    const result = compile('function main() { const code = "return 1"; const x = eval(code); }');
    expect(result.bytecode[0]).toContain(OPS.EVAL);
  });

  it('throws on variable named eval (strict mode)', () => {
    expect(() => compile('function main() { const eval = 5; }')).toThrow('Binding eval in strict mode');
  });
});

// Executes decision 0.4 (docs/plans/compiler-parity-BACKLOG.md §1.8): the TS
// binding-name reservation is narrowed to compiler-rs's rule — only the builtin
// NAMESPACE ROOTS ({abi, crypto, ctx, Math, evm, svm}) are refused as a value
// binding, because their member calls resolve THROUGH the root identifier before
// any scope lookup. Every OTHER former TS global is a member-access-only / call-only
// surface a plain value binding cannot shadow, so — matching RS — a local named for
// one now compiles. Function declarations and inline function names keep the broader
// callable reservation (see RESERVED_NAMES), so this only affects let/const/params.
describe('reserved-name narrowing (compiler-parity §1.8 / decision 0.4)', () => {
  // Names RS accepts as a binding that TS used to reject — now compile on TS too.
  it.each(['msg', 'block', 'tx', 'address', 'contract', 'storage', 'Uint8Array', 'gasLeft', 'blockHash', 'blobHash', 'emit', 'uint', 'accountData', 'writeAccountData', 'accountUint'])(
    'allows a local binding named %s (RS-accepted)',
    (name) => {
      expect(() => compile(`function main() { const ${name} = 1n; return ${name}; }`)).not.toThrow();
    },
  );

  it('allows the task-motivating shapes let block / let tx', () => {
    expect(() => compile('function main() { let block = 1n; let tx = 2n; return block + tx; }')).not.toThrow();
  });

  it('allows a function parameter named for a former global (address)', () => {
    expect(() =>
      compile('function foo(address) { return address; }\nfunction main() { return foo(1n); }'),
    ).not.toThrow();
  });

  // A read-position member access on a namespace root still resolves to the global,
  // so existing usage is unaffected by the binding narrowing.
  it('keeps msg.sender / block.number resolving to the global', () => {
    expect(() => compile('function main() { const a = msg.sender; const b = block.number; return a; }')).not.toThrow();
  });

  // The namespace roots stay refused as bindings — matching RS exactly.
  it.each(['abi', 'crypto', 'ctx', 'Math', 'evm', 'svm'])('still refuses a binding named %s (namespace root)', (name) => {
    expect(() => compile(`function main() { const ${name} = 5; }`)).toThrow("is a reserved name");
  });

  // Callable-name reservation is unchanged (broader than RS by design): a function
  // declaration named for a builtin the call path resolves first is still refused.
  it('still refuses a function declaration named tx', () => {
    expect(() => compile('function tx() { return 1; }\nfunction main() { return tx(); }')).toThrow(
      "'tx' is a reserved name",
    );
  });
});

import type { Expression, Literal, ArrayExpression, ObjectExpression, Property } from 'acorn';
import { keccak256, toBytes } from 'viem';
import { OPS } from './saucer/index.js';
import type { SaucerLike, V12Saucer } from './saucer/index.js';
import type { VariableKind, CompilerContext } from './context.js';
import { compile } from './index.js';
import { assertCapability } from './capabilities.js';

type PropertyCompile = (saucer: SaucerLike) => SaucerLike;
type MethodCompile = (saucer: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => SaucerLike;

export interface GlobalDef {
  kind: VariableKind;
  compile: PropertyCompile | MethodCompile;
}

const ABI_TYPE_SPECS: Record<string, number> = {
  bool: OPS.BYTE_1,
  address: OPS.BYTE_20,
  bytes: OPS.BYTES,
  string: OPS.BYTES,
  ...Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`uint${(i + 1) * 8}`, OPS.BYTE_1 + i])),
};

const resolveAbiTypeSpec = (arg: Expression): number[] => {
  if (arg.type === 'Literal' && typeof (arg as Literal).value === 'string') {
    const name = (arg as Literal).value as string;
    const spec = ABI_TYPE_SPECS[name];

    if (!spec) throw new Error(`unknown ABI type: '${name}'`);

    return [spec];
  }

  if (arg.type === 'ObjectExpression') {
    const obj = arg as ObjectExpression;
    const sorted = (obj.properties as Property[])
      .map((prop) => {
        if (prop.type !== 'Property') throw new Error('spread properties are not supported');

        const key =
          prop.key.type === 'Identifier' ? (prop.key as { name: string }).name : String((prop.key as Literal).value);

        return { key, value: prop.value as Expression };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    const inner = sorted.flatMap((p) => resolveAbiTypeSpec(p.value));

    return [OPS.TUPLE, sorted.length, ...inner];
  }

  if (arg.type === 'ArrayExpression') {
    const arr = arg as ArrayExpression;

    if (arr.elements.length !== 1) throw new Error('array type spec must have exactly 1 element type');

    return [OPS.ARRAY, ...resolveAbiTypeSpec(arr.elements[0] as Expression)];
  }

  throw new Error('abi.decode type arguments must be string literals, objects, or arrays');
};

const extractByteLiteral = (el: ArrayExpression['elements'][number]): number => {
  if (!el || el.type !== 'Literal') throw new Error('Uint8Array elements must be number literals');

  const v = (el as Literal).value;

  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255)
    throw new Error('Uint8Array elements must be integers 0-255');

  return v;
};

const expectArity = (name: string, expected: number, args: Expression[]): void => {
  if (args.length !== expected)
    throw new Error(
      `${name} expects ${expected === 1 ? 'exactly 1 argument' : `${expected} argument(s), got ${args.length}`}`,
    );
};

// --- svm account helpers (target 'svm' call/storage lowering) ---

/**
 * Resolve one accounts-list entry to a user-account index: a string literal is a
 * READONLY symbolic ref (interned into the shared plan), an object literal
 * `{ref, writable?, signer?}` interns with flags (ref a string literal, flags
 * boolean literals), and an integer literal 0-255 is a raw index (escape hatch
 * bypassing the plan; raw and symbolic modes cannot be mixed in one compile).
 */
const svmAccountEntry = (name: string, el: ArrayExpression['elements'][number], ctx: CompilerContext): number => {
  const invalid = (): Error =>
    new Error(`${name} accounts entries must be string refs, {ref, writable?, signer?} objects, or integer indices`);

  if (el?.type === 'Literal') {
    const v = (el as Literal).value;

    if (typeof v === 'string') return ctx.internAccount(v);

    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255) {
      ctx.useRawAccountIndex();

      return v;
    }

    throw invalid();
  }

  if (el?.type === 'ObjectExpression') {
    let ref: string | undefined;
    const flags = { writable: false, signer: false };

    for (const prop of (el as ObjectExpression).properties) {
      if (prop.type !== 'Property') throw invalid();

      const p = prop as Property;

      // Computed keys ({ [expr]: … }) are not the plain literal shape the spec
      // allows — reject rather than silently reading the key expression's node.
      if (p.computed) throw invalid();

      const key = p.key.type === 'Identifier' ? (p.key as { name: string }).name : String((p.key as Literal).value);
      const value = p.value as Expression;

      if (key === 'ref') {
        if (value.type !== 'Literal' || typeof (value as Literal).value !== 'string') throw invalid();

        ref = (value as Literal).value as string;
      } else if (key === 'writable' || key === 'signer') {
        if (value.type !== 'Literal' || typeof (value as Literal).value !== 'boolean') throw invalid();

        flags[key] = (value as Literal).value as boolean;
      } else {
        throw invalid();
      }
    }

    if (ref === undefined) throw invalid();

    return ctx.internAccount(ref, flags);
  }

  throw invalid();
};

/**
 * Lower a call's accounts argument (an array-literal expression) to the static
 * ARRAY of 1-byte account indices the SVM engine expects — element data inline
 * in the bytecode (the engine pops just the descriptor and resolves each index
 * against the execute instruction's user accounts).
 */
const svmAccountsArray = (name: string, arg: Expression, ctx: CompilerContext): SaucerLike => {
  if (arg.type !== 'ArrayExpression') {
    throw new Error(`${name} on target 'svm' expects (target, calldata, accounts[])`);
  }

  const elements = (arg as ArrayExpression).elements;

  if (elements.length > 64) {
    throw new Error(`${name} accounts list exceeds the 64-account CPI cap (got ${elements.length})`);
  }

  const indices = elements.map((el) => svmAccountEntry(name, el, ctx));

  return ctx.newSaucer().array(indices.map((i) => ctx.newSaucer().int(BigInt(i))));
};

/**
 * Closes a confirmed silent-miscompile hole: on an EVM target, `contract.call`'s 3rd
 * operand is plain calldata bytes (or, for `contract.static`, an outright arity error) —
 * NOT an accounts list. Passing the svm accounts-list SHAPE there anyway (a string ref, or
 * an `{ref, writable?, signer?}` object, inside an array literal) used to compile cleanly
 * and silently encode the "accounts" as an array-of-UTF8-bytes descriptor passed as calldata,
 * corrupting the actual call. A purely numeric array (`[3, 5]`, the raw-index escape hatch)
 * is syntactically indistinguishable from an ordinary literal array and is deliberately left
 * to the existing arity/type errors — see capabilities.ts's 'accounts list' row.
 */
const isAccountRefShaped = (el: ArrayExpression['elements'][number]): boolean => {
  if (el?.type === 'Literal') return typeof (el as Literal).value === 'string';

  if (el?.type === 'ObjectExpression') {
    return (el as ObjectExpression).properties.some(
      (prop) =>
        prop.type === 'Property' && !(prop as Property).computed && getPropertyKeyName(prop as Property) === 'ref',
    );
  }

  return false;
};

const getPropertyKeyName = (p: Property): string =>
  p.key.type === 'Identifier' ? (p.key as { name: string }).name : String((p.key as Literal).value);

const assertAccountsListNotOnEvm = (name: string, arg: Expression | undefined, ctx: CompilerContext): void => {
  if (!arg || arg.type !== 'ArrayExpression') return;

  const elements = (arg as ArrayExpression).elements;

  if (elements.length > 0 && elements.every((el) => isAccountRefShaped(el))) {
    assertCapability(ctx, 'accounts list', arg);
  }
};

/** Resolve an accountData/writeAccountData ref argument to an account-index saucer. */
const svmAccountRef = (
  name: string,
  arg: Expression,
  ctx: CompilerContext,
  flags: { writable?: boolean; signer?: boolean } = {},
): SaucerLike => {
  if (arg.type === 'Literal') {
    const v = (arg as Literal).value;

    if (typeof v === 'string') return ctx.newSaucer().int(BigInt(ctx.internAccount(v, flags)));

    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255) {
      ctx.useRawAccountIndex();

      return ctx.newSaucer().int(BigInt(v));
    }
  }

  throw new Error(`${name} ref must be a string literal ref or an integer index`);
};

/**
 * Lower the accountUint sugar's data read: accountData(ref, offset, width)
 * with the width pinned to an integer literal 1-32 — the cast ops' scalar band
 * only holds up to a 32-byte word, and a runtime-computed width would defeat
 * the "one op per field" point of the sugar.
 */
const svmAccountUintData = (
  name: string,
  s: SaucerLike,
  args: Expression[],
  process: (e: Expression) => SaucerLike,
): SaucerLike => {
  expectArity(name, 3, args);

  const index = svmAccountRef(name, args[0], s.ctx);
  const width = args[2].type === 'Literal' ? (args[2] as Literal).value : undefined;

  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > 32)
    throw new Error(`${name} width must be an integer literal between 1 and 32`);

  return (s.ctx.newSaucer() as V12Saucer).svmAccountData(index, process(args[1]), s.ctx.newSaucer().int(BigInt(width)));
};

// --- emit() helpers ---

interface EmitArgs {
  signature: string;
  fields: Map<string, Expression>;
  indexedNames: string[];
}

const parseEmitArgs = (args: Expression[]): EmitArgs => {
  if (args.length < 1) throw new Error('emit() requires at least a signature');

  if (args[0].type !== 'Literal' || typeof (args[0] as Literal).value !== 'string')
    throw new Error('emit() signature must be a string literal');

  const signature = (args[0] as Literal).value as string;

  if (args.length > 1 && args[1].type !== 'ObjectExpression') throw new Error('emit() data must be an object literal');

  const fields =
    args.length > 1
      ? ((args[1] as ObjectExpression).properties as Property[]).reduce((map, prop) => {
          const key =
            prop.key.type === 'Identifier' ? (prop.key as { name: string }).name : String((prop.key as Literal).value);

          return map.set(key, prop.value as Expression);
        }, new Map<string, Expression>())
      : new Map<string, Expression>();

  const indexedNames = args.slice(2).map((arg) => {
    if (arg.type !== 'Literal' || typeof (arg as Literal).value !== 'string')
      throw new Error('indexed field names must be string literals');

    return (arg as Literal).value as string;
  });

  if (indexedNames.length > 3) throw new Error('emit() supports at most 3 indexed fields');

  return { signature, fields, indexedNames };
};

const buildTopics = (
  s: SaucerLike,
  signature: string,
  fields: Map<string, Expression>,
  indexedNames: string[],
  process: (e: Expression) => SaucerLike,
): SaucerLike[] => {
  const topic0 = s.ctx.newSaucer().int(BigInt(keccak256(toBytes(signature))));

  return [
    topic0,
    ...indexedNames.map((name) => {
      if (!fields.has(name)) throw new Error(`indexed field '${name}' not found in data`);

      return process(fields.get(name)!);
    }),
  ];
};

const buildData = (
  s: SaucerLike,
  fields: Map<string, Expression>,
  indexedNames: string[],
  process: (e: Expression) => SaucerLike,
): SaucerLike => {
  const nonIndexed = [...fields.entries()]
    .filter(([name]) => !indexedNames.includes(name))
    .map(([, expr]) => process(expr));

  return nonIndexed.length > 0
    ? s.abiEncode(s.ctx.newSaucer().tuple(nonIndexed))
    : s.ctx.newSaucer().bytes(new Uint8Array());
};

// Each global maps method/property names to { kind, compile }.
// Properties (compile.length === 1) are accessed as member expressions.
// Methods (compile.length === 3) are called with arguments.
// Add new globals here — the compiler dispatches automatically.
export const GLOBALS: Record<string, Record<string, GlobalDef>> = {
  // Math.sqrt(x) — integer square root
  //   Math.sqrt(16)  => 4
  //   Math.sqrt(10)  => 3
  //
  // Math.mulDiv(a, b, denominator) — full-precision a*b/denominator (floored)
  //   computes floor(a * b / denominator) in 512-bit precision (no intermediate overflow)
  //   Math.mulDiv(100, 50, 25)  => 200
  //
  // Math.neg(x) — two's-complement negation (wrapping), i.e. the int256 value -x
  //   for signed params like Uniswap amountSpecified (negative = exact input)
  Math: {
    sqrt: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('Math.sqrt', 1, args);

        return s.sqrt(process(args[0]));
      },
    },
    mulDiv: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('Math.mulDiv', 3, args);

        return s.mulDiv(process(args[0]), process(args[1]), process(args[2]));
      },
    },
    neg: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('Math.neg', 1, args);

        return s.neg(process(args[0]));
      },
    },
  },

  // crypto.keccak256(data) — compute keccak256 hash
  //   crypto.keccak256(msg.data)
  //   crypto.keccak256(Uint8Array.from([0x01, 0x02]))
  //
  // crypto.ecdsaVerify(signer, hash, signature) — verify ECDSA signature (EOA or EIP-1271)
  //   crypto.ecdsaVerify(signerAddress, messageHash, sig) => 1 if valid, 0 if invalid
  crypto: {
    keccak256: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('crypto.keccak256', 1, args);

        return s.keccak256(process(args[0]));
      },
    },
    ecdsaVerify: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('crypto.ecdsaVerify', 3, args);

        return s.ecdsaVerify(process(args[0]), process(args[1]), process(args[2]));
      },
    },
  },

  // storage.read(slot) — load value from persistent storage
  //   storage.read(0) => value at slot 0
  //
  // storage.write(slot, value) — store value to persistent storage
  //   storage.write(0, 42) => stores 42 at slot 0, returns 42
  //
  // storage.tRead(key) — load value from transient storage (EIP-1153)
  //   storage.tRead(0) => value at key 0
  //
  // storage.tWrite(key, value) — store value to transient storage (EIP-1153)
  //   storage.tWrite(0, 42) => stores 42 at key 0, returns 42
  storage: {
    read: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('storage.read', 1, args);

        return s.sload(process(args[0]));
      },
    },
    write: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('storage.write', 2, args);

        return s.sstore(process(args[0]), process(args[1]));
      },
    },
    tRead: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('storage.tRead', 1, args);

        return s.tload(process(args[0]));
      },
    },
    tWrite: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('storage.tWrite', 2, args);

        return s.tstore(process(args[0]), process(args[1]));
      },
    },
  },

  // Uint8Array.from([...]) — create a byte array from numeric elements
  //   Uint8Array.from([0xaa, 0xbb, 0xcc])
  Uint8Array: {
    from: {
      kind: 'dynamic',
      compile: (s: SaucerLike, args: Expression[], _process: (e: Expression) => SaucerLike) => {
        if (args.length !== 1) throw new Error('Uint8Array expects exactly 1 argument');

        if (args[0].type !== 'ArrayExpression') throw new Error('Uint8Array expects an array literal');

        const bytes = new Uint8Array((args[0] as ArrayExpression).elements.map(extractByteLiteral));

        return s.bytes(bytes);
      },
    },
  },

  // abi.encode(...args) — ABI-encode values into bytes
  //   abi.encode(42)
  //   abi.encode(1, "hello", [10, 20])
  //   abi.encode({ id: 1, name: "alice" })
  //
  // abi.decode(data, ...typeSpecs) — ABI-decode bytes into a tuple
  //   abi.decode(data, "uint256")
  //   abi.decode(data, "uint256", "string")
  //   abi.decode(data, "uint256", { id: "uint256", name: "string" })
  //   abi.decode(data, ["uint256"])
  //
  //   Supported type strings: uint8–uint256, bool, address, bytes, string
  //   Nested specs: { field: typeSpec } for structs, [typeSpec] for arrays
  abi: {
    encode: {
      kind: 'dynamic',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        if (args.length === 0) throw new Error('abi.encode expects at least 1 argument');

        const tuple =
          args.length === 1 && args[0].type === 'ObjectExpression'
            ? process(args[0])
            : s.ctx.newSaucer().tuple(args.map(process));

        return s.abiEncode(tuple);
      },
    },
    decode: {
      kind: 'dynamic',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        if (args.length < 2) throw new Error('abi.decode expects data and at least 1 type argument');

        const data = process(args[0]);
        const count = args.length - 1;
        const typeSpecs = args.slice(1).flatMap(resolveAbiTypeSpec);

        return s.abiDecode(count, data, typeSpecs);
      },
    },
  },

  // msg.sender  — caller address (uint256)
  // msg.value   — wei sent with the call (uint256)
  // msg.data    — raw calldata (bytes)
  msg: {
    sender: { kind: 'scalar', compile: (s: SaucerLike) => s.msgSender() },
    value: { kind: 'scalar', compile: (s: SaucerLike) => s.msgValue() },
    data: { kind: 'dynamic', compile: (s: SaucerLike) => s.msgData() },
  },

  // block.number      — current block number
  // block.timestamp    — current block timestamp (seconds since epoch)
  // block.coinbase     — block miner/validator address
  // block.prevrandao   — previous RANDAO value
  // block.gasLimit     — block gas limit
  // block.baseFee      — base fee per gas (EIP-1559)
  // block.blobBaseFee  — blob base fee (EIP-4844)
  // block.chainId      — chain ID (e.g. 1 for mainnet, 31337 for anvil)
  block: {
    number: { kind: 'scalar', compile: (s: SaucerLike) => s.blockNumber() },
    timestamp: { kind: 'scalar', compile: (s: SaucerLike) => s.blockTimestamp() },
    coinbase: { kind: 'scalar', compile: (s: SaucerLike) => s.blockCoinbase() },
    prevrandao: { kind: 'scalar', compile: (s: SaucerLike) => s.blockPrevrandao() },
    gasLimit: { kind: 'scalar', compile: (s: SaucerLike) => s.blockGasLimit() },
    baseFee: { kind: 'scalar', compile: (s: SaucerLike) => s.blockBaseFee() },
    blobBaseFee: { kind: 'scalar', compile: (s: SaucerLike) => s.blockBlobBaseFee() },
    chainId: { kind: 'scalar', compile: (s: SaucerLike) => s.blockChainId() },
  },

  // tx.origin    — transaction originator address
  // tx.gasPrice  — gas price of the transaction
  tx: {
    origin: { kind: 'scalar', compile: (s: SaucerLike) => s.txOrigin() },
    gasPrice: { kind: 'scalar', compile: (s: SaucerLike) => s.txGasPrice() },
  },

  // ctx.*  — unified context namespace (compiler-parity §1.4, adopted from compiler-rs).
  // EXACTLY 7 members, ALL call-form (`ctx.foo()`); `self` is a METHOD (unlike the `address.self`
  // PROPERTY), and `gasPrice`/`origin` are deliberately excluded (RS raises CtxUnknownMethod).
  // Each aliases the pre-existing msg.*/block.*/address.* spelling, emitting byte-identical bytecode.
  // A nullary here still takes the (ignored) args param so `compile.length !== 1` — that routes it
  // through processStaticMethod (call form) and makes bare `ctx.foo` (no call) fail closed, matching
  // RS's call-only rule. Oracle: sauce-core/src/lower/contract.rs:463-472.
  ctx: {
    msgSender: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[]) => {
        expectArity('ctx.msgSender()', 0, args);

        return s.msgSender();
      },
    },
    self: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[]) => {
        expectArity('ctx.self()', 0, args);

        return s.addressSelf();
      },
    },
    chainId: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[]) => {
        expectArity('ctx.chainId()', 0, args);

        return s.blockChainId();
      },
    },
    blockNumber: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[]) => {
        expectArity('ctx.blockNumber()', 0, args);

        return s.blockNumber();
      },
    },
    timestamp: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[]) => {
        expectArity('ctx.timestamp()', 0, args);

        return s.blockTimestamp();
      },
    },
    selfBalance: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[]) => {
        expectArity('ctx.selfBalance()', 0, args);

        return s.addressBalance();
      },
    },
    balance: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('ctx.balance()', 1, args);

        return s.balanceOf(process(args[0]));
      },
    },
  },

  // address.self               — this contract's address
  // address.balance            — this contract's ETH balance (wei)
  // address.balanceOf(addr)    — ETH balance of addr (wei)
  // address.codeSize(addr)     — deployed code size of addr (bytes)
  // address.codeHash(addr)     — keccak256 hash of addr's code
  // address.isContract(addr)   — 1 if addr has code, 0 otherwise
  // address.isEOA(addr)        — 1 if addr has no code, 0 otherwise
  address: {
    self: { kind: 'scalar', compile: (s: SaucerLike) => s.addressSelf() },
    balance: { kind: 'scalar', compile: (s: SaucerLike) => s.addressBalance() },
    balanceOf: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('address.balanceOf()', 1, args);

        return s.balanceOf(process(args[0]));
      },
    },
    codeSize: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('address.codeSize()', 1, args);

        return s.codeSize(process(args[0]));
      },
    },
    codeHash: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('address.codeHash()', 1, args);

        return s.codeHash(process(args[0]));
      },
    },
    isContract: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('address.isContract()', 1, args);

        return s.isContract(process(args[0]));
      },
    },
    isEOA: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('address.isEOA()', 1, args);

        return s.isEOA(process(args[0]));
      },
    },
  },

  // contract.call(target, value, calldata)             — raw external call
  //   target 'svm': contract.call(target, calldata, accounts[]) — accounts is an
  //   array literal of string refs / {ref, writable?, signer?} objects / raw indices
  // contract.static(target, calldata)                  — raw static call (read-only)
  //   target 'svm': contract.static(target, calldata, accounts[]) — alias of call
  // contract.delegate(target, calldata)                — raw delegate call (not on 'svm')
  // contract.create(value, bytecode)                   — deploy contract with CREATE
  // contract.create2(value, salt, bytecode)            — deploy contract with CREATE2
  // contract.create3(value, salt, bytecode)            — deploy contract with CREATE3
  // contract.predictCreate(deployer, nonce)            — predict CREATE address
  // contract.predictCreate2(deployer, salt, codeHash)  — predict CREATE2 address
  // contract.predictCreate3(salt)                      — predict CREATE3 address
  contract: {
    call: {
      kind: 'dynamic',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('contract.call', 3, args);

        if (s.ctx.isSvm) {
          const target = process(args[0]);
          const calldata = process(args[1]);

          return (s as V12Saucer).svmCall(target, calldata, svmAccountsArray('contract.call', args[2], s.ctx));
        }

        assertAccountsListNotOnEvm('contract.call', args[2], s.ctx);

        return s.externalCall(process(args[0]), process(args[1]), process(args[2]));
      },
    },
    static: {
      kind: 'dynamic',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        if (s.ctx.isSvm) {
          expectArity('contract.static', 3, args);
          const target = process(args[0]);
          const calldata = process(args[1]);

          return (s as V12Saucer).svmStaticCall(target, calldata, svmAccountsArray('contract.static', args[2], s.ctx));
        }

        // Check the accounts-list shape BEFORE the arity check below: a 3rd argument
        // shaped like an svm accounts list should get the target-named capability
        // error, not the generic "expects 2 argument(s), got 3".
        assertAccountsListNotOnEvm('contract.static', args[2], s.ctx);

        expectArity('contract.static', 2, args);

        return s.staticCall(process(args[0]), process(args[1]));
      },
    },
    delegate: {
      kind: 'dynamic',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        assertCapability(s.ctx, 'delegatecall');

        expectArity('contract.delegate', 2, args);

        return s.delegateCall(process(args[0]), process(args[1]));
      },
    },
    create: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('contract.create', 2, args);

        return s.create(process(args[0]), process(args[1]));
      },
    },
    create2: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('contract.create2', 3, args);

        return s.create2(process(args[0]), process(args[1]), process(args[2]));
      },
    },
    create3: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('contract.create3', 3, args);

        return s.create3(process(args[0]), process(args[1]), process(args[2]));
      },
    },
    predictCreate: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('contract.predictCreate', 2, args);

        return s.createAddress(process(args[0]), process(args[1]));
      },
    },
    predictCreate2: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('contract.predictCreate2', 3, args);

        return s.create2Address(process(args[0]), process(args[1]), process(args[2]));
      },
    },
    predictCreate3: {
      kind: 'scalar',
      compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
        expectArity('contract.predictCreate3', 1, args);

        return s.create3Address(process(args[0]));
      },
    },
  },
};

// Standalone global functions (called without a namespace).
//
// gasLeft()              — remaining gas
// blockHash(blockNumber) — hash of the given block (0 for current or too old)
//   blockHash(block.number - 1)
// blobHash(index)        — versioned hash of the blob at index (EIP-4844)
//   blobHash(0)
// eval(code)             — compile and execute JS code at runtime
//   eval("return 42")
//   eval("let x = 10; return x * 2")
//   Code is compiled at compile-time; argument must be a string literal.
//   If code contains `function main`, it's compiled as-is; otherwise wrapped.
export const GLOBAL_FUNCTIONS: Record<string, GlobalDef> = {
  gasLeft: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], _process: (e: Expression) => SaucerLike) => {
      expectArity('gasLeft()', 0, args);

      return s.gasLeft();
    },
  },
  blockHash: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      expectArity('blockHash()', 1, args);

      return s.blockHash(process(args[0]));
    },
  },
  blobHash: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      expectArity('blobHash()', 1, args);

      return s.blobHash(process(args[0]));
    },
  },
  // emit(signature, data?, ...indexedFields) — emit a Solidity-style event
  //   emit("Ping()")  — event with no fields
  //   emit("Foo(uint256)", {value: 42})  — event with data
  //   emit("Transfer(address,address,uint256)", {from, to, value}, "from", "to")  — with indexed
  emit: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      const { signature, fields, indexedNames } = parseEmitArgs(args);
      const topics = buildTopics(s, signature, fields, indexedNames, process);
      const data = buildData(s, fields, indexedNames, process);

      return s.log(data, topics);
    },
  },
  eval: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      expectArity('eval()', 1, args);

      // String literal: compile at compile time
      if (args[0].type === 'Literal' && typeof (args[0] as Literal).value === 'string') {
        const code = (args[0] as Literal).value as string;
        const source = /function\s+main\s*\(/.test(code) ? code : `function main() { ${code} }`;
        // Compile the nested program for the SAME target as the enclosing one, so
        // the EVAL'd bytecode matches the engine it will run on (v1 vs v12/svm).
        const { bytecode, accountPlan } = compile(source, { target: s.ctx.target });

        // svm: the nested compile has its OWN account registry, so a ref interned
        // inside eval'd code would silently miss the outer account plan (and EVAL
        // runs in static mode — no CPI). Reject refs; plain eval'd compute is fine.
        if (accountPlan && accountPlan.metas.length > 0) {
          throw new Error(`account refs inside eval() are not supported on target 'svm'`);
        }

        // Raw numeric indices inside eval'd code read the OUTER instruction's
        // account list (EVAL shares it) — propagate raw mode so mixing with the
        // enclosing program's symbolic refs still fails loud.
        if (accountPlan?.usesRawIndices) s.ctx.useRawAccountIndex();

        return s.eval(s.ctx.newSaucer().bytes(bytecode[0]));
      }

      // Dynamic: pass runtime bytecodes to EVAL opcode
      return s.eval(process(args[0]));
    },
  },
  // uint(data) — scalar from dynamic bytes read in the PLATFORM's byte order:
  //   EVM bytes are big-endian, Solana account bytes are little-endian, and the
  //   native cast reads each correctly (len ≤ 32, len 0 → 0). A LOWERING
  //   divergence (see svm-profile.ts): the same source emits CAST_BE (0x54) on
  //   target 'v12' and CAST_LE (0x55) on 'svm'. Not on 'v1' — the v1 engine
  //   implements the cast ops, but its Saucer builder has no cast surface.
  //   uint(accountData('pool', 64, 8))
  uint: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      assertCapability(s.ctx, 'uint', args[0]);

      expectArity('uint', 1, args);

      const data = process(args[0]);

      return s.ctx.isSvm ? (s as V12Saucer).castLe(data) : (s as V12Saucer).castBe(data);
    },
  },
  // accountData(ref, offset, len) — svm-only: read len bytes at offset from the
  //   ref'd account's data (ref interned READONLY into the account plan) → bytes
  //   accountData('pool', 0, 32)
  //   accountData(2, 8, 16)  — raw user-account index (escape hatch)
  // writeAccountData(ref, offset, value) — svm-only: write the value bytes at
  //   offset into the ref'd account's data (ref interned WRITABLE); returns nothing
  //   writeAccountData('vault', 0, abi.encode(42))
  accountData: {
    kind: 'dynamic',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      assertCapability(s.ctx, 'accountData', args[0]);

      expectArity('accountData', 3, args);

      const index = svmAccountRef('accountData', args[0], s.ctx);

      return (s as V12Saucer).svmAccountData(index, process(args[1]), process(args[2]));
    },
  },
  writeAccountData: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      assertCapability(s.ctx, 'writeAccountData', args[0]);

      expectArity('writeAccountData', 3, args);

      const index = svmAccountRef('writeAccountData', args[0], s.ctx, { writable: true });

      return (s as V12Saucer).svmWriteAccountData(index, process(args[1]), process(args[2]));
    },
  },
  // accountUint(ref, offset, width) — svm-only sugar for
  //   uint(accountData(ref, offset, width)): read a width-byte account field as
  //   a scalar in one op (lowers to CAST_LE, uint's svm-native cast). width
  //   must be an integer literal 1-32.
  //   accountUint('token', 64, 8)  — SPL token account amount (u64 LE)
  accountUint: {
    kind: 'scalar',
    compile: (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => {
      assertCapability(s.ctx, 'accountUint', args[0]);

      return (s as V12Saucer).castLe(svmAccountUintData('accountUint', s, args, process));
    },
  },
};

export const RESERVED_NAMES: Set<string> = new Set([...Object.keys(GLOBALS), ...Object.keys(GLOBAL_FUNCTIONS)]);

# Sauce Compiler

Compiles SauceScript to Sauce bytecode for the EVM. SauceScript is a subset of JavaScript designed for writing smart contract logic.

## Installation

```bash
pnpm install sauce-compiler
```

## Usage

```typescript
import { compile } from 'sauce-compiler';

const source = `
  function main() {
    return 42;
  }
`;

const { bytecode } = compile(source);
// bytecode[0] contains the compiled Sauce bytecode
```

### Compiler Options

```typescript
const { bytecode } = compile(source, {
  baseDirs: ['./artifacts'], // directories to search for contract JSON imports
  target: 'v1', // bytecode target: 'v1' (default) or 'v12'
});
```

### Bytecode Target (`v1` / `v12`)

The same SauceScript compiles to two bytecode formats:

- **`v1` (default)** — prefix/tree bytecode (`[OP][a][b]`) for the Solidity interpreter
  engine. Variables live in slot memory. Functions are returned as separate segments
  in `bytecode[]`.
- **`v12`** — postfix/stack bytecode (`[a][b][OP]`) for the gas-efficient Huff runtime
  (`engine-v12`). Function parameters live on the EVM stack (read via `SDUP`, written via
  `SSWAP`+`SDROP`); local `let`/`const` still use slot memory. All functions are assembled
  into a **single** blob — `bytecode` is a one-element array `[main · STOP · helpers…]` with
  `CALL_FUNCTION` offsets and parameter `SDUP` depths resolved at assembly.

```typescript
const { bytecode } = compile('function main(){ return 1n + 2n }', { target: 'v12' });
// v12: 0101 0102 21 f2  (postfix: push 1, push 2, ADD, MSTORE)
// v1 : 21 0101 0102 00  (prefix:  ADD(1, 2), STOP)
```

Both targets share one processor and the per-type encoders; only the emitting builder differs
(`Saucer` vs `V12Saucer`, selected via `ctx.newSaucer()`). v12 byte-output is pinned against the
engine's Solidity `V12Saucer.sol` builder and executed on the real Huff runtime — see the
`v12-solidity-parity` and `v12-execution` integration suites (run against a full `engine-v12`
checkout via `SAUCE_ENGINE_V12=…`; they skip cleanly otherwise).

### With Contract Imports

```typescript
const source = `
  import { ERC20 } from "./ERC20.json";

  function main() {
    const token = 0x...n;
    return ERC20.at(token).balanceOf(msg.sender);
  }
`;

// Point to your Foundry/Hardhat artifact directories
const { bytecode } = compile(source, {
  baseDirs: ['./out', './artifacts'],
});
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format
```

## Quick Start

```javascript
function main() {
  return 42;
}
```

Every Sauce program needs a `main()` function - this is the entry point.

## Language Features

### Variables

```javascript
const x = 10; // constant (preferred)
let y = 20; // mutable
y = 30; // reassignment
```

### Numbers & Literals

```javascript
const a = 42; // integer
const b = 1000000000000000000n; // bigint (for large values)
const c = 0xff; // hex
const d = 0xdeadbeefn; // hex bigint
```

All numbers are 256-bit unsigned integers (like Solidity's `uint256`).

### Arithmetic

```javascript
const sum = a + b; // addition
const diff = a - b; // subtraction
const prod = a * b; // multiplication
const quot = a / b; // integer division (truncates)
const rem = a % b; // modulo
const pow = a ** b; // exponentiation
const root = Math.sqrt(a); // integer square root
```

### Bitwise Operations

```javascript
const and = a & b; // AND
const or = a | b; // OR
const xor = a ^ b; // XOR
const not = ~a; // NOT
const shl = a << 8; // left shift
const shr = a >> 8; // right shift
```

### Comparison & Boolean

```javascript
// Comparison (returns 1 for true, 0 for false)
a === b; // strict equality (required - no ==)
a !== b; // strict inequality (required - no !=)
a > b; // greater than
a < b; // less than
a >= b; // greater or equal
a <= b; // less or equal

// Logical
a && b; // AND
a || b; // OR
!a; // NOT
```

### Control Flow

```javascript
// if/else
if (condition) {
  // ...
} else if (other) {
  // ...
} else {
  // ...
}

// ternary
const x = condition ? valueIfTrue : valueIfFalse;

// throw (reverts execution)
throw 'error message';
```

### Loops

```javascript
// for loop
for (let i = 0; i < 10; i++) {
  sum += i;
}

// while loop
while (condition) {
  // ...
}

// infinite loops with break
for (;;) {
  if (done) break;
}

// loop controls
break;      // exit loop
continue;   // skip to next iteration
```

### Functions

```javascript
function add(a, b) {
  return a + b;
}

function max(a, b) {
  if (a > b) {
    return a; // early return supported
  }
  return b;
}

function main() {
  return add(10, max(5, 20)); // nested calls work
}
```

### Arrays

```javascript
const arr = [10, 20, 30];
const first = arr[0]; // index access
const len = arr.length; // length property
const i = 1;
const elem = arr[i]; // variable index

// Iteration
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}

// Multi-dimensional
const matrix = [
  [1, 2],
  [3, 4],
];
const inner = matrix[1];
const val = inner[0]; // 3

// Methods
const combined = arr.concat([40, 50]); // concatenate
const part = arr.slice(1, 3); // slice [start, end)
```

#### Element assignment & mutable arrays

`arr[i] = x` and `obj.field = x` mutate a collection in place, and `new Array(n)`
allocates a zero-initialized, mutable array of `n` slots:

```javascript
const a = new Array(3); // [0, 0, 0] — mutable
a[0] = 9; // element assignment
a[1] += 5; // compound assignment

const p = { x: 1, y: 2 };
p.x = 9; // object-literal field assignment (objects are mutable)
```

Mutation requires a **mutable collection** — one created with `new Array(n)` or an
object literal `{ ... }`. **Array literals (`[1, 2, 3]`) are immutable**: they are
packed by element width, and the engine reverts on element assignment. Assigning to
an element of an array literal is rejected at compile time — use `new Array(n)` and
fill it instead.

### Strings

```javascript
const s = 'hello';
const char = s[0]; // char code (104 for 'h')
const len = s.length; // 5

// Iteration
for (let i = 0; i < s.length; i++) {
  sum += s[i]; // sum of char codes
}

// Methods
const combined = 'hello'.concat(' world');
const part = s.slice(0, 3); // "hel"
```

### Bytes (Uint8Array)

```javascript
// Creation
const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const bytes2 = Uint8Array.from([1, 2, 3]);

// Access
const first = bytes[0]; // 0xde (222)
const len = bytes.length; // 4

// Methods
const combined = bytes.concat(bytes2);
const part = bytes.slice(1, 3);
```

### Structs (Objects)

```javascript
const point = { x: 10, y: 20 };
const px = point.x; // 10

// Shorthand
const x = 5;
const obj = { x }; // { x: 5 }

// Nested
const nested = { outer: { inner: 42 } };
const val = nested.outer.inner;

// Arrays of structs
const items = [{ val: 1 }, { val: 2 }];
const first = items[0];
const v = first.val;

// Note: fields are sorted alphabetically for ABI encoding
```

An object can also be passed as a `main()` argument (`compile(src, { args: [{ … }] })`).
It is encoded as a TUPLE with fields sorted alphabetically — byte-identical to an
in-script object literal — so `main(cfg)` reads its fields with `cfg.field` (and nested
`cfg.child.field`) via the same field-index lowering. Works on both the v1 and v12
targets. Not supported for staged SVM args (ABI-encode into a bytes arg instead).

### Increment/Decrement

```javascript
let x = 5;
x++; // postfix: returns 5, x becomes 6
++x; // prefix: x becomes 7, returns 7
x--; // postfix: returns 7, x becomes 6
--x; // prefix: x becomes 5, returns 5

// Compound assignment
x += 10; // x = x + 10
x -= 5; // x = x - 5
x *= 2; // x = x * 2
```

## Blockchain Globals

### Transaction Context

```javascript
msg.sender; // caller address
msg.value; // wei sent with call
msg.data; // raw calldata (bytes)

tx.origin; // transaction originator
tx.gasPrice; // gas price
```

### Block Context

```javascript
block.number; // current block number
block.timestamp; // seconds since epoch
block.chainId; // chain ID (1 = mainnet, 31337 = anvil)
block.coinbase; // miner/validator address
block.prevrandao; // RANDAO value
block.gasLimit; // block gas limit
block.baseFee; // EIP-1559 base fee
block.blobBaseFee; // EIP-4844 blob base fee
```

### Address Utilities

```javascript
address.self; // this contract's address
address.balance; // this contract's ETH balance
address.balanceOf(addr); // ETH balance of addr
address.codeSize(addr); // code size in bytes
address.codeHash(addr); // keccak256 of code
address.isContract(addr); // 1 if has code, 0 otherwise
address.isEOA(addr); // 1 if no code, 0 otherwise
```

### Other Functions

```javascript
gasLeft(); // remaining gas
blockHash(block.number - 1); // hash of recent block
blobHash(0); // EIP-4844 blob hash
```

## Storage

```javascript
// Persistent storage (survives transactions)
storage.write(slot, value); // store value at slot
storage.read(slot); // load value from slot

// Transient storage (cleared after transaction, EIP-1153)
storage.tWrite(key, value); // store transiently
storage.tRead(key); // load transient value
```

## Cryptography

```javascript
// Keccak256 hash
crypto.keccak256(data); // hash bytes or string

// ECDSA signature verification
crypto.ecdsaVerify(signer, hash, signature); // returns 1 if valid
```

## ABI Encoding/Decoding

```javascript
// Encode
abi.encode(42); // single value
abi.encode(1, 'hello', [10, 20]); // multiple values
abi.encode({ id: 1, name: 'alice' }); // struct

// Decode
abi.decode(data, 'uint256'); // single type
abi.decode(data, 'uint256', 'string'); // multiple types
abi.decode(data, { id: 'uint256', name: 'string' }); // struct
abi.decode(data, ['uint256']); // array type

// Supported types: uint8-uint256, bool, address, bytes, string
```

## Contract Deployment

```javascript
// Deploy contracts
contract.create(value, bytecode); // CREATE
contract.create2(value, salt, bytecode); // CREATE2
contract.create3(value, salt, bytecode); // CREATE3

// Predict addresses
contract.predictCreate(deployer, nonce); // CREATE address
contract.predictCreate2(deployer, salt, codeHash); // CREATE2 address
contract.predictCreate3(salt); // CREATE3 address
```

## External Contract Calls

Import contract ABIs from JSON files (Foundry/Hardhat artifacts):

```javascript
import { ERC20 } from "./ERC20.json";

function main() {
  const token = 0x...n;  // token address

  // View calls (STATICCALL)
  const balance = ERC20.at(token).balanceOf(msg.sender);

  // State-changing calls (CALL)
  ERC20.at(token).transfer(recipient, amount);

  // Multiple return values — destructure them (ONE external call)
  const [first, second] = Contract.at(addr).getMultiple();

  // Holes skip outputs you don't need
  const [, tick] = Pool.at(pool).slot0();

  // Inline chained indexing also works (each chain is its own call)
  const third = Contract.at(addr).getMultiple()[2];
}
```

**Multi-output results and variables (v1):** a multi-output call result stored in
a variable (`const s = pool.slot0()`) loses its tuple on the deployed v1 engine,
so indexing it (`s[0]`) is a compile error — use destructuring instead, which
never stores the decoded tuple (the raw returndata lands in a hidden temp and
each bound element is re-decoded at its store site). Destructuring supports
holes, partial bindings, and `bytes`/`string`/array components; nested-tuple
components can't be bound to a variable — leave a hole and read their fields via
chained indexing (`…wrap()[1][0]`). Rest elements (`...rest`) are not supported.

### Binding Methods

```javascript
// .at(addr) - uses CALL for writes, STATICCALL for views
const token = ERC20.at(tokenAddr);
token.transfer(to, amount); // CALL
token.balanceOf(addr); // STATICCALL

// .view(addr) - always STATICCALL
const readOnly = ERC20.view(tokenAddr);
readOnly.balanceOf(addr); // STATICCALL

// .lib(addr) - always DELEGATECALL
const lib = Library.lib(libAddr);
lib.compute(x); // DELEGATECALL
```

### Error Handling (.catch)

```javascript
// Handle reverts without failing
let failed = 0;
ERC20.at(token)
  .transfer(to, amount)
  .catch(() => {
    failed = 1;
  });

// Empty handler to ignore errors
ERC20.at(token)
  .riskyCall()
  .catch(() => {});

// Handler can have multiple statements
Contract.at(addr)
  .call()
  .catch(() => {
    errorCount += 1;
    lastError = 1;
  });
```

## Events

```javascript
// Simple event
emit('Ping()');

// Event with data
emit('Transfer(uint256)', { value: 42 });

// Event with indexed fields (up to 3)
emit(
  'Transfer(address,address,uint256)',
  { from: sender, to: recipient, value: amount },
  'from',
  'to', // indexed field names
);
```

## Dynamic Code Execution

```javascript
// Execute code at runtime (compiled at compile-time)
const result = eval('return 42');
const sum = eval('let x = 10; return x + 5');

// With full function
eval('function main() { return 99; }');
```

Note: The argument must be a string literal - it's compiled at compile-time.

## Import Syntax

```javascript
// Named import
import { ERC20 } from './ERC20.json';

// Aliased import
import { ERC20 as Token } from './ERC20.json';

// Default import
import ERC20 from './ERC20.json';
```

## Not Supported (JavaScript features not in SauceScript)

- Classes
- Async/await
- Closures
- `var` declarations
- `==` and `!=` (use `===` and `!==`)
- `typeof`, `instanceof`
- Regular expressions
- Destructuring
- Spread operator
- Arrow functions (except in `.catch()` handlers)
- `try/catch` (use `.catch()` on contract calls)
- Floating point numbers
- Negative numbers (use two's complement)

## Why SauceScript?

SauceScript provides familiar JavaScript syntax while targeting the EVM. Key differences from JavaScript:

- **All numbers are uint256** - No floating point, no negative numbers (use two's complement)
- **No dynamic typing** - Variables have fixed types at compile time
- **No closures** - Functions can't capture outer scope
- **Strict equality only** - Must use `===` and `!==`
- **EVM-native features** - Direct access to blockchain state, storage, and contract calls

## Cross-target divergences

The same SauceScript source compiles for multiple targets (`v1`, `v12`/EVM, and the `svm` v12
dialect). Where those targets can produce *different* observable output for one program, one rule
decides how the divergence is handled — adopted from the Rust `compiler-rs` policy so the two
compilers converge:

> **Divergence-resolution rule (normative).**
> - **MUST reconcile in the compiler** when the *meaning* is shared and only the *encoding* differs.
>   The construct keeps **one** name/spelling; codegen emits the per-target bytes. (e.g. `keccak256`,
>   `Math.*`, `abi.encode` layout, array element boxing.)
> - **MAY namespace as two gated features** only when the construct names a **target-specific
>   concept with no counterpart** on the other target — same underlying opcode byte, genuinely
>   divergent operand shape/semantics. Each is gated by its own capability. (e.g.
>   `evm.sload`/`svm.sload`, `evm.call`/`svm.call`.)
> - A divergence discharged by *reconciling* it is **removed** from the registry below; one kept as
>   *two features* stays, recording **why** the two builtins exist. Never split a shared-meaning
>   construct into two names — that is a rename, not a resolution.

This is what decides *which* names move in the `evm.*`/`svm.*` split (Part 1 §1.3): `keccak256` and
`Math.*` must **not** be namespaced (shared meaning); `sload`/`sstore`/`call` must be (same opcode,
divergent semantics).

### Registry — how EVM/SVM (and v1) output of one program can differ

A living table, each row with a **disposition** (reconcile / two features / inherent). Seeded from
the divergences the repo `CLAUDE.md` documents in prose; extend it as new ones are found. (Mirrors
the Rust compiler's own `README.md` registry so the two can be diffed.)

| Divergence | Detail | Disposition |
|---|---|---|
| **Nested static array literal** (`[[…],[…]]`) | Works on v1 (all forms); on v12/svm the static encoding is absent — `assertNoNestedArrayLiteral` (`K12`) rejects at compile time, pointing at the `new Array(n)` alternative. A flat literal and a `new Array`-nested structure work on all targets. | inherent (engine gap) — reconcile once v12/svm gains nested-array static encoding |
| **Object-literal field reading an existing dynamic var** (`{a: dynLocal}`) | Silently returned a raw heap-descriptor artifact on BOTH v1 and v12; now `assertNoDynamicVariableObjectField` (`K13`) rejects. A *directly-constructed* dynamic value at the field is fine. | reconcile — compile-time rejection until a real re-embed lowering exists |
| **Dynamic value stored via a scalar (VALUE) slot** | On v1 a descriptor stored in a value slot is destroyed (`WRITE_VALUE` drops `ctx.dynamicResult`); v12/svm carry the descriptor in-band in one 32-byte word, so it round-trips. Whole `K`-family (return-kind inference, `rejectV1ScalarToDynamicReassignment`, …) exists to protect the v1 invariant. | inherent (v1 memory model) — port the **invariant** (a dynamic value must never round-trip a scalar slot), not the machinery; MOOT for RS (no v1 target) |
| **`.length` of a dynamic value through a parameter** | v1 silently reads the scalar word width (`32`) instead of the real length — no revert; v12/svm read the correct length via the ordinary stack parameter. | inherent (v1 `funcHeap`/`funcValues` split) — v1-only, MOOT for RS |
| **ERC20 `bool` return of a non-reverting-`false` token** | The `bool` is discarded in the ABI-aware path (no returndatasize op to express SafeERC20), so a false-returning token "succeeds"; an `svm.call` CPI reverts on a failed transfer. | reconcile — revisit once a returndatasize op exists |
| **Dynamic-data pointer ceiling** | v12 descriptor pointer was 16-bit (~45 KB) → truncation past it; widened to 32-bit upstream (sauce `#323`). EVM quadratic gas now bounds it in practice. | reconciled in kind (both abort loudly); degree asymmetry documented |
| **`ctx.chainId()` / `ctx.blockNumber()` / balances / timestamp** | chain-specific value; SVM slot-height vs EVM block-height; wei vs lamports; SVM reverts off-chain. | inherent — won't-fix; one spelling, chain-defined value |

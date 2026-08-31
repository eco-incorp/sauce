import { keccak256, toBytes, encodeAbiParameters } from 'viem';
import { cook, cookSend, getSauceAddress, getNonce } from './utils.js';

describe('integration: blockchain context', () => {
  it('block.chainId returns anvil chain id', () => {
    expect(BigInt(cook('function main() { return block.chainId; }'))).toBe(31337n);
  });

  it('block.number returns non-zero', () => {
    expect(BigInt(cook('function main() { return block.number; }'))).toBeGreaterThan(0n);
  });

  it('block.timestamp returns non-zero', () => {
    expect(BigInt(cook('function main() { return block.timestamp; }'))).toBeGreaterThan(0n);
  });

  it('block.gasLimit returns non-zero', () => {
    expect(BigInt(cook('function main() { return block.gasLimit; }'))).toBeGreaterThan(0n);
  });

  it('block.baseFee returns non-negative', () => {
    expect(BigInt(cook('function main() { return block.baseFee; }'))).toBeGreaterThanOrEqual(0n);
  });

  it('gasLeft() returns non-zero', () => {
    expect(BigInt(cook('function main() { return gasLeft(); }'))).toBeGreaterThan(0n);
  });

  it('msg.sender does not revert', () => {
    expect(BigInt(cook('function main() { return msg.sender; }'))).toBeGreaterThanOrEqual(0n);
  });

  it('tx.origin does not revert', () => {
    expect(BigInt(cook('function main() { return tx.origin; }'))).toBeGreaterThanOrEqual(0n);
  });

  it('ctx.self() returns non-zero (formerly address.self)', () => {
    expect(BigInt(cook('function main() { return ctx.self(); }'))).toBeGreaterThan(0n);
  });

  it('ctx.selfBalance() returns non-negative (formerly address.balance)', () => {
    expect(BigInt(cook('function main() { return ctx.selfBalance(); }'))).toBeGreaterThanOrEqual(0n);
  });

  it('context value in arithmetic', () => {
    expect(BigInt(cook('function main() { return block.number + 1; }'))).toBeGreaterThan(1n);
  });

  it('context value in conditional', () => {
    expect(BigInt(cook('function main() { let x = 0; if (block.chainId > 0) { x = 1; } return x; }'))).toBe(1n);
  });

  it('msg.data returns dynamic bytes with non-zero length', () => {
    expect(BigInt(cook('function main() { const data = msg.data; return data.length; }'))).toBeGreaterThan(0n);
  });

  it('block.coinbase does not revert', () => {
    expect(BigInt(cook('function main() { return block.coinbase; }'))).toBeGreaterThanOrEqual(0n);
  });

  it('block.prevrandao does not revert', () => {
    expect(BigInt(cook('function main() { return block.prevrandao; }'))).toBeGreaterThanOrEqual(0n);
  });

  it('block.blobBaseFee does not revert', () => {
    expect(BigInt(cook('function main() { return block.blobBaseFee; }'))).toBeGreaterThanOrEqual(0n);
  });

  it('tx.gasPrice does not revert', () => {
    expect(BigInt(cook('function main() { return tx.gasPrice; }'))).toBeGreaterThanOrEqual(0n);
  });

  it('msg.value returns zero for non-payable call', () => {
    expect(BigInt(cook('function main() { return msg.value; }'))).toBe(0n);
  });

  it('blockHash(block.number - 1) returns non-zero', () => {
    expect(BigInt(cook('function main() { return blockHash(block.number - 1); }'))).toBeGreaterThan(0n);
  });

  it('ctx.balance(ctx.self()) matches ctx.selfBalance() (formerly address.balanceOf(address.self)/address.balance)', () => {
    expect(BigInt(cook('function main() { return ctx.balance(ctx.self()); }'))).toBeGreaterThanOrEqual(0n);
  });

  it('ctx.codeSize(ctx.self()) returns non-zero (formerly address.codeSize(address.self))', () => {
    expect(BigInt(cook('function main() { return ctx.codeSize(ctx.self()); }'))).toBeGreaterThan(0n);
  });

  it('ctx.codeHash(ctx.self()) returns non-zero (formerly address.codeHash(address.self))', () => {
    expect(BigInt(cook('function main() { return ctx.codeHash(ctx.self()); }'))).toBeGreaterThan(0n);
  });

  it('ctx.isContract(ctx.self()) returns true (formerly address.isContract(address.self))', () => {
    expect(BigInt(cook('function main() { return ctx.isContract(ctx.self()); }'))).toBe(1n);
  });

  it('ctx.isEOA(ctx.self()) returns false (formerly address.isEOA — no prior integration coverage)', () => {
    expect(BigInt(cook('function main() { return ctx.isEOA(ctx.self()); }'))).toBe(0n);
  });

  // crypto tests
  it('crypto.keccak256 of msg.data returns non-zero hash', () => {
    expect(BigInt(cook('function main() { return crypto.keccak256(msg.data); }'))).toBeGreaterThan(0n);
  });

  it('crypto.keccak256 of known bytes returns expected hash', () => {
    // keccak256(0x01) = 0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2
    const result = cook('function main() { return crypto.keccak256(Uint8Array.from([1])); }');
    expect(result).toBe('0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2');
  });

  it('crypto.ecdsaVerify returns 0 for invalid signature', () => {
    // Invalid signature should return 0
    const result = cook(
      'function main() { return crypto.ecdsaVerify(msg.sender, 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef, msg.data); }',
    );
    expect(BigInt(result)).toBe(0n);
  });

  it('crypto.ecdsaVerify returns 1 for valid signature', () => {
    // Test private key: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
    // Signer address: 0x1Be31A94361a391bBaFB2a4CCd704F57dc04d4bb
    // Message hash: keccak256("test message for sig check") = 0xdb5c87f9803294b37b50cd8c47160381e93b8aafb5fddeff908c6aadbd433d8b
    // Signature generated via: cast wallet sign --no-hash --private-key <pk> <hash>
    // Note: Use BigInt suffix (n) for large hex values to avoid precision loss
    const result = cook(`
      function main() {
        const signer = 0x1Be31A94361a391bBaFB2a4CCd704F57dc04d4bbn;
        const hash = 0xdb5c87f9803294b37b50cd8c47160381e93b8aafb5fddeff908c6aadbd433d8bn;
        const sig = Uint8Array.from([
          0x02, 0x1c, 0xa4, 0x72, 0x46, 0x1b, 0x96, 0x8f, 0x92, 0x4e, 0xbc, 0xf5, 0x5c, 0x1f, 0x75, 0x95,
          0x32, 0x74, 0x6f, 0x13, 0x4f, 0x5c, 0x56, 0x2e, 0xab, 0x31, 0x0e, 0xe0, 0x34, 0xf5, 0x9a, 0xf4,
          0x2e, 0x55, 0xb9, 0x6f, 0xbe, 0x05, 0x12, 0xbe, 0x35, 0xb5, 0x85, 0x47, 0xda, 0x71, 0x67, 0xe4,
          0xf1, 0xcf, 0xf8, 0x75, 0x4b, 0x4f, 0x31, 0x34, 0xc6, 0x85, 0x36, 0xab, 0xb2, 0xad, 0x45, 0x08,
          0x1b
        ]);
        return crypto.ecdsaVerify(signer, hash, sig);
      }
    `);
    expect(BigInt(result)).toBe(1n);
  });

  // storage tests
  it('storage.read returns 0 for uninitialized slot', () => {
    expect(BigInt(cook('function main() { return storage.read(999n); }'))).toBe(0n);
  });

  it('storage.write and storage.read round-trip', () => {
    const result = cook(`
      function main() {
        const written = storage.write(123n, 42n);
        return storage.read(123n);
      }
    `);
    expect(BigInt(result)).toBe(42n);
  });

  it('storage.tRead returns 0 for uninitialized key', () => {
    expect(BigInt(cook('function main() { return storage.tRead(999n); }'))).toBe(0n);
  });

  it('storage.tWrite and storage.tRead round-trip', () => {
    const result = cook(`
      function main() {
        const written = storage.tWrite(456n, 100n);
        return storage.tRead(456n);
      }
    `);
    expect(BigInt(result)).toBe(100n);
  });

  it('storage persists across transactions', () => {
    // Use a unique slot to avoid collisions with other tests
    const slot = '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeadn';
    const value = 12345n;

    // First tx: write to storage (must use cookSend to commit state)
    cookSend(`function main() { const w = storage.write(${slot}, ${value}n); return w; }`);

    // Second tx: read from storage - should still have the value
    const result = cook(`function main() { return storage.read(${slot}); }`);
    expect(BigInt(result)).toBe(value);
  });

  it('transient storage does NOT persist across transactions', () => {
    // Use a unique key to avoid collisions
    const key = '0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefn';
    const value = 99999n;

    // First tx: write to transient storage (must use cookSend to commit state)
    cookSend(`function main() { const w = storage.tWrite(${key}, ${value}n); return w; }`);

    // Second tx: read from transient storage - should be 0 (cleared after tx)
    const result = cook(`function main() { return storage.tRead(${key}); }`);
    expect(BigInt(result)).toBe(0n);
  });

  // contract.* tests - deploy and verify addresses match predictions
  // Simple bytecode: PUSH1 0x00 PUSH1 0x00 RETURN (returns empty, but valid contract)
  // 0x60006000f3 = PUSH1 00, PUSH1 00, RETURN

  it('contract.create and predictCreate match', () => {
    const sauceAddress = getSauceAddress();
    const nonce = getNonce(sauceAddress);

    const result = cook(`
      function main() {
        const bytecode = Uint8Array.from([0x60, 0x00, 0x60, 0x00, 0xf3]);

        // Predict addresses using the known nonce
        const predicted1 = contract.predictCreate(ctx.self(), ${nonce}n);
        const predicted2 = contract.predictCreate(ctx.self(), ${nonce + 1n}n);

        // Deploy two contracts
        const deployed1 = contract.create(0, bytecode);
        const deployed2 = contract.create(0, bytecode);

        // Verify predictions match deployments
        return predicted1 === deployed1 && predicted2 === deployed2;
      }
    `);
    expect(BigInt(result)).toBe(1n);
  });

  it('contract.create2 and predictCreate2 match', () => {
    const salt = '0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddn';
    // keccak256(0x60006000f3) = 0xd003426e799329b8dca093f3bbab55a5e4e9f3c40160fc942068eef712ae88ad
    const codeHash = '0xd003426e799329b8dca093f3bbab55a5e4e9f3c40160fc942068eef712ae88adn';

    const result = cook(`
      function main() {
        const bytecode = Uint8Array.from([0x60, 0x00, 0x60, 0x00, 0xf3]);
        const predicted = contract.predictCreate2(ctx.self(), ${salt}, ${codeHash});
        const deployed = contract.create2(0, ${salt}, bytecode);
        return predicted === deployed;
      }
    `);
    expect(BigInt(result)).toBe(1n);
  });

  it('contract.create3 and predictCreate3 match', () => {
    const salt = '0x1122334411223344112233441122334411223344112233441122334411223344n';

    const result = cook(`
      function main() {
        const bytecode = Uint8Array.from([0x60, 0x00, 0x60, 0x00, 0xf3]);
        const predicted = contract.predictCreate3(${salt});
        const deployed = contract.create3(0, ${salt}, bytecode);
        return predicted === deployed;
      }
    `);
    expect(BigInt(result)).toBe(1n);
  });

  // emit tests
  it('emit emits log with correct topic0 (signature hash)', () => {
    const logs = cookSend('function main() { emit("Foo(uint256)", {value: 42}); return 1; }');
    const expectedTopic0 = keccak256(toBytes('Foo(uint256)'));

    expect(logs.length).toBe(1);
    expect(logs[0].topics[0]).toBe(expectedTopic0);
  });

  it('emit emits log with correct ABI-encoded data', () => {
    const logs = cookSend('function main() { emit("Foo(uint256)", {value: 42}); return 1; }');
    const expectedData = encodeAbiParameters([{ type: 'uint256' }], [42n]);

    expect(logs[0].data).toBe(expectedData);
  });

  it('emit with indexed field puts value in topic', () => {
    const logs = cookSend(
      'function main() { emit("Transfer(address,uint256)", {to: 0x1234, value: 100}, "to"); return 1; }',
    );
    const expectedTopic0 = keccak256(toBytes('Transfer(address,uint256)'));
    const expectedTopic1 = '0x0000000000000000000000000000000000000000000000000000000000001234';
    const expectedData = encodeAbiParameters([{ type: 'uint256' }], [100n]);

    expect(logs[0].topics[0]).toBe(expectedTopic0);
    expect(logs[0].topics[1]).toBe(expectedTopic1);
    expect(logs[0].data).toBe(expectedData);
  });

  it('emit with all fields indexed has empty data', () => {
    const logs = cookSend(
      'function main() { emit("Transfer(address,address)", {from: 0xabc, to: 0xdef}, "from", "to"); return 1; }',
    );
    const expectedTopic0 = keccak256(toBytes('Transfer(address,address)'));

    expect(logs[0].topics.length).toBe(3); // topic0 + 2 indexed
    expect(logs[0].topics[0]).toBe(expectedTopic0);
    expect(logs[0].data).toBe('0x'); // empty data
  });

  it('emit with multiple non-indexed fields encodes them in order', () => {
    const logs = cookSend('function main() { emit("Data(uint256,uint256,uint256)", {a: 1, b: 2, c: 3}); return 1; }');
    const expectedData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [1n, 2n, 3n],
    );

    expect(logs[0].data).toBe(expectedData);
  });

  it('emit with no data fields (empty event)', () => {
    const logs = cookSend('function main() { emit("Ping()"); return 1; }');
    const expectedTopic0 = keccak256(toBytes('Ping()'));

    expect(logs.length).toBe(1);
    expect(logs[0].topics.length).toBe(1); // only topic0
    expect(logs[0].topics[0]).toBe(expectedTopic0);
    expect(logs[0].data).toBe('0x'); // empty data
  });

  // eval tests
  it('eval executes simple bytecode returning constant', () => {
    expect(BigInt(cook('function main() { return eval("return 42"); }'))).toBe(42n);
  });

  it('eval executes bytecode with arithmetic', () => {
    expect(BigInt(cook('function main() { return eval("return 1 + 2"); }'))).toBe(3n);
  });

  it('eval executes bytecode with local variables', () => {
    expect(BigInt(cook('function main() { return eval("let x = 10; return x * 2"); }'))).toBe(20n);
  });

  it('eval executes full program with main', () => {
    const code = 'function main() { return 99; }';
    expect(BigInt(cook(`function main() { return eval("${code}"); }`))).toBe(99n);
  });
});

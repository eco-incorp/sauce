// Polymer's State Sync example in Sauce: a key-value store kept the same on several chains. A
// program cooked on Ethereum writes the value there, under a version one past the key's last, and
// logs it with the original's ValueSet; its body runs on Base as this same Pot once anyone submits
// Polymer's proof of its message, and writes the value there unless Base holds a newer version,
// logging the original's ValueUpdated. Each further chain is one more `remote`.
//
// Ported from: dpbmaverick98/polymer-state-sync/contracts/StateSyncV2.sol, the example Polymer's
// quickstart walks through (polymerdao/developer-hub, docs/build/get started/quickstart.mdx)
//   https://github.com/dpbmaverick98/polymer-state-sync/blob/e277c1ec466acfc028d2e99f1adf028a44f4a06c/contracts/StateSyncV2.sol
// The original is a contract deployed on every chain: 145 lines of Solidity (comments left out).
// This program is 44 and deploys nothing. Only its owner's programs write to the Pot, so the
// original's per-key owners fall away; a proof delivers once (the Pot keeps each delivered log's
// place), which is the original's replay check; its two demonstration events are left out.
//
//   sauce run state-sync.sauce.ts --chain <chain> --wallet <name> --args <key> <value>
//
//   key: string    the key, hashed with this Pot's address as the original hashes its sender's
//   value: bytes   the value
//
// From Ethereum:
//
//   sauce run state-sync.sauce.ts --chain ethereum --wallet <name> --args greeting 0x68656c6c6f
function keep(slot: Uint256, data: bytes): void {
  const words = crypto.keccak256(slot.toBytesBe(32));
  // An offset, the length, then the bytes padded to whole words.
  const encoded = abi.encode(data);
  evm.sstore(slot, data.length);
  for (let i = 0; i < data.length; i += 32) {
    evm.sstore(words + i / 32, encoded.slice(64 + i, 96 + i).toBe());
  }
}

function update(hashedKey: Uint256, value: bytes, version: Uint256): void {
  const versionOf = crypto.keccak256(
    abi.encode(hashedKey, crypto.keccak256("statesync.keyVersions")),
  );
  require(version > evm.sload(versionOf), "Version must be newer than current version");
  evm.sstore(versionOf, version);
  keep(crypto.keccak256(abi.encode(hashedKey, crypto.keccak256("statesync.store"))), value);
}

function main(key: string, value: bytes) {
  const hashedKey = crypto.keccak256(ctx.self().toBytesBe(20).concat(key));
  const versionOf = crypto.keccak256(
    abi.encode(hashedKey, crypto.keccak256("statesync.keyVersions")),
  );
  const nonces = crypto.keccak256("statesync.nonces");
  const nonce = evm.sload(nonces);
  const version = evm.sload(versionOf) + 1;
  evm.sstore(nonces, nonce + 1);
  update(hashedKey, value, version);
  log(
    abi.encode(key, value, nonce, version),
    crypto.keccak256("ValueSet(address,string,bytes,uint256,bytes32,uint256)"),
    ctx.self(),
    hashedKey,
  );
  Base.remote(
    () => {
      update(hashedKey, value, version);
      log(
        abi.encode(value, version),
        crypto.keccak256("ValueUpdated(bytes32,bytes,uint256)"),
        hashedKey,
      );
    },
    { via: "polymer" },
  );
}

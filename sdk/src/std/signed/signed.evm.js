// @sauce/signed — EVM arm.
//
// A program its owner signed, run on the owner's Private Pot by whoever submits it: a relayer that
// pays the gas, or the body of a hop that delivers funds to the Pot and runs the owner's program in
// the same fill. The Pot answers
//
//   execute(bytes program, bytes32 salt, uint256 deadline, bytes signature)
//
// with the program its owner registered for that selector (the Router's programmable fallback),
// `execute.handler.js`: it runs `program` as the Pot, with everything the Pot holds, if and only if
// the Pot's owner signed it, for this Pot, on this chain, with this salt, before the deadline.
//
// WHAT IS SIGNED. EIP-712 typed data, which any wallet signs (`eth_signTypedData_v4`):
//
//   domain   { name: "Sauce Pot", version: "1", chainId, verifyingContract: the Pot }
//   Execute  { program: bytes, salt: bytes32, deadline: uint256 }
//
// `program` is the compiled bytecode WITH its entry arguments appended, exactly the bytes that run,
// so nothing reaches the program that the owner did not sign.
//
// WHO SIGNED. The Pot's `owner()`. A 65-byte `r ‖ s ‖ v` signature is checked with
// `crypto.ecdsaVerify` (ecrecover), refusing first a malleable one (`s` in the upper half of the
// curve's order), which ecrecover accepts, and any `v` but 27 and 28. An owner with code is
// asked EIP-1271's `isValidSignature(digest, signature)` when that does not name it, with the
// signature as it is, of any length: a contract wallet, a multisig, a passkey account. This is
// OpenZeppelin's `SignatureChecker` order.
//
// ONCE EACH, IN ANY ORDER. Salts are Permit2's unordered nonces: a bitmap of one bit per salt, 256
// salts to a word, in the ERC-7201 namespace `sauce.storage.Signed`, the word for `salt >> 8` at
// `keccak256(abi.encode(salt >> 8, namespace))`. A salt's bit is set BEFORE the program runs, so the
// program cannot run itself again, and a revert anywhere unsets it with everything else. The owner
// cancels salts it signed and no longer wants run with `cancel` or `invalidate`, in a program it
// cooks.
//
// HOW IT RUNS. `evm.delegate(inFlightEngine, program)`: the program runs writable inside the
// handler's own cook, as the Pot, for the one Kitchen fee that cook paid from the Pot's balance. Its
// output is `execute`'s return data, raw.
//
// ONE SIGNATURE, SEVERAL CHAINS. `executeAcross` takes one signature over a list of executions, one
// per chain, for a flow that crosses them:
//
//   domain      { name: "Sauce Pot", version: "1", verifyingContract: the Pot }   (no chain)
//   Executions  { executions: Execution[] }
//   Execution   { chainId: uint256, program: bytes, salt: bytes32, deadline: uint256 }
//
// A Private Pot has the same address on every chain its owner mints it on, so the Pot is the
// domain on each. The caller submits this chain's execution and the EIP-712 hash of every one, in
// the order signed, and the index of this chain's: the Pot hashes its own and checks it sits there.
//
// THE POT AS A SIGNER. `isValidSignature(bytes32 hash, bytes signature)`, registered as a VIEW (a
// static run with no fee), answers EIP-1271 for the Pot with its owner's signature over
//
//   domain      { name: "Sauce Pot", version: "1", chainId, verifyingContract: the Pot }
//   PotMessage  { hash: bytes32 }
//
// and never over `hash` itself: a signature the owner made for its own account, or for another Pot
// it owns, is no signature of this Pot's, so a Permit2 permit signed for one is never spent from
// the other. Permit2, and any contract that checks signatures with EIP-1271, then takes the Pot as
// a signer.
//
// The calls are written out, selector and arguments, as the Pot declares them: `owner()`
// (0x8da5cb5b) and `inFlightEngine()` (0x9fd004e1), EIP-1271's `isValidSignature(bytes32,bytes)`
// (0x1626ba7e) and this package's own `execute(bytes,bytes32,uint256,bytes)` (0x82bf0988) and
// `executeAcross(bytes,bytes32,uint256,bytes32[],uint256,bytes)` (0xdf288b73). The SDK's tests
// derive each from its signature, and each EIP-712 hash from its type.

// The ERC-7201 namespace of the salt bitmap, in the Pot's storage:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Signed")) - 1)) & ~bytes32(uint256(0xff)).
const SAUCE_SIGNED_NAMESPACE = 0x445da62d53bdea9331f042175775dc985d50361ac56f5f57e8a11871d9d99500;

// keccak256 of each EIP-712 type and domain field.
// EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
const SAUCE_SIGNED_DOMAIN = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
// EIP712Domain(string name,string version,address verifyingContract)
const SAUCE_SIGNED_DOMAIN_ACROSS = 0x91ab3d17e3a50a9d89e63fd30b92be7f5336b03b287bb946787a83a9d62a2766;
// "Sauce Pot"
const SAUCE_SIGNED_NAME = 0x65e82c940f55e84d80e8c004a4c586bf80f61f10a7c0218cc8c7ca657f1e4edd;
// "1"
const SAUCE_SIGNED_VERSION = 0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6;
// Execute(bytes program,bytes32 salt,uint256 deadline)
const SAUCE_SIGNED_EXECUTE = 0x89e03dcfdebad3c03a97fd75644f624e7003c04209b5a9ff252fa9382dd6b1fa;
// Execution(uint256 chainId,bytes program,bytes32 salt,uint256 deadline)
const SAUCE_SIGNED_EXECUTION = 0x9859a820c2b89e30fbe7395e35a8eaf6d4e0bf861940d81f63f85eb813bd1f43;
// Executions(Execution[] executions)Execution(uint256 chainId,bytes program,bytes32 salt,uint256 deadline)
const SAUCE_SIGNED_EXECUTIONS = 0xba0c072019a30ebf425f382274e4c73194ddb72abaadf0fc36009f9a7240bfc9;
// PotMessage(bytes32 hash)
const SAUCE_SIGNED_MESSAGE = 0x285c77bc77dfca76b6f099853b19373bb19a687adfc951011417a67ac42dded3;

// The event `cancel` and `invalidate` log, from the Pot: SaltsCancelled(uint256 indexed word,
// uint256 mask).
const SAUCE_SIGNED_CANCELLED = 0xe05728d1293b5fedd7a46b6b6f775619d38197b8d6f15a4eeb539230f9067adb;

// Half the order of secp256k1: a signature's `s` above it is the malleable twin of one below.
const SAUCE_SIGNED_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

// ---- what is signed -------------------------------------------------------------------------------

// The Pot's EIP-712 domain on this chain.
export function domainSeparator(): Uint256 {
  return crypto.keccak256(
    abi.encode(
      SAUCE_SIGNED_DOMAIN,
      SAUCE_SIGNED_NAME,
      SAUCE_SIGNED_VERSION,
      ctx.chainId(),
      ctx.self(),
    ),
  );
}

// `structHash` under the Pot's domain on this chain: what its owner signs.
function typedDigest(domain: Uint256, structHash: Uint256): Uint256 {
  return crypto.keccak256(hex`1901`.concat(domain.toBytesBe(32), structHash.toBytesBe(32)));
}

// What the owner signs to run `program` (with its arguments) on this Pot, on this chain.
export function executeDigest(program: bytes, salt: Uint256, deadline: Uint256): Uint256 {
  return typedDigest(
    domainSeparator(),
    crypto.keccak256(abi.encode(SAUCE_SIGNED_EXECUTE, crypto.keccak256(program), salt, deadline)),
  );
}

// The EIP-712 hash of one chain's execution in a signature across chains: this chain's when
// `chain` is `ctx.chainId()`.
export function executionHash(
  chain: Uint256,
  program: bytes,
  salt: Uint256,
  deadline: Uint256,
): Uint256 {
  return crypto.keccak256(
    abi.encode(SAUCE_SIGNED_EXECUTION, chain, crypto.keccak256(program), salt, deadline),
  );
}

// What the owner signs to run one execution per chain, `executions` the hash of each in the order
// signed. The domain names the Pot and no chain.
export function acrossDigest(executions: Uint256[]): Uint256 {
  const encoded = abi.encode(executions);
  const domain = crypto.keccak256(
    abi.encode(SAUCE_SIGNED_DOMAIN_ACROSS, SAUCE_SIGNED_NAME, SAUCE_SIGNED_VERSION, ctx.self()),
  );
  // abi.encode of one array: its offset, its length, then the words, which EIP-712 hashes packed.
  return typedDigest(
    domain,
    crypto.keccak256(
      abi.encode(SAUCE_SIGNED_EXECUTIONS, crypto.keccak256(encoded.slice(64, encoded.length))),
    ),
  );
}

// What the owner signs for the Pot to answer EIP-1271 for `hash`: `hash` bound to this Pot and this
// chain, so no signature the owner made for anything else is one of the Pot's.
export function messageDigest(hash: Uint256): Uint256 {
  return typedDigest(domainSeparator(), crypto.keccak256(abi.encode(SAUCE_SIGNED_MESSAGE, hash)));
}

// ---- who signed -----------------------------------------------------------------------------------

// The Pot's owner, who signs for it.
export function owner(): Address {
  const [signer] = abi.decode(evm.static(ctx.self(), hex`8da5cb5b`), ["Address"]);
  return signer;
}

// Whether `signer` signed `digest`: a 65-byte `r ‖ s ‖ v` signature recovering to it, with `s` in
// the lower half and `v` 27 or 28; or, for a signer with code, EIP-1271's answer for the signature
// as it is. A signer whose `isValidSignature` reverts reverts this.
export function signedBy(signer: Address, digest: Uint256, signature: bytes): bool {
  let valid = false;
  if (signature.length == 65) {
    const s = signature.slice(32, 64).toBe();
    const v = signature.slice(64, 65).toBe();
    if (s <= SAUCE_SIGNED_HALF_ORDER && (v == 27 || v == 28)) {
      valid = crypto.ecdsaVerify(digest, signature, signer);
    }
  }
  if (!valid && ctx.codeSize(signer) > 0) {
    const answer = evm.static(signer, hex`1626ba7e`.concat(abi.encode(digest, signature)));
    valid = answer.length >= 32 && answer.slice(0, 4).toBe() == 0x1626ba7e;
  }
  return valid;
}

// ---- salts ----------------------------------------------------------------------------------------

function saltWord(word: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(word, SAUCE_SIGNED_NAMESPACE));
}

// Whether `salt` was used or cancelled on this Pot.
export function isUsed(salt: Uint256): bool {
  return ((evm.sload(saltWord(salt >> 8)) >> (salt & 255)) & 1) == 1;
}

// Use `salt`: refused when it was used or cancelled.
export function useSalt(salt: Uint256): void {
  const slot = saltWord(salt >> 8);
  const bit = 1 << (salt & 255);
  const used = evm.sload(slot);
  require((used & bit) == 0, "signed: the salt was used or cancelled");
  evm.sstore(slot, used | bit);
}

// Cancel every salt whose bit `mask` sets in the word `word` (the salts `word << 8` to
// `(word << 8) + 255`), as Permit2's `invalidateUnorderedNonces`: a program the owner cooks, or
// signs. A cancelled salt never runs.
export function invalidate(word: Uint256, mask: Uint256): void {
  const slot = saltWord(word);
  evm.sstore(slot, evm.sload(slot) | mask);
  log(abi.encode(mask), SAUCE_SIGNED_CANCELLED, word);
}

// Cancel one salt.
export function cancel(salt: Uint256): void {
  invalidate(salt >> 8, 1 << (salt & 255));
}

// ---- running --------------------------------------------------------------------------------------
//
// `execute`, `executeAcross` and `isValidSignature` are each written FLAT, every check inline: a
// call into a helper costs the engine a frame, and the three are what the Pot's handlers run on
// every call. The helpers above compute the same values for a program that wants one of them.

// `execute`: run `program` as this Pot, in the cook in flight, when the Pot's owner signed it for
// this Pot on this chain (`executeDigest`) with `signature`, before `deadline`, under a `salt` not
// used or cancelled; the salt is used first. Answers what the program returns. What the Pot's
// `execute` handler calls.
export function execute(program: bytes, salt: Uint256, deadline: Uint256, signature: bytes): bytes {
  require(ctx.timestamp() <= deadline, "signed: the deadline has passed");
  const digest = crypto.keccak256(
    hex`1901`.concat(
      abi.encode(
        crypto.keccak256(
          abi.encode(
            SAUCE_SIGNED_DOMAIN,
            SAUCE_SIGNED_NAME,
            SAUCE_SIGNED_VERSION,
            ctx.chainId(),
            ctx.self(),
          ),
        ),
        crypto.keccak256(
          abi.encode(SAUCE_SIGNED_EXECUTE, crypto.keccak256(program), salt, deadline),
        ),
      ),
    ),
  );
  const [signer] = abi.decode(evm.static(ctx.self(), hex`8da5cb5b`), ["Address"]);
  let valid = false;
  if (signature.length == 65) {
    const s = signature.slice(32, 64).toBe();
    const v = signature.slice(64, 65).toBe();
    if (s <= SAUCE_SIGNED_HALF_ORDER && (v == 27 || v == 28)) {
      valid = crypto.ecdsaVerify(digest, signature, signer);
    }
  }
  if (!valid && ctx.codeSize(signer) > 0) {
    const answer = evm.static(signer, hex`1626ba7e`.concat(abi.encode(digest, signature)));
    valid = answer.length >= 32 && answer.slice(0, 4).toBe() == 0x1626ba7e;
  }
  require(valid, "signed: not the owner's signature");
  const slot = crypto.keccak256(abi.encode(salt >> 8, SAUCE_SIGNED_NAMESPACE));
  const bit = 1 << (salt & 255);
  const used = evm.sload(slot);
  require((used & bit) == 0, "signed: the salt was used or cancelled");
  evm.sstore(slot, used | bit);
  const [engine] = abi.decode(evm.static(ctx.self(), hex`9fd004e1`), ["Address"]);
  return evm.delegate(engine, program);
}

// `executeAcross`: run this chain's `program` from one signature of the Pot's owner over
// `executions`, the EIP-712 hash of each chain's execution in the order signed (`acrossDigest`),
// this chain's at `index`; otherwise as `execute`.
export function executeAcross(
  program: bytes,
  salt: Uint256,
  deadline: Uint256,
  executions: Uint256[],
  index: Uint256,
  signature: bytes,
): bytes {
  require(ctx.timestamp() <= deadline, "signed: the deadline has passed");
  require(index < executions.length, "signed: no execution at that index");
  require(executions[index] ==
    crypto.keccak256(
      abi.encode(SAUCE_SIGNED_EXECUTION, ctx.chainId(), crypto.keccak256(program), salt, deadline),
    ), "signed: the execution at that index is not this chain's");
  // abi.encode of one array: its offset, its length, then the words, which EIP-712 hashes packed.
  const listed = abi.encode(executions);
  const digest = crypto.keccak256(
    hex`1901`.concat(
      abi.encode(
        crypto.keccak256(
          abi.encode(
            SAUCE_SIGNED_DOMAIN_ACROSS,
            SAUCE_SIGNED_NAME,
            SAUCE_SIGNED_VERSION,
            ctx.self(),
          ),
        ),
        crypto.keccak256(
          abi.encode(SAUCE_SIGNED_EXECUTIONS, crypto.keccak256(listed.slice(64, listed.length))),
        ),
      ),
    ),
  );
  const [signer] = abi.decode(evm.static(ctx.self(), hex`8da5cb5b`), ["Address"]);
  let valid = false;
  if (signature.length == 65) {
    const s = signature.slice(32, 64).toBe();
    const v = signature.slice(64, 65).toBe();
    if (s <= SAUCE_SIGNED_HALF_ORDER && (v == 27 || v == 28)) {
      valid = crypto.ecdsaVerify(digest, signature, signer);
    }
  }
  if (!valid && ctx.codeSize(signer) > 0) {
    const answer = evm.static(signer, hex`1626ba7e`.concat(abi.encode(digest, signature)));
    valid = answer.length >= 32 && answer.slice(0, 4).toBe() == 0x1626ba7e;
  }
  require(valid, "signed: not the owner's signature");
  const slot = crypto.keccak256(abi.encode(salt >> 8, SAUCE_SIGNED_NAMESPACE));
  const bit = 1 << (salt & 255);
  const used = evm.sload(slot);
  require((used & bit) == 0, "signed: the salt was used or cancelled");
  evm.sstore(slot, used | bit);
  const [engine] = abi.decode(evm.static(ctx.self(), hex`9fd004e1`), ["Address"]);
  return evm.delegate(engine, program);
}

// EIP-1271's answer for the Pot: `isValidSignature`'s magic value, left-aligned, when the owner
// signed `hash` for this Pot (`messageDigest`), and 0xffffffff otherwise.
export function isValidSignature(hash: Uint256, signature: bytes): Uint256 {
  const digest = crypto.keccak256(
    hex`1901`.concat(
      abi.encode(
        crypto.keccak256(
          abi.encode(
            SAUCE_SIGNED_DOMAIN,
            SAUCE_SIGNED_NAME,
            SAUCE_SIGNED_VERSION,
            ctx.chainId(),
            ctx.self(),
          ),
        ),
        crypto.keccak256(abi.encode(SAUCE_SIGNED_MESSAGE, hash)),
      ),
    ),
  );
  const [signer] = abi.decode(evm.static(ctx.self(), hex`8da5cb5b`), ["Address"]);
  let valid = false;
  if (signature.length == 65) {
    const s = signature.slice(32, 64).toBe();
    const v = signature.slice(64, 65).toBe();
    if (s <= SAUCE_SIGNED_HALF_ORDER && (v == 27 || v == 28)) {
      valid = crypto.ecdsaVerify(digest, signature, signer);
    }
  }
  if (!valid && ctx.codeSize(signer) > 0) {
    const answer = evm.static(signer, hex`1626ba7e`.concat(abi.encode(digest, signature)));
    valid = answer.length >= 32 && answer.slice(0, 4).toBe() == 0x1626ba7e;
  }
  if (valid) {
    return 0x1626ba7e00000000000000000000000000000000000000000000000000000000;
  }
  return 0xffffffff00000000000000000000000000000000000000000000000000000000;
}

// ---- submitting -----------------------------------------------------------------------------------

// Submit a program the owner of `pot` signed to that Pot, from another program: a hop's body that
// delivers funds to the Pot and runs the owner's program in the same transaction. Answers what the
// signed program returned. The Pot pays its Kitchen fee from its own balance.
export function submit(
  pot: Address,
  program: bytes,
  salt: Uint256,
  deadline: Uint256,
  signature: bytes,
): bytes {
  return evm.call(pot, 0, hex`82bf0988`.concat(abi.encode(program, salt, deadline, signature)));
}

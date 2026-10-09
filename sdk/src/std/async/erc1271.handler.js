// The Pot's ERC-1271 `isValidSignature(bytes32 hash, bytes signature) returns (bytes4)`, a view (a
// static run with no fee): valid for a hash a program running as the Pot approved
// (`Erc1271.approve`), whatever the signature bytes, or for its owner's signature over the hash
// bound to the Pot (`PotMessage`), and 0xffffffff otherwise. One handler for every package that
// needs the Pot to sign: each declares it, `"program": "@sauce/async/erc1271.handler.js"`, and
// installing several installs it once.
//
// `@sauce/async`'s `isValidSignature`, written out here with no call at all, every check inline:
// a market's check gives it a hard gas cap, and a call costs a frame. The SDK's tests hold the two
// to one answer, and these constants to the library's.

// sauce.storage.Erc1271 (ERC-7201), EIP712Domain(string name,string version,uint256 chainId,
// address verifyingContract), "Sauce Pot", "1", PotMessage(bytes32 hash), and half the order of
// secp256k1.
const SAUCE_ERC1271_HANDLER_NAMESPACE = 0x3ecee999f28b5e8fad18912a6f2e29ef0ffcf6ba8ef27fb61168d26e4308d900;
const SAUCE_ERC1271_HANDLER_DOMAIN = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
const SAUCE_ERC1271_HANDLER_NAME = 0x65e82c940f55e84d80e8c004a4c586bf80f61f10a7c0218cc8c7ca657f1e4edd;
const SAUCE_ERC1271_HANDLER_VERSION = 0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6;
const SAUCE_ERC1271_HANDLER_MESSAGE = 0x285c77bc77dfca76b6f099853b19373bb19a687adfc951011417a67ac42dded3;
const SAUCE_ERC1271_HANDLER_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

function main(caller: Address, value: Uint256, data: bytes): Uint256 {
  const [hash, signature] = abi.decode(data.slice(4, data.length), ["Uint256", "bytes"]);
  if (evm.sload(crypto.keccak256(abi.encode(hash, SAUCE_ERC1271_HANDLER_NAMESPACE))) == 1) {
    return 0x1626ba7e00000000000000000000000000000000000000000000000000000000;
  }
  const digest = crypto.keccak256(
    hex`1901`.concat(
      abi.encode(
        crypto.keccak256(
          abi.encode(
            SAUCE_ERC1271_HANDLER_DOMAIN,
            SAUCE_ERC1271_HANDLER_NAME,
            SAUCE_ERC1271_HANDLER_VERSION,
            ctx.chainId(),
            ctx.self(),
          ),
        ),
        crypto.keccak256(abi.encode(SAUCE_ERC1271_HANDLER_MESSAGE, hash)),
      ),
    ),
  );
  const [signer] = abi.decode(evm.static(ctx.self(), hex`8da5cb5b`), ["Address"]);
  let valid = false;
  if (signature.length == 65) {
    const s = signature.slice(32, 64).toBe();
    const v = signature.slice(64, 65).toBe();
    if (s <= SAUCE_ERC1271_HANDLER_HALF_ORDER && (v == 27 || v == 28)) {
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

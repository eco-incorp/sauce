/**
 * The Pot as an ERC-1271 signer, from TypeScript: what its owner signs, where an approved hash is
 * kept, and the handler a package declares.
 *
 * A Private Pot answers `isValidSignature(bytes32 hash, bytes signature)` with ONE handler, the
 * core's `@sauce/async/erc1271.handler.js` (a view). It is valid, with the magic value `0x1626ba7e`,
 *
 *   - for a hash a program running as the Pot approved (`Erc1271.approve(hash)`), WHATEVER the
 *     signature bytes: the approval is the authorization, and a market that checks it passes
 *     whatever signature the Pot gave it;
 *   - for the owner's signature over {@link potMessageTypedData}: `PotMessage { hash }` under the
 *     domain `{ name: "Sauce Pot", version: "1", chainId, verifyingContract: the Pot }`, never over
 *     the bare hash, so a signature the owner made for its own account, or for another Pot it
 *     owns, is no signature of this Pot's. A 65-byte signature with an upper-half `s` or a `v`
 *     other than 27 or 28 is refused; an owner with code is asked ERC-1271 itself.
 *
 * and `0xffffffff` otherwise. A package that needs the Pot to sign (`@sauce/signed`, `@sauce/zk`'s
 * Boundless requests) declares {@link ERC1271_HANDLER} as one of its handlers.
 */
import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  pad,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import type { HandlerDeclaration } from "./handlers.js";

/** The EIP-712 domain's `name` and `version` a Pot's owner signs under. */
export const POT_SIGNER_DOMAIN = { name: "Sauce Pot", version: "1" } as const;

/** The core's handler for `isValidSignature(bytes32,bytes)`, as a package declares it. */
export const ERC1271_HANDLER: HandlerDeclaration = {
  selector: "isValidSignature(bytes32,bytes)",
  program: "@sauce/async/erc1271.handler.js",
  readOnly: true,
};

/** A Pot's ERC-1271 surface, as a contract calls it, and the event an approval logs. */
export const erc1271Abi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  "event SignatureApproved(bytes32 indexed hash, bool approved)",
]);

/** The ERC-7201 namespace `sauce.storage.Erc1271`, where a Pot keeps the hashes it approved. */
export const ERC1271_NAMESPACE: Hex =
  "0x3ecee999f28b5e8fad18912a6f2e29ef0ffcf6ba8ef27fb61168d26e4308d900";

const MESSAGE_TYPES = { PotMessage: [{ name: "hash", type: "bytes32" }] } as const;

/** The typed data the owner of `pot` signs for the Pot to answer ERC-1271 for `hash` (a Permit2
 *  permit's digest, say): `PotMessage { hash }` under the Pot's domain on `chainId`. */
export function potMessageTypedData(message: {
  readonly pot: Address;
  readonly chainId: number | bigint;
  readonly hash: Hex;
}) {
  return {
    domain: {
      ...POT_SIGNER_DOMAIN,
      chainId: BigInt(message.chainId),
      verifyingContract: message.pot,
    },
    types: MESSAGE_TYPES,
    primaryType: "PotMessage",
    message: { hash: pad(message.hash, { size: 32 }) },
  } as const;
}

/** The digest the owner's signature for {@link potMessageTypedData} signs, as the Pot computes it. */
export function potMessageDigest(message: {
  readonly pot: Address;
  readonly chainId: number | bigint;
  readonly hash: Hex;
}): Hex {
  return hashTypedData(potMessageTypedData(message));
}

/** Where a Pot records that it approved `hash` (`eth_getStorageAt` on the Pot): 1 approved. */
export function approvedHashSlot(hash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [pad(hash, { size: 32 }), ERC1271_NAMESPACE],
    ),
  );
}

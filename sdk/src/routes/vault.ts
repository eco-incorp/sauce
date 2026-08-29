/**
 * eco-routes V2 vault address prediction — the off-chain twin of
 * `IntentSource._getVault(bytes32 intentHash)`:
 *
 * ```solidity
 * function _getVault(bytes32 intentHash) internal view returns (address) {
 *     return VAULT_IMPLEMENTATION.predict(intentHash, CREATE2_PREFIX);
 * }
 * ```
 *
 * where `Clones.predict` (OpenZeppelin) is a plain CREATE2 address derivation:
 *
 * ```
 * address = last20Bytes(keccak256(prefix ++ deployer ++ salt ++ initCodeHash))
 * ```
 *
 * with `deployer = Portal` (the calling contract — `predict` is an internal library fn, called from
 * `IntentSource`, and `Portal is IntentSource, Inbox, Semver`), `salt = intentHash` itself (no
 * further hashing — confirmed against `_getVault`'s own call above), and `prefix = CREATE2_PREFIX`
 * (`0xff` for EVM Portal deployments; Portal's constructor is `IntentSource(address(new Vault()),
 * bytes1(0xff))`).
 *
 * `initCodeHash = keccak256(type(Proxy).creationCode ++ abi.encode(implementation))` — this is
 * SHIPPED AS EXPLICIT CONFIG (`VaultConfig.vaultInitCodeHash`), never a baked constant:
 * `type(Proxy).creationCode` depends on the exact solc version + optimizer settings used to deploy
 * Portal, and eco-routes commits no artifacts on `main` to derive it from. Obtain it from a real
 * deployment (or verify against a live `Portal.intentVaultAddress(intent)` call) before trusting a
 * `predictVaultAddress` result against any real chain — see this epic's design doc's `openQuestions`.
 *
 * DO NOT confuse this with eco-routes' own (superseded) `utils/intent.ts#intentVaultAddress` helper:
 * that models `salt = routeHash` with a Vault deployed with `(intentHash, reward)` constructor args,
 * which contradicts the real, zero-arg `Vault` constructor and the `Clones`/minimal-proxy scheme
 * `_getVault` actually uses. The Solidity above is the only ground truth this file follows.
 */
import { encodeAbiParameters, encodePacked, getAddress, hexToBytes, keccak256, type Hex } from "viem";

import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import type { AddressInput } from "./types.js";

export interface VaultConfig {
  /** The Portal contract — the CREATE2 deployer in the formula above. */
  readonly portal: AddressInput;
  /** `keccak256(type(Proxy).creationCode ++ abi.encode(vaultImplementation))` — see the module doc;
   *  never derived here, always caller-supplied. */
  readonly vaultInitCodeHash: Hex;
  /** CREATE2 prefix byte. Defaults to `0xff` (the live EVM Portal deployments' `CREATE2_PREFIX`;
   *  `0x41` is `PortalTron`'s, out of scope here). */
  readonly prefix?: Hex;
}

function assertBytes32(value: Hex, label: string): void {
  const bytes = hexToBytes(value);
  if (bytes.length !== 32) {
    throw new Error(`${label}: expected 32 bytes, got ${bytes.length} bytes ('${value}')`);
  }
}

function assertByte1(value: Hex, label: string): void {
  const bytes = hexToBytes(value);
  if (bytes.length !== 1) {
    throw new Error(`${label}: expected exactly 1 byte, got ${bytes.length} bytes ('${value}')`);
  }
}

/**
 * The off-chain twin of `IntentSource._getVault(intentHash)` -> `Clones.predict(intentHash,
 * CREATE2_PREFIX)`. Throws (rather than silently computing against a missing/malformed
 * `vaultInitCodeHash`) since there is no safe baked default — see the module doc.
 */
export function predictVaultAddress(intentHash: Hex, config: VaultConfig): Hex {
  assertBytes32(intentHash, "intentHash");
  if (config.vaultInitCodeHash === undefined || config.vaultInitCodeHash === null) {
    throw new Error("predictVaultAddress: config.vaultInitCodeHash is required (no baked default — see vault.ts's module doc)");
  }
  assertBytes32(config.vaultInitCodeHash, "vaultInitCodeHash");
  const prefix = config.prefix ?? "0xff";
  assertByte1(prefix, "prefix");

  const portal = denormalizeToEvm(toUniversalAddress(config.portal));
  const packed = encodePacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    [prefix, portal, intentHash, config.vaultInitCodeHash],
  );
  const digest = keccak256(packed);
  return getAddress(`0x${digest.slice(-40)}`) as Hex;
}

/**
 * `keccak256(proxyCreationCode ++ abi.encode(implementation))` — the `initCodeHash` half of the
 * `Clones.predict` formula, for a caller who has the real `type(Proxy).creationCode` bytes (e.g.
 * pulled from a deployment artifact) and only needs the implementation-address encoding step done
 * correctly.
 */
export function vaultInitCodeHash(proxyCreationCode: Hex, implementation: AddressInput): Hex {
  const implAddress = denormalizeToEvm(toUniversalAddress(implementation));
  const encodedImpl = encodeAbiParameters([{ type: "address" }], [implAddress]);
  const bytes = hexToBytes(proxyCreationCode);
  const implBytes = hexToBytes(encodedImpl);
  const combined = new Uint8Array(bytes.length + implBytes.length);
  combined.set(bytes, 0);
  combined.set(implBytes, bytes.length);
  return keccak256(combined);
}

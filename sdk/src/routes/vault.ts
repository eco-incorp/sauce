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
 * `initCodeHash = keccak256(type(Proxy).creationCode ++ abi.encode(implementation))`, and both
 * halves are known for an eco-routes Portal (`ecoRoutesVaultConfig` below):
 *
 *  - `implementation` is the Portal's first `CREATE` (`Portal`'s constructor passes
 *    `address(new Vault())` to `IntentSource`), so it follows from the Portal address —
 *    `protocols/eco-routes/lookup.ts#ecoRoutesVaultImplementationOf`, beside the Executor (its
 *    second);
 *  - `type(Proxy).creationCode` is `contracts/vault/Proxy.sol` compiled with eco-routes' own
 *    `foundry.toml` — solc 0.8.27, via-IR, 1,000,000 optimizer runs, `paris`, and no CBOR metadata
 *    (`cbor_metadata = false`, `bytecode_hash = "none"`), so the bytes are a function of the source
 *    and those settings alone: {@link ECO_ROUTES_VAULT_PROXY_CREATION_CODE}.
 *
 * That is evidence, not an assumption. `test/fixtures/eco-routes-vaults.json` records, for every EVM
 * Portal the registry carries, what the deployed Portal's own `intentVaultAddress` returned for a
 * fixed intent (`scripts/capture-eco-routes-vaults.mjs`), and `eco-routes-vault.test.ts` requires the
 * prediction to match each one and every registry Portal to be covered. A Portal built some other
 * way (a different Proxy, another compiler) needs its own `vaultInitCodeHash`, which
 * {@link predictVaultAddress} still takes as explicit config.
 *
 * DO NOT confuse this with eco-routes' own (superseded) `utils/intent.ts#intentVaultAddress` helper:
 * that models `salt = routeHash` with a Vault deployed with `(intentHash, reward)` constructor args,
 * which contradicts the real, zero-arg `Vault` constructor and the `Clones`/minimal-proxy scheme
 * `_getVault` actually uses. The Solidity above is the only ground truth this file follows.
 */
import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  hexToBytes,
  keccak256,
  type Hex,
} from "viem";

import { ecoRoutesVaultImplementationOf } from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import type { AddressInput } from "./types.js";

export interface VaultConfig {
  /** The Portal contract — the CREATE2 deployer in the formula above. */
  readonly portal: AddressInput;
  /** `keccak256(type(Proxy).creationCode ++ abi.encode(vaultImplementation))` — see the module doc;
   *  {@link ecoRoutesVaultConfig} derives it for an eco-routes Portal. */
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
 * `vaultInitCodeHash`): the config names the Portal build, and {@link ecoRoutesVaultConfig} is the
 * one for eco-routes' own.
 */
export function predictVaultAddress(intentHash: Hex, config: VaultConfig): Hex {
  assertBytes32(intentHash, "intentHash");
  if (config.vaultInitCodeHash === undefined || config.vaultInitCodeHash === null) {
    throw new Error(
      "predictVaultAddress: config.vaultInitCodeHash is required — ecoRoutesVaultConfig(portal) gives " +
        "it for an eco-routes Portal (see vault.ts's module doc)",
    );
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

/**
 * `type(Proxy).creationCode` as eco-routes builds it: `contracts/vault/Proxy.sol` under its
 * `foundry.toml` (solc 0.8.27, via-IR, 1,000,000 runs, `paris`, no CBOR metadata). Every vault is a
 * `new Proxy{salt: intentHash}(implementation)` of these bytes, and every deployed Portal carries
 * them — `test/fixtures/eco-routes-vaults.json` records each registry Portal's code embedding them
 * and its `intentVaultAddress` agreeing with {@link ecoRoutesVaultConfig}, and the vendored Portal
 * fixture embeds them too.
 */
export const ECO_ROUTES_VAULT_PROXY_CREATION_CODE: Hex =
  "0x60a034606257601f60c938819003918201601f19168301916001600160401b03831184841017606757808492602094604052833981010312606257516001600160a01b0381168103606257608052604051604b9081607e82396080518160150152f35b600080fd5b634e487b7160e01b600052604160045260246000fdfe60806040523615604957366000803760008036817f00000000000000000000000000000000000000000000000000000000000000005af43d6000803e156044573d6000f35b3d6000fd5b00";

/**
 * The vault configuration of an eco-routes Portal: its vaults are CREATE2 clones, by `portal`,
 * salted with the intent hash, of {@link ECO_ROUTES_VAULT_PROXY_CREATION_CODE} over the Portal's
 * first `CREATE` (`ecoRoutesVaultImplementationOf`). Derived from the address alone — nothing is
 * read from a chain — so an intent's vault is known before it is published, which is what lets a
 * funder pay it directly.
 */
export function ecoRoutesVaultConfig(portal: AddressInput): VaultConfig {
  const address = getAddress(denormalizeToEvm(toUniversalAddress(portal))) as Hex;

  return {
    portal: address,
    vaultInitCodeHash: vaultInitCodeHash(
      ECO_ROUTES_VAULT_PROXY_CREATION_CODE,
      ecoRoutesVaultImplementationOf(address),
    ),
    prefix: "0xff",
  };
}

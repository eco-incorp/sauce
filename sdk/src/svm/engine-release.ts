/**
 * The Solana engine releases the SDK knows, and what holds a program a cluster serves to one of
 * them. Shared by the `sauce` command and the testing kit, which never imports the command, so it
 * lives outside `cli/`; browser-safe (viem's `sha256`, no `node:*`) and in no barrel and no
 * `exports` entry.
 *
 * A Solana Pot's address does not depend on the engine: the engine that cooks a Pot is the program
 * that owns the Pot's account. Each release's engine is an upgradeable program at its own address,
 * so the address says nothing of the bytes — a program is held to a release by its ELF's digest.
 */
import { sha256 as sha256Viem } from "viem";

import { V12_RELEASE_SETS } from "../deployments/releases.js";

/** Lowercase hex, as `releases.json` pins a digest. */
const sha256 = (bytes: Uint8Array): string => sha256Viem(bytes).slice(2);

/**
 * The length of an ELF64 little-endian object as its header gives it: its section header table,
 * which ends it (`e_shoff + e_shentsize * e_shnum`). `undefined` for bytes that are not one.
 */
export function elfLength(bytes: Uint8Array): number | undefined {
  if (
    bytes.length < 64 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end =
    Number(view.getBigUint64(0x28, true)) + view.getUint16(0x3a, true) * view.getUint16(0x3c, true);

  return end <= bytes.length ? end : undefined;
}

/**
 * Whether `deployed`, a program as the cluster holds it, is the ELF whose sha256 is one of
 * `digests`, followed only by the zero padding of an account sized past it.
 */
export function isPinnedProgram(deployed: Uint8Array, digests: readonly string[]): boolean {
  const length = elfLength(deployed);
  if (length === undefined || !digests.includes(sha256(deployed.subarray(0, length)))) return false;
  for (let i = length; i < deployed.length; i++) if (deployed[i] !== 0) return false;

  return true;
}

let engines:
  | ReadonlyMap<string, { readonly version: string; readonly digests: readonly string[] }>
  | undefined;

/** Every Solana engine a release set names: its version and the digests of its two builds. */
export function svmEngineReleases(): ReadonlyMap<
  string,
  { readonly version: string; readonly digests: readonly string[] }
> {
  if (engines !== undefined) return engines;
  const found = new Map<string, { version: string; digests: string[] }>();
  for (const row of V12_RELEASE_SETS) {
    const { engine, version, assets } = row["v12-svm"];
    if (engine === null) continue;
    const release = found.get(engine) ?? { version, digests: [] };
    for (const asset of ["engine-devnet.so", "engine-mainnet.so"]) {
      const digest = assets[asset];
      if (digest !== null && digest !== undefined && !release.digests.includes(digest)) {
        release.digests.push(digest);
      }
    }
    found.set(engine, release);
  }

  return (engines = found);
}

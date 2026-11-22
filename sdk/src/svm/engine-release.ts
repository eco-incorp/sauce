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

import { engineRunsCompiler, V12_RELEASE_SETS } from "../deployments/releases.js";

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

/** The System Program: the owner of every account no other program has taken. */
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/**
 * What the account at a Pot's address says of the engine that cooks it. The Kitchen signs for a
 * Pot's address whether or not `create_pot` ever made the account (its IDL: the Pot "holds no data
 * and need not exist for a program that keeps no storage"), so an address with nothing at it, or
 * only lamports, is a Pot no engine owns yet, and not a refusal:
 *
 * - `unallocated`: no account, or the System Program's with no data. Cooked as it is, on the
 *   installed engine, with no `create_pot`: a program that pays SOL out of the Pot through the
 *   System Program needs exactly this, since that transfer takes no `from` that carries data.
 * - `engine`: a release's engine owns it, and it is the program that cooks the Pot. `runsCompiler`
 *   says whether that release's programs run this SDK's.
 * - `other`: any other program owns the account: it is no Pot.
 */
export type PotAccountState =
  | { readonly kind: "unallocated" }
  | {
      readonly kind: "engine";
      readonly engine: string;
      readonly version: string;
      readonly runsCompiler: boolean;
    }
  | { readonly kind: "other"; readonly owner: string };

/**
 * The state of the account at a Pot's address: `null` (or `undefined`) where the cluster holds
 * none. Shared by the `sauce` command and the testing kit, so a Pot is told apart one way.
 */
export function potAccountState(
  account: { readonly owner: string; readonly dataLength: number } | null | undefined,
): PotAccountState {
  if (account === null || account === undefined) return { kind: "unallocated" };
  if (account.owner === SYSTEM_PROGRAM && account.dataLength === 0) return { kind: "unallocated" };
  const release = svmEngineReleases().get(account.owner);
  if (release === undefined) return { kind: "other", owner: account.owner };

  return {
    kind: "engine",
    engine: account.owner,
    version: release.version,
    runsCompiler: engineRunsCompiler("svm", account.owner) === true,
  };
}

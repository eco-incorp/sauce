/**
 * Whether a Solana cluster runs the released programs a cook needs. The engine and the Kitchen are
 * upgradeable programs, so a cluster can hold an older build at the release's own addresses: the
 * address says nothing about the bytes. This reads each program as the cluster has it and compares
 * it with the release's `.so` — the packaged file, itself held to the digest `releases.json` pins —
 * and refuses a cook, or a Pot, on a cluster whose program is absent or is another build, as the
 * EVM path refuses a chain without the released contracts.
 *
 * Node-only, like the rest of the command: the packaged binaries are files.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { getAddressDecoder } from "@solana/kit";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../deployments/index.js";
import { v12ReleaseSet } from "../deployments/releases.js";
import { svmEnginePath, svmKitchenPath } from "../svm/engine-artifacts.js";
import { CliError } from "./args.js";

/** A program account as the cluster holds it: its loader, whether it is executable, and its data. */
export interface ProgramAccount {
  readonly owner: string;
  readonly executable: boolean;
  readonly data: Uint8Array;
}

/** Reads one account by address: `undefined` where the cluster has none. Injected, so it runs offline. */
export type ReadProgram = (account: string) => Promise<ProgramAccount | undefined>;

/** The programs a cook runs through: the engine, and the Kitchen unless the cook goes straight to it. */
export type ProgramName = "engine" | "Kitchen";

/** The release's program binaries. The engine is built for each cluster kind and either is the release's. */
export interface ReleasedPrograms {
  readonly engine: readonly Uint8Array[];
  readonly kitchen: Uint8Array;
}

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** A program account of the upgradeable loader: a 4-byte tag (2) and its programdata's address. */
const PROGRAM_ACCOUNT_SIZE = 36;
/** The programdata account's header: a 4-byte tag (3), the slot, and the optional upgrade authority. */
const PROGRAMDATA_HEADER = 45;

const tagOf = (data: Uint8Array): number | undefined =>
  data.length < 4 ? undefined : new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);

/** The loaders whose own account holds the program: the BPF loaders before the upgradeable one. */
const DIRECT_LOADERS: Record<string, true> = {
  BPFLoader2111111111111111111111111111111111: true,
  BPFLoader1111111111111111111111111111111111: true,
};

/**
 * The bytes a program runs from, as the cluster holds them — the zero padding of an account sized
 * past its program included. Only an executable account of a BPF loader is a program: an upgradeable
 * one is its programdata account past the header, an older loader's account holds the program
 * itself. Any other account, even one holding the release's bytes, is not a deployed program.
 * `undefined` where there is none.
 */
export async function deployedProgram(
  read: ReadProgram,
  program: string,
): Promise<Uint8Array | undefined> {
  const account = await read(program);
  if (account === undefined || !account.executable) return undefined;
  if (DIRECT_LOADERS[account.owner] === true) return account.data;
  if (account.owner !== UPGRADEABLE_LOADER) return undefined;
  if (account.data.length !== PROGRAM_ACCOUNT_SIZE || tagOf(account.data) !== 2) return undefined;
  const programData = await read(getAddressDecoder().decode(account.data.subarray(4)));
  if (
    programData === undefined ||
    programData.owner !== UPGRADEABLE_LOADER ||
    programData.data.length < PROGRAMDATA_HEADER ||
    tagOf(programData.data) !== 3
  ) {
    return undefined;
  }

  return programData.data.subarray(PROGRAMDATA_HEADER);
}

/**
 * Whether `deployed` is `released`: its first bytes are the release's, and what follows is the zero
 * padding of an account sized past its program. Compared by the release's own length, so a release
 * that itself ends in zero bytes is not mistaken for padding.
 */
export function isReleasedProgram(deployed: Uint8Array, released: Uint8Array): boolean {
  if (deployed.length < released.length) return false;
  const head = Buffer.from(deployed.buffer, deployed.byteOffset, released.length);
  if (!head.equals(released)) return false;
  for (let i = released.length; i < deployed.length; i++) if (deployed[i] !== 0) return false;

  return true;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function packaged(file: string, asset: string, pin: string | null | undefined): Uint8Array {
  const bytes = readFileSync(file);
  const digest = sha256(bytes);
  if (pin === null || pin === undefined || digest !== pin) {
    throw new CliError(
      `the packaged ${asset} is not the one this SDK pins (sha256 ${digest}): reinstall the package`,
    );
  }

  return bytes;
}

/** The release's engine and Kitchen: the packaged binaries, each checked against `releases.json`. */
export function packagedRelease(): ReleasedPrograms {
  const set = v12ReleaseSet();

  return {
    engine: (["devnet", "mainnet"] as const).map((cluster) =>
      packaged(
        svmEnginePath(cluster),
        `engine-${cluster}.so`,
        set["v12-svm"].assets[`engine-${cluster}.so`],
      ),
    ),
    kitchen: packaged(svmKitchenPath(), "kitchen.so", set["kitchen-svm"].assets["kitchen.so"]),
  };
}

/**
 * Refuses unless each of `needs` is on the cluster as the release's program: the engine first, as
 * the EVM path does. Run before anything is simulated, built or sent.
 */
export async function requireSolanaRelease(
  read: ReadProgram,
  needs: readonly ProgramName[],
  slug = "solana",
  released: ReleasedPrograms = packagedRelease(),
): Promise<void> {
  for (const name of ["engine", "Kitchen"] as const) {
    if (!needs.includes(name)) continue;
    const program = name === "engine" ? v12SvmEngineProgramId() : v12SvmKitchenProgramId();
    const wanted = name === "engine" ? released.engine : [released.kitchen];
    const deployed = await deployedProgram(read, program);
    if (deployed !== undefined && wanted.some((one) => isReleasedProgram(deployed, one))) continue;
    throw new CliError(
      `the released ${name} ${program} is not deployed on ${slug}: this SDK's cook cannot run ` +
        `there (${
          deployed === undefined
            ? "the cluster has no such program"
            : `the program there is not this release's ${name === "engine" ? "engine" : "kitchen.so"}`
        }). Nothing was simulated, built or sent`,
    );
  }
}

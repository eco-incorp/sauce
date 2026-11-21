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
import {
  engineRunsCompiler,
  sdkCompilerVersion,
  V12_RELEASE_SETS,
  v12ReleaseSet,
} from "../deployments/releases.js";
import { svmEnginePath, svmKitchenPath, type EngineCluster } from "../svm/engine-artifacts.js";
import { elfLength, isPinnedProgram, svmEngineReleases } from "../svm/engine-release.js";
import { CliError } from "./args.js";
import { pairedSdkReleases, pairWith, svmRelease } from "./pots.js";

/** A program account as the cluster holds it: its loader, whether it is executable, and its data. */
export interface ProgramAccount {
  readonly owner: string;
  readonly executable: boolean;
  readonly data: Uint8Array;
}

/** Reads one account by address: `undefined` where the cluster has none. Injected, so it runs offline. */
export type ReadProgram = (account: string) => Promise<ProgramAccount | undefined>;

/** The programs a cook runs through: the engine, and the Kitchen for a cook through a Pot or a
 *  program staged in its code buffer. */
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
 * The addresses of every program an instruction list reaches: each instruction's program and every
 * account it names. A Kitchen cook reaches the engine by CPI and names it only as an account, so
 * the program ids alone would leave it unchecked.
 */
export function instructionAddresses(
  instructions: readonly {
    programAddress: string;
    accounts?: readonly { address: string }[];
  }[],
): string[] {
  return instructions.flatMap((instruction) => [
    instruction.programAddress,
    ...(instruction.accounts ?? []).map((account) => account.address),
  ]);
}

/**
 * The release's programs among `programs` — a transaction's programs and accounts: whether the
 * Kitchen is, and every release engine (`svmEngineReleases`): a Pot is cooked by the engine that
 * owns it, which may be an earlier release's.
 */
export function programsCalled(programs: Iterable<string>): {
  readonly needs: ProgramName[];
  readonly engines: string[];
} {
  const called = new Set(programs);
  const engines = [...svmEngineReleases().keys()].filter((id) => called.has(id));

  return {
    needs: [
      ...(engines.length > 0 ? (["engine"] as const) : []),
      ...(called.has(v12SvmKitchenProgramId()) ? (["Kitchen"] as const) : []),
    ],
    engines,
  };
}

/**
 * Which release engine `program` is and why this SDK's programs do not run on it: the part of a
 * refusal that follows "the engine" / "the Pot P is owned by engine", ending before its last words.
 */
export function engineMismatch(program: string): string {
  const version = svmEngineReleases().get(program)?.version ?? "?";
  const named = V12_RELEASE_SETS.filter((row) => row["v12-svm"].engine === program);
  const runs = V12_RELEASE_SETS.filter(
    (row) =>
      row["v12-svm"].engine === program || row.alsoRunsOn?.["v12-svm"]?.includes(version) === true,
  )
    .map((row) => row.compiler)
    .join(", ");
  const newest = named.at(-1);
  const paired = newest === undefined ? undefined : pairedSdkReleases(svmRelease(newest));

  return (
    `${program} (v12-svm ${version}), which runs compiler ${runs} output: this SDK compiles with ` +
    `compiler ${sdkCompilerVersion()}${paired === undefined ? "" : `, and ${pairWith(paired)} that engine`}`
  );
}

/**
 * Refuses unless `program`, an engine of an earlier release than the installed one, is a release
 * engine whose programs run this SDK's, deployed on the cluster as that release's build
 * ({@link isPinnedProgram}: the cluster's program account is the committed ELF, then zero padding).
 */
async function requireEarlierEngine(
  read: ReadProgram,
  program: string,
  slug: string,
): Promise<void> {
  const release = svmEngineReleases().get(program);
  if (release === undefined) {
    throw new CliError(
      `${program} is not an engine release this SDK knows, so a cook on it is not run. ` +
        "Nothing was simulated, built or sent",
    );
  }
  if (engineRunsCompiler("svm", program) !== true) {
    throw new CliError(
      `the engine ${engineMismatch(program)}. Nothing was simulated, built or sent`,
    );
  }
  const deployed = await deployedProgram(read, program);
  if (deployed !== undefined && isPinnedProgram(deployed, release.digests)) return;
  throw new CliError(
    `the engine ${program} (v12-svm ${release.version}) is not deployed on ${slug} as that ` +
      `release's build: ${
        deployed === undefined
          ? "the cluster has no such program"
          : "the program there is not that release's engine"
      }. Nothing was simulated, built or sent`,
  );
}

/**
 * Refuses unless each of `needs` is on the cluster as the release's program: the engine first, as
 * the EVM path does. Run before anything is simulated, built or sent. `slug` is the chain the
 * cluster was named as, which the refusal names. The engine is each of `engines`: the installed
 * release's by its packaged bytes, an earlier release's (the engine that owns a Pot made under it)
 * by its committed digest.
 */
export async function requireSolanaRelease(
  read: ReadProgram,
  needs: readonly ProgramName[],
  slug: string,
  released: ReleasedPrograms = packagedRelease(),
  engines: readonly string[] = [v12SvmEngineProgramId()],
): Promise<void> {
  for (const name of ["engine", "Kitchen"] as const) {
    if (!needs.includes(name)) continue;
    for (const program of name === "engine" ? engines : [v12SvmKitchenProgramId()]) {
      if (name === "engine" && program !== v12SvmEngineProgramId()) {
        await requireEarlierEngine(read, program, slug);
        continue;
      }
      const wanted = name === "engine" ? released.engine : [released.kitchen];
      const deployed = await deployedProgram(read, program);
      if (deployed !== undefined && wanted.some((one) => isReleasedProgram(deployed, one))) {
        continue;
      }
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
}

/**
 * The code a local copy runs for `program`: the packaged ELF for the installed release's engine or
 * Kitchen (held to its digest), once the cluster's program is shown to be byte-identical to it;
 * for an earlier release's engine, the cluster's own bytes held to that release's committed digest.
 * Refuses — never substitutes — when the cluster's program is absent or another build.
 */
export async function releasedProgramCode(
  read: ReadProgram,
  program: string,
  build: EngineCluster,
  slug: string,
): Promise<Uint8Array> {
  const set = v12ReleaseSet();
  if (program === v12SvmKitchenProgramId()) {
    await requireSolanaRelease(read, ["Kitchen"], slug);

    return packaged(svmKitchenPath(), "kitchen.so", set["kitchen-svm"].assets["kitchen.so"]);
  }
  if (program === v12SvmEngineProgramId()) {
    await requireSolanaRelease(read, ["engine"], slug);

    return packaged(
      svmEnginePath(build),
      `engine-${build}.so`,
      set["v12-svm"].assets[`engine-${build}.so`],
    );
  }
  const asset = `engine-${build}.so`;
  const digests =
    engineRunsCompiler("svm", program) === true
      ? V12_RELEASE_SETS.flatMap((row) => {
          const digest = row["v12-svm"].engine === program ? row["v12-svm"].assets[asset] : null;

          return digest === null || digest === undefined ? [] : [digest];
        })
      : [];
  const deployed = digests.length === 0 ? undefined : await deployedProgram(read, program);
  if (deployed === undefined || !isPinnedProgram(deployed, digests)) {
    throw new CliError(
      `simulating a cook on a Pot of engine ${program} needs that engine's own code, and ${slug} ` +
        "does not run that release's build: the simulation would run other code. Nothing was " +
        "simulated",
    );
  }

  return deployed.subarray(0, elfLength(deployed)!);
}

/**
 * eco-routes on Solana in LiteSVM: the programs mainnet runs, loaded at their mainnet ids from the
 * dump `scripts/dump-eco-routes-svm.mjs` committed under `test/fixtures/eco-routes-svm/` (each pinned
 * by sha256 in its manifest, held by `eco-routes-svm-fixture.test.ts`), and the accounts their proof
 * path reads, as mainnet held them at the dump's slot. No program is built here: what runs is
 * byte for byte what mainnet runs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { address, lamports, type Address } from "@solana/kit";
import { FeatureSet, LiteSVM } from "litesvm";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "eco-routes-svm");

export interface DumpedProgram {
  readonly name: string;
  readonly programId: string;
  readonly programData: string;
  readonly authority: string | null;
  readonly lastDeploySlot: string;
  readonly size: number;
  readonly sha256: string;
  readonly file: string;
}

export interface DumpedAccount {
  readonly name: string;
  readonly address: string;
  readonly owner: string;
  readonly lamports: string;
  readonly executable: boolean;
  readonly size: number;
  readonly sha256: string;
  readonly file: string;
}

export interface EcoRoutesSvmManifest {
  readonly cluster: string;
  readonly chainId: number;
  readonly slot: string;
  readonly dumpedAt: string;
  readonly programs: readonly DumpedProgram[];
  readonly accounts: readonly DumpedAccount[];
}

export const MANIFEST: EcoRoutesSvmManifest = JSON.parse(
  readFileSync(join(DIR, "manifest.json"), "utf8"),
) as EcoRoutesSvmManifest;

/** The bytes a fixture file holds, unzipped. */
export const fixtureBytes = (file: string): Uint8Array =>
  new Uint8Array(gunzipSync(readFileSync(join(DIR, file))));

const program = (name: string): DumpedProgram => {
  const found = MANIFEST.programs.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no program ${name} in the eco-routes-svm dump`);

  return found;
};

/** A dumped program's id. */
export const programId = (name: string): Address => address(program(name).programId);

/** A dumped account's address. */
export const accountAddress = (name: string): Address => {
  const found = MANIFEST.accounts.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no account ${name} in the eco-routes-svm dump`);

  return address(found.address);
};

/** Every dumped program into `svm` at its mainnet id, and every dumped account as mainnet held it. */
export function loadEcoRoutes(svm: LiteSVM): void {
  for (const entry of MANIFEST.programs) {
    svm.addProgram(address(entry.programId), fixtureBytes(entry.file));
  }
  for (const entry of MANIFEST.accounts) {
    const data = fixtureBytes(entry.file);
    svm.setAccount({
      address: address(entry.address),
      data,
      executable: entry.executable,
      lamports: lamports(BigInt(entry.lamports)),
      programAddress: address(entry.owner),
      space: BigInt(data.length),
    });
  }
}

/**
 * A LiteSVM bank with every dumped program at its mainnet id and every dumped account as mainnet
 * held it, its clock at `unixTimestamp`. SPL Token, Token-2022 and the Associated Token Account
 * program are LiteSVM's own, as on any cluster.
 */
export function ecoRoutesSvm(unixTimestamp: bigint): LiteSVM {
  const svm = new LiteSVM()
    .withFeatureSet(FeatureSet.allEnabled())
    .withBuiltins()
    .withPrecompiles()
    .withSysvars()
    .withDefaultPrograms();
  loadEcoRoutes(svm);
  setTime(svm, unixTimestamp);

  return svm;
}

/** Moves the bank's clock to `unixTimestamp`, a slot on. */
export function setTime(svm: LiteSVM, unixTimestamp: bigint): void {
  const clock = svm.getClock();
  clock.slot = clock.slot + 1n;
  clock.unixTimestamp = unixTimestamp;
  svm.setClock(clock);
}

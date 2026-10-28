/**
 * What the testing kit's Solana suites share. NOT a `.test.ts`.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { address, getAddressEncoder, type Address } from "@solana/kit";

import {
  deriveExecutionFeeConfigPda,
  svmEnginePath,
  svmKitchenPath,
  v12SvmKitchenProgramId,
} from "../../src/testing/sdk.js";
import type { ReplayedState } from "./support.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK_TEST = resolve(HERE, "../../../sdk/test");
const VENUE_PROGRAMS = join(SDK_TEST, "fixtures/svm-venue-programs");
const VENUE_ACCOUNTS = join(SDK_TEST, "svm/fixtures");
const TOKEN_2022_MINTS = join(SDK_TEST, "svm/fixtures/token-2022");

/** A skill's example program, by its path under `skills/`. */
export const skillExample = (path: string): string => resolve(HERE, "../../../skills", path);

/** A recorded Solana state file under `state/`. */
export const solanaState = (name: string): string => resolve(HERE, "state", `${name}.json.gz`);

/**
 * Why the Solana suites cannot run here — the packaged engine and Kitchen are not synced, or LiteSVM
 * is not installed — or false. Under CI it throws instead: a suite CI skips would pass without
 * running.
 */
export function solanaMissing(): string | false {
  const why = (() => {
    try {
      svmEnginePath("mainnet");
      svmKitchenPath();
    } catch {
      return (
        "the SVM engine binaries are not synced (pnpm --filter './sdk' sync-engine-artifacts " +
        "--fetch-v12-engines)"
      );
    }
    try {
      createRequire(import.meta.url).resolve("litesvm/package.json");
    } catch {
      return "LiteSVM is not installed";
    }
    return false;
  })();
  if (why !== false && process.env.CI) {
    throw new Error(`${why}, and CI must run the testing kit's Solana suites`);
  }

  return why;
}

/**
 * Recording the committed Solana state files again: `RECAPTURE_SOLANA_STATE=1`. They are read from
 * the pinned cluster below, so recording needs no RPC either.
 */
export const recordingSolana = process.env.RECAPTURE_SOLANA_STATE === "1";

interface VenueManifest {
  readonly slot: number;
  readonly unixTimestamp: number;
  readonly programs: readonly {
    readonly programId: string;
    readonly programData: string;
    readonly lastDeploySlot: string;
    readonly sha256: string;
    readonly file: string;
  }[];
  readonly pools: readonly { readonly name: string; readonly pool: string }[];
  readonly accounts: readonly {
    readonly address: string;
    readonly owner: string;
    readonly lamports?: string;
    readonly file: string;
  }[];
}

const venues = JSON.parse(
  readFileSync(join(VENUE_PROGRAMS, "manifest.json"), "utf8"),
) as VenueManifest;

/** A pool of the SDK's pinned venue dump, by its name there (`orca-whirlpool-sol-usdc`). */
export function pinnedPool(name: string): Address {
  const pool = venues.pools.find((one) => one.name === name);
  if (pool === undefined) throw new Error(`no pool ${name} in the pinned venue dump`);

  return address(pool.pool);
}

/** The slot and time the pinned venue dump was read at: the pinned cluster's clock. */
export const PINNED = { slot: BigInt(venues.slot), unixTimestamp: BigInt(venues.unixTimestamp) };

interface SolanaStateFile {
  programs: Record<string, string | { sha256: string }>;
}

/** The pinned venue dump's program `programId` at `sha256`, its ELF; or why it cannot be had. */
function venueProgram(programId: string, sha256: string): Buffer | string {
  const pinned = venues.programs.find((one) => one.programId === programId);
  if (pinned?.sha256 !== sha256) {
    return `the venue dump does not pin ${programId} at sha256 ${sha256}`;
  }
  let elf: Buffer;
  try {
    elf = gunzipSync(readFileSync(join(VENUE_PROGRAMS, pinned.file)));
  } catch {
    return `${pinned.file} is not in ${relative(process.cwd(), VENUE_PROGRAMS)}`;
  }
  const actual = createHash("sha256").update(elf).digest("hex");

  return actual === sha256 ? elf : `${pinned.file} hashes to ${actual}, not its pin ${sha256}`;
}

/**
 * A committed Solana state file pins each third-party program by its sha256 (`{ sha256 }`) instead of
 * holding its ELF, which is the venue dump's (`sdk/test/fixtures/svm-venue-programs`), fetched from
 * mainnet by
 * `pnpm --filter './sdk' fetch-program-fixtures --rpc-config fixtures.rpc.config.json`.
 * This writes the file the kit replays:
 * `state`'s, with each program's ELF put back, in a directory of its own.
 */
export function replaySolanaState(state: string): ReplayedState {
  const file = JSON.parse(gunzipSync(readFileSync(state)).toString("utf8")) as SolanaStateFile;
  const missing: string[] = [];
  for (const [programId, program] of Object.entries(file.programs)) {
    if (typeof program === "string") continue;
    const elf = venueProgram(programId, program.sha256);
    if (typeof elf === "string") missing.push(elf);
    else file.programs[programId] = elf.toString("base64");
  }
  if (missing.length > 0) {
    throw new Error(
      `${relative(process.cwd(), state)} pins programs that cannot be put back: ` +
        `${missing.join("; ")}. Run ` +
        "`pnpm --filter './sdk' fetch-program-fixtures --rpc-config fixtures.rpc.config.json`",
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "sauce-testing-solana-state-"));
  const path = join(dir, "state.json.gz");
  writeFileSync(path, gzipSync(JSON.stringify(file)));

  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * After recording `state`: each program's ELF replaced by its sha256, the form the file is committed
 * in. A program the venue dump does not pin at that hash is refused: nothing would put it back.
 */
export function pinSolanaPrograms(state: string): void {
  const file = JSON.parse(gunzipSync(readFileSync(state)).toString("utf8")) as SolanaStateFile;
  for (const [programId, program] of Object.entries(file.programs)) {
    if (typeof program !== "string") continue;
    const sha256 = createHash("sha256").update(Buffer.from(program, "base64")).digest("hex");
    const elf = venueProgram(programId, sha256);
    if (typeof elf === "string") throw new Error(`cannot pin ${programId} in ${state}: ${elf}`);
    file.programs[programId] = { sha256 };
  }
  writeFileSync(state, gzipSync(JSON.stringify(file), { level: 9 }));
}

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const SYSVAR = "Sysvar1111111111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WRAPPED_SOL = address("So11111111111111111111111111111111111111112");
/** Mainnet's epochs: 432,000 slots, no warmup. */
const SLOTS_PER_EPOCH = 432_000n;
/** The Kitchen's execution fee on mainnet, as the SDK's Solana suites charge it. */
export const MAINNET_FEE = 85_672n;

type Served = { owner: string; data: Buffer; lamports?: bigint; executable?: boolean };

/**
 * Solana mainnet as the SDK's pinned dumps hold it, served on loopback by the SDK's Solana RPC stub
 * (`sdk/scripts/solana-rpc-stub.mjs`): every venue program (an upgradeable program and its program
 * data) and pool account of `test/fixtures/svm-venue-programs`, the Token-2022 mints of
 * `test/svm/fixtures/token-2022`, the Kitchen's fee config at mainnet's fee, and the clock, rent and
 * epoch schedule at the venue dump's slot. What a fork records from it is mainnet's own accounts.
 */
export async function pinnedCluster(): Promise<{
  readonly url: string;
  readonly methods: Map<string, number>;
  close(): Promise<void>;
}> {
  const accounts: Record<string, Served> = {};
  for (const program of venues.programs) {
    const programData = Buffer.alloc(45);
    programData.writeUInt32LE(3, 0);
    programData.writeBigUInt64LE(BigInt(program.lastDeploySlot), 4);
    accounts[program.programData] = {
      owner: UPGRADEABLE_LOADER,
      data: Buffer.concat([
        programData,
        gunzipSync(readFileSync(join(VENUE_PROGRAMS, program.file))),
      ]),
    };
    const account = Buffer.alloc(36);
    account.writeUInt32LE(2, 0);
    account.set(getAddressEncoder().encode(address(program.programData)), 4);
    accounts[program.programId] = { owner: UPGRADEABLE_LOADER, data: account, executable: true };
  }
  for (const account of venues.accounts) {
    const raw = readFileSync(join(VENUE_ACCOUNTS, account.file));
    const data = Buffer.from(
      (
        JSON.parse((account.file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as {
          base64Data: string;
        }
      ).base64Data,
      "base64",
    );
    // An account the dump recorded no lamports for holds its rent (the stub's, mainnet's), and a
    // wrapped-SOL token account its amount on top, as `venue-fixture.ts#restoreVenues` reads it.
    const wrapped =
      account.owner === TOKEN &&
      data.length === 165 &&
      data.subarray(0, 32).equals(Buffer.from(getAddressEncoder().encode(WRAPPED_SOL)));
    accounts[account.address] = {
      owner: account.owner,
      data,
      ...(account.lamports !== undefined
        ? { lamports: BigInt(account.lamports) }
        : wrapped
          ? { lamports: (128n + 165n) * 5080n + data.readBigUInt64LE(64) }
          : {}),
    };
  }
  const stocks = JSON.parse(readFileSync(join(TOKEN_2022_MINTS, "stock-mints.json"), "utf8")) as {
    mints: Record<string, { mint: string; owner: string; dataBase64: string }>;
  };
  const real = JSON.parse(
    readFileSync(join(TOKEN_2022_MINTS, "real-mints.json"), "utf8"),
  ) as Record<string, { mint: string; owner: string; dataBase64: string }>;
  for (const mint of [...Object.values(stocks.mints), ...Object.values(real)]) {
    accounts[mint.mint] = { owner: mint.owner, data: Buffer.from(mint.dataBase64, "base64") };
  }
  // The clock at the dump's slot and time; mainnet's epoch schedule.
  const epoch = PINNED.slot / SLOTS_PER_EPOCH;
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(PINNED.slot, 0);
  clock.writeBigInt64LE(PINNED.unixTimestamp, 8);
  clock.writeBigUInt64LE(epoch, 16);
  clock.writeBigUInt64LE(epoch + 1n, 24);
  clock.writeBigInt64LE(PINNED.unixTimestamp, 32);
  accounts["SysvarC1ock11111111111111111111111111111111"] = { owner: SYSVAR, data: clock };
  const schedule = Buffer.alloc(33);
  schedule.writeBigUInt64LE(SLOTS_PER_EPOCH, 0);
  schedule.writeBigUInt64LE(SLOTS_PER_EPOCH, 8);
  accounts["SysvarEpochSchedu1e111111111111111111111111"] = { owner: SYSVAR, data: schedule };

  const kitchen = v12SvmKitchenProgramId();
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(address(kitchen));
  const { solanaRpcStub } = (await import(
    pathToFileURL(resolve(HERE, "../../../sdk/scripts/solana-rpc-stub.mjs")).href
  )) as {
    solanaRpcStub(options: Record<string, unknown>): Promise<{
      url: string;
      methods: Map<string, number>;
      close(): Promise<void>;
    }>;
  };

  return solanaRpcStub({ kitchen, feeConfig, fee: MAINNET_FEE, accounts, slot: PINNED.slot });
}

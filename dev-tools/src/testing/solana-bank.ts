/**
 * A Solana chain for a test: LiteSVM in this process, the released engine and Kitchen at their
 * program ids, and every other account read the first time a test names it — from the cluster
 * (record and live), from a recorded state file (replay), or from nowhere (an empty local chain).
 *
 * A Solana transaction names every account it touches, and a program can reach no other, so the
 * accounts a test reads are exactly those its transactions name, and the programs among them. The
 * bank reads each before it runs the first transaction naming it: a program's code from its program
 * data. A recording is every account read so, as the cluster held it when first read, with the
 * cluster's clock, rent and epoch schedule; nothing in it says where it was read from.
 *
 * A Solana node serves an account only as it is now: no endpoint reads one at an earlier slot. So a
 * recording pins the slot it read at, and replays there, rather than a slot a test chooses.
 *
 * LiteSVM keeps no snapshots of its own. The bank snapshots what it knows of: every account it has
 * read or written, and the clock. A test reaches nothing else.
 *
 * LiteSVM is an optional peer dependency of the package: a project that tests on Solana installs
 * it, at the version the package pins, as one that tests on an EVM chain installs Foundry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  createSolanaRpc,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  lamports,
  type Address,
  type AddressesByLookupTableAddress,
  type Transaction,
} from "@solana/kit";
import type { LiteSVM } from "litesvm";

import { RUNTIME_MANIFEST, svmEnginePath, svmKitchenPath } from "./sdk.js";

type LiteSvmModule = typeof import("litesvm");

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;
const RENT = "SysvarRent111111111111111111111111111111111" as Address;
const EPOCH_SCHEDULE = "SysvarEpochSchedu1e111111111111111111111111" as Address;
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const LOADER_V4 = "LoaderV411111111111111111111111111111111111";
const LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111" as Address;
/** `UpgradeableLoaderState::ProgramData`: a u32 tag, the deploy slot, an `Option<Pubkey>`. */
const PROGRAM_DATA_HEADER = 4 + 8 + 1 + 32;
/** `LoaderV4State`: the slot, the authority, the status. */
const LOADER_V4_HEADER = 8 + 32 + 8;
/** SIMD-0268, the deeper CPI stack mainnet has not turned on: off, as the cluster has it. */
const CPI_NESTING_8 = "6TkHkRmP7JZy1fdM6fg5uXn76wChQBWGokHBJzrLB3mj" as Address;
/** The first slot of an epoch schedule's warmup epochs: 32 slots, doubling. */
const MINIMUM_SLOTS_PER_EPOCH = 32n;

let loading: Promise<LiteSvmModule> | undefined;

/**
 * LiteSVM, from the project's own install, at the version the package pins (`sdk/runtime`, which
 * the `sauce` command's Solana simulations take too): another version runs another runtime, whose
 * results need not be the ones `sauce simulate` shows.
 */
function liteSvm(): Promise<LiteSvmModule> {
  return (loading ??= (async () => {
    const pin = (
      JSON.parse(readFileSync(RUNTIME_MANIFEST, "utf8")) as { dependencies: { litesvm: string } }
    ).dependencies.litesvm;
    const install = `npm i -D litesvm@${pin}`;
    let version: string | undefined;
    try {
      const manifest = createRequire(import.meta.url).resolve("litesvm/package.json");
      version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version;
    } catch {
      throw new Error(
        `the testing kit runs Solana in LiteSVM, which this project does not have: ${install}`,
      );
    }
    if (version !== pin) {
      throw new Error(
        `the testing kit runs Solana in litesvm ${pin}, the version the package pins, and this ` +
          `project has ${version ?? "an unreadable version"}: ${install}`,
      );
    }
    try {
      return await import("litesvm");
    } catch (error) {
      throw new Error(
        `litesvm ${pin} is installed but does not load here ` +
          `(${(error as Error).message.split("\n")[0]}): it ships native binaries for Linux and ` +
          "macOS on x64 and arm64",
        { cause: error },
      );
    }
  })());
}

/** An account as the bank holds it. */
export interface BankAccount {
  readonly lamports: bigint;
  readonly owner: Address;
  readonly data: Uint8Array;
  readonly executable: boolean;
}

/** An account read from a cluster or a recording, with a program's code where it is one. */
interface ReadAccount extends BankAccount {
  /** A program's code: from its program data under the upgradeable loader. */
  readonly code?: Uint8Array;
}

/** The cluster's clock, rent and epoch schedule, as a fork starts from them. */
export interface ClusterHeader {
  readonly clock: {
    readonly slot: bigint;
    readonly epochStartTimestamp: bigint;
    readonly epoch: bigint;
    readonly leaderScheduleEpoch: bigint;
    readonly unixTimestamp: bigint;
  };
  readonly rent?: {
    readonly lamportsPerByteYear: bigint;
    readonly exemptionThreshold: number;
    readonly burnPercent: number;
  };
  readonly epochSchedule?: {
    readonly slotsPerEpoch: bigint;
    readonly leaderScheduleSlotOffset: bigint;
    readonly warmup: boolean;
    readonly firstNormalEpoch: bigint;
    readonly firstNormalSlot: bigint;
  };
}

/** Where a bank reads an account it does not hold yet. */
export interface AccountSource {
  read(keys: readonly Address[]): Promise<readonly (ReadAccount | null)[]>;
}

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

/** The cluster's clock, rent and epoch schedule from their sysvars' data. */
function headerOf(
  clock: Uint8Array,
  rent: Uint8Array | undefined,
  schedule: Uint8Array | undefined,
): ClusterHeader {
  const c = view(clock);
  return {
    clock: {
      slot: c.getBigUint64(0, true),
      epochStartTimestamp: c.getBigInt64(8, true),
      epoch: c.getBigUint64(16, true),
      leaderScheduleEpoch: c.getBigUint64(24, true),
      unixTimestamp: c.getBigInt64(32, true),
    },
    ...(rent === undefined || rent.length < 17
      ? {}
      : {
          rent: {
            lamportsPerByteYear: view(rent).getBigUint64(0, true),
            exemptionThreshold: view(rent).getFloat64(8, true),
            burnPercent: rent[16]!,
          },
        }),
    ...(schedule === undefined || schedule.length < 33
      ? {}
      : {
          epochSchedule: {
            slotsPerEpoch: view(schedule).getBigUint64(0, true),
            leaderScheduleSlotOffset: view(schedule).getBigUint64(8, true),
            warmup: schedule[16] !== 0,
            firstNormalEpoch: view(schedule).getBigUint64(17, true),
            firstNormalSlot: view(schedule).getBigUint64(25, true),
          },
        }),
  };
}

/** A program's code, from its account and, under the upgradeable loader, its program data. */
function codeOf(account: BankAccount, programData?: BankAccount | null): Uint8Array | undefined {
  if (account.owner === UPGRADEABLE_LOADER) return programData?.data.subarray(PROGRAM_DATA_HEADER);
  if (account.owner === LOADER_V4) return account.data.subarray(LOADER_V4_HEADER);

  return account.data;
}

/**
 * A cluster read through `rpcUrl`, a hundred accounts to a request. An error never carries the
 * URL: it may hold a key.
 */
export function clusterSource(rpcUrl: string): AccountSource & {
  header(): Promise<ClusterHeader>;
} {
  const rpc = createSolanaRpc(rpcUrl);
  const ask = async <T>(what: string, request: () => Promise<T>): Promise<T> => {
    try {
      return await request();
    } catch (error) {
      const message = String((error as Error).message ?? error)
        .split(rpcUrl)
        .join("<the RPC>")
        .split("\n")[0];
      // The cause is left off on purpose: it carries the URL.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`reading ${what} from the cluster failed: ${message}`);
    }
  };
  const fetch = async (keys: readonly Address[]): Promise<(BankAccount | null)[]> => {
    const found: (BankAccount | null)[] = [];
    for (let at = 0; at < keys.length; at += 100) {
      const chunk = keys.slice(at, at + 100);
      const { value } = await ask(`${chunk.length} accounts`, () =>
        rpc.getMultipleAccounts([...chunk], { encoding: "base64" }).send(),
      );
      found.push(
        ...value.map((account) =>
          account === null
            ? null
            : {
                lamports: BigInt(account.lamports),
                owner: account.owner,
                data: new Uint8Array(getBase64Encoder().encode(account.data[0])),
                executable: account.executable,
              },
        ),
      );
    }

    return found;
  };

  return {
    async read(keys) {
      const accounts = await fetch(keys);
      // A program's code is its program data's, past the loader's header.
      const programs = accounts.flatMap((account) =>
        account?.executable === true && account.owner === UPGRADEABLE_LOADER
          ? [getAddressDecoder().decode(account.data.subarray(4, 36))]
          : [],
      );
      const data = new Map(
        (await fetch(programs)).map((account, index) => [programs[index]!, account]),
      );

      return accounts.map((account) => {
        if (account === null || !account.executable) return account;
        const programData =
          account.owner === UPGRADEABLE_LOADER
            ? data.get(getAddressDecoder().decode(account.data.subarray(4, 36)))
            : undefined;
        const code = codeOf(account, programData);

        return code === undefined ? account : { ...account, code };
      });
    },
    async header() {
      const [clock, rent, schedule] = await fetch([CLOCK, RENT, EPOCH_SCHEDULE]);
      if (clock !== null && clock !== undefined && clock.data.length >= 40) {
        return headerOf(clock.data, rent?.data, schedule?.data);
      }
      // An endpoint that serves no sysvar: its slot and that slot's time.
      const slot = await ask("the slot", () => rpc.getSlot({ commitment: "confirmed" }).send());
      const time = await ask("the block time", () => rpc.getBlockTime(slot).send()).catch(
        () => null,
      );
      const bytes = new Uint8Array(40);
      view(bytes).setBigUint64(0, slot, true);
      view(bytes).setBigInt64(32, BigInt(time ?? Math.floor(Date.now() / 1000)), true);

      return headerOf(bytes, rent?.data, schedule?.data);
    },
  };
}

// ---- The state file ---------------------------------------------------------------------------

interface StoredAccount {
  readonly lamports: string;
  readonly owner: string;
  readonly executable: boolean;
  /** Base64. */
  readonly data: string;
}

interface SolanaStateFile {
  readonly sauce: {
    readonly version: 1;
    readonly chain: string;
    readonly clock: Record<keyof ClusterHeader["clock"], string>;
    readonly rent?: {
      readonly lamportsPerByteYear: string;
      readonly exemptionThreshold: number;
      readonly burnPercent: number;
    };
    readonly epochSchedule?: {
      readonly slotsPerEpoch: string;
      readonly leaderScheduleSlotOffset: string;
      readonly warmup: boolean;
      readonly firstNormalEpoch: string;
      readonly firstNormalSlot: string;
    };
  };
  /** Every account the recording read, `null` where the cluster held none. */
  readonly accounts: Readonly<Record<string, StoredAccount | null>>;
  /** Each program's code (base64), where an account read was one. */
  readonly programs: Readonly<Record<string, string>>;
}

const base64 = (bytes: Uint8Array): string => getBase64Decoder().decode(bytes);
const bytesOf = (text: string): Uint8Array => new Uint8Array(getBase64Encoder().encode(text));

/** A recorded state file: its header, and its accounts as a source that knows what it lacks. */
export function stateSource(path: string): AccountSource & {
  readonly chain: string;
  readonly header: ClusterHeader;
  /** The keys asked for that the recording does not hold: read as missing. */
  readonly unrecorded: Set<Address>;
} {
  let file: SolanaStateFile;
  try {
    file = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as SolanaStateFile;
  } catch (error) {
    throw new Error(`${path} is not a recorded Solana state file: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (file.sauce?.version !== 1 || file.accounts === undefined) {
    throw new Error(`${path} is not a recorded Solana state file`);
  }
  const { clock, rent, epochSchedule } = file.sauce;
  const unrecorded = new Set<Address>();

  return {
    chain: file.sauce.chain,
    header: {
      clock: {
        slot: BigInt(clock.slot),
        epochStartTimestamp: BigInt(clock.epochStartTimestamp),
        epoch: BigInt(clock.epoch),
        leaderScheduleEpoch: BigInt(clock.leaderScheduleEpoch),
        unixTimestamp: BigInt(clock.unixTimestamp),
      },
      ...(rent === undefined
        ? {}
        : { rent: { ...rent, lamportsPerByteYear: BigInt(rent.lamportsPerByteYear) } }),
      ...(epochSchedule === undefined
        ? {}
        : {
            epochSchedule: {
              slotsPerEpoch: BigInt(epochSchedule.slotsPerEpoch),
              leaderScheduleSlotOffset: BigInt(epochSchedule.leaderScheduleSlotOffset),
              warmup: epochSchedule.warmup,
              firstNormalEpoch: BigInt(epochSchedule.firstNormalEpoch),
              firstNormalSlot: BigInt(epochSchedule.firstNormalSlot),
            },
          }),
    },
    unrecorded,
    async read(keys) {
      return keys.map((key) => {
        if (!Object.hasOwn(file.accounts, key)) {
          unrecorded.add(key);
          return null;
        }
        const stored = file.accounts[key];
        if (stored === null || stored === undefined) return null;
        const code = file.programs[key];

        return {
          lamports: BigInt(stored.lamports),
          owner: stored.owner as Address,
          data: bytesOf(stored.data),
          executable: stored.executable,
          ...(code === undefined ? {} : { code: bytesOf(code) }),
        };
      });
    },
  };
}

/** Writes `accounts`, read from a cluster with `header`, as a state file at `path`. */
function writeState(
  path: string,
  chain: string,
  header: ClusterHeader,
  accounts: ReadonlyMap<Address, ReadAccount | null>,
  rpcUrl: string,
): void {
  const text = (value: bigint) => value.toString();
  const file: SolanaStateFile = {
    sauce: {
      version: 1,
      chain,
      clock: {
        slot: text(header.clock.slot),
        epochStartTimestamp: text(header.clock.epochStartTimestamp),
        epoch: text(header.clock.epoch),
        leaderScheduleEpoch: text(header.clock.leaderScheduleEpoch),
        unixTimestamp: text(header.clock.unixTimestamp),
      },
      ...(header.rent === undefined
        ? {}
        : {
            rent: {
              ...header.rent,
              lamportsPerByteYear: text(header.rent.lamportsPerByteYear),
            },
          }),
      ...(header.epochSchedule === undefined
        ? {}
        : {
            epochSchedule: {
              slotsPerEpoch: text(header.epochSchedule.slotsPerEpoch),
              leaderScheduleSlotOffset: text(header.epochSchedule.leaderScheduleSlotOffset),
              warmup: header.epochSchedule.warmup,
              firstNormalEpoch: text(header.epochSchedule.firstNormalEpoch),
              firstNormalSlot: text(header.epochSchedule.firstNormalSlot),
            },
          }),
    },
    // Sorted, so recording the same accounts again writes the same file.
    accounts: Object.fromEntries(
      [...accounts.keys()].sort().map((key) => {
        const account = accounts.get(key)!;
        return [
          key,
          account === null
            ? null
            : {
                lamports: text(account.lamports),
                owner: account.owner,
                executable: account.executable,
                // A program's code is kept once, under `programs`.
                data:
                  account.code !== undefined && account.owner !== UPGRADEABLE_LOADER
                    ? ""
                    : base64(account.data),
              },
        ];
      }),
    ),
    programs: Object.fromEntries(
      [...accounts.entries()]
        .filter(([, account]) => account?.code !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, account]) => [key, base64(account!.code!)]),
    ),
  };
  const json = JSON.stringify(file);
  // The URL may hold a key: a state file that mentions it is never written.
  const host = (() => {
    try {
      return new URL(rpcUrl).host;
    } catch {
      return rpcUrl;
    }
  })();
  if (json.includes(rpcUrl) || (host !== "" && json.includes(host))) {
    throw new Error(`the recording mentions the RPC it read from, so ${path} was not written`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(json));
}

/** Whether `path` holds a recording to replay. */
export const recorded = (path: string): boolean => existsSync(path);

// ---- The bank ---------------------------------------------------------------------------------

/** What a transaction did. */
export interface Sent {
  readonly ok: boolean;
  /** The runtime's error, as the JSON-RPC API reports one. */
  readonly err?: unknown;
  readonly logs: readonly string[];
  readonly units: bigint;
  readonly returnData: Uint8Array;
  readonly signature: string;
  /** Every account the message names, in its order (the order an error's index counts). */
  readonly accounts: readonly Address[];
  /** The accounts it may write, as they were before it and as it left them. */
  readonly writable: ReadonlyMap<
    Address,
    { before: BankAccount | null; after: BankAccount | null }
  >;
}

/**
 * LiteSVM's fieldless transaction errors in their order (its `TransactionErrorFieldless`, a const
 * enum the package does not export at run time), so a failure says its name and not its number.
 */
const TRANSACTION_ERRORS = [
  "AccountInUse",
  "AccountLoadedTwice",
  "AccountNotFound",
  "ProgramAccountNotFound",
  "InsufficientFundsForFee",
  "InvalidAccountForFee",
  "AlreadyProcessed",
  "BlockhashNotFound",
  "CallChainTooDeep",
  "MissingSignatureForFee",
  "InvalidAccountIndex",
  "SignatureFailure",
  "InvalidProgramForExecution",
  "SanitizeFailure",
  "ClusterMaintenance",
  "AccountBorrowOutstanding",
  "WouldExceedMaxBlockCostLimit",
  "UnsupportedVersion",
  "InvalidWritableAccount",
  "WouldExceedMaxAccountCostLimit",
  "WouldExceedAccountDataBlockLimit",
  "TooManyAccountLocks",
  "AddressLookupTableNotFound",
  "InvalidAddressLookupTableOwner",
  "InvalidAddressLookupTableData",
  "InvalidAddressLookupTableIndex",
  "InvalidRentPayingAccount",
  "WouldExceedMaxVoteCostLimit",
  "WouldExceedAccountDataTotalLimit",
  "MaxLoadedAccountsDataSizeExceeded",
  "ResanitizationNeeded",
  "InvalidLoadedAccountsDataSizeLimit",
  "UnbalancedTransaction",
  "ProgramCacheHitMaxLimit",
  "CommitCancelled",
];

/** Its `InstructionErrorFieldless`, likewise. */
const INSTRUCTION_ERRORS = [
  "GenericError",
  "InvalidArgument",
  "InvalidInstructionData",
  "InvalidAccountData",
  "AccountDataTooSmall",
  "InsufficientFunds",
  "IncorrectProgramId",
  "MissingRequiredSignature",
  "AccountAlreadyInitialized",
  "UninitializedAccount",
  "UnbalancedInstruction",
  "ModifiedProgramId",
  "ExternalAccountLamportSpend",
  "ExternalAccountDataModified",
  "ReadonlyLamportChange",
  "ReadonlyDataModified",
  "DuplicateAccountIndex",
  "ExecutableModified",
  "RentEpochModified",
  "NotEnoughAccountKeys",
  "AccountDataSizeChanged",
  "AccountNotExecutable",
  "AccountBorrowFailed",
  "AccountBorrowOutstanding",
  "DuplicateAccountOutOfSync",
  "InvalidError",
  "ExecutableDataModified",
  "ExecutableLamportChange",
  "ExecutableAccountNotRentExempt",
  "UnsupportedProgramId",
  "CallDepth",
  "MissingAccount",
  "ReentrancyNotAllowed",
  "MaxSeedLengthExceeded",
  "InvalidSeeds",
  "InvalidRealloc",
  "ComputationalBudgetExceeded",
  "PrivilegeEscalation",
  "ProgramEnvironmentSetupFailure",
  "ProgramFailedToComplete",
  "ProgramFailedToCompile",
  "Immutable",
  "IncorrectAuthority",
  "AccountNotRentExempt",
  "InvalidAccountOwner",
  "ArithmeticOverflow",
  "UnsupportedSysvar",
  "IllegalOwner",
  "MaxAccountsDataAllocationsExceeded",
  "MaxAccountsExceeded",
  "MaxInstructionTraceLengthExceeded",
  "BuiltinProgramsMustConsumeComputeUnits",
  "BorshIoError",
];

/** LiteSVM's error, as the JSON-RPC API reports one: `{ InstructionError: [index, { Custom: n }] }`,
 *  `{ InstructionError: [index, "Name"] }`, `{ InsufficientFundsForRent: { account_index } }`, or a
 *  name. */
function rpcError(err: unknown): unknown {
  if (typeof err === "number") return TRANSACTION_ERRORS[err] ?? String(err);
  const detail = err as { index?: number; err?: () => unknown; accountIndex?: number };
  if (typeof detail.index === "number" && typeof detail.err === "function") {
    const inner = detail.err() as { code?: number; msg?: string } | number;
    return {
      InstructionError: [
        detail.index,
        typeof inner === "number"
          ? (INSTRUCTION_ERRORS[inner] ?? String(inner))
          : typeof inner.code === "number"
            ? { Custom: inner.code }
            : { BorshIoError: inner.msg },
      ],
    };
  }
  if (typeof detail.accountIndex === "number") {
    // InsufficientFundsForRent or ProgramExecutionTemporarilyRestricted, by the class's own name.
    const name = (
      /^(?:TransactionError)?(\w+)/.exec(String(err))?.[1] ?? "TransactionError"
    ).replace(/^TransactionError/, "");
    return { [name]: { account_index: detail.accountIndex } };
  }

  return String(err);
}

interface Snapshot {
  readonly accounts: ReadonlyMap<Address, BankAccount | null>;
  readonly clock: ClusterHeader["clock"];
}

/** How the bank was opened: what it reads an account it does not hold from. */
export type BankMode = "replay" | "record" | "live" | "local";

export class Bank {
  /** The keys read once, and what they held then: what a revert puts back a key read since. */
  private readonly first = new Map<Address, BankAccount | null>();
  /** What a recording writes: each account as read, with a program's code. */
  private readonly read = new Map<Address, ReadAccount | null>();
  /** The keys the bank holds without reading them: its own programs and sysvars, and what it made. */
  private readonly own = new Set<Address>();
  private readonly snapshots: Snapshot[] = [];

  private constructor(
    private readonly lite: LiteSvmModule,
    private readonly svm: LiteSVM,
    readonly mode: BankMode,
    private readonly source: AccountSource | undefined,
    readonly header: ClusterHeader,
    /** Replay: the keys the recording did not hold, read as missing. */
    readonly unrecorded: ReadonlySet<Address>,
  ) {}

  /**
   * Opens a bank at `header`'s clock (the cluster's rent and epoch schedule, where it has them), the
   * engine and the Kitchen at `engine` and `kitchen`, reading what it does not hold from `source`.
   */
  static async open(options: {
    readonly mode: BankMode;
    readonly source?: AccountSource;
    readonly header: ClusterHeader;
    readonly engine: Address;
    readonly kitchen: Address;
    readonly unrecorded?: ReadonlySet<Address>;
  }): Promise<Bank> {
    const lite = await liteSvm();
    const features = lite.FeatureSet.allEnabled();
    features.deactivate(new Uint8Array(getAddressEncoder().encode(CPI_NESTING_8)));
    let svm = new lite.LiteSVM()
      .withFeatureSet(features)
      .withBuiltins()
      .withPrecompiles()
      .withSysvars()
      .withDefaultPrograms()
      // Every transaction is built on a blockhash of its own (`blockhash()`), which a check of the
      // latest one only would refuse once another has gone first.
      .withBlockhashCheck(false);
    // An empty chain has the native mints a cluster is born with; a fork reads the cluster's.
    if (options.mode === "local") svm = svm.withNativeMints();
    svm.addProgramFromFile(options.engine, svmEnginePath("mainnet"));
    svm.addProgramFromFile(options.kitchen, svmKitchenPath());
    const { rent, epochSchedule } = options.header;
    if (rent !== undefined) {
      svm.setRent(
        new lite.Rent(rent.lamportsPerByteYear, rent.exemptionThreshold, rent.burnPercent),
      );
    }
    if (epochSchedule !== undefined) {
      svm.setEpochSchedule(
        new lite.EpochSchedule(
          epochSchedule.slotsPerEpoch,
          epochSchedule.leaderScheduleSlotOffset,
          epochSchedule.warmup,
          epochSchedule.firstNormalEpoch,
          epochSchedule.firstNormalSlot,
        ),
      );
    }
    const bank = new Bank(
      lite,
      svm,
      options.mode,
      options.source,
      options.header,
      options.unrecorded ?? new Set(),
    );
    bank.setClock(options.header.clock);

    return bank;
  }

  /** The clock now. */
  clock(): ClusterHeader["clock"] {
    const clock = this.svm.getClock();
    return {
      slot: clock.slot,
      epochStartTimestamp: clock.epochStartTimestamp,
      epoch: clock.epoch,
      leaderScheduleEpoch: clock.leaderScheduleEpoch,
      unixTimestamp: clock.unixTimestamp,
    };
  }

  private setClock(clock: ClusterHeader["clock"]): void {
    this.svm.warpToSlot(clock.slot);
    this.svm.setClock(
      new this.lite.Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp,
      ),
    );
  }

  /** The epoch `slot` falls in, by the bank's epoch schedule (Solana's `get_epoch`). */
  private epochOf(slot: bigint): bigint {
    const schedule = this.svm.getEpochSchedule();
    if (slot >= schedule.firstNormalSlot) {
      return (slot - schedule.firstNormalSlot) / schedule.slotsPerEpoch + schedule.firstNormalEpoch;
    }
    // Warmup: epochs of 32 slots, doubling. trailing_zeros(next_power_of_two(n)) is ceil(log2(n)).
    const n = slot + MINIMUM_SLOTS_PER_EPOCH + 1n;
    const log2 = (n - 1n).toString(2).length;

    return BigInt(log2 - 5 - 1);
  }

  /** Moves the clock to `slot` and `unixTimestamp`, its epoch with it. */
  moveClock(slot: bigint, unixTimestamp: bigint): void {
    const now = this.clock();
    const epoch = this.epochOf(slot);
    const schedule = this.svm.getEpochSchedule();
    this.setClock({
      slot,
      epoch,
      // A new epoch starts now: the cluster records when its first slot came.
      epochStartTimestamp: epoch === now.epoch ? now.epochStartTimestamp : unixTimestamp,
      // Solana's `get_leader_schedule_epoch`: the next epoch's while warming up.
      leaderScheduleEpoch:
        slot < schedule.firstNormalSlot
          ? epoch + 1n
          : this.epochOf(slot + schedule.leaderScheduleSlotOffset),
      unixTimestamp,
    });
  }

  /**
   * Reads every one of `keys` the bank does not hold yet from its source, as a transaction naming
   * them would need: an account, or a program and its code. The bank's own programs and sysvars
   * are never read.
   */
  async ensure(keys: readonly Address[]): Promise<void> {
    const wanted = [...new Set(keys)].filter((key) => !this.first.has(key) && !this.own.has(key));
    const toRead = wanted.filter((key) => {
      const held = this.svm.getAccount(key);
      if (held.exists) this.own.add(key);
      return !held.exists;
    });
    if (toRead.length === 0) return;
    const accounts =
      this.source === undefined ? toRead.map(() => null) : await this.source.read(toRead);
    toRead.forEach((key, index) => {
      // Read meanwhile by another call, and perhaps written since: what the bank holds stands.
      if (this.first.has(key) || this.own.has(key)) return;
      const account = accounts[index] ?? null;
      if (this.mode === "record") this.read.set(key, account);
      if (account?.executable === true && account.code !== undefined) {
        // A program: its code, at its id. Programs never change in a test, so it is the bank's own.
        this.svm.addProgram(key, account.code);
        this.own.add(key);
        return;
      }
      this.first.set(key, account === null ? null : { ...account });
      if (account !== null) this.put(key, account);
    });
  }

  /** The lamports that keep an account of `size` bytes rent-exempt. */
  rentExempt(size: number): bigint {
    return this.svm.minimumBalanceForRentExemption(BigInt(size));
  }

  /** `key` as the bank holds it now, or `null`. Read it first (`ensure`). */
  account(key: Address): BankAccount | null {
    const found = this.svm.getAccount(key);
    return found.exists
      ? {
          lamports: found.lamports,
          owner: found.programAddress,
          data: new Uint8Array(found.data),
          executable: found.executable,
        }
      : null;
  }

  /** Sets `key` to `account`, or removes it (`null`). Read it first (`ensure`). */
  set(key: Address, account: BankAccount | null): void {
    if (this.own.has(key)) {
      const held = this.account(key);
      if (held?.executable === true) throw new Error(`${key} is a program: the kit changes none`);
      // One of the bank's own sysvars or mints, written from now on: a snapshot puts it back too.
      this.own.delete(key);
      this.first.set(key, held);
    }
    if (!this.first.has(key)) throw new Error(`internal: ${key} is set before it is read`);
    this.put(key, account);
  }

  private put(key: Address, account: BankAccount | null): void {
    // A zero-lamport account is no account: the runtime holds none at its key.
    this.svm.setAccount({
      address: key,
      data: account?.data ?? new Uint8Array(),
      executable: account?.executable ?? false,
      lamports: lamports(account?.lamports ?? 0n),
      programAddress: account?.owner ?? SYSTEM_PROGRAM,
      space: BigInt(account?.data.length ?? 0),
    });
  }

  /**
   * A lookup table holding `addresses`, made at `key` as the cluster would hold one already
   * extended (`sauce simulate` makes the same): the bank, like a cluster, takes no transaction past
   * 1,232 bytes.
   */
  table(key: Address, addresses: readonly Address[]): AddressesByLookupTableAddress {
    // `ProgramState::LookupTable`: never deactivating, extended at slot 0, before the bank's clock.
    const data = new Uint8Array(56 + 32 * addresses.length);
    view(data).setUint32(0, 1, true);
    view(data).setBigUint64(4, 0xffff_ffff_ffff_ffffn, true);
    addresses.forEach((one, index) => data.set(getAddressEncoder().encode(one), 56 + 32 * index));
    if (!this.first.has(key)) this.first.set(key, null);
    this.put(key, {
      lamports: this.svm.minimumBalanceForRentExemption(BigInt(data.length)),
      owner: LOOKUP_TABLE_PROGRAM,
      data,
      executable: false,
    });

    return { [key]: [...addresses] } as AddressesByLookupTableAddress;
  }

  /** Every account `transaction`'s message names, in its order, and which of them it may write. */
  private messageAccounts(transaction: Transaction): {
    readonly accounts: Address[];
    readonly writable: Address[];
  } {
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
      header: {
        numSignerAccounts: number;
        numReadonlySignerAccounts: number;
        numReadonlyNonSignerAccounts: number;
      };
      staticAccounts: readonly Address[];
      addressTableLookups?: readonly {
        lookupTableAddress: Address;
        writableIndexes: readonly number[];
        readonlyIndexes: readonly number[];
      }[];
    };
    const { header, staticAccounts } = message;
    const lookups = message.addressTableLookups ?? [];
    const loaded = (pick: "writableIndexes" | "readonlyIndexes") =>
      lookups.flatMap((lookup) => {
        const table = this.account(lookup.lookupTableAddress);
        return lookup[pick].map((index) =>
          getAddressDecoder().decode(table!.data.subarray(56 + 32 * index, 88 + 32 * index)),
        );
      });
    const signers = header.numSignerAccounts;
    const ownWritable = staticAccounts.filter((_, index) =>
      index < signers
        ? index < signers - header.numReadonlySignerAccounts
        : index < staticAccounts.length - header.numReadonlyNonSignerAccounts,
    );
    const loadedWritable = loaded("writableIndexes");

    return {
      accounts: [...staticAccounts, ...loadedWritable, ...loaded("readonlyIndexes")],
      writable: [...ownWritable, ...loadedWritable],
    };
  }

  /** Runs `transaction`, every account it names read first, and keeps what it changes. */
  async send(transaction: Transaction): Promise<Sent> {
    const { accounts, writable } = this.messageAccounts(transaction);
    await this.ensure(accounts);
    const before = new Map(writable.map((key) => [key, this.account(key)] as const));
    const result = this.svm.sendTransaction(transaction);
    const failed = result instanceof this.lite.FailedTransactionMetadata;
    const meta = failed ? result.meta() : result;

    return {
      ok: !failed,
      ...(failed ? { err: rpcError(result.err()) } : {}),
      logs: meta.logs(),
      units: meta.computeUnitsConsumed(),
      returnData: new Uint8Array(meta.returnData().data()),
      signature: getBase58Decoder().decode(meta.signature()),
      accounts,
      writable: new Map(
        writable.map((key) => [key, { before: before.get(key)!, after: this.account(key) }]),
      ),
    };
  }

  /** A blockhash no transaction was built on yet: one for the next, so no two are the same. */
  blockhash(): string {
    this.svm.expireBlockhash();
    return this.svm.latestBlockhash();
  }

  /** Remembers every account the bank knows, and the clock. */
  snapshot(): void {
    this.snapshots.push({
      accounts: new Map([...this.first.keys()].map((key) => [key, this.account(key)])),
      clock: this.clock(),
    });
  }

  /** Puts back the last snapshot: each account it knew as it was, each read since as it was read. */
  revert(): void {
    const snapshot = this.snapshots.pop();
    if (snapshot === undefined) throw new Error("revert() with no snapshot() to return to");
    for (const [key, first] of this.first) {
      this.put(key, snapshot.accounts.has(key) ? snapshot.accounts.get(key)! : first);
    }
    this.setClock(snapshot.clock);
  }

  /** Writes what the bank read from the cluster, and its header, to `path` (record mode). */
  writeRecording(path: string, chain: string, rpcUrl: string): void {
    writeState(path, chain, this.header, this.read, rpcUrl);
  }
}

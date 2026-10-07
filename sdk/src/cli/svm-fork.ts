/**
 * A local copy of what a Solana cook touches, for rehearsing one no cluster can simulate: a cook
 * whose program must be staged into a code buffer first. Staging takes transactions of its own,
 * which `simulateTransaction` cannot run ahead of the cook without sending them, so the rehearsal
 * runs in LiteSVM instead: the released engine and Kitchen the package ships, every account the
 * cook names read from the cluster as it is now (a program's code from its program data), and the
 * clock set to the cluster's. Nothing is signed: the copy checks no signature.
 *
 * LiteSVM is a dependency of the package, imported here only when a rehearsal needs it, so no other
 * command loads it and nothing outside the CLI reaches it. It is native code: on a platform it ships
 * no binary for, the import fails, and the error says so.
 */
import {
  getAddressDecoder,
  getAddressEncoder,
  lamports,
  type Address,
  type AddressesByLookupTableAddress,
  type createSolanaRpc,
  type Transaction,
} from "@solana/kit";
import type { Clock as ClockType, LiteSVM as LiteSVMType } from "litesvm";

import type { SimulatedAccount } from "../svm/index.js";

import { svmEnginePath, svmKitchenPath } from "../svm/engine-artifacts.js";
import { CliError } from "./args.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111" as Address;
const LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** Where the copy keeps the lookup table it makes: a key no cluster account has. */
const TABLE_KEY = "SauceRehearsa1LookupTab1e111111111111111111";
/** `UpgradeableLoaderState::ProgramData`: a u32 tag, the deploy slot, an `Option<Pubkey>`. */
const PROGRAM_DATA_HEADER = 4 + 8 + 1 + 32;
/** SIMD-0268, the deeper CPI stack mainnet has not turned on: off, as the cluster has it. */
const CPI_NESTING_8 = "6TkHkRmP7JZy1fdM6fg5uXn76wChQBWGokHBJzrLB3mj";

/** What a transaction did in the copy. */
export interface ForkRun {
  readonly ok: boolean;
  /** The runtime's error, where it failed. */
  readonly err?: unknown;
  readonly logs: readonly string[];
  readonly units: bigint;
  readonly returnData: Uint8Array;
}

export interface Fork {
  readonly svm: LiteSVMType;
  /** The slot the accounts were read at, which the copy's clock is set to. */
  readonly slot: bigint;
  /** How many of the accounts asked for exist on the cluster, programs included. */
  readonly loaded: number;
  /** Runs `transaction`, keeping what it changes. */
  send(transaction: Transaction): ForkRun;
  /** Runs `transaction` without keeping it, and reports `watched` as it leaves them. */
  simulate(
    transaction: Transaction,
    watched: readonly Address[],
  ): ForkRun & { readonly after: readonly (SimulatedAccount | null)[] };
  /** `key` in the copy now. */
  account(key: Address): SimulatedAccount | null;
  /**
   * A lookup table holding `addresses`, made in the copy as the cluster would hold one already
   * extended: the copy, like a cluster, takes no transaction past 1,232 bytes.
   */
  table(addresses: readonly Address[]): AddressesByLookupTableAddress;
  /**
   * Sets `key` to a token account of `mint` held by `holder` under `program`, holding `amount`:
   * an existing one keeps all but its balance (wrapped SOL its lamports to match), a missing one is
   * made in the token programs' base layout, initialized.
   */
  tokenAccount(
    key: Address,
    mint: Address,
    holder: Address,
    program: Address,
    amount: bigint,
  ): void;
}

/**
 * A runtime error as the JSON-RPC API reports it, so the command reads the copy's failures as it
 * reads a cluster's: `{ InstructionError: [index, { Custom: code }] }`, or the error's text.
 */
/**
 * LiteSVM's fieldless transaction errors in their order (its `TransactionErrorFieldless`, a const
 * enum the package does not export at run time), so a failure says its name and not its number.
 */
export const FIELDLESS = [
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

function rpcError(err: unknown): unknown {
  const detail = err as { index?: number; err?: () => unknown };
  if (typeof detail.index === "number" && typeof detail.err === "function") {
    const inner = detail.err() as { code?: number } | number;

    return {
      InstructionError: [
        detail.index,
        typeof inner === "object" && inner !== null && "code" in inner
          ? { Custom: inner.code }
          : String(inner),
      ],
    };
  }

  return typeof err === "number" ? (FIELDLESS[err] ?? String(err)) : String(err);
}

/** The cluster's accounts at `keys`, `null` where one does not exist, read 100 at a time. */
/** An account as the cluster held it, or `null` where it held none. */
type ClusterAccount = {
  data: Uint8Array;
  owner: Address;
  lamports: bigint;
  executable: boolean;
} | null;

/**
 * The cluster's state as one local copy read it: every account, its slot and its time. Handed to
 * the next copy, it reads nothing it already holds, so rehearsals that share one rehearse on one
 * slot (`sauce_simulate`'s scenarios on Solana).
 */
export interface ForkSnapshot {
  readonly accounts: Map<Address, ClusterAccount>;
  slot?: bigint;
  time?: bigint | null;
}

/** A snapshot to share between local copies: empty until the first reads it. */
export const forkSnapshot = (): ForkSnapshot => ({ accounts: new Map() });

/** The cluster's accounts at `keys`, `null` where one does not exist, read 100 at a time (only
 *  those `snapshot` does not hold, which it keeps). */
async function read(
  rpc: Rpc,
  ask: <T>(what: string, request: () => Promise<T>) => Promise<T>,
  keys: readonly Address[],
  snapshot: ForkSnapshot = forkSnapshot(),
): Promise<ClusterAccount[]> {
  const missing = [...new Set(keys)].filter((key) => !snapshot.accounts.has(key));
  for (let at = 0; at < missing.length; at += 100) {
    const chunk = missing.slice(at, at + 100);
    const { value } = await ask("the accounts the cook names", () =>
      rpc.getMultipleAccounts([...chunk], { encoding: "base64" }).send(),
    );
    value.forEach((account, index) =>
      snapshot.accounts.set(
        chunk[index]!,
        account === null
          ? null
          : {
              data: new Uint8Array(Buffer.from(account.data[0], "base64")),
              owner: account.owner,
              lamports: BigInt(account.lamports),
              executable: account.executable,
            },
      ),
    );
  }

  return keys.map((key) => snapshot.accounts.get(key) ?? null);
}

/**
 * Opens a local copy of `keys` as the cluster holds them, with the engine and the Kitchen at their
 * program ids. `ask` makes each request, naming what it reads when it fails.
 */
export async function openFork(
  rpc: Rpc,
  ask: <T>(what: string, request: () => Promise<T>) => Promise<T>,
  keys: readonly Address[],
  engine: Address,
  kitchen: Address,
  snapshot: ForkSnapshot = forkSnapshot(),
): Promise<Fork> {
  let litesvm: typeof import("litesvm");
  try {
    litesvm = await import("litesvm");
  } catch (error) {
    throw new CliError(
      "rehearsing this cook runs it in a local copy of the accounts it names, with LiteSVM, which " +
        `does not load here (${(error as Error).message.split("\n")[0]}): it ships native ` +
        "binaries for Linux and macOS on x64 and arm64. Send the cook with `sauce run`, " +
        "which stages it and rehearses the staged cook on the cluster first",
    );
  }
  const { Clock, FailedTransactionMetadata, FeatureSet, LiteSVM, Rent } = litesvm;
  const features = FeatureSet.allEnabled();
  features.deactivate(new Uint8Array(getAddressEncoder().encode(CPI_NESTING_8 as Address)));
  const svm = new LiteSVM()
    .withFeatureSet(features)
    .withBuiltins()
    .withPrecompiles()
    .withSysvars()
    .withDefaultPrograms()
    .withSigverify(false)
    .withBlockhashCheck(false);
  svm.addProgramFromFile(engine, svmEnginePath("mainnet"));
  svm.addProgramFromFile(kitchen, svmKitchenPath());

  // The cluster's rent, which is not LiteSVM's default: an account the cluster holds rent-exempt
  // must stay so in the copy when the cook pays into it, as the Kitchen's fee config is paid.
  const unique = [...new Set(keys)].filter((key) => key !== engine && key !== kitchen);
  const [rent, ...accounts] = await read(rpc, ask, [RENT_SYSVAR, ...unique], snapshot);
  if (rent !== null && rent !== undefined && rent.data.length >= 17) {
    const view = new DataView(rent.data.buffer, rent.data.byteOffset, rent.data.byteLength);
    svm.setRent(new Rent(view.getBigUint64(0, true), view.getFloat64(8, true), rent.data[16]!));
  }
  let loaded = 0;
  for (const [index, account] of accounts.entries()) {
    const key = unique[index]!;
    if (account === null) continue;
    loaded++;
    if (account.executable) {
      // A program the copy has built in (the token programs, memo, the system program) stays.
      const present = svm.getAccount(key);
      if (present.exists && present.executable) continue;
      if (account.owner === UPGRADEABLE_LOADER) {
        const programData = getAddressDecoder().decode(account.data.subarray(4, 36));
        const [data] = await read(rpc, ask, [programData], snapshot);
        if (data !== null) svm.addProgram(key, data.data.subarray(PROGRAM_DATA_HEADER));
      } else {
        svm.addProgram(key, account.data);
      }
      continue;
    }
    svm.setAccount({
      address: key,
      data: account.data,
      executable: false,
      lamports: lamports(account.lamports),
      programAddress: account.owner,
      space: BigInt(account.data.length),
    });
  }
  // The slot and time once a snapshot holds them: every copy of it rehearses on that one slot.
  snapshot.slot ??= await ask("the slot", () => rpc.getSlot({ commitment: "confirmed" }).send());
  const slot = snapshot.slot;
  if (snapshot.time === undefined) {
    snapshot.time = await ask("the block time", () => rpc.getBlockTime(slot).send()).catch(
      () => null,
    );
  }
  const time = snapshot.time;
  svm.warpToSlot(slot);
  svm.setClock(
    new Clock(
      slot,
      0n,
      0n,
      0n,
      time === null ? BigInt(Math.floor(Date.now() / 1000)) : BigInt(time),
    ) as ClockType,
  );

  const account = (key: Address): SimulatedAccount | null => {
    const found = svm.getAccount(key);
    return found.exists
      ? {
          lamports: found.lamports,
          owner: found.programAddress,
          data: new Uint8Array(found.data),
          executable: found.executable,
        }
      : null;
  };
  const outcome = (
    result:
      InstanceType<typeof FailedTransactionMetadata> | ReturnType<LiteSVMType["sendTransaction"]>,
  ): ForkRun => {
    const failed = result instanceof FailedTransactionMetadata;
    const meta = failed ? result.meta() : result;
    return {
      ok: !failed,
      ...(failed ? { err: rpcError(result.err()) } : {}),
      logs: meta.logs(),
      units: meta.computeUnitsConsumed(),
      returnData: new Uint8Array(meta.returnData().data()),
    };
  };

  const table = (addresses: readonly Address[]): AddressesByLookupTableAddress => {
    const encoder = getAddressEncoder();
    // `ProgramState::LookupTable`: never deactivating, extended at slot 0, before the copy's clock.
    const data = new Uint8Array(56 + 32 * addresses.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, 1, true);
    view.setBigUint64(4, 0xffff_ffff_ffff_ffffn, true);
    addresses.forEach((key, index) => data.set(encoder.encode(key), 56 + 32 * index));
    svm.setAccount({
      address: TABLE_KEY as Address,
      data,
      executable: false,
      lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      programAddress: LOOKUP_TABLE_PROGRAM as Address,
      space: BigInt(data.length),
    });

    return { [TABLE_KEY]: [...addresses] } as AddressesByLookupTableAddress;
  };

  const tokenAccount = (
    key: Address,
    mint: Address,
    holder: Address,
    program: Address,
    amount: bigint,
  ): void => {
    const encoder = getAddressEncoder();
    const existing = account(key);
    const data = existing === null ? new Uint8Array(165) : new Uint8Array(existing.data);
    const rent = svm.minimumBalanceForRentExemption(BigInt(data.length));
    if (existing === null) {
      data.set(encoder.encode(mint), 0);
      data.set(encoder.encode(holder), 32);
      data[108] = 1; // initialized
      if (mint === WRAPPED_SOL) {
        data[109] = 1; // is_native: Some(rent)
        new DataView(data.buffer).setBigUint64(113, rent, true);
      }
    }
    new DataView(data.buffer).setBigUint64(64, amount, true);
    svm.setAccount({
      address: key,
      data,
      executable: false,
      lamports: lamports(mint === WRAPPED_SOL ? rent + amount : (existing?.lamports ?? rent)),
      programAddress: existing?.owner ?? program,
      space: BigInt(data.length),
    });
  };

  return {
    svm,
    slot,
    loaded,
    account,
    table,
    tokenAccount,
    send: (transaction) => {
      svm.expireBlockhash();
      return outcome(svm.sendTransaction(transaction));
    },
    simulate: (transaction, watched) => {
      const result = svm.simulateTransaction(transaction);
      if (result instanceof FailedTransactionMetadata)
        return { ...outcome(result), after: watched.map(account) };
      const post = result.postAccounts();
      const meta = result.meta();
      return {
        ok: true,
        logs: meta.logs(),
        units: meta.computeUnitsConsumed(),
        returnData: new Uint8Array(meta.returnData().data()),
        after: watched.map((key) => {
          const found = post.find((entry) => entry.address === key);
          if (found === undefined) return account(key);
          return found.lamports > 0n
            ? {
                lamports: found.lamports,
                owner: found.programAddress,
                data: new Uint8Array(found.data),
                executable: found.executable,
              }
            : null;
        }),
      };
    },
  };
}

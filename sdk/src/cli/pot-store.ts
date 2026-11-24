/**
 * The `sauce` command's Pot store: every Pot it deploys, and every Pot `sauce pot import` names,
 * kept on disk with the release it was minted under — so what was deployed, and which engine and
 * compiler it works with, is known without recomputing an address under whatever release the SDK
 * pins today.
 *
 * One file per Pot, `<dir>/<chain>/<pot>.json`, IMMUTABLE: written to a temporary file beside it
 * and LINKED into place, which fails if the name exists, so the content appears whole and two
 * writers cannot both win. `<chain>` is the chain id, and on Solana a cluster other than mainnet's
 * after it (`1399811149-devnet`): the Kitchen's id is the same on every cluster, so a devnet Pot
 * has a mainnet Pot's address, and is never filed as it. A Solana Pot is Solana's record of its
 * cluster whichever SVM chain made or found it (`pots.ts`): `solana-devnet`'s and
 * `solana-testnet`'s are filed there too.
 * The loser of a race finds the file there and checks it names the same Pot (the same chain,
 * cluster, address, owner, salt and Kitchen).
 * A second record of it with no other deployment — its import after its deployment, the same
 * transaction read back — adds nothing, and the first is kept. A second DEPLOYMENT of one Pot
 * address is kept beside the first, as `<pot>@<tx>.json`, and said: one of the two landed on a
 * fork or another network with the same chain id, or the Pot was closed and created again (on
 * Solana), and neither is the store's to drop. Nothing is ever read, changed and written back.
 *
 * A record says what its file says only where it is that file's own: `filesOf` and `listFiles` give
 * each record with its path and whether it is `bound` (in its chain's directory, under its Pot's
 * name). One filed under any other name was moved or edited, and a reader that takes a Pot's
 * release or engine from the store takes it from a bound record alone (`cook-pot.ts`).
 *
 * A record holds only public chain data: no key, password or endpoint. What a Pot holds, and
 * whether it is still there, is read from the chain every time. NODE-ONLY (the filesystem), and it
 * imports nothing at run time but Node's own modules, so a test runs it in processes of its own;
 * the executable keeps it under `~/.sauce/pots` (`main.ts`), and `--pots <dir>` names another.
 */
import { linkSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { PotKind } from "../deployments/pot.js";

/** The record schema this store reads and writes. */
export const POT_SCHEMA = "sauce.pot/1" as const;

/** One Pot, as the store keeps it. Addresses as the chain spells them (EIP-55, or base58). */
export interface PotRecord {
  readonly schema: typeof POT_SCHEMA;
  readonly chain: string;
  readonly chainId: number;
  readonly pot: string;
  /** The zero address for a Shared Pot. */
  readonly owner: string;
  /** The owner's 32-byte salt, as hex. */
  readonly salt: string;
  readonly kind: PotKind;
  /** Solana: the cluster it was created on, told by its genesis hash — `mainnet-beta`, `devnet`,
   *  `testnet`, or the hash itself for any other (a local validator). */
  readonly cluster?: string;
  /** The Kitchen that minted it: the proxy on an EVM chain, the program on Solana. */
  readonly kitchen: string;
  /** EVM, up to kitchen-evm 1.3.0: the init-code hash its address is CREATE2 under. */
  readonly potInitCodeHash?: string;
  /** EVM, from kitchen-evm 1.4.0: the hash its proxy is CREATE2 under (the Pot is CREATE3). */
  readonly potProxyInitCodeHash?: string;
  /** EVM, from kitchen-evm 1.4.0: the Pot profile its engine authenticates. */
  readonly potProfileHash?: string;
  /** The engine its cooks run on: its release's (EVM), or the program its creation named (Solana). */
  readonly engine?: string;
  /**
   * The release set it was minted under (`deployments/releases.json`): the compiler whose programs
   * run on it, and the engine's and Kitchen's versions. Absent when no release the SDK knows minted
   * it — a Kitchen upgraded past this SDK.
   */
  readonly release?: Readonly<Record<string, string>>;
  /** The version of the package that recorded it. */
  readonly sdk: string;
  /** Whether this command deployed it, or `sauce pot import` found it deployed. */
  readonly origin: "deployed" | "imported";
  /** The transaction that deployed it, where this command sent or saw it: its hash (on Solana the
   *  signature), block (the slot), the block's hash on an EVM chain (which tells a fork's block
   *  from the chain's), and its sender. */
  readonly deployment?: {
    readonly tx: string;
    readonly block: string;
    readonly blockHash?: string;
    readonly from: string;
  };
  /** When it was recorded (ISO 8601). */
  readonly recordedAt: string;
}

/** Where Pots are kept by the executable, unless `--pots` says otherwise. */
export const defaultPotsDir = (): string => join(homedir(), ".sauce", "pots");

/** Solana's mainnet, as a record names its cluster: filed under the chain id alone. */
export const MAINNET_CLUSTER = "mainnet-beta";

/** What two records of one Pot agree on. */
const identity = (record: PotRecord): string =>
  JSON.stringify([
    record.chainId,
    record.cluster ?? null,
    record.pot.toLowerCase(),
    record.owner.toLowerCase(),
    record.salt.toLowerCase(),
    record.kitchen.toLowerCase(),
  ]);

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** The directory of a chain's Pots: its id, and a cluster other than Solana mainnet's after it. */
function chainDir(chainId: number, cluster: string | undefined): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`chain id ${chainId} is not a chain id`);
  }
  if (cluster === undefined || cluster === MAINNET_CLUSTER) return String(chainId);
  if (!/^[a-z]+(-[a-z]+)*$/.test(cluster) && !BASE58.test(cluster)) {
    throw new Error(`'${cluster}' is not a cluster`);
  }

  return `${chainId}-${cluster}`;
}
const CHAIN_DIR = /^\d+(-[0-9A-Za-z-]+)?$/;

/** A Pot's address as a file name's stem: an EVM address lowercased, a base58 one as it is. */
const stemOf = (pot: string): string => {
  const name = pot.startsWith("0x") ? pot.toLowerCase() : pot;
  if (!/^(0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(name)) {
    throw new Error(`'${pot}' is not a Pot address`);
  }

  return name;
};

/** The file of another deployment of a Pot, kept beside its first: named by its transaction. */
const besideOf = (stem: string, tx: string): string => {
  const name = tx.startsWith("0x") ? tx.toLowerCase() : tx;
  if (!/^0x[0-9a-f]{64}$/.test(name) && !(BASE58.test(name) && name.length <= 90)) {
    throw new Error(`'${tx}' is not a transaction`);
  }

  return `${stem}@${name}.json`;
};

// ---------------------------------------------------------------------------------------------
// How a note says what a record or a path says
// ---------------------------------------------------------------------------------------------

/** What a record's fields hold when they are what they should be: a version, a hash, an address, a date, a kind. */
const FIELD_TEXT = /^[\w.:+-]{1,200}$/;

/** What the name of a file of the store is made of when it holds nothing a terminal needs protecting from. */
const PATH_TEXT = /^[\w.:@/+-]{1,1000}$/;

/** `value` as `plain` says a token, and otherwise quoted, cut at `limit` characters. */
function said(value: unknown, plain: RegExp, limit: number): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : String(JSON.stringify(value));
  } catch {
    text = Object.prototype.toString.call(value);
  }

  return plain.test(text)
    ? text
    : JSON.stringify(text.slice(0, limit)).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "?");
}

/**
 * A string a record supplies, as a note says it. A record is a file anyone can edit, and so is the
 * name it is filed under; a note reaches a terminal and the MCP server's tool results, which read
 * their notes as the server's own, so what a record says is never a line of a note's own. A plain
 * token (letters, digits and `.:+_-`: a version, a hash, an address, a date, a kind) is said as it is,
 * so a valid record reads as it is written; anything else is quoted, at most `limit` characters, on
 * one line, with what a terminal cannot be trusted to print replaced. What is not a string is said
 * as JSON says it, and nothing a record can hold makes this throw.
 */
export const recordText = (value: unknown, limit = 80): string => said(value, FIELD_TEXT, limit);

/**
 * The path of a file of the store, as a note says it: as it is where it is made of letters, digits
 * and `.:@/+_-`, otherwise quoted, at most 1000 characters, on one line.
 */
export const pathText = (path: string): string => said(path, PATH_TEXT, 1000);

/** The fields every record has, and their type. */
const FIELDS = {
  chain: "string",
  chainId: "number",
  pot: "string",
  owner: "string",
  salt: "string",
  kind: "string",
  kitchen: "string",
  sdk: "string",
  origin: "string",
  recordedAt: "string",
} as const;

/**
 * Whether `value` is a record's `deployment`: an object of the strings `tx`, `block` and `from`, and
 * `blockHash` where it has one.
 */
function isDeployment(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const given = value as Record<string, unknown>;

  return (
    ["tx", "block", "from"].every((field) => typeof given[field] === "string") &&
    (given.blockHash === undefined || typeof given.blockHash === "string")
  );
}

/**
 * Whether `value` is a record's `release`: an object of strings that names its compiler, then each
 * component's version (`v12-evm` and `kitchen-evm` on an EVM chain, `v12-svm` and `kitchen-svm` on
 * Solana). What reads a release takes it for that, and trips on `null` or a string.
 */
function isRelease(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const given: Record<string, unknown> = Object.fromEntries(Object.entries(value));

  return (
    typeof given.compiler === "string" &&
    Object.values(given).every((one) => typeof one === "string")
  );
}

/**
 * `parsed`, read from the file `where` says (a path said as a note says it, or what the caller calls
 * the record), as a record: refused unless it has every field a record has.
 */
function asRecord(where: string, parsed: unknown): PotRecord {
  const record = parsed as Record<string, unknown> | null;
  if (record === null || typeof record !== "object" || record.schema !== POT_SCHEMA) {
    throw new Error(`${where}: schema ${JSON.stringify(record?.schema)} is not ${POT_SCHEMA}`);
  }
  const missing = Object.entries(FIELDS)
    .filter(([field, type]) => typeof record[field] !== type)
    .map(([field]) => field);
  if (missing.length > 0) {
    throw new Error(`${where} is not a Pot record: it has no ${missing.join(", ")}`);
  }
  if (record.deployment !== undefined && !isDeployment(record.deployment)) {
    throw new Error(
      `${where} is not a Pot record: its deployment is not an object of the strings tx, block and ` +
        "from (and blockHash, where it has one)",
    );
  }
  if (record.release !== undefined && !isRelease(record.release)) {
    throw new Error(
      `${where} is not a Pot record: its release is not an object of strings that names its compiler`,
    );
  }
  if (record.cluster !== undefined && typeof record.cluster !== "string") {
    throw new Error(`${where} is not a Pot record: its cluster is not a string`);
  }

  return record as unknown as PotRecord;
}

/** A record, with the file it was read from. */
export interface StoredPot {
  readonly record: PotRecord;
  /** The file's path. */
  readonly path: string;
  /**
   * Whether the file is the record's own: in its chain's directory (a cluster's after the chain id
   * on Solana), named for its Pot's address, or for another deployment of it by that address and
   * the deployment's transaction. A record filed under any other name was moved or edited, and says
   * nothing of the Pot its file names.
   */
  readonly bound: boolean;
}

/** Whether `record`, read from the file `name` of the directory `folder`, is bound to it. */
function filedAs(folder: string, name: string, record: PotRecord): boolean {
  try {
    if (folder !== chainDir(record.chainId, record.cluster)) return false;
    const stem = stemOf(record.pot);

    return (
      name === `${stem}.json` ||
      (record.deployment !== undefined && name === besideOf(stem, record.deployment.tx))
    );
  } catch {
    return false;
  }
}

/** What `list()` and `filesOf` say of a file they cannot read, which they leave out. */
const unreadable = (error: unknown): string =>
  `warning: ${error instanceof Error ? error.message : String(error)}; that Pot is left out`;

export class PotStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /**
   * Keeps `record`: `"created"` when this call wrote the Pot's first record; `"beside"` when it
   * wrote another deployment of the same Pot address beside it (see the header); `"exists"` when
   * it adds nothing — the same deployment, or no deployment at all, recorded already, and the
   * record kept is the first. A different Pot under the same name — impossible unless a file was
   * edited — is an error, and the file is left as it was.
   */
  save(record: PotRecord): "created" | "exists" | "beside" {
    asRecord("the record", record);
    const dir = join(this.dir, chainDir(record.chainId, record.cluster));
    // Owner-only, as every directory under ~/.sauce is, whatever the umask.
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stem = stemOf(record.pot);
    const first = this.link(dir, `${stem}.json`, record);
    if (first === "created") return "created";
    const kept = this.recordsOf(record.chainId, record.pot, record.cluster);
    if (identity(kept[0]!) !== identity(record)) {
      throw new Error(
        `${join(dir, `${stem}.json`)} holds a different Pot under the same address: it was edited, ` +
          "so it is left as it is",
      );
    }
    const tx = record.deployment?.tx;
    if (tx === undefined || kept.some((one) => one.deployment?.tx === tx)) return "exists";

    return this.link(dir, besideOf(stem, tx), record) === "created" ? "beside" : "exists";
  }

  /** Writes `record` as `name` in `dir`, unless the name is taken: linked into place, whole. */
  private link(dir: string, name: string, record: PotRecord): "created" | "taken" {
    const temporary = join(
      dir,
      `.${name}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, join(dir, name));

      return "created";
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;

      return "taken";
    } finally {
      unlinkSync(temporary);
    }
  }

  private read(path: string): PotRecord {
    const where = pathText(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`${where} is not JSON`, { cause: error });
    }

    return asRecord(where, parsed);
  }

  /**
   * Every record of `pot` on chain `chainId` (on Solana, `cluster`'s): its first, then each other
   * deployment kept beside it, oldest first; none when the store holds none.
   */
  recordsOf(chainId: number, pot: string, cluster?: string): PotRecord[] {
    const dir = join(this.dir, chainDir(chainId, cluster));
    const stem = stemOf(pot);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }
    const first = names.includes(`${stem}.json`) ? [this.read(join(dir, `${stem}.json`))] : [];
    const beside = names
      .filter((name) => name.startsWith(`${stem}@`) && name.endsWith(".json"))
      .map((name) => this.read(join(dir, name)))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    return [...first, ...beside];
  }

  /**
   * `recordsOf`, each record with the file it was read from and whether that is its own file
   * ({@link StoredPot.bound}); a file it cannot read is a warning, not a throw, so a caller that
   * only asks what a Pot is does not fail on a damaged one. The Pot's first file first, then each
   * other deployment kept beside it, oldest first.
   */
  filesOf(
    chainId: number,
    pot: string,
    cluster?: string,
  ): { readonly files: StoredPot[]; readonly warnings: string[] } {
    const folder = chainDir(chainId, cluster);
    const stem = stemOf(pot);
    let names: string[];
    try {
      names = readdirSync(join(this.dir, folder));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { files: [], warnings: [] };
      throw error;
    }
    const warnings: string[] = [];
    const read = (name: string): StoredPot | undefined => {
      try {
        return this.stored(folder, name);
      } catch (error) {
        warnings.push(unreadable(error));

        return undefined;
      }
    };
    const first = names.includes(`${stem}.json`) ? [read(`${stem}.json`)] : [];
    const beside = names
      .filter((name) => name.startsWith(`${stem}@`) && name.endsWith(".json"))
      .map(read)
      .filter((one): one is StoredPot => one !== undefined)
      .sort((a, b) => a.record.recordedAt.localeCompare(b.record.recordedAt));

    return {
      files: [...first.filter((one): one is StoredPot => one !== undefined), ...beside],
      warnings,
    };
  }

  /** The record of the file `name` in the directory `folder`, with its path and whether it is bound. */
  private stored(folder: string, name: string): StoredPot {
    const path = join(this.dir, folder, name);
    const record = this.read(path);

    return { record, path, bound: filedAs(folder, name, record) };
  }

  /**
   * Every file the store holds, each with its record, oldest first, and a warning for each file it
   * cannot read (not JSON, another schema, a field missing), which is left out.
   */
  listFiles(): { readonly files: StoredPot[]; readonly warnings: string[] } {
    let chains: string[];
    try {
      chains = readdirSync(this.dir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { files: [], warnings: [] };
      throw error;
    }
    const files: StoredPot[] = [];
    const warnings: string[] = [];
    for (const chain of chains.filter((name) => CHAIN_DIR.test(name))) {
      for (const name of readdirSync(join(this.dir, chain))) {
        if (name.startsWith(".") || !name.endsWith(".json")) continue;
        try {
          files.push(this.stored(chain, name));
        } catch (error) {
          warnings.push(unreadable(error));
        }
      }
    }
    files.sort((a, b) => a.record.recordedAt.localeCompare(b.record.recordedAt));

    return { files, warnings };
  }

  /**
   * Every record the store holds, oldest first, and a warning for each file it cannot read (not
   * JSON, another schema, a field missing), which is left out.
   */
  list(): { readonly pots: PotRecord[]; readonly warnings: string[] } {
    const { files, warnings } = this.listFiles();

    return { pots: files.map((one) => one.record), warnings };
  }
}

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
 * has a mainnet Pot's address, and is never filed as it. The loser of a race finds the file there
 * and checks it names the same Pot (the same chain, cluster, address, owner, salt and Kitchen).
 * A second record of it with no other deployment — its import after its deployment, the same
 * transaction read back — adds nothing, and the first is kept. A second DEPLOYMENT of one Pot
 * address is kept beside the first, as `<pot>@<tx>.json`, and said: one of the two landed on a
 * fork or another network with the same chain id, or the Pot was closed and created again (on
 * Solana), and neither is the store's to drop. Nothing is ever read, changed and written back.
 *
 * A record holds only public chain data: no key, password or endpoint. What a Pot holds, and
 * whether it is still there, is read from the chain every time. NODE-ONLY (the filesystem), and it
 * imports nothing at run time but Node's own modules, so a test runs it in processes of its own;
 * the executable keeps it under `~/.sauce/pots` (`main.ts`), and `--pots <dir>` names another.
 */
import { linkSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The record schema this store reads and writes. */
export const POT_SCHEMA = "sauce.pot/1" as const;

/** How the Kitchen minted the Pot: a Private Pot its owner cooks (`deployPot(owner, salt)`), one
 *  whose Router is fixed at mint (`deployPot(owner, salt, true)`), or a Shared Pot anyone cooks
 *  (`deploySharedPot(salt)`, no owner). A Solana Pot is always its owner's. */
export type PotKind = "private" | "private-fixed-router" | "shared";

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
  /** EVM: the init-code hash its address is CREATE2 under, which the engine that cooks it gates on. */
  readonly potInitCodeHash?: string;
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

/** `parsed`, read from `path`, as a record: refused unless it has every field a record has. */
function asRecord(path: string, parsed: unknown): PotRecord {
  const record = parsed as Record<string, unknown> | null;
  if (record === null || typeof record !== "object" || record.schema !== POT_SCHEMA) {
    throw new Error(`${path}: schema ${JSON.stringify(record?.schema)} is not ${POT_SCHEMA}`);
  }
  const missing = Object.entries(FIELDS)
    .filter(([field, type]) => typeof record[field] !== type)
    .map(([field]) => field);
  if (missing.length > 0) {
    throw new Error(`${path} is not a Pot record: it has no ${missing.join(", ")}`);
  }

  return record as unknown as PotRecord;
}

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`${path} is not JSON`, { cause: error });
    }

    return asRecord(path, parsed);
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
   * Every record the store holds, oldest first, and a warning for each file it cannot read (not
   * JSON, another schema, a field missing), which is left out.
   */
  list(): { readonly pots: PotRecord[]; readonly warnings: string[] } {
    let chains: string[];
    try {
      chains = readdirSync(this.dir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { pots: [], warnings: [] };
      throw error;
    }
    const pots: PotRecord[] = [];
    const warnings: string[] = [];
    for (const chain of chains.filter((name) => CHAIN_DIR.test(name))) {
      for (const name of readdirSync(join(this.dir, chain))) {
        if (name.startsWith(".") || !name.endsWith(".json")) continue;
        try {
          pots.push(this.read(join(this.dir, chain, name)));
        } catch (error) {
          warnings.push(
            `warning: ${error instanceof Error ? error.message : String(error)}; that Pot is left out`,
          );
        }
      }
    }
    pots.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    return { pots, warnings };
  }
}

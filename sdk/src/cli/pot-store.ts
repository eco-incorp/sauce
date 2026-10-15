/**
 * The `sauce` command's Pot store: every Pot it deploys, and every Pot `sauce pot import` names,
 * kept on disk with the release it was minted under — so what was deployed, and which engine and
 * compiler it works with, is known without recomputing an address under whatever release the SDK
 * pins today.
 *
 * One file per Pot, `<dir>/<chainId>/<pot>.json`, IMMUTABLE: written to a temporary file beside it
 * and LINKED into place, which fails if the name exists, so the content appears whole and two
 * writers cannot both win. The loser finds the file there and checks it names the same Pot (the
 * same chain, address, owner, salt and Kitchen): a Pot deploys once, so a second record of it —
 * its import after its deployment, say — adds nothing, and the first is kept. Nothing is ever read,
 * changed and written back.
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
   *  signature), block (the slot) and sender. */
  readonly deployment?: { readonly tx: string; readonly block: string; readonly from: string };
  /** When it was recorded (ISO 8601). */
  readonly recordedAt: string;
}

/** Where Pots are kept by the executable, unless `--pots` says otherwise. */
export const defaultPotsDir = (): string => join(homedir(), ".sauce", "pots");

/** What two records of one Pot agree on. */
const identity = (record: PotRecord): string =>
  JSON.stringify([
    record.chainId,
    record.pot.toLowerCase(),
    record.owner.toLowerCase(),
    record.salt.toLowerCase(),
    record.kitchen.toLowerCase(),
  ]);

/** A Pot's address as a file name: an EVM address lowercased, a base58 one as it is. */
const fileOf = (pot: string): string => {
  const name = pot.startsWith("0x") ? pot.toLowerCase() : pot;
  if (!/^(0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(name)) {
    throw new Error(`'${pot}' is not a Pot address`);
  }

  return `${name}.json`;
};

export class PotStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /**
   * Keeps `record`, once: `"created"` when this call wrote it, `"exists"` when the Pot was recorded
   * already (the first record is kept). A different Pot under the same name — impossible unless a
   * file was edited — is an error, and the file is left as it was.
   */
  save(record: PotRecord): "created" | "exists" {
    if (record.schema !== POT_SCHEMA) throw new Error(`not a ${POT_SCHEMA} record`);
    if (!Number.isSafeInteger(record.chainId) || record.chainId <= 0) {
      throw new Error(`chain id ${record.chainId} is not a chain id`);
    }
    const dir = join(this.dir, String(record.chainId));
    // Owner-only, as every directory under ~/.sauce is, whatever the umask.
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const final = join(dir, fileOf(record.pot));
    const temporary = join(
      dir,
      `.${fileOf(record.pot)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, final);

      return "created";
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const existing = this.read(final);
      if (identity(existing) !== identity(record)) {
        throw new Error(
          `${final} holds a different Pot under the same address: it was edited, so it is left ` +
            "as it is",
          { cause: error },
        );
      }

      return "exists";
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
    const record = parsed as PotRecord;
    if (record?.schema !== POT_SCHEMA) {
      throw new Error(`${path}: schema ${JSON.stringify(record?.schema)} is not ${POT_SCHEMA}`);
    }

    return record;
  }

  /** The record of `pot` on chain `chainId`, if the store holds one. */
  get(chainId: number, pot: string): PotRecord | undefined {
    const path = join(this.dir, String(chainId), fileOf(pot));
    try {
      return this.read(path);
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      if (cause?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  /**
   * Every Pot the store holds, oldest record first, and a warning for each file it cannot read
   * (not JSON, another schema), which is left out.
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
    for (const chain of chains.filter((name) => /^\d+$/.test(name))) {
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

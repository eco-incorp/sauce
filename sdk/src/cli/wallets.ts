/**
 * The wallet directory: the keys the `sauce` command (and the local MCP server) sign with when
 * told `--wallet <name>`, each encrypted under a password the agent holds and never sees in its
 * context (`password.ts` reads it from the source it is told about).
 *
 * One file per wallet, `<dir>/<name>.json`, beside the Pot store under `~/.sauce`:
 *
 *  - an EVM wallet is a Web3 Secret Storage (v3) keystore exactly as geth and `cast wallet` write it
 *    (scrypt, AES-128-CTR, keccak-256 MAC; `signer.ts#encryptKeystore`), so `--keystore <file>`,
 *    `cast wallet … --keystore <file>` and geth read it too;
 *  - a Solana wallet is the same envelope around the keypair's 64 bytes (seed, then public key, as
 *    solana-keygen writes them), marked `"kind": "solana"`, its `address` the base58 public key.
 *
 * The address is in the clear in each file, so listing wallets and naming one's address need no
 * password. A file is written once — to a temporary file created 0600, then LINKED into place,
 * which fails if the name exists — and never overwritten. The directory is created 0700. Beside a
 * wallet may sit `<name>.policy.json`, the limits on what it sends, and the ledger of what it sent
 * (`policy.ts`). This is a HOT wallet: whoever holds the password and the file holds the key, so it
 * should hold small balances.
 *
 * NODE-ONLY (the filesystem, `node:crypto`), like the rest of `cli/`; nothing browser-facing
 * imports it. The default directory is `~/.sauce/wallets`; `--wallets <dir>` names another.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  createKeyPairSignerFromBytes,
  getBase58Decoder,
  getBase58Encoder,
  isAddress as isSolanaAddress,
  type KeyPairSigner,
} from "@solana/kit";
import { bytesToHex, getAddress, hexToBytes, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { CliError, UsageError } from "./args.js";
import { MIN_PASSWORD } from "./password.js";
import {
  decryptKeystoreBytes,
  encryptKeystore,
  keystoreKind,
  parsePrivateKey,
  secret,
  type KeystoreKind,
} from "./signer.js";

/** Where wallets are kept unless `--wallets` says otherwise. */
export const defaultWalletsDir = (): string => join(homedir(), ".sauce", "wallets");

/**
 * Where the local MCP server writes the password it generates for a wallet directory when told
 * where not (`sauce_wallet_enable { generate: true }`): beside the directory, never in it, so a
 * copy of the directory never carries it — `~/.sauce/wallets.password` for the default.
 */
export const generatedPasswordFile = (dir: string): string => `${resolve(dir)}.password`;

/**
 * Writes `text` to a new file at `path`, once: to a temporary file created 0600 beside it, then
 * LINKED into place, which fails (`EEXIST`) if anything is there — never over a file that exists.
 */
function writeOnce(path: string, text: string): void {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
  try {
    chmodSync(temporary, 0o600);
    linkSync(temporary, path);
  } finally {
    unlinkSync(temporary);
  }
}

/**
 * A new random password — 32 bytes, as 43 characters of base64url — written once to a new file at
 * `path`, 0600, and never over one that exists. The directory it goes in must exist, unless
 * `makeDirectory` (the default place's, `~/.sauce`, which is then created 0700). Registered as a
 * secret before it is written.
 */
export function generatePasswordFile(path: string, makeDirectory = false): string {
  const password = randomBytes(32).toString("base64url");
  secret(password);
  if (makeDirectory) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeOnce(path, `${password}\n`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EEXIST") {
      throw new CliError(
        `${path} exists: a password file is never overwritten (the password it holds enables ` +
          `the wallets it opens with { file: "${path}" })`,
        { cause: error },
      );
    }
    if (code === "ENOENT") {
      throw new CliError(
        `${dirname(path)} does not exist: a password file goes in a directory that does`,
      );
    }
    throw new CliError(`${path} could not be written (${code ?? "error"})`, { cause: error });
  }

  return password;
}

/** A wallet's name: lowercase letters, digits, `-` and `_`, as a file name on any system. */
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** What each wallet holds. */
export type WalletKind = KeystoreKind;

/** A wallet, as its file names it in the clear. */
export interface WalletInfo {
  readonly name: string;
  readonly kind: WalletKind;
  /** A checksummed 0x address on EVM chains, a base58 public key on Solana. */
  readonly address: string;
  /** The wallet's file: a keystore `--keystore` (and, for EVM, `cast wallet`) reads. */
  readonly path: string;
  /** Where its policy is read from, whether or not there is one. */
  readonly policyPath: string;
}

/** A wallet unlocked: its signer, for the kind of chain it signs on. */
export type Unlocked =
  | { readonly kind: "evm"; readonly info: WalletInfo; readonly account: PrivateKeyAccount }
  | { readonly kind: "solana"; readonly info: WalletInfo; readonly signer: KeyPairSigner };

/** A wallet's name, checked. */
export function walletName(raw: string): string {
  if (!NAME.test(raw)) {
    throw new UsageError(
      `'${raw}' is not a wallet name: up to 64 lowercase letters, digits, - and _, starting with ` +
        "a letter or digit",
    );
  }

  return raw;
}

/** A Solana keypair's 64 bytes as text: the JSON array a keypair file holds. */
export const keypairText = (bytes: Uint8Array): string => JSON.stringify([...bytes]);

/** Registers every spelling of a Solana keypair as a secret: its JSON array, base58 and hex. */
function secretKeypair(bytes: Uint8Array): void {
  secret(keypairText(bytes));
  secret(getBase58Decoder().decode(bytes));
  secret(bytesToHex(bytes));
  secret(getBase58Decoder().decode(bytes.subarray(0, 32)));
}

/** A fresh ed25519 keypair as solana-keygen writes it: the 32-byte seed, then the public key. */
function newSolanaKeypair(): Uint8Array {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const bytes = new Uint8Array([...seed, ...pub]);
  seed.fill(0);

  return bytes;
}

/** The keypair `bytes` hold, checked: its public half must be its seed's. */
async function solanaSigner(bytes: Uint8Array, what: string): Promise<KeyPairSigner> {
  if (bytes.length !== 64) throw new CliError(`${what} does not hold a 64-byte Solana keypair`);
  try {
    return await createKeyPairSignerFromBytes(bytes);
  } catch {
    throw new CliError(`${what}: its 64 bytes are not an ed25519 keypair`);
  }
}

/** A secret to import: what a file or stdin held, read as the key it is. */
export interface ImportedSecret {
  readonly kind: WalletKind;
  /** The key: 32 bytes for EVM, the 64-byte keypair for Solana. */
  readonly bytes: Uint8Array;
}

/**
 * What an import's text is: a v3 keystore (decrypted with `password`, which the wallet then keeps),
 * a Solana keypair file (a JSON array of 64 bytes) or its base58 spelling, or a raw EVM private key
 * (32 bytes of hex). The text is a secret from the start; it is never quoted back.
 */
export function readImport(text: string, password: string, from: string): ImportedSecret {
  const trimmed = text.trim();
  secret(trimmed);
  if (trimmed.startsWith("{")) {
    const { kind, bytes } = decryptKeystoreBytes(trimmed, password);

    return { kind, bytes };
  }
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = undefined;
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 64 ||
      !parsed.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      throw new UsageError(
        `${from}: not a Solana keypair file (a JSON array of 64 bytes, as solana-keygen writes)`,
      );
    }
    const bytes = Uint8Array.from(parsed as number[]);
    secretKeypair(bytes);

    return { kind: "solana", bytes };
  }
  if (/^(?:0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { kind: "evm", bytes: hexToBytes(parsePrivateKey(trimmed, from)) };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trimmed)) {
    const bytes = new Uint8Array(getBase58Encoder().encode(trimmed));
    if (bytes.length === 64) {
      secretKeypair(bytes);

      return { kind: "solana", bytes };
    }
  }
  throw new UsageError(
    `${from} holds no key this command reads: a keystore (JSON), a Solana keypair (a JSON array ` +
      "of 64 bytes, or its base58), or an EVM private key (32 bytes of hex)",
  );
}

/** The `address` a wallet's file names: hex without 0x (as geth writes it), or base58. */
async function addressOf(kind: WalletKind, bytes: Uint8Array): Promise<string> {
  if (kind === "evm") {
    return privateKeyToAccount(bytesToHex(bytes) as Hex)
      .address.slice(2)
      .toLowerCase();
  }

  return (await solanaSigner(bytes, "the key")).address;
}

export class WalletStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(name: string): string {
    return join(this.dir, `${walletName(name)}.json`);
  }

  /** The wallet `name`, as its file names it; an error naming the directory when there is none. */
  info(name: string): WalletInfo {
    const path = this.file(name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      throw new CliError(
        (error as { code?: string }).code === "ENOENT"
          ? `no wallet ${name} in ${this.dir}: \`sauce wallet list\` names them, and ` +
              `\`sauce wallet new ${name}\` creates one`
          : `${path} is unreadable`,
      );
    }

    return this.parse(name, path, text);
  }

  private parse(name: string, path: string, text: string): WalletInfo {
    let kind: WalletKind;
    let field: unknown;
    try {
      kind = keystoreKind(text);
      field = (JSON.parse(text) as { address?: unknown }).address;
    } catch {
      throw new CliError(`${path} is not a wallet's keystore`);
    }
    let address: string | undefined;
    if (kind === "evm" && typeof field === "string") {
      const spelled = field.startsWith("0x") ? field : `0x${field}`;
      if (isAddress(spelled, { strict: false })) address = getAddress(spelled);
    }
    if (kind === "solana" && typeof field === "string" && isSolanaAddress(field)) address = field;
    if (address === undefined) throw new CliError(`${path} names no address`);

    return { name, kind, address, path, policyPath: join(this.dir, `${name}.policy.json`) };
  }

  /** Every wallet the directory holds, and a warning for each file there it cannot read. */
  list(): { readonly wallets: WalletInfo[]; readonly warnings: string[] } {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { wallets: [], warnings: [] };
      throw error;
    }
    const wallets: WalletInfo[] = [];
    const warnings: string[] = [];
    for (const file of names.sort()) {
      const name = /^([a-z0-9][a-z0-9_-]{0,63})\.json$/.exec(file)?.[1];
      if (name === undefined) continue;
      try {
        wallets.push(this.info(name));
      } catch (error) {
        warnings.push(`warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { wallets, warnings };
  }

  /** Creates the directory, owner-only, and warns when one that exists lets others in. */
  private ensureDir(): string[] {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") return [];
    const mode = statSync(this.dir).mode & 0o777;

    return (mode & 0o077) === 0
      ? []
      : [
          `warning: ${this.dir} is open to others (mode ${mode.toString(8)}): each wallet file is ` +
            `yours alone, but \`chmod 700 ${this.dir}\` keeps their names private too`,
        ];
  }

  /** Writes `text` as wallet `name`, once: never over a wallet that exists. */
  private write(name: string, text: string): string[] {
    const warnings = this.ensureDir();
    try {
      writeOnce(this.file(name), text);
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") {
        throw new CliError(
          `wallet ${name} exists in ${this.dir}: a wallet is never overwritten (pick another name)`,
          { cause: error },
        );
      }
      throw error;
    }

    return warnings;
  }

  /** Stores `bytes` (32 bytes for EVM, a 64-byte keypair for Solana) as wallet `name`. */
  async store(
    name: string,
    kind: WalletKind,
    bytes: Uint8Array,
    password: string,
  ): Promise<{ readonly info: WalletInfo; readonly warnings: string[] }> {
    walletName(name);
    // Held here, where every wallet is created — the CLI and the MCP server alike.
    if ([...password].length < MIN_PASSWORD) {
      throw new UsageError(
        `a wallet's password is ${MIN_PASSWORD} characters at least: its key is encrypted under it ` +
          "on disk",
      );
    }
    if (kind === "evm" && bytes.length !== 32) throw new CliError("an EVM key is 32 bytes");
    if (kind === "solana") {
      secretKeypair(bytes);
      await solanaSigner(bytes, "the keypair");
    } else {
      secret(bytesToHex(bytes));
    }
    const address = await addressOf(kind, bytes);
    const warnings = this.write(name, encryptKeystore(bytes, password, { kind, address }));

    return { info: this.info(name), warnings };
  }

  /** A new wallet `name` with a fresh key. */
  create(
    name: string,
    kind: WalletKind,
    password: string,
  ): Promise<{ readonly info: WalletInfo; readonly warnings: string[] }> {
    const bytes = kind === "evm" ? hexToBytes(generatePrivateKey()) : newSolanaKeypair();

    return this.store(name, kind, bytes, password).finally(() => bytes.fill(0));
  }

  /** The wallet's key, decrypted with `password`: what `export` shows, and nothing else reads. */
  secretOf(name: string, password: string): ImportedSecret {
    const info = this.info(name);
    const { kind, bytes } = decryptKeystoreBytes(readFileSync(info.path, "utf8"), password);
    if (kind === "solana") secretKeypair(bytes);

    return { kind, bytes };
  }

  /** The wallet unlocked with `password`: its signer. */
  async unlock(name: string, password: string): Promise<Unlocked> {
    const info = this.info(name);
    const { kind, bytes } = this.secretOf(name, password);
    try {
      if (kind === "evm") {
        if (bytes.length !== 32) throw new CliError(`${info.path} does not hold a 32-byte key`);
        const account = privateKeyToAccount(bytesToHex(bytes) as Hex);
        if (account.address !== info.address) {
          throw new CliError(
            `${info.path} holds the key of ${account.address}, not ${info.address}`,
          );
        }

        return { kind, info, account };
      }
      const signer = await solanaSigner(bytes, info.path);
      if (signer.address !== info.address) {
        throw new CliError(
          `${info.path} holds the keypair of ${signer.address}, not ${info.address}`,
        );
      }

      return { kind, info, signer };
    } finally {
      bytes.fill(0);
    }
  }
}

/** The address `info` names, as an EVM address; refuses a Solana wallet. */
export const evmAddressOf = (info: WalletInfo): Address => {
  if (info.kind !== "evm") {
    throw new UsageError(
      `wallet ${info.name} is a Solana wallet: an EVM transaction is signed by an EVM wallet`,
    );
  }

  return getAddress(info.address);
};

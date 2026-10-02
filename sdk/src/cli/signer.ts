/**
 * Who signs what `sauce run` and `sauce pot --deploy` send: a JSON keystore (v3), or a raw private
 * key — or a wallet from the wallet directory (`wallets.ts`), whose file is the same keystore. Never
 * the config file, and the environment only as `--password-env` names it (`password.ts`).
 *
 * KEY MATERIAL NEVER REACHES OUTPUT. Every secret — the key, the password, the keystore's decrypted
 * bytes — is registered with {@link secret} the moment it is read, before anything can fail, and
 * `run.ts` passes everything it prints through {@link scrub}. An error message that quoted an input
 * is how a credential leaked from this repository once; this makes that impossible to repeat by
 * accident rather than by care.
 *
 * The keystore is encrypted and decrypted with audited primitives: `@noble/hashes` (scrypt,
 * PBKDF2-HMAC-SHA256, keccak-256) and `@noble/ciphers` (AES-128-CTR), both pinned exactly; a new
 * one's salt, IV and id come from `node:crypto`.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { ctr } from "@noble/ciphers/aes";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { scrypt } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, getAddress, hexToBytes, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { CliError, UsageError } from "./args.js";
import { describeSource, readPassword, type PasswordIo, type PasswordSource } from "./password.js";

const secrets = new Set<string>();

/** Remembers `value` as a secret that {@link scrub} removes from anything printed. */
export function secret(value: string): void {
  if (value.length < 4) return;
  secrets.add(value);
  const bare = value.replace(/^0x/i, "");
  if (bare.length >= 4) secrets.add(bare);
}

/** `text` with every registered secret replaced, whatever its case. */
export function scrub(text: string): string {
  let out = text;
  for (const value of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
  }

  return out;
}

const PRIVATE_KEY = /^(?:0x)?[0-9a-fA-F]{64}$/;

/** A private key given as text: 32 bytes of hex. The value itself is never quoted back. */
export function parsePrivateKey(raw: string, from: string): Hex {
  secret(raw.trim());
  const key = raw.trim();
  if (!PRIVATE_KEY.test(key)) {
    throw new UsageError(`${from} is not a private key: expected 32 bytes of hex (64 characters)`);
  }

  return (key.startsWith("0x") || key.startsWith("0X") ? `0x${key.slice(2)}` : `0x${key}`) as Hex;
}

/**
 * A Web3 Secret Storage (v3) file, as geth, `cast wallet` and this command write it. `kind` is this
 * command's addition, present only on a Solana wallet: the same envelope around a Solana keypair's
 * 64 bytes (`wallets.ts`). A file without it is an EVM keystore, as every other tool writes one.
 */
interface KeystoreV3 {
  version: number;
  kind?: unknown;
  address?: unknown;
  crypto?: KeystoreCrypto;
  Crypto?: KeystoreCrypto;
}

interface KeystoreCrypto {
  cipher: string;
  cipherparams: { iv: string };
  ciphertext: string;
  kdf: string;
  kdfparams: Record<string, unknown>;
  mac: string;
}

/** What a keystore holds: an EVM private key, or (`kind: "solana"`) a Solana keypair. */
export type KeystoreKind = "evm" | "solana";

const hex = (value: unknown, what: string): Uint8Array => {
  if (typeof value !== "string" || !/^(?:0x)?(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new CliError(`the keystore's ${what} is not hex`);
  }

  return hexToBytes(`0x${value.replace(/^0x/, "")}` as Hex);
};

const integer = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new CliError(`the keystore's ${what} is not a positive integer`);
  }

  return value;
};

/** The key the password derives, by the keystore's own KDF and parameters. */
function deriveKey(crypto: KeystoreCrypto, password: Uint8Array): Uint8Array {
  const params = crypto.kdfparams;
  const salt = hex(params.salt, "kdfparams.salt");
  const dkLen = integer(params.dklen, "kdfparams.dklen");
  if (dkLen < 32) throw new CliError("the keystore's kdfparams.dklen is below 32");
  if (crypto.kdf === "scrypt") {
    return scrypt(password, salt, {
      N: integer(params.n, "kdfparams.n"),
      r: integer(params.r, "kdfparams.r"),
      p: integer(params.p, "kdfparams.p"),
      dkLen,
      // The default keystore N (2^18) with r = 8 needs 256 MiB; allow up to 1 GiB.
      maxmem: 2 ** 30,
    });
  }
  if (crypto.kdf === "pbkdf2") {
    if (params.prf !== "hmac-sha256") {
      throw new CliError(
        `the keystore's PBKDF2 uses ${String(params.prf)}; only hmac-sha256 is read`,
      );
    }

    return pbkdf2(sha256, password, salt, { c: integer(params.c, "kdfparams.c"), dkLen });
  }
  throw new CliError(
    `the keystore's KDF is ${String(crypto.kdf)}; only scrypt and pbkdf2 are read`,
  );
}

/** Equal length and content, taking the same time whichever byte differs. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;

  return diff === 0;
}

/** The MAC over a derived key and a ciphertext: keccak-256 of the key's second 16 bytes and it. */
const macOf = (derived: Uint8Array, ciphertext: Uint8Array): Uint8Array =>
  keccak_256(new Uint8Array([...derived.slice(16, 32), ...ciphertext]));

/**
 * The address a keystore names in the clear — its `address` field, which every v3 keystore a
 * wallet writes carries — so the signer's address is known without its password. `undefined` for a
 * keystore without one, which has to be unlocked to learn it, and for a Solana wallet's.
 */
export function keystoreAddress(json: string): Address | undefined {
  try {
    const parsed = JSON.parse(json) as KeystoreV3;
    const field = parsed.address;
    if (parsed.kind !== undefined || typeof field !== "string") return undefined;
    const spelled = field.startsWith("0x") ? field : `0x${field}`;

    return isAddress(spelled, { strict: false }) ? getAddress(spelled) : undefined;
  } catch {
    return undefined;
  }
}

/** What a keystore's text says it holds, read without its password. */
export function keystoreKind(json: string): KeystoreKind {
  let parsed: KeystoreV3;
  try {
    parsed = JSON.parse(json) as KeystoreV3;
  } catch {
    throw new CliError("the keystore is not JSON");
  }
  if (parsed.kind === undefined || parsed.kind === "evm") return "evm";
  if (parsed.kind === "solana") return "solana";
  throw new CliError(`the keystore's kind is ${JSON.stringify(parsed.kind)}: evm or solana`);
}

/**
 * The secret in a Web3 Secret Storage (v3) envelope, whatever its length, and what the file says it
 * is. The MAC is checked before anything is decrypted, so a wrong password is reported as one
 * rather than yielding a wrong secret. The bytes are registered as a secret.
 */
export function decryptKeystoreBytes(
  json: string,
  password: string,
): { readonly kind: KeystoreKind; readonly bytes: Uint8Array } {
  secret(password);
  let keystore: KeystoreV3;
  try {
    keystore = JSON.parse(json) as KeystoreV3;
  } catch {
    throw new CliError("the keystore is not JSON");
  }
  const kind = keystoreKind(json);
  const crypto = keystore.crypto ?? keystore.Crypto;
  if (keystore.version !== 3 || crypto === undefined) {
    throw new CliError("the keystore is not a version 3 Web3 Secret Storage file");
  }
  if (crypto.cipher !== "aes-128-ctr") {
    throw new CliError(`the keystore's cipher is ${crypto.cipher}; only aes-128-ctr is read`);
  }
  const derived = deriveKey(crypto, new TextEncoder().encode(password.normalize("NFKC")));
  const ciphertext = hex(crypto.ciphertext, "ciphertext");
  if (!sameBytes(macOf(derived, ciphertext), hex(crypto.mac, "mac"))) {
    throw new CliError("the keystore password is wrong (the keystore's MAC does not match)");
  }
  const bytes = ctr(derived.slice(0, 16), hex(crypto.cipherparams.iv, "cipherparams.iv")).decrypt(
    ciphertext,
  );
  secret(bytesToHex(bytes));

  return { kind, bytes };
}

/** The private key in an EVM Web3 Secret Storage (v3) keystore. */
export function decryptKeystore(json: string, password: string): Hex {
  const { kind, bytes } = decryptKeystoreBytes(json, password);
  if (kind === "solana") {
    throw new CliError(
      "the keystore holds a Solana keypair (a Solana wallet): an EVM transaction needs an EVM key",
    );
  }
  const privateKey = bytesToHex(bytes);
  if (bytes.length !== 32) throw new CliError("the keystore does not hold a 32-byte private key");

  return privateKey;
}

/** The scrypt parameters a new keystore is written with: geth's and Foundry's standard ones. */
export const SCRYPT = { n: 262_144, r: 8, p: 1 } as const;

export interface EncryptOptions {
  /** `evm`: a plain v3 keystore. `solana`: the same envelope, marked `kind: "solana"`. */
  readonly kind: KeystoreKind;
  /** What the `address` field names: hex without 0x on EVM, as geth writes it; base58 on Solana. */
  readonly address: string;
  /** For a test vector only; random otherwise. */
  readonly salt?: Uint8Array;
  readonly iv?: Uint8Array;
  readonly id?: string;
  readonly scrypt?: { readonly n: number; readonly r: number; readonly p: number };
}

/**
 * `secretBytes` in a Web3 Secret Storage (v3) envelope under `password`: scrypt, AES-128-CTR and a
 * keccak-256 MAC, exactly as the definition and geth write it, so `--keystore`, `cast wallet` and
 * geth read an EVM one. The salt (32 bytes), the IV (16) and the id (a UUID) are fresh unless a
 * test vector gives them.
 */
export function encryptKeystore(
  secretBytes: Uint8Array,
  password: string,
  options: EncryptOptions,
): string {
  secret(password);
  const salt = options.salt ?? new Uint8Array(randomBytes(32));
  const iv = options.iv ?? new Uint8Array(randomBytes(16));
  const params = options.scrypt ?? SCRYPT;
  const derived = scrypt(new TextEncoder().encode(password.normalize("NFKC")), salt, {
    N: params.n,
    r: params.r,
    p: params.p,
    dkLen: 32,
    maxmem: 2 ** 30,
  });
  const ciphertext = ctr(derived.slice(0, 16), iv).encrypt(secretBytes);
  const bare = (bytes: Uint8Array): string => bytesToHex(bytes).slice(2);

  return `${JSON.stringify(
    {
      ...(options.kind === "solana" ? { kind: "solana" } : {}),
      address: options.address,
      crypto: {
        cipher: "aes-128-ctr",
        cipherparams: { iv: bare(iv) },
        ciphertext: bare(ciphertext),
        kdf: "scrypt",
        kdfparams: { dklen: 32, n: params.n, p: params.p, r: params.r, salt: bare(salt) },
        mac: bare(macOf(derived, ciphertext)),
      },
      id: options.id ?? randomUUID(),
      version: 3,
    },
    null,
    2,
  )}\n`;
}

/** How the signer is given: a keystore or a raw key, and where a keystore's password comes from. */
export interface SignerInput {
  readonly keystore?: string;
  readonly privateKey?: string;
  /** `password.ts#passwordSource` of the flags; the prompt when none was given. */
  readonly password: PasswordSource;
}

/** What the signer needs from the process: files, a warning channel, and the password sources. */
export interface SignerIo extends PasswordIo {
  readonly stderr: (text: string) => void;
}

/** The account `input` names — reading the keystore's password from its source, or asking. */
export async function loadSigner(input: SignerInput, io: SignerIo): Promise<PrivateKeyAccount> {
  if (input.keystore !== undefined && input.privateKey !== undefined) {
    throw new UsageError("give --keystore or --private-key, not both");
  }
  if (input.password.from !== "prompt" && input.keystore === undefined) {
    throw new UsageError(`${describeSource(input.password)} goes with --keystore or --wallet`);
  }
  if (input.privateKey !== undefined) {
    const key = parsePrivateKey(input.privateKey, "--private-key");
    io.stderr(
      "warning: --private-key puts the key in your shell history and in the process list; " +
        "prefer --keystore or --wallet\n",
    );

    return privateKeyToAccount(key);
  }
  if (input.keystore === undefined) {
    throw new UsageError(
      "missing a signer: --wallet <name>, --keystore <path> (each with a password source, or a " +
        "prompt) or --private-key <hex>",
    );
  }
  let json: string;
  try {
    json = io.readText(input.keystore);
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new CliError(
      `--keystore ${input.keystore}: ${code === "ENOENT" ? "no such file" : "unreadable"}`,
    );
  }
  const password = await readPassword(input.password, io, { what: input.keystore });

  return privateKeyToAccount(decryptKeystore(json, password));
}

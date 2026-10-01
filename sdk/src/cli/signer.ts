/**
 * Who signs what `sauce run` and `sauce pot --deploy` send: a JSON keystore (v3), or a raw private
 * key. Nothing else — never the environment, never the config file.
 *
 * KEY MATERIAL NEVER REACHES OUTPUT. Every secret — the key, the password, the keystore's decrypted
 * bytes — is registered with {@link secret} the moment it is read, before anything can fail, and
 * `run.ts` passes everything it prints through {@link scrub}. An error message that quoted an input
 * is how a credential leaked from this repository once; this makes that impossible to repeat by
 * accident rather than by care.
 *
 * The keystore is decrypted with audited primitives: `@noble/hashes` (scrypt, PBKDF2-HMAC-SHA256,
 * keccak-256) and `@noble/ciphers` (AES-128-CTR), both pinned exactly.
 */
import { ctr } from "@noble/ciphers/aes";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { scrypt } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { UsageError } from "./args.js";
import { CliError } from "./args.js";

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

interface KeystoreV3 {
  version: number;
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

/**
 * The private key in a Web3 Secret Storage (v3) keystore. The MAC is checked before anything is
 * decrypted, so a wrong password is reported as one rather than yielding a wrong key.
 */
export function decryptKeystore(json: string, password: string): Hex {
  secret(password);
  let keystore: KeystoreV3;
  try {
    keystore = JSON.parse(json) as KeystoreV3;
  } catch {
    throw new CliError("the keystore is not JSON");
  }
  const crypto = keystore.crypto ?? keystore.Crypto;
  if (keystore.version !== 3 || crypto === undefined) {
    throw new CliError("the keystore is not a version 3 Web3 Secret Storage file");
  }
  if (crypto.cipher !== "aes-128-ctr") {
    throw new CliError(`the keystore's cipher is ${crypto.cipher}; only aes-128-ctr is read`);
  }
  const derived = deriveKey(crypto, new TextEncoder().encode(password.normalize("NFKC")));
  const ciphertext = hex(crypto.ciphertext, "ciphertext");
  const mac = keccak_256(new Uint8Array([...derived.slice(16, 32), ...ciphertext]));
  if (!sameBytes(mac, hex(crypto.mac, "mac"))) {
    throw new CliError("the keystore password is wrong (the keystore's MAC does not match)");
  }
  const key = ctr(derived.slice(0, 16), hex(crypto.cipherparams.iv, "cipherparams.iv")).decrypt(
    ciphertext,
  );
  const privateKey = bytesToHex(key);
  secret(privateKey);
  if (key.length !== 32) throw new CliError("the keystore does not hold a 32-byte private key");

  return privateKey;
}

/** How the signer is given: exactly one of these. */
export interface SignerInput {
  readonly keystore?: string;
  readonly passwordFile?: string;
  readonly privateKey?: string;
}

/** What the signer needs from the process: files, a warning channel, and a password prompt. */
export interface SignerIo {
  readonly readText: (path: string) => string;
  readonly stderr: (text: string) => void;
  /** Asks for a password without echoing it. Throws where there is no terminal to ask on. */
  readonly promptPassword: (prompt: string) => Promise<string>;
}

/** The account `input` names — asking for the keystore's password when no file gives it. */
export async function loadSigner(input: SignerInput, io: SignerIo): Promise<PrivateKeyAccount> {
  if (input.keystore !== undefined && input.privateKey !== undefined) {
    throw new UsageError("give --keystore or --private-key, not both");
  }
  if (input.passwordFile !== undefined && input.keystore === undefined) {
    throw new UsageError("--password-file goes with --keystore");
  }
  if (input.privateKey !== undefined) {
    const key = parsePrivateKey(input.privateKey, "--private-key");
    io.stderr(
      "warning: --private-key puts the key in your shell history and in the process list; " +
        "prefer --keystore\n",
    );

    return privateKeyToAccount(key);
  }
  if (input.keystore === undefined) {
    throw new UsageError(
      "missing a signer: --keystore <path> (with --password-file <path>, or a prompt) or " +
        "--private-key <hex>",
    );
  }
  const read = (path: string, what: string): string => {
    try {
      return io.readText(path);
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new CliError(`${what} ${path}: ${code === "ENOENT" ? "no such file" : "unreadable"}`);
    }
  };
  const json = read(input.keystore, "--keystore");
  const password =
    input.passwordFile === undefined
      ? await io.promptPassword(`Password for ${input.keystore}: `)
      : read(input.passwordFile, "--password-file").replace(/\r?\n$/, "");

  return privateKeyToAccount(decryptKeystore(json, password));
}

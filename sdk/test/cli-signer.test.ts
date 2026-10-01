/**
 * The `sauce` command's signers: a Web3 Secret Storage (v3) keystore decrypted against known
 * vectors, a raw key, and the guarantee that no key or password is ever printed — even when the
 * command fails.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { decryptKeystore, loadSigner, scrub, secret } from "../src/cli/signer.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/cli");

/** The two test vectors of the Web3 Secret Storage Definition: one key, one password, two KDFs. */
const VECTOR_KEY = "0x7a28b5ba57c53603b0b07b56bba752f7784bf506fa95edc395f5cf6c7514fe9d";
const VECTOR_PASSWORD = "testpassword";
const PBKDF2_VECTOR = {
  crypto: {
    cipher: "aes-128-ctr",
    cipherparams: { iv: "6087dab2f9fdbbfaddc31a909735c1e6" },
    ciphertext: "5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46",
    kdf: "pbkdf2",
    kdfparams: {
      c: 262144,
      dklen: 32,
      prf: "hmac-sha256",
      salt: "ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd",
    },
    mac: "517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2",
  },
  id: "3198bc9c-6672-5ab3-d995-4942343ae5b6",
  version: 3,
};
const SCRYPT_VECTOR = {
  crypto: {
    cipher: "aes-128-ctr",
    cipherparams: { iv: "83dbcc02d8ccb40e466191a123791e0e" },
    ciphertext: "d172bf743a674da9cdad04534d56926ef8358534d458fffccd4e6ad2fbde479c",
    kdf: "scrypt",
    kdfparams: {
      dklen: 32,
      n: 262144,
      r: 1,
      p: 8,
      salt: "ab0c7876052600dd703518d6fc3fe8984592145b591fc8fb5c6d43190334ba19",
    },
    mac: "2103ac29920d71da29f15d75b4a16dbe95cfd7ff8faea1056c33131d846e3097",
  },
  id: "3198bc9c-6672-5ab3-d995-4942343ae5b6",
  version: 3,
};

/** Anvil's third dev account, as Foundry's `cast wallet import` writes it: another
 *  implementation's keystore, scrypt with its own parameters. */
const CAST_KEYSTORE = readFileSync(join(FIXTURES, "anvil-2.keystore.json"), "utf8");
const CAST_PASSWORD = readFileSync(join(FIXTURES, "anvil-2.password"), "utf8").trim();
const CAST_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

describe("decryptKeystore", () => {
  it("decrypts the Web3 Secret Storage vectors, PBKDF2 and scrypt", () => {
    expect(decryptKeystore(JSON.stringify(PBKDF2_VECTOR), VECTOR_PASSWORD)).toBe(VECTOR_KEY);
    expect(decryptKeystore(JSON.stringify(SCRYPT_VECTOR), VECTOR_PASSWORD)).toBe(VECTOR_KEY);
  }, 60_000);

  it("decrypts a keystore Foundry wrote", () => {
    expect(decryptKeystore(CAST_KEYSTORE, CAST_PASSWORD)).toBe(CAST_KEY);
  });

  it("reports a wrong password as one, by the MAC, before decrypting anything", () => {
    expect(() => decryptKeystore(CAST_KEYSTORE, "not the password")).toThrow(
      /the keystore password is wrong \(the keystore's MAC does not match\)/,
    );
  });

  it("refuses what it does not read, saying what it is", () => {
    const withCrypto = (crypto: Record<string, unknown>) =>
      JSON.stringify({ ...SCRYPT_VECTOR, crypto: { ...SCRYPT_VECTOR.crypto, ...crypto } });
    expect(() => decryptKeystore("{", "x")).toThrow(/not JSON/);
    expect(() => decryptKeystore(JSON.stringify({ version: 1 }), "x")).toThrow(/not a version 3/);
    expect(() => decryptKeystore(withCrypto({ cipher: "aes-256-gcm" }), "x")).toThrow(
      /cipher is aes-256-gcm; only aes-128-ctr is read/,
    );
    expect(() => decryptKeystore(withCrypto({ kdf: "argon2" }), "x")).toThrow(
      /KDF is argon2; only scrypt and pbkdf2 are read/,
    );
  });
});

describe("loadSigner", () => {
  const io = (password?: string) => ({
    readText: (path: string) => readFileSync(path, "utf8"),
    stderr: () => undefined,
    promptPassword: async () => {
      if (password === undefined) throw new Error("no prompt expected");

      return password;
    },
  });

  it("reads a keystore's password from a file, or asks for it", async () => {
    const keystore = join(FIXTURES, "anvil-2.keystore.json");
    const fromFile = await loadSigner(
      { keystore, passwordFile: join(FIXTURES, "anvil-2.password") },
      io(),
    );
    expect(fromFile.address).toBe(privateKeyToAccount(CAST_KEY).address);
    const asked = await loadSigner({ keystore }, io(CAST_PASSWORD));
    expect(asked.address).toBe(fromFile.address);
  });

  it("takes exactly one signer", async () => {
    await expect(loadSigner({}, io())).rejects.toThrow(/missing a signer: --keystore/);
    await expect(loadSigner({ keystore: "k.json", privateKey: CAST_KEY }, io())).rejects.toThrow(
      /give --keystore or --private-key, not both/,
    );
    await expect(loadSigner({ privateKey: CAST_KEY, passwordFile: "p" }, io())).rejects.toThrow(
      /--password-file goes with --keystore/,
    );
  });
});

describe("no key or password is ever printed", () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-signer-"));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  async function sauce(...argv: string[]): Promise<{ code: number; out: string }> {
    let out = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void (out += text),
      stderr: (text) => void (out += text),
    };

    return { code: await runCli(argv, io), out };
  }

  /** Every spelling a key could leak in. */
  const leaks = (out: string, key: string): boolean => {
    const bare = key.replace(/^0x/, "");

    return [bare, bare.toUpperCase(), bare.slice(0, 16)].some((form) =>
      out.toLowerCase().includes(form.toLowerCase()),
    );
  };

  it("keeps a raw key out of every message, on success and on failure", async () => {
    const program = join(work, "noop.sauce.ts");
    writeFileSync(program, "require(chainId == 1n);\n");
    // An endpoint nothing answers on: the run fails after the key is read.
    const unreachable = await sauce(
      "run",
      program,
      "--chain",
      "ethereum",
      "--rpc-url",
      "http://127.0.0.1:9",
      "--private-key",
      CAST_KEY,
    );
    expect(unreachable.code).toBe(1);
    expect(unreachable.out).toMatch(/reading the chain id failed/);
    expect(leaks(unreachable.out, CAST_KEY)).toBe(false);

    // A malformed key is refused without being quoted back.
    const malformed = `${CAST_KEY.slice(0, 60)}zz`;
    const bad = await sauce(
      "run",
      program,
      "--chain",
      "ethereum",
      "--rpc-url",
      "http://127.0.0.1:9",
      "--private-key",
      malformed,
    );
    expect(bad.code).toBe(2);
    expect(bad.out).toMatch(/--private-key is not a private key: expected 32 bytes of hex/);
    expect(leaks(bad.out, malformed.slice(0, 60))).toBe(false);

    // Even an unknown option after the key, which fails before any command runs.
    const unknown = await sauce("run", program, "--private-key", CAST_KEY, "--bogus");
    expect(unknown.code).toBe(2);
    expect(leaks(unknown.out, CAST_KEY)).toBe(false);
  });

  it("keeps a keystore password out of every message", async () => {
    const wrong = join(work, "wrong.password");
    writeFileSync(wrong, "hunter2 is not it\n");
    const program = join(work, "noop.sauce.ts");
    writeFileSync(program, "require(chainId == 1n);\n");
    const run = await sauce(
      "run",
      program,
      "--chain",
      "ethereum",
      "--rpc-url",
      "http://127.0.0.1:9",
      "--keystore",
      join(FIXTURES, "anvil-2.keystore.json"),
      "--password-file",
      wrong,
    );
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/the keystore password is wrong/);
    expect(run.out).not.toContain("hunter2");
  });

  it("scrubs a registered secret wherever it appears, in any case", () => {
    secret("0xDEADBEEFcafe0000000000000000000000000000000000000000000000000001");
    expect(scrub("key: deadbeefCAFE0000000000000000000000000000000000000000000000000001!")).toBe(
      "key: [redacted]!",
    );
  });
});

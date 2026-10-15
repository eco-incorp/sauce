/**
 * The `sauce` command's wallets, offline: the keystore envelope against the Web3 Secret Storage
 * Definition's own test vector, a keystore it writes decrypted by two independent implementations
 * (Node's OpenSSL primitives, and Foundry's `cast` where it is installed — always in CI), the Solana
 * envelope round-tripped, every password source and each way it fails, the wallet directory's file
 * modes, and `sauce wallet new|list|address|import|export` — none of which ever prints a key or a
 * password. Every key and password here is generated for the test and thrown away.
 */
import { spawnSync } from "node:child_process";
import { createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createKeyPairSignerFromBytes,
  getBase58Decoder,
  getPublicKeyFromAddress,
  signBytes,
  verifySignature,
} from "@solana/kit";
import { bytesToHex, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import {
  dotenvEntry,
  passwordSource,
  readPassword,
  type CapturedCommand,
  type PasswordIo,
} from "../src/cli/password.js";
import {
  decryptKeystore,
  decryptKeystoreBytes,
  encryptKeystore,
  keystoreAddress,
  scrub,
} from "../src/cli/signer.js";
import { generatedPasswordFile, generatePasswordFile, WalletStore } from "../src/cli/wallets.js";

const HAS_CAST = spawnSync("cast", ["--version"], { stdio: "ignore" }).status === 0;
if (!HAS_CAST && process.env.CI) {
  throw new Error("`cast` is not on PATH in CI: Foundry is installed there, so this is a failure.");
}

/** The Web3 Secret Storage Definition's scrypt test vector. */
const VECTOR = {
  key: "0x7a28b5ba57c53603b0b07b56bba752f7784bf506fa95edc395f5cf6c7514fe9d",
  password: "testpassword",
  salt: "ab0c7876052600dd703518d6fc3fe8984592145b591fc8fb5c6d43190334ba19",
  iv: "83dbcc02d8ccb40e466191a123791e0e",
  ciphertext: "d172bf743a674da9cdad04534d56926ef8358534d458fffccd4e6ad2fbde479c",
  mac: "2103ac29920d71da29f15d75b4a16dbe95cfd7ff8faea1056c33131d846e3097",
  id: "3198bc9c-6672-5ab3-d995-4942343ae5b6",
} as const;

/** A throwaway password, never a real one. */
const password = (): string => `throwaway-${bytesToHex(randomBytes(12)).slice(2)}`;

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-wallet-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("the keystore envelope", () => {
  it("writes the definition's scrypt test vector exactly, given its salt, IV and parameters", () => {
    const json = encryptKeystore(hexToBytes(VECTOR.key), VECTOR.password, {
      kind: "evm",
      address: "008aeeda4d805471df9b2a5b0f38a0c3bcba786b",
      salt: hexToBytes(`0x${VECTOR.salt}`),
      iv: hexToBytes(`0x${VECTOR.iv}`),
      id: VECTOR.id,
      scrypt: { n: 262_144, r: 1, p: 8 },
    });
    const keystore = JSON.parse(json) as {
      version: number;
      id: string;
      crypto: Record<string, unknown>;
    };
    expect(keystore).toMatchObject({ version: 3, id: VECTOR.id });
    expect(keystore.crypto).toEqual({
      cipher: "aes-128-ctr",
      cipherparams: { iv: VECTOR.iv },
      ciphertext: VECTOR.ciphertext,
      kdf: "scrypt",
      kdfparams: { dklen: 32, n: 262_144, p: 8, r: 1, salt: VECTOR.salt },
      mac: VECTOR.mac,
    });
    expect(decryptKeystore(json, VECTOR.password)).toBe(VECTOR.key);
  }, 60_000);

  it("writes a keystore Node's own primitives decrypt, and so does cast", () => {
    const key = generatePrivateKey();
    const secret = password();
    const owner = privateKeyToAccount(key).address;
    const json = encryptKeystore(hexToBytes(key), secret, {
      kind: "evm",
      address: owner.slice(2).toLowerCase(),
    });
    const { crypto } = JSON.parse(json) as {
      crypto: {
        ciphertext: string;
        cipherparams: { iv: string };
        kdfparams: { n: number; r: number; p: number; salt: string; dklen: number };
      };
    };
    // OpenSSL's scrypt and AES, not the noble primitives the command uses.
    const derived = scryptSync(secret, Buffer.from(crypto.kdfparams.salt, "hex"), 32, {
      N: crypto.kdfparams.n,
      r: crypto.kdfparams.r,
      p: crypto.kdfparams.p,
      maxmem: 2 ** 30,
    });
    const decipher = createDecipheriv(
      "aes-128-ctr",
      derived.subarray(0, 16),
      Buffer.from(crypto.cipherparams.iv, "hex"),
    );
    const plain = Buffer.concat([
      decipher.update(Buffer.from(crypto.ciphertext, "hex")),
      decipher.final(),
    ]);
    expect(`0x${plain.toString("hex")}`).toBe(key);
    expect(crypto.kdfparams).toMatchObject({ n: 262_144, r: 8, p: 1, dklen: 32 });
    expect(keystoreAddress(json)).toBe(owner);

    if (HAS_CAST) {
      const file = join(work, "keystore.json");
      const passwordFile = join(work, "password");
      writeFileSync(file, json, { mode: 0o600 });
      writeFileSync(passwordFile, secret, { mode: 0o600 });
      const cast = spawnSync(
        "cast",
        ["wallet", "address", "--keystore", file, "--password-file", passwordFile],
        { encoding: "utf8" },
      );
      expect(cast.stderr).toBe("");
      expect(cast.stdout.trim()).toBe(owner);
    }
  }, 60_000);

  it("round-trips a Solana keypair in the same envelope, marked solana", async () => {
    const store = new WalletStore(join(work, "wallets"));
    const secret = password();
    const { info } = await store.create("sol", "solana", secret);
    const text = readFileSync(info.path, "utf8");
    const parsed = JSON.parse(text) as { kind: string; address: string; version: number };
    expect(parsed).toMatchObject({ kind: "solana", address: info.address, version: 3 });
    // Not an EVM keystore: --keystore refuses it, and names no EVM address.
    expect(keystoreAddress(text)).toBeUndefined();
    expect(() => decryptKeystore(text, secret)).toThrow(/holds a Solana keypair/);
    const { kind, bytes } = decryptKeystoreBytes(text, secret);
    expect(kind).toBe("solana");
    expect(bytes).toHaveLength(64);
    const signer = await createKeyPairSignerFromBytes(bytes);
    expect(signer.address).toBe(info.address);
    // The keypair signs, and the address verifies it.
    const message = new TextEncoder().encode("a message");
    const signature = await signBytes(signer.keyPair.privateKey, message);
    expect(
      await verifySignature(
        await getPublicKeyFromAddress(info.address as never),
        signature,
        message,
      ),
    ).toBe(true);
    const unlocked = await store.unlock("sol", secret);
    expect(unlocked.kind === "solana" && unlocked.signer.address).toBe(info.address);
    await expect(store.unlock("sol", "not-the-password")).rejects.toThrow(
      /the keystore password is wrong/,
    );
  }, 60_000);
});

describe("password sources", () => {
  const io = (overrides: Partial<PasswordIo> = {}): PasswordIo => ({
    readEnv: () => undefined,
    readText: (path) => readFileSync(path, "utf8"),
    fileMode: (path) => statSync(path).mode,
    capture: () => ({ status: 0, stdout: "" }),
    promptPassword: async () => {
      throw new Error("no prompt expected");
    },
    ...overrides,
  });
  const what = { what: "wallet test" };

  it("takes one source at most, and the prompt with none", () => {
    expect(passwordSource({})).toEqual({ from: "prompt" });
    expect(passwordSource({ env: "SAUCE_PW" })).toEqual({ from: "env", name: "SAUCE_PW" });
    expect(() => passwordSource({ env: "A", file: "f" })).toThrow(
      /give one password source, not --password-env and --password-file/,
    );
    expect(() => passwordSource({ env: "hunter2 is a value" })).toThrow(
      /takes the NAME of an environment variable/,
    );
    expect(() => passwordSource({ command: "  " })).toThrow(/--password-command is empty/);
  });

  it("reads exactly the variable named, and says when it is not set or empty", async () => {
    const value = password();
    const asked: string[] = [];
    const env = (name: string) => {
      asked.push(name);

      return name === "SAUCE_PW" ? value : name === "EMPTY" ? "" : undefined;
    };
    expect(await readPassword({ from: "env", name: "SAUCE_PW" }, io({ readEnv: env }), what)).toBe(
      value,
    );
    expect(asked).toEqual(["SAUCE_PW"]);
    await expect(
      readPassword({ from: "env", name: "MISSING" }, io({ readEnv: env }), what),
    ).rejects.toThrow(/--password-env MISSING: the variable is not set/);
    await expect(
      readPassword({ from: "env", name: "EMPTY" }, io({ readEnv: env }), what),
    ).rejects.toThrow(/--password-env EMPTY gives an empty password/);
    // Registered as a secret the moment it is read.
    expect(scrub(`it was ${value}`)).toBe("it was [redacted]");
  });

  it("reads a file only its owner can read, one trailing newline dropped, and refuses any other", async () => {
    const value = password();
    const file = join(work, "password");
    writeFileSync(file, `${value}\n\n`, { mode: 0o600 });
    // One newline goes; a second is the password's own.
    expect(await readPassword({ from: "file", path: file }, io(), what)).toBe(`${value}\n`);
    writeFileSync(file, `${value}\r\n`);
    expect(await readPassword({ from: "file", path: file }, io(), what)).toBe(value);
    for (const mode of [0o640, 0o604, 0o660, 0o644]) {
      chmodSync(file, mode);
      await expect(readPassword({ from: "file", path: file }, io(), what)).rejects.toThrow(
        new RegExp(
          `can be read or written by others \\(mode ${mode.toString(8)}\\): a password file must be ` +
            `yours alone. Run \`chmod 600 ${file}\``,
        ),
      );
    }
    await expect(
      readPassword({ from: "file", path: join(work, "absent") }, io(), what),
    ).rejects.toThrow(/--password-file \S+absent: no such file/);
  });

  it("runs a command, takes what it prints less one newline, and never shows its output on failure", async () => {
    const value = password();
    const capture =
      (status: number | null, stdout: string, error?: string) => (): CapturedCommand => ({
        status,
        stdout,
        ...(error === undefined ? {} : { error }),
      });
    expect(
      await readPassword(
        { from: "command", command: "x" },
        io({ capture: capture(0, `${value}\n`) }),
        what,
      ),
    ).toBe(value);
    const failing = readPassword(
      { from: "command", command: "x" },
      io({ capture: capture(3, `${value}-partial\n`) }),
      what,
    );
    await expect(failing).rejects.toThrow(
      /^--password-command exited with status 3; its output is not shown$/,
    );
    await expect(
      readPassword(
        { from: "command", command: "x" },
        io({ capture: capture(null, "", "ETIMEDOUT") }),
        what,
      ),
    ).rejects.toThrow(/--password-command did not finish \(ETIMEDOUT\)/);
    // Whatever the failing command printed is a secret all the same.
    expect(scrub(`${value}-partial`)).not.toContain(value);
  });

  it("runs a real command through the shell, with no stdin", async () => {
    const value = password();
    const real = nodeIo();
    // stdin is closed: `read` meets its end at once.
    expect(real.capture("read line || exit 9")).toMatchObject({ status: 9, stdout: "" });
    expect(real.capture(`printf '%s\\n' "${value}"`)).toEqual({ status: 0, stdout: `${value}\n` });
    expect(real.capture("exit 7").status).toBe(7);
  });

  it("asks twice at a prompt for a new wallet, and holds a new password to 8 characters", async () => {
    const answers = ["first-password", "other-password"];
    const prompt = io({ promptPassword: async () => answers.shift()! });
    await expect(
      readPassword({ from: "prompt" }, prompt, { ...what, creating: true }),
    ).rejects.toThrow(/the two passwords differ/);
    const same = io({ promptPassword: async () => "same-password" });
    expect(await readPassword({ from: "prompt" }, same, { ...what, creating: true })).toBe(
      "same-password",
    );
    const short = io({ readEnv: () => "short" });
    await expect(
      readPassword({ from: "env", name: "X" }, short, { ...what, creating: true }),
    ).rejects.toThrow(/gives a password of under 8 characters/);
    // Unlocking an existing keystore takes the password it has.
    expect(await readPassword({ from: "env", name: "X" }, short, what)).toBe("short");
  });
});

describe("password sources an MCP tool names", () => {
  const io = (env: Record<string, string> = {}): PasswordIo => ({
    readEnv: (name) => env[name],
    readText: (path) => readFileSync(path, "utf8"),
    fileMode: (path) => statSync(path).mode,
    capture: () => {
      throw new Error("a tool never names a command");
    },
    promptPassword: async () => {
      throw new Error("a tool never prompts");
    },
  });
  const tool = { what: "the wallets", creating: true, by: "tool" } as const;

  it("names each by the tool's inputs, and says where a variable comes from", async () => {
    await expect(readPassword({ from: "env", name: "SAUCE_ABSENT" }, io(), tool)).rejects.toThrow(
      /^env SAUCE_ABSENT: the variable is not set in this server's environment \(the client's configuration passes it, in the server entry's env block\)$/,
    );
    const value = password();
    expect(
      await readPassword({ from: "env", name: "SAUCE_PW" }, io({ SAUCE_PW: value }), tool),
    ).toBe(value);
    await expect(
      readPassword({ from: "env", name: "SAUCE_PW" }, io({ SAUCE_PW: "seven77" }), tool),
    ).rejects.toThrow(/^env SAUCE_PW gives a password of under 8 characters/);
  });

  it("reads only a regular file only its owner can read", async () => {
    const value = password();
    const file = join(work, "password");
    writeFileSync(file, `${value}\n`, { mode: 0o600 });
    expect(await readPassword({ from: "file", path: file }, io(), tool)).toBe(value);
    chmodSync(file, 0o644);
    await expect(readPassword({ from: "file", path: file }, io(), tool)).rejects.toThrow(
      new RegExp(`^file ${file} can be read or written by others \\(mode 644\\)`),
    );
    const directory = join(work, "a-directory");
    mkdirSync(directory, { mode: 0o700 });
    await expect(readPassword({ from: "file", path: directory }, io(), tool)).rejects.toThrow(
      new RegExp(`^file ${directory} is not a regular file$`),
    );
    // A flag's file is read as it always was, a pipe included.
    await expect(
      readPassword({ from: "file", path: directory }, io(), { what: "wallet test" }),
    ).rejects.toThrow(/--password-file .*: unreadable/);
  });

  it("reads one entry of a .env file, as dotenv does, and quotes no line of it", async () => {
    const value = password();
    const text = [
      "# comment",
      "PLAIN=plain value # a comment",
      `export QUOTED="${value} with spaces"`,
      'ESCAPED="a\\nb"',
      "BACK=`back`",
      "EMPTY=",
      "not an entry at all",
      "  SPACED =  spaced  ",
      "DUP=first",
      "DUP=last",
      "WINDOWS=crlf\r",
    ].join("\n");
    expect(dotenvEntry(text, "PLAIN")).toBe("plain value");
    expect(dotenvEntry(text, "QUOTED")).toBe(`${value} with spaces`);
    expect(dotenvEntry(text, "ESCAPED")).toBe("a\nb");
    expect(dotenvEntry(text, "BACK")).toBe("back");
    expect(dotenvEntry(text, "EMPTY")).toBe("");
    expect(dotenvEntry(text, "SPACED")).toBe("spaced");
    expect(dotenvEntry(text, "DUP")).toBe("last");
    expect(dotenvEntry(text, "WINDOWS")).toBe("crlf");
    expect(dotenvEntry(text, "ABSENT")).toBeUndefined();
    // The entry read is a secret from then on.
    expect(scrub(`it was ${value} with spaces`)).toBe("it was [redacted]");
    const file = join(work, ".env");
    writeFileSync(file, text, { mode: 0o600 });
    expect(await readPassword({ from: "dotenv", path: file, name: "QUOTED" }, io(), tool)).toBe(
      `${value} with spaces`,
    );
    const missing = readPassword({ from: "dotenv", path: file, name: "ABSENT" }, io(), tool);
    await expect(missing).rejects.toThrow(
      new RegExp(`^dotenv ${file}, variable ABSENT: the file has no ABSENT entry$`),
    );
    await expect(
      readPassword({ from: "dotenv", path: file, name: "EMPTY" }, io(), tool),
    ).rejects.toThrow(/variable EMPTY gives an empty password/);
    chmodSync(file, 0o604);
    await expect(
      readPassword({ from: "dotenv", path: file, name: "QUOTED" }, io(), tool),
    ).rejects.toThrow(/can be read or written by others \(mode 604\)/);
  });
});

describe("a generated password file", () => {
  it("is 43 random characters in a new file, 0600, beside the wallet directory, never over one", () => {
    const dir = join(work, "home", ".sauce", "wallets");
    const path = generatedPasswordFile(dir);
    expect(path).toBe(join(work, "home", ".sauce", "wallets.password"));
    expect(generatedPasswordFile(`${dir}/`)).toBe(path);
    // Its directory is made only for the default place.
    expect(() => generatePasswordFile(path)).toThrow(
      /does not exist: a password file goes in a directory that does/,
    );
    const first = generatePasswordFile(path, true);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(path, "utf8")).toBe(`${first}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(work, "home", ".sauce")).mode & 0o777).toBe(0o700);
    expect(() => generatePasswordFile(path, true)).toThrow(
      /wallets\.password exists: a password file is never overwritten/,
    );
    expect(readFileSync(path, "utf8")).toBe(`${first}\n`);
    // No temporary file is left behind, and the password is a secret.
    expect(readdirSync(join(work, "home", ".sauce"))).toEqual(["wallets.password"]);
    expect(scrub(`it is ${first}`)).toBe("it is [redacted]");
    expect(generatePasswordFile(join(work, "another"))).not.toBe(first);
  });
});

describe("the wallet directory", () => {
  it("creates the directory 0700 and each wallet 0600, once, never over another", async () => {
    const dir = join(work, "nested", "wallets");
    const store = new WalletStore(dir);
    const secret = password();
    const { info } = await store.create("agent", "evm", secret);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(info.path).mode & 0o777).toBe(0o600);
    expect(info).toMatchObject({ name: "agent", kind: "evm", path: join(dir, "agent.json") });
    const before = readFileSync(info.path, "utf8");
    await expect(store.create("agent", "evm", secret)).rejects.toThrow(
      /wallet agent exists .*: a wallet is never overwritten/,
    );
    expect(readFileSync(info.path, "utf8")).toBe(before);
    // No temporary file is left behind.
    expect(readdirSync(dir)).toEqual(["agent.json"]);
    expect(store.list().wallets.map((wallet) => wallet.address)).toEqual([info.address]);
    const unlocked = await store.unlock("agent", secret);
    expect(unlocked.kind === "evm" && unlocked.account.address).toBe(info.address);
  }, 60_000);

  it("creates no wallet under a password shorter than 8 characters, whoever asks", async () => {
    const store = new WalletStore(work);
    await expect(store.create("agent", "evm", "short")).rejects.toThrow(
      /a wallet's password is 8 characters at least/,
    );
    expect(readdirSync(work)).toEqual([]);
  });

  it("names a wallet with lowercase letters, digits, - and _", async () => {
    const store = new WalletStore(work);
    for (const name of ["Agent", "../escape", "a.b", "", "-lead", "x".repeat(65)]) {
      await expect(store.create(name, "evm", password())).rejects.toThrow(/is not a wallet name/);
    }
    expect(readdirSync(work)).toEqual([]);
  });
});

describe("sauce wallet", () => {
  async function sauce(
    env: Record<string, string>,
    ...argv: string[]
  ): Promise<{ code: number; stdout: string; stderr: string; terminal: string }> {
    let stdout = "";
    let stderr = "";
    let terminal = "";
    const io: CliIo = {
      ...nodeIo(),
      walletsDir: join(work, "wallets"),
      readEnv: (name) => env[name],
      ask: async () => env.ANSWER,
      writeTerminal: (text) => {
        terminal += text;

        return true;
      },
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };

    return { code: await runCli(argv, io), stdout, stderr, terminal };
  }

  it("creates, lists and names wallets with no password shown, and refuses a key on the command line", async () => {
    const secret = password();
    const env = { SAUCE_TEST_PW: secret };
    const created = await sauce(
      env,
      ...["wallet", "new", "agent", "--password-env", "SAUCE_TEST_PW", "--json"],
    );
    expect(created.code).toBe(0);
    const json = JSON.parse(created.stdout) as { address: string; kind: string; policy: unknown };
    expect(json).toMatchObject({ kind: "evm", policy: null });
    expect(created.stderr).toContain("This is a hot wallet");
    const sol = await sauce(
      env,
      ...["wallet", "new", "sol", "--solana", "--password-env", "SAUCE_TEST_PW"],
    );
    expect(sol.code).toBe(0);
    expect(sol.stdout).toMatch(/^Created wallet sol \(Solana\): [1-9A-HJ-NP-Za-km-z]{32,44}$/m);

    const list = await sauce({}, "wallet", "list", "--json");
    expect(
      (JSON.parse(list.stdout) as { wallets: Array<{ name: string; kind: string }> }).wallets.map(
        (wallet) => `${wallet.name}:${wallet.kind}`,
      ),
    ).toEqual(["agent:evm", "sol:solana"]);
    // With no verb, the list.
    expect((await sauce({}, "wallet")).stdout).toMatch(/^Wallets in .*:\n {2}agent {2}evm +0x/);
    expect((await sauce({}, "wallet", "address", "agent")).stdout.trim()).toBe(json.address);

    // An import reads a file or stdin; a key given as the operand is refused, and never shown.
    const key = generatePrivateKey();
    const refused = await sauce(
      env,
      ...["wallet", "import", "other", key, "--password-env", "SAUCE_TEST_PW"],
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toMatch(/import reads the key from a file, or from stdin/);
    const keyFile = join(work, "key.txt");
    writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
    const imported = await sauce(
      env,
      ...["wallet", "import", "other", keyFile, "--password-env", "SAUCE_TEST_PW", "--json"],
    );
    expect(imported.code).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      name: "other",
      address: privateKeyToAccount(key).address,
    });
    // A Solana keypair file, and the --solana check.
    const keypair = readFileSync(join(work, "wallets", "sol.json"), "utf8");
    const solBytes = decryptKeystoreBytes(keypair, secret).bytes;
    const keypairFile = join(work, "keypair.json");
    writeFileSync(keypairFile, JSON.stringify([...solBytes]), { mode: 0o600 });
    const solImport = await sauce(
      env,
      ...[
        "wallet",
        "import",
        "sol-copy",
        keypairFile,
        "--solana",
        "--password-env",
        "SAUCE_TEST_PW",
      ],
    );
    expect(solImport.code).toBe(0);
    expect((await sauce({}, "wallet", "address", "sol-copy")).stdout.trim()).toBe(
      (await sauce({}, "wallet", "address", "sol")).stdout.trim(),
    );
    const notSolana = await sauce(
      env,
      ...["wallet", "import", "x", keyFile, "--solana", "--password-env", "SAUCE_TEST_PW"],
    );
    expect(notSolana.stderr).toMatch(/--solana: \S+ holds an EVM key, not a Solana keypair/);

    const everything = [created, sol, list, refused, imported, solImport, notSolana]
      .map((run) => run.stdout + run.stderr)
      .join("\n");
    for (const leak of [secret, key.slice(2), bytesToHex(solBytes).slice(2)]) {
      expect(everything.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    expect(everything).not.toContain(getBase58Decoder().decode(solBytes));
  }, 120_000);

  it("exports a key only to the terminal, after the wallet's name is typed", async () => {
    const secret = password();
    const env = { SAUCE_TEST_PW: secret };
    await sauce(env, ...["wallet", "new", "agent", "--password-env", "SAUCE_TEST_PW"]);
    const wrong = await sauce(
      { ...env, ANSWER: "yes" },
      ...["wallet", "export", "agent", "--password-env", "SAUCE_TEST_PW"],
    );
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toMatch(/not shown: the name typed does not match/);
    expect(wrong.terminal).toBe("");
    const shown = await sauce(
      { ...env, ANSWER: "agent" },
      ...["wallet", "export", "agent", "--password-env", "SAUCE_TEST_PW"],
    );
    expect(shown.code).toBe(0);
    const key = /0x[0-9a-f]{64}/.exec(shown.terminal)?.[0];
    expect(key).toBeDefined();
    const store = new WalletStore(join(work, "wallets"));
    expect(privateKeyToAccount(key as `0x${string}`).address).toBe(store.info("agent").address);
    // Never on stdout or stderr.
    expect(shown.stdout + shown.stderr).not.toContain(key!.slice(2));
    // With no terminal to ask on, nothing is shown.
    const noTerminal = await sauce(env, ...["wallet", "export", "agent"]);
    expect(noTerminal.code).toBe(1);
    expect(noTerminal.stderr).toMatch(/export shows a key only at a terminal/);
  }, 120_000);

  it("signs with --wallet where --keystore signs, and refuses the wrong kind", async () => {
    const secret = password();
    const env = { SAUCE_TEST_PW: secret };
    await sauce(env, ...["wallet", "new", "agent", "--password-env", "SAUCE_TEST_PW"]);
    await sauce(env, ...["wallet", "new", "sol", "--solana", "--password-env", "SAUCE_TEST_PW"]);
    const store = new WalletStore(join(work, "wallets"));
    // `sauce pot` with a wallet names its own Pot, reading the address with no password.
    const pot = await sauce({}, "pot", "--chain", "base", "--wallet", "agent");
    expect(pot.code).toBe(0);
    expect(JSON.parse(pot.stdout)).toMatchObject({ owner: store.info("agent").address });
    const solPot = await sauce({}, "pot", "--chain", "solana", "--wallet", "sol");
    expect(solPot.code).toBe(0);
    expect(solPot.stdout).toContain(store.info("sol").address);
    // The wrong kind for the chain is refused by name.
    const wrongKind = await sauce(env, "pot", "--chain", "solana", "--wallet", "agent", "--deploy");
    expect(wrongKind.stderr).toMatch(
      /wallet agent is an EVM wallet: on Solana, sign with a Solana wallet/,
    );
    const evmWithSol = await sauce(
      env,
      ...[
        "pot",
        "--chain",
        "base",
        "--wallet",
        "sol",
        "--deploy",
        "--rpc-url",
        "http://127.0.0.1:9",
      ],
    );
    expect(evmWithSol.stderr).toMatch(
      /wallet sol is a Solana wallet: an EVM transaction is signed by an EVM wallet/,
    );
    const two = await sauce(
      env,
      ...["pot", "--chain", "base", "--wallet", "agent", "--private-key", generatePrivateKey()],
    );
    expect(two.stderr).toMatch(/give one signer, not --wallet and --private-key/);
    const twoDeploy = await sauce(
      env,
      ...["pot", "--chain", "base", "--deploy", "--rpc-url", "http://127.0.0.1:9"],
      ...[
        "--wallet",
        "agent",
        "--private-key",
        generatePrivateKey(),
        "--password-env",
        "SAUCE_TEST_PW",
      ],
    );
    expect(twoDeploy.stderr).toMatch(/give one signer, not --wallet and --private-key/);
    // A missing wallet names the directory, and how to make one.
    const missing = await sauce(env, "pot", "--chain", "base", "--wallet", "nobody");
    expect(missing.stderr).toMatch(/no wallet nobody in .*`sauce wallet new nobody` creates one/);
  }, 120_000);
});

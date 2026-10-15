/**
 * The wallet tools in process, with no endpoint: registered only on a server given wallets (which
 * `sauce mcp` over stdio is, unless `--no-wallets`), listing with no password, refusing to create,
 * import or send until the wallets are enabled — by the server's start, or by the source an agent
 * names to `sauce_enable_wallets`, each of which is read here — never taking or returning a key or
 * a password, and refusing what `sauce_wallet_send` cannot send before it reaches any chain.
 * Sending on a chain is `wallets.e2e.test.ts`. Every password and key here is thrown away.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { bytesToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { decryptKeystoreBytes, encryptKeystore } from "../../sdk/dist/cli/signer.js";
import { encodeCursor } from "../../sdk/dist/cli/svm-plan.js";
import { WalletStore } from "../../sdk/dist/cli/wallets.js";
import { INTENT_TOOL_NAMES } from "../src/intents.js";
import { SEND_TOOL_NAMES } from "../src/send.js";
import { SKILL_TOOL_NAMES } from "../src/skilltools.js";
import { TOOL_NAMES, WALLET_UNSIGNED } from "../src/tools.js";
import { DOTENV_VARIABLE, WALLET_TOOL_NAMES } from "../src/wallets.js";
import { connect, failed, ok, textOf, type Connected, walletsAt } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

/** What no input of any tool may be called, at any depth: nothing takes a key or a password. */
const SECRET_FIELD = /key|secret|password|mnemonic|seed|keystore|keypair|passphrase/i;

/** Every property name a JSON schema declares, nested ones included. */
function fieldsOf(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const properties = (node.properties ?? {}) as Record<string, unknown>;

  return [
    ...Object.keys(properties),
    ...Object.values(properties).flatMap(fieldsOf),
    ...["items", "additionalProperties"].flatMap((key) => fieldsOf(node[key])),
    ...["anyOf", "oneOf", "allOf"].flatMap((key) =>
      Array.isArray(node[key]) ? (node[key] as unknown[]).flatMap(fieldsOf) : [],
    ),
  ];
}

/** A throwaway password. */
const throwaway = (label: string) => `throwaway-${label}-${process.pid}-${Date.now()}`;

describe("a server without wallets", () => {
  let mcp: Connected;
  before(async () => {
    mcp = await connect();
  });
  after(() => mcp.close());

  it("has no wallet tool, and says nothing here signs", async () => {
    const { tools } = await mcp.client.listTools();
    assert.ok(tools.every((tool) => !tool.name.startsWith("sauce_wallet")));
    assert.match(mcp.client.getInstructions() ?? "", /NOTHING HERE SIGNS\./);
    assert.ok(tools.every((tool) => !(tool.description ?? "").includes("sauce_wallet_send")));
  });
});

describe("a server whose password is too short to create a wallet with", () => {
  let dir: string;
  let mcp: Connected;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-wallets-short-"));
    mcp = await connect(undefined, undefined, walletsAt(join(dir, "wallets"), { start: "short" }));
  });
  after(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to create one, as the command does", async () => {
    assert.match(
      failed(await mcp.call("sauce_wallet_create", { name: "agent" })),
      /a wallet's password is 8 characters at least/,
    );
  });
});

describe("a server whose password does not open its wallet, given a Solana plan", () => {
  let dir: string;
  let mcp: Connected;
  let wallet: string;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-wallets-plan-"));
    const store = new WalletStore(join(dir, "wallets"));
    wallet = (await store.create("sol", "solana", `opens-${process.pid}-${Date.now()}`)).info
      .address;
    mcp = await connect(undefined, undefined, walletsAt(store.dir, { start: "not-the-password" }));
  });
  after(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A plan's cursor, its owner `owner`. */
  const cursorFor = (owner: string) =>
    encodeCursor({
      owner: owner as never,
      salt: `0x${"11".repeat(32)}`,
      via: "kitchen",
      tail: [],
      lookupTables: [],
      pot: "there",
      tokenAccounts: [],
      payload: new Uint8Array([1, 2, 3]),
      labels: [],
    });

  it("refuses another owner's plan by name before it unlocks the wallet or reads a chain", async () => {
    const other = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
    const message = failed(
      await mcp.call("sauce_wallet_send", {
        wallet: "sol",
        transaction: { cursor: cursorFor(other) },
        rpcUrl: "http://127.0.0.1:9/",
      }),
    );
    assert.match(
      message,
      new RegExp(
        `the plan is ${other}'s: only that key signs its transactions, and wallet sol is ${wallet}`,
      ),
    );
    assert.doesNotMatch(message, /password/i);
    // Its own plan goes on to the unlock, which this password does not open.
    assert.doesNotMatch(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "sol",
          transaction: { cursor: cursorFor(wallet) },
          rpcUrl: "http://127.0.0.1:9/",
        }),
      ),
      /the plan is/,
    );
  });
});

describe("a server with wallets", () => {
  let dir: string;
  let mcp: Connected;
  const password = `throwaway-${process.pid}-${Date.now()}`;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-wallets-"));
    mcp = await connect(undefined, undefined, walletsAt(join(dir, "wallets"), { start: password }));
  });
  after(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists the wallet tools after the intent tools, none taking a key or a password", async () => {
    const { tools } = await mcp.client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        ...TOOL_NAMES,
        ...INTENT_TOOL_NAMES,
        ...SEND_TOOL_NAMES,
        ...WALLET_TOOL_NAMES,
        ...SKILL_TOOL_NAMES,
      ],
    );
    for (const tool of tools) {
      for (const field of fieldsOf(tool.inputSchema)) {
        assert.doesNotMatch(field, SECRET_FIELD, `${tool.name} takes ${field}`);
      }
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.get("sauce_wallet_send")?.annotations?.destructiveHint, true);
    assert.equal(byName.get("sauce_wallet_list")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("sauce_wallet_create")?.annotations?.destructiveHint, false);
    assert.equal(byName.get("sauce_wallet_address")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("sauce_enable_wallets")?.annotations?.destructiveHint, false);
    // Every tool that builds a transaction says it can be sent from a wallet here.
    for (const name of ["sauce_tx", "sauce_pot", "sauce_intent_fill", "sauce_intent_claim"]) {
      assert.ok(byName.get(name)?.description?.includes(WALLET_UNSIGNED), name);
    }
    const instructions = mcp.client.getInstructions() ?? "";
    assert.match(instructions, /THIS SERVER SIGNS ONLY WITH THE WALLETS IN ITS WALLET DIRECTORY/);
    assert.match(instructions, /--password-env SAUCE_TEST_WALLET_PASSWORD/);
  });

  it("creates EVM and Solana wallets, returning addresses and never a key", async () => {
    const evm = ok(await mcp.call("sauce_wallet_create", { name: "agent" }));
    assert.match(String(evm.address), /^0x[0-9a-fA-F]{40}$/);
    assert.equal(evm.kind, "evm");
    assert.equal(evm.policy, null);
    assert.ok((evm.notes as string[]).some((note) => /no limits are set/.test(note)));
    assert.ok((evm.notes as string[]).some((note) => /hot wallet/.test(note)));
    const sol = ok(await mcp.call("sauce_wallet_create", { name: "sol", kind: "solana" }));
    assert.equal(sol.kind, "solana");
    assert.match(
      failed(await mcp.call("sauce_wallet_create", { name: "agent" })),
      /wallet agent exists: a wallet is never overwritten/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_create", { name: "Not A Name" })),
      /is not a wallet name/,
    );
    const listed = ok(await mcp.call("sauce_wallet_list")) as {
      wallets: Array<{ name: string; kind: string; address: string }>;
    };
    assert.deepEqual(
      listed.wallets.map((wallet) => [wallet.name, wallet.kind, wallet.address]),
      [
        ["agent", "evm", evm.address],
        ["sol", "solana", sol.address],
      ],
    );
    // Neither key, in any spelling, nor the password, ever came back.
    for (const name of ["agent", "sol"]) {
      const { bytes } = decryptKeystoreBytes(
        readFileSync(join(dir, "wallets", `${name}.json`), "utf8"),
        password,
      );
      const hex = Buffer.from(bytes).toString("hex");
      for (const text of mcp.received) {
        assert.ok(!text.toLowerCase().includes(hex.slice(0, 32)), `${name}'s key`);
        assert.ok(!text.includes(JSON.stringify([...bytes]).slice(1, 40)), `${name}'s keypair`);
      }
    }
    assert.ok(mcp.received.every((text) => !text.includes(password)));
  });

  it("names a wallet's address with no password, and keeps the operator's password source", async () => {
    const listed = ok(await mcp.call("sauce_wallet_list"));
    assert.equal(listed.enabled, true);
    assert.equal(listed.source, "--password-env SAUCE_TEST_WALLET_PASSWORD");
    const agent = (listed.wallets as Array<Record<string, unknown>>)[0]!;
    const address = ok(await mcp.call("sauce_wallet_address", { name: "agent" }));
    assert.deepEqual(
      [address.name, address.kind, address.address, address.policy],
      [agent.name, agent.kind, agent.address, null],
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_address", { name: "nobody" })),
      /no wallet nobody in .*: sauce_wallet_list names them, and sauce_wallet_create creates one/,
    );
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { generate: true })),
      /the wallets are enabled already, by the password source this server was started with \(--password-env SAUCE_TEST_WALLET_PASSWORD\): it is its operator's to change/,
    );
  });

  it("refuses what it cannot send before any chain is read", async () => {
    const tx = { chainId: 8453, to: OWNER, data: "0x", value: "0" };
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "nobody", transaction: tx })),
      /no wallet nobody/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "agent", transaction: { hello: 1 } })),
      /transaction is not a transaction/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "agent",
          transaction: { ready: false, why: "the proof has not arrived", transactions: [] },
        }),
      ),
      /is not ready to send: the proof has not arrived/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "agent",
          transaction: [tx, { ...tx, chainId: 1 }],
        }),
      ),
      /send each chain's in a call of its own/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "sol", transaction: tx })),
      /wallet sol is a Solana wallet, and these are EVM transactions/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "agent",
          transaction: { to: OWNER, data: "0x", value: "0" },
        }),
      ),
      /name no chain: give chain/,
    );
    // A preview chain is refused before any endpoint is reached, saying how to ask for it.
    const preview = await mcp.call("sauce_wallet_send", {
      wallet: "agent",
      transaction: { ...tx, chainId: 42161 },
    });
    assert.equal(preview.isError, true);
    const refused = (preview.structuredContent as { refused?: Record<string, unknown> }).refused;
    assert.equal(refused?.code, "preview-chain");
    assert.equal(refused?.action, "sending from a wallet");
    // No endpoint: the call can give one.
    assert.match(
      failed(await mcp.call("sauce_wallet_send", { wallet: "agent", transaction: tx })),
      /Sending needs an RPC endpoint for base .* Pass rpcUrl with the call/,
    );
  });

  it("says, on a transaction it builds, that a wallet here can send it", async () => {
    const pot = ok(await mcp.call("sauce_pot", { chain: "base", owner: OWNER }));
    assert.ok(
      (pot.notes as string[]).some((note) =>
        /To send it from one of this server's wallets: sauce_wallet_send/.test(note),
      ),
      textOf({ content: [{ type: "text", text: JSON.stringify(pot.notes) }] }),
    );
    // A compile builds nothing to send.
    const compiled = ok(
      await mcp.call("sauce_compile", { source: "function main() {}\n", chain: "base" }),
    );
    assert.ok(
      ((compiled.notes as string[] | undefined) ?? []).every(
        (note) => !/sauce_wallet_send/.test(note),
      ),
    );
  });
});

describe("a server whose wallets the agent enables", () => {
  let dir: string;
  let wallets: string;
  let mcp: Connected;
  const fromEnv = throwaway("env");
  const fromFile = throwaway("file");
  const fromDotenv = throwaway("dotenv");
  let made: string;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-enable-"));
    wallets = join(dir, "wallets");
    // A wallet the CLI made already, under the file's password: listed before anything is enabled.
    made = (await new WalletStore(wallets).create("made", "evm", fromFile)).info.address;
    mcp = await connect(
      undefined,
      undefined,
      walletsAt(wallets, {
        env: { SAUCE_TEST_WALLET_PASSWORD: fromEnv, SAUCE_TEST_SHORT: "q7Zw3" },
      }),
    );
  });
  after(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists and names the wallets before they are enabled, and refuses to create, import or send", async () => {
    const instructions = mcp.client.getInstructions() ?? "";
    assert.match(instructions, /THIS SERVER SIGNS ONLY WITH THE WALLETS IN ITS WALLET DIRECTORY/);
    assert.match(instructions, /call sauce_enable_wallets once/);
    assert.match(instructions, /\{ generate: true \}/);
    const listed = ok(await mcp.call("sauce_wallet_list"));
    assert.deepEqual([listed.dir, listed.enabled, listed.source], [wallets, false, null]);
    assert.deepEqual(
      (listed.wallets as Array<{ address: string }>).map((wallet) => wallet.address),
      [made],
    );
    assert.match(String((listed.notes as string[])[0]), /The wallets are not enabled/);
    assert.equal(ok(await mcp.call("sauce_wallet_address", { name: "made" })).address, made);
    const refusal =
      /needs the wallets enabled: call sauce_enable_wallets once, naming where their password comes from, never the password itself: \{ env: "<NAME>" \}.*\{ file: "<path>" \}.*\{ dotenv: "<path>", variable: "<NAME>" \}.*\{ generate: true \}/;
    assert.match(failed(await mcp.call("sauce_wallet_create", { name: "agent" })), refusal);
    const key = join(dir, "key.hex");
    writeFileSync(key, `${generatePrivateKey()}\n`, { mode: 0o600 });
    assert.match(
      failed(await mcp.call("sauce_wallet_import", { name: "imported", path: key })),
      refusal,
    );
    assert.match(
      failed(
        await mcp.call("sauce_wallet_send", {
          wallet: "made",
          transaction: { chainId: 8453, to: OWNER, data: "0x", value: "0" },
        }),
      ),
      refusal,
    );
  });

  it("takes a source, never a password or a command, and one at a time", async () => {
    for (const [args, message] of [
      [{}, /give one source of the wallets' password: \{ env/],
      [{ env: "A", file: "b" }, /give one source of the wallets' password, not env and file/],
      [
        { variable: "X", env: "A" },
        /variable names an entry of the dotenv file: it goes with dotenv/,
      ],
      [{ env: "hunter2 is the value" }, /env takes the NAME of an environment variable/],
    ] as const) {
      assert.match(failed(await mcp.call("sauce_enable_wallets", args)), message);
    }
    // A field it does not have is refused by its schema: there is no password, and no command.
    for (const field of ["password", "command", "passwordCommand", "value"]) {
      const result = await mcp.call("sauce_enable_wallets", { [field]: "x" });
      assert.equal(result.isError, true, field);
    }
    // A value given where a name goes is never repeated.
    const leaked = "not-a-name value 9f8e7d";
    assert.ok(!failed(await mcp.call("sauce_enable_wallets", { env: leaked })).includes(leaked));
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { env: "SAUCE_TEST_UNSET" })),
      /env SAUCE_TEST_UNSET: the variable is not set in this server's environment \(the client's configuration passes it/,
    );
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { env: "SAUCE_TEST_SHORT" })),
      /env SAUCE_TEST_SHORT gives a password of under 8 characters/,
    );
    assert.ok(mcp.received.every((text) => !text.includes(leaked)));
    // Still not enabled.
    assert.equal(ok(await mcp.call("sauce_wallet_list")).enabled, false);
  });

  it("enables with a variable of the server's environment, then creates", async () => {
    const enabled = ok(
      await mcp.call("sauce_enable_wallets", { env: "SAUCE_TEST_WALLET_PASSWORD" }),
    );
    assert.deepEqual(
      [enabled.dir, enabled.enabled, enabled.source, enabled.wallets],
      [wallets, true, "env SAUCE_TEST_WALLET_PASSWORD", ["made"]],
    );
    const created = ok(await mcp.call("sauce_wallet_create", { name: "by-env" }));
    const { bytes } = decryptKeystoreBytes(
      readFileSync(join(wallets, "by-env.json"), "utf8"),
      fromEnv,
    );
    assert.equal(privateKeyToAccount(bytesToHex(bytes)).address, created.address);
    const listed = ok(await mcp.call("sauce_wallet_list"));
    assert.deepEqual([listed.enabled, listed.source], [true, "env SAUCE_TEST_WALLET_PASSWORD"]);
  });

  it("enables with a password file only its owner can read, replacing the source before", async () => {
    const file = join(dir, "wallet-password");
    writeFileSync(file, `${fromFile}\n`, { mode: 0o644 });
    chmodSync(file, 0o644);
    const shared = failed(await mcp.call("sauce_enable_wallets", { file }));
    assert.match(
      shared,
      new RegExp(
        `file ${file} can be read or written by others \\(mode 644\\): a password file must be ` +
          `yours alone. Run \`chmod 600 ${file}\``,
      ),
    );
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { file: dir })),
      new RegExp(`file ${dir} is not a regular file`),
    );
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { file: join(dir, "absent") })),
      /absent: no such file/,
    );
    chmodSync(file, 0o600);
    const enabled = ok(await mcp.call("sauce_enable_wallets", { file }));
    assert.equal(enabled.source, `file ${file}`);
    assert.ok(
      (enabled.notes as string[]).includes(
        "It replaces the source before, env SAUCE_TEST_WALLET_PASSWORD.",
      ),
    );
    // The file's password opens the wallet the CLI made with it.
    ok(await mcp.call("sauce_wallet_create", { name: "by-file" }));
    decryptKeystoreBytes(readFileSync(join(wallets, "by-file.json"), "utf8"), fromFile);
  });

  it("enables with an entry of a .env file, never quoting the file", async () => {
    const dotenv = join(dir, ".env");
    const other = "OTHER_SECRET_c0ffee";
    writeFileSync(
      dotenv,
      [
        "# the agent's .env",
        `RPC_TOKEN=${other}`,
        "this line is not an entry",
        `export ${DOTENV_VARIABLE}="${fromDotenv}" # quoted`,
        `SAUCE_TEST_SINGLE='${fromDotenv}-single'`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { dotenv, variable: "SAUCE_TEST_ABSENT" })),
      new RegExp(
        `dotenv ${dotenv}, variable SAUCE_TEST_ABSENT: the file has no SAUCE_TEST_ABSENT entry`,
      ),
    );
    const enabled = ok(await mcp.call("sauce_enable_wallets", { dotenv }));
    assert.equal(enabled.source, `dotenv ${dotenv}, variable ${DOTENV_VARIABLE}`);
    ok(await mcp.call("sauce_wallet_create", { name: "by-dotenv" }));
    decryptKeystoreBytes(readFileSync(join(wallets, "by-dotenv.json"), "utf8"), fromDotenv);
    const single = ok(
      await mcp.call("sauce_enable_wallets", { dotenv, variable: "SAUCE_TEST_SINGLE" }),
    );
    assert.equal(single.enabled, true);
    chmodSync(dotenv, 0o640);
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { dotenv })),
      /can be read or written by others \(mode 640\)/,
    );
    for (const text of mcp.received) {
      assert.ok(!text.includes(fromDotenv), "the entry's value");
      assert.ok(!text.includes(other), "another entry");
      assert.ok(!text.includes("this line is not an entry"), "a line of the file");
    }
  });

  it("generates a password into a new file beside the wallet directory, never over one", async () => {
    const generated = ok(await mcp.call("sauce_enable_wallets", { generate: true }));
    const passwordFile = `${wallets}.password`;
    assert.equal(generated.passwordFile, passwordFile);
    assert.equal(generated.source, `file ${passwordFile}`);
    assert.equal(statSync(passwordFile).mode & 0o777, 0o600);
    const password = readFileSync(passwordFile, "utf8").trim();
    assert.match(password, /^[A-Za-z0-9_-]{43}$/);
    const notes = generated.notes as string[];
    assert.ok(
      notes.some((note) => note.startsWith(`${passwordFile} holds the wallets' new password`)),
    );
    assert.ok(notes.some((note) => /were made under another password, and do not open/.test(note)));
    ok(await mcp.call("sauce_wallet_create", { name: "by-generate" }));
    decryptKeystoreBytes(readFileSync(join(wallets, "by-generate.json"), "utf8"), password);
    // Never over a file, and never in the wallet directory.
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { generate: true })),
      /exists: a password file is never overwritten/,
    );
    assert.equal(readFileSync(passwordFile, "utf8").trim(), password);
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { generate: join(wallets, "pw") })),
      /is in the wallet directory: a password file goes beside it, never in it/,
    );
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { generate: join(dir, "absent", "pw") })),
      /does not exist: a password file goes in a directory that does/,
    );
    // A path the agent names, in a git work tree: written, and noted.
    const repo = join(dir, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const inRepo = ok(await mcp.call("sauce_enable_wallets", { generate: join(repo, "pw") }));
    assert.ok(
      (inRepo.notes as string[]).some((note) =>
        note.includes(`is inside the git work tree ${repo}: keep it out of the repository`),
      ),
    );
    const repoPassword = readFileSync(join(repo, "pw"), "utf8").trim();
    for (const text of mcp.received) {
      assert.ok(!text.includes(password) && !text.includes(repoPassword));
    }
  });

  it("keeps the operator's wallet directory", async () => {
    assert.match(
      failed(await mcp.call("sauce_enable_wallets", { generate: true, dir: join(dir, "other") })),
      /this server was started with the wallet directory .* \(--wallets\): it is its operator's to change/,
    );
  });
});

describe("a server whose wallet directory is the default, enabled with another", () => {
  let dir: string;
  let mcp: Connected;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-enable-dir-"));
    mcp = await connect(undefined, undefined, {
      ...walletsAt(join(dir, "default")),
      dirNamed: false,
    });
  });
  after(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the directory sauce_enable_wallets names from then on", async () => {
    const other = join(dir, "other");
    const enabled = ok(await mcp.call("sauce_enable_wallets", { generate: true, dir: other }));
    assert.deepEqual([enabled.dir, enabled.passwordFile], [other, `${other}.password`]);
    ok(await mcp.call("sauce_wallet_create", { name: "agent" }));
    const listed = ok(await mcp.call("sauce_wallet_list"));
    assert.equal(listed.dir, other);
    assert.equal(statSync(join(other, "agent.json")).mode & 0o777, 0o600);
  });
});

describe("importing a key file", () => {
  let dir: string;
  let mcp: Connected;
  const password = throwaway("import");
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-import-"));
    mcp = await connect(undefined, undefined, walletsAt(join(dir, "wallets"), { start: password }));
  });
  after(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A file only its owner can read, holding `text`. */
  const keyFile = (name: string, text: string, mode = 0o600) => {
    const path = join(dir, name);
    writeFileSync(path, text, { mode });
    chmodSync(path, mode);

    return path;
  };

  it("imports a keystore under the wallets' password, a Solana keypair and a raw key", async () => {
    const evm = generatePrivateKey();
    const account = privateKeyToAccount(evm);
    const keystore = keyFile(
      "keystore.json",
      encryptKeystore(Buffer.from(evm.slice(2), "hex"), password, {
        kind: "evm",
        address: account.address.slice(2).toLowerCase(),
      }),
    );
    const fromKeystore = ok(
      await mcp.call("sauce_wallet_import", { name: "from-keystore", path: keystore }),
    );
    assert.deepEqual([fromKeystore.kind, fromKeystore.address], ["evm", account.address]);
    assert.ok((fromKeystore.notes as string[]).some((note) => /hot wallet/.test(note)));
    const raw = generatePrivateKey();
    const fromHex = ok(
      await mcp.call("sauce_wallet_import", {
        name: "from-hex",
        path: keyFile("key.hex", `${raw}\n`),
        kind: "evm",
      }),
    );
    assert.equal(fromHex.address, privateKeyToAccount(raw).address);
    // A Solana keypair, as solana-keygen writes one: a wallet the server made, exported here.
    const sol = new WalletStore(join(dir, "elsewhere"));
    const solPassword = throwaway("sol");
    const made = (await sol.create("sol", "solana", solPassword)).info;
    const { bytes } = sol.secretOf("sol", solPassword);
    const keypair = keyFile("id.json", JSON.stringify([...bytes]));
    const fromKeypair = ok(
      await mcp.call("sauce_wallet_import", {
        name: "from-keypair",
        path: keypair,
        kind: "solana",
      }),
    );
    assert.deepEqual([fromKeypair.kind, fromKeypair.address], ["solana", made.address]);
    // Each opens with the wallets' password, and the file it came from is left as it was.
    decryptKeystoreBytes(readFileSync(join(dir, "wallets", "from-hex.json"), "utf8"), password);
    assert.equal(readFileSync(keypair, "utf8"), JSON.stringify([...bytes]));
    const listed = ok(await mcp.call("sauce_wallet_list"));
    assert.deepEqual(
      (listed.wallets as Array<{ name: string }>).map((wallet) => wallet.name),
      ["from-hex", "from-keypair", "from-keystore"],
    );
    for (const text of mcp.received) {
      assert.ok(!text.toLowerCase().includes(evm.slice(2, 34)), "the keystore's key");
      assert.ok(!text.toLowerCase().includes(raw.slice(2, 34)), "the raw key");
      assert.ok(!text.includes(JSON.stringify([...bytes]).slice(1, 40)), "the keypair");
      assert.ok(!text.includes(password));
    }
  });

  it("refuses a file others can read, a keystore under another password, and a key as the path", async () => {
    const raw = generatePrivateKey();
    const shared = keyFile("shared.hex", `${raw}\n`, 0o644);
    assert.match(
      failed(await mcp.call("sauce_wallet_import", { name: "shared", path: shared })),
      new RegExp(
        `${shared} can be read or written by others \\(mode 644\\): a key file must be yours ` +
          `alone. Run \`chmod 600 ${shared}\`, then import it`,
      ),
    );
    const evm = generatePrivateKey();
    const other = keyFile(
      "other.json",
      encryptKeystore(Buffer.from(evm.slice(2), "hex"), throwaway("other"), {
        kind: "evm",
        address: privateKeyToAccount(evm).address.slice(2).toLowerCase(),
      }),
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_import", { name: "other", path: other })),
      /the keystore password is wrong .* A keystore is imported under its own password, which must be the one the wallets are enabled with/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_import", { name: "dir", path: dir })),
      /is not a regular file/,
    );
    assert.match(
      failed(await mcp.call("sauce_wallet_import", { name: "absent", path: join(dir, "absent") })),
      /absent: no such file/,
    );
    const garbage = keyFile("garbage.txt", "not a key at all, line one\n");
    const notAKey = failed(
      await mcp.call("sauce_wallet_import", { name: "garbage", path: garbage }),
    );
    assert.match(notAKey, /holds no key this command reads/);
    assert.ok(!notAKey.includes("not a key at all"));
    assert.match(
      failed(
        await mcp.call("sauce_wallet_import", {
          name: "wrong-kind",
          path: keyFile("evm.hex", `${generatePrivateKey()}\n`),
          kind: "solana",
        }),
      ),
      /holds an EVM key, not a Solana keypair/,
    );
    const pasted = generatePrivateKey();
    const asPath = failed(await mcp.call("sauce_wallet_import", { name: "pasted", path: pasted }));
    assert.match(asPath, /path names the file a key is in, never the key/);
    for (const text of mcp.received) {
      for (const key of [raw, evm, pasted]) {
        assert.ok(!text.toLowerCase().includes(key.slice(2, 34)));
      }
    }
    // Nothing refused was imported.
    assert.equal((ok(await mcp.call("sauce_wallet_list")).wallets as unknown[]).length, 3);
  });
});

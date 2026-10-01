// Dumps the eco-routes programs deployed on Solana mainnet, and the accounts they need, into the
// test-only fixture `test/fixtures/eco-routes-svm/` that the LiteSVM suites load. Nothing in the
// SDK ships them: a test runs the programs exactly as mainnet does, without building them.
//
//   node scripts/dump-eco-routes-svm.mjs --redump --rpc-config rpc.config.json
//   node scripts/dump-eco-routes-svm.mjs --check --rpc-config rpc.config.json
//
// `--redump` rewrites the fixture: each program's ELF (its ProgramData account past the 45-byte
// loader header, gzipped), each account's data, and `manifest.json` — every program's id,
// ProgramData address, upgrade authority, last-deploy slot and sha256, each account's address,
// owner and sha256, the slot read at and the date. `--check` reads the same things and reports
// what moved since the manifest, writing nothing. Review a redump's diff before committing it:
// a changed program sha256 is an upgrade, and the tests then run the new code.
//
// The endpoint comes only from the `--rpc-config` file (chain id -> URL), under Solana's chain id
// 1399811149, as in `capture-registry-abi.mjs`: no default, no fallback, nothing read from the
// environment, and no URL ever written to the fixture.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { address, getAddressDecoder, getProgramDerivedAddress } from "@solana/kit";

const USAGE =
  "usage: node scripts/dump-eco-routes-svm.mjs (--redump | --check) --rpc-config <path>";
const SOLANA = "1399811149";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** `UpgradeableLoaderState::ProgramData`: a u32 tag, the deploy slot, an `Option<Pubkey>`. */
const PROGRAM_DATA_HEADER = 4 + 8 + 1 + 32;

function fail(message) {
  console.error(`dump-eco-routes-svm: ${message}`);
  process.exit(1);
}

let cli;
try {
  cli = parseArgs({
    options: {
      redump: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      "rpc-config": { type: "string" },
    },
  });
} catch (error) {
  fail(`${error.message}\n${USAGE}`);
}
if (cli.values.redump === cli.values.check) fail(`give one of --redump and --check\n${USAGE}`);
if (cli.values["rpc-config"] === undefined) fail(`pass --rpc-config <path>\n${USAGE}`);
let config;
try {
  config = JSON.parse(readFileSync(cli.values["rpc-config"], "utf8"));
} catch (error) {
  fail(`cannot read --rpc-config: ${error.message}`);
}
// Either a flat `{ chainId: url }` file or a `sauce` config's `{ rpcUrls: { … } }`.
const URL_OF = config?.rpcUrls ?? config;
const RPC = URL_OF?.[SOLANA];
if (typeof RPC !== "string" || !/^https?:\/\//.test(RPC)) {
  fail(`--rpc-config gives no URL for Solana (chain id ${SOLANA})`);
}

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(SDK, "test", "fixtures", "eco-routes-svm");
const MANIFEST = join(DIR, "manifest.json");

const text = (value) => new TextEncoder().encode(value);
const pda = async (program, seeds) =>
  (await getProgramDerivedAddress({ programAddress: address(program), seeds }))[0];

/**
 * The programs: eco-routes' Solana deployment (the registry's ids, which the pin test holds to
 * `addresses.generated.ts`), and what its proof path calls — Hyperlane's Mailbox and the SPL Noop
 * program it logs through, the Interchain Gas Paymaster and eco-routes' proof_helper that pays it.
 * The ids are the ones the programs check by address: hyper-prover/src/hyperlane.rs, proof-helper's
 * igp.rs (`--features mainnet`).
 */
const PROGRAMS = {
  portal: "EcoowmRRrMyYtQCuh5fCvMDWcD6B9ZDZkpgedf2bWKXi",
  hyper_prover: "EcoHjwFYKtiHp5ZuFQBc87GDikm9Lc5EYapKywjNAQQF",
  polymer_prover: "EcoPSkJe6BYMwkuYmpsEbhHX3ikDbnG2BdwavGquSwRV",
  proof_helper: "EcoouNeez8PvCP9NJTywGdjYFAXnZ6pkMapZwymxg2GC",
  hyperlane_mailbox: "E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi",
  hyperlane_igp: "BhNcatUDC2D5JTyeaqrdSukiVFsEHK7e3hVmKMztwefv",
  spl_noop: "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
};

/** The accounts a proof reads or writes: the Mailbox's outbox (and inbox), the IGP's program data
 *  and the IGP accounts eco-solver pays through (its solana.schema.ts defaults), and each prover's
 *  config. */
async function accounts() {
  const mailbox = PROGRAMS.hyperlane_mailbox;
  const igp = PROGRAMS.hyperlane_igp;

  return {
    mailbox_inbox: await pda(mailbox, [text("hyperlane"), text("-"), text("inbox")]),
    mailbox_outbox: await pda(mailbox, [text("hyperlane"), text("-"), text("outbox")]),
    igp_program_data: await pda(igp, [text("hyperlane_igp"), text("-"), text("program_data")]),
    igp_account: "JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M",
    overhead_igp: "AkeHBbE5JkwVppujCQQ6WuxsVsJtruBAjUo6fDCFp6fF",
    hyper_prover_config: await pda(PROGRAMS.hyper_prover, [text("config")]),
    polymer_prover_config: await pda(PROGRAMS.polymer_prover, [text("config")]),
  };
}

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).catch(() => undefined);
  // Never the request's own error: it names the URL, which may carry a key.
  if (response === undefined || !response.ok) fail(`the endpoint did not answer ${method}`);
  const body = await response.json();
  if (body.error !== undefined) fail(`${method}: ${body.error.message ?? "an error"}`);

  return body.result;
}

async function account(at) {
  const { value } = await rpc("getAccountInfo", [
    at,
    { encoding: "base64", commitment: "finalized" },
  ]);
  if (value === null) fail(`no account ${at}`);

  return { ...value, data: Buffer.from(value.data[0], "base64") };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function program(name, id) {
  const head = await account(id);
  if (head.owner !== LOADER || !head.executable)
    fail(`${name} ${id} is not an upgradeable program`);
  const programData = getAddressDecoder().decode(head.data.subarray(4, 36));
  const data = await account(programData);
  const slot = data.data.readBigUInt64LE(4);
  const authority =
    data.data[12] === 1 ? getAddressDecoder().decode(data.data.subarray(13, 45)) : null;
  const elf = data.data.subarray(PROGRAM_DATA_HEADER);
  if (elf.subarray(0, 4).toString("hex") !== "7f454c46")
    fail(`${name}'s ProgramData is not an ELF`);

  return {
    entry: {
      name,
      programId: id,
      programData,
      authority,
      lastDeploySlot: slot.toString(),
      size: elf.length,
      sha256: sha256(elf),
      file: `${name}.so.gz`,
    },
    elf,
  };
}

const slot = await rpc("getSlot", [{ commitment: "finalized" }]);
const programs = [];
for (const [name, id] of Object.entries(PROGRAMS)) programs.push(await program(name, id));
const dumped = [];
for (const [name, at] of Object.entries(await accounts())) {
  const read = await account(at);
  dumped.push({
    entry: {
      name,
      address: at,
      owner: read.owner,
      lamports: String(read.lamports),
      executable: read.executable,
      size: read.data.length,
      sha256: sha256(read.data),
      file: `${name}.account.bin.gz`,
    },
    data: read.data,
  });
}

if (cli.values.check) {
  if (!existsSync(MANIFEST)) fail("no manifest.json to check against: --redump first");
  const before = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const changed = (list, now) =>
    now.flatMap(({ entry }) => {
      const was = list.find((item) => item.name === entry.name);
      if (was === undefined) return [`${entry.name}: not in the manifest`];

      return was.sha256 === entry.sha256 ? [] : [`${entry.name}: ${was.sha256} -> ${entry.sha256}`];
    });
  // A program that changed is an upgrade the tests are not running; an account that changed is
  // live state (the Mailbox's counts and tree, the IGP's), which moves with every message.
  const upgraded = changed(before.programs, programs);
  const moved = changed(before.accounts, dumped);
  // The committed bytes still hash to the manifest's pins.
  const broken = [...before.programs, ...before.accounts].flatMap((item) =>
    sha256(gunzipSync(readFileSync(join(DIR, item.file)))) === item.sha256
      ? []
      : [`${item.file}: does not hash to its pin`],
  );
  const list = (items) => items.map((item) => `\n  ${item}`).join("");
  console.log(
    [
      upgraded.length === 0
        ? `every program matches mainnet at slot ${slot}`
        : `programs that differ from mainnet at slot ${slot}, an upgrade to redump:${list(upgraded)}`,
      ...(moved.length === 0
        ? []
        : [`accounts whose live state has moved since the dump (expected):${list(moved)}`]),
      ...(broken.length === 0 ? [] : [`files that do not match the manifest:${list(broken)}`]),
    ].join("\n"),
  );
  process.exit(upgraded.length === 0 && broken.length === 0 ? 0 : 1);
}

mkdirSync(DIR, { recursive: true });
for (const { entry, elf } of programs)
  writeFileSync(join(DIR, entry.file), gzipSync(elf, { level: 9 }));
for (const { entry, data } of dumped)
  writeFileSync(join(DIR, entry.file), gzipSync(data, { level: 9 }));
writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      $comment:
        "Solana mainnet's eco-routes programs and the accounts their proof path uses, dumped by " +
        "scripts/dump-eco-routes-svm.mjs for the LiteSVM suites. Test-only: nothing ships them.",
      cluster: "mainnet-beta",
      chainId: Number(SOLANA),
      slot: String(slot),
      dumpedAt: new Date().toISOString().slice(0, 10),
      programs: programs.map(({ entry }) => entry),
      accounts: dumped.map(({ entry }) => entry),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `dumped ${programs.length} programs and ${dumped.length} accounts at slot ${slot} into ${DIR}`,
);

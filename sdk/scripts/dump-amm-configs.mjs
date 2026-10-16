// Dumps the accounts a program finds a Solana pool by key through, from mainnet, into the test-only
// fixture `test/fixtures/svm-pool-keys/amm-configs.json`, which `svm/pool-keys.test.ts` holds
// `src/svm/pool-keys.ts`'s tables to:
//
//   - every AmmConfig of the four Raydium-code programs (Raydium CLMM, PancakeSwap CLMM, Byreal,
//     Stabble CLMM), the program address of `["amm_config", index]` (u16 big-endian), its fee rate a
//     u32 at 47 and its tick spacing a u16 at 51: a program finds such a pool by its fee;
//   - every fee tier of Orca's and Cropper's WhirlpoolsConfig, the program address of
//     `["fee_tier", config, index]` (u16 little-endian): a whirlpool is the address of
//     `["whirlpool", config, mintA, mintB, index]`, and a program finds it by its tick spacing,
//     which a static tier's index is and an adaptive-fee tier's (at 1024 and up) is not. A static
//     tier is 44 bytes, its tick spacing a u16 at 40; an adaptive one 256, its index a u16 at 40 and
//     its tick spacing at 42.
//
//   node scripts/dump-amm-configs.mjs --redump --rpc-config rpc.config.json
//   node scripts/dump-amm-configs.mjs --check --rpc-config rpc.config.json
//
// `--redump` reads AmmConfig indexes 0 to 199 and fee tier indexes 0 to 4095, and the static tier at
// each tick spacing past those an adaptive tier names (Orca's full-range 32896), and rewrites the
// fixture with every account there: its index, address, owner, lamports and data. `--check` reads
// the same and reports each one added, gone or changed since the fixture, writing nothing. A config
// or a tier a program adds is a key the tables may take: redump, then add its row to
// `pool-keys.ts`.
//
// The endpoint comes only from the `--rpc-config` file (chain id -> URL), under Solana's chain id
// 1399811149, as in `dump-eco-routes-svm.mjs`: no default, no fallback, nothing read from the
// environment, and no URL ever written to the fixture.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

const USAGE = "usage: node scripts/dump-amm-configs.mjs (--redump | --check) --rpc-config <path>";
const SOLANA = "1399811149";
const INDEXES = 200;
const FEE_TIERS = 4096;

function fail(message) {
  console.error(`dump-amm-configs: ${message}`);
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
const FIXTURE = join(SDK, "test", "fixtures", "svm-pool-keys", "amm-configs.json");

/** The whirlpool programs and their WhirlpoolsConfig, by the namespace a program writes. */
const WHIRLPOOLS = {
  "Orca.Whirlpool": {
    program: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
  },
  "Cropper.Whirlpool": {
    program: "H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt",
    config: "2CmCWqXhw7f3jCnvJg74t4vsm62DTUbKQPWL7NX8oCpL",
  },
};

/** The four programs, by the namespace a program writes. */
const PROGRAMS = {
  "Raydium.CLMM": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "Pancakeswap.CLMM": "HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq",
  "Byreal.CLMM": "REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2",
  "Stabble.CLMM": "6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6",
};

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

const text = (value) => new TextEncoder().encode(value);
const index16 = (index, littleEndian = false) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, index, littleEndian);
  return bytes;
};

/** The indexes 0 to `count` − 1. */
const upTo = (count) => Array.from({ length: count }, (_, index) => index);

/** Each account `program` keeps at `seedsOf(index)` for each of `indexes`, in their order. */
async function accountsAt(program, indexes, seedsOf) {
  const keys = await Promise.all(
    indexes.map(
      async (index) =>
        (
          await getProgramDerivedAddress({
            programAddress: address(program),
            seeds: seedsOf(index),
          })
        )[0],
    ),
  );
  // Every chunk of 100 read at once; the accounts kept in index order.
  const starts = Array.from({ length: Math.ceil(indexes.length / 100) }, (_, k) => k * 100);
  const reads = await Promise.all(
    starts.map((start) =>
      rpc("getMultipleAccounts", [
        keys.slice(start, start + 100),
        { encoding: "base64", commitment: "finalized" },
      ]),
    ),
  );
  const found = [];
  reads.forEach(({ value }, k) =>
    value.forEach((account, i) => {
      if (account === null || account.owner !== program) return;
      found.push({
        index: indexes[starts[k] + i],
        address: keys[starts[k] + i],
        owner: account.owner,
        lamports: String(account.lamports),
        base64Data: account.data[0],
      });
    }),
  );

  return found;
}

const read = { venues: {}, whirlpools: {} };
for (const [venue, program] of Object.entries(PROGRAMS)) {
  read.venues[venue] = {
    program,
    configs: await accountsAt(program, upTo(INDEXES), (index) => [
      text("amm_config"),
      index16(index),
    ]),
  };
}
for (const [venue, { program, config }] of Object.entries(WHIRLPOOLS)) {
  const tiersAt = (indexes) =>
    accountsAt(program, indexes, (index) => [
      text("fee_tier"),
      new Uint8Array(getAddressEncoder().encode(address(config))),
      index16(index, true),
    ]);
  const feeTiers = await tiersAt(upTo(FEE_TIERS));
  // An adaptive tier's spacing past them, where a static tier would be at that index.
  const past = feeTiers
    .map(({ base64Data }) => Buffer.from(base64Data, "base64"))
    .filter((data) => data.length !== 44)
    .map((data) => data.readUInt16LE(42))
    .filter((spacing, i, all) => spacing >= FEE_TIERS && all.indexOf(spacing) === i)
    .sort((a, b) => a - b);
  read.whirlpools[venue] = {
    program,
    config,
    feeTiers: [...feeTiers, ...(past.length === 0 ? [] : await tiersAt(past))],
  };
}

if (cli.values.redump) {
  const previous = JSON.parse(readFileSync(FIXTURE, "utf8"));
  writeFileSync(
    FIXTURE,
    `${JSON.stringify({ $comment: previous.$comment, read: new Date().toISOString(), ...read }, null, 2)}\n`,
  );
  for (const [venue, { configs }] of Object.entries(read.venues))
    console.log(`${venue}: ${configs.length} configs`);
  for (const [venue, { feeTiers }] of Object.entries(read.whirlpools))
    console.log(`${venue}: ${feeTiers.length} fee tiers`);
  console.log(`wrote ${FIXTURE}; run prettier on it, and review the diff`);
} else {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  let moved = 0;
  const compare = (what, held, read) => {
    const before = new Map((held ?? []).map((one) => [one.index, one]));
    const now = new Map(read.map((one) => [one.index, one]));
    for (const [index, one] of now) {
      const was = before.get(index);
      if (was === undefined) console.log(`${what} ${index}: added`);
      else if (was.base64Data !== one.base64Data) console.log(`${what} ${index}: changed`);
      else continue;
      moved++;
    }
    for (const index of before.keys()) {
      if (now.has(index)) continue;
      console.log(`${what} ${index}: gone`);
      moved++;
    }
  };
  for (const [venue, { configs }] of Object.entries(read.venues))
    compare(`${venue} config`, fixture.venues[venue]?.configs, configs);
  for (const [venue, { feeTiers }] of Object.entries(read.whirlpools))
    compare(`${venue} fee tier`, fixture.whirlpools?.[venue]?.feeTiers, feeTiers);
  console.log(moved === 0 ? "the fixture is mainnet's" : `${moved} accounts moved`);
  if (moved > 0) process.exit(1);
}

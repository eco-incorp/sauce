// Dumps the accounts a program finds a Solana pool by key through, from one cluster, into the
// test-only fixture `test/fixtures/svm-pool-keys/amm-configs.json` (mainnet-beta) or
// `amm-configs.<cluster>.json`, which `svm/pool-keys.test.ts` holds `src/svm/venue-table.ts`'s rows
// for that cluster to:
//
//   - every AmmConfig of each Raydium-code program the cluster has (Raydium CLMM, PancakeSwap CLMM,
//     Byreal, Stabble CLMM), the program address of `["amm_config", index]` (u16 big-endian), its fee
//     rate a u32 at 47 and its tick spacing a u16 at 51: a program finds such a pool by its fee;
//   - every fee tier of each WhirlpoolsConfig the cluster has (Orca's, Cropper's), the program address
//     of `["fee_tier", config, index]` (u16 little-endian): a whirlpool is the address of
//     `["whirlpool", config, mintA, mintB, index]`, and a program finds it by its tick spacing,
//     which a static tier's index is and an adaptive-fee tier's (at 1024 and up) is not. A static
//     tier is 44 bytes, its tick spacing a u16 at 40; an adaptive one 256, its index a u16 at 40 and
//     its tick spacing at 42.
//
//   node scripts/dump-amm-configs.mjs --redump --rpc-config rpc.config.json [--cluster devnet]
//   node scripts/dump-amm-configs.mjs --check --rpc-config rpc.config.json [--cluster devnet]
//
// `--redump` reads AmmConfig indexes 0 to 199 and fee tier indexes 0 to 4095, and the static tier at
// the full-range tick spacing, 32896, and at each spacing past those an adaptive tier names, and
// rewrites the fixture with every account there: its index, address, owner, lamports and data.
// `--check` reads the same and reports each one added, gone or changed since the fixture, writing
// nothing. A config or a tier a program adds is a key the tables may take: redump, then add its row
// to `venue-table.ts`.
//
// The programs and configs are the cluster's rows of `src/svm/venue-table.ts`, read from source. The
// endpoint comes only from the `--rpc-config` file (chain id -> URL), under the cluster's chain id
// (Solana's 1399811149, its devnet's 1399811150), as in `dump-svm-venues.mjs`: no default, no
// fallback, nothing read from the environment, and no URL ever written to the fixture.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { createTsLoader } from "./lib/load-ts.mjs";

const USAGE =
  "usage: node scripts/dump-amm-configs.mjs (--redump | --check) --rpc-config <path> " +
  "[--cluster mainnet-beta|devnet]";
const CHAIN_IDS = { "mainnet-beta": "1399811149", devnet: "1399811150" };
const INDEXES = 200;
const FEE_TIERS = 4096;
/** A whirlpool's full-range tick spacing, past the indexes read. */
const FULL_RANGE = 32896;

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
      cluster: { type: "string", default: "mainnet-beta" },
    },
  });
} catch (error) {
  fail(`${error.message}\n${USAGE}`);
}
if (cli.values.redump === cli.values.check) fail(`give one of --redump and --check\n${USAGE}`);
const CLUSTER = cli.values.cluster;
const SOLANA = CHAIN_IDS[CLUSTER];
if (SOLANA === undefined) fail(`--cluster is mainnet-beta or devnet, not ${CLUSTER}\n${USAGE}`);
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
  fail(`--rpc-config gives no URL for ${CLUSTER} (chain id ${SOLANA})`);
}

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(
  SDK,
  "test",
  "fixtures",
  "svm-pool-keys",
  CLUSTER === "mainnet-beta" ? "amm-configs.json" : `amm-configs.${CLUSTER}.json`,
);

const { SVM_VENUE_TABLE } = createTsLoader(SDK)("src/svm/venue-table.ts");
const row = (venue) => SVM_VENUE_TABLE[venue][CLUSTER];

/** The cluster's whirlpool programs and their WhirlpoolsConfig, by the namespace a program writes. */
const WHIRLPOOLS = Object.fromEntries(
  [
    ["Orca.Whirlpool", row("orca-whirlpool")],
    ["Cropper.Whirlpool", row("cropper")],
  ]
    .filter(([, at]) => at !== undefined)
    .map(([namespace, { program, config }]) => [namespace, { program, config }]),
);

/** The cluster's Raydium-code programs, by the namespace a program writes. */
const PROGRAMS = Object.fromEntries(
  [
    ["Raydium.CLMM", row("raydium-clmm")],
    ["Pancakeswap.CLMM", row("pancakeswap-clmm")],
    ["Byreal.CLMM", row("byreal")],
    ["Stabble.CLMM", row("stabble-clmm")],
  ]
    .filter(([, at]) => at !== undefined)
    .map(([namespace, { program }]) => [namespace, program]),
);

async function rpc(method, params) {
  // A public endpoint limits its rate: a 429 is waited out, up to eight times.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).catch(() => undefined);
    if (response?.status === 429 && attempt < 8) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** Math.min(attempt, 4)));
      continue;
    }
    // Never the request's own error: it names the URL, which may carry a key.
    if (response === undefined || !response.ok) fail(`the endpoint did not answer ${method}`);
    const body = await response.json();
    if (body.error !== undefined) fail(`${method}: ${body.error.message ?? "an error"}`);

    return body.result;
  }
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
  // Each chunk of 100 read in turn; the accounts kept in index order.
  const starts = Array.from({ length: Math.ceil(indexes.length / 100) }, (_, k) => k * 100);
  const reads = [];
  for (const start of starts) {
    reads.push(
      await rpc("getMultipleAccounts", [
        keys.slice(start, start + 100),
        { encoding: "base64", commitment: "finalized" },
      ]),
    );
  }
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
  // Past them: the full-range tier's spacing, 32896, and each spacing an adaptive tier names, where a
  // static tier would be at that index.
  const past = feeTiers
    .map(({ base64Data }) => Buffer.from(base64Data, "base64"))
    .filter((data) => data.length !== 44)
    .map((data) => data.readUInt16LE(42))
    .concat(FULL_RANGE)
    .filter((spacing, i, all) => spacing >= FEE_TIERS && all.indexOf(spacing) === i)
    .sort((a, b) => a - b);
  read.whirlpools[venue] = {
    program,
    config,
    feeTiers: [...feeTiers, ...(past.length === 0 ? [] : await tiersAt(past))],
  };
}

if (cli.values.redump) {
  const $comment = existsSync(FIXTURE)
    ? JSON.parse(readFileSync(FIXTURE, "utf8")).$comment
    : `As ${CLUSTER} held them when read, each account's owner, lamports and data: under venues, ` +
      "every AmmConfig of the cluster's Raydium-code programs, index 0 to 199 (the program address " +
      'of ["amm_config", index] as a big-endian u16), its trade fee rate (millionths) a u32 at 47 ' +
      "and its tick spacing a u16 at 51; under whirlpools, every fee tier of the cluster's " +
      'WhirlpoolsConfigs, index 0 to 4095 (the program address of ["fee_tier", config, index] as a ' +
      "little-endian u16), a static tier's tick spacing a u16 at 40, an adaptive-fee tier's index a " +
      "u16 at 40 and its tick spacing a u16 at 42. Written by scripts/dump-amm-configs.mjs --redump " +
      `--rpc-config <file> --cluster ${CLUSTER}; svm/pool-keys.test.ts holds svm/venue-table.ts's ` +
      `${CLUSTER} rows to it.`;
  writeFileSync(
    FIXTURE,
    `${JSON.stringify({ $comment, read: new Date().toISOString(), ...read }, null, 2)}\n`,
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
  console.log(moved === 0 ? `the fixture is ${CLUSTER}'s` : `${moved} accounts moved`);
  if (moved > 0) process.exit(1);
}

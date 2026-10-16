// Dumps every AmmConfig of the four Raydium-code programs on Solana mainnet (Raydium CLMM,
// PancakeSwap CLMM, Byreal, Stabble CLMM) into the test-only fixture
// `test/fixtures/svm-pool-keys/amm-configs.json`, which `svm/pool-keys.test.ts` holds
// `src/svm/pool-keys.ts`'s table to: a program finds a pool of these venues by its fee, and the
// config that charges it is the program address of `["amm_config", index]`, its fee rate a u32 at
// 47, its tick spacing a u16 at 51.
//
//   node scripts/dump-amm-configs.mjs --redump --rpc-config rpc.config.json
//   node scripts/dump-amm-configs.mjs --check --rpc-config rpc.config.json
//
// `--redump` reads indexes 0 to 199 of each program and rewrites the fixture with every config
// there: its index, address, owner, lamports and data. `--check` reads the same and reports each
// config added, gone or changed since the fixture, writing nothing. A config a program adds is a
// fee the table may take: redump, then add its row to `pool-keys.ts`.
//
// The endpoint comes only from the `--rpc-config` file (chain id -> URL), under Solana's chain id
// 1399811149, as in `dump-eco-routes-svm.mjs`: no default, no fallback, nothing read from the
// environment, and no URL ever written to the fixture.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { address, getProgramDerivedAddress } from "@solana/kit";

const USAGE = "usage: node scripts/dump-amm-configs.mjs (--redump | --check) --rpc-config <path>";
const SOLANA = "1399811149";
const INDEXES = 200;

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

const index16 = (index) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, index, false);
  return bytes;
};

/** Every config of `program` at indexes 0 to 199, in index order. */
async function configsOf(program) {
  const keys = await Promise.all(
    Array.from(
      { length: INDEXES },
      async (_, index) =>
        (
          await getProgramDerivedAddress({
            programAddress: address(program),
            seeds: [new TextEncoder().encode("amm_config"), index16(index)],
          })
        )[0],
    ),
  );
  // Every chunk of 100 read at once; the configs kept in index order.
  const starts = Array.from({ length: Math.ceil(INDEXES / 100) }, (_, k) => k * 100);
  const reads = await Promise.all(
    starts.map((start) =>
      rpc("getMultipleAccounts", [
        keys.slice(start, start + 100),
        { encoding: "base64", commitment: "finalized" },
      ]),
    ),
  );
  const configs = [];
  reads.forEach(({ value }, k) =>
    value.forEach((account, i) => {
      if (account === null || account.owner !== program) return;
      const index = starts[k] + i;
      configs.push({
        index,
        address: keys[index],
        owner: account.owner,
        lamports: String(account.lamports),
        base64Data: account.data[0],
      });
    }),
  );

  return configs;
}

const read = { venues: {} };
for (const [venue, program] of Object.entries(PROGRAMS)) {
  read.venues[venue] = { program, configs: await configsOf(program) };
}

if (cli.values.redump) {
  const previous = JSON.parse(readFileSync(FIXTURE, "utf8"));
  writeFileSync(
    FIXTURE,
    `${JSON.stringify({ $comment: previous.$comment, read: new Date().toISOString(), ...read }, null, 2)}\n`,
  );
  for (const [venue, { configs }] of Object.entries(read.venues))
    console.log(`${venue}: ${configs.length} configs`);
  console.log(`wrote ${FIXTURE}; run prettier on it, and review the diff`);
} else {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  let moved = 0;
  for (const [venue, { configs }] of Object.entries(read.venues)) {
    const before = new Map(fixture.venues[venue].configs.map((one) => [one.index, one]));
    const now = new Map(configs.map((one) => [one.index, one]));
    for (const [index, one] of now) {
      const was = before.get(index);
      if (was === undefined) console.log(`${venue} config ${index}: added`);
      else if (was.base64Data !== one.base64Data) console.log(`${venue} config ${index}: changed`);
      else continue;
      moved++;
    }
    for (const index of before.keys()) {
      if (now.has(index)) continue;
      console.log(`${venue} config ${index}: gone`);
      moved++;
    }
  }
  console.log(moved === 0 ? "the fixture is mainnet's" : `${moved} configs moved`);
  if (moved > 0) process.exit(1);
}

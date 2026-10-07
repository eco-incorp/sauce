// Dumps the Solana venues the distributed-swap skill trades on — each venue's program and, for the
// pools its suite trades, every account a swap reads — into the test-only fixture
// `test/fixtures/svm-venues/` that `test/svm/distributed-swap.e2e.test.ts` loads into LiteSVM.
// Nothing in the SDK ships them: the suite runs the venues exactly as mainnet does.
//
//   node scripts/dump-svm-venues.mjs --redump --rpc-config rpc.config.json
//   node scripts/dump-svm-venues.mjs --check --rpc-config rpc.config.json
//
// Build first (`pnpm --filter './sdk' build`): the accounts a pool's swap takes (its config, vaults,
// observation or oracle, and the tick arrays its walk crosses each way) come from the SDK's own venue
// decoders in `dist/`. `--redump` rewrites the fixture: each program's ELF (gzipped), each account's
// data (gzipped), and `manifest.json` — every program's id, ProgramData address, last-deploy slot and
// sha256; every account's address, owner, lamports and sha256; every pool's slot (its nine accounts,
// the tick arrays both ways); the slot and time the accounts were read at. `--check` reads the
// programs again and reports which were upgraded, writing nothing. Review a redump's diff before
// committing it: a changed program sha256 is an upgrade, and the suite then runs the new code.
//
// The endpoint comes only from the `--rpc-config` file (chain id -> URL), under Solana's chain id
// 1399811149, as in `dump-eco-routes-svm.mjs`: no default, no fallback, nothing read from the
// environment, and no URL ever written to the fixture.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { address, getAddressDecoder, getProgramDerivedAddress } from "@solana/kit";

const USAGE = "usage: node scripts/dump-svm-venues.mjs (--redump | --check) --rpc-config <path>";
const SOLANA = "1399811149";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** `UpgradeableLoaderState::ProgramData`: a u32 tag, the deploy slot, an `Option<Pubkey>`. */
const PROGRAM_DATA_HEADER = 4 + 8 + 1 + 32;
const SYSTEM = "11111111111111111111111111111111";

function fail(message) {
  console.error(`dump-svm-venues: ${message}`);
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
const RPC = (config?.rpcUrls ?? config)?.[SOLANA];
if (typeof RPC !== "string" || !/^https?:\/\//.test(RPC)) {
  fail(`--rpc-config gives no URL for Solana (chain id ${SOLANA})`);
}

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(SDK, "test", "fixtures", "svm-venues");
const MANIFEST = join(DIR, "manifest.json");
const venues = await import(join(SDK, "dist", "svm", "venues", "index.js")).catch(() =>
  fail("the SDK is not built: run `pnpm --filter './sdk' build` first"),
);

/** The venues' programs, by the slug the SDK's venue modules use. */
const PROGRAMS = {
  "raydium-clmm": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "pancakeswap-clmm": "HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq",
  byreal: "REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2",
  "stabble-clmm": "6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6",
  "orca-whirlpool": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  cropper: "H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt",
  defituna: "fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9",
  crema: "CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR",
  phoenix: "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
};

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/**
 * The pools the suite trades: each venue's deepest SOL/USDC pool when the dump was made, Byreal's
 * deepest pool with no fee beyond its rate (its SOL/USDC pool adds decay and imbalance fees, which
 * the program skips) and Stabble's USDC/USDT pool (its SOL/USDC pools are thinner), to run their
 * swaps, and a Meteora DLMM pool, a venue the program refuses. `only`: the pool account alone.
 */
const POOLS = [
  {
    name: "raydium-clmm-sol-usdc",
    venue: "raydium-clmm",
    pool: "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
  },
  {
    name: "pancakeswap-clmm-sol-usdc",
    venue: "pancakeswap-clmm",
    pool: "DJNtGuBGEQiUCWE8F981M2C3ZghZt2XLD8f2sQdZ6rsZ",
  },
  {
    name: "byreal-sol-usdc",
    venue: "byreal",
    pool: "9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq",
    only: true,
  },
  {
    name: "orca-whirlpool-sol-usdc",
    venue: "orca-whirlpool",
    pool: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
  },
  {
    name: "cropper-sol-usdc",
    venue: "cropper",
    pool: "55TucCMtiDs2k4bXcNssMRNCX7LxYPb42cauJAhpXdoQ",
  },
  {
    name: "defituna-sol-usdc",
    venue: "defituna",
    pool: "7VuKeevbvbQQcxz6N4SNLmuq6PYy4AcGQRDssoqo4t65",
  },
  { name: "crema-sol-usdc", venue: "crema", pool: "DV569UDdnjkYWJDnpJfJZE4HyzYKYyRGowtdPQrFUZpm" },
  {
    name: "phoenix-sol-usdc",
    venue: "phoenix",
    pool: "4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg",
  },
  { name: "byreal-usdc", venue: "byreal", pool: "8HPQzqMDoDcRDMh3Si75EGWh276QbcVrfHvrNFVPnW8s" },
  {
    name: "stabble-clmm-usdc-usdt",
    venue: "stabble-clmm",
    pool: "9Mw8ESnvHZFoKnEGnjvLzjWivugW7ipYvVAhBu2hSA6x",
  },
  {
    name: "meteora-dlmm-sol-usdc",
    venue: "meteora-dlmm",
    pool: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
    only: true,
  },
];

async function rpc(method, params) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).catch(() => undefined);
    // Never the request's own error: it names the URL, which may carry a key.
    if (response === undefined || !response.ok) {
      if (attempt < 4) {
        await new Promise((done) => setTimeout(done, 1000 * attempt));
        continue;
      }
      fail(`the endpoint did not answer ${method}`);
    }
    const body = await response.json();
    if (body.error !== undefined) fail(`${method}: ${body.error.message ?? "an error"}`);

    return body.result;
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Accounts read so far, by address: one cache, so every decoder and the dump see the same bytes. */
const read = new Map();
let slot = 0;
async function fetchAll(addresses) {
  const missing = [...new Set(addresses)].filter((at) => !read.has(at));
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const { context, value } = await rpc("getMultipleAccounts", [
      chunk,
      { encoding: "base64", commitment: "finalized", minContextSlot: slot },
    ]);
    slot = Math.max(slot, context.slot);
    chunk.forEach((at, j) =>
      read.set(
        at,
        value[j] === null ? null : { ...value[j], data: Buffer.from(value[j].data[0], "base64") },
      ),
    );
  }
}
const loader = async (at) => {
  await fetchAll([at]);
  const account = read.get(at);

  return account === null ? null : new Uint8Array(account.data);
};

async function program(name, id) {
  await fetchAll([id]);
  const head = read.get(id);
  if (head === null || head.owner !== LOADER || !head.executable)
    fail(`${name} ${id} is not an upgradeable program`);
  const programData = getAddressDecoder().decode(head.data.subarray(4, 36));
  const { value } = await rpc("getAccountInfo", [programData, { encoding: "base64" }]);
  const data = Buffer.from(value.data[0], "base64");
  const elf = data.subarray(PROGRAM_DATA_HEADER);
  if (elf.subarray(0, 4).toString("hex") !== "7f454c46")
    fail(`${name}'s ProgramData is not an ELF`);

  return {
    entry: {
      name,
      programId: id,
      programData,
      lastDeploySlot: data.readBigUInt64LE(4).toString(),
      size: elf.length,
      sha256: sha256(elf),
      file: `${name}.so.gz`,
    },
    elf,
  };
}

const programs = [];
for (const [name, id] of Object.entries(PROGRAMS)) programs.push(await program(name, id));

if (cli.values.check) {
  if (!existsSync(MANIFEST)) fail("no manifest.json to check against: --redump first");
  const before = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const upgraded = programs.flatMap(({ entry }) => {
    const was = before.programs.find((item) => item.name === entry.name);

    return was?.sha256 === entry.sha256 ? [] : [`${entry.name}: ${was?.sha256} -> ${entry.sha256}`];
  });
  const broken = [...before.programs, ...before.accounts].flatMap((item) =>
    sha256(gunzipSync(readFileSync(join(DIR, item.file)))) === item.sha256 ? [] : [item.file],
  );
  for (const line of upgraded) console.log(`upgraded since the dump: ${line}`);
  for (const file of broken) console.log(`does not hash to its pin: ${file}`);
  if (upgraded.length + broken.length > 0) process.exit(1);
  console.log(`dump-svm-venues: ${programs.length} programs as dumped at slot ${before.slot}`);
  process.exit(0);
}

const pda = async (programId, seeds) =>
  (await getProgramDerivedAddress({ programAddress: address(programId), seeds }))[0];

/** sha256("account:TickArrayState")[..8], and Byreal's `DynamicTickArray`'s. */
const TICK_ARRAYS = new Set(["c09b55cd31f9812a", "6a8b98247599b838"]);

/**
 * A Raydium-layout pool's swap loads every tick array it is given, so each must exist, and starts
 * at the first that holds liquidity in the walk's direction: the pool's arrays with liquidity
 * nearest its price that way, in walk order. Fewer than three that way: the rest are its nearest
 * the other way, then arrays with none, which the swap loads and never reaches.
 */
async function raydiumTickArrays(programId, pool, tick, spacing) {
  const arrays = await rpc("getProgramAccounts", [
    programId,
    {
      encoding: "base64",
      dataSlice: { offset: 0, length: 44 },
      filters: [{ memcmp: { offset: 8, bytes: pool } }],
    },
  ]);
  // Fixed tick arrays (`TickArrayState`) and Byreal's variable-length ones: the pool at 8, the
  // first tick at 40 in both.
  const starts = arrays
    .map((item) => Buffer.from(item.account.data[0], "base64"))
    .map((data, i) => ({ address: arrays[i].pubkey, data }))
    .filter(({ data }) => TICK_ARRAYS.has(data.subarray(0, 8).toString("hex")))
    .map(({ address, data }) => ({ address, start: data.readInt32LE(40) }));
  const span = 60 * spacing;
  const current = Math.floor(tick / span) * span;
  // An array that exists but holds no initialized tick is not one the swap steps through: the
  // pool's bitmap (1,024 bits at 904, bit 512 the array at 0) says which hold liquidity.
  await fetchAll([pool]);
  const bitmap = read.get(pool).data.subarray(904, 904 + 128);
  const live = ({ start }) => {
    const bit = start / span + 512;
    return bit >= 0 && bit < 1024 && (bitmap[bit >> 3] >> (bit & 7)) & 1;
  };
  const down = starts
    .filter((a) => live(a) && a.start <= current)
    .sort((a, b) => b.start - a.start);
  const up = starts.filter((a) => live(a) && a.start >= current).sort((a, b) => a.start - b.start);
  // A pool with fewer than three arrays holding liquidity: any other of its arrays fills the slot.
  const empty = starts
    .filter((a) => !live(a))
    .sort((a, b) => Math.abs(a.start - current) - Math.abs(b.start - current));
  const three = (near, far) =>
    [...new Set([...near, ...far, ...empty])].slice(0, 3).map((a) => a.address);

  return { payA: three(down, up), payB: three(up, down) };
}

/** A pool's slot, the nine accounts the program takes for it, and the tick arrays each way. */
async function slotOf({ venue, pool, only }) {
  const programId = PROGRAMS[venue] ?? (await loader(pool), read.get(pool).owner);
  if (only)
    return {
      program: programId,
      pool,
      config: SYSTEM,
      vaultA: SYSTEM,
      vaultB: SYSTEM,
      extra: SYSTEM,
      payA: [SYSTEM, SYSTEM, SYSTEM],
      payB: [SYSTEM, SYSTEM, SYSTEM],
    };
  const at = address(pool);
  switch (venue) {
    case "raydium-clmm":
    case "pancakeswap-clmm":
    case "byreal":
    case "stabble-clmm": {
      const fetchConfig = {
        "raydium-clmm": venues.fetchRaydiumClmmConfig,
        "pancakeswap-clmm": venues.fetchPancakeswapClmmConfig,
        byreal: venues.fetchByrealPoolConfig,
        "stabble-clmm": venues.fetchStabbleClmmConfig,
      }[venue];
      const cfg = await fetchConfig(loader, at);
      const { payA, payB } = await raydiumTickArrays(
        programId,
        pool,
        cfg.tickCurrentIndex,
        cfg.tickSpacing,
      );
      return {
        program: programId,
        pool,
        config: cfg.ammConfig,
        vaultA: cfg.tokenVault0,
        vaultB: cfg.tokenVault1,
        extra: cfg.observation,
        payA,
        payB,
      };
    }
    case "orca-whirlpool":
    case "cropper": {
      const fetchConfig =
        venue === "cropper" ? venues.fetchCropperConfig : venues.fetchOrcaWhirlpoolConfig;
      const cfg = await fetchConfig(loader, at);
      return {
        program: programId,
        pool,
        config: SYSTEM,
        vaultA: cfg.tokenVaultA,
        vaultB: cfg.tokenVaultB,
        extra: cfg.oracle,
        payA: cfg.windows.aToB.tickArrays,
        payB: cfg.windows.bToA.tickArrays,
      };
    }
    case "defituna": {
      const cfg = await venues.fetchDefiTunaPoolConfig(loader, at);
      return {
        program: programId,
        pool,
        config: SYSTEM,
        vaultA: cfg.tokenVaultA,
        vaultB: cfg.tokenVaultB,
        extra: SYSTEM,
        payA: cfg.windows.aToB.tickArrays,
        payB: cfg.windows.bToA.tickArrays,
      };
    }
    case "crema": {
      const cfg = await venues.fetchCremaPoolConfig(loader, at);
      return {
        program: programId,
        pool,
        config: cfg.clmmConfig,
        vaultA: cfg.tokenVaultA,
        vaultB: cfg.tokenVaultB,
        extra: cfg.tickArrayMap,
        payA: cfg.windows.aToB.tickArrays,
        payB: cfg.windows.bToA.tickArrays,
      };
    }
    case "phoenix": {
      const cfg = await venues.fetchPhoenixConfig(loader, at);
      const log = await pda(programId, [new TextEncoder().encode("log")]);
      const none = [SYSTEM, SYSTEM, SYSTEM];
      return {
        program: programId,
        pool,
        config: log,
        vaultA: cfg.baseVault,
        vaultB: cfg.quoteVault,
        extra: SYSTEM,
        payA: none,
        payB: none,
      };
    }
    default:
      return fail(`no slot for venue ${venue}`);
  }
}

const pools = [];
for (const spec of POOLS)
  pools.push({ name: spec.name, venue: spec.venue, ...(await slotOf(spec)) });
// The mints of every pool, from the pools themselves: SOL, USDC, USDT and Byreal's token.
const wanted = new Set([
  WSOL,
  USDC,
  USDT,
  getAddressDecoder().decode(
    read.get(POOLS.find((p) => p.name === "byreal-usdc").pool).data.subarray(73, 105),
  ),
]);
for (const pool of pools)
  for (const at of [
    pool.pool,
    pool.config,
    pool.vaultA,
    pool.vaultB,
    pool.extra,
    ...pool.payA,
    ...pool.payB,
  ])
    if (at !== SYSTEM && !Object.values(PROGRAMS).includes(at)) wanted.add(at);
// Read them all again at one slot at least as late as the last decoder read, so the pools, their
// vaults and their tick arrays are one consistent snapshot.
for (const at of wanted) read.delete(at);
await fetchAll([...wanted]);
const time = await rpc("getBlockTime", [slot]);

const accounts = [];
for (const at of [...wanted].sort()) {
  const account = read.get(at);
  if (account === null) continue; // an uninitialized tick array: the swap takes it as empty
  accounts.push({
    entry: {
      address: at,
      owner: account.owner,
      lamports: String(account.lamports),
      size: account.data.length,
      sha256: sha256(account.data),
      file: `accounts/${at}.bin.gz`,
    },
    data: account.data,
  });
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(join(DIR, "accounts"), { recursive: true });
for (const { entry, elf } of programs)
  writeFileSync(join(DIR, entry.file), gzipSync(elf, { level: 9 }));
for (const { entry, data } of accounts)
  writeFileSync(join(DIR, entry.file), gzipSync(data, { level: 9 }));
writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      cluster: "mainnet-beta",
      slot,
      unixTimestamp: time,
      date: new Date().toISOString().slice(0, 10),
      programs: programs.map(({ entry }) => entry),
      pools,
      accounts: accounts.map(({ entry }) => entry),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `dump-svm-venues: ${programs.length} programs, ${pools.length} pools, ${accounts.length} accounts at slot ${slot}`,
);

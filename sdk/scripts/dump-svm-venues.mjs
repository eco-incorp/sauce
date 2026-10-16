// Dumps the Solana venues the distributed-swap skill trades on — each venue's program and, for the
// pools its suites trade, every account a swap reads — into the test-only fixture the suites load
// into LiteSVM (`test/svm/venue-fixture.ts`): the programs and the manifest in
// `test/fixtures/svm-venue-programs/`, each account beside the other venue fixtures in
// `test/svm/fixtures/<venue>/` (`scripts/lib/svm-venue-fixture.mjs` has the layout). Nothing in the
// SDK ships them: the suites run the venues exactly as mainnet does.
//
//   node scripts/dump-svm-venues.mjs --redump --rpc-config rpc.config.json
//   node scripts/dump-svm-venues.mjs --add --rpc-config rpc.config.json
//   node scripts/dump-svm-venues.mjs --check --rpc-config rpc.config.json
//
// Build first (`pnpm --filter './sdk' build`): the accounts a pool's swap takes (its config, vaults,
// observation or oracle, and the tick arrays its walk crosses each way) come from the SDK's own venue
// decoders and slot reader in `dist/`, the ones the cook names its accounts by. Every read is
// `getMultipleAccounts` or `getAccountInfo`, each pinned to a slot no earlier than the last (retried
// while the endpoint's node lags it): a tick array is a program address, so nothing lists accounts. `--redump` rewrites the fixture: each program's ELF (gzipped), each account
// (refreshing a fixture file that already holds it), and `manifest.json` — every program's id,
// ProgramData address, last-deploy slot and sha256; every account's address, owner, lamports, file
// and sha256; every pool's slot (its nine accounts, the tick arrays both ways); the slot and time the
// accounts were read at. `--check` reads the programs again and reports which were upgraded, and
// re-hashes every file against its pin, writing nothing. Review a redump's diff before
// committing it: a changed program sha256 is an upgrade, and the suite then runs the new code.
// `--add` dumps only what the fixture lacks — a program, a pool, or a slot account past a held
// pool's nine (`more`) — and writes nothing it holds: every account it pins, and every file already
// on disk, stays as it is, so the suites' existing state does not move. Each pool it adds records
// the `slot` and `unixTimestamp` it was read at.
//
// The endpoint comes only from the `--rpc-config` file (chain id -> URL), under Solana's chain id
// 1399811149, as in `dump-eco-routes-svm.mjs`: no default, no fallback, nothing read from the
// environment, and no URL ever written to the fixture.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { address, getAddressCodec, getAddressDecoder, getProgramDerivedAddress } from "@solana/kit";

import {
  addToVenueFixture,
  readAccountFile,
  roots,
  sha256,
  writeVenueFixture,
} from "./lib/svm-venue-fixture.mjs";

const USAGE =
  "usage: node scripts/dump-svm-venues.mjs (--redump | --add | --check) --rpc-config <path>";
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
      add: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      "rpc-config": { type: "string" },
    },
  });
} catch (error) {
  fail(`${error.message}\n${USAGE}`);
}
if ([cli.values.redump, cli.values.add, cli.values.check].filter(Boolean).length !== 1)
  fail(`give one of --redump, --add and --check\n${USAGE}`);
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
const DIR = roots(SDK).programs;
const MANIFEST = join(DIR, "manifest.json");
const venues = await import(join(SDK, "dist", "svm", "venues", "index.js")).catch(() =>
  fail("the SDK is not built: run `pnpm --filter './sdk' build` first"),
);
const slots = await import(join(SDK, "dist", "svm", "pool-slot.js"));

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
  invariant: "HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt",
  manifest: "MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms",
  "openbook-v2": "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb",
};

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/**
 * The pools the suite trades: each venue's deepest SOL/USDC pool when the dump was made, Byreal's
 * deepest pool with no fee beyond its rate (its SOL/USDC pool adds decay and imbalance fees, which
 * the program skips) and Stabble's USDC/USDT pool (its SOL/USDC pools are thinner), to run their
 * swaps, and a Meteora DLMM pool, a venue the program refuses. `only`: the pool account alone. The
 * venues `@sauce/router` swaps at a pool's own limit besides: an Orca pool with an adaptive fee,
 * Invariant's USDC/USDT pool, Manifest's SOL/USDC market (`keep`: as `test/svm/fixtures/manifest`
 * already holds it, the snapshot the venue suite's worked examples price against) and an OpenBook v2
 * BONK/USDC market. And the SPCX_US/USDC pools the SpaceX swap finds by key, SPCX_US a Token-2022
 * mint: Raydium's at a fee of 2500, Byreal's at 1000, PancakeSwap's at 800, and Orca's at tick
 * spacing 64, on an adaptive fee tier; and Orca's SOL/USDC pool on the adaptive tier at spacing 4,
 * beside the static tier's: a pair with a pool on both.
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
  {
    name: "orca-whirlpool-adaptive",
    venue: "orca-whirlpool",
    pool: "7Vj2goVVARSH6GFzHfmMNvMsASKjTQ8dw59oN1ZNW82s",
  },
  {
    name: "invariant-usdc-usdt",
    venue: "invariant",
    pool: "5dX3tkVDmbHBWMCQMerAHTmd9wsRvmtKLoQt6qv9fHy7",
  },
  {
    name: "manifest-sol-usdc",
    venue: "manifest",
    pool: "ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ",
    keep: true,
  },
  {
    name: "openbook-v2-bonk-usdc",
    venue: "openbook-v2",
    pool: "D3gZwng2MgZGjktYcKpbR8Bz8653i4qCgzHCf5E4TcZb",
  },
  {
    name: "raydium-clmm-spcx-usdc",
    venue: "raydium-clmm",
    pool: "FjuBy7jjf9DXj9d3R7cHpvcnoFW2iQxf7F7P3vqx4Jza",
  },
  {
    name: "byreal-spcx-usdc",
    venue: "byreal",
    pool: "7mcKEBY6Y8EcCst4u55aNAP84Gn2a2VUGCV1n6AS3KoZ",
  },
  {
    name: "pancakeswap-clmm-spcx-usdc",
    venue: "pancakeswap-clmm",
    pool: "JB9r54vk2cS9RjKDJmxnMNDNVcmvLYNwkq392cwKpxRc",
  },
  {
    name: "orca-whirlpool-spcx-usdc",
    venue: "orca-whirlpool",
    pool: "FgjxPHeYsq1axH29fnGKZi6UyRWi4tMPHgu1gc3ezA9U",
  },
  {
    name: "orca-whirlpool-sol-usdc-adaptive",
    venue: "orca-whirlpool",
    pool: "4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW",
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
    // A node behind the slot a read is pinned to catches up within seconds.
    if (/minimum context slot/i.test(body.error?.message ?? "") && attempt < 20) {
      await new Promise((done) => setTimeout(done, 1500));
      continue;
    }
    if (body.error !== undefined) fail(`${method}: ${body.error.message ?? "an error"}`);

    return body.result;
  }
}

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
  const broken = [
    ...before.programs.flatMap((item) =>
      sha256(gunzipSync(readFileSync(join(DIR, item.file)))) === item.sha256 ? [] : [item.file],
    ),
    ...before.accounts.flatMap((item) =>
      sha256(readAccountFile(SDK, item.file)) === item.sha256 ? [] : [item.file],
    ),
  ];
  for (const line of upgraded) console.log(`upgraded since the dump: ${line}`);
  for (const file of broken) console.log(`does not hash to its pin: ${file}`);
  if (upgraded.length + broken.length > 0) process.exit(1);
  console.log(`dump-svm-venues: ${programs.length} programs as dumped at slot ${before.slot}`);
  process.exit(0);
}

const pda = async (programId, seeds) =>
  (await getProgramDerivedAddress({ programAddress: address(programId), seeds }))[0];

const RAYDIUM_CODE = ["raydium-clmm", "pancakeswap-clmm", "byreal", "stabble-clmm"];

/**
 * The SDK's decoders read a pool for an off-chain quote, and refuse one they cannot quote: a
 * Token-2022 mint, a dynamic or one-sided fee (Raydium's code), an adaptive fee tier (a
 * whirlpool's). The accounts a swap takes depend on none of these, so a pool of these venues is
 * read through a loader that shows the decoder its pool without them, and its mints as unread
 * (which the decoder takes as SPL Token's). Its mints, as the pool names them, are dumped with it.
 */
async function quotable(venue, pool) {
  await fetchAll([pool]);
  const data = read.get(pool)?.data;
  if (data === undefined || data === null) return { load: loader, mints: [] };
  const raydium = RAYDIUM_CODE.includes(venue);
  const [atA, atB] = raydium ? [73, 105] : [101, 181];
  const mints = [atA, atB].map((at) => getAddressDecoder().decode(data.subarray(at, at + 32)));
  const shown = new Uint8Array(data);
  if (raydium) {
    shown[390] = 0; // fee_on: on the input
    shown.fill(0, 1096, 1096 + 80); // dynamic_fee_info: none
  } else {
    shown.set(shown.subarray(41, 43), 43); // fee_tier_index := tick_spacing
  }
  const load = async (account) =>
    account === pool ? shown : mints.includes(account) ? null : loader(account);

  return { load, mints };
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
      const { load, mints } = await quotable(venue, pool);
      const cfg = await fetchConfig(load, at);
      // The tick arrays each way, as the cook names them: the pool's bitmap read for the arrays
      // holding liquidity nearest its price, each array the program address of its start.
      const clmm = slots.SVM_PRICE_LIMIT_VENUES.find((one) => one.program === programId);
      const ticks = async (paysA) =>
        (await slots.svmClmmSlot(clmm, at, read.get(pool).data, paysA, loader)).ticks;
      const [payA, payB] = [await ticks(true), await ticks(false)];
      return {
        program: programId,
        pool,
        config: cfg.ammConfig,
        vaultA: cfg.tokenVault0,
        vaultB: cfg.tokenVault1,
        extra: cfg.observation,
        payA,
        payB,
        ...(await moreOf({ venue, pool })),
        mints,
      };
    }
    case "orca-whirlpool":
    case "cropper": {
      const fetchConfig =
        venue === "cropper" ? venues.fetchCropperConfig : venues.fetchOrcaWhirlpoolConfig;
      const { load, mints } = await quotable(venue, pool);
      const cfg = await fetchConfig(load, at);
      return {
        program: programId,
        pool,
        config: SYSTEM,
        vaultA: cfg.tokenVaultA,
        vaultB: cfg.tokenVaultB,
        extra: cfg.oracle,
        payA: cfg.windows.aToB.tickArrays,
        payB: cfg.windows.bToA.tickArrays,
        mints,
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
    case "invariant": {
      // `config` the program's state, the pool's reserves, `extra` its tickmap, the tick accounts
      // the swap may cross each way (X is the lower-key mint) and, tenth, the program's authority.
      const cfg = await venues.fetchInvariantPoolConfig(loader, at);
      const state = await pda(programId, [new TextEncoder().encode("statev1")]);
      const ticks = (window) =>
        [...window.boundaries.map((b) => b.address), SYSTEM, SYSTEM, SYSTEM].slice(0, 3);
      const key = (at) => Buffer.from(getAddressCodec().encode(at));
      const xLower = Buffer.compare(key(cfg.tokenXMint), key(cfg.tokenYMint)) < 0;
      return {
        program: programId,
        pool,
        config: state,
        vaultA: cfg.tokenXReserve,
        vaultB: cfg.tokenYReserve,
        extra: cfg.tickmap,
        payA: ticks(xLower ? cfg.windows.xToY : cfg.windows.yToX),
        payB: ticks(xLower ? cfg.windows.yToX : cfg.windows.xToY),
        ...(await moreOf({ venue, pool })),
        mints: [cfg.tokenXMint, cfg.tokenYMint],
      };
    }
    case "manifest": {
      const cfg = await venues.fetchManifestConfig(loader, at);
      const none = [SYSTEM, SYSTEM, SYSTEM];
      return {
        program: programId,
        pool,
        config: SYSTEM, // the System program, which the swap takes
        vaultA: cfg.baseVault,
        vaultB: cfg.quoteVault,
        extra: SYSTEM,
        payA: none,
        payB: none,
        mints: [cfg.baseMint, cfg.quoteMint],
      };
    }
    case "openbook-v2": {
      // `config` the market's authority, its vaults, `extra` its event heap, then its bids, asks
      // and the System program either way, and its two oracles (the program for one it lacks).
      const cfg = await venues.fetchOpenBookV2Config(loader, at);
      const book = [cfg.bidsAccount, cfg.asksAccount, SYSTEM];
      return {
        program: programId,
        pool,
        config: cfg.marketAuthority,
        vaultA: cfg.marketBaseVault,
        vaultB: cfg.marketQuoteVault,
        extra: cfg.eventHeap,
        payA: book,
        payB: book,
        more: [cfg.oracleA ?? programId, cfg.oracleB ?? programId],
        mints: [cfg.baseMint, cfg.quoteMint],
      };
    }
    default:
      return fail(`no slot for venue ${venue}`);
  }
}

/** sha256("account:TickArrayBitmapExtension")[..8]. */
const BITMAP_EXTENSION = "3c9624db61808b99";
/**
 * A slot's accounts past its nine, where the venue takes more: a Raydium-layout pool's tick-array
 * bitmap extension, when it has one; Invariant's program authority.
 */
async function moreOf({ venue, pool }) {
  const programId = PROGRAMS[venue];
  if (RAYDIUM_CODE.includes(venue)) {
    const extension = await pda(programId, [
      new TextEncoder().encode("pool_tick_array_bitmap_extension"),
      getAddressCodec().encode(address(pool)),
    ]);
    const data = await loader(extension);
    return data !== null && Buffer.from(data.subarray(0, 8)).toString("hex") === BITMAP_EXTENSION
      ? { more: [extension] }
      : {};
  }
  if (venue === "invariant")
    return { more: [await pda(programId, [new TextEncoder().encode("Invariant")])] };
  return {};
}

/** Every account a pool's slot names, and the mints it trades where its slot names none. */
const slotAccounts = (pool) => [
  pool.pool,
  pool.config,
  pool.vaultA,
  pool.vaultB,
  pool.extra,
  ...pool.payA,
  ...pool.payB,
  ...(pool.more ?? []),
  ...(pool.mints ?? []),
];
/** A pool as the manifest records it: its slot, without the mints read for the dump. */
const recorded = ({ mints: _mints, ...pool }) => pool;

if (cli.values.add) {
  if (!existsSync(MANIFEST)) fail("no manifest.json to add to: --redump first");
  const before = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const held = new Set(before.accounts.map((item) => item.address));
  const newPrograms = programs.filter(
    ({ entry }) => !before.programs.some((item) => item.name === entry.name),
  );
  const added = [];
  const extended = [];
  for (const spec of POOLS) {
    const was = before.pools.find((item) => item.name === spec.name);
    if (was === undefined) {
      added.push({ spec, pool: { name: spec.name, venue: spec.venue, ...(await slotOf(spec)) } });
    } else if (was.more === undefined && !spec.only) {
      const { more } = await moreOf(spec);
      if (more !== undefined) extended.push({ name: spec.name, venue: spec.venue, more });
    }
  }
  // Each account the fixture lacks, in the directory of the first pool naming it; every file
  // already on disk is kept as it is.
  const venueOfNew = new Map();
  const claimNew = (at, venue) => {
    if (at === SYSTEM || Object.values(PROGRAMS).includes(at) || held.has(at)) return;
    if (!venueOfNew.has(at)) venueOfNew.set(at, venue);
  };
  for (const { pool } of added) for (const at of slotAccounts(pool)) claimNew(at, pool.venue);
  for (const { venue, more } of extended) for (const at of more) claimNew(at, venue);
  const fresh = [...venueOfNew.keys()];
  for (const at of fresh) read.delete(at);
  await fetchAll(fresh);
  const time = await rpc("getBlockTime", [slot]);
  const accounts = fresh.flatMap((at) => {
    const account = read.get(at);
    return account === null
      ? []
      : [
          {
            address: at,
            owner: account.owner,
            lamports: account.lamports,
            data: account.data,
            venue: venueOfNew.get(at),
            keep: true,
          },
        ];
  });
  addToVenueFixture(SDK, {
    before,
    programs: newPrograms,
    // A pool kept as earlier fixtures hold it was not read now.
    pools: added.map(({ spec, pool }) =>
      spec.keep ? recorded(pool) : { ...recorded(pool), slot, unixTimestamp: time },
    ),
    extended: extended.map(({ name, more }) => ({ name, more, moreSlot: slot })),
    accounts,
  });
  console.log(
    `dump-svm-venues: added ${newPrograms.length} programs, ${added.length} pools, ` +
      `${extended.length} pools' further accounts, ${accounts.length} accounts at slot ${slot}`,
  );
  process.exit(0);
}

const pools = [];
for (const spec of POOLS)
  pools.push({ name: spec.name, venue: spec.venue, ...(await slotOf(spec)) });
// Each account in the directory of the first pool naming it; a pool the suites only refuse is kept
// as an earlier fixture of it has it. The mints, from the pools themselves: SOL and USDC with
// Raydium's, USDT with Stabble's, Byreal's token with its pool.
const venueOf = new Map();
const kept = new Set();
const claim = (at, venue) => {
  if (at !== SYSTEM && !Object.values(PROGRAMS).includes(at) && !venueOf.has(at))
    venueOf.set(at, venue);
};
claim(WSOL, "raydium-clmm");
claim(USDC, "raydium-clmm");
claim(USDT, "stabble-clmm");
claim(
  getAddressDecoder().decode(
    read.get(POOLS.find((p) => p.name === "byreal-usdc").pool).data.subarray(73, 105),
  ),
  "byreal",
);
for (const [index, pool] of pools.entries()) {
  if (POOLS[index].only) kept.add(pool.pool);
  for (const at of slotAccounts(pool)) {
    claim(at, pool.venue);
    if (POOLS[index].keep) kept.add(at);
  }
}
const wanted = new Set(venueOf.keys());
// Read them all again at one slot at least as late as the last decoder read, so the pools, their
// vaults and their tick arrays are one consistent snapshot.
for (const at of wanted) read.delete(at);
await fetchAll([...wanted]);
const time = await rpc("getBlockTime", [slot]);

const accounts = [];
for (const at of wanted) {
  const account = read.get(at);
  if (account === null) continue; // an uninitialized tick array: the swap takes it as empty
  accounts.push({
    address: at,
    owner: account.owner,
    lamports: account.lamports,
    data: account.data,
    venue: venueOf.get(at),
    keep: kept.has(at),
  });
}

writeVenueFixture(SDK, {
  programs,
  pools: pools.map(recorded),
  accounts,
  slot,
  unixTimestamp: time,
  date: new Date().toISOString().slice(0, 10),
});
console.log(
  `dump-svm-venues: ${programs.length} programs, ${pools.length} pools, ${accounts.length} accounts at slot ${slot}`,
);

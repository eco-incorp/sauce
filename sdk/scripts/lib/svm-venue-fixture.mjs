// The layout of the distributed-swap suites' Solana venue fixture, written by
// `scripts/dump-svm-venues.mjs`:
//
//   test/fixtures/svm-venue-programs/<venue>.so.gz      each venue's program, gzipped
//   test/fixtures/svm-venue-programs/manifest.json      programs, pools and their slots, accounts
//   test/svm/fixtures/<venue>/<file>.json               each account, beside the other venue fixtures
//
// An account is `{ address, owner, lamports, base64Data }`, the other fixtures' shape with the
// lamports a swap moves (a WSOL vault's are its balance). It goes in the directory of the first pool
// that names it, under the name a file there already holding that address has (an earlier fixture
// of the same account is refreshed, never duplicated), else `<address>.json`; one past
// `GZIP_OVER` bytes is gzipped (`.json.gz`). An account marked `keep` that a file already holds is
// left as that file has it: a pool the suites only refuse, whose other fixtures need it unchanged.
// The manifest pins each file by the sha256 of the data.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/** An account whose data is past this many bytes is written gzipped. */
export const GZIP_OVER = 256 * 1024;

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The fixture's two roots under `sdk/`. */
export const roots = (sdk) => ({
  programs: join(sdk, "test", "fixtures", "svm-venue-programs"),
  accounts: join(sdk, "test", "svm", "fixtures"),
});

/** The file in `dir` already holding `address`, if one does. */
function existing(dir, address) {
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      if (JSON.parse(readFileSync(join(dir, name), "utf8")).address === address) return name;
    } catch {
      // not an account fixture
    }
  }

  return undefined;
}

/**
 * Writes the fixture: `programs` [{ entry, elf }], `pools` (their slots), `accounts`
 * [{ address, owner, lamports, data, venue }], read at `slot` and `unixTimestamp`. Replaces the
 * programs' directory whole; leaves every other file of the venues' directories as it is.
 */
export function writeVenueFixture(sdk, { programs, pools, accounts, slot, unixTimestamp, date }) {
  const { programs: programDir } = roots(sdk);
  rmSync(programDir, { recursive: true, force: true });
  mkdirSync(programDir, { recursive: true });
  for (const { entry, elf } of programs)
    writeFileSync(join(programDir, entry.file), gzipSync(elf, { level: 9 }));
  const entries = writeAccounts(sdk, accounts);
  writeFileSync(
    join(programDir, "manifest.json"),
    `${JSON.stringify(
      {
        $comment:
          "The Solana venues the distributed-swap suites run, as mainnet held them, dumped by " +
          "scripts/dump-svm-venues.mjs: each program here, each account under test/svm/fixtures " +
          "(`file`, relative to it), every account read at `slot`. Test-only: nothing ships them.",
        cluster: "mainnet-beta",
        slot,
        unixTimestamp,
        date,
        programs: programs.map(({ entry }) => entry),
        pools,
        accounts: entries,
      },
      null,
      2,
    )}\n`,
  );

  return entries;
}

/**
 * Writes each account where `writeVenueFixture` says, and returns its manifest entries. An account
 * marked `keep` that a file already holds is left as that file has it.
 */
function writeAccounts(sdk, accounts) {
  const accountRoot = roots(sdk).accounts;
  const entries = [];
  for (const account of [...accounts].sort((a, b) => (a.address < b.address ? -1 : 1))) {
    const dir = join(accountRoot, account.venue);
    mkdirSync(dir, { recursive: true });
    const big = account.data.length > GZIP_OVER;
    // A file kept as it is may hold the account at a size it had then.
    const held = big && !account.keep ? undefined : existing(dir, account.address);
    if (account.keep && held !== undefined) {
      const data = readAccountFile(sdk, `${account.venue}/${held}`);
      entries.push({
        address: account.address,
        owner: account.owner,
        size: data.length,
        sha256: sha256(data),
        file: `${account.venue}/${held}`,
      });
      continue;
    }
    const name = held ?? `${account.address}.json${big ? ".gz" : ""}`;
    const json = `${JSON.stringify({
      address: account.address,
      owner: account.owner,
      lamports: String(account.lamports),
      base64Data: Buffer.from(account.data).toString("base64"),
    })}\n`;
    writeFileSync(join(dir, name), big ? gzipSync(json, { level: 9 }) : json);
    entries.push({
      address: account.address,
      owner: account.owner,
      lamports: String(account.lamports),
      size: account.data.length,
      sha256: sha256(account.data),
      file: `${account.venue}/${name}`,
    });
  }
  return entries.sort((a, b) => (a.address < b.address ? -1 : 1));
}

/** An account file's data, read back as written. */
export function readAccountFile(sdk, file) {
  const raw = readFileSync(join(roots(sdk).accounts, file));
  const json = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));

  return Buffer.from(json.base64Data, "base64");
}

/**
 * Adds to the fixture without moving anything it holds (`dump-svm-venues --add`): each new program,
 * each new account (a file already on disk is kept as it is), each new pool, and the accounts past
 * its nine (`more`) that a held pool gains. A pool it holds already, and an account not marked
 * `keep`, are replaced (`--refresh`).
 */
export function addToVenueFixture(sdk, { before, programs, pools, extended, accounts }) {
  const { programs: programDir } = roots(sdk);
  for (const { entry, elf } of programs)
    writeFileSync(join(programDir, entry.file), gzipSync(elf, { level: 9 }));
  const entries = writeAccounts(sdk, accounts);
  const more = new Map(extended.map((item) => [item.name, item]));
  const replaced = new Map(pools.map((pool) => [pool.name, pool]));
  const written = new Set(entries.map((entry) => entry.address));
  const manifest = {
    ...before,
    programs: [...before.programs, ...programs.map(({ entry }) => entry)],
    pools: [
      ...before.pools.map((pool) => {
        const again = replaced.get(pool.name);
        if (again !== undefined) return again;
        const gained = more.get(pool.name);
        return gained === undefined
          ? pool
          : { ...pool, more: gained.more, moreSlot: gained.moreSlot };
      }),
      ...pools.filter((pool) => !before.pools.some((held) => held.name === pool.name)),
    ],
    accounts: [...before.accounts.filter((held) => !written.has(held.address)), ...entries].sort(
      (a, b) => (a.address < b.address ? -1 : 1),
    ),
  };
  writeFileSync(join(programDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return entries;
}

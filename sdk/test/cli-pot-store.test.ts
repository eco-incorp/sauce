/**
 * The Pot store (`cli/pot-store.ts`): a Pot's record written once, owner-only, and never changed —
 * a second record of the same Pot kept as the first, a different Pot under its name refused, a
 * file it cannot read named rather than dropped. The concurrency check runs real writers in
 * processes of their own (`fixtures/cli/pot-store-writer.mjs`), started together, against one store.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { POT_SCHEMA, PotStore, type PotRecord } from "../src/cli/pot-store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WRITER = join(HERE, "fixtures/cli/pot-store-writer.mjs");

const RECORD: PotRecord = {
  schema: POT_SCHEMA,
  chain: "base",
  chainId: 8453,
  pot: "0x5a0Ce0000000000000000000000000000000Beef",
  owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  salt: `0x${"00".repeat(32)}`,
  kind: "private",
  kitchen: "0x19845b22989150E6B09dE55a661295Dd9188506b",
  potInitCodeHash: `0x${"ab".repeat(32)}`,
  engine: "0xcF7A92abCC7Ede43277AcCBAfda910b8829bF9AD",
  release: { compiler: "2.5.0", "v12-evm": "1.2.0", "kitchen-evm": "1.2.0" },
  sdk: "0.0.0",
  origin: "deployed",
  deployment: {
    tx: `0x${"cd".repeat(32)}`,
    block: "12",
    from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  },
  recordedAt: "2026-10-15T00:00:00.000Z",
};

const SOLANA: PotRecord = {
  schema: POT_SCHEMA,
  chain: "solana",
  chainId: 1399811149,
  pot: "9Ld1i6AbbbuN8zrJKKJmazEJBmZ9TWTQVQyVHVxmzEmq",
  owner: "BeefBeefBeefBeefBeefBeefBeefBeefBeefBeefBeef",
  salt: `0x${"00".repeat(32)}`,
  kind: "private",
  kitchen: "SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot",
  sdk: "0.0.0",
  origin: "imported",
  recordedAt: "2026-10-15T00:00:01.000Z",
};

/** Runs two writers of `record` at once against `dir`, returning what each printed. */
async function together(dir: string, record: PotRecord): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `record-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(record));
  const go = join(dir, `go-${Math.random().toString(36).slice(2)}`);
  const store = join(dir, "store");
  const children = [0, 1].map((index) => {
    const child = spawn(process.execPath, [WRITER, store, go, file], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));

    return new Promise<string>((resolve, reject) =>
      child.on("exit", (code) =>
        code === 0 ? resolve(out) : reject(new Error(`writer ${index} exited ${code}: ${err}`)),
      ),
    );
  });
  // Every writer is waiting on `go`; this releases them at once.
  await new Promise((resolve) => setTimeout(resolve, 300));
  writeFileSync(go, "");

  return Promise.all(children);
}

describe("the Pot store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-pots-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps a Pot once, under its chain and address, owner-only, and reads it back exactly", () => {
    const store = new PotStore(join(dir, "pots"));
    expect(store.save(RECORD)).toBe("created");
    const path = join(dir, "pots", "8453", `${RECORD.pot.toLowerCase()}.json`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(RECORD);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "pots")).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "pots", "8453")).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(store.recordsOf(8453, RECORD.pot)).toEqual([RECORD]);
    expect(store.recordsOf(8453, RECORD.pot.toLowerCase())).toEqual([RECORD]);
    expect(store.recordsOf(1, RECORD.pot)).toEqual([]);
  });

  it("keeps the first record of a Pot: its import after its deployment changes nothing", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    const path = join(dir, "8453", `${RECORD.pot.toLowerCase()}.json`);
    const before = readFileSync(path, "utf8");
    const imported: PotRecord = {
      ...RECORD,
      pot: RECORD.pot.toLowerCase(),
      origin: "imported",
      recordedAt: "2026-10-16T00:00:00.000Z",
    };
    delete (imported as { deployment?: unknown }).deployment;
    expect(store.save(imported)).toBe("exists");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("keeps another deployment of the same Pot beside the first, once, and the first as it was", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    const path = join(dir, "8453", `${RECORD.pot.toLowerCase()}.json`);
    const before = readFileSync(path, "utf8");
    const again: PotRecord = {
      ...RECORD,
      deployment: { ...RECORD.deployment!, tx: `0x${"ef".repeat(32)}`, block: "99" },
      recordedAt: "2026-10-16T00:00:00.000Z",
    };
    expect(store.save(again)).toBe("beside");
    expect(store.save(again)).toBe("exists");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(
      JSON.parse(
        readFileSync(
          join(dir, "8453", `${RECORD.pot.toLowerCase()}@0x${"ef".repeat(32)}.json`),
          "utf8",
        ),
      ),
    ).toEqual(again);
    expect(store.recordsOf(8453, RECORD.pot)).toEqual([RECORD, again]);
    expect(store.list().pots).toEqual([RECORD, again]);
  });

  it("files a Solana cluster other than mainnet's apart, so a devnet Pot is never mainnet's", () => {
    const store = new PotStore(dir);
    const devnet: PotRecord = { ...SOLANA, cluster: "devnet" };
    const mainnet: PotRecord = { ...SOLANA, cluster: "mainnet-beta" };
    expect(store.save(devnet)).toBe("created");
    expect(store.save(mainnet)).toBe("created");
    expect(readFileSync(join(dir, "1399811149-devnet", `${SOLANA.pot}.json`), "utf8")).toContain(
      '"cluster": "devnet"',
    );
    expect(readFileSync(join(dir, "1399811149", `${SOLANA.pot}.json`), "utf8")).toContain(
      '"cluster": "mainnet-beta"',
    );
    expect(store.recordsOf(1399811149, SOLANA.pot, "devnet")).toEqual([devnet]);
    // Testnet's beside devnet's, apart from both.
    const testnet: PotRecord = { ...SOLANA, cluster: "testnet" };
    expect(store.save(testnet)).toBe("created");
    expect(readFileSync(join(dir, "1399811149-testnet", `${SOLANA.pot}.json`), "utf8")).toContain(
      '"cluster": "testnet"',
    );
    expect(store.recordsOf(1399811149, SOLANA.pot, "testnet")).toEqual([testnet]);
    expect(() => store.save({ ...SOLANA, cluster: "../up" })).toThrow(/is not a cluster/);
  });

  it("refuses a different Pot under the same address, and leaves the file as it was", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    const path = join(dir, "8453", `${RECORD.pot.toLowerCase()}.json`);
    const before = readFileSync(path, "utf8");
    expect(() => store.save({ ...RECORD, owner: SOLANA.owner })).toThrow(
      /holds a different Pot under the same address/,
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses what is not a record or not a Pot address", () => {
    const store = new PotStore(dir);
    expect(() => store.save({ ...RECORD, schema: "sauce.pot/0" as typeof POT_SCHEMA })).toThrow(
      /schema "sauce\.pot\/0" is not sauce\.pot\/1/,
    );
    expect(() => store.save({ ...RECORD, pot: "../../escape" })).toThrow(/is not a Pot address/);
    expect(() => store.save({ ...RECORD, chainId: 0 })).toThrow(/is not a chain id/);
  });

  it("lists every chain's Pots, oldest first, and warns of a file it cannot read", () => {
    const store = new PotStore(dir);
    expect(store.list()).toEqual({ pots: [], warnings: [] });
    store.save(SOLANA);
    store.save(RECORD);
    writeFileSync(join(dir, "8453", `0x${"11".repeat(20)}.json`), '{"schema":"sauce.pot/1","ch');
    // A record with a field missing, which a sort or a filter would trip on: left out, said.
    const { recordedAt: _recordedAt, owner: _owner, ...partial } = RECORD;
    writeFileSync(join(dir, "8453", `0x${"22".repeat(20)}.json`), JSON.stringify(partial));
    const listing = store.list();
    expect(listing.pots).toEqual([RECORD, SOLANA]);
    expect(listing.warnings.sort()).toEqual([
      expect.stringMatching(/0x(11){20}\.json is not JSON; that Pot is left out/),
      expect.stringMatching(
        /0x(22){20}\.json is not a Pot record: it has no owner, recordedAt; that Pot is left out/,
      ),
    ]);
  });

  it("leaves out a record whose release is no object of strings, said, as it does one with a field missing", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    // Hand-edited: a release that is null, a string, a list, an object without the compiler, or one
    // holding a number is no `release`, and what reads it would trip on it.
    const bad: unknown[] = [
      null,
      "2.5.0",
      ["2.5.0"],
      { "v12-evm": "1.2.0" },
      { compiler: "2.5.0", "v12-evm": 1 },
    ];
    bad.forEach((release, index) => {
      const name = `0x${String(index + 1).repeat(40)}.json`;
      writeFileSync(join(dir, "8453", name), JSON.stringify({ ...RECORD, release }));
    });
    // A record that names no release is a record (SDK 1.1.0 wrote some), and so is one that names one.
    const { release: _release, ...bare } = RECORD;
    writeFileSync(join(dir, "8453", `0x${"a".repeat(40)}.json`), JSON.stringify(bare));

    const listing = store.list();
    expect(listing.pots).toHaveLength(2);
    expect(listing.warnings).toHaveLength(5);
    for (const warning of listing.warnings) {
      expect(warning).toMatch(
        /\.json is not a Pot record: its release is not an object of strings that names its compiler; that Pot is left out$/,
      );
    }
  });

  it("leaves out a record whose cluster is no string, said, and keeps one that names a cluster or none", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    store.save({ ...SOLANA, cluster: "devnet" });
    // Hand-edited: `{"toString": null}` is JSON, and what puts a cluster in a name or a note trips on it.
    const bad: unknown[] = [null, 5, ["devnet"], { toString: null }];
    bad.forEach((cluster, index) => {
      const name = `0x${String(index + 1).repeat(40)}.json`;
      writeFileSync(join(dir, "8453", name), JSON.stringify({ ...RECORD, cluster }));
    });

    const listing = store.list();
    expect(listing.pots).toHaveLength(2);
    expect(listing.warnings).toHaveLength(4);
    for (const warning of listing.warnings) {
      expect(warning).toMatch(
        /\.json is not a Pot record: its cluster is not a string; that Pot is left out$/,
      );
    }
  });

  it("says the name of a file it leaves out on one line, quoted where it holds a line break", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    const named = (tag: string): string => join(dir, "8453", `0x${tag}\nINJECTED_NAME.json`);
    writeFileSync(named("01"), "not json {\nINJECTED_CONTENT");
    writeFileSync(named("02"), JSON.stringify({ schema: "sauce.pot/0" }));
    const { owner: _owner, ...partial } = RECORD;
    writeFileSync(named("03"), JSON.stringify(partial));
    writeFileSync(named("04"), JSON.stringify({ ...RECORD, deployment: null }));

    for (const { warnings } of [store.list(), store.listFiles()]) {
      expect(warnings).toHaveLength(4);
      for (const warning of warnings) expect(warning).not.toMatch(/[\r\n\u2028\u2029]/);
      for (const tag of ["01", "02", "03", "04"]) {
        expect(
          warnings.filter((warning) => warning.includes(JSON.stringify(named(tag)))),
        ).toHaveLength(1);
      }
    }
    // An ordinary path is said as it is.
    const plain = join(dir, "8453", `0x${"7".repeat(40)}.json`);
    writeFileSync(plain, "not json");
    expect(store.list().warnings.some((warning) => warning.includes(`${plain} is not JSON;`))).toBe(
      true,
    );
  });

  it("says a record's malformed schema on one line, quoted and cut, and lists the rest", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    // A schema is whatever the file says: long, with a line separator and a line break in it, which
    // JSON.stringify leaves raw and escapes.
    const schema = `${"x".repeat(10)}\u2028\n${"y".repeat(200)}`;
    writeFileSync(
      join(dir, "8453", `0x${"9".repeat(40)}.json`),
      JSON.stringify({ ...RECORD, schema }),
    );

    const said = `"${"x".repeat(10)}?\\n${"y".repeat(68)}"`;
    for (const { warnings } of [store.list(), store.listFiles()]) {
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toMatch(/[\r\n\u2028\u2029]/);
      expect(warnings[0]).toContain(`: schema ${said} is not sauce.pot/1; that Pot is left out`);
    }
    expect(store.list().pots).toEqual([RECORD]);
  });

  it("tells a record from the file it is read from: bound only to its chain's directory and its Pot's name", () => {
    const store = new PotStore(dir);
    store.save(RECORD);
    const first = join(dir, "8453", `${RECORD.pot.toLowerCase()}.json`);
    // Another deployment of the Pot, kept beside the first by its transaction.
    const again: PotRecord = {
      ...RECORD,
      deployment: { ...RECORD.deployment!, tx: `0x${"ef".repeat(32)}`, block: "99" },
      recordedAt: "2026-10-16T00:00:00.000Z",
    };
    store.save(again);
    const beside = join(dir, "8453", `${RECORD.pot.toLowerCase()}@0x${"ef".repeat(32)}.json`);
    expect(store.filesOf(8453, RECORD.pot)).toEqual({
      files: [
        { record: RECORD, path: first, bound: true },
        { record: again, path: beside, bound: true },
      ],
      warnings: [],
    });
    expect(store.filesOf(1, RECORD.pot)).toEqual({ files: [], warnings: [] });

    // A record under another Pot's name, and one under another chain's directory: not bound.
    const elsewhere = "0x00000000000000000000000000000000000ba5e0";
    writeFileSync(join(dir, "8453", `${elsewhere}.json`), JSON.stringify(RECORD));
    mkdirSync(join(dir, "1"), { recursive: true });
    writeFileSync(join(dir, "1", `${RECORD.pot.toLowerCase()}.json`), JSON.stringify(RECORD));
    // And a file beside the first, named for a transaction its record does not have.
    const wrongTx = join(dir, "8453", `${RECORD.pot.toLowerCase()}@0x${"aa".repeat(32)}.json`);
    writeFileSync(wrongTx, JSON.stringify({ ...again, recordedAt: "2026-10-17T00:00:00.000Z" }));
    const movedName = store.filesOf(8453, elsewhere);
    expect(movedName.files).toEqual([
      { record: RECORD, path: join(dir, "8453", `${elsewhere}.json`), bound: false },
    ]);
    expect(store.filesOf(1, RECORD.pot).files).toEqual([
      { record: RECORD, path: join(dir, "1", `${RECORD.pot.toLowerCase()}.json`), bound: false },
    ]);
    expect(store.filesOf(8453, RECORD.pot).files.map((one) => [one.path, one.bound])).toEqual([
      [first, true],
      [beside, true],
      [wrongTx, false],
    ]);

    // A file it cannot read is a warning, not a throw, and the rest are read.
    const unreadable = join(dir, "8453", `${RECORD.pot.toLowerCase()}@0x${"bb".repeat(32)}.json`);
    writeFileSync(unreadable, "not json");
    const listed = store.filesOf(8453, RECORD.pot);
    expect(listed.files.map((one) => one.path)).toEqual([first, beside, wrongTx]);
    expect(listed.warnings).toEqual([expect.stringContaining(`${unreadable} is not JSON`)]);
    // The whole store, each file with its own say; `list()` is what it was.
    const all = store.listFiles();
    expect(all.files.map((one) => one.path).sort()).toEqual(
      [
        first,
        beside,
        wrongTx,
        join(dir, "8453", `${elsewhere}.json`),
        join(dir, "1", `${RECORD.pot.toLowerCase()}.json`),
      ].sort(),
    );
    expect(all.files.filter((one) => !one.bound)).toHaveLength(3);
    expect(all.warnings).toHaveLength(1);
    expect(store.list().pots).toEqual(all.files.map((one) => one.record));
  });

  it("lets exactly one of two processes record a Pot, and both see the same file", async () => {
    for (let round = 0; round < 5; round++) {
      const at = join(dir, `round-${round}`);
      expect([...(await together(at, RECORD))].sort()).toEqual(["created", "exists"]);
      expect(
        JSON.parse(
          readFileSync(join(at, "store", "8453", `${RECORD.pot.toLowerCase()}.json`), "utf8"),
        ),
      ).toEqual(RECORD);
    }
  }, 60_000);
});

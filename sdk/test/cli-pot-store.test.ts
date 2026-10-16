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

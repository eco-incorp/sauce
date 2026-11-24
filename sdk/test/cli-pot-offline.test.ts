/**
 * Offline, a Pot is named by what can be checked. The Pot store keeps what landed on a fork or
 * another network with the chain's id beside what landed on the chain (`pot-store.ts`), and a
 * command that reads no chain cannot tell them apart. So with `--owner` (or `--wallet`) and no
 * `--pot`:
 *
 *   - no earlier release's Pot recorded for the chain, owner and salt: the installed release's
 *     CREATE3 Pot, with a note that an earlier one cannot be seen offline;
 *   - one recorded: `sauce tx` (with `--fund` or `--value` too) and `sauce sign` (`--cancel` too)
 *     refuse before they build anything, naming the record and both addresses, and `sauce pot`
 *     shows both and builds nothing. A recorded address moves funds only when the user names it
 *     (`--pot`), and a record decides the engine only of the Pot it is a record of: its own chain,
 *     its own Pot, read from the file its Pot's name gives. Any other record is ignored, with a note
 *     naming its file, and a record that cannot be read is a note, never an error.
 *
 * No chain and no engine: the records are what SDK 1.1.0 wrote for a deployment on a fork. The
 * online rule, which the chain decides, is `cli-pot-routing.e2e.test.ts`'s.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { PotStore, type PotRecord } from "../src/cli/pot-store.js";
import { evmRelease } from "../src/cli/pots.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import {
  v12EngineAddress,
  v12KitchenAddress,
  v12PotDerivation,
  v12ReleaseSet,
} from "../src/deployments/index.js";
import { DEFAULT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { v12PotAbi } from "../src/evm/engine.js";
import { legacyRow } from "./release-arm.js";

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `sauce` in process, keeping its Pot store in `pots` (none when undefined), with no endpoint. */
async function sauceIn(pots: string | undefined, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const overrides: Partial<CliIo> = pots === undefined ? {} : { potsDir: pots };
  const io: CliIo = {
    ...nodeIo(),
    ...overrides,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

const BASE = requireChain("base");
const ETHEREUM = requireChain("ethereum");
const OWNER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const STRANGER = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
const LEGACY = legacyRow("evm", "1.3.0");
/** The owner's Pot at salt 0 under the earlier release, and under the installed one (CREATE3). */
const EARLIER = getAddress(v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: LEGACY.compiler }));
const CURRENT = getAddress(v12PredictPot(OWNER, DEFAULT_POT_SALT));
const EARLIER_ENGINE = getAddress(LEGACY["v12-evm"].engine!);
const ENGINE = getAddress(v12EngineAddress());
const TX = `0x${"11".repeat(32)}`;
const BLOCK_HASH = `0x${"22".repeat(32)}`;

/** The record SDK 1.1.0 kept of a `sauce run` that deployed the owner's Pot on a fork of Base. */
const RECORD: PotRecord = {
  schema: "sauce.pot/1",
  chain: "base",
  chainId: BASE.id,
  pot: EARLIER,
  owner: OWNER,
  salt: DEFAULT_POT_SALT,
  kind: "private",
  kitchen: getAddress(v12KitchenAddress()),
  potInitCodeHash: LEGACY["kitchen-evm"].potInitCodeHash!,
  engine: EARLIER_ENGINE,
  release: evmRelease(LEGACY),
  sdk: "1.1.0",
  origin: "deployed",
  deployment: { tx: TX, block: "39000000", blockHash: BLOCK_HASH, from: OWNER },
  recordedAt: "2026-11-19T10:00:00.000Z",
};

/** The Pot a `sauce tx` run printed a cook for, and the engine that cook names. */
function cookedOn(run: Run): { pot: Address; engine: Address } {
  const printed = JSON.parse(run.stdout) as { to: Address; data: Hex };

  return {
    pot: getAddress(printed.to),
    engine: getAddress(
      (
        decodeFunctionData({ abi: v12PotAbi, data: printed.data }).args as readonly [Address, Hex]
      )[0],
    ),
  };
}

/** The Pot a `sauce sign` or `sauce tx --fund` run printed, and the engine it names. */
function printedPot(run: Run): { pot: Address; engine?: Address } {
  return JSON.parse(run.stdout) as { pot: Address; engine?: Address };
}

describe("offline, with an earlier release's Pot recorded for the owner", () => {
  let work: string;
  let program: string;
  let counter = 0;

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-offline-"));
    program = join(work, "seven.sauce.ts");
    writeFileSync(program, "function main(): Uint256 {\n  return 7;\n}\n");
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  /** A store holding `record`, and the file it is in. */
  const storeWith = (record: PotRecord = RECORD): { dir: string; file: string } => {
    const dir = join(work, `store-${counter++}`);
    new PotStore(dir).save(record);

    return { dir, file: join(dir, String(record.chainId), `${record.pot.toLowerCase()}.json`) };
  };
  /** A new store holding `text` as the file `name` of the directory `chainDir`. */
  const filed = (chainDir: string, name: string, text: string): { dir: string; file: string } => {
    const dir = join(work, `store-${counter++}`);
    mkdirSync(join(dir, chainDir), { recursive: true });
    writeFileSync(join(dir, chainDir, name), text);

    return { dir, file: join(dir, chainDir, name) };
  };

  const tx = (pots: string | undefined, ...argv: string[]): Promise<Run> =>
    sauceIn(pots, "tx", program, "--chain", "base", "--offline", ...argv);
  const sign = (pots: string | undefined, ...argv: string[]): Promise<Run> =>
    sauceIn(
      pots,
      "sign",
      program,
      "--chain",
      "base",
      "--offline",
      "--max-fee",
      "1",
      "--json",
      ...argv,
    );
  const cancel = (pots: string | undefined, ...argv: string[]): Promise<Run> =>
    sauceIn(pots, "sign", "--cancel", "1", "--chain", "base", "--offline", "--json", ...argv);

  /** What a refusal says, and that nothing came out of it: no plan, no address to send to. */
  const refused = (run: Run, file: string): void => {
    expect(run.code).toBe(1);
    expect(run.stdout).toBe("");
    const said = run.stderr.trim();
    expect(said.split("\n")).toHaveLength(1);
    for (const part of [
      file,
      TX,
      BLOCK_HASH,
      EARLIER,
      CURRENT,
      "Nothing offline can tell whether that record landed on base itself or on a fork",
      "--pot <address>",
      "RPC endpoint",
    ]) {
      expect(said).toContain(part);
    }
    // A record the store keeps is not a deployment anyone checked.
    expect(said).not.toMatch(/deployed/i);
  };

  describe("--owner", () => {
    it.each([
      ["sauce tx", (pots: string) => tx(pots, "--value", "0", "--owner", OWNER)],
      [
        "sauce tx --fund",
        (pots: string) => tx(pots, "--value", "0", "--owner", OWNER, "--fund", "USDC:1000000n"),
      ],
      ["sauce tx --value", (pots: string) => tx(pots, "--value", "1000", "--owner", OWNER)],
      ["sauce sign", (pots: string) => sign(pots, "--owner", OWNER)],
      ["sauce sign --cancel", (pots: string) => cancel(pots, "--owner", OWNER)],
    ])("%s refuses before it builds anything, naming the record", async (_name, run) => {
      const { dir, file } = storeWith();
      refused(await run(dir), file);
    });

    it("names the record's own file, however many records the Pot has", async () => {
      // Another deployment of one address is kept beside the first: the first's file is named.
      const { dir, file } = storeWith();
      const second = `0x${"33".repeat(32)}`;
      const beside = { ...RECORD, deployment: { ...RECORD.deployment!, tx: second } };
      expect(new PotStore(dir).save(beside)).toBe("beside");
      const run = await tx(dir, "--value", "0", "--owner", OWNER);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain(file);
      expect(run.stderr).toContain(TX);
    });

    it.each(["shared", "private-fixed-router", "bogus"])(
      "refuses for the record of an earlier release's Pot whatever kind it stores (%s): the address says the kind",
      async (kind) => {
        // A record is a file anyone can edit, and SDK 1.1.0 filed a Pot's kind wrongly where it could
        // not read it. This address is the owner's dynamic Pot of the earlier release.
        const { dir, file } = storeWith({ ...RECORD, kind } as unknown as PotRecord);
        refused(await tx(dir, "--value", "0", "--owner", OWNER), file);
      },
    );

    it("builds the CREATE3 Pot when the store records none for this chain, owner and salt", async () => {
      const otherPot = getAddress(
        v12PredictPot(STRANGER, DEFAULT_POT_SALT, { compiler: LEGACY.compiler }),
      );
      // The owner's fixed-Router Pot of the same release: another kind of Pot, at its own address.
      const fixedPot = getAddress(
        v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: LEGACY.compiler, routerFixed: true }),
      );
      const stores = [
        undefined,
        join(work, "no-store-yet"),
        // Another owner's, another salt's, another chain's, a Pot of another kind, and a Pot of the
        // installed release: none of them is an earlier Pot of this owner at this salt.
        storeWith({ ...RECORD, pot: otherPot, owner: STRANGER }).dir,
        storeWith({ ...RECORD, salt: `0x${"01".padStart(64, "0")}` }).dir,
        storeWith({ ...RECORD, chain: "ethereum", chainId: ETHEREUM.id }).dir,
        storeWith({ ...RECORD, kind: "private-fixed-router", pot: fixedPot }).dir,
        // The same Pot, filed as private: the address says it is a fixed-Router Pot, so it is no
        // earlier Pot of this owner's to refuse for. (The stored kind once made it one.)
        storeWith({ ...RECORD, kind: "private", pot: fixedPot }).dir,
        storeWith({
          ...RECORD,
          pot: CURRENT,
          engine: ENGINE,
          release: undefined,
          potInitCodeHash: undefined,
        }).dir,
      ];
      for (const pots of stores) {
        const run = await tx(pots, "--value", "0", "--owner", OWNER);
        expect(run.stderr).not.toContain("Nothing offline can tell whether that record");
        expect(run.code).toBe(0);
        expect(cookedOn(run)).toEqual({ pot: CURRENT, engine: ENGINE });
        expect(run.stderr).toContain("which cannot be seen offline");
      }
      const funded = await tx(
        undefined,
        ...["--value", "0", "--owner", OWNER, "--fund", "USDC:1000000n"],
      );
      expect(funded.code).toBe(0);
      expect(printedPot(funded).pot).toBe(CURRENT);
      const signed = await sign(undefined, "--owner", OWNER);
      expect(signed.code).toBe(0);
      expect(printedPot(signed)).toMatchObject({ pot: CURRENT, engine: ENGINE });
    });

    it("sauce pot shows both Pots with the record's provenance, and builds nothing", async () => {
      const { dir, file } = storeWith();
      const run = await sauceIn(dir, "pot", "--owner", OWNER, "--chain", "base", "--offline");
      expect(run.code).toBe(0);
      const json = JSON.parse(run.stdout) as Record<string, unknown> & {
        candidates: Array<{ pot: Address; engine: Address; record?: unknown }>;
      };
      // No Pot is named as the owner's, and there is nothing to send.
      for (const absent of ["pot", "to", "data", "value"]) expect(json).not.toHaveProperty(absent);
      expect(json.candidates.map((one) => getAddress(one.pot))).toEqual([CURRENT, EARLIER]);
      expect(json.candidates.map((one) => getAddress(one.engine))).toEqual([
        ENGINE,
        EARLIER_ENGINE,
      ]);
      expect(json.candidates[0]).not.toHaveProperty("record");
      expect(json.candidates[1]!.record).toEqual({
        path: file,
        tx: TX,
        block: "39000000",
        blockHash: BLOCK_HASH,
        sdk: "1.1.0",
        recordedAt: RECORD.recordedAt,
      });
      expect(run.stderr).toContain("Nothing offline can tell whether that record landed on base");
      expect(run.stderr).not.toMatch(/deployed/i);
      // `--format cast` has no transaction to print either.
      const cast = await sauceIn(
        dir,
        ...["pot", "--owner", OWNER, "--chain", "base", "--offline", "--format", "cast"],
      );
      expect(cast.code).toBe(0);
      expect(cast.stdout).not.toContain("cast send");
      // With no record it is the prediction and its deployment, as before.
      const plain = await sauceIn(
        undefined,
        ...["pot", "--owner", OWNER, "--chain", "base", "--offline"],
      );
      const predicted = JSON.parse(plain.stdout) as { pot: Address; to?: string };
      expect(getAddress(predicted.pot)).toBe(CURRENT);
      expect(predicted.to).toBeDefined();
    });
  });

  describe("--pot", () => {
    it("builds on the engine of the Pot named: the record's for the recorded Pot, else the installed one", async () => {
      const { dir } = storeWith();
      const earlier = await tx(dir, "--value", "0", "--pot", EARLIER);
      expect(earlier.code).toBe(0);
      expect(cookedOn(earlier)).toEqual({ pot: EARLIER, engine: EARLIER_ENGINE });
      expect(earlier.stderr).toContain("The engine is the one the Pot store records");

      const current = await tx(dir, "--value", "0", "--pot", CURRENT);
      expect(current.code).toBe(0);
      expect(cookedOn(current)).toEqual({ pot: CURRENT, engine: ENGINE });
      expect(current.stderr).toContain("the Pot store holds no record of it");

      // A signed cook names the engine of the Pot it is for, too.
      const signed = await sign(dir, "--pot", EARLIER);
      expect(signed.code).toBe(0);
      expect(printedPot(signed)).toMatchObject({ pot: EARLIER, engine: EARLIER_ENGINE });
    });

    it("ignores a record of another Pot filed under this Pot's name, with a note naming its file", async () => {
      // The earlier Pot's record, filed under the CURRENT Pot's name.
      const { dir, file } = filed(
        String(BASE.id),
        `${CURRENT.toLowerCase()}.json`,
        JSON.stringify(RECORD),
      );
      const run = await tx(dir, "--value", "0", "--pot", CURRENT);
      expect(run.code).toBe(0);
      expect(cookedOn(run)).toEqual({ pot: CURRENT, engine: ENGINE });
      expect(run.stderr).toContain(file);
      expect(run.stderr).toContain("ignored");
      expect(run.stderr).not.toContain("The engine is the one the Pot store records");
    });

    it("ignores a record of another chain, filed in the directory of this one", async () => {
      // A Base record under Ethereum's directory, under its Pot's own name.
      const { dir, file } = filed(
        String(ETHEREUM.id),
        `${EARLIER.toLowerCase()}.json`,
        JSON.stringify(RECORD),
      );
      const run = await sauceIn(
        dir,
        ...["tx", program, "--chain", "ethereum", "--offline", "--value", "0", "--pot", EARLIER],
      );
      expect(run.code).toBe(0);
      expect(cookedOn(run).engine).toBe(ENGINE);
      expect(run.stderr).toContain(file);
      expect(run.stderr).toContain("ignored");
    });

    it("says what it cannot read, and goes on: a malformed record is a note", async () => {
      const unreadable = filed(String(BASE.id), `${EARLIER.toLowerCase()}.json`, "not json {");
      const garbled = await tx(unreadable.dir, "--value", "0", "--pot", EARLIER);
      expect(garbled.code).toBe(0);
      expect(cookedOn(garbled).engine).toBe(ENGINE);
      expect(garbled.stderr).toContain(unreadable.file);
      expect(garbled.stderr).toContain("is not JSON");

      // A record with the fields of one and an address that is none: nothing is thrown from it.
      const wrong = filed(
        String(BASE.id),
        `${EARLIER.toLowerCase()}.json`,
        JSON.stringify({ ...RECORD, kitchen: "not an address" }),
      );
      const bad = await tx(wrong.dir, "--value", "0", "--pot", EARLIER);
      expect(bad.code).toBe(0);
      expect(cookedOn(bad).engine).toBe(ENGINE);
      expect(bad.stderr).toContain(wrong.file);

      // With --owner, the same: the CREATE3 Pot, and the file named.
      const byOwner = await tx(unreadable.dir, "--value", "0", "--owner", OWNER);
      expect(byOwner.code).toBe(0);
      expect(cookedOn(byOwner).pot).toBe(CURRENT);
      expect(byOwner.stderr).toContain(unreadable.file);
      const badOwner = await tx(wrong.dir, "--value", "0", "--owner", OWNER);
      expect(badOwner.code).toBe(0);
      expect(cookedOn(badOwner).pot).toBe(CURRENT);
      expect(badOwner.stderr).toContain(wrong.file);
    });

    it("a record that is right but for its deployment is a note too, never a throw", async () => {
      // `deployment` is optional, so a record may lack it; one that is there and is no object of
      // strings is a damaged record, however well it is filed.
      for (const deployment of [null, "0xabc", {}, { ...RECORD.deployment, tx: 7 }]) {
        const odd = filed(
          String(BASE.id),
          `${EARLIER.toLowerCase()}.json`,
          JSON.stringify({ ...RECORD, deployment }),
        );
        const byOwner = await tx(odd.dir, "--value", "0", "--owner", OWNER);
        expect([JSON.stringify(deployment), byOwner.code]).toEqual([JSON.stringify(deployment), 0]);
        expect(cookedOn(byOwner).pot).toBe(CURRENT);
        expect(byOwner.stderr).toContain(odd.file);
        expect(byOwner.stderr).toContain("its deployment");
        const byPot = await tx(odd.dir, "--value", "0", "--pot", EARLIER);
        expect(byPot.code).toBe(0);
        expect(cookedOn(byPot).engine).toBe(ENGINE);
        expect(byPot.stderr).toContain(odd.file);
      }
    });
  });

  describe("--owner, with a record that is not its file's", () => {
    it("ignores a record filed under another Pot's name, and says so", async () => {
      // The earlier Pot's record, filed under the CURRENT Pot's name: it decides nothing.
      const { dir, file } = filed(
        String(BASE.id),
        `${CURRENT.toLowerCase()}.json`,
        JSON.stringify(RECORD),
      );
      const run = await tx(dir, "--value", "0", "--owner", OWNER);
      expect(run.code).toBe(0);
      expect(cookedOn(run).pot).toBe(CURRENT);
      expect(run.stderr).toContain(file);
      expect(run.stderr).toContain("ignored");
    });
  });

  describe("--owner, with no --value", () => {
    it("refuses for the record first, as with a value; the missing value is said only with none", async () => {
      const { dir, file } = storeWith();
      const argv = ["tx", program, "--chain", "base", "--offline", "--owner", OWNER];
      refused(await sauceIn(dir, ...argv), file);
      // No record to refuse for: the value is what is missing, as ever.
      const none = await sauceIn(undefined, ...argv);
      expect(none.code).not.toBe(0);
      expect(none.stderr).toContain("missing --value");
    });
  });

  describe("sauce sign --cancel from a signer", () => {
    it("refuses for the record first, as for an owner; the missing endpoint is said only with none", async () => {
      const key = generatePrivateKey();
      const mine = privateKeyToAccount(key).address;
      const theirs = getAddress(
        v12PredictPot(mine, DEFAULT_POT_SALT, { compiler: LEGACY.compiler }),
      );
      const { dir, file } = storeWith({ ...RECORD, pot: theirs, owner: mine });
      const run = await cancel(dir, "--private-key", key);
      expect(run.code).toBe(1);
      expect(run.stdout).toBe("");
      for (const part of [
        file,
        theirs,
        getAddress(v12PredictPot(mine, DEFAULT_POT_SALT)),
        "Nothing offline can tell whether that record landed on base itself or on a fork",
      ]) {
        expect(run.stderr).toContain(part);
      }
      // No record to refuse for: sending needs an endpoint, as ever.
      const none = await cancel(undefined, "--private-key", key);
      expect(none.code).not.toBe(0);
      expect(none.stderr).toContain("sending the cancellation needs an RPC endpoint");
    });
  });
});

describe("offline, a CREATE3 Pot's record decides its engine only where its Router is fixed", () => {
  // The 1.4.0 release's row: its Router, R1, is the one the Pots minted before the switch were fixed
  // to, and its engine, E1, the only one that runs them.
  const R14 = v12ReleaseSet("2.6.3");
  const E1 = getAddress(R14["v12-evm"].engine!);
  const FIXED = getAddress(v12PredictPot(OWNER, DEFAULT_POT_SALT, { routerFixed: true }));
  const SHARED = getAddress(v12PredictPot(zeroAddress, DEFAULT_POT_SALT));
  /** What an earlier SDK wrote for a dynamic CREATE3 Pot: the engine it was minted under. */
  const DYNAMIC: PotRecord = {
    schema: "sauce.pot/1",
    chain: "base",
    chainId: BASE.id,
    pot: CURRENT,
    owner: OWNER,
    salt: DEFAULT_POT_SALT,
    kind: "private",
    kitchen: getAddress(v12KitchenAddress()),
    potProxyInitCodeHash: R14["kitchen-evm"].potProxyInitCodeHash!,
    potProfileHash: R14["kitchen-evm"].potProfileHash!,
    engine: E1,
    release: evmRelease(R14),
    sdk: "1.1.0",
    origin: "deployed",
    deployment: { tx: TX, block: "39000000", blockHash: BLOCK_HASH, from: OWNER },
    recordedAt: "2026-11-19T10:00:00.000Z",
  };

  let work: string;
  let program: string;
  let counter = 0;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-offline-create3-"));
    program = join(work, "seven.sauce.ts");
    writeFileSync(program, "function main(): Uint256 {\n  return 7;\n}\n");
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  /** `sauce tx` offline of `record`'s Pot, with `record` as the only thing the store holds. */
  const txOf = async (record: PotRecord): Promise<Run> => {
    const dir = join(work, `store-${counter++}`);
    new PotStore(dir).save(record);

    return sauceIn(
      dir,
      ...["tx", program, "--chain", "base", "--offline", "--value", "0", "--pot", record.pot],
    );
  };

  it("cooks a dynamic Pot on the installed engine whatever an earlier SDK's record names", async () => {
    const run = await txOf(DYNAMIC);
    expect(run.code).toBe(0);
    expect(cookedOn(run)).toEqual({ pot: CURRENT, engine: ENGINE });
    expect(run.stderr).toContain(
      `names the engine ${E1}; a Pot whose Router can move cooks on ${ENGINE}, offline as online.`,
    );
    // The record did not decide the engine, so no note says it did.
    expect(run.stderr).not.toContain("The engine is the one the Pot store records");
  });

  it("cooks a fixed-Router Pot on the engine its record names, when it is one of the family's", async () => {
    const run = await txOf({ ...DYNAMIC, kind: "private-fixed-router", pot: FIXED });
    expect(run.code).toBe(0);
    expect(cookedOn(run)).toEqual({ pot: FIXED, engine: E1 });
    expect(run.stderr).toContain("The engine is the one the Pot store records");
    expect(run.stderr).toContain("v12-evm 1.4.0");
  });

  it("falls back to the installed engine, saying so, for a record that names none of the family's", async () => {
    const run = await txOf({
      ...DYNAMIC,
      kind: "private-fixed-router",
      pot: FIXED,
      engine: "0x000000000000000000000000000000000000bEEF",
    });
    expect(run.code).toBe(0);
    expect(cookedOn(run)).toEqual({ pot: FIXED, engine: ENGINE });
    expect(run.stderr).toContain("names no engine of its release family");
    expect(run.stderr).toContain("runs only on the engine built for its Router");
  });

  it("cooks a Shared Pot on the engine its record names, as a fixed-Router one", async () => {
    const run = await txOf({ ...DYNAMIC, kind: "shared", owner: zeroAddress, pot: SHARED });
    expect(run.code).toBe(0);
    expect(cookedOn(run)).toEqual({ pot: SHARED, engine: E1 });
    expect(run.stderr).toContain("The engine is the one the Pot store records");
  });

  // What an earlier SDK wrote of a CREATE3 Pot, as it really wrote it: SDK 1.1.0 knew no CREATE3
  // release, so its record names the Kitchen's reported hash and no engine, no release and no
  // profile; and where it could not read the Pot's kind it filed it as `private`, a fixed-Router Pot
  // included.
  const FROM_110 = (pot: Address, kind: PotRecord["kind"]): PotRecord => ({
    schema: "sauce.pot/1",
    chain: "base",
    chainId: BASE.id,
    pot,
    owner: OWNER,
    salt: DEFAULT_POT_SALT,
    kind,
    kitchen: getAddress(v12KitchenAddress()),
    potInitCodeHash: v12PotDerivation().initCodeHash,
    sdk: "1.1.0",
    origin: "deployed",
    deployment: { tx: TX, block: "39000000", blockHash: BLOCK_HASH, from: OWNER },
    recordedAt: "2026-11-19T10:00:00.000Z",
  });
  const CAUTIOUS = "names no engine of its release family";

  describe("a record's kind is what its address says, not what its `kind` field says", () => {
    it.each(["private-fixed-router", "shared", "bogus"])(
      "cooks a dynamic Pot on the installed engine though its record says %s",
      async (kind) => {
        const run = await txOf({ ...DYNAMIC, kind } as unknown as PotRecord);
        expect(run.code).toBe(0);
        expect(cookedOn(run)).toEqual({ pot: CURRENT, engine: ENGINE });
        expect(run.stderr).toContain(`a Pot whose Router can move cooks on ${ENGINE}`);
        expect(run.stderr).not.toContain("The engine is the one the Pot store records");
      },
    );

    it("cooks a fixed-Router Pot on the engine its record names though the record says private", async () => {
      const run = await txOf({ ...DYNAMIC, kind: "private", pot: FIXED });
      expect(run.code).toBe(0);
      expect(cookedOn(run)).toEqual({ pot: FIXED, engine: E1 });
      expect(run.stderr).toContain("The engine is the one the Pot store records");
    });

    it("cooks a Shared Pot on the engine its record names though the record says private", async () => {
      const run = await txOf({ ...DYNAMIC, kind: "private", owner: zeroAddress, pot: SHARED });
      expect(run.code).toBe(0);
      expect(cookedOn(run)).toEqual({ pot: SHARED, engine: E1 });
    });

    it.each(["private", "private-fixed-router"] as const)(
      "takes the record SDK 1.1.0 wrote of a fixed-Router Pot, kind %s, for what it cannot tell: the installed engine, with the cautious note",
      async (kind) => {
        const run = await txOf(FROM_110(FIXED, kind));
        expect(run.code).toBe(0);
        expect(cookedOn(run)).toEqual({ pot: FIXED, engine: ENGINE });
        expect(run.stderr).toContain(CAUTIOUS);
        expect(run.stderr).toContain("runs only on the engine built for its Router");
        expect(run.stderr).not.toContain("The engine is the one the Pot store records");
      },
    );

    it("does not say a record names the engine of a dynamic Pot it names none of", async () => {
      const run = await txOf(FROM_110(CURRENT, "private"));
      expect(run.code).toBe(0);
      expect(cookedOn(run)).toEqual({ pot: CURRENT, engine: ENGINE });
      // The engine is its release's, and the note says whose it is.
      expect(run.stderr).toContain(`names no engine: the engine is ${ENGINE}, its release's`);
      expect(run.stderr).not.toContain("The engine is the one the Pot store records");
    });
  });

  describe("an engine a record names that is no address is a note, never an error", () => {
    it.each([
      ["a string that is no address", "not an address"],
      ["null", null],
      ["a number", 5],
    ] as const)(
      "%s: the record's engine is ignored, and the Pot's own decides",
      async (_what, engine) => {
        const damaged = { ...DYNAMIC, engine } as unknown as PotRecord;
        const note = `names an engine that is not an address (${JSON.stringify(engine)}): that field is ignored.`;

        // A dynamic Pot cooks on its family's engine, as it does for any record.
        const dynamic = await txOf(damaged);
        expect(dynamic.code).toBe(0);
        expect(cookedOn(dynamic)).toEqual({ pot: CURRENT, engine: ENGINE });
        expect(dynamic.stderr).toContain(note);
        expect(dynamic.stderr).toContain("names no engine");

        // A fixed-Router Pot has no engine to take from such a record: the cautious note, as for a
        // record that names none.
        const fixed = await txOf({ ...damaged, kind: "private-fixed-router", pot: FIXED });
        expect(fixed.code).toBe(0);
        expect(cookedOn(fixed)).toEqual({ pot: FIXED, engine: ENGINE });
        expect(fixed.stderr).toContain(note);
        expect(fixed.stderr).toContain(CAUTIOUS);
      },
    );
  });
});

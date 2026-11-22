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
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { PotStore, type PotRecord } from "../src/cli/pot-store.js";
import { evmRelease } from "../src/cli/pots.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { v12EngineAddress, v12KitchenAddress } from "../src/deployments/index.js";
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
const LEGACY = legacyRow("evm");
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

    it("builds the CREATE3 Pot when the store records none for this chain, owner and salt", async () => {
      const otherPot = getAddress(
        v12PredictPot(STRANGER, DEFAULT_POT_SALT, { compiler: LEGACY.compiler }),
      );
      const stores = [
        undefined,
        join(work, "no-store-yet"),
        // Another owner's, another salt's, another chain's, a Pot of another kind, and a Pot of the
        // installed release: none of them is an earlier Pot of this owner at this salt.
        storeWith({ ...RECORD, pot: otherPot, owner: STRANGER }).dir,
        storeWith({ ...RECORD, salt: `0x${"01".padStart(64, "0")}` }).dir,
        storeWith({ ...RECORD, chain: "ethereum", chainId: ETHEREUM.id }).dir,
        storeWith({ ...RECORD, kind: "shared" }).dir,
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
});

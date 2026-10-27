/**
 * Huma's emitted quote, EXECUTED on the released engine against the real Huma pool fixture: the
 * quote equals `referenceQuote` while the live status byte (offset 9) is On, and is 0 for Off and
 * for any other status. GATED on the engine artifacts like every engine-executing suite.
 */
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { address } from "@solana/kit";
import { huma } from "../../src/svm/venues/huma/index.js";
import type { HumaPoolConfig } from "../../src/svm/venues/huma/index.js";
import { compileSvm, wrapQuoteMain } from "./rs-compile.js";
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from "./fixtures.js";
import type { AccountFixture } from "./fixtures.js";
import {
  describeSvm,
  execute,
  expectOk,
  loadFixtureAccounts,
  startEngine,
  toBigInt,
} from "./engine-harness.js";
import type { EngineHarness, ExecutableOutput } from "./engine-harness.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "huma");
const MODE = address("3FhoMDyKzQqxtGxnz9DfysfoGQKvgDnSFjoDGgguDCQN");
const POOL_STATE = "iFgP2EbzHUZzMjqbjaagJQ8zmn6as3Hw95aVUKm67od";
const STATUS_OFFSET = 9;
const fixtures = loadFixtures(FIXTURE_DIR);

describeSvm("huma emitQuote status gate, executed on the engine", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  /** The fixtures loaded into the bank, the pool state's status byte replaced when given. */
  const load = (status?: number): AccountFixture[] => {
    const loaded = fixtures.map((fixture) => {
      if (status === undefined || fixture.address !== POOL_STATE) return fixture;
      const data = fixtureData(fixture);
      data[STATUS_OFFSET] = status;
      return { ...fixture, base64Data: Buffer.from(data).toString("base64") } as AccountFixture;
    });
    loadFixtureAccounts(harness, loaded);
    return loaded;
  };

  const run = async (config: HumaPoolConfig, amount: bigint): Promise<bigint> => {
    const accounts = huma.quoteAccounts(config).map((account) => {
      if (!account.address) throw new Error(`quote account ${account.ref} has no address`);
      return account.address;
    });
    const { bytecode, manifest } = compileSvm(
      wrapQuoteMain(accounts.length, huma.emitQuote(config, 0, amount), "q0"),
    );
    const names: Record<string, string> = {};
    accounts.forEach((account, index) => (names[`acc${index}`] = account));
    const result = expectOk(
      await execute(harness, { bytecode, manifest } as ExecutableOutput, names),
    );
    return toBigInt(result.returnData);
  };

  it.each(["deposit", "withdraw"] as const)(
    "%s quotes 0 unless the live status byte is On",
    async (direction) => {
      const fetched = (await huma.fetchPoolConfig(fixtureLoader(fixtures), MODE)) as HumaPoolConfig;
      const config = { ...fetched, direction };
      const reference = huma.referenceQuote!(config, fixtureBytesMap(load()), 100_000_000n, 0n);
      expect(reference).toBeGreaterThan(0n);
      expect(await run(config, 100_000_000n)).toBe(reference);
      for (const status of [0, 2]) {
        load(status);
        expect(await run(config, 100_000_000n)).toBe(0n);
      }
    },
  );
});

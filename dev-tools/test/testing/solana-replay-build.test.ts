/**
 * A Solana recording replays on the engine build it was recorded on. The engine has two builds,
 * mainnet's and devnet's, which compile in different chain ids (`ctx.chainId()`); a bank over a
 * cluster runs the one that cluster serves, so a recording names it, with its digest, and a replay
 * loads exactly that packaged build. A recording from before it named one (version 1) was written by
 * banks that always ran mainnet's, and replays on it by its version, not by a default.
 *
 * The cluster is a source in this process serving each build as an upgradeable program account would
 * hold it, the way `solana-legacy-pot.test.ts` serves an earlier engine.
 *
 * Runs wherever LiteSVM and the synced engine artifacts are; skips without them locally, and fails
 * under CI, where it must run.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { address, type Address } from "@solana/kit";

import { fork } from "../../src/testing/index.js";
import {
  Bank,
  type AccountSource,
  type ClusterHeader,
  type ReadAccount,
} from "../../src/testing/solana-bank.js";
import { SolanaTestChain } from "../../src/testing/solana.js";
import {
  requireChain,
  svmEnginePath,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../../src/testing/sdk.js";
import { solanaMissing } from "./solana-support.js";

const ENGINE = address(v12SvmEngineProgramId());
const KITCHEN = address(v12SvmKitchenProgramId());
const UPGRADEABLE_LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const SOLANA = requireChain("solana");
/** The endpoint a recording says it read from: never in the file it writes. */
const RPC = "http://127.0.0.1:9/";

/** Each build compiles in its cluster's id: mainnet-beta's, and devnet's (testnet runs devnet's). */
const BUILDS = [
  { build: "mainnet", chainId: 1_399_811_149n },
  { build: "devnet", chainId: 1_399_811_150n },
] as const;
type Build = (typeof BUILDS)[number]["build"];

const CHAIN_ID = "function main(): Uint256 {\n  return ctx.chainId();\n}\n";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const packaged = (build: Build): Uint8Array => new Uint8Array(readFileSync(svmEnginePath(build)));

/** A program as a cluster serves it: executable, its code the program data's, zero-padded. */
const programServed = (elf: Uint8Array): ReadAccount => {
  const code = new Uint8Array(elf.length + 64);
  code.set(elf);

  return {
    lamports: 1_000_000_000n,
    owner: UPGRADEABLE_LOADER,
    data: new Uint8Array(),
    executable: true,
    code,
  };
};

/** A source that serves what `held` holds, and nothing else. */
const sourceOf = (held: Map<Address, ReadAccount>): AccountSource => ({
  read: async (keys) => keys.map((key) => held.get(key) ?? null),
});

const TIMESTAMP = 1_700_000_000n;
const HEADER: ClusterHeader = {
  clock: {
    slot: 1_000n,
    epochStartTimestamp: TIMESTAMP,
    epoch: 0n,
    leaderScheduleEpoch: 0n,
    unixTimestamp: TIMESTAMP,
  },
};

interface StateFile {
  sauce: { version: number; engine?: { build?: string; sha256?: string } } & Record<
    string,
    unknown
  >;
  accounts: Record<string, unknown>;
  programs: Record<string, unknown>;
}
const readState = (path: string): StateFile =>
  JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as StateFile;
const writeState = (path: string, file: StateFile): string => {
  writeFileSync(path, gzipSync(JSON.stringify(file)));

  return path;
};

describe(
  "a Solana recording replays on the engine build it was made on",
  { skip: solanaMissing() },
  () => {
    let dir: string;
    before(() => {
      dir = mkdtempSync(join(tmpdir(), "sauce-testing-replay-build-"));
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    /** Records `CHAIN_ID` on a bank over a cluster serving `build`; what it returned. */
    async function record(path: string, build: Build): Promise<unknown> {
      const bank = await Bank.open({
        mode: "record",
        source: sourceOf(new Map([[ENGINE, programServed(packaged(build))]])),
        header: HEADER,
        engine: ENGINE,
        kitchen: KITCHEN,
      });
      const chain = await SolanaTestChain.start(SOLANA, bank, {
        zeroFee: true,
        recordTo: { path, rpcUrl: RPC },
      });
      const { returned } = await chain.run({ source: CHAIN_ID });
      await chain.stop();

      return returned;
    }

    /** `CHAIN_ID` through a replay of `path`. */
    async function replay(path: string): Promise<unknown> {
      const chain = await fork("solana", { state: path, mode: "replay", zeroFee: true });
      try {
        return (await chain.run({ source: CHAIN_ID })).returned;
      } finally {
        await chain.stop();
      }
    }

    for (const { build, chainId } of BUILDS) {
      it(`records and replays the ${build} build to the same return, and names it`, async () => {
        const state = join(dir, `${build}.json.gz`);
        const recorded = await record(state, build);
        assert.equal(recorded, chainId, `the bank ran the ${build} build while recording`);
        assert.equal(
          await replay(state),
          recorded,
          `the replay runs the build the recording was made on: ${build}'s chain id ${chainId}`,
        );
        const { sauce } = readState(state);
        assert.equal(sauce.version, 2);
        assert.deepEqual(sauce.engine, { build, sha256: sha256(packaged(build)) });
      });
    }

    it("replays a version 1 recording, which named no build, on the mainnet build", async () => {
      const state = join(dir, "version-1-source.json.gz");
      await record(state, "mainnet");
      const file = readState(state);
      file.sauce.version = 1;
      delete file.sauce.engine;
      const historical = writeState(join(dir, "version-1.json.gz"), file);

      assert.equal(await replay(historical), 1_399_811_149n);
    });

    it("refuses a version 2 recording that names no build, an unknown one, or another digest", async () => {
      const state = join(dir, "devnet-source.json.gz");
      await record(state, "devnet");
      const variant = (name: string, change: (file: StateFile) => void): string => {
        const file = readState(state);
        change(file);

        return writeState(join(dir, `${name}.json.gz`), file);
      };

      await assert.rejects(
        replay(variant("no-engine", (file) => void delete file.sauce.engine)),
        /is a version 2 recording that names no engine build/,
      );
      await assert.rejects(
        replay(
          variant(
            "unknown",
            (file) => void (file.sauce.engine = { build: "testnet", sha256: "00" }),
          ),
        ),
        /names the engine build "testnet", which is neither mainnet nor devnet/,
      );
      // The devnet build's digest belongs to the devnet build: a recording that says devnet with the
      // mainnet build's digest was not made on this package's devnet build.
      await assert.rejects(
        replay(
          variant(
            "other-digest",
            (file) =>
              void (file.sauce.engine = { build: "devnet", sha256: sha256(packaged("mainnet")) }),
          ),
        ),
        new RegExp(
          `was made on the engine's devnet build, sha256 ${sha256(packaged("mainnet"))}, and this ` +
            `package's is ${sha256(packaged("devnet"))}: it would replay on other code, so record it again`,
        ),
      );
      // A version this kit does not know is not read as one it does.
      await assert.rejects(
        replay(variant("future", (file) => void (file.sauce.version = 3))),
        /is not a recorded Solana state file/,
      );
    });
  },
);

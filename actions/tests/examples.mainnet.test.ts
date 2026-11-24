/**
 * The skills' examples executed on Ethereum's state captured at its pinned block: every group
 * that reads the `official-ethereum` blob, run on ONE anvil this file starts and stops.
 *
 * The blob has one owner because a capture (`RECAPTURE_ANVIL_STATE=1`, `mainnet.ts`) rewrites it
 * whole from what its one fork read. Groups capturing one after another would each replace it,
 * leaving only the last one's state; on one fork, the blob is everything every group read. Each
 * group reverts what it changed (a snapshot taken before its first test), so none sees another's
 * state.
 *
 * A group is a module exporting `register(anvil)`, listed in `GROUPS` here and nowhere in
 * `package.json`; this file is what `test`, `test:mainnet` and `capture-mainnet` name. The last
 * test holds that rule, with no engine and no chain.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import * as lending from "./examples-lending.mainnet.js";
import * as pendleBalancer from "./examples-pendle-balancer.mainnet.js";
import * as uniswapV3 from "./examples-uniswap-v3.mainnet.js";

/** Every group on the `official-ethereum` anvil, by its file, in the order they run. */
const GROUPS: Readonly<Record<string, { register(anvil: () => Anvil): void }>> = {
  "examples-uniswap-v3.mainnet.ts": uniswapV3,
  "examples-pendle-balancer.mainnet.ts": pendleBalancer,
  "examples-lending.mainnet.ts": lending,
};

describe(
  "the examples on official-ethereum, one anvil",
  { skip: skipReason(), timeout: 1_800_000 },
  () => {
    let env: Anvil | undefined;

    before(async () => {
      env = await startAnvil({ mainnet: "official-ethereum", chain: "ethereum" });
    });
    after(async () => {
      await env?.stop();
    });

    const anvil = (): Anvil => {
      assert.ok(env, "the official-ethereum anvil has not started");
      return env;
    };
    for (const group of Object.values(GROUPS)) group.register(anvil);
  },
);

describe("the official-ethereum blob has one owner", () => {
  const TESTS = dirname(fileURLToPath(import.meta.url));
  const ENTRY = basename(fileURLToPath(import.meta.url));

  it("registers every module that reads it, and no module starts its own anvil on it", () => {
    const readers = readdirSync(TESTS)
      .filter((file) => file.endsWith(".ts") && file !== ENTRY)
      .filter((file) => readFileSync(join(TESTS, file), "utf8").includes("official-ethereum"));
    assert.deepEqual(readers.sort(), Object.keys(GROUPS).sort());
    for (const file of readers) {
      assert.equal(typeof GROUPS[file]!.register, "function", `${file} exports no register`);
      assert.doesNotMatch(readFileSync(join(TESTS, file), "utf8"), /startAnvil\(/, file);
    }
  });

  it("is what every script names, the capture's included, and no group is named alone", () => {
    const { scripts } = JSON.parse(readFileSync(join(TESTS, "../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const script of ["test", "test:mainnet", "capture-mainnet"]) {
      const suites = scripts[script]!.split(/\s+/);
      assert.ok(suites.includes(`tests/${ENTRY}`), `${script} does not run ${ENTRY}`);
    }
    for (const [script, line] of Object.entries(scripts)) {
      for (const file of Object.keys(GROUPS)) {
        assert.ok(!line.split(/\s+/).includes(`tests/${file}`), `${script} names ${file} alone`);
      }
    }
  });
});

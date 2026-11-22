/**
 * The tools' side of the offline rule (`sdk/test/cli-pot-offline.test.ts` holds it for the command):
 * a server that keeps the `sauce` command's Pot store, asked about an owner with no endpoint to read
 * the chain through, cannot tell an earlier release's Pot the store records from one that landed on
 * a fork. `sauce_tx` and `sauce_signed_cook` (a cancellation too) refuse before they build anything,
 * naming the record; `sauce_pot` returns both Pots with the record's provenance, no `pot` and no
 * deployment; naming the Pot (`pot`) builds on its own engine. A server that keeps no store (over
 * HTTP) has no record to be asked about.
 *
 * No chain and no engine: the record is what SDK 1.1.0 wrote for a deployment on a fork.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";

import { PotStore, type PotRecord } from "../../sdk/dist/cli/pot-store.js";
import { evmRelease } from "../../sdk/dist/cli/pots.js";
import { v12EngineAddress, v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
import { DEFAULT_POT_SALT, v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { v12PotAbi } from "../../sdk/dist/evm/engine.js";
import { legacyRow } from "../../sdk/test/release-arm.js";
import { connect, failed, ok, type Connected } from "./harness.js";

const OWNER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const LEGACY = legacyRow("evm");
/** The owner's Pot at salt 0 under the earlier release, and under the installed one (CREATE3). */
const EARLIER = getAddress(v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: LEGACY.compiler }));
const CURRENT = getAddress(v12PredictPot(OWNER, DEFAULT_POT_SALT));
const EARLIER_ENGINE = getAddress(LEGACY["v12-evm"].engine!);
const ENGINE = getAddress(v12EngineAddress());
const TX = `0x${"11".repeat(32)}`;
const BLOCK_HASH = `0x${"22".repeat(32)}`;
const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";

/** The record SDK 1.1.0 kept of a `sauce run` that deployed the owner's Pot on a fork of Base. */
const RECORD: PotRecord = {
  schema: "sauce.pot/1",
  chain: "base",
  chainId: 8453,
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

const engineOf = (data: Hex): Address =>
  getAddress((decodeFunctionData({ abi: v12PotAbi, data }).args as readonly [Address, Hex])[0]);

describe("the tools, offline, with an earlier release's Pot recorded for the owner", () => {
  let dir: string;
  let file: string;
  /** As over stdio: the server keeps the store. */
  let stdio: Connected;
  /** As over HTTP: no store. */
  let http: Connected;
  const cook = { source: PROGRAM, chain: "base", args: ["1"], value: "0" };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-pot-offline-"));
    const store = new PotStore(join(dir, "pots"));
    store.save(RECORD);
    file = join(dir, "pots", "8453", `${EARLIER.toLowerCase()}.json`);
    stdio = await connect(undefined, undefined, undefined, true, { pots: store });
    http = await connect();
  });

  after(async () => {
    await stdio?.close();
    await http?.close();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  /** What a refusal says in the tools' words (`terms.ts`): the record and both Pots, nothing built. */
  const refused = (said: string): void => {
    for (const part of [
      file,
      TX,
      BLOCK_HASH,
      EARLIER,
      CURRENT,
      "Nothing offline can tell whether that record landed on base itself or on a fork",
      "pass pot <address> to name one, or an RPC endpoint",
    ]) {
      assert.ok(said.includes(part), `${part} is not in: ${said}`);
    }
    assert.doesNotMatch(said, /deployed/i);
  };

  it("sauce_tx and sauce_signed_cook refuse an owner, before they build anything", async () => {
    refused(failed(await stdio.call("sauce_tx", { ...cook, owner: OWNER })));
    refused(failed(await stdio.call("sauce_tx", { ...cook, owner: OWNER, fund: ["USDC:1.5"] })));
    refused(
      failed(
        await stdio.call("sauce_signed_cook", {
          source: PROGRAM,
          chain: "base",
          args: ["1"],
          maxExecutionFee: "1",
          owner: OWNER,
        }),
      ),
    );
    refused(
      failed(await stdio.call("sauce_signed_cook", { chain: "base", cancel: [1], owner: OWNER })),
    );
  });

  it("sauce_pot returns both Pots with the record, and no pot and no deployment", async () => {
    const out = ok(await stdio.call("sauce_pot", { chain: "base", owner: OWNER })) as {
      candidates: Array<{ pot: Address; engine: Address; record?: Record<string, unknown> }>;
      deployed: boolean | null;
      notes: string[];
    };
    for (const absent of ["pot", "to", "data", "value"]) {
      assert.ok(!(absent in out), `${absent} is in the result`);
    }
    assert.deepEqual(
      out.candidates.map((one) => [getAddress(one.pot), getAddress(one.engine)]),
      [
        [CURRENT, ENGINE],
        [EARLIER, EARLIER_ENGINE],
      ],
    );
    assert.deepEqual(out.candidates[1]!.record, {
      path: file,
      tx: TX,
      block: "39000000",
      blockHash: BLOCK_HASH,
      sdk: "1.1.0",
      recordedAt: RECORD.recordedAt,
    });
    assert.equal(out.deployed, null);
    assert.ok(
      out.notes.some((note) => note.includes("Nothing offline can tell whether that record")),
    );
  });

  it("naming the Pot builds on its own engine; the record's Pot and the CREATE3 Pot each", async () => {
    const earlier = ok(await stdio.call("sauce_tx", { ...cook, pot: EARLIER })) as {
      to: Address;
      data: Hex;
    };
    assert.equal(getAddress(earlier.to), EARLIER);
    assert.equal(engineOf(earlier.data), EARLIER_ENGINE);
    const current = ok(await stdio.call("sauce_tx", { ...cook, pot: CURRENT })) as {
      to: Address;
      data: Hex;
    };
    assert.equal(getAddress(current.to), CURRENT);
    assert.equal(engineOf(current.data), ENGINE);
  });

  it("a server that keeps no store has no record to be asked about: the CREATE3 Pot", async () => {
    const tx = ok(await http.call("sauce_tx", { ...cook, owner: OWNER })) as {
      to: Address;
      data: Hex;
    };
    assert.equal(getAddress(tx.to), CURRENT);
    assert.equal(engineOf(tx.data), ENGINE);
    const pot = ok(await http.call("sauce_pot", { chain: "base", owner: OWNER })) as {
      pot: Address;
    };
    assert.equal(getAddress(pot.pot), CURRENT);
  });
});

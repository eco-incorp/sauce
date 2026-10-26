/**
 * `pot.owner` on an EVM chain, EXECUTED: the Pot's `owner()`, read by a program the released engine
 * runs through a real Kitchen-minted Pot (`gated-engine.ts`) on a local anvil, nothing forked. Its
 * lowering and bytes are `routes-svm-account-expressions.test.ts`'s.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  hexToBigInt,
  http,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { startGatedEngine } from "./gated-engine.js";
import type { GatedEngine } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}

/** Anvil's first dev account: the harness's deployer, and the Pot's owner. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

const PORT = freePortSync();
const transport = http(`http://127.0.0.1:${PORT}`, {
  fetchOptions: { headers: { connection: "close" } },
});
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

let anvil: ChildProcess;
let sauce: GatedEngine;

/** What `main` returns, one word, cooked by an eth_call from the Pot's owner. */
const cooked = async (source: string): Promise<Hex> => {
  const program = compileSauceProgram("base", source);
  const data = sauce.cookData(
    concatHex([bytesToHex(program.bytecode), bytesToHex(encodeEntryArguments(program, []))]),
  );
  return (await publicClient.call({ account: OWNER.address, data, to: sauce.pot })).data!;
};

describeEvm("pot.owner, the Pot's owner, executed through a Kitchen-minted Pot", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("returns the cook's owner, which is not the Pot", async () => {
    const word = await cooked("function main(): Address {\n  return pot.owner;\n}\n");
    expect(getAddress(`0x${word.slice(-40)}`)).toBe(OWNER.address);
    expect(hexToBigInt(word)).toBe(hexToBigInt(OWNER.address));
    expect(hexToBigInt(await cooked("function main(): Address {\n  return pot;\n}\n"))).toBe(
      hexToBigInt(sauce.pot),
    );
  });

  it("reads the owner's native balance as pot.owner.balance", async () => {
    const balance = await publicClient.getBalance({ address: OWNER.address });
    expect(
      hexToBigInt(await cooked("function main(): Uint256 {\n  return pot.owner.balance;\n}\n")),
    ).toBe(balance);
  });
});

/**
 * SauceScript's signed integers, EXECUTED: what the language reference says `Int256` does, run on
 * the released gated engine (`gated-engine.ts`) on a local anvil, nothing forked. The programs and
 * the words they return are `../signed-integer-cases.ts`, which the Solana suite runs too.
 *
 * The second half is the other direction: an `intN` argument to a contract. A stub that logs the
 * calldata it receives stands in for the callee, and each row asserts the calldata byte for byte
 * against viem's own encoding, so a negative value that arrived as something else would fail.
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
  encodeFunctionData,
  hexToBigInt,
  http,
  parseAbi,
} from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { bits, MAX, MIN, REVERTS, SIGNED_CASES } from "../signed-integer-cases.js";
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

/** The program run by an eth_call from the Pot's owner: what `main` returns, one word. */
const run = async (source: string, args: readonly bigint[]): Promise<Hex> => {
  const program = compileSauceProgram("base", source);
  const data = sauce.cookData(
    concatHex([bytesToHex(program.bytecode), bytesToHex(encodeEntryArguments(program, [...args]))]),
  );
  return (await publicClient.call({ account: OWNER.address, data, to: sauce.pot })).data!;
};

/** The callee of the second half: it logs the calldata it receives, whole, and stops. */
const STUB = "0x00000000000000000000000000000000000057b0" as Address;
const STUB_RUNTIME = "0x365f5f37365fa000" as Hex; // CALLDATASIZE 0 0 CALLDATACOPY CALLDATASIZE 0 LOG0 STOP
const STUB_ABI = parseAbi(["function sink256(int256 value)", "function sink24(int24 value)"]);

/**
 * `main(x)` calling the stub with `argument` (a SauceScript expression over the word `x`): the
 * calldata the stub received, or "reverted".
 */
const delivered = async (method: "sink256" | "sink24", argument: string, x: bigint) => {
  const source = `function main(x: Uint256) { Stub.at(${BigInt(STUB)}).${method}(${argument}); }`;
  const program = compileSauceProgram("base", source, { contracts: { Stub: { abi: STUB_ABI } } });
  const data = sauce.cookData(
    concatHex([bytesToHex(program.bytecode), bytesToHex(encodeEntryArguments(program, [x]))]),
  );
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data,
    gas: 10_000_000n,
    to: sauce.pot,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return receipt.status === "success" ? receipt.logs.map((log) => log.data) : ("reverted" as const);
};

describeEvm("SauceScript's Int256, executed through the released engine", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );
  }, 120_000);

  beforeEach(async () => {
    await testClient.setCode({ address: STUB, bytecode: STUB_RUNTIME });
  });

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  for (const { group, name, source, args, returns, signed } of SIGNED_CASES) {
    it(`${group}: ${name}`, async () => {
      if (returns === REVERTS) {
        await expect(run(source, args)).rejects.toThrow();
      } else {
        expect(hexToBigInt(await run(source, args), { signed })).toBe(returns);
      }
    });
  }

  describe("an intN argument to a contract", () => {
    const calldata = (method: "sink256" | "sink24", value: bigint) => [
      encodeFunctionData({ abi: STUB_ABI, functionName: method, args: [value] }),
    ];

    it.each([-5n, MIN, MAX, 0n])("an Int256 argument arrives as itself: %s", async (value) => {
      expect(await delivered("sink256", "Int256.fromBits(x)", bits(value))).toEqual(
        calldata("sink256", value),
      );
    });

    it("a Uint256 argument is converted with a check: a small value arrives, a word above 2^255 - 1 reverts", async () => {
      expect(await delivered("sink256", "x", 5n)).toEqual(calldata("sink256", 5n));
      expect(await delivered("sink256", "x", MAX)).toEqual(calldata("sink256", MAX));
      // -5's two's-complement word: it compiles, and reverts when the call is made.
      expect(await delivered("sink256", "x", bits(-5n))).toBe("reverted");
      expect(await delivered("sink256", "x", 2n ** 255n)).toBe("reverted");
    });

    it("a narrow intN takes its own range: int24 reaches -2^23 and 2^23 - 1, and nothing beyond", async () => {
      const lowest = -(2n ** 23n);
      const highest = 2n ** 23n - 1n;
      expect(await delivered("sink24", "Int256.fromBits(x)", bits(lowest))).toEqual(
        calldata("sink24", lowest),
      );
      expect(await delivered("sink24", "Int256.fromBits(x)", highest)).toEqual(
        calldata("sink24", highest),
      );
      expect(await delivered("sink24", "Int256.fromBits(x)", bits(lowest - 1n))).toBe("reverted");
      expect(await delivered("sink24", "Int256.fromBits(x)", highest + 1n)).toBe("reverted");
    });
  });
});

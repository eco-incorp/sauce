/**
 * `try { … } catch { … }`, executed on the released gated stack: the engine, the Kitchen and a Pot it
 * minted, each deployed from its release's creation code at its release address
 * (`./evm/gated-engine.ts`), and the program cooked by the Pot as any other.
 *
 * A block of more than one external call runs in a frame of its own — the compiler delegates it to
 * the engine the Pot is running, which the Pot answers to `inFlightEngine()` — so what it writes
 * stands when it succeeds and is undone, all of it, when it reverts, and the `catch` block then
 * runs in the program's own frame. No second cook, so no second Kitchen fee. A block of one external
 * call is that call, caught.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure without
 * it in CI.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  hexToBigInt,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { encodeEntryArguments } from "../src/routes/entry.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { startGatedEngine, type GatedEngine } from "./evm/gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;

if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip there — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

/** Anvil's first dev account: the Kitchen's owner and the Pot's. A public key, local only. */
const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const PORT = 9650 + (Number(process.env.JEST_WORKER_ID ?? "1") % 50);
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 10_000_000n;

const transport = http(RPC_URL);
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ transport, account: DEPLOYER });
const testClient = createTestClient({ transport, mode: "anvil" });

/** `ok`, then the first three storage slots of the Pot, as one number: ok·1000 + s1·100 + s2·10 + s3. */
const REPORT = "return ok * 1000 + evm.sload(1) * 100 + evm.sload(2) * 10 + evm.sload(3);";

describeEvm("try/catch on the released gated stack", () => {
  let anvil: ChildProcess;
  let sauce: GatedEngine;

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    for (const deadline = Date.now() + 20_000; ;) {
      try {
        await publicClient.getChainId();
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`anvil did not come up on ${RPC_URL}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, walletClient, testClient },
      DEPLOYER.address,
      creationCode,
    );
  }, 60_000);

  afterAll(async () => {
    if (anvil === undefined || anvil.exitCode !== null) return;
    const exited = once(anvil, "exit");
    anvil.kill();
    await exited;
  });

  /** What `main` returns, in decimal, when the Pot cooks `source` with `values` as its arguments. */
  const run = async (source: string, values: readonly bigint[] = []): Promise<string> => {
    const program = compileSauceProgram("base", source);
    const args = encodeEntryArguments(program, values);
    const { data = "0x" } = await publicClient.call({
      account: DEPLOYER.address,
      to: sauce.pot,
      data: sauce.cookData(concatHex([bytesToHex(program.bytecode), bytesToHex(args)])),
      gas: GAS_LIMIT,
    });

    return hexToBigInt(data).toString();
  };

  it("undoes everything a reverting block did, then runs its catch", async () => {
    const source = `function main(): Uint256 {
  let ok = 1;
  try {
    evm.sstore(1, 5);
    evm.sstore(2, 6);
    require(false, "no");
  } catch {
    ok = 0;
    evm.sstore(3, 7);
  }
  ${REPORT}
}`;
    expect(await run(source)).toBe("7");
  }, 30_000);

  it("keeps what a succeeding block did, and skips its catch", async () => {
    const source = `function main(): Uint256 {
  let ok = 1;
  try {
    evm.sstore(1, 5);
    evm.sstore(2, 6);
  } catch {
    ok = 0;
    evm.sstore(3, 7);
  }
  ${REPORT}
}`;
    expect(await run(source)).toBe("1560");
  }, 30_000);

  it("reads what it captures, and nests", async () => {
    const source = `function main(x: Uint256): Uint256 {
  let ok = 1;
  try {
    evm.sstore(1, x);
    try {
      evm.sstore(2, 2);
      require(x > 5);
    } catch {
      evm.sstore(3, 3);
    }
  } catch {
    ok = 0;
  }
  ${REPORT}
}`;
    expect(await run(source, [4n])).toBe("1403");
    expect(await run(source, [7n])).toBe("1720");
  }, 30_000);

  it("catches a block of one external call as that call", async () => {
    // The Pot answers its own `gateSalt()`; any other selector goes to its Router, which reverts.
    const source = (data: string) => `function main(): Uint256 {
  let ok = 1;
  try {
    evm.static(ctx.self(), hex\`${data}\`);
  } catch {
    ok = 0;
  }
  return ok;
}`;
    expect(await run(source("deadbeef"))).toBe("0");
    expect(await run(source("eb77129b"))).toBe("1");
  }, 30_000);
});

/**
 * `pot.owner` on an EVM chain, EXECUTED: the Pot's `owner()`, read by a program the released engine
 * runs through a real Kitchen-minted Pot (`gated-engine.ts`) on a local anvil, nothing forked. Its
 * lowering and bytes are `routes-svm-account-expressions.test.ts`'s.
 *
 * The owner cooking its own Pot cannot tell `pot.owner` from the account that calls: so the owner's
 * signed cook is also submitted by a stranger, and a Shared Pot, which has no owner, is cooked by
 * one. In both the caller (`ctx.msgSender()`) and the transaction's origin (`ctx.txOrigin()`) are
 * the stranger, and `pot.owner` is not.
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
  numberToHex,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  encodeCookSigned,
  randomCookNonce,
  signedCookTypedData,
  v12KitchenAbi,
  type SignedCookExecution,
} from "../../src/evm/engine.js";
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
/** Anvil's fourth dev account: neither the Pot's owner nor anything of the stack's. */
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
/** `main(): Address { return pot.owner; }`. */
const READS_OWNER = "function main(): Address {\n  return pot.owner;\n}\n";

const PORT = freePortSync();
const transport = http(`http://127.0.0.1:${PORT}`, {
  fetchOptions: { headers: { connection: "close" } },
});
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

let anvil: ChildProcess;
let sauce: GatedEngine;

/** `source` compiled for Base, with its entry arguments: what a cook runs. */
const programOf = (source: string): Hex => {
  const program = compileSauceProgram("base", source);
  return concatHex([bytesToHex(program.bytecode), bytesToHex(encodeEntryArguments(program, []))]);
};

/**
 * The 32-byte word `main` returns for an address or a number, as an `eth_call` answers it: compared
 * as text, so a failure reads in jest's report (a `bigint` cannot cross its worker boundary).
 */
const wordOf = (value: Hex | bigint): Hex =>
  numberToHex(typeof value === "bigint" ? value : hexToBigInt(value), { size: 32 });

/** What `main` returns, one word, cooked by an eth_call from the Pot's owner. */
const cooked = async (source: string): Promise<Hex> =>
  (
    await publicClient.call({
      account: OWNER.address,
      data: sauce.cookData(programOf(source)),
      to: sauce.pot,
    })
  ).data!;

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
    expect(await cooked(READS_OWNER)).toBe(wordOf(OWNER.address));
    expect(await cooked("function main(): Address {\n  return pot;\n}\n")).toBe(wordOf(sauce.pot));
  });

  it("reads the owner's native balance as pot.owner.balance", async () => {
    const balance = await publicClient.getBalance({ address: OWNER.address });
    expect(await cooked("function main(): Uint256 {\n  return pot.owner.balance;\n}\n")).toBe(
      wordOf(balance),
    );
  });

  it("is the Pot's owner, not the stranger who submits the owner's signed cook", async () => {
    const cook: SignedCookExecution = {
      chainId: await publicClient.getChainId(),
      pot: sauce.pot,
      engine: sauce.engine,
      program: programOf(READS_OWNER),
      maxExecutionFee: 0n,
      nonce: randomCookNonce(),
      deadline: 4_000_000_000n,
    };
    const tx = encodeCookSigned({
      ...cook,
      signature: await OWNER.signTypedData(signedCookTypedData(cook)),
    });
    const { data } = await publicClient.call({
      account: STRANGER.address,
      data: tx.data,
      to: tx.to,
      value: tx.value,
    });
    expect(data).toBe(wordOf(OWNER.address));
  });

  it("is the zero address on a Shared Pot, which has no owner, cooked by a stranger", async () => {
    const salt = numberToHex(50, { size: 32 });
    const hash = await walletClient.sendTransaction({
      account: OWNER,
      chain: null,
      data: encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: "deploySharedPot",
        args: [salt],
      }),
      to: sauce.kitchen,
    });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    const shared = await publicClient.readContract({
      abi: v12KitchenAbi,
      address: sauce.kitchen,
      functionName: "predictSharedPot",
      args: [salt],
    });
    const { data } = await publicClient.call({
      account: STRANGER.address,
      data: sauce.cookData(programOf(READS_OWNER)),
      to: shared,
    });
    expect(data).toBe(wordOf(0n));
  });
});

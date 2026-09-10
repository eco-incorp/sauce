/**
 * @eco-incorp/sauce/verify — the corpus, EXECUTED.
 *
 * Everything else about `/verify` is a claim about bytes: that `SETTLE_VECTORS[i].args` is what the
 * settle program will read as `(tokens, minOut, recipient)`, and that the three
 * `sweepsIdentically: true` entries in `SETTLE_REJECTIONS` are byte strings the engine cannot tell apart
 * from the canonical payload. Neither claim is provable by encoding and decoding with this package's
 * own two functions — that only shows they agree with each other. This suite runs the committed
 * payload bytes VERBATIM on a real v12 runtime against real ERC20s and reads the result off chain.
 *
 * The vectors' token and recipient addresses are literal, so an ERC20's runtime code is etched at
 * each one with `anvil_setCode` rather than the vectors being rewritten around deployed addresses.
 * The bytes that execute here are byte-for-byte the bytes in `src/verify/vectors.ts`.
 *
 * GATED on SAUCE_RUST_V12_RUNTIME, and for the same reason as `test/std/token/evm.e2e.test.ts` —
 * see that suite's header for the engine-lineage finding in full, and for the two commands that
 * produce the file. CI supplies it, so an absent one is a failure there, never a skip.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  decodeSettleProgram,
  encodeSettleProgram,
  settlePayload,
  SETTLE_PROGRAM,
  SETTLE_REJECTIONS,
  SETTLE_VECTORS,
} from "../src/verify/index";

const RUNTIME_HEX_PATH = process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;

if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_RUST_V12_RUNTIME is unset in CI. This suite must never skip here — see the " +
      '"Derive the deployed v12 runtime bytecode" step in .github/workflows/ci.yml.',
  );
}

/** The same vendored OpenZeppelin `ERC20Mock` creation code the `@sauce/token` EVM suite deploys. */
const MOCK_ERC20 = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "std", "token", "fixtures", "MockERC20.json"),
    "utf8",
  ),
) as { creationCode: Hex };

const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** Where the V12 runtime is etched. It is also the Pot: `ctx.self()` is the engine, so the swept
 *  balances are the ones this address holds. */
const ENGINE: Address = "0x00000000000000000000000000000000000000ee";
const PORT = 8700 + (Number(process.env.JEST_WORKER_ID ?? "1") % 100);
const RPC_URL = `http://127.0.0.1:${PORT}`;
const STARTUP_TIMEOUT_MS = 20_000;
const GAS_LIMIT = 10_000_000n;

const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
]);

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: DEPLOYER, transport });

const waitForRpc = (deadline: number): Promise<void> =>
  Date.now() >= deadline
    ? Promise.reject(new Error(`anvil did not come up on ${RPC_URL}`))
    : publicClient
        .getChainId()
        .then(() => undefined)
        .catch(() =>
          new Promise((resolve) => setTimeout(resolve, 100)).then(() => waitForRpc(deadline)),
        );

const sendTo = (to: Address, data: Hex): Promise<"success" | "reverted"> =>
  walletClient
    .sendTransaction({ account: DEPLOYER, chain: null, to, data, gas: GAS_LIMIT })
    .then((hash) => publicClient.waitForTransactionReceipt({ hash }))
    .then(({ status }) => status);

const mintTo = (token: Address, holder: Address, amount: bigint): Promise<"success" | "reverted"> =>
  sendTo(
    token,
    encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [holder, amount] }),
  );

const balanceOf = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });

/** A token no vector names, so the floor-violation case cannot inherit a balance from one. */
const FLOOR_TOKEN: Address = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";

// ENGINE NOTE — do not use `0x1111…11` as a token address here. Observed while building this corpus:
// as an ARRAY ELEMENT value it makes the v12 runtime revert `MemoryOOG` rather than perform (or
// cleanly refuse) the sweep, and the failure is value-dependent — neighbouring addresses run fine.
// It is this repo's usual placeholder address, so it is the natural thing for the next person to
// reach for. Unresolved against the engine at the time of writing; the corpus avoids it instead.

/** Every distinct address the corpus names as a token or a recipient, plus [`FLOOR_TOKEN`]. The
 *  rejection vectors reuse the first vector's addresses, so they add none of their own. */
const addressesInPlay = (): Address[] => {
  const all = SETTLE_VECTORS.flatMap((v) => [...v.tokens, v.recipient]).concat(FLOOR_TOKEN);

  return [...new Set(all.map((a) => a.toLowerCase()))] as Address[];
};

/**
 * Boot anvil, etch the runtime at [`ENGINE`], then etch an ERC20's runtime code at every address the
 * corpus names. A real deploy gives one address of anvil's choosing; the vectors need code at THEIR
 * addresses, which is what `setCode` is for. Storage starts empty either way, and every balance here
 * is minted afterwards.
 */
const startEvm = async (): Promise<ChildProcess> => {
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });

  // A failed spawn — no `anvil` on PATH — reports asynchronously as an 'error' event, not a throw
  // from `spawn`. With no listener that event kills the jest worker with a raw ENOENT before the
  // startup timeout below can say what is wrong. Race it so the failure arrives named, and at once.
  const spawnFailed = new Promise<never>((_, reject) => {
    anvil.once("error", (err: Error) =>
      reject(new Error(`could not start anvil (is it on PATH?): ${err.message}`)),
    );
  });

  // Everything after the spawn is guarded: a waitForRpc timeout, a setCode failure or a deploy
  // revert would otherwise leave the child holding this port for the rest of the job.
  try {
    await Promise.race([waitForRpc(Date.now() + STARTUP_TIMEOUT_MS), spawnFailed]);
    await testClient.setCode({
      address: ENGINE,
      bytecode: `0x${readFileSync(RUNTIME_HEX_PATH as string, "utf8")
        .trim()
        .replace(/^0x/, "")}`,
    });

    const hash = await walletClient.sendTransaction({
      account: DEPLOYER,
      chain: null,
      data: MOCK_ERC20.creationCode,
      gas: GAS_LIMIT,
    });
    const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
    const erc20Runtime = await publicClient.getCode({ address: contractAddress as Address });
    for (const address of addressesInPlay())
      await testClient.setCode({ address, bytecode: erc20Runtime as Hex });

    return anvil;
  } catch (err) {
    // Through `stopEvm`, awaited: a bare kill() here is the exact leak that helper documents. This is
    // the path a waitForRpc timeout or a reverting deploy takes, and jest then moves to the next
    // suite -- which binds this same PORT and would fail with EADDRINUSE, masking the real error.
    await stopEvm(anvil);
    throw err;
  }
};

/** Await the exit rather than firing a bare `kill()`: an un-awaited kill leaves the child alive long
 *  enough to trip jest's "did not exit" warning, and a stray anvil would hold the port. */
const stopEvm = (anvil: ChildProcess): Promise<void> => {
  if (anvil.exitCode !== null) return Promise.resolve();
  const exited = once(anvil, "exit");
  anvil.kill();

  return exited.then(() => undefined);
};

describeEvm("settle payload execution on the real V12 EVM engine", () => {
  let anvil: ChildProcess;

  beforeAll(async () => {
    anvil = await startEvm();
  }, 60_000);

  afterAll(() => (anvil ? stopEvm(anvil) : undefined));

  for (const v of SETTLE_VECTORS) {
    it(`${v.name} — the engine sweeps exactly what the decoder says`, async () => {
      const decoded = decodeSettleProgram(settlePayload(v.args));
      const payload = settlePayload(v.args);
      // A distinct, non-round amount per token, all at or above minOut so the floor passes.
      const funded = decoded.tokens.map((_, i) => decoded.minOut + BigInt(1_000 + i * 37));
      for (const [i, token] of decoded.tokens.entries())
        await mintTo(token as Address, ENGINE, funded[i]!);

      const before = await Promise.all(
        decoded.tokens.map((t) => balanceOf(t as Address, decoded.recipient as Address)),
      );
      // The program returns the floor token's balance — read it before the state-changing send.
      const returned = await publicClient.call({ to: ENGINE, data: payload, gas: GAS_LIMIT });
      expect(await sendTo(ENGINE, payload)).toBe("success");

      // Every listed token moved, in full, to the DECODED recipient — and the engine's own view of
      // the floor token's balance matches the token the decoder named `floorToken`.
      const after = await Promise.all(
        decoded.tokens.map((t) => balanceOf(t as Address, decoded.recipient as Address)),
      );
      expect(after.map((a, i) => a - before[i]!)).toEqual(funded);
      expect(await balanceOf(decoded.floorToken as Address, ENGINE)).toBe(0n);
      expect(BigInt(returned.data ?? "0x0")).toBe(funded[0]!);
    }, 60_000);
  }

  it("a minOut above the floor token’s balance reverts the whole sweep", async () => {
    // On a token no vector sweeps, so the balance below is the whole balance — and through
    // `encodeSettleProgram`, which puts the ENCODER's own output on the engine rather than a
    // committed literal.
    const recipient = SETTLE_VECTORS[0]!.recipient as Address;
    const payload = encodeSettleProgram([FLOOR_TOKEN], 10_000n, recipient, SETTLE_PROGRAM);
    await mintTo(FLOOR_TOKEN, ENGINE, 9_999n);
    const before = await balanceOf(FLOOR_TOKEN, recipient);

    expect(await sendTo(ENGINE, payload)).toBe("reverted");
    expect(await balanceOf(FLOOR_TOKEN, recipient)).toBe(before);

    // One more token unit clears the floor, and the same payload then sweeps the lot.
    await mintTo(FLOOR_TOKEN, ENGINE, 1n);
    expect(await sendTo(ENGINE, payload)).toBe("success");
    expect((await balanceOf(FLOOR_TOKEN, recipient)) - before).toBe(10_000n);
  }, 60_000);

  describe("the traps — payloads the ENGINE cannot tell from the canonical one", () => {
    const canonical = SETTLE_VECTORS[0]!;

    // `sweepsIdentically`, not `engineAccepts`: the engine also runs the dirty-RECIPIENT payload, but
    // a solc ERC20's own address check refuses it, so it cannot be shown equivalent against the
    // ERC20Mock etched here. It is still a trap for the decoder -- see vectors.ts.
    for (const trap of SETTLE_REJECTIONS.filter((r) => r.sweepsIdentically)) {
      it(`${trap.name} runs identically to ${canonical.name}`, async () => {
        // This is the whole case for decode.ts §4. The decoder refuses these bytes; the engine does
        // not, and produces the same transfer. Two byte strings, one meaning — so a decoder that
        // accepted them would not be injective, and the §5 re-encode check would disagree with it.
        const decoded = decodeSettleProgram(settlePayload(canonical.args));
        const token = decoded.floorToken as Address;
        const recipient = decoded.recipient as Address;

        await mintTo(token, ENGINE, 4_242n);
        const before = await balanceOf(token, recipient);
        expect(await sendTo(ENGINE, settlePayload(trap.args))).toBe("success");
        expect((await balanceOf(token, recipient)) - before).toBe(4_242n);
      }, 60_000);
    }
  });
});

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
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { startGatedEngine } from "./evm/gated-engine.js";
import type { GatedEngine } from "./evm/gated-engine.js";

import {
  decodeSettleProgram,
  encodeSettleProgram,
  settlePayload,
  SETTLE_PROGRAM,
  SETTLE_REJECTIONS,
  SETTLE_VECTORS,
  SETTLE_WIRE,
} from "../src/verify/index";
import { freePortSync, spawnAnvil } from "./anvil-process.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;

if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
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

/**
 * A token whose `transfer`/`approve`/`transferFrom` return NOTHING, like USDT on Ethereum. The source
 * is vendored beside it (`fixtures/NoReturnERC20.sol`); the creation code was produced by
 * `solc 0.8.36 --evm-version cancun --optimize --optimize-runs 200 --combined-json abi,bin`. The
 * constructor takes `(name, symbol, decimals)`, but the code is etched with `setCode`, so its storage
 * starts empty and those three values are never read.
 */
const NO_RETURN_ERC20 = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "std", "token", "fixtures", "NoReturnERC20.json"),
    "utf8",
  ),
) as { abi: unknown[]; creationCode: Hex };

/** A token whose `transfer` returns `false` and moves nothing — the case `SafeERC20` exists for. The
 *  same vendored fixture `routes-nest-dynamic.e2e.test.ts` runs `token/safe.ts` against. */
const FALSE_RETURN_ERC20 = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "std",
      "token",
      "fixtures",
      "FalseReturnERC20.json",
    ),
    "utf8",
  ),
) as { creationCode: Hex };

const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/**
 * The acting account, resolved by `startGatedEngine` in `beforeAll`.
 *
 * It is the POT. `ctx.self()` is whoever the engine was delegatecalled by, and a released engine is
 * only ever reached through `Pot.cook` — so the swept balances are the ones the POT holds, and every
 * mint below funds it rather than the engine.
 */
let sauce: GatedEngine;
/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
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

/** Where the no-return token is etched. No vector names it, so every balance on it is minted here. */
const NO_RETURN_TOKEN: Address = "0x7a5e9b3c2d4f6e8a0b1c3d5e7f9a2b4c6d8e0f12";

/** Where the false-returning token is etched. No vector names it either. */
const FALSE_RETURN_TOKEN: Address = "0x3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f";

/** An address nothing is ever etched at, so a call to it runs no code and returns nothing. */
const NO_CODE_TOKEN: Address = "0x5b6c7d8e9fa0b1c2d3e4f5061728394a5b6c7d8e";

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
 * Boot anvil, stand up the gated engine (Kitchen at its baked address, then a real Pot minted from
 * it — see `evm/gated-engine.ts`), then etch an ERC20's runtime code at every address the
 * corpus names. A real deploy gives one address of anvil's choosing; the vectors need code at THEIR
 * addresses, which is what `setCode` is for. Storage starts empty either way, and every balance here
 * is minted afterwards.
 */
const startEvm = async (): Promise<ChildProcess> => {
  // `spawnAnvil` names a failed spawn (no `anvil` on PATH) and a port it could not bind, at once.
  const anvil = await spawnAnvil(PORT, [], STARTUP_TIMEOUT_MS);

  // Everything after the start is guarded: a setCode failure or a deploy revert would otherwise
  // leave the child running for the rest of the job.
  try {
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      DEPLOYER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );

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

    const noReturnHash = await walletClient.sendTransaction({
      account: DEPLOYER,
      chain: null,
      data: encodeDeployData({
        abi: NO_RETURN_ERC20.abi,
        bytecode: NO_RETURN_ERC20.creationCode,
        args: ["No Return", "NRT", 6],
      }),
      gas: GAS_LIMIT,
    });
    const noReturn = await publicClient.waitForTransactionReceipt({ hash: noReturnHash });
    const noReturnRuntime = await publicClient.getCode({
      address: noReturn.contractAddress as Address,
    });
    await testClient.setCode({ address: NO_RETURN_TOKEN, bytecode: noReturnRuntime as Hex });

    const falseReturnHash = await walletClient.sendTransaction({
      account: DEPLOYER,
      chain: null,
      data: FALSE_RETURN_ERC20.creationCode,
      gas: GAS_LIMIT,
    });
    const falseReturn = await publicClient.waitForTransactionReceipt({ hash: falseReturnHash });
    const falseReturnRuntime = await publicClient.getCode({
      address: falseReturn.contractAddress as Address,
    });
    await testClient.setCode({ address: FALSE_RETURN_TOKEN, bytecode: falseReturnRuntime as Hex });

    return anvil;
  } catch (err) {
    // Through `stopEvm`, awaited: a bare kill() here is the exact leak that helper documents. This is
    // the path a reverting deploy takes, and jest then moves to the next suite.
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
        await mintTo(token as Address, sauce.pot, funded[i]!);

      const before = await Promise.all(
        decoded.tokens.map((t) => balanceOf(t as Address, decoded.recipient as Address)),
      );
      // The program returns the floor token's balance — read it before the state-changing send.
      const returned = await publicClient.call({
        account: DEPLOYER.address,
        data: sauce.cookData(payload),
        gas: GAS_LIMIT,
        to: sauce.pot,
        value: sauce.fee,
      });
      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("success");

      // Every listed token moved, in full, to the DECODED recipient — and the engine's own view of
      // the floor token's balance matches the token the decoder named `floorToken`.
      const after = await Promise.all(
        decoded.tokens.map((t) => balanceOf(t as Address, decoded.recipient as Address)),
      );
      expect(after.map((a, i) => a - before[i]!)).toEqual(funded);
      expect(await balanceOf(decoded.floorToken as Address, sauce.pot)).toBe(0n);
      expect(BigInt(returned.data ?? "0x0")).toBe(funded[0]!);
    }, 60_000);
  }

  it("a minOut above the floor token’s balance reverts the whole sweep", async () => {
    // On a token no vector sweeps, so the balance below is the whole balance — and through
    // `encodeSettleProgram`, which puts the ENCODER's own output on the engine rather than a
    // committed literal.
    const recipient = SETTLE_VECTORS[0]!.recipient as Address;
    const payload = encodeSettleProgram([FLOOR_TOKEN], 10_000n, recipient, SETTLE_PROGRAM);
    await mintTo(FLOOR_TOKEN, sauce.pot, 9_999n);
    const before = await balanceOf(FLOOR_TOKEN, recipient);

    expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("reverted");
    expect(await balanceOf(FLOOR_TOKEN, recipient)).toBe(before);

    // One more token unit clears the floor, and the same payload then sweeps the lot.
    await mintTo(FLOOR_TOKEN, sauce.pot, 1n);
    expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("success");
    expect((await balanceOf(FLOOR_TOKEN, recipient)) - before).toBe(10_000n);
  }, 60_000);

  // A token that returns nothing from `transfer`, like USDT. While the template transferred through
  // `IERC20`, the compiled program decoded a `bool` from the empty return and the engine reverted the
  // whole sweep; these cells are what caught it. The SafeERC20 transfer accepts an empty return from
  // an address that has code.
  describe("a no-return token (USDT-style) is swept like any other", () => {
    it("as the floor token: swept in full, and the program returns its balance", async () => {
      const recipient = SETTLE_VECTORS[0]!.recipient as Address;
      const payload = encodeSettleProgram([NO_RETURN_TOKEN], 5_000n, recipient, SETTLE_PROGRAM);
      await mintTo(NO_RETURN_TOKEN, sauce.pot, 7_777n);
      const before = await balanceOf(NO_RETURN_TOKEN, recipient);

      const returned = await publicClient.call({
        account: DEPLOYER.address,
        data: sauce.cookData(payload),
        gas: GAS_LIMIT,
        to: sauce.pot,
        value: sauce.fee,
      });
      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("success");
      expect((await balanceOf(NO_RETURN_TOKEN, recipient)) - before).toBe(7_777n);
      expect(await balanceOf(NO_RETURN_TOKEN, sauce.pot)).toBe(0n);
      expect(BigInt(returned.data ?? "0x0")).toBe(7_777n);
    }, 60_000);

    it("after a standard ERC20 in the same list: both swept in full", async () => {
      const recipient = SETTLE_VECTORS[0]!.recipient as Address;
      const payload = encodeSettleProgram(
        [FLOOR_TOKEN, NO_RETURN_TOKEN],
        1n,
        recipient,
        SETTLE_PROGRAM,
      );
      await mintTo(FLOOR_TOKEN, sauce.pot, 1_111n);
      await mintTo(NO_RETURN_TOKEN, sauce.pot, 2_222n);
      const before = await Promise.all(
        [FLOOR_TOKEN, NO_RETURN_TOKEN].map((t) => balanceOf(t, recipient)),
      );

      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("success");
      const after = await Promise.all(
        [FLOOR_TOKEN, NO_RETURN_TOKEN].map((t) => balanceOf(t, recipient)),
      );
      expect(after.map((a, i) => a - before[i]!)).toEqual([1_111n, 2_222n]);
      expect(await balanceOf(NO_RETURN_TOKEN, sauce.pot)).toBe(0n);
    }, 60_000);

    it("the balance-based floor still reverts the whole sweep, then clears", async () => {
      const recipient = SETTLE_VECTORS[0]!.recipient as Address;
      const payload = encodeSettleProgram([NO_RETURN_TOKEN], 10_000n, recipient, SETTLE_PROGRAM);
      await mintTo(NO_RETURN_TOKEN, sauce.pot, 9_999n);
      const before = await balanceOf(NO_RETURN_TOKEN, recipient);

      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("reverted");
      expect(await balanceOf(NO_RETURN_TOKEN, recipient)).toBe(before);

      await mintTo(NO_RETURN_TOKEN, sauce.pot, 1n);
      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("success");
      expect((await balanceOf(NO_RETURN_TOKEN, recipient)) - before).toBe(10_000n);
    }, 60_000);
  });

  // What `SafeERC20` adds over skipping the decode: a write that did not happen must not read as one
  // that did. The first two cells list a standard token FIRST, so the revert is shown to take the
  // whole sweep down: the balance swept before the bad token never leaves the Pot.
  describe("a transfer that did not happen reverts the whole sweep", () => {
    it("a token that returns false", async () => {
      // Before the SafeERC20 transfer, this sweep succeeded: the recipient got nothing, the Pot kept
      // the balance, and the program reported the sweep as done.
      const recipient = SETTLE_VECTORS[0]!.recipient as Address;
      const payload = encodeSettleProgram(
        [FLOOR_TOKEN, FALSE_RETURN_TOKEN],
        0n,
        recipient,
        SETTLE_PROGRAM,
      );
      await mintTo(FLOOR_TOKEN, sauce.pot, 4_444n);
      await mintTo(FALSE_RETURN_TOKEN, sauce.pot, 5_555n);
      const held = await balanceOf(FLOOR_TOKEN, sauce.pot);

      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("reverted");
      expect(await balanceOf(FLOOR_TOKEN, sauce.pot)).toBe(held);
      expect(await balanceOf(FALSE_RETURN_TOKEN, sauce.pot)).toBe(5_555n);

      // Control: without the false-returning token the same balance sweeps.
      const control = encodeSettleProgram([FLOOR_TOKEN], 0n, recipient, SETTLE_PROGRAM);
      expect(await sendTo(sauce.pot, sauce.cookData(control))).toBe("success");
      expect(await balanceOf(FLOOR_TOKEN, sauce.pot)).toBe(0n);
    }, 60_000);

    it("a token address with no code", async () => {
      // The sweep reads `balanceOf` first, and decoding its `uint256` from a codeless address's empty
      // return already refuses this; the transfer's own code-size check is the second line behind it.
      expect(await publicClient.getCode({ address: NO_CODE_TOKEN })).toBeUndefined();
      const recipient = SETTLE_VECTORS[0]!.recipient as Address;
      const payload = encodeSettleProgram(
        [FLOOR_TOKEN, NO_CODE_TOKEN],
        0n,
        recipient,
        SETTLE_PROGRAM,
      );
      await mintTo(FLOOR_TOKEN, sauce.pot, 6_666n);
      const held = await balanceOf(FLOOR_TOKEN, sauce.pot);

      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("reverted");
      expect(await balanceOf(FLOOR_TOKEN, sauce.pot)).toBe(held);

      const control = encodeSettleProgram([FLOOR_TOKEN], 0n, recipient, SETTLE_PROGRAM);
      expect(await sendTo(sauce.pot, sauce.cookData(control))).toBe("success");
      expect(await balanceOf(FLOOR_TOKEN, sauce.pot)).toBe(0n);
    }, 60_000);

    // A token that refuses by REVERTING: the raw call bubbles it. `ERC20Mock` refuses a zero
    // receiver, and the encoder refuses to build one, so the recipient word is zeroed by hand.
    it("a transfer the token refuses by reverting", async () => {
      const encoded = encodeSettleProgram(
        [FLOOR_TOKEN],
        0n,
        SETTLE_VECTORS[0]!.recipient,
        SETTLE_PROGRAM,
      );
      const at = 2 + (SETTLE_WIRE.PROGRAM_BYTES + 2 * SETTLE_WIRE.WORD_BYTES) * 2;
      const payload = (encoded.slice(0, at) +
        "00".repeat(SETTLE_WIRE.WORD_BYTES) +
        encoded.slice(at + SETTLE_WIRE.WORD_BYTES * 2)) as Hex;
      await mintTo(FLOOR_TOKEN, sauce.pot, 3_333n);
      const held = await balanceOf(FLOOR_TOKEN, sauce.pot);

      expect(await sendTo(sauce.pot, sauce.cookData(payload))).toBe("reverted");
      expect(await balanceOf(FLOOR_TOKEN, sauce.pot)).toBe(held);

      // Control: the untouched payload sweeps the same balance, so the revert above was the refusal.
      expect(await sendTo(sauce.pot, sauce.cookData(encoded))).toBe("success");
      expect(await balanceOf(FLOOR_TOKEN, sauce.pot)).toBe(0n);
    }, 60_000);
  });

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

        await mintTo(token, sauce.pot, 4_242n);
        const before = await balanceOf(token, recipient);
        expect(await sendTo(sauce.pot, sauce.cookData(settlePayload(trap.args)))).toBe("success");
        expect((await balanceOf(token, recipient)) - before).toBe(4_242n);
      }, 60_000);
    }
  });
});

/**
 * Signed cooks EXECUTED on a local anvil, against the released Pot: the stack deployed from creation
 * code at its release addresses (`gated-engine.ts`), nothing forked. Every cook is built by the
 * SDK's helpers in `src/evm/engine.ts`, signed by a viem local account, and submitted by an account
 * that is not the Pot's owner.
 *
 *   1. It runs: a program moves an ERC-20 and native coin out of the Pot and tips `ctx.msgSender()`,
 *      the submitter; the Pot emits `SignedCook`, answers the engine's output raw, and the nonce is
 *      spent.
 *   2. The Kitchen's fee: paid by the Pot, out of its balance with the submitter's value in it, never
 *      above the signed ceiling (`FeeNotPaid`).
 *   3. Each refusal, decoded with the Pot's ABI and leaving the nonce unused: `BadSignature` (another
 *      key, another `msg.value`, a non-canonical signature), `Expired` (the deadline itself still
 *      runs), `NonceUsed`, `WrongSubmitter`.
 *   4. Cancelling: `invalidateNonces` from the owner, `NotOwner` for anyone else.
 *   5. `checkSignedCookPot`: the release's Private Pots (fixed Router or not) take signed cooks; no
 *      code, not a Pot, a Shared Pot, and a Pot minted before signed cooks do not. The old Pot is
 *      kitchen-evm 1.2.0's released creation code (`fixtures/pot-kitchen-evm-1.2.0.json`, pinned by
 *      its hash in `releases.json`), minted by `fixtures/OldPotDeployer.sol`, which answers the
 *      callbacks that Pot's constructor makes.
 *   6. An ERC-1271 owner (`fixtures/Wallet1271.sol`): the Pot asks it, and so does
 *      `verifySignedCook` with a client. `fixtures/Wallet1271Raw.sol` answers raw bytes, so both
 *      are held to one reading of the answer: the magic word first, whatever follows ignored.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concat,
  createPublicClient,
  createTestClient,
  BaseError,
  createWalletClient,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  hexToBigInt,
  http,
  keccak256,
  numberToHex,
  parseAbi,
  parseEventLogs,
  slice,
  toFunctionSelector,
  toHex,
} from "viem";
import type { Abi, Address, Hex, PrivateKeyAccount, TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { V12_RELEASE_SETS } from "../../src/deployments/releases.js";
import {
  checkSignedCookPot,
  cookNonceAt,
  cookNonceMasks,
  cookNonceUsed,
  cookNonceWordBit,
  encodeCookSigned,
  encodeInvalidateNonces,
  randomCookNonce,
  signedCookTypedData,
  v12KitchenAbi,
  v12PotAbi,
  verifySignedCook,
  type SignedCookCall,
  type SignedCookExecution,
} from "../../src/evm/engine.js";
import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { startGatedEngine, type GatedEngine } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Sync engine artifacts" step in .github/workflows/ci.yml.',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const MOCK_ERC20 = json<{ creationCode: Hex }>(join(HERE, "../std/token/fixtures/MockERC20.json"));
const OLD_POT = json<{ version: string; commit: string; abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/pot-kitchen-evm-1.2.0.json"),
);
const OLD_POT_DEPLOYER = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/OldPotDeployer.json"),
);
const WALLET_1271 = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/Wallet1271.json"));
const WALLET_1271_RAW = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/Wallet1271Raw.json"),
);
/** ERC-1271's magic value as a whole word: the selector, then 28 zero bytes. */
const MAGIC_WORD = `0x1626ba7e${"00".repeat(28)}` as Hex;

/** Anvil's dev accounts. The first deploys the stack, owns the Kitchen and owns the harness Pot. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** Submits the owner's signed cooks: a relayer, a bundler, anyone. */
const SUBMITTER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
/** Neither owner nor named submitter. */
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
/** The key behind the ERC-1271 wallet: never itself a Pot's owner. */
const WALLET_SIGNER = privateKeyToAccount(
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
);
/** Receives what the programs send; never signs. */
const RECIPIENT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const FAR_DEADLINE = 4_000_000_000n;
const FEE = 10n ** 9n;

/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 10_000_000n;

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
]);

let anvil: ChildProcess;
let sauce: GatedEngine;
let chainId: number;
/** `main(): Uint256 { return 42 }`: a program whose only effect is its answer. */
let returns42: Hex;

const send = async (
  from: PrivateKeyAccount,
  to: Address,
  data: Hex,
  value = 0n,
): Promise<TransactionReceipt> => {
  const hash = await walletClient.sendTransaction({
    account: from,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to,
    value,
  });

  return publicClient.waitForTransactionReceipt({ hash });
};

const deploy = async (creationCode: Hex): Promise<Address> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data: creationCode,
    gas: GAS_LIMIT,
  });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
  if (!contractAddress) throw new Error("a deployment produced no contract address");

  return getAddress(contractAddress);
};

/** The revert data an `eth_call` from `from` comes back with, or undefined when it succeeds. */
const revertOf = async (
  from: Address,
  to: Address,
  data: Hex,
  value = 0n,
): Promise<Hex | undefined> => {
  try {
    await publicClient.call({ account: from, data, gas: GAS_LIMIT, to, value });
    return undefined;
  } catch (error) {
    const revertData = (e: unknown): Hex | undefined =>
      typeof e === "object" && e !== null && "data" in e && typeof e.data === "string"
        ? (e.data as Hex)
        : undefined;
    const found =
      error instanceof BaseError ? error.walk((e) => revertData(e) !== undefined) : null;

    return revertData(found) ?? "0x";
  }
};

/** A cook on the harness Pot that returns 42, with whatever the test changes. */
const cookOf = (patch: Partial<SignedCookExecution> = {}): SignedCookExecution => ({
  chainId,
  pot: sauce.pot,
  engine: sauce.engine,
  program: returns42,
  maxExecutionFee: 0n,
  nonce: randomCookNonce(),
  deadline: FAR_DEADLINE,
  ...patch,
});

const signedBy = async (
  account: PrivateKeyAccount,
  cook: SignedCookExecution,
): Promise<SignedCookCall> => ({
  ...cook,
  signature: await account.signTypedData(signedCookTypedData(cook)),
});

/** Submits `call` from `from` with the signed value, or `value` when given. */
const submit = (
  from: PrivateKeyAccount,
  call: SignedCookCall,
  value?: bigint,
): Promise<TransactionReceipt> => {
  const tx = encodeCookSigned(call);

  return send(from, tx.to, tx.data, value ?? tx.value);
};

/**
 * The Pot refuses `call` from `from` with `errorName` (and `args`, when given): the error decoded
 * from an `eth_call` with the Pot's ABI, the sent transaction reverted, and the nonce still unused.
 */
const expectRefused = async (
  from: PrivateKeyAccount,
  call: SignedCookCall,
  errorName: string,
  options: { args?: readonly unknown[]; value?: bigint } = {},
): Promise<void> => {
  const tx = encodeCookSigned(call);
  const value = options.value ?? tx.value;
  const data = await revertOf(from.address, tx.to, tx.data, value);
  expect(data).toBeDefined();
  const decoded = decodeErrorResult({ abi: v12PotAbi, data: data! });
  expect(decoded.errorName).toBe(errorName);
  if (options.args !== undefined) expect(decoded.args).toEqual(options.args);
  expect((await send(from, tx.to, tx.data, value)).status).toBe("reverted");
  expect(await cookNonceUsed(publicClient, call.pot, call.nonce)).toBe(false);
};

const latestTimestamp = async (): Promise<bigint> => (await publicClient.getBlock()).timestamp;

const balance = (address: Address): Promise<bigint> => publicClient.getBalance({ address });

const gasPaid = (receipt: TransactionReceipt): bigint =>
  receipt.gasUsed * receipt.effectiveGasPrice;

const setFee = async (fee: bigint): Promise<void> => {
  const receipt = await send(
    OWNER,
    sauce.kitchen,
    encodeFunctionData({ abi: v12KitchenAbi, functionName: "setExecutionFee", args: [fee] }),
  );
  expect(receipt.status).toBe("success");
};

/** Mints the owner's Private Pot under `salt` (fixed Router or not), and returns its address. */
const mintPot = async (owner: Address, salt: Hex, routerFixed = false): Promise<Address> => {
  const receipt = await send(
    OWNER,
    sauce.kitchen,
    encodeFunctionData({
      abi: v12KitchenAbi,
      functionName: "deployPot",
      args: [owner, salt, routerFixed],
    }),
  );
  expect(receipt.status).toBe("success");

  return publicClient.readContract({
    abi: v12KitchenAbi,
    address: sauce.kitchen,
    functionName: "predictPot",
    args: [owner, salt, routerFixed],
  });
};

const salt = (n: number): Hex => numberToHex(n, { size: 32 });

describeEvm("signed cooks on the released Pot", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      creationCode,
    );
    chainId = await publicClient.getChainId();
    returns42 = toHex(
      compileSauceProgram("ethereum", "function main(): Uint256 { return 42; }").bytecode,
    );
  }, 120_000);

  afterAll(async () => {
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  describe("a signed cook runs, for anyone, as the owner's own cook would", () => {
    it("moves the Pot's tokens and coin, tips the submitter, and spends the nonce", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      await send(
        OWNER,
        token,
        encodeFunctionData({ abi: erc20, functionName: "mint", args: [sauce.pot, 1_000n] }),
      );
      await testClient.setBalance({ address: sauce.pot, value: 10n ** 18n });

      const compiled = compileSauceProgram(
        "ethereum",
        [
          "function main(token: Address, recipient: Address, amount: Uint256, sent: Uint256, tip: Uint256): void {",
          "  transfer(token, recipient, amount);",
          "  evm.call(recipient, sent, hex``);",
          "  evm.call(ctx.msgSender(), tip, hex``);",
          "}",
        ].join("\n"),
      );
      const sent = 3n * 10n ** 15n;
      const tip = 10n ** 16n;
      // The program the owner signs is the bytecode with main's arguments appended: all of it.
      const program = concat([
        toHex(compiled.bytecode),
        toHex(encodeEntryArguments(compiled, [token, RECIPIENT, 250n, sent, tip])),
      ]);
      const call = await signedBy(OWNER, cookOf({ program }));
      expect(await verifySignedCook({ ...call, owner: OWNER.address }, publicClient)).toBe(true);
      expect(await cookNonceUsed(publicClient, sauce.pot, call.nonce)).toBe(false);

      const before = {
        pot: await balance(sauce.pot),
        recipient: await balance(RECIPIENT),
        submitter: await balance(SUBMITTER.address),
      };
      const receipt = await submit(SUBMITTER, call);
      expect(receipt.status).toBe("success");

      const [signedCook, ...others] = parseEventLogs({
        abi: v12PotAbi,
        eventName: "SignedCook",
        logs: receipt.logs,
      });
      expect(others).toEqual([]);
      expect(signedCook!.address).toBe(sauce.pot.toLowerCase());
      expect(signedCook!.args).toEqual({ nonce: call.nonce, submitter: SUBMITTER.address });

      expect(
        await publicClient.readContract({
          abi: erc20,
          address: token,
          functionName: "balanceOf",
          args: [RECIPIENT],
        }),
      ).toBe(250n);
      expect(await balance(sauce.pot)).toBe(before.pot - sent - tip);
      expect(await balance(RECIPIENT)).toBe(before.recipient + sent);
      // The submitter sent no value and was paid the tip: it is out only its gas.
      expect(await balance(SUBMITTER.address)).toBe(before.submitter + tip - gasPaid(receipt));
      expect(await cookNonceUsed(publicClient, sauce.pot, call.nonce)).toBe(true);
    });

    it("answers the engine's output raw", async () => {
      const call = await signedBy(OWNER, cookOf());
      const tx = encodeCookSigned(call);
      const { data } = await publicClient.call({
        account: STRANGER.address,
        data: tx.data,
        gas: GAS_LIMIT,
        to: tx.to,
      });
      expect(data).toBe(numberToHex(42n, { size: 32 }));
    });

    it("runs a signed value through, as msg.value", async () => {
      const compiled = compileSauceProgram(
        "ethereum",
        "function main(): Uint256 { return ctx.msgValue(); }",
      );
      const call = await signedBy(OWNER, cookOf({ program: toHex(compiled.bytecode), value: 7n }));
      const tx = encodeCookSigned(call);
      expect(tx.value).toBe(7n);
      const { data } = await publicClient.call({
        account: SUBMITTER.address,
        data: tx.data,
        gas: GAS_LIMIT,
        to: tx.to,
        value: tx.value,
      });
      expect(data).toBe(numberToHex(7n, { size: 32 }));
      const pot = await balance(sauce.pot);
      expect((await submit(SUBMITTER, call)).status).toBe("success");
      expect(await balance(sauce.pot)).toBe(pot + 7n);
    });

    it("runs on a Private Pot whose Router is fixed", async () => {
      const pinned = await mintPot(OWNER.address, salt(20), true);
      expect(await checkSignedCookPot(publicClient, pinned)).toEqual({
        ok: true,
        owner: OWNER.address,
      });
      const call = await signedBy(OWNER, cookOf({ pot: pinned }));
      expect((await submit(STRANGER, call)).status).toBe("success");
      expect(await cookNonceUsed(publicClient, pinned, call.nonce)).toBe(true);
    });
  });

  describe("the Kitchen's fee is the Pot's", () => {
    afterEach(() => setFee(0n));

    it("comes out of the Pot's balance; the submitter pays only gas", async () => {
      await setFee(FEE);
      const pot = await mintPot(OWNER.address, salt(30));
      await testClient.setBalance({ address: pot, value: 10n ** 18n });
      const call = await signedBy(OWNER, cookOf({ pot, maxExecutionFee: FEE }));

      const before = {
        kitchen: await balance(sauce.kitchen),
        pot: await balance(pot),
        submitter: await balance(SUBMITTER.address),
      };
      const receipt = await submit(SUBMITTER, call);
      expect(receipt.status).toBe("success");
      expect(await balance(sauce.kitchen)).toBe(before.kitchen + FEE);
      expect(await balance(pot)).toBe(before.pot - FEE);
      expect(await balance(SUBMITTER.address)).toBe(before.submitter - gasPaid(receipt));
    });

    it("is refused above the signed ceiling: FeeNotPaid(fee, min(balance, ceiling))", async () => {
      const pot = await mintPot(OWNER.address, salt(31));
      await testClient.setBalance({ address: pot, value: 10n ** 18n });
      const call = await signedBy(OWNER, cookOf({ pot, maxExecutionFee: FEE }));
      // The Kitchen's owner raises the fee after the owner signed.
      await setFee(FEE + 1n);
      await expectRefused(SUBMITTER, call, "FeeNotPaid", { args: [FEE + 1n, FEE] });

      // Back at the ceiling, the same signature runs.
      await setFee(FEE);
      expect((await submit(SUBMITTER, call)).status).toBe("success");
    });

    it("is refused from an empty Pot, unless the signed value brings it", async () => {
      await setFee(FEE);
      const pot = await mintPot(OWNER.address, salt(32));
      expect(await balance(pot)).toBe(0n);

      const unfunded = await signedBy(OWNER, cookOf({ pot, maxExecutionFee: 10n ** 18n }));
      await expectRefused(SUBMITTER, unfunded, "FeeNotPaid", { args: [FEE, 0n] });

      const funded = await signedBy(
        OWNER,
        cookOf({ pot, maxExecutionFee: 10n ** 18n, value: FEE }),
      );
      const before = {
        kitchen: await balance(sauce.kitchen),
        submitter: await balance(SUBMITTER.address),
      };
      const receipt = await submit(SUBMITTER, funded);
      expect(receipt.status).toBe("success");
      expect(await balance(sauce.kitchen)).toBe(before.kitchen + FEE);
      expect(await balance(pot)).toBe(0n);
      expect(await balance(SUBMITTER.address)).toBe(before.submitter - FEE - gasPaid(receipt));
    });
  });

  describe("refusals", () => {
    it("BadSignature: another key signed", async () => {
      await expectRefused(SUBMITTER, await signedBy(STRANGER, cookOf()), "BadSignature");
    });

    it("BadSignature: a msg.value other than the signed value", async () => {
      const call = await signedBy(OWNER, cookOf({ value: 5n }));
      await expectRefused(SUBMITTER, call, "BadSignature", { value: 4n });
      await expectRefused(SUBMITTER, call, "BadSignature", { value: 6n });
      await expectRefused(SUBMITTER, call, "BadSignature", { value: 0n });
      expect((await submit(SUBMITTER, call)).status).toBe("success");
    });

    it("BadSignature: the high-s twin, v of 0 or 1, and the compact form", async () => {
      const call = await signedBy(OWNER, cookOf());
      const r = slice(call.signature, 0, 32);
      const s = hexToBigInt(slice(call.signature, 32, 64));
      const v = hexToBigInt(slice(call.signature, 64, 65));
      const malformed: Hex[] = [
        concat([
          r,
          numberToHex(SECP256K1_N - s, { size: 32 }),
          numberToHex(v === 27n ? 28n : 27n, { size: 1 }),
        ]),
        concat([slice(call.signature, 0, 64), numberToHex(v - 27n, { size: 1 })]),
        concat([r, numberToHex(s | ((v - 27n) << 255n), { size: 32 })]),
      ];
      for (const signature of malformed) {
        expect(await verifySignedCook({ ...call, signature, owner: OWNER.address })).toBe(false);
        await expectRefused(SUBMITTER, { ...call, signature }, "BadSignature");
      }
      expect(await verifySignedCook({ ...call, owner: OWNER.address })).toBe(true);
      expect((await submit(SUBMITTER, call)).status).toBe("success");
    });

    it("Expired: a second past the deadline, while the deadline itself still runs", async () => {
      const deadline = (await latestTimestamp()) + 100n;
      const onTime = await signedBy(OWNER, cookOf({ deadline }));
      const late = await signedBy(OWNER, cookOf({ deadline }));

      await testClient.setNextBlockTimestamp({ timestamp: deadline });
      const receipt = await submit(SUBMITTER, onTime);
      expect(receipt.status).toBe("success");
      expect((await publicClient.getBlock({ blockHash: receipt.blockHash })).timestamp).toBe(
        deadline,
      );

      await testClient.setNextBlockTimestamp({ timestamp: deadline + 1n });
      await testClient.mine({ blocks: 1 });
      expect(await latestTimestamp()).toBe(deadline + 1n);
      await expectRefused(SUBMITTER, late, "Expired");
    });

    it("NonceUsed: a signature runs once", async () => {
      const call = await signedBy(OWNER, cookOf());
      expect((await submit(SUBMITTER, call)).status).toBe("success");
      const tx = encodeCookSigned(call);
      const data = await revertOf(STRANGER.address, tx.to, tx.data);
      expect(decodeErrorResult({ abi: v12PotAbi, data: data! }).errorName).toBe("NonceUsed");
      expect((await submit(STRANGER, call)).status).toBe("reverted");
      expect(await cookNonceUsed(publicClient, sauce.pot, call.nonce)).toBe(true);
    });

    it("NonceUsed: another cook under a spent nonce", async () => {
      const nonce = randomCookNonce();
      const first = await signedBy(OWNER, cookOf({ nonce }));
      expect((await submit(SUBMITTER, first)).status).toBe("success");
      const second = await signedBy(OWNER, cookOf({ nonce, maxExecutionFee: 1n }));
      const tx = encodeCookSigned(second);
      const data = await revertOf(SUBMITTER.address, tx.to, tx.data);
      expect(decodeErrorResult({ abi: v12PotAbi, data: data! }).errorName).toBe("NonceUsed");
    });

    it("WrongSubmitter: a named submitter is the only one", async () => {
      const call = await signedBy(OWNER, cookOf({ submitter: SUBMITTER.address }));
      await expectRefused(STRANGER, call, "WrongSubmitter");
      await expectRefused(OWNER, call, "WrongSubmitter");
      const receipt = await submit(SUBMITTER, call);
      expect(receipt.status).toBe("success");
      expect(
        parseEventLogs({ abi: v12PotAbi, eventName: "SignedCook", logs: receipt.logs })[0]!.args,
      ).toEqual({ nonce: call.nonce, submitter: SUBMITTER.address });
    });

    it("a signature for another Pot of the same owner is BadSignature", async () => {
      const other = await mintPot(OWNER.address, salt(40));
      const forHarness = await signedBy(OWNER, cookOf());
      await expectRefused(SUBMITTER, { ...forHarness, pot: other }, "BadSignature");
    });
  });

  describe("invalidateNonces", () => {
    it("the owner cancels a signed nonce; the signature then never runs", async () => {
      const call = await signedBy(OWNER, cookOf());
      const [{ word, mask }] = cookNonceMasks([call.nonce]) as [{ word: bigint; mask: bigint }];
      expect({ word, mask }).toEqual({
        word: cookNonceWordBit(call.nonce).word,
        mask: cookNonceWordBit(call.nonce).mask,
      });

      const receipt = await send(OWNER, sauce.pot, encodeInvalidateNonces(word, mask));
      expect(receipt.status).toBe("success");
      const [event] = parseEventLogs({
        abi: v12PotAbi,
        eventName: "NoncesInvalidated",
        logs: receipt.logs,
      });
      expect(event!.args).toEqual({ word, mask });
      expect(await cookNonceUsed(publicClient, sauce.pot, call.nonce)).toBe(true);

      const tx = encodeCookSigned(call);
      const data = await revertOf(SUBMITTER.address, tx.to, tx.data);
      expect(decodeErrorResult({ abi: v12PotAbi, data: data! }).errorName).toBe("NonceUsed");
    });

    it("cancels several nonces across words, one call per word", async () => {
      const nonces = [cookNonceAt(900n, 3), cookNonceAt(900n, 200), cookNonceAt(901n, 0)];
      const masks = cookNonceMasks(nonces);
      expect(masks).toEqual([
        { word: 900n, mask: (1n << 3n) | (1n << 200n) },
        { word: 901n, mask: 1n },
      ]);
      for (const { word, mask } of masks) {
        expect((await send(OWNER, sauce.pot, encodeInvalidateNonces(word, mask))).status).toBe(
          "success",
        );
      }
      for (const nonce of nonces) {
        expect(await cookNonceUsed(publicClient, sauce.pot, nonce)).toBe(true);
      }
      expect(await cookNonceUsed(publicClient, sauce.pot, cookNonceAt(900n, 4))).toBe(false);
    });

    it("NotOwner: nobody else cancels", async () => {
      const nonce = randomCookNonce();
      const { word, mask } = cookNonceWordBit(nonce);
      const data = encodeInvalidateNonces(word, mask);
      for (const from of [STRANGER, SUBMITTER]) {
        const refusal = await revertOf(from.address, sauce.pot, data);
        expect(decodeErrorResult({ abi: v12PotAbi, data: refusal! }).errorName).toBe("NotOwner");
        expect((await send(from, sauce.pot, data)).status).toBe("reverted");
      }
      expect(await cookNonceUsed(publicClient, sauce.pot, nonce)).toBe(false);
    });
  });

  describe("checkSignedCookPot", () => {
    it("takes the release's Private Pot, naming its owner", async () => {
      expect(await checkSignedCookPot(publicClient, sauce.pot)).toEqual({
        ok: true,
        owner: OWNER.address,
      });
    });

    it("refuses an address with no code", async () => {
      const check = await checkSignedCookPot(publicClient, RECIPIENT);
      expect(check.ok).toBe(false);
      expect(!check.ok && check.reason).toMatch(/has no code/);
    });

    it("refuses a contract that is not a Pot", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      const check = await checkSignedCookPot(publicClient, token);
      expect(check.ok).toBe(false);
      expect(!check.ok && check.reason).toMatch(/it is not a Pot/);
    });

    it("refuses a Shared Pot, which refuses every signed cook and every cancellation", async () => {
      const sharedSalt = salt(50);
      expect(
        (
          await send(
            OWNER,
            sauce.kitchen,
            encodeFunctionData({
              abi: v12KitchenAbi,
              functionName: "deploySharedPot",
              args: [sharedSalt],
            }),
          )
        ).status,
      ).toBe("success");
      const shared = await publicClient.readContract({
        abi: v12KitchenAbi,
        address: sauce.kitchen,
        functionName: "predictSharedPot",
        args: [sharedSalt],
      });
      const check = await checkSignedCookPot(publicClient, shared);
      expect(check.ok).toBe(false);
      expect(!check.ok && check.reason).toMatch(/Shared Pot/);

      await expectRefused(SUBMITTER, await signedBy(OWNER, cookOf({ pot: shared })), "NotOwner");
      const refusal = await revertOf(OWNER.address, shared, encodeInvalidateNonces(0n, 1n));
      expect(decodeErrorResult({ abi: v12PotAbi, data: refusal! }).errorName).toBe("NotOwner");
    });
  });

  describe("a Pot minted before signed cooks", () => {
    const OLD_SALT = salt(60);
    let oldPot: Address;
    let deployer: Address;

    beforeAll(async () => {
      deployer = await deploy(
        concat([
          OLD_POT_DEPLOYER.creationCode,
          encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [sauce.router, 0n]),
        ]),
      );
      const receipt = await send(
        OWNER,
        deployer,
        encodeFunctionData({
          abi: OLD_POT_DEPLOYER.abi,
          functionName: "deploy",
          args: [OLD_POT.creationCode, OWNER.address, OLD_SALT],
        }),
      );
      expect(receipt.status).toBe("success");
      oldPot = getCreate2Address({
        bytecodeHash: keccak256(OLD_POT.creationCode),
        from: deployer,
        salt: keccak256(
          encodeAbiParameters(
            [{ type: "address" }, { type: "bytes32" }],
            [OWNER.address, OLD_SALT],
          ),
        ),
      });
    });

    it("is kitchen-evm 1.2.0's released Pot, by the hash releases.json pins", () => {
      const row = V12_RELEASE_SETS.find((set) => set.compiler === "2.5.0");
      expect(row?.["kitchen-evm"].version).toBe(OLD_POT.version);
      expect(keccak256(OLD_POT.creationCode)).toBe(row!["kitchen-evm"].potInitCodeHash);
      expect(
        OLD_POT.abi.some((item) => item.type === "function" && item.name === "cookSigned"),
      ).toBe(false);
    });

    it("was constructed through its Kitchen's callbacks", async () => {
      const read = (functionName: "owner" | "kitchen" | "router") =>
        publicClient.readContract({ abi: v12PotAbi, address: oldPot, functionName });
      expect(await read("owner")).toBe(OWNER.address);
      expect(await read("kitchen")).toBe(getAddress(deployer));
      expect(await read("router")).toBe(getAddress(sauce.router));
    });

    it("has no cookSigned in its runtime, where the release's Pot does", async () => {
      const cookSigned = toFunctionSelector(
        "cookSigned(address,bytes,uint256,uint256,uint256,address,bytes)",
      ).slice(2);
      const invalidateNonces = toFunctionSelector("invalidateNonces(uint256,uint256)").slice(2);
      const current = (await publicClient.getCode({ address: sauce.pot }))!.toLowerCase();
      const old = (await publicClient.getCode({ address: oldPot }))!.toLowerCase();
      expect(current).toContain(cookSigned);
      expect(current).toContain(invalidateNonces);
      expect(old).not.toContain(cookSigned);
      expect(old).not.toContain(invalidateNonces);
    });

    it("reverts a signed cook: the call falls through to its Router", async () => {
      const call = await signedBy(OWNER, cookOf({ pot: oldPot }));
      const tx = encodeCookSigned(call);
      expect(await revertOf(SUBMITTER.address, tx.to, tx.data)).toBe("0x");
      expect((await submit(SUBMITTER, call)).status).toBe("reverted");
    });

    it("is refused by checkSignedCookPot as minted before signed cooks", async () => {
      const check = await checkSignedCookPot(publicClient, oldPot);
      expect(check.ok).toBe(false);
      expect(!check.ok && check.reason).toMatch(/minted before signed cooks/);
    });
  });

  describe("an ERC-1271 owner", () => {
    let wallet: Address;
    let pot: Address;

    beforeAll(async () => {
      wallet = await deploy(
        concat([
          WALLET_1271.creationCode,
          encodeAbiParameters([{ type: "address" }], [WALLET_SIGNER.address]),
        ]),
      );
      pot = await mintPot(wallet, salt(70));
    });

    it("signs through isValidSignature, which the Pot and verifySignedCook both ask", async () => {
      expect(await checkSignedCookPot(publicClient, pot)).toEqual({ ok: true, owner: wallet });
      const call = await signedBy(WALLET_SIGNER, cookOf({ pot }));
      // The key is not the owner: only a client that can ask the wallet accepts it.
      expect(await verifySignedCook({ ...call, owner: wallet })).toBe(false);
      expect(await verifySignedCook({ ...call, owner: wallet }, publicClient)).toBe(true);

      const receipt = await submit(SUBMITTER, call);
      expect(receipt.status).toBe("success");
      expect(await cookNonceUsed(publicClient, pot, call.nonce)).toBe(true);
    });

    it("refuses a key the wallet does not answer for", async () => {
      const call = await signedBy(STRANGER, cookOf({ pot }));
      expect(await verifySignedCook({ ...call, owner: wallet }, publicClient)).toBe(false);
      await expectRefused(SUBMITTER, call, "BadSignature");
    });
  });

  describe("an ERC-1271 owner's answer, read as the Pot reads it", () => {
    /** A Pot owned by a wallet whose `isValidSignature` returns `answer` verbatim to its key. */
    const potAnswering = async (
      answer: Hex,
      n: number,
    ): Promise<{ wallet: Address; pot: Address }> => {
      const wallet = await deploy(
        concat([
          WALLET_1271_RAW.creationCode,
          encodeAbiParameters(
            [{ type: "address" }, { type: "bytes" }],
            [WALLET_SIGNER.address, answer],
          ),
        ]),
      );

      return { wallet, pot: await mintPot(wallet, salt(n)) };
    };

    it("takes the magic word with bytes after it: the Pot reads only the first word", async () => {
      const { wallet, pot } = await potAnswering(concat([MAGIC_WORD, `0x${"ab".repeat(32)}`]), 80);
      const call = await signedBy(WALLET_SIGNER, cookOf({ pot }));
      expect(await verifySignedCook({ ...call, owner: wallet }, publicClient)).toBe(true);

      const receipt = await submit(SUBMITTER, call);
      expect(receipt.status).toBe("success");
      expect(await cookNonceUsed(publicClient, pot, call.nonce)).toBe(true);
    });

    it("refuses the selector with non-zero padding, as the Pot does", async () => {
      const padded = `0x1626ba7e${"00".repeat(27)}01` as Hex;
      const { wallet, pot } = await potAnswering(padded, 81);
      const call = await signedBy(WALLET_SIGNER, cookOf({ pot }));
      expect(await verifySignedCook({ ...call, owner: wallet }, publicClient)).toBe(false);
      await expectRefused(SUBMITTER, call, "BadSignature");
      expect(await cookNonceUsed(publicClient, pot, call.nonce)).toBe(false);
    });

    it("refuses fewer than 32 bytes, as the Pot does", async () => {
      const { wallet, pot } = await potAnswering("0x1626ba7e", 82);
      const call = await signedBy(WALLET_SIGNER, cookOf({ pot }));
      expect(await verifySignedCook({ ...call, owner: wallet }, publicClient)).toBe(false);
      await expectRefused(SUBMITTER, call, "BadSignature");
    });
  });
});

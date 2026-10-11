/**
 * `@sauce/signed` EXECUTED: a program a Private Pot's owner signs, submitted by anyone, run as the
 * Pot, on an anvil running the gated engine and Kitchen with v12 #571's Router, whose fallback runs
 * the handler a Pot registered for a selector.
 *
 * The owner cooks the program the SDK writes to install the package's handlers
 * (`routes/handlers.ts`): `execute`, `executeAcross` and the view `isValidSignature`. Then a
 * stranger submits what the owner signed with the SDK's typed data (`routes/signed.ts`), and the
 * Pot runs it in the handler's own cook. Refused: another signer, another chain, another Pot, a
 * passed deadline, a salt used or cancelled, a malleable signature, a signature that recovers no
 * key, and a program or arguments changed after signing. A contract wallet owner signs through
 * EIP-1271 with a signature of its own length. The Pot answers EIP-1271 itself, so canonical Permit2
 * takes it as a signer, with a signature bound to it, and refuses the owner's own. A hop's body,
 * cooked on a Shared Pot, delivers tokens to the Private Pot and submits the owner's program in the
 * same transaction. A Shared Pot and a Pot whose Router is fixed refuse the install.
 *
 * And what each path costs, whole transactions, beside `fixtures/SignedReference.sol`: the same
 * verification written in Solidity, cooking the same program on a Pot it owns.
 *
 * GATED twice, as `@sauce/async`'s suite: on SAUCE_V12_RUNTIME_CREATION_HEX, and on
 * SAUCE_V12_ROUTER_CREATION_HEX, a file of #571's Router creation code, which no release publishes
 * yet, so the suite skips in CI until a kitchen-evm release carries the handlers.
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
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toFunctionSelector,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { Base } from "../../../src/index.js";
import { handlersInstallSource, packageHandlers } from "../../../src/routes/handlers.js";
import { potMessageTypedData } from "../../../src/routes/erc1271.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  cancelSaltsSource,
  encodeExecute,
  encodeExecuteAcross,
  executeAcrossTypedData,
  executeTypedData,
  signedProgram,
  signedSaltSlot,
  type SignedExecution,
} from "../../../src/routes/signed.js";
import { freePortSync, spawnAnvil } from "../../anvil-process.js";
import { routerUnderTest, startGatedEngine, type GatedEngine } from "../../evm/gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const ROUTER = routerUnderTest();
const describeSigned = RUNTIME_HEX_PATH && ROUTER !== undefined ? describe : describe.skip;

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE = JSON.parse(
  readFileSync(join(HERE, "fixtures", "SignedReference.json"), "utf8"),
) as Record<"SignedReference" | "TwoOfTwoWallet", { abi: Abi; creationCode: Hex }>;
const TOKEN = JSON.parse(
  readFileSync(join(HERE, "..", "..", "fixtures", "cli", "PoolsToken.json"), "utf8"),
) as { abi: Abi; creationCode: Hex };
/** The sauce-signed skill's examples and its hop, which this suite runs as a reader would. */
const SKILL_EXAMPLES = join(HERE, "../../../../skills/sauce-signed/examples");
const SKILL = dirname(SKILL_EXAMPLES);
const skillExample = (name: string): string =>
  readFileSync(join(SKILL_EXAMPLES, `${name}.sauce.ts`), "utf8");
const PERMIT2 = JSON.parse(
  readFileSync(join(HERE, "..", "..", "fixtures", "cli", "Permit2.json"), "utf8"),
) as { address: Address; runtime: Hex };

/** Anvil's first dev account: the Kitchen's owner and the Pot's. The others sign or call as
 *  strangers, and own the contract wallet. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const WALLET_FIRST = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const WALLET_SECOND = privateKeyToAccount(
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
);

const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
/** Non-zero, so a cook provably pays it, and a submission's single fee can be counted. */
const FEE = 1_234n;
const CHAIN = "base";
const CHAIN_ID = 8453;
/** secp256k1's order: `n - s` is a signature's malleable twin. */
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** The Pot storage slot the signed program writes. */
const WRITTEN_SLOT = keccak256(toHex("signed.written"));
const CANCELLED = keccak256(toHex("SaltsCancelled(uint256,uint256)"));

const potAbi = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
const kitchenAbi = parseAbi([
  "function setExecutionFee(uint256 fee)",
  "function deploySharedPot(bytes32 salt) returns (address)",
  "function predictSharedPot(bytes32 salt) view returns (address)",
  "function deployPot(address owner, bytes32 salt, bool routerFixed) returns (address)",
  "function predictPot(address owner, bytes32 salt, bool routerFixed) view returns (address)",
]);
const permit2Abi = parseAbi([
  "function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)",
]);

const word = (value: bigint): Hex => toHex(value, { size: 32 });
const saltOf = (value: bigint): Hex => word(value);

/** The program a signature runs: writes `value` to a slot of the Pot and returns it. */
const WRITER = `function main(value: Uint256): Uint256 {
  evm.sstore(${WRITTEN_SLOT}, value);
  return value;
}`;
/** The trivial program the costs are measured with. */
const TRIVIAL = `function main(): Uint256 {
  return 7;
}`;

let anvil: ChildProcess;
let publicClient: PublicClient;
let stack: GatedEngine;
/** The program installing `@sauce/signed` on a Pot, as the SDK writes it. */
let install: Hex;

const owner = createWalletClient({ account: OWNER, transport: http(RPC_URL) });
const stranger = createWalletClient({ account: STRANGER, transport: http(RPC_URL) });
const walletFirst = createWalletClient({ account: WALLET_FIRST, transport: http(RPC_URL) });

/** Sends a transaction and answers whether it succeeded and what it cost; a revert is an answer,
 *  not a throw. */
async function send(
  from: typeof owner,
  to: Address | undefined,
  data: Hex,
  value = 0n,
): Promise<{ ok: boolean; hash: Hex; gas: bigint; created?: Address }> {
  const hash = await from.sendTransaction({
    account: from.account,
    chain: null,
    ...(to === undefined ? {} : { to }),
    data,
    value,
    gas: 15_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    ok: receipt.status === "success",
    hash,
    gas: receipt.gasUsed,
    ...(receipt.contractAddress ? { created: receipt.contractAddress } : {}),
  };
}

/** `source` with `args` for its `main`, compiled by the SDK for the chain: the bytes a signature
 *  covers. */
const compiled = (source: string, args: readonly (bigint | Hex)[] = []): Hex =>
  signedProgram(compileSauceProgram(CHAIN, source), args);

const cookData = (program: Hex): Hex =>
  encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] });

/** Cooks `program` on `pot` as its owner, paying the fee. */
const cook = (program: Hex, pot: Address = stack.pot) => send(owner, pot, cookData(program), FEE);

/** The result of a call, or its revert as text: a program's `require(cond, message)` reverts with
 *  the message's bytes as they are, which the handler's cook passes on. */
async function callOf(
  from: Address,
  to: Address,
  data: Hex,
  value = 0n,
): Promise<{ ok: true; result: Hex } | { ok: false; data: Hex; reason: string }> {
  const response = (await (
    await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ from, to, data, value: toHex(value), gas: toHex(15_000_000n) }, "latest"],
      }),
    })
  ).json()) as { result?: Hex; error?: { data?: Hex } };
  if (response.error === undefined) return { ok: true, result: response.result ?? "0x" };
  const reverted = response.error.data ?? "0x";

  return { ok: false, data: reverted, reason: Buffer.from(reverted.slice(2), "hex").toString() };
}

const reasonOf = async (data: Hex, to: Address = stack.pot): Promise<string> => {
  const outcome = await callOf(STRANGER.address, to, data);
  if (outcome.ok) throw new Error("the call did not revert");
  return outcome.reason;
};

/** The block's time, the base every deadline is set from. */
const now = async (): Promise<bigint> => (await publicClient.getBlock()).timestamp;

let saltCounter = 0x5a1700n;
/** A salt in a word no other test uses. */
const freshSalt = (): Hex => saltOf((saltCounter += 256n));

/** `execution`, signed by `signer` as the SDK's typed data says. */
const signExecute = (execution: SignedExecution, signer: PrivateKeyAccount = OWNER): Promise<Hex> =>
  signer.signTypedData(executeTypedData(execution));

/** An execution of `program` on the harness Pot, an hour to run. */
async function executionOf(program: Hex, salt: Hex = freshSalt()): Promise<SignedExecution> {
  return { pot: stack.pot, chainId: CHAIN_ID, program, salt, deadline: (await now()) + 3_600n };
}

const slot = async (at: Hex, address: Address = stack.pot): Promise<bigint> =>
  BigInt((await publicClient.getStorageAt({ address, slot: at })) ?? "0x0");

/** Whether the Pot recorded `salt` as used. */
async function used(salt: Hex, pot: Address = stack.pot): Promise<boolean> {
  const { slot: at, bit } = signedSaltSlot(salt);
  return ((await slot(at, pot)) & bit) !== 0n;
}

/** Splits a 65-byte signature into `r`, `s` and `v`. */
const parts = (signature: Hex) => ({
  r: BigInt(`0x${signature.slice(2, 66)}`),
  s: BigInt(`0x${signature.slice(66, 130)}`),
  v: Number.parseInt(signature.slice(130, 132), 16),
});
const join65 = (r: bigint, s: bigint, v: number): Hex =>
  concat([word(r), word(s), toHex(v, { size: 1 })]);

/** A Private Pot `who` owns, its Router not fixed, minted and funded for its fees. */
async function mintPot(who: Address, salt: Hex, routerFixed = false): Promise<Address> {
  expect(
    (
      await send(
        owner,
        stack.kitchen,
        encodeFunctionData({
          abi: kitchenAbi,
          functionName: "deployPot",
          args: [who, salt, routerFixed],
        }),
      )
    ).ok,
  ).toBe(true);
  const pot = (await publicClient.readContract({
    address: stack.kitchen,
    abi: kitchenAbi,
    functionName: "predictPot",
    args: [who, salt, routerFixed],
  })) as Address;
  await createTestClient({ mode: "anvil", transport: http(RPC_URL) }).setBalance({
    address: pot,
    value: parseEther("1"),
  });

  return pot;
}

describeSigned("@sauce/signed on the EVM, through the Router's handlers", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT, ["--chain-id", String(CHAIN_ID)]);
    const transport = http(RPC_URL);
    publicClient = createPublicClient({ transport });
    const testClient = createTestClient({ mode: "anvil", transport });
    stack = await startGatedEngine(
      { publicClient, walletClient: owner, testClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
      { routerCreationCode: ROUTER },
    );
    const setFee = encodeFunctionData({
      abi: kitchenAbi,
      functionName: "setExecutionFee",
      args: [FEE],
    });
    expect((await send(owner, stack.kitchen, setFee)).ok).toBe(true);
    // The Router pays a handler's fee from the Pot's balance.
    await testClient.setBalance({ address: stack.pot, value: parseEther("1") });
    await testClient.setBalance({ address: WALLET_FIRST.address, value: parseEther("10") });
    await testClient.setCode({ address: PERMIT2.address, bytecode: PERMIT2.runtime });

    const handlers = packageHandlers(CHAIN, "@sauce/signed");
    expect(handlers.map(({ signature }) => signature)).toEqual([
      "execute(bytes,bytes32,uint256,bytes)",
      "executeAcross(bytes,bytes32,uint256,bytes32[],uint256,bytes)",
      "isValidSignature(bytes32,bytes)",
    ]);
    install = compiled(handlersInstallSource(handlers, "@sauce/signed"));
    const installed = await cook(install);
    expect(installed.ok).toBe(true);
    costs.set("install @sauce/signed: three handlers, one cook", installed.gas);
  }, 120_000);

  afterAll(async () => {
    if (anvil !== undefined && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  /** Measured whole transactions, printed when the suite ends. */
  const costs = new Map<string, bigint>();
  afterAll(() => {
    if (costs.size > 0) {
      console.log(
        [...costs].map(([what, gas]) => `${gas.toString().padStart(9)}  ${what}`).join("\n"),
      );
    }
  });

  describe("execute", () => {
    it("runs the owner's program for anyone, once, for one fee, and answers what it returns", async () => {
      const execution = await executionOf(compiled(WRITER, [41n]));
      const data = encodeExecute({ ...execution, signature: await signExecute(execution) });

      const answer = await callOf(STRANGER.address, stack.pot, data);
      expect(answer).toEqual({ ok: true, result: word(41n) });

      const potBefore = await publicClient.getBalance({ address: stack.pot });
      const { ok } = await send(stranger, stack.pot, data);
      expect(ok).toBe(true);
      expect(await slot(WRITTEN_SLOT)).toBe(41n);
      expect(await used(execution.salt)).toBe(true);
      expect(potBefore - (await publicClient.getBalance({ address: stack.pot }))).toBe(FEE);

      // The same signature again: its salt is used.
      expect(await reasonOf(data)).toBe("signed: the salt was used or cancelled");
    });

    it("runs salts in any order", async () => {
      const base = BigInt(freshSalt());
      for (const offset of [200n, 3n, 199n]) {
        const execution = await executionOf(compiled(WRITER, [offset]), saltOf(base + offset));
        const signed = encodeExecute({ ...execution, signature: await signExecute(execution) });
        expect((await send(stranger, stack.pot, signed)).ok).toBe(true);
        expect(await slot(WRITTEN_SLOT)).toBe(offset);
      }
    });

    it("refuses a signature by anyone but the Pot's owner", async () => {
      const execution = await executionOf(compiled(WRITER, [1n]));
      const forged = encodeExecute({
        ...execution,
        signature: await signExecute(execution, STRANGER),
      });
      expect(await reasonOf(forged)).toBe("signed: not the owner's signature");
      expect(await used(execution.salt)).toBe(false);
    });

    it("refuses a signature for another chain, and for another Pot", async () => {
      const execution = await executionOf(compiled(WRITER, [2n]));
      const elsewhere = await signExecute({ ...execution, chainId: 1 });
      expect(await reasonOf(encodeExecute({ ...execution, signature: elsewhere }))).toBe(
        "signed: not the owner's signature",
      );
      const otherPot = await signExecute({
        ...execution,
        pot: "0x000000000000000000000000000000000000dEaD",
      });
      expect(await reasonOf(encodeExecute({ ...execution, signature: otherPot }))).toBe(
        "signed: not the owner's signature",
      );
    });

    it("refuses a signature past its deadline", async () => {
      const execution = {
        ...(await executionOf(compiled(WRITER, [3n]))),
        deadline: (await now()) - 1n,
      };
      const late = encodeExecute({ ...execution, signature: await signExecute(execution) });
      expect(await reasonOf(late)).toBe("signed: the deadline has passed");
    });

    it("refuses a program or arguments changed after signing", async () => {
      const execution = await executionOf(compiled(WRITER, [4n]));
      const signature = await signExecute(execution);
      const otherArgs = compiled(WRITER, [5n]);
      expect(await reasonOf(encodeExecute({ ...execution, program: otherArgs, signature }))).toBe(
        "signed: not the owner's signature",
      );
      // One byte of the bytecode itself.
      const flipped = `${execution.program.slice(0, 10)}${(
        Number.parseInt(execution.program.slice(10, 12), 16) ^ 1
      )
        .toString(16)
        .padStart(2, "0")}${execution.program.slice(12)}` as Hex;
      expect(await reasonOf(encodeExecute({ ...execution, program: flipped, signature }))).toBe(
        "signed: not the owner's signature",
      );
      // The salt or the deadline.
      expect(await reasonOf(encodeExecute({ ...execution, salt: freshSalt(), signature }))).toBe(
        "signed: not the owner's signature",
      );
      expect(
        await reasonOf(
          encodeExecute({ ...execution, deadline: execution.deadline + 1n, signature }),
        ),
      ).toBe("signed: not the owner's signature");
    });

    it("refuses the malleable twin of the owner's signature, which ecrecover itself accepts", async () => {
      const execution = await executionOf(compiled(WRITER, [6n]));
      const signature = await signExecute(execution);
      const { r, s, v } = parts(signature);
      const twin = join65(r, ORDER - s, v === 27 ? 28 : 27);
      // The precompile recovers the owner from the twin too: only the check refuses it.
      const digest = hashTypedData(executeTypedData(execution));
      const recovered = await callOf(
        STRANGER.address,
        "0x0000000000000000000000000000000000000001",
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" }],
          [digest, v === 27 ? 28 : 27, r, ORDER - s],
        ),
      );
      expect(recovered).toEqual({
        ok: true,
        result: word(BigInt(OWNER.address)),
      });
      expect(await reasonOf(encodeExecute({ ...execution, signature: twin }))).toBe(
        "signed: not the owner's signature",
      );
      // And the original still runs.
      expect((await send(stranger, stack.pot, encodeExecute({ ...execution, signature }))).ok).toBe(
        true,
      );
    });

    it("refuses a signature that recovers no key, a `v` other than 27 or 28, and a wrong length", async () => {
      const execution = await executionOf(compiled(WRITER, [7n]));
      const signature = await signExecute(execution);
      const { r, s, v } = parts(signature);
      for (const bad of [
        join65(0n, s, v), // r = 0: ecrecover answers nothing
        join65(r, s, v - 27), // v as 0 or 1
        signature.slice(0, 130) as Hex, // 64 bytes
        concat([signature, "0x00"]), // 66 bytes
      ]) {
        expect(await reasonOf(encodeExecute({ ...execution, signature: bad }))).toBe(
          "signed: not the owner's signature",
        );
      }
    });

    it("never runs a salt the owner cancelled, in a program it cooks", async () => {
      const first = await executionOf(compiled(WRITER, [8n]));
      const second = await executionOf(compiled(WRITER, [9n]), saltOf(BigInt(first.salt) + 1n));
      const cancelled = await cook(compiled(cancelSaltsSource([first.salt, second.salt])));
      expect(cancelled.ok).toBe(true);
      const logs = (await publicClient.getTransactionReceipt({ hash: cancelled.hash })).logs.filter(
        (entry) => entry.address.toLowerCase() === stack.pot.toLowerCase(),
      );
      expect(logs.map((entry) => entry.topics)).toContainEqual([
        CANCELLED,
        word(BigInt(first.salt) >> 8n),
      ]);
      for (const execution of [first, second]) {
        expect(await used(execution.salt)).toBe(true);
        expect(
          await reasonOf(encodeExecute({ ...execution, signature: await signExecute(execution) })),
        ).toBe("signed: the salt was used or cancelled");
      }
    });

    it("unsets the salt when the signed program reverts", async () => {
      const failing = `function main(): void { require(false, "not yet"); }`;
      const execution = await executionOf(compiled(failing));
      const data = encodeExecute({ ...execution, signature: await signExecute(execution) });
      expect(await reasonOf(data)).toBe("not yet");
      expect((await send(stranger, stack.pot, data)).ok).toBe(false);
      expect(await used(execution.salt)).toBe(false);
    });
  });

  describe("executeAcross", () => {
    it("runs this chain's execution of one signature over several chains, once", async () => {
      const deadline = (await now()) + 3_600n;
      const here = {
        chainId: CHAIN_ID,
        program: compiled(WRITER, [10n]),
        salt: freshSalt(),
        deadline,
      };
      const there = { chainId: 1, program: compiled(WRITER, [11n]), salt: freshSalt(), deadline };
      const across = { pot: stack.pot, executions: [there, here] };
      const signature = await OWNER.signTypedData(executeAcrossTypedData(across));

      const data = encodeExecuteAcross({ ...across, signature }, CHAIN_ID);
      expect((await send(stranger, stack.pot, data)).ok).toBe(true);
      expect(await slot(WRITTEN_SLOT)).toBe(10n);
      expect(await reasonOf(data)).toBe("signed: the salt was used or cancelled");

      // Ethereum's execution, submitted here, is not this chain's.
      const wrongChain = encodeExecuteAcross({ ...across, signature }, 1);
      expect(await reasonOf(wrongChain)).toBe(
        "signed: the execution at that index is not this chain's",
      );
    });

    it("refuses a list the owner did not sign, and another signer", async () => {
      const deadline = (await now()) + 3_600n;
      const here = {
        chainId: CHAIN_ID,
        program: compiled(WRITER, [12n]),
        salt: freshSalt(),
        deadline,
      };
      const there = { chainId: 1, program: compiled(WRITER, [13n]), salt: freshSalt(), deadline };
      const signed = await OWNER.signTypedData(
        executeAcrossTypedData({ pot: stack.pot, executions: [here, there] }),
      );
      // The same executions in another order, and without Ethereum's.
      for (const executions of [[there, here], [here]]) {
        expect(
          await reasonOf(
            encodeExecuteAcross({ pot: stack.pot, executions, signature: signed }, CHAIN_ID),
          ),
        ).toBe("signed: not the owner's signature");
      }
      const stranger = await STRANGER.signTypedData(
        executeAcrossTypedData({ pot: stack.pot, executions: [here, there] }),
      );
      expect(
        await reasonOf(
          encodeExecuteAcross(
            { pot: stack.pot, executions: [here, there], signature: stranger },
            CHAIN_ID,
          ),
        ),
      ).toBe("signed: not the owner's signature");
    });
  });

  describe("a contract wallet as the Pot's owner", () => {
    let wallet: Address;
    let walletPot: Address;

    beforeAll(async () => {
      const deployed = await send(
        walletFirst,
        undefined,
        concat([
          REFERENCE.TwoOfTwoWallet.creationCode,
          encodeAbiParameters(
            [{ type: "address" }, { type: "address" }],
            [WALLET_FIRST.address, WALLET_SECOND.address],
          ),
        ]),
      );
      wallet = deployed.created!;
      walletPot = await mintPot(wallet, word(0x2a11e7n));
      // The wallet installs the handlers: it is the Pot's owner, so it cooks.
      const installed = await send(
        walletFirst,
        wallet,
        encodeFunctionData({
          abi: REFERENCE.TwoOfTwoWallet.abi,
          functionName: "call",
          args: [walletPot, FEE, cookData(install)],
        }),
        FEE,
      );
      expect(installed.ok).toBe(true);
    });

    /** Both owners' signatures of `digest`, 130 bytes: the wallet's EIP-1271 signature. */
    const bothSign = async (digest: Hex): Promise<Hex> =>
      concat([
        await WALLET_FIRST.sign({ hash: digest }),
        await WALLET_SECOND.sign({ hash: digest }),
      ]);

    it("runs what the wallet signed through EIP-1271, with a signature of the wallet's length", async () => {
      const execution = { ...(await executionOf(compiled(WRITER, [21n]))), pot: walletPot };
      const digest = hashTypedData(executeTypedData(execution));
      const data = encodeExecute({ ...execution, signature: await bothSign(digest) });
      expect((await send(stranger, walletPot, data)).ok).toBe(true);
      expect(await slot(WRITTEN_SLOT, walletPot)).toBe(21n);
    });

    it("refuses what the wallet does not accept: one owner's signature", async () => {
      const execution = { ...(await executionOf(compiled(WRITER, [22n]))), pot: walletPot };
      const digest = hashTypedData(executeTypedData(execution));
      const one = await WALLET_FIRST.sign({ hash: digest });
      expect(await reasonOf(encodeExecute({ ...execution, signature: one }), walletPot)).toBe(
        "signed: not the owner's signature",
      );
    });
  });

  describe("isValidSignature: the Pot as a signer", () => {
    const hash = keccak256(toHex("a message the Pot signs"));
    const isValid = (signature: Hex, pot: Address = stack.pot) =>
      callOf(
        STRANGER.address,
        pot,
        encodeFunctionData({
          abi: potAbi,
          functionName: "isValidSignature",
          args: [hash, signature],
        }),
      );
    const MAGIC = `0x1626ba7e${"0".repeat(56)}`;
    const NOT = `0xffffffff${"0".repeat(56)}`;

    it("answers the magic value for the owner's signature bound to the Pot, and no other", async () => {
      const bound = await OWNER.signTypedData(
        potMessageTypedData({ pot: stack.pot, chainId: CHAIN_ID, hash }),
      );
      expect(await isValid(bound)).toEqual({ ok: true, result: MAGIC });
      // The owner's signature of the hash itself, as it would sign for its own account.
      expect(await isValid(await OWNER.sign({ hash }))).toEqual({ ok: true, result: NOT });
      // Bound to another chain, and a stranger's.
      const elsewhere = await OWNER.signTypedData(
        potMessageTypedData({ pot: stack.pot, chainId: 1, hash }),
      );
      expect(await isValid(elsewhere)).toEqual({ ok: true, result: NOT });
      const strangers = await STRANGER.signTypedData(
        potMessageTypedData({ pot: stack.pot, chainId: CHAIN_ID, hash }),
      );
      expect(await isValid(strangers)).toEqual({ ok: true, result: NOT });
    });

    it("lets Permit2 move the Pot's tokens on the owner's signature, and refuses the owner's own", async () => {
      const deployed = await send(
        owner,
        undefined,
        concat([
          TOKEN.creationCode,
          encodeAbiParameters([{ type: "string" }, { type: "uint8" }], ["TKN", 18]),
        ]),
      );
      const token = deployed.created!;
      const mint = encodeFunctionData({
        abi: TOKEN.abi,
        functionName: "mint",
        args: [stack.pot, 1_000n],
      });
      expect((await send(owner, token, mint)).ok).toBe(true);
      const approve = `import { approve } from "@sauce/token";
function main(token: Address, spender: Address): void {
  approve(token, spender, 1000);
}`;
      expect((await cook(compiled(approve, [token, PERMIT2.address]))).ok).toBe(true);

      const permit = {
        permitted: { token, amount: 600n },
        nonce: 0n,
        deadline: (await now()) + 3_600n,
      };
      const permitDigest = hashTypedData({
        domain: { name: "Permit2", chainId: CHAIN_ID, verifyingContract: PERMIT2.address },
        types: {
          PermitTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
          TokenPermissions: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
          ],
        },
        primaryType: "PermitTransferFrom",
        message: { ...permit, spender: STRANGER.address },
      });
      const pull = (signature: Hex) =>
        encodeFunctionData({
          abi: permit2Abi,
          functionName: "permitTransferFrom",
          args: [permit, { to: STRANGER.address, requestedAmount: 600n }, stack.pot, signature],
        });

      // Signed as the owner signs a permit for its own account: not the Pot's.
      const own = await OWNER.sign({ hash: permitDigest });
      expect((await send(stranger, PERMIT2.address, pull(own))).ok).toBe(false);

      const bound = await OWNER.signTypedData(
        potMessageTypedData({ pot: stack.pot, chainId: CHAIN_ID, hash: permitDigest }),
      );
      const pulled = await send(stranger, PERMIT2.address, pull(bound));
      expect(pulled.ok).toBe(true);
      costs.set("Permit2 permitTransferFrom, the Pot the signer (its view handler)", pulled.gas);
      const balanceOf = (who: Address) =>
        publicClient.readContract({
          address: token,
          abi: TOKEN.abi,
          functionName: "balanceOf",
          args: [who],
        });
      expect(await balanceOf(STRANGER.address)).toBe(600n);
      expect(await balanceOf(stack.pot)).toBe(400n);
    });

    it("is @sauce/async's one handler: a hash a program the owner signed approved is valid too", async () => {
      const approved = keccak256(toHex("an order the Pot placed"));
      expect(await isValid("0x")).toEqual({ ok: true, result: NOT });
      const before = await callOf(
        STRANGER.address,
        stack.pot,
        encodeFunctionData({
          abi: potAbi,
          functionName: "isValidSignature",
          args: [approved, "0x"],
        }),
      );
      expect(before).toEqual({ ok: true, result: NOT });
      // The owner signs a program approving it, and a stranger submits it.
      const approving = `import { Erc1271 } from "@sauce/async";
function main(hash: Uint256): void {
  Erc1271.approve(hash);
}`;
      const execution = await executionOf(compiled(approving, [BigInt(approved)]));
      const data = encodeExecute({ ...execution, signature: await signExecute(execution) });
      expect((await send(stranger, stack.pot, data)).ok).toBe(true);
      const after = await callOf(
        STRANGER.address,
        stack.pot,
        encodeFunctionData({
          abi: potAbi,
          functionName: "isValidSignature",
          args: [approved, "0x"],
        }),
      );
      expect(after).toEqual({ ok: true, result: MAGIC });
    });

    it("answers for a contract wallet owner through its own EIP-1271", async () => {
      // The wallet's Pot from the suite above is installed already; read it fresh here.
      const deployed = await send(
        walletFirst,
        undefined,
        concat([
          REFERENCE.TwoOfTwoWallet.creationCode,
          encodeAbiParameters(
            [{ type: "address" }, { type: "address" }],
            [WALLET_FIRST.address, WALLET_SECOND.address],
          ),
        ]),
      );
      const wallet = deployed.created!;
      const pot = await mintPot(wallet, word(0x2a11e8n));
      const installed = await send(
        walletFirst,
        wallet,
        encodeFunctionData({
          abi: REFERENCE.TwoOfTwoWallet.abi,
          functionName: "call",
          args: [pot, FEE, cookData(install)],
        }),
        FEE,
      );
      expect(installed.ok).toBe(true);
      const digest = hashTypedData(potMessageTypedData({ pot, chainId: CHAIN_ID, hash }));
      const both = concat([
        await WALLET_FIRST.sign({ hash: digest }),
        await WALLET_SECOND.sign({ hash: digest }),
      ]);
      expect(await isValid(both, pot)).toEqual({ ok: true, result: MAGIC });
      expect(await isValid(await WALLET_FIRST.sign({ hash: digest }), pot)).toEqual({
        ok: true,
        result: NOT,
      });
    });
  });

  describe("the skill's examples, and a hop", () => {
    /** Base's USDC, where the suite plants a token it can mint: the examples name USDC. */
    const USDC = getAddress(Base.USDC.address!);
    const recipient = "0x000000000000000000000000000000000000bEEF" as Address;
    const usdc = (who: Address) =>
      publicClient.readContract({
        address: USDC,
        abi: TOKEN.abi,
        functionName: "balanceOf",
        args: [who],
      }) as Promise<bigint>;
    const mint = async (to: Address, amount: bigint) =>
      expect(
        (
          await send(
            owner,
            USDC,
            encodeFunctionData({ abi: TOKEN.abi, functionName: "mint", args: [to, amount] }),
          )
        ).ok,
      ).toBe(true);
    /** A Shared Pot, where a hop's body runs. */
    const sharedPot = async (salt: bigint): Promise<Address> => {
      const deploy = encodeFunctionData({
        abi: kitchenAbi,
        functionName: "deploySharedPot",
        args: [word(salt)],
      });
      expect((await send(owner, stack.kitchen, deploy)).ok).toBe(true);
      return (await publicClient.readContract({
        address: stack.kitchen,
        abi: kitchenAbi,
        functionName: "predictSharedPot",
        args: [word(salt)],
      })) as Address;
    };

    beforeAll(async () => {
      const deployed = await send(
        owner,
        undefined,
        concat([
          TOKEN.creationCode,
          encodeAbiParameters([{ type: "string" }, { type: "uint8" }], ["USDC", 6]),
        ]),
      );
      const code = await publicClient.getCode({ address: deployed.created! });
      await createTestClient({ mode: "anvil", transport: http(RPC_URL) }).setCode({
        address: USDC,
        bytecode: code!,
      });
    });

    it("runs pay-when-delivered once its USDC has arrived, refusing it before", async () => {
      const execution = await executionOf(
        compiled(skillExample("pay-when-delivered"), [recipient, 300n]),
      );
      const signature = await signExecute(execution);
      const data = encodeExecute({ ...execution, signature });
      // Anyone may submit it early: the program's own check refuses it, and the salt stays.
      expect(await reasonOf(data)).toBe("not delivered yet");
      expect(await used(execution.salt)).toBe(false);

      // deliver-and-run, cooked by a stranger on its own Pot: pays the owner's Pot and runs it.
      const relayerPot = await mintPot(STRANGER.address, word(0x7e1a7n));
      await mint(relayerPot, 300n);
      const before = await usdc(recipient);
      const delivering = compiled(skillExample("deliver-and-run"), [
        stack.pot,
        300n,
        execution.program,
        execution.salt,
        execution.deadline,
        signature,
      ]);
      const cooked = await send(stranger, relayerPot, cookData(delivering), FEE);
      expect(cooked.ok).toBe(true);
      expect((await usdc(recipient)) - before).toBe(300n);
      expect(await usdc(relayerPot)).toBe(0n);
      expect(await used(execution.salt)).toBe(true);
    });

    it("cancels a signature with cancel-salt, the owner's cook", async () => {
      const execution = await executionOf(compiled(WRITER, [31n]));
      const data = encodeExecute({ ...execution, signature: await signExecute(execution) });
      expect((await cook(compiled(skillExample("cancel-salt"), [execution.salt]))).ok).toBe(true);
      expect(await reasonOf(data)).toBe("signed: the salt was used or cancelled");
    });

    it("runs the skill's hop: its body, cooked on a Shared Pot as a fill does, pays the owner's Pot and runs its signed program", async () => {
      // The skill's hop, as an intent file on Ethereum whose body runs on Base.
      const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
      const block = /```sauce chain=ethereum\n([\s\S]*?)```/.exec(skill)?.[1];
      expect(block).toContain("Base.hop(");
      const hop = (signed: Hex) => {
        const source = block!.replace(
          /const SIGNED = hex`[0-9a-f]*`;/,
          `const SIGNED = hex\`${signed.slice(2)}\`;`,
        );
        expect(source).toContain(signed.slice(2));
        const program = compileSauceProgram("ethereum", source, {
          intents: { deadline: 1n << 40n, executionFee: FEE },
        });
        expect(program.bodies).toHaveLength(1);
        return program.bodies[0]!;
      };
      const amount = 1_000_000n;
      const delivered = amount - (amount * 10n) / 10_000n;

      // The owner signs a payout of what the hop delivers, for its Pot on Base.
      const execution = await executionOf(
        compiled(skillExample("pay-when-delivered"), [recipient, delivered]),
      );
      const signed = encodeExecute({ ...execution, signature: await signExecute(execution) });
      const forged = encodeExecute({
        ...execution,
        signature: await signExecute(execution, STRANGER),
      });

      // The body as the fill cooks it: the Base program, with what it captured appended.
      const bodyOf = (signedCall: Hex): Hex => {
        const body = hop(signedCall);
        expect(body.destination.slug).toBe("base");
        const values: Record<string, bigint> = { pot: BigInt(stack.pot), delivered };
        expect([...body.captures].sort()).toEqual(["delivered", "pot"]);
        return concat([toHex(body.bytecode), ...body.captures.map((name) => word(values[name]!))]);
      };
      const shared = await sharedPot(0x5a5a01n);
      await mint(shared, delivered);
      const before = await usdc(recipient);

      // A body carrying a forged signature fails whole: nothing leaves the Shared Pot.
      expect((await send(stranger, shared, cookData(bodyOf(forged)), FEE)).ok).toBe(false);
      expect(await usdc(shared)).toBe(delivered);

      const filled = await send(stranger, shared, cookData(bodyOf(signed)), FEE);
      expect(filled.ok).toBe(true);
      costs.set(
        "a hop's body on a Shared Pot: transfer to the Private Pot, then execute",
        filled.gas,
      );
      expect((await usdc(recipient)) - before).toBe(delivered);
      expect(await usdc(shared)).toBe(0n);
      expect(await used(execution.salt)).toBe(true);
    });
  });

  describe("installing", () => {
    it("is lazy: the owner's first cook with Signed (cancel-salt) sets a bare Pot up, once", async () => {
      const bare = await mintPot(OWNER.address, word(0x1a27n));
      const execution = { ...(await executionOf(compiled(WRITER, [61n]))), pot: bare };
      const data = encodeExecute({ ...execution, signature: await signExecute(execution) });
      // Nothing answers `execute` on a Pot with no handler.
      const before = await callOf(STRANGER.address, bare, data);
      expect(before.ok).toBe(false);
      expect(before.ok === false && before.data.slice(0, 10)).toBe(
        toFunctionSelector("UnknownSelector(bytes4)"),
      );

      const first = await cook(compiled(skillExample("cancel-salt"), [BigInt(freshSalt())]), bare);
      expect(first.ok).toBe(true);
      costs.set(
        "cancel-salt on a bare Pot: the cancel, and the three handlers installed",
        first.gas,
      );
      expect((await send(stranger, bare, data)).ok).toBe(true);
      expect(await slot(WRITTEN_SLOT, bare)).toBe(61n);

      const again = await cook(compiled(skillExample("cancel-salt"), [BigInt(freshSalt())]), bare);
      expect(again.ok).toBe(true);
      costs.set("cancel-salt again: the handlers found in place, nothing installed", again.gas);
      expect(again.gas).toBeLessThan(first.gas / 2n);
    });

    it("is refused on a Shared Pot", async () => {
      const salt = word(0x5a5a02n);
      expect(
        (
          await send(
            owner,
            stack.kitchen,
            encodeFunctionData({ abi: kitchenAbi, functionName: "deploySharedPot", args: [salt] }),
          )
        ).ok,
      ).toBe(true);
      const shared = (await publicClient.readContract({
        address: stack.kitchen,
        abi: kitchenAbi,
        functionName: "predictSharedPot",
        args: [salt],
      })) as Address;
      const refused = await callOf(STRANGER.address, shared, cookData(install), FEE);
      expect(refused.ok).toBe(false);
      expect(refused.ok === false && refused.data).toBe(toFunctionSelector("SharedPot()"));
    });

    it("is refused on a Private Pot whose Router is fixed", async () => {
      const fixed = await mintPot(OWNER.address, word(0xf1ed01n), true);
      const refused = await callOf(OWNER.address, fixed, cookData(install), FEE);
      expect(refused.ok).toBe(false);
      expect(refused.ok === false && refused.data).toBe(toFunctionSelector("RouterFixed()"));
    });
  });

  describe("what it costs, beside the same verification in Solidity", () => {
    let reference: Address;
    let referencePot: Address;

    beforeAll(async () => {
      const deployed = await send(
        owner,
        undefined,
        concat([
          REFERENCE.SignedReference.creationCode,
          encodeAbiParameters([{ type: "address" }], [OWNER.address]),
        ]),
      );
      reference = deployed.created!;
      referencePot = await mintPot(reference, word(0x7ef0n));
      const set = encodeFunctionData({
        abi: REFERENCE.SignedReference.abi,
        functionName: "setPot",
        args: [referencePot, stack.engine],
      });
      expect((await send(owner, reference, set)).ok).toBe(true);
    });

    it("measures execute through the handler, the reference, and a plain cook", async () => {
      const trivial = compiled(TRIVIAL);
      // A plain cook of the program by the Pot's owner: what every path below also runs.
      const plain = await cook(trivial);
      expect(plain.ok).toBe(true);
      costs.set("the owner cooks the trivial program (baseline)", plain.gas);

      // A salt in a word never written, then the next salt in the same word.
      const first = freshSalt();
      const next = saltOf(BigInt(first) + 1n);
      for (const [salt, label] of [
        [first, "cold salt word"],
        [next, "salt word already written"],
      ] as const) {
        const execution = await executionOf(trivial, salt);
        const signature = await signExecute(execution);
        const sauce = await send(stranger, stack.pot, encodeExecute({ ...execution, signature }));
        expect(sauce.ok).toBe(true);
        costs.set(`execute, the Sauce handler, ${label}`, sauce.gas);

        const native = { ...execution, pot: referencePot };
        const nativeSignature = await signExecute(native);
        const args = [native.program, native.salt, native.deadline, nativeSignature] as const;
        const call = encodeFunctionData({
          abi: REFERENCE.SignedReference.abi,
          functionName: "execute",
          args,
        });
        const replayed = await callOf(STRANGER.address, reference, call, FEE);
        expect(replayed).toEqual({ ok: true, result: expect.any(String) });
        const ran = await send(stranger, reference, call, FEE);
        expect(ran.ok).toBe(true);
        costs.set(`execute, the Solidity reference + the same cook, ${label}`, ran.gas);
      }

      // The reference's verification alone, without the cook.
      for (const [offset, label] of [
        [0n, "cold salt word"],
        [1n, "salt word already written"],
      ] as const) {
        const execution = {
          ...(await executionOf(trivial, saltOf(BigInt(first) + 512n + offset))),
          pot: referencePot,
        };
        const signature = await signExecute(execution);
        const verified = await send(
          stranger,
          reference,
          encodeFunctionData({
            abi: REFERENCE.SignedReference.abi,
            functionName: "verify",
            args: [execution.program, execution.salt, execution.deadline, signature],
          }),
        );
        expect(verified.ok).toBe(true);
        costs.set(`verification alone, Solidity, ${label}`, verified.gas);
      }

      // Installing `execute` alone, on a Pot that has no handler: its code deployed and recorded.
      const fresh = await mintPot(OWNER.address, word(0x1257a11n));
      const executeOnly = compiled(
        handlersInstallSource(
          packageHandlers(CHAIN, "@sauce/signed").filter(({ signature }) =>
            signature.startsWith("execute("),
          ),
          "@sauce/signed",
        ),
      );
      const installed = await cook(executeOnly, fresh);
      expect(installed.ok).toBe(true);
      costs.set("install execute alone, one cook", installed.gas);

      // The view handler, from a transaction.
      const hash = keccak256(toHex("measured"));
      const bound = await OWNER.signTypedData(
        potMessageTypedData({ pot: stack.pot, chainId: CHAIN_ID, hash }),
      );
      const viewed = await send(
        stranger,
        stack.pot,
        encodeFunctionData({ abi: potAbi, functionName: "isValidSignature", args: [hash, bound] }),
      );
      expect(viewed.ok).toBe(true);
      costs.set("isValidSignature on the Pot, the view handler", viewed.gas);
    });
  });
});

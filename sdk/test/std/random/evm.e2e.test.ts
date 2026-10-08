/**
 * `@sauce/random` EXECUTED: a program requests randomness and pays for it, the provider calls the
 * Pot back, and the `.then` body runs with what arrived — on an anvil running the released gated
 * engine and Kitchen with v12 #571's Router, whose fallback runs the handler a Pot registered.
 *
 * The providers are mocks at their own Base addresses, so the package compiles and its handlers
 * authenticate exactly as on Base:
 *  - `fixtures/MockVRFV2PlusWrapper.sol` at `ChainlinkVrf.Wrapper`: the wrapper's request, price
 *    and checks, and its `fulfillRandomWords` path (`fulfill`), the consumer called with exactly its
 *    callback gas and a failure caught as `WrapperFulfillmentFailed`;
 *  - `fixtures/MockEntropy.sol` at `PythEntropy.Entropy`: Entropy v2's requests, fees and sequence
 *    numbers per provider, and `revealWithCallback`'s callback (`reveal`), a failure leaving the
 *    request open.
 * Each step runs as a user would run it: the owner cooks the program the SDK writes to install the
 * package's handlers (`sauce run @sauce/random`'s), the owner cooks a program that requests, and the
 * mock calls back as the provider would.
 *
 * And what is refused: a callback from anyone but the provider, an id delivered again or never
 * requested, and a callback given less gas than the body needs.
 *
 * GATED twice, as `std/async/evm.e2e.test.ts` is: on SAUCE_V12_RUNTIME_CREATION_HEX and on
 * SAUCE_V12_ROUTER_CREATION_HEX, #571's Router, which no release publishes yet.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bytesToHex,
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
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
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../../../src/chains/canonical.js";
import { contractAddressOn } from "../../../src/routes/chain-module.js";
import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { handlersInstallSource, packageHandlers } from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  gateAnchors,
  routerUnderTest,
  startGatedEngine,
  type GatedEngine,
} from "../../evm/gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const ROUTER = routerUnderTest();
const describeRandom = RUNTIME_HEX_PATH && ROUTER !== undefined ? describe : describe.skip;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evm", "fixtures");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as {
    abi: Abi;
    runtimeCode: Hex;
  };
const WRAPPER_MOCK = fixture("MockVRFV2PlusWrapper");
const ENTROPY_MOCK = fixture("MockEntropy");
/** OpenZeppelin's ERC20Mock, as `std/token`'s suite vendors it. */
const ERC20_MOCK = JSON.parse(
  readFileSync(join(FIXTURES, "..", "..", "std", "token", "fixtures", "MockERC20.json"), "utf8"),
) as { abi: Abi; creationCode: Hex };
/** Holders a body pays: new to the token, so each transfer writes a fresh balance. */
const HOLDERS = [
  "0x00000000000000000000000000000000000000a1",
  "0x00000000000000000000000000000000000000a2",
  "0x00000000000000000000000000000000000000a3",
] as const;

/** Anvil's first dev account: the Kitchen's owner and the Pot's. A second calls as a stranger. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const PORT = 9700 + (Number(process.env.JEST_WORKER_ID ?? "1") % 50);
const RPC_URL = `http://127.0.0.1:${PORT}`;
/** Non-zero, so a cook provably pays it, and a callback's single fee can be counted. */
const FEE = 1_234n;
/** The chain the programs are compiled for, and the id anvil answers with: both providers are on
 *  Base. */
const CHAIN = "base";
const CHAIN_ID = 8453;

const WRAPPER = contractAddressOn(requireChain(CHAIN), "ChainlinkVrf", "Wrapper") as Address;
const ENTROPY = contractAddressOn(requireChain(CHAIN), "PythEntropy", "Entropy") as Address;
/** Base's default Entropy provider, as the mock answers `getDefaultProvider()`. */
const PROVIDER = "0x52DeaA1c84233F7bb8C8A45baeDE41091c616506" as Address;

const VRF_CALLBACK = toFunctionSelector("rawFulfillRandomWords(uint256,uint256[])");
const ENTROPY_CALLBACK = toFunctionSelector("_entropyCallback(uint64,address,bytes32)");
/** keccak256(abi.encode(uint256(keccak256("sauce.storage.Async")) - 1)) & ~0xff. */
const NAMESPACE = (() => {
  const inner = BigInt(keccak256(toHex("sauce.storage.Async"))) - 1n;
  return BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn;
})();
/** The Pot storage slots the bodies write. */
const SLOT = keccak256(toHex("random.result"));
const CAUGHT = keccak256(toHex("random.caught"));
const GATE = keccak256(toHex("random.gate"));

const potAbi = parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]);
const kitchenAbi = parseAbi(["function setExecutionFee(uint256 fee)"]);

const word = (value: bigint): Hex => toHex(value, { size: 32 });
const slotOf = (key: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [key, NAMESPACE]));
/** The key a VRF request parks under: the wrapper and the request id. */
const vrfKey = (id: bigint): bigint =>
  BigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [WRAPPER, id])));
/** The key an Entropy request parks under: Entropy, the provider and the sequence number. */
const entropyKey = (provider: Address, sequence: bigint): bigint =>
  BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [ENTROPY, provider, sequence],
      ),
    ),
  );

/** A VRF request whose body writes the words' sum plus `bump`, a value it captured. */
const VRF_SOURCE = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.vrf({ words: 2 }).then((words) => {
    evm.sstore(${SLOT}, words[0] + words[1] + bump);
  });
}`;

/** A VRF request with a body that reverts, and a `.catch` that records it. */
const VRF_CATCH_SOURCE = `import { Random } from "@sauce/random";

function main(limit: Uint256): void {
  Random.vrf({ words: 1 })
    .then((words) => {
      require(words[0] < limit, "above the limit");
      evm.sstore(${SLOT}, words[0]);
    })
    .catch((e) => {
      evm.sstore(${CAUGHT}, 1);
    });
}`;

/** A VRF request whose callback gas is given, too little for the body. */
const VRF_STARVED_SOURCE = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.vrf({ words: 1, gas: 60000 }).then((words) => {
    evm.sstore(${SLOT}, words[0] + bump);
  });
}`;

/** An Entropy request from the default provider, whose body writes the number plus `bump`. */
const ENTROPY_SOURCE = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.entropy().then((value) => {
    evm.sstore(${SLOT}, value + bump);
  });
}`;

/** An Entropy request whose body reverts until the Pot's gate is open, with no `.catch`. */
const ENTROPY_GATED_SOURCE = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.entropy().then((value) => {
    require(evm.sload(${GATE}) == 1, "closed");
    evm.sstore(${SLOT}, value + bump);
  });
}`;

let anvil: ChildProcess;
let publicClient: PublicClient;
let stack: GatedEngine;
let token: Address;

const owner = createWalletClient({ account: OWNER, transport: http(RPC_URL) });
const stranger = createWalletClient({ account: STRANGER, transport: http(RPC_URL) });

/** Sends a transaction and answers its receipt; a revert is an answer, not a throw. */
async function send(
  from: typeof owner,
  to: Address,
  data: Hex,
  value = 0n,
): Promise<TransactionReceipt> {
  const hash = await from.sendTransaction({
    account: from.account,
    chain: null,
    to,
    data,
    value,
    gas: 15_000_000n,
  });

  return publicClient.waitForTransactionReceipt({ hash });
}

/** `program` with `args` for its `main`, compiled by the SDK for the chain. */
function compiled(source: string, args: readonly (bigint | Hex)[] = []): Hex {
  const program = compileSauceProgram(CHAIN, source);

  return bytesToHex(concat([program.bytecode, encodeEntryArguments(program, args)]));
}

/** Cooks `program` on the harness Pot as its owner, paying the fee. */
const cook = (program: Hex) =>
  send(
    owner,
    stack.pot,
    encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] }),
    FEE,
  );

/** What a call answers or reverts with, replayed as an `eth_call` from `from`, with `gas`. */
async function callAs(
  from: Address,
  to: Address,
  data: Hex,
  gas = 15_000_000n,
): Promise<{ ok: boolean; data: Hex; reason: string }> {
  const response = (await (
    await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ from, to, data, gas: toHex(gas) }, "latest"],
      }),
    })
  ).json()) as { result?: Hex; error?: { data?: Hex } };
  const returned = response.result ?? response.error?.data ?? "0x";

  return {
    ok: response.error === undefined,
    data: returned,
    reason: Buffer.from(returned.slice(2), "hex").toString("utf8"),
  };
}

const parked = async (key: bigint): Promise<bigint> =>
  BigInt((await publicClient.getStorageAt({ address: stack.pot, slot: slotOf(key) })) ?? "0x0");

const storage = async (slot: Hex): Promise<bigint> =>
  BigInt((await publicClient.getStorageAt({ address: stack.pot, slot })) ?? "0x0");

/** The events `abi` declares among `receipt`'s logs from `address`. */
function eventsOf(
  receipt: TransactionReceipt,
  address: Address,
  abi: Abi,
): { eventName: string; args: Record<string, unknown> }[] {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === address.toLowerCase())
    .map(
      (log) =>
        decodeEventLog({ abi, data: log.data, topics: log.topics }) as unknown as {
          eventName: string;
          args: Record<string, unknown>;
        },
    );
}

/** Cooks a VRF request program, answering the request id the wrapper gave it and the receipt. */
async function requestVrf(
  source: string,
  args: readonly bigint[],
): Promise<{ id: bigint; receipt: TransactionReceipt }> {
  const receipt = await cook(compiled(source, args));
  expect(receipt.status).toBe("success");
  const [requested] = eventsOf(receipt, WRAPPER, WRAPPER_MOCK.abi);
  expect(requested?.eventName).toBe("RandomWordsRequested");

  return { id: (requested!.args as { requestId: bigint }).requestId, receipt };
}

/** Cooks an Entropy request program, answering the sequence number Entropy gave it. */
async function requestEntropy(
  source: string,
  args: readonly bigint[],
): Promise<{ sequence: bigint; gasLimit: number; receipt: TransactionReceipt }> {
  const receipt = await cook(compiled(source, args));
  expect(receipt.status).toBe("success");
  const [requested] = eventsOf(receipt, ENTROPY, ENTROPY_MOCK.abi);
  expect(requested?.eventName).toBe("Requested");
  const { provider, caller, sequenceNumber, gasLimit } = requested!.args as {
    provider: Address;
    caller: Address;
    sequenceNumber: bigint;
    gasLimit: number;
  };
  expect(provider).toBe(PROVIDER);
  expect(caller).toBe(stack.pot);

  return { sequence: sequenceNumber, gasLimit, receipt };
}

const fulfill = (id: bigint, words: readonly bigint[]): Hex =>
  encodeFunctionData({ abi: WRAPPER_MOCK.abi, functionName: "fulfill", args: [id, words] });

const callbackGasOf = async (id: bigint): Promise<bigint> => {
  const [, gasLimit] = (await publicClient.readContract({
    address: WRAPPER,
    abi: WRAPPER_MOCK.abi,
    functionName: "s_callbacks",
    args: [id],
  })) as readonly [Address, number, bigint];

  return BigInt(gasLimit);
};

/** The least gas the Pot's callback for `id` needs, found by replaying the wrapper's delivery with
 *  exactly that much: the wrapper's own `_callWithExactGas`, as `eth_call`s, which commit nothing. */
async function leastCallbackGas(id: bigint, words: readonly bigint[]): Promise<bigint> {
  const succeeds = async (gas: bigint) => {
    const { ok, data } = await callAs(
      STRANGER.address,
      WRAPPER,
      encodeFunctionData({
        abi: WRAPPER_MOCK.abi,
        functionName: "deliver",
        args: [stack.pot, id, words, Number(gas)],
      }),
    );
    return ok && BigInt(data) === 1n;
  };
  let low = 0n;
  let high = 2_000_000n;
  expect(await succeeds(high)).toBe(true);
  while (high - low > 1_000n) {
    const middle = (low + high) / 2n;
    if (await succeeds(middle)) high = middle;
    else low = middle;
  }

  return high;
}

describeRandom("@sauce/random on the EVM, through the Router's handlers", () => {
  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"], {
      stdio: "ignore",
    });
    const transport = http(RPC_URL);
    publicClient = createPublicClient({ transport });
    const testClient = createTestClient({ mode: "anvil", transport });
    for (const deadline = Date.now() + 20_000; ;) {
      try {
        await publicClient.getChainId();
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`anvil did not come up on ${RPC_URL}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    stack = await startGatedEngine(
      { publicClient, walletClient: owner, testClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
      { routerCreationCode: ROUTER },
    );
    expect(
      (
        await send(
          owner,
          stack.kitchen,
          encodeFunctionData({ abi: kitchenAbi, functionName: "setExecutionFee", args: [FEE] }),
        )
      ).status,
    ).toBe("success");
    // The Pot pays each request's price, and the Router each callback's fee, from its balance.
    await testClient.setBalance({ address: stack.pot, value: parseEther("10") });
    // The providers, at their own addresses on Base.
    await testClient.setCode({ address: WRAPPER, bytecode: WRAPPER_MOCK.runtimeCode });
    await testClient.setCode({ address: ENTROPY, bytecode: ENTROPY_MOCK.runtimeCode });
    // A token the Pot holds, for bodies that pay out.
    const deployed = await owner.sendTransaction({
      account: OWNER,
      chain: null,
      data: ERC20_MOCK.creationCode,
    });
    token = (await publicClient.waitForTransactionReceipt({ hash: deployed })).contractAddress!;
    await send(
      owner,
      token,
      encodeFunctionData({
        abi: ERC20_MOCK.abi,
        functionName: "mint",
        args: [stack.pot, 10n ** 24n],
      }),
    );

    // The package's handlers, installed as `sauce run @sauce/random --chain base` installs them.
    const install = await cook(
      compiled(handlersInstallSource(packageHandlers(CHAIN, "@sauce/random"), "@sauce/random")),
    );
    expect(install.status).toBe("success");
  }, 120_000);

  afterAll(async () => {
    if (anvil !== undefined && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  describe("Chainlink VRF", () => {
    it("pays the wrapper's price, parks the body, and the callback runs it once, for one fee", async () => {
      const wrapperBefore = await publicClient.getBalance({ address: WRAPPER });
      const { id, receipt } = await requestVrf(VRF_SOURCE, [1_000n]);
      expect(await parked(vrfKey(id))).not.toBe(0n);

      // Exactly the price, at the request's own gas price, for the gas it asked for.
      const gas = await callbackGasOf(id);
      const price = (await publicClient.readContract({
        address: WRAPPER,
        abi: WRAPPER_MOCK.abi,
        functionName: "estimateRequestPriceNative",
        args: [Number(gas), 2, receipt.effectiveGasPrice],
      })) as bigint;
      expect(price).toBeGreaterThan(0n);
      expect((await publicClient.getBalance({ address: WRAPPER })) - wrapperBefore).toBe(price);

      const kitchen = gateAnchors().kitchen;
      const kitchenBefore = await publicClient.getBalance({ address: kitchen });
      const fulfilled = await send(stranger, WRAPPER, fulfill(id, [7n, 35n]));
      expect(fulfilled.status).toBe("success");
      expect(eventsOf(fulfilled, WRAPPER, WRAPPER_MOCK.abi)).toEqual([]);

      expect(await storage(SLOT)).toBe(1_042n);
      expect(await parked(vrfKey(id))).toBe(0n);
      expect((await publicClient.getBalance({ address: kitchen })) - kitchenBefore).toBe(FEE);
    });

    // Bodies that write, hash and call out, each sized by the library from its bytes alone.
    it.each([
      ["a write", "evm.sstore(SLOT, words[0] + words[1] + bump);"],
      [
        "five writes",
        [0, 1, 2, 3, 4].map((i) => `evm.sstore(SLOT + ${i}, words[0] + bump);`).join("\n"),
      ],
      [
        "forty hashes",
        [
          "let h = words[0] + bump;",
          ...Array.from({ length: 40 }, () => "h = crypto.keccak256(abi.encode(h, words[1]));"),
          "evm.sstore(SLOT, h);",
        ].join("\n"),
      ],
      ["a token transfer", "transfer(TOKEN, words[0] % 2 == 0 ? FIRST : SECOND, bump);"],
      [
        "three token transfers",
        ["FIRST", "SECOND", "THIRD"].map((to) => `transfer(TOKEN, ${to}, bump + 1);`).join("\n"),
      ],
    ])(
      "asks for enough gas for the body it compiled — %s — and the wrapper hands exactly that",
      async (_, body) => {
        const source = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.vrf({ words: 2 }).then((words) => {
    ${body
      .replaceAll("SLOT", SLOT)
      .replaceAll("TOKEN", token)
      .replaceAll("FIRST", HOLDERS[0])
      .replaceAll("SECOND", HOLDERS[1])
      .replaceAll("THIRD", HOLDERS[2])}
  });
}`;
        const paid = async () => {
          let total = 0n;
          for (const holder of HOLDERS) {
            total += (await publicClient.readContract({
              address: token,
              abi: ERC20_MOCK.abi,
              functionName: "balanceOf",
              args: [holder],
            })) as bigint;
          }
          return total;
        };
        const before = await paid();
        const { id } = await requestVrf(source, [5n]);
        const asked = await callbackGasOf(id);
        const least = await leastCallbackGas(id, [3n, 4n]);
        expect(least).toBeLessThanOrEqual(asked);
        // Sized, not padded without end: within a few times what the callback needs.
        expect(asked).toBeLessThan(least * 3n);
        const fulfilled = await send(stranger, WRAPPER, fulfill(id, [3n, 4n]));
        expect(fulfilled.status).toBe("success");
        expect(eventsOf(fulfilled, WRAPPER, WRAPPER_MOCK.abi)).toEqual([]);
        expect(await parked(vrfKey(id))).toBe(0n);
        if (body.includes("transfer(")) expect(await paid()).toBeGreaterThan(before);
      },
    );

    it("refuses a callback from anyone but the wrapper, and leaves the body parked", async () => {
      const { id } = await requestVrf(VRF_SOURCE, [0n]);
      const forged = concat([
        VRF_CALLBACK,
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256[]" }], [id, [666n, 0n]]),
      ]);
      expect((await callAs(STRANGER.address, stack.pot, forged)).reason).toBe(
        "async: the call is not from the protocol",
      );
      expect((await send(stranger, stack.pot, forged)).status).toBe("reverted");
      expect(await parked(vrfKey(id))).not.toBe(0n);
      // The wrapper's own delivery still runs it.
      expect((await send(stranger, WRAPPER, fulfill(id, [1n, 2n]))).status).toBe("success");
      expect(await storage(SLOT)).toBe(3n);
    });

    it("refuses an id delivered again, or never requested: the wrapper's callback fails", async () => {
      const { id } = await requestVrf(VRF_SOURCE, [0n]);
      expect((await send(stranger, WRAPPER, fulfill(id, [5n, 5n]))).status).toBe("success");
      expect(await storage(SLOT)).toBe(10n);
      for (const again of [id, id + 1n]) {
        const deliver = encodeFunctionData({
          abi: WRAPPER_MOCK.abi,
          functionName: "deliver",
          args: [stack.pot, again, [9n, 9n], 1_000_000],
        });
        const replayed = await send(stranger, WRAPPER, deliver);
        expect(replayed.status).toBe("success");
        expect(eventsOf(replayed, WRAPPER, WRAPPER_MOCK.abi).map((e) => e.eventName)).toEqual([
          "WrapperFulfillmentFailed",
        ]);
        expect(await storage(SLOT)).toBe(10n);
      }
      // The handler's own refusal, as the wrapper's call sees it.
      const replay = concat([
        VRF_CALLBACK,
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256[]" }], [id, [9n, 9n]]),
      ]);
      expect((await callAs(WRAPPER, stack.pot, replay)).reason).toBe(
        "async: nothing is parked under this key",
      );
    });

    it("runs `.catch` in the body's place when the body reverts", async () => {
      const { id } = await requestVrf(VRF_CATCH_SOURCE, [100n]);
      expect((await send(stranger, WRAPPER, fulfill(id, [500n]))).status).toBe("success");
      expect(await storage(CAUGHT)).toBe(1n);
      expect(await parked(vrfKey(id))).toBe(0n);
    });

    it("spends a request whose callback runs out of the gas it asked for: the body stays parked", async () => {
      const before = await storage(SLOT);
      const { id } = await requestVrf(VRF_STARVED_SOURCE, [0n]);
      expect(await callbackGasOf(id)).toBe(60_000n);
      const starved = await send(stranger, WRAPPER, fulfill(id, [11n]));
      expect(starved.status).toBe("success");
      expect(eventsOf(starved, WRAPPER, WRAPPER_MOCK.abi).map((e) => e.eventName)).toEqual([
        "WrapperFulfillmentFailed",
      ]);
      expect(await storage(SLOT)).toBe(before);
      expect(await parked(vrfKey(id))).not.toBe(0n);
    });
  });

  describe("Pyth Entropy", () => {
    it("pays Entropy's fee, parks the body under the provider's sequence number, and runs it", async () => {
      const entropyBefore = await publicClient.getBalance({ address: ENTROPY });
      const { sequence, gasLimit } = await requestEntropy(ENTROPY_SOURCE, [5n]);
      const key = entropyKey(PROVIDER, sequence);
      expect(await parked(key)).not.toBe(0n);
      const fee = (await publicClient.readContract({
        address: ENTROPY,
        abi: ENTROPY_MOCK.abi,
        functionName: "getFeeV2",
        args: [PROVIDER, gasLimit],
      })) as bigint;
      expect((await publicClient.getBalance({ address: ENTROPY })) - entropyBefore).toBe(fee);

      const value = BigInt(keccak256(toHex("a random number")));
      const revealed = await send(
        stranger,
        ENTROPY,
        encodeFunctionData({
          abi: ENTROPY_MOCK.abi,
          functionName: "reveal",
          args: [PROVIDER, sequence, word(value)],
        }),
      );
      expect(revealed.status).toBe("success");
      const [event] = eventsOf(revealed, ENTROPY, ENTROPY_MOCK.abi);
      expect((event!.args as { callbackFailed: boolean }).callbackFailed).toBe(false);
      expect(await storage(SLOT)).toBe((value + 5n) % 2n ** 256n);
      expect(await parked(key)).toBe(0n);
    });

    it("refuses a callback from anyone but Entropy, and an id delivered again", async () => {
      const { sequence } = await requestEntropy(ENTROPY_SOURCE, [0n]);
      const callback = concat([
        ENTROPY_CALLBACK,
        encodeAbiParameters(
          [{ type: "uint64" }, { type: "address" }, { type: "bytes32" }],
          [sequence, PROVIDER, word(1n)],
        ),
      ]);
      expect((await callAs(STRANGER.address, stack.pot, callback)).reason).toBe(
        "async: the call is not from the protocol",
      );
      const reveal = encodeFunctionData({
        abi: ENTROPY_MOCK.abi,
        functionName: "reveal",
        args: [PROVIDER, sequence, word(42n)],
      });
      expect((await send(stranger, ENTROPY, reveal)).status).toBe("success");
      expect(await storage(SLOT)).toBe(42n);
      expect((await callAs(ENTROPY, stack.pot, callback)).reason).toBe(
        "async: nothing is parked under this key",
      );
      // Another provider's request of the same number is another key.
      expect(
        (
          await callAs(
            ENTROPY,
            stack.pot,
            concat([
              ENTROPY_CALLBACK,
              encodeAbiParameters(
                [{ type: "uint64" }, { type: "address" }, { type: "bytes32" }],
                [sequence + 1n, STRANGER.address, word(1n)],
              ),
            ]),
          )
        ).reason,
      ).toBe("async: nothing is parked under this key");
    });

    it("leaves a request whose body reverts open, and its body parked, to be revealed again", async () => {
      const { sequence } = await requestEntropy(ENTROPY_GATED_SOURCE, [1n]);
      const key = entropyKey(PROVIDER, sequence);
      const reveal = encodeFunctionData({
        abi: ENTROPY_MOCK.abi,
        functionName: "reveal",
        args: [PROVIDER, sequence, word(41n)],
      });
      const failed = await send(stranger, ENTROPY, reveal);
      expect(failed.status).toBe("success");
      const [event] = eventsOf(failed, ENTROPY, ENTROPY_MOCK.abi);
      expect((event!.args as { callbackFailed: boolean }).callbackFailed).toBe(true);
      expect(await parked(key)).not.toBe(0n);
      // The gate opens, and the same number revealed again — Entropy's recovery path, with no gas
      // limit — runs the body.
      expect((await cook(compiled(`evm.sstore(${GATE}, 1);`))).status).toBe("success");
      expect((await send(stranger, ENTROPY, reveal)).status).toBe("success");
      expect(await storage(SLOT)).toBe(42n);
      expect(await parked(key)).toBe(0n);
    });
  });
});

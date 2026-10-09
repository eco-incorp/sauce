/**
 * `@sauce/random` EXECUTED: a program requests randomness and pays for it, the provider calls the
 * Pot back, and the promise settles: its `.then` body runs with what arrived — on an anvil running
 * the gated engine and Kitchen with v12 #571's Router, whose fallback runs the handler a Pot
 * registered.
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
 * What is refused: a callback from anyone but the provider (it reverts), a request the Pot cannot pay
 * for and still keep the Kitchen's fee for its callback, and a callback given less gas than the body
 * needs. What is a no-op, the callback returning: an id delivered again or never requested, and a
 * fulfilment after the promise expired. A body that reverts is undone and the callback still
 * returns: `.catch` runs, or the core logs it unhandled, and the delivered value stays in the
 * package's `RandomDelivered` log. A request no provider fulfils rejects by its deadline, through
 * the Pot's `expire(bytes32)`, and `Promise.race` against `Async.timeout` settles either way.
 *
 * GATED twice, as `std/async/evm.e2e.test.ts` is: on SAUCE_V12_RUNTIME_CREATION_HEX and on
 * SAUCE_V12_ROUTER_CREATION_HEX, #571's Router, which no release publishes yet. A `.catch` that
 * reads its reason needs an engine built from the compiler's tree, not the released one: those cases
 * skip on the released engine.
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
  decodeAbiParameters,
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
  type TestClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../../../src/chains/canonical.js";
import { contractAddressOn } from "../../../src/routes/chain-module.js";
import { registryTokens } from "../../../src/routes/token-registry.js";
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
/** The core runs a body under `.catch((e) => …)` to settle it whatever it does, and a catch that
 *  reads `e` loses its work on the released engine (see `std/async`'s suite): a body that reverts, a
 *  `.catch` handed its reason, and a combinator settling need an engine built from the compiler's
 *  tree, and skip on the released one. */
const RELEASED_ENGINE =
  RUNTIME_HEX_PATH !== undefined &&
  readFileSync(RUNTIME_HEX_PATH, "utf8").trim().toLowerCase() ===
    (
      JSON.parse(
        readFileSync(
          join(
            dirname(fileURLToPath(import.meta.url)),
            "../../../src/artifacts/V12RuntimeBytecode.json",
          ),
          "utf8",
        ),
      ) as { runtimeCreationCode: string }
    ).runtimeCreationCode.toLowerCase();
const itOnStackEngine = RELEASED_ENGINE ? it.skip : it;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evm", "fixtures");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as {
    abi: Abi;
    runtimeCode: Hex;
  };
/** The `sauce-random` skill's example programs, run here as the skill's usage lines run them. */
const SKILL_EXAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skills/sauce-random/examples",
);
const skillExample = (name: string): string =>
  readFileSync(join(SKILL_EXAMPLES, `${name}.sauce.ts`), "utf8");
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
/** Base's USDC, which the coin flip pays in: OpenZeppelin's ERC20Mock installed at its address. */
const USDC = registryTokens(requireChain(CHAIN)).USDC!.address as Address;
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

/** The Pot's events: the core's, and the package's `RandomDelivered`. */
const PENDING = keccak256(toHex("PromisePending(bytes32,uint256)"));
const SETTLED = keccak256(toHex("PromiseSettled(bytes32,uint256)"));
const IGNORED = keccak256(toHex("PromiseIgnored(bytes32,uint256)"));
const UNHANDLED = keccak256(toHex("PromiseUnhandled(bytes32,bytes)"));
const DELIVERED = keccak256(toHex("RandomDelivered(bytes32,bytes)"));

const potAbi = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
  "function expire(bytes32 key)",
]);
const kitchenAbi = parseAbi(["function setExecutionFee(uint256 fee)"]);

const word = (value: bigint): Hex => toHex(value, { size: 32 });
const slotOf = (key: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [key, NAMESPACE]));
/** `promiseKey(tag, id)`: keccak256(abi.encode(tag, id)). */
const promiseKey = (tag: Address, id: bigint): bigint =>
  BigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [tag, id])));
/** A VRF request's promise: its id under the wrapper. */
const vrfKey = (id: bigint): bigint => promiseKey(WRAPPER, id);
/** An Entropy request's promise: the provider and sequence number under Entropy. */
const entropyKey = (provider: Address, sequence: bigint): bigint =>
  promiseKey(
    ENTROPY,
    BigInt(
      keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [provider, sequence]),
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

/** A VRF request whose body reverts above `limit`, and a `.catch` that records the reason's length. */
const VRF_CATCH_SOURCE = `import { Random } from "@sauce/random";

function main(limit: Uint256): void {
  Random.vrf({ words: 1 })
    .then((words) => {
      require(words[0] < limit, "above the limit");
      evm.sstore(${SLOT}, words[0]);
    })
    .catch((e) => {
      evm.sstore(${CAUGHT}, e.length);
    });
}`;

/** A VRF request whose body reverts above `limit`, with no `.catch`. */
const VRF_UNHANDLED_SOURCE = `import { Random } from "@sauce/random";

function main(limit: Uint256): void {
  Random.vrf({ words: 2 }).then((words) => {
    require(words[0] < limit, "above the limit");
    evm.sstore(${SLOT}, words[0]);
  });
}`;

/** A VRF request whose callback gas is given, too little for the body. */
const VRF_STARVED_SOURCE = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.vrf({ words: 1, gas: 60000 }).then((words) => {
    evm.sstore(${SLOT}, words[0] + bump);
  });
}`;

/** A VRF request that anyone may expire a minute after it is made. */
const VRF_WITHIN_SOURCE = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.vrf({ words: 1 })
    .within(60)
    .then((words) => {
      evm.sstore(${SLOT}, words[0] + bump);
    })
    .catch((e) => {
      evm.sstore(${CAUGHT}, e.length);
    });
}`;

/** A VRF request raced against a one-minute timeout: its callback runs the race's body too, which
 *  its sizing counts. */
const VRF_RACE_SOURCE = `import { Async, Promise } from "@sauce/async";
import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Promise.race([Random.vrf({ words: 1 }), Async.timeout(60)])
    .then((words) => {
      evm.sstore(${SLOT}, words[0] + bump);
    })
    .catch((e) => {
      evm.sstore(${CAUGHT}, e.length);
    });
}`;

/** An Entropy request from the default provider, whose body writes the number plus `bump`. */
const ENTROPY_SOURCE = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.entropy().then((value) => {
    evm.sstore(${SLOT}, value + bump);
  });
}`;

/** An Entropy request whose body reverts below `floor`, with no `.catch`. */
const ENTROPY_FLOOR_SOURCE = `import { Random } from "@sauce/random";

function main(floor: Uint256): void {
  Random.entropy().then((value) => {
    require(value >= floor, "below the floor");
    evm.sstore(${SLOT}, value);
  });
}`;

let anvil: ChildProcess;
let publicClient: PublicClient;
let testClient: TestClient;
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

/** What a call answers or reverts with, replayed as an `eth_call` from `from`, with `gas` and
 *  `value`. */
async function callAs(
  from: Address,
  to: Address,
  data: Hex,
  gas = 15_000_000n,
  value = 0n,
): Promise<{ ok: boolean; data: Hex; reason: string }> {
  const response = (await (
    await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ from, to, data, gas: toHex(gas), value: toHex(value) }, "latest"],
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

/** The Pot's logs in `receipt`, as `[topic0, …topics, data]`. */
const potLogs = (receipt: TransactionReceipt): readonly (readonly Hex[])[] =>
  receipt.logs
    .filter((log) => log.address.toLowerCase() === stack.pot.toLowerCase())
    .map((log) => [...(log.topics as Hex[]), log.data]);

/** The value the package logged as delivered for `key` in `receipt`: `abi.encode` of it. */
function deliveredIn(receipt: TransactionReceipt, key: bigint): Hex | undefined {
  const found = potLogs(receipt).find(([topic, of]) => topic === DELIVERED && of === word(key));
  if (found === undefined) return undefined;
  const [value] = decodeAbiParameters([{ type: "bytes" }], found[found.length - 1]!);

  return value;
}

/** Moves the chain `seconds` on, and mines a block there. */
async function warp(seconds: number): Promise<void> {
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
}

/** A stranger calls the Pot's `expire(key)`, paying the Kitchen's fee for its cook. */
const expire = (key: bigint) =>
  send(
    stranger,
    stack.pot,
    encodeFunctionData({ abi: potAbi, functionName: "expire", args: [word(key)] }),
    FEE,
  );

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
    testClient = createTestClient({ mode: "anvil", transport });
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

    // Base's USDC: the token's code at its address, and a balance for the Pot.
    await testClient.setCode({
      address: USDC,
      bytecode: (await publicClient.getCode({ address: token }))!,
    });
    await send(
      owner,
      USDC,
      encodeFunctionData({
        abi: ERC20_MOCK.abi,
        functionName: "mint",
        args: [stack.pot, 10n ** 12n],
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
      expect(deliveredIn(fulfilled, vrfKey(id))).toBe(
        encodeAbiParameters([{ type: "uint256[]" }], [[7n, 35n]]),
      );
      expect(potLogs(fulfilled)).toContainEqual([SETTLED, word(vrfKey(id)), word(2n)]);

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

    it("lets an id delivered again, or never requested, pass and run nothing", async () => {
      const { id } = await requestVrf(VRF_SOURCE, [0n]);
      expect((await send(stranger, WRAPPER, fulfill(id, [5n, 5n]))).status).toBe("success");
      expect(await storage(SLOT)).toBe(10n);
      for (const again of [id, id + 1n]) {
        const replayed = await send(
          stranger,
          WRAPPER,
          encodeFunctionData({
            abi: WRAPPER_MOCK.abi,
            functionName: "deliver",
            args: [stack.pot, again, [9n, 9n], 1_000_000],
          }),
        );
        expect(replayed.status).toBe("success");
        // The callback returned: the wrapper logs no failure, and the Pot logs the promise ignored.
        expect(eventsOf(replayed, WRAPPER, WRAPPER_MOCK.abi)).toEqual([]);
        expect(potLogs(replayed)).toContainEqual([IGNORED, word(vrfKey(again)), word(0n)]);
        expect(await storage(SLOT)).toBe(10n);
      }
    });

    itOnStackEngine(
      "runs `.catch` in the body's place when the body reverts, with its reason",
      async () => {
        const { id } = await requestVrf(VRF_CATCH_SOURCE, [100n]);
        const fulfilled = await send(stranger, WRAPPER, fulfill(id, [500n]));
        expect(fulfilled.status).toBe("success");
        expect(eventsOf(fulfilled, WRAPPER, WRAPPER_MOCK.abi)).toEqual([]);
        expect(await storage(CAUGHT)).toBe(BigInt("above the limit".length));
        expect(await parked(vrfKey(id))).toBe(0n);
      },
    );

    itOnStackEngine(
      "returns from a callback whose body reverts with no `.catch`, the words kept in its log",
      async () => {
        const before = await storage(SLOT);
        const { id } = await requestVrf(VRF_UNHANDLED_SOURCE, [100n]);
        const fulfilled = await send(stranger, WRAPPER, fulfill(id, [500n, 1n]));
        expect(fulfilled.status).toBe("success");
        // Not spent as a failure: the wrapper saw the callback return.
        expect(eventsOf(fulfilled, WRAPPER, WRAPPER_MOCK.abi)).toEqual([]);
        expect(await storage(SLOT)).toBe(before);
        expect(
          potLogs(fulfilled).some(([topic, of]) => topic === UNHANDLED && of === word(vrfKey(id))),
        ).toBe(true);
        // What arrived, for the owner to act on.
        expect(deliveredIn(fulfilled, vrfKey(id))).toBe(
          encodeAbiParameters([{ type: "uint256[]" }], [[500n, 1n]]),
        );
        expect(await parked(vrfKey(id))).toBe(0n);
      },
    );

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

    it("refuses a request the Pot cannot pay and still keep the Kitchen's fee for its callback", async () => {
      const balance = await publicClient.getBalance({ address: stack.pot });
      await testClient.setBalance({ address: stack.pot, value: 0n });
      const program = compiled(VRF_SOURCE, [0n]);
      const refused = await callAs(
        OWNER.address,
        stack.pot,
        encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] }),
        15_000_000n,
        FEE,
      );
      expect(refused.ok).toBe(false);
      expect(refused.reason).toContain(
        "random: the Pot cannot pay the request and keep the Kitchen's fee for its callback",
      );
      expect((await cook(program)).status).toBe("reverted");
      await testClient.setBalance({ address: stack.pot, value: balance });
    });

    itOnStackEngine(
      "rejects a request past its deadline through the Pot's expire; a late fulfilment is a no-op",
      async () => {
        const before = await storage(SLOT);
        const { id } = await requestVrf(VRF_WITHIN_SOURCE, [0n]);
        const key = vrfKey(id);
        // Not yet.
        expect((await expire(key)).status).toBe("reverted");
        expect(await parked(key)).not.toBe(0n);

        await warp(61);
        const expired = await expire(key);
        expect(expired.status).toBe("success");
        expect(await storage(CAUGHT)).toBe(36n); // Timeout(bytes32): a selector and the key
        expect(await parked(key)).toBe(0n);

        // The words arrive after all: the callback returns and runs nothing.
        const late = await send(stranger, WRAPPER, fulfill(id, [77n]));
        expect(late.status).toBe("success");
        expect(eventsOf(late, WRAPPER, WRAPPER_MOCK.abi)).toEqual([]);
        expect(potLogs(late)).toContainEqual([IGNORED, word(key), word(0n)]);
        expect(await storage(SLOT)).toBe(before);
      },
    );

    describe("raced against Async.timeout", () => {
      /** Requests, answering the request id and the timeout's key: the one promise parked with a
       *  deadline. */
      async function race(): Promise<{ id: bigint; timeout: bigint }> {
        const { id, receipt } = await requestVrf(VRF_RACE_SOURCE, [1_000n]);
        const timed = potLogs(receipt).filter(
          ([topic, , data]) => topic === PENDING && BigInt(data!) !== 0n,
        );
        expect(timed).toHaveLength(1);

        return { id, timeout: BigInt(timed[0]![1]!) };
      }

      itOnStackEngine(
        "settles with the words when they arrive first; the timeout, expired later, is a no-op",
        async () => {
          await testClient.setStorageAt({ address: stack.pot, index: SLOT, value: word(0n) });
          await testClient.setStorageAt({ address: stack.pot, index: CAUGHT, value: word(0n) });
          const { id, timeout } = await race();
          // Sized for the race's body as well as the request's part.
          const asked = await callbackGasOf(id);
          const least = await leastCallbackGas(id, [5n]);
          expect(least).toBeLessThanOrEqual(asked);
          expect(asked).toBeLessThan(least * 3n);
          expect((await send(stranger, WRAPPER, fulfill(id, [5n]))).status).toBe("success");
          expect(await storage(SLOT)).toBe(1_005n);

          await warp(61);
          const expired = await expire(timeout);
          expect(expired.status).toBe("success");
          expect(await storage(CAUGHT)).toBe(0n);
          expect(await storage(SLOT)).toBe(1_005n);
        },
      );

      itOnStackEngine(
        "rejects with the timeout when it expires first; the words, arriving late, are a no-op",
        async () => {
          await testClient.setStorageAt({ address: stack.pot, index: SLOT, value: word(0n) });
          await testClient.setStorageAt({ address: stack.pot, index: CAUGHT, value: word(0n) });
          const { id, timeout } = await race();
          await warp(61);
          expect((await expire(timeout)).status).toBe("success");
          expect(await storage(CAUGHT)).toBe(36n);

          const late = await send(stranger, WRAPPER, fulfill(id, [5n]));
          expect(late.status).toBe("success");
          expect(eventsOf(late, WRAPPER, WRAPPER_MOCK.abi)).toEqual([]);
          expect(await storage(SLOT)).toBe(0n);
        },
      );
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

    it("refuses a callback from anyone but Entropy; one delivered again, or for another provider, is a no-op", async () => {
      const { sequence } = await requestEntropy(ENTROPY_SOURCE, [0n]);
      const callback = (seq: bigint, provider: Address) =>
        concat([
          ENTROPY_CALLBACK,
          encodeAbiParameters(
            [{ type: "uint64" }, { type: "address" }, { type: "bytes32" }],
            [seq, provider, word(1n)],
          ),
        ]);
      expect((await callAs(STRANGER.address, stack.pot, callback(sequence, PROVIDER))).reason).toBe(
        "async: the call is not from the protocol",
      );
      const reveal = encodeFunctionData({
        abi: ENTROPY_MOCK.abi,
        functionName: "reveal",
        args: [PROVIDER, sequence, word(42n)],
      });
      expect((await send(stranger, ENTROPY, reveal)).status).toBe("success");
      expect(await storage(SLOT)).toBe(42n);
      for (const [seq, provider] of [
        [sequence, PROVIDER],
        [sequence, STRANGER.address],
      ] as const) {
        const again = await send(
          stranger,
          ENTROPY,
          encodeFunctionData({
            abi: ENTROPY_MOCK.abi,
            functionName: "deliver",
            args: [stack.pot, seq, provider, word(9n)],
          }),
        );
        expect(again.status).toBe("success");
        expect(potLogs(again)).toContainEqual([IGNORED, word(entropyKey(provider, seq)), word(0n)]);
        expect(await storage(SLOT)).toBe(42n);
      }
    });

    itOnStackEngine(
      "returns from a callback whose body reverts, so Entropy records no failure, the number kept in its log",
      async () => {
        const before = await storage(SLOT);
        const { sequence } = await requestEntropy(ENTROPY_FLOOR_SOURCE, [1_000n]);
        const key = entropyKey(PROVIDER, sequence);
        const revealed = await send(
          stranger,
          ENTROPY,
          encodeFunctionData({
            abi: ENTROPY_MOCK.abi,
            functionName: "reveal",
            args: [PROVIDER, sequence, word(7n)],
          }),
        );
        expect(revealed.status).toBe("success");
        const [event] = eventsOf(revealed, ENTROPY, ENTROPY_MOCK.abi);
        expect((event!.args as { callbackFailed: boolean }).callbackFailed).toBe(false);
        expect(await storage(SLOT)).toBe(before);
        expect(
          potLogs(revealed).some(([topic, of]) => topic === UNHANDLED && of === word(key)),
        ).toBe(true);
        expect(deliveredIn(revealed, key)).toBe(word(7n));
        expect(await parked(key)).toBe(0n);
      },
    );
  });

  describe("the sauce-random skill's examples", () => {
    const HEADS = "0x00000000000000000000000000000000000000c1" as Address;
    const TAILS = "0x00000000000000000000000000000000000000c2" as Address;
    const usdcOf = async (holder: Address): Promise<bigint> =>
      (await publicClient.readContract({
        address: USDC,
        abi: ERC20_MOCK.abi,
        functionName: "balanceOf",
        args: [holder],
      })) as bigint;

    it("sauce-random/examples/coin-flip pays heads on an even word and tails on an odd one", async () => {
      for (const [drawn, winner] of [
        [8n, HEADS],
        [9n, TAILS],
      ] as const) {
        const before = await usdcOf(winner);
        const program = compileSauceProgram(CHAIN, skillExample("coin-flip"));
        const receipt = await cook(
          bytesToHex(
            concat([program.bytecode, encodeEntryArguments(program, [HEADS, TAILS, 5_000_000n])]),
          ),
        );
        expect(receipt.status).toBe("success");
        const [requested] = eventsOf(receipt, WRAPPER, WRAPPER_MOCK.abi);
        const id = (requested!.args as { requestId: bigint }).requestId;
        expect(await parked(vrfKey(id))).not.toBe(0n);
        expect((await send(stranger, WRAPPER, fulfill(id, [drawn]))).status).toBe("success");
        expect((await usdcOf(winner)) - before).toBe(5_000_000n);
      }
    });

    itOnStackEngine(
      "sauce-random/examples/draw pays the entrant the number picks, within the hour",
      async () => {
        const entrants = [
          "0x00000000000000000000000000000000000000d1",
          "0x00000000000000000000000000000000000000d2",
          "0x00000000000000000000000000000000000000d3",
        ] as const;
        const prize = 10n ** 16n;
        const program = compileSauceProgram(CHAIN, skillExample("draw"));
        const receipt = await cook(
          bytesToHex(
            concat([program.bytecode, encodeEntryArguments(program, [...entrants, prize])]),
          ),
        );
        expect(receipt.status).toBe("success");
        const [requested] = eventsOf(receipt, ENTROPY, ENTROPY_MOCK.abi);
        const sequence = (requested!.args as { sequenceNumber: bigint }).sequenceNumber;
        const before = await publicClient.getBalance({ address: entrants[2] });
        const revealed = await send(
          stranger,
          ENTROPY,
          encodeFunctionData({
            abi: ENTROPY_MOCK.abi,
            functionName: "reveal",
            args: [PROVIDER, sequence, word(3_002n)], // 3002 % 3 == 2: the third entrant
          }),
        );
        expect(revealed.status).toBe("success");
        expect((await publicClient.getBalance({ address: entrants[2] })) - before).toBe(prize);
      },
    );
  });
});

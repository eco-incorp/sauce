/**
 * `@sauce/remote` EXECUTED: a program on one chain runs code on the same Private Pot on another, over
 * each of the four bridges, on two anvils standing in for Ethereum and Base, each running the gated
 * engine and Kitchen with v12 #571's Router (whose fallback runs the handler a Pot registered for a
 * selector). The Pot is the one the harness mints on both, by the same owner and salt, so it has
 * the same address on both, as a Private Pot has on every chain its owner mints it on.
 *
 * The bridges are their own contracts, planted at the addresses the SDK records for each chain
 * (`bridges.ts`): Hyperlane's Mailbox, LayerZero's EndpointV2 with its SimpleMessageLib, Metalayer's
 * router and its mailbox, Polymer's deployed prover. What a relayer, an executor or Polymer's
 * sequencer does off chain, the suite does.
 *
 * Each step runs as a user would run it: the owner installs `@sauce/remote`'s handlers on each Pot
 * with the program the SDK writes for the package (`routes/handlers.ts`); the owner cooks a program
 * that sends; the bridge carries the message, and the Pot's Router runs the handler, which checks
 * its caller and the sender and runs the message. And what is refused: a message from any other
 * sender, a handler called by anyone but the bridge, a Polymer proof delivered twice, and a
 * LayerZero path opened from anyone but the Pot.
 *
 * GATED twice, as `@sauce/async`'s suite is: on SAUCE_V12_RUNTIME_CREATION_HEX, as every EVM
 * execution suite is, and on SAUCE_V12_ROUTER_CREATION_HEX, a file of #571's Router creation code,
 * which no release publishes yet. The `.catch` case also needs an engine built from the compiler's
 * own tree, and skips on the released one.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bytesToHex,
  concat,
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  getCreate2Address,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";

import { v12EngineAddress } from "../../../src/deployments/v12-addresses.js";
import { encodeEntryArguments, type EntryValue } from "../../../src/routes/entry.js";
import { handlersInstallSource, packageHandlers } from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import { destinationSetup, remoteNeeds } from "../../../src/cli/remote-setup.js";
import type { ChainReach } from "../../../src/cli/approvals.js";
import type { Sent, TxRequest } from "../../../src/cli/chain.js";
import { potSalt, v12PredictPot } from "../../../src/deployments/pot.js";
import { runCommand, txCommand, type RunInput } from "../../../src/cli/commands.js";
import { nodeIo } from "../../../src/cli/run.js";
import { handlerSlot, handlersInPlace } from "../../../src/cli/handlers.js";
import { DEPLOYER, FEE, RUNTIME_HEX_PATH, startChain, type LocalChain } from "../../cli-anvil.js";
import { gateAnchors, POT_SALT, routerUnderTest } from "../../evm/gated-engine.js";
import {
  HYPERLANE_FEE,
  REMOTE_MESSAGE_TOPIC,
  mailboxAbi,
  packets,
  plantBridges,
  polymerProof,
  relayHyperlane,
  relayLayerZero,
  relayMetalayer,
  verifyPacket,
  executePacket,
  type Bridges,
} from "./bridges.js";

const ROUTER = routerUnderTest();
const describeRemote = RUNTIME_HEX_PATH && ROUTER !== undefined ? describe : describe.skip;
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
/** A round trip settles its promise through `@sauce/async`'s `settleCarried`, whose catch reads the
 *  body's revert: it runs on an engine built from the compiler's tree, and not on the released
 *  one, so every case an answer comes back in skips there. */
const itSettling = RELEASED_ENGINE ? it.skip : it;

/** Anvil's third dev account: a stranger to every Pot. A public key, local only. */
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

const potAbi = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
  "function handle(uint32 origin, bytes32 sender, bytes message) payable",
  "function deliver(bytes proof)",
  "function allowInitializePath((uint32 srcEid, bytes32 sender, uint64 nonce) origin) view returns (bool)",
  "function expire(bytes32 key)",
  "function nextNonce(uint32 srcEid, bytes32 sender) view returns (uint64)",
]);

/** `@sauce/async`'s logs: a promise parked in the table, a callback that found it settled, and a
 *  rejection nothing handled. */
const PROMISE_PENDING = keccak256(toHex("PromisePending(bytes32,uint256)"));
const PROMISE_IGNORED = keccak256(toHex("PromiseIgnored(bytes32,uint256)"));
const PROMISE_UNHANDLED = keccak256(toHex("PromiseUnhandled(bytes32,bytes)"));

/** A Pot storage slot a test's body writes. */
const slot = (name: string): Hex => keccak256(toHex(`remote.${name}`));

let ethereum: LocalChain;
let base: LocalChain;
let optimism: LocalChain;
let ethereumBridges: Bridges;
let baseBridges: Bridges;
let optimismBridges: Bridges;
/** The Pot the harness mints on both chains: the deployer's, under the harness's salt. */
let pot: Address;

const read = async (local: LocalChain, name: string): Promise<bigint> =>
  BigInt((await local.publicClient.getStorageAt({ address: pot, slot: slot(name) })) ?? "0x0");

/** The word at `at` in the Pot's storage on `local`. */
const word = async (local: LocalChain, at: Hex | bigint): Promise<bigint> =>
  BigInt(
    (await local.publicClient.getStorageAt({
      address: pot,
      slot: typeof at === "bigint" ? toHex(at, { size: 32 }) : at,
    })) ?? "0x0",
  );

/** The slot of `key` in the mapping a ported example keeps at keccak256(`name`), as Solidity lays
 *  out a mapping: keccak256(abi.encode(key, base)). */
const entry = (key: bigint | Hex, name: string): Hex =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32"), [
      typeof key === "bigint" ? toHex(key, { size: 32 }) : key,
      keccak256(toHex(name)),
    ]),
  );

/** The bytes a ported example keeps at `at`: their length there, and their words from
 *  keccak256(at) on. */
async function kept(local: LocalChain, at: Hex): Promise<Hex> {
  const length = await word(local, at);
  const first = BigInt(keccak256(at));
  const words: Hex[] = [];
  for (let i = 0n; i * 32n < length; i++)
    words.push(toHex(await word(local, first + i), { size: 32 }));

  return `0x${concat(["0x", ...words]).slice(2, 2 + Number(length) * 2)}`;
}

/** The one log the Pot emitted in `receipt` under `signature`. */
function potLog(
  receipt: TransactionReceipt,
  signature: string,
): TransactionReceipt["logs"][number] {
  const topic = keccak256(toHex(signature));
  const found = receipt.logs.filter(
    (log) => log.address.toLowerCase() === pot.toLowerCase() && log.topics[0] === topic,
  );
  expect(found).toHaveLength(1);

  return found[0]!;
}

/** `local` as a setup step reaches it, the harness's deployer sending (`approvals.ts`'s
 *  `ChainReach`). */
const reachOf = (local: LocalChain): ChainReach => ({
  chain: local.chain,
  client: local.publicClient,
  from: DEPLOYER.address,
  send: async (tx: TxRequest): Promise<Sent> => {
    const hash = await local.deployer.sendTransaction({
      account: DEPLOYER,
      chain: null,
      ...tx,
      gas: 15_000_000n,
    });
    const receipt = await local.publicClient.waitForTransactionReceipt({ hash });

    return {
      hash,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
      logs: receipt.logs,
      receipt,
    };
  },
});

/** A skill's example program, as the file is. */
const example = (name: string): string =>
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      `../../../../skills/sauce-remote/examples/${name}`,
    ),
    "utf8",
  );

/** Cooks `source`, compiled for `local`'s chain with `args` for its `main`, on the Pot (or on
 *  `at`), as its owner, paying the Kitchen's fee; answers the receipt. */
async function cook(
  local: LocalChain,
  source: string,
  args: readonly EntryValue[] = [],
  at: Address = pot,
): Promise<TransactionReceipt> {
  const program = compileSauceProgram(local.chain.slug, source);
  const input = bytesToHex(concat([program.bytecode, encodeEntryArguments(program, args)]));
  const hash = await local.deployer.sendTransaction({
    account: DEPLOYER,
    chain: null,
    to: at,
    data: encodeFunctionData({
      abi: potAbi,
      functionName: "cook",
      args: [v12EngineAddress() as Address, input],
    }),
    value: FEE,
    gas: 15_000_000n,
  });
  const receipt = await local.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`the cook on ${local.chain.slug} reverted`);

  return receipt;
}

/** Whether `data` sent to `to` on `local` from `from` reverts, replayed as a call, and with what. */
async function reverts(
  local: LocalChain,
  from: Address,
  to: Address,
  data: Hex,
): Promise<string | undefined> {
  const response = (await (
    await fetch(local.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ from, to, data, gas: toHex(15_000_000n) }, "latest"],
      }),
    })
  ).json()) as { result?: Hex; error?: { data?: Hex; message?: string } };
  if (response.error === undefined) return undefined;
  const reverted = response.error.data ?? "0x";

  return `${Buffer.from(reverted.slice(2), "hex").toString("utf8")} ${response.error.message ?? ""}`;
}

describeRemote("@sauce/remote between two chains, over each bridge", () => {
  beforeAll(async () => {
    const options = { routerCreationCode: ROUTER };
    [ethereum, base, optimism] = await Promise.all([
      startChain("ethereum", options),
      startChain("base", options),
      startChain("optimism", options),
    ]);
    pot = getCreate2Address({
      bytecodeHash: gateAnchors().potInitCodeHash,
      from: gateAnchors().kitchen,
      salt: keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }],
          [DEPLOYER.address, POT_SALT],
        ),
      ),
    });
    [ethereumBridges, baseBridges, optimismBridges] = await Promise.all([
      plantBridges(ethereum, [base, optimism]),
      plantBridges(base, [ethereum, optimism]),
      plantBridges(optimism, [ethereum, base]),
    ]);
    for (const local of [ethereum, base, optimism]) {
      // The Pot pays each bridge's fee and the Kitchen's for every message it runs.
      await local.deployer.sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: pot,
        value: parseEther("1"),
      });
      // `@sauce/remote`'s handlers, installed as the SDK writes the program for a package.
      await cook(
        local,
        handlersInstallSource(packageHandlers(local.chain.slug, "@sauce/remote"), "@sauce/remote"),
      );
    }
  }, 240_000);

  afterAll(async () => {
    await Promise.all([ethereum?.stop(), base?.stop(), optimism?.stop()]);
  });

  it("the Pot has one address on both chains, and answers each bridge's selector", async () => {
    expect(await ethereum.publicClient.getCode({ address: pot })).toBeDefined();
    expect(await base.publicClient.getCode({ address: pot })).toBe(
      await ethereum.publicClient.getCode({ address: pot }),
    );
    const handlers = packageHandlers("base", "@sauce/remote");
    expect(handlers.map((handler) => handler.signature)).toEqual([
      "handle(uint32,bytes32,bytes)",
      "handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])",
      "lzReceive((uint32,bytes32,uint64),bytes32,bytes,address,bytes)",
      "allowInitializePath((uint32,bytes32,uint64))",
      "nextNonce(uint32,bytes32)",
      "deliver(bytes)",
      // @sauce/async's, which every package installs: anyone may expire a promise past its deadline.
      "expire(bytes32)",
    ]);
  });

  it("runs a body on Base, sent over Hyperlane from Ethereum", async () => {
    const before = await ethereum.publicClient.getBalance({ address: pot });
    const receipt = await cook(
      ethereum,
      `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(${slot("hyperlane")}, value);
  });
}`,
      [41n],
    );
    // The Pot paid the Mailbox's quote, and the cook's fee came with the cook.
    expect(before - (await ethereum.publicClient.getBalance({ address: pot }))).toBe(HYPERLANE_FEE);
    await relayHyperlane(receipt, ethereumBridges, base, baseBridges);
    expect(await read(base, "hyperlane")).toBe(41n);
    expect(await read(ethereum, "hyperlane")).toBe(0n);
  }, 120_000);

  it("runs a body on Base, sent over LayerZero, whose path the Pot opens read-only, with no fee", async () => {
    const receipt = await cook(
      ethereum,
      `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(${slot("layerzero")}, value);
  }, { via: "layerzero", gas: 400000 });
}`,
      [42n],
    );
    const [packet] = packets(receipt, ethereumBridges);
    expect(packet).toBeDefined();
    // The endpoint verifies the path's first message only once the receiver's
    // `allowInitializePath` says yes: the read-only handler, run with no Kitchen fee.
    const balance = await base.publicClient.getBalance({ address: pot });
    await verifyPacket(packet!, base, baseBridges);
    expect(await base.publicClient.getBalance({ address: pot })).toBe(balance);
    await executePacket(packet!, base, baseBridges);
    expect(await read(base, "layerzero")).toBe(42n);
    // The path opens only from this Pot, and delivers in any order.
    const origin = (sender: Hex) => ({ srcEid: 30101, sender, nonce: 1n });
    expect(
      await base.publicClient.readContract({
        address: pot,
        abi: potAbi,
        functionName: "allowInitializePath",
        args: [origin(pad(pot))],
      }),
    ).toBe(true);
    expect(
      await base.publicClient.readContract({
        address: pot,
        abi: potAbi,
        functionName: "allowInitializePath",
        args: [origin(pad(STRANGER.address))],
      }),
    ).toBe(false);
    expect(
      await base.publicClient.readContract({
        address: pot,
        abi: potAbi,
        functionName: "nextNonce",
        args: [30101, pad(pot)],
      }),
    ).toBe(0n);
  }, 120_000);

  it("runs a body on Base, sent over Metalayer", async () => {
    const receipt = await cook(
      ethereum,
      `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(${slot("metalayer")}, value);
  }, { via: "metalayer" });
}`,
      [43n],
    );
    await relayMetalayer(receipt, ethereumBridges, base, baseBridges);
    expect(await read(base, "metalayer")).toBe(43n);
  }, 120_000);

  it("runs a body on Base from a Polymer proof anyone submits, once", async () => {
    const receipt = await cook(
      ethereum,
      `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(${slot("polymer")}, evm.sload(${slot("polymer")}) + value);
  }, { via: "polymer" });
}`,
      [44n],
    );
    const index = receipt.logs.findIndex(
      (log) =>
        log.address.toLowerCase() === pot.toLowerCase() && log.topics[0] === REMOTE_MESSAGE_TOPIC,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const proof = await polymerProof(ethereum, receipt, index, base, baseBridges);
    const deliver = encodeFunctionData({ abi: potAbi, functionName: "deliver", args: [proof] });
    const stranger = createWalletClient({ account: STRANGER, transport: http(base.rpcUrl) });
    await base.send(stranger, pot, deliver);
    expect(await read(base, "polymer")).toBe(44n);
    // The same proof again: refused, and the body has run once.
    expect(await reverts(base, STRANGER.address, pot, deliver)).toContain(
      "remote: proof already delivered",
    );
    expect(await read(base, "polymer")).toBe(44n);
  }, 120_000);

  itSettling(
    "comes back to Ethereum with what the body returned on Base",
    async () => {
      const out = await cook(
        ethereum,
        `function main(bump: Uint256) {
  Base.remote(() => {
    return ctx.chainId() * 1000;
  }).then((result) => {
    const [n] = abi.decode(result, ["Uint256"]);
    evm.sstore(${slot("round")}, n + bump + ctx.chainId());
  });
}`,
        [7n],
      );
      const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      const back = await base.publicClient.getTransactionReceipt({ hash: there! });
      await relayHyperlane(back, baseBridges, ethereum, ethereumBridges);
      // 8453000 from Base, 7 the program captured, 1 Ethereum's own chain id: the `.then` ran here.
      expect(await read(ethereum, "round")).toBe(8_453_000n + 7n + 1n);
    },
    120_000,
  );

  itSettling(
    "runs the skill's example: pays on Base, and records back on Ethereum what is left there",
    async () => {
      const recipient = "0x000000000000000000000000000000000000beef" as Address;
      const amount = parseEther("0.001");
      const out = await cook(ethereum, example("pay-on-base.sauce.ts"), [recipient, amount]);
      const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      expect(await base.publicClient.getBalance({ address: recipient })).toBe(amount);
      const left = await base.publicClient.getBalance({ address: pot });
      const back = await base.publicClient.getTransactionReceipt({ hash: there! });
      await relayHyperlane(back, baseBridges, ethereum, ethereumBridges);
      // What the Pot held on Base once it paid, before the way back's fee was paid from it.
      const recorded = BigInt(
        (await ethereum.publicClient.getStorageAt({
          address: pot,
          slot: keccak256(toHex("base.balance")),
        })) ?? "0x0",
      );
      expect(recorded).toBe(left + HYPERLANE_FEE);
    },
    120_000,
  );

  // The bridges' own examples, ported: each skill example runs as its usage line runs it, from
  // Ethereum, and leaves on both chains what the original contracts would.

  it("runs Hyperlane's Hello World, ported: counts and logs the send here and the receipt on Base", async () => {
    const message = "Hello, Base";
    const out = await cook(ethereum, example("hello-world.sauce.ts"), [message]);
    const sent = potLog(out, "SentHelloWorld(uint32,uint32,string)");
    expect(sent.topics.slice(1)).toEqual([toHex(1, { size: 32 }), toHex(8453, { size: 32 })]);
    expect(decodeAbiParameters(parseAbiParameters("string"), sent.data)).toEqual([message]);
    expect(await word(ethereum, keccak256(toHex("helloworld.sent")))).toBe(1n);
    expect(await word(ethereum, entry(8453n, "helloworld.sentTo"))).toBe(1n);

    const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
    const delivered = await base.publicClient.getTransactionReceipt({ hash: there! });
    const received = potLog(delivered, "ReceivedHelloWorld(uint32,uint32,bytes32,string)");
    expect(received.topics.slice(1)).toEqual([toHex(1, { size: 32 }), toHex(8453, { size: 32 })]);
    expect(decodeAbiParameters(parseAbiParameters("bytes32, string"), received.data)).toEqual([
      pad(pot).toLowerCase(),
      message,
    ]);
    expect(await word(base, keccak256(toHex("helloworld.received")))).toBe(1n);
    expect(await word(base, entry(1n, "helloworld.receivedFrom"))).toBe(1n);
    expect(await word(base, keccak256(toHex("helloworld.sent")))).toBe(0n);
  }, 120_000);

  it("runs LayerZero's OApp example, ported: Base keeps the last string it received", async () => {
    const lastMessage = keccak256(toHex("myoapp.lastMessage"));
    for (const text of [
      "Hello from Ethereum",
      "A string longer than one word, which Base keeps a word to a slot, three of them",
    ]) {
      const out = await cook(ethereum, example("my-oapp.sauce.ts"), [text]);
      await relayLayerZero(out, ethereumBridges, base, baseBridges);
      expect(await kept(base, lastMessage)).toBe(toHex(text));
    }
    expect(await word(ethereum, lastMessage)).toBe(0n);
  }, 120_000);

  itSettling(
    "runs Metalayer's block-height reader, ported: Base's block number, logged back on Ethereum",
    async () => {
      const out = await cook(ethereum, example("block-height.sauce.ts"));
      const [there] = await relayMetalayer(out, ethereumBridges, base, baseBridges);
      const delivered = await base.publicClient.getTransactionReceipt({ hash: there! });
      const [back] = await relayMetalayer(delivered, baseBridges, ethereum, ethereumBridges);
      const answered = await ethereum.publicClient.getTransactionReceipt({ hash: back! });
      const logged = potLog(answered, "BlockHeightReceived(uint32,address,uint256)");
      expect(
        decodeAbiParameters(parseAbiParameters("uint32, address, uint256"), logged.data),
      ).toEqual([8453, pot, delivered.blockNumber]);
    },
    120_000,
  );

  it("runs Polymer's State Sync, ported: Base takes each version once, and never an older one", async () => {
    const key = "greeting";
    const hashedKey = keccak256(concat([pot, toHex(key)]));
    const write = async (value: Hex) => {
      const out = await cook(ethereum, example("state-sync.sauce.ts"), [key, value]);
      const index = out.logs.findIndex(
        (log) =>
          log.address.toLowerCase() === pot.toLowerCase() && log.topics[0] === REMOTE_MESSAGE_TOPIC,
      );
      const proof = await polymerProof(ethereum, out, index, base, baseBridges);

      return {
        out,
        deliver: encodeFunctionData({ abi: potAbi, functionName: "deliver", args: [proof] }),
      };
    };
    const stranger = createWalletClient({ account: STRANGER, transport: http(base.rpcUrl) });

    const first = await write("0x68656c6c6f");
    const set = potLog(first.out, "ValueSet(address,string,bytes,uint256,bytes32,uint256)");
    expect(set.topics.slice(1)).toEqual([pad(pot).toLowerCase(), hashedKey]);
    expect(
      decodeAbiParameters(parseAbiParameters("string, bytes, uint256, uint256"), set.data),
    ).toEqual([key, "0x68656c6c6f", 0n, 1n]);
    expect(await kept(ethereum, entry(hashedKey, "statesync.store"))).toBe("0x68656c6c6f");
    expect(await word(ethereum, entry(hashedKey, "statesync.keyVersions"))).toBe(1n);

    const delivered = await base.publicClient.waitForTransactionReceipt({
      hash: await base.send(stranger, pot, first.deliver),
    });
    const updated = potLog(delivered, "ValueUpdated(bytes32,bytes,uint256)");
    expect(updated.topics.slice(1)).toEqual([hashedKey]);
    expect(decodeAbiParameters(parseAbiParameters("bytes, uint256"), updated.data)).toEqual([
      "0x68656c6c6f",
      1n,
    ]);
    expect(await kept(base, entry(hashedKey, "statesync.store"))).toBe("0x68656c6c6f");

    // Two more versions, their proofs submitted out of order: the newer is taken, the older refused.
    const second = await write(toHex("hello again"));
    const third = await write(toHex("hello a third time"));
    await base.send(stranger, pot, third.deliver);
    expect(await reverts(base, STRANGER.address, pot, second.deliver)).toContain(
      "Version must be newer than current version",
    );
    expect(await kept(base, entry(hashedKey, "statesync.store"))).toBe(toHex("hello a third time"));
    expect(await word(base, entry(hashedKey, "statesync.keyVersions"))).toBe(3n);
  }, 120_000);

  it("sets up a Pot on Base a message cannot reach yet, and the message then runs there", async () => {
    const salt = `0x${"00".repeat(31)}52` as Hex;
    const owner = DEPLOYER.address;
    const fresh = getAddress(v12PredictPot(owner, salt));
    const setup = () =>
      destinationSetup([{ chain: base.chain, bridge: "hyperlane" }], {
        owner,
        salt,
        reach: async () => reachOf(base),
        estimate: async () => "estimated",
      });

    // Nothing on Base yet: the Pot deployed, its Hyperlane receiver installed, the Kitchen's fee.
    const steps = await setup();
    expect(steps.map((step) => [step.planned.setup, step.planned.chainId])).toEqual([
      ["deploy", 8453],
      ["install", 8453],
      ["fund", 8453],
    ]);
    expect(steps[1]!.action).toBe("install the Hyperlane receiver on your Pot on Base");
    // Exactly the Kitchen's fee for the one delivery, which the Pot sends value for.
    expect(BigInt(steps[2]!.planned.value)).toBe(FEE);
    expect(steps[2]!.action).toBe(
      `fund your Pot on Base with ${formatEther(FEE)} ETH (1 delivery × the Kitchen fee)`,
    );
    for (const step of steps) await step.send();
    expect(await base.publicClient.getCode({ address: fresh })).toBeDefined();
    expect(await setup()).toEqual([]);
    // The harness's Pot, every receiver installed as the Router recorded it, needs nothing.
    expect(getAddress(v12PredictPot(owner, POT_SALT))).toBe(getAddress(pot));
    expect(
      await destinationSetup(
        (["hyperlane", "layerzero", "metalayer", "polymer"] as const).map((bridge) => ({
          chain: base.chain,
          bridge,
        })),
        {
          owner,
          salt: POT_SALT,
          reach: async () => ({ chain: base.chain, client: base.publicClient, from: owner }),
          estimate: async () => "estimated",
        },
      ),
    ).toEqual([]);

    // The same Pot on Ethereum, minted and funded, sends; Base runs it.
    await reachOf(ethereum).send!({
      to: gateAnchors().kitchen,
      data: encodeFunctionData({
        abi: parseAbi(["function deployPot(address owner, bytes32 salt) returns (address)"]),
        functionName: "deployPot",
        args: [owner, salt],
      }),
      value: 0n,
    });
    await reachOf(ethereum).send!({ to: fresh, data: "0x", value: parseEther("0.01") });
    const out = await cook(
      ethereum,
      `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(${slot("setup")}, value);
  });
}`,
      [52n],
      fresh,
    );
    await relayHyperlane(out, ethereumBridges, base, baseBridges);
    expect(
      BigInt(
        (await base.publicClient.getStorageAt({ address: fresh, slot: slot("setup") })) ?? "0x0",
      ),
    ).toBe(52n);
  }, 120_000);

  itSettling(
    "readies a fresh Pot on Base for a round trip, the answer's fee quoted; the cook installs its own receiver, and the round trip completes",
    async () => {
      const salt = `0x${"00".repeat(31)}53` as Hex;
      const owner = DEPLOYER.address;
      const fresh = getAddress(v12PredictPot(owner, salt));
      const source = `function main(bump: Uint256) {
  Base.remote(() => {
    return ctx.chainId() * 1000;
  }).then((result) => {
    const [n] = abi.decode(result, ["Uint256"]);
    evm.sstore(${slot("fresh.round")}, n + bump);
  });
}`;

      // What the program's message needs, from its compile: Base over Hyperlane, answered back.
      const needs = remoteNeeds(compileSauceProgram("ethereum", source).continuations);
      expect(
        needs.map((need) => [need.chain.slug, need.bridge, need.answer?.to.slug, need.answer?.gas]),
      ).toEqual([["base", "hyperlane", "ethereum", 500_000n]]);
      const bytes = needs[0]!.answer!.bytes;

      const steps = await destinationSetup(needs, {
        owner,
        salt,
        reach: async () => reachOf(base),
        estimate: async () => "estimated",
      });
      expect(steps.map((step) => step.planned.setup)).toEqual(["deploy", "install", "fund"]);
      const fund = steps[2]!;
      expect(BigInt(fund.planned.value)).toBe(FEE + HYPERLANE_FEE);
      expect(fund.planned.quoted).toEqual({ answers: 1, fee: String(HYPERLANE_FEE), bytes });
      expect(fund.action).toBe(
        `fund your Pot on Base with ${formatEther(FEE + HYPERLANE_FEE)} ETH (1 delivery × the ` +
          `Kitchen fee + the answer's Hyperlane fee, quoted for up to ${bytes} bytes)`,
      );
      for (const step of steps) await step.send();

      // The same Pot on Ethereum, minted and funded for the message it sends and the Kitchen's fee of
      // the answer it runs; the cook's request installs the receiver the answer reaches.
      const ethereumReach = reachOf(ethereum);
      await ethereumReach.send!({
        to: gateAnchors().kitchen,
        data: encodeFunctionData({
          abi: parseAbi(["function deployPot(address owner, bytes32 salt) returns (address)"]),
          functionName: "deployPot",
          args: [owner, salt],
        }),
        value: 0n,
      });
      await ethereumReach.send!({ to: fresh, data: "0x", value: HYPERLANE_FEE + FEE });
      const receiver = packageHandlers("ethereum", "@sauce/remote")
        .filter((handler) => handler.signature === "handle(uint32,bytes32,bytes)")
        .map((handler) => ({ ...handler, selector: BigInt(handler.selector) }));
      expect(await handlersInPlace(ethereum.publicClient, fresh, receiver)).toBe(false);

      const out = await cook(ethereum, source, [7n], fresh);
      expect(await handlersInPlace(ethereum.publicClient, fresh, receiver)).toBe(true);
      const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      const back = await base.publicClient.getTransactionReceipt({ hash: there! });
      await relayHyperlane(back, baseBridges, ethereum, ethereumBridges);
      expect(
        BigInt(
          (await ethereum.publicClient.getStorageAt({
            address: fresh,
            slot: slot("fresh.round"),
          })) ?? "0x0",
        ),
      ).toBe(8_453_000n + 7n);
      // Base's Pot paid the Kitchen and the answer's fee out of exactly what it was funded.
      expect(await base.publicClient.getBalance({ address: fresh })).toBe(0n);
    },
    120_000,
  );

  itSettling(
    "sauce tx plans the far Pot's setup before the cook, and sauce run sends it, approved once",
    async () => {
      const key = generatePrivateKey();
      const owner = privateKeyToAccount(key).address;
      const salt = potSalt("remote-setup");
      const fresh = getAddress(v12PredictPot(owner, salt));
      for (const local of [ethereum, base]) {
        await local.testClient.setBalance({ address: owner, value: parseEther("10") });
      }
      const text = `function main(bump: Uint256) {
  Base.remote(() => {
    return ctx.chainId() * 1000;
  }).then((result) => {
    const [n] = abi.decode(result, ["Uint256"]);
    evm.sstore(${slot("command.round")}, n + bump);
  });
}
`;
      const input = (approve: (action: string) => boolean): RunInput => ({
        file: "round.sauce.ts",
        text,
        chain: ethereum.chain,
        defines: {},
        compactArgs: false,
        intents: {},
        target: { owner, salt },
        args: { from: "--args", values: ["7"] },
        // The Kitchen's fee for the cook, the message's Hyperlane fee, and the Kitchen's fee for
        // the answer this Pot runs: what the Pot spends here, sent with the cook.
        value: FEE + HYPERLANE_FEE + FEE,
        rpcUrl: ethereum.rpcUrl,
        endpointOf: (chain) => (chain.id === base.chain.id ? base.rpcUrl : undefined),
        account: privateKeyToAccount(key),
        approver: { auto: true, canAsk: true, approve: async (action) => approve(action) },
      });

      // Unsigned: the Pot here, then the Pot on Base readied, then the cook.
      const plan = await txCommand(
        input(() => false),
        nodeIo(),
      );
      const transactions = plan.json.transactions as Array<{
        what: string;
        setup?: string;
        chainId?: number;
        value: string;
        quoted?: { answers: number; fee: string; bytes: number };
      }>;
      expect(
        transactions.map((tx) => [tx.setup ?? tx.what.split("(")[0], tx.chainId ?? null]),
      ).toEqual([
        ["Kitchen.deployPot", null],
        ["deploy", 8453],
        ["install", 8453],
        ["fund", 8453],
        [expect.stringMatching(/^cook on Pot /), null],
      ]);
      expect(BigInt(transactions[3]!.value)).toBe(FEE + HYPERLANE_FEE);
      expect(transactions[3]!.quoted).toMatchObject({ answers: 1, fee: String(HYPERLANE_FEE) });
      expect(plan.cast).toContain("<BASE_RPC_URL>");

      // Signed: one approval for all four, sent in order, then the cook.
      const approved: string[] = [];
      const done = await runCommand(
        input((action) => (approved.push(action), true)),
        nodeIo(),
      );
      expect(approved).toEqual([
        `deploy Pot ${fresh}`,
        "deploy your Pot on Base",
        "install the Hyperlane receiver on your Pot on Base",
        expect.stringMatching(
          /^fund your Pot on Base with [\d.]+ ETH \(1 delivery × the Kitchen fee \+ the answer's Hyperlane fee, quoted for up to \d+ bytes\)$/,
        ),
      ]);
      expect(done.json).toMatchObject({ cook: { status: "success" } });

      const out = await ethereum.publicClient.getTransactionReceipt({
        hash: (done.json.cook as { hash: Hex }).hash,
      });
      const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      const back = await base.publicClient.getTransactionReceipt({ hash: there! });
      await relayHyperlane(back, baseBridges, ethereum, ethereumBridges);
      expect(
        BigInt(
          (await ethereum.publicClient.getStorageAt({
            address: fresh,
            slot: slot("command.round"),
          })) ?? "0x0",
        ),
      ).toBe(8_453_000n + 7n);
      expect(await base.publicClient.getBalance({ address: fresh })).toBe(0n);
    },
    120_000,
  );

  itSettling(
    "runs a .then with no parameter back on Ethereum, once the body ran on Base",
    async () => {
      const out = await cook(
        ethereum,
        `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(${slot("after.there")}, value);
  }, { via: "layerzero" }).then(() => {
    evm.sstore(${slot("after.here")}, value + 1);
  });
}`,
        [9n],
      );
      const [there] = await relayLayerZero(out, ethereumBridges, base, baseBridges);
      expect(await read(base, "after.there")).toBe(9n);
      expect(await read(ethereum, "after.here")).toBe(0n);
      const back = await base.publicClient.getTransactionReceipt({ hash: there! });
      await relayLayerZero(back, baseBridges, ethereum, ethereumBridges);
      expect(await read(ethereum, "after.here")).toBe(10n);
    },
    120_000,
  );

  it("a body on Base that needs a handler its Pot lacks gets it there, though the Pot here has it", async () => {
    // `expire(bytes32)`, which a promise with a deadline needs: installed on Ethereum's Pot, and
    // missing from Base's, which answers only its bridges' receivers.
    const expire = 0xc6441798n;
    await base.testClient.setStorageAt({
      address: pot,
      index: handlerSlot(expire),
      value: toHex(0n, { size: 32 }),
    });
    const text = `import { Promise } from "@sauce/async";

function main() {
  Base.remote(() => {
    const d = Promise.withResolvers(60);
    d.promise.then((v) => {
      evm.sstore(${slot("scoped.then")}, v.length);
    });
    d.resolve(abi.encode(2));
    evm.sstore(${slot("scoped.direct")}, 77);
  });
}
`;
    // As `sauce run` sends it: the handlers the Pot here has are left out of the cook.
    const done = await runCommand(
      {
        file: "scoped.sauce.ts",
        text,
        chain: ethereum.chain,
        defines: {},
        compactArgs: false,
        intents: {},
        target: { owner: DEPLOYER.address, salt: POT_SALT },
        args: { from: "--args", values: [] },
        value: FEE,
        rpcUrl: ethereum.rpcUrl,
        endpointOf: (chain) => (chain.id === base.chain.id ? base.rpcUrl : undefined),
        account: DEPLOYER,
        approver: { auto: true, canAsk: true, approve: async () => true },
      },
      nodeIo(),
    );
    const out = await ethereum.publicClient.getTransactionReceipt({
      hash: (done.json.cook as { hash: Hex }).hash,
    });
    await relayHyperlane(out, ethereumBridges, base, baseBridges);
    // Delivered, and the body ran on Base: its marker, written after the promise was set up.
    expect(await read(base, "scoped.direct")).toBe(77n);
  }, 120_000);

  // Skipped: await dropped from the compiler (v12 #554). Kept so it can come back if await does.
  it.skip("runs what follows an await back on Ethereum, once the body ran on Base (await dropped from the compiler (v12 #554))", async () => {
    const out = await cook(
      ethereum,
      `function main(value: Uint256) {
  await Base.remote(() => {
    evm.sstore(${slot("awaited.there")}, value);
  }, { via: "layerzero" });
  evm.sstore(${slot("awaited.here")}, value + 1);
}`,
      [9n],
    );
    const [there] = await relayLayerZero(out, ethereumBridges, base, baseBridges);
    expect(await read(base, "awaited.there")).toBe(9n);
    expect(await read(ethereum, "awaited.here")).toBe(0n);
    const back = await base.publicClient.getTransactionReceipt({ hash: there! });
    await relayLayerZero(back, baseBridges, ethereum, ethereumBridges);
    expect(await read(ethereum, "awaited.here")).toBe(10n);
  }, 120_000);

  itSettling(
    "runs the .catch back on Ethereum with what the body reverted with on Base",
    async () => {
      const out = await cook(
        ethereum,
        `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(${slot("caught.there")}, value);
    require(value == 0, "not zero");
  }).then((result) => {
    evm.sstore(${slot("caught.then")}, 1);
  }).catch((e) => {
    evm.sstore(${slot("caught.here")}, crypto.keccak256(e));
  });
}`,
        [5n],
      );
      const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      // The body's write was undone with it.
      expect(await read(base, "caught.there")).toBe(0n);
      const back = await base.publicClient.getTransactionReceipt({ hash: there! });
      await relayHyperlane(back, baseBridges, ethereum, ethereumBridges);
      expect(await read(ethereum, "caught.then")).toBe(0n);
      expect(await read(ethereum, "caught.here")).toBe(BigInt(keccak256(toHex("not zero"))));
    },
    120_000,
  );

  itSettling(
    "rejects a round trip with no .catch whose body reverted: logged unhandled, nothing run",
    async () => {
      const out = await cook(
        ethereum,
        `function main() {
  Base.remote(() => {
    evm.sstore(${slot("unhandled.there")}, 1);
    require(false, "no");
  }).then((r) => {
    evm.sstore(${slot("unhandled.then")}, 1);
  });
}`,
      );
      // Delivered once, its body's write undone: the rejection goes back.
      const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      expect(await read(base, "unhandled.there")).toBe(0n);
      const [back] = await relayHyperlane(
        await base.publicClient.getTransactionReceipt({ hash: there! }),
        baseBridges,
        ethereum,
        ethereumBridges,
      );
      const receipt = await ethereum.publicClient.getTransactionReceipt({ hash: back! });
      expect(receipt.logs.some((log) => log.topics[0] === PROMISE_UNHANDLED)).toBe(true);
      expect(await read(ethereum, "unhandled.then")).toBe(0n);
    },
    120_000,
  );

  itSettling(
    "Promise.all over messages to Base and to Optimism runs its body once both answered",
    async () => {
      const out = await cook(
        ethereum,
        `import { Promise } from "@sauce/async";

function main(bump: Uint256) {
  Promise.all([
    Base.remote(() => {
      return ctx.chainId();
    }),
    Optimism.remote(() => {
      return ctx.chainId() * 2;
    }),
  ]).then((r) => {
    const [a] = abi.decode(r[0], ["Uint256"]);
    const [b] = abi.decode(r[1], ["Uint256"]);
    evm.sstore(${slot("all")}, a * 1000 + b + bump);
  });
}`,
        [3n],
      );
      const [toBase] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      const [toOptimism] = await relayHyperlane(out, ethereumBridges, optimism, optimismBridges);
      // Base answers first: one child of two, and the body waits.
      await relayHyperlane(
        await base.publicClient.getTransactionReceipt({ hash: toBase! }),
        baseBridges,
        ethereum,
        ethereumBridges,
      );
      expect(await read(ethereum, "all")).toBe(0n);
      await relayHyperlane(
        await optimism.publicClient.getTransactionReceipt({ hash: toOptimism! }),
        optimismBridges,
        ethereum,
        ethereumBridges,
      );
      // 8453 from Base, 10 * 2 from Optimism, in the order the program listed them.
      expect(await read(ethereum, "all")).toBe(8_453_000n + 20n + 3n);
    },
    120_000,
  );

  itSettling(
    "Promise.race takes the first answer, and the later one settles nothing",
    async () => {
      const out = await cook(
        ethereum,
        `import { Promise } from "@sauce/async";

function main() {
  Promise.race([
    Base.remote(() => {
      return 1;
    }),
    Optimism.remote(() => {
      return 2;
    }, { via: "layerzero" }),
  ]).then((r) => {
    const [v] = abi.decode(r, ["Uint256"]);
    evm.sstore(${slot("race")}, evm.sload(${slot("race")}) * 10 + v);
  });
}`,
      );
      const [toBase] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      const [toOptimism] = await relayLayerZero(out, ethereumBridges, optimism, optimismBridges);
      // Optimism answers first, over LayerZero: it wins.
      await relayLayerZero(
        await optimism.publicClient.getTransactionReceipt({ hash: toOptimism! }),
        optimismBridges,
        ethereum,
        ethereumBridges,
      );
      expect(await read(ethereum, "race")).toBe(2n);
      // Base's answer arrives: delivered, and the race, decided, ignores it.
      const [late] = await relayHyperlane(
        await base.publicClient.getTransactionReceipt({ hash: toBase! }),
        baseBridges,
        ethereum,
        ethereumBridges,
      );
      const receipt = await ethereum.publicClient.getTransactionReceipt({ hash: late! });
      expect(receipt.status).toBe("success");
      expect(receipt.logs.some((log) => log.topics[0] === PROMISE_IGNORED)).toBe(true);
      expect(await read(ethereum, "race")).toBe(2n);
    },
    120_000,
  );

  itSettling(
    "an answer past the deadline is ignored, once anyone expired the promise into its .catch",
    async () => {
      const out = await cook(
        ethereum,
        `function main() {
  Base.remote(() => {
    return 5;
  }).within(60).then((r) => {
    evm.sstore(${slot("late.then")}, 1);
  }).catch((e) => {
    evm.sstore(${slot("late.caught")}, crypto.keccak256(e));
  });
}`,
      );
      const pending = out.logs.find((log) => log.topics[0] === PROMISE_PENDING);
      const key = pending!.topics[1]!;
      const [there] = await relayHyperlane(out, ethereumBridges, base, baseBridges);
      await ethereum.testClient.increaseTime({ seconds: 120 });
      await ethereum.testClient.mine({ blocks: 1 });
      const stranger = createWalletClient({ account: STRANGER, transport: http(ethereum.rpcUrl) });
      // Anyone, paying the Kitchen's fee the expiry's cook costs the Pot.
      await ethereum.send(
        stranger,
        pot,
        encodeFunctionData({ abi: potAbi, functionName: "expire", args: [key] }),
        FEE,
      );
      // Rejected with `Timeout(bytes32 key)`.
      expect(await read(ethereum, "late.caught")).toBe(
        BigInt(keccak256(concat(["0xe6cc9dd0", key]))),
      );
      await relayHyperlane(
        await base.publicClient.getTransactionReceipt({ hash: there! }),
        baseBridges,
        ethereum,
        ethereumBridges,
      );
      expect(await read(ethereum, "late.then")).toBe(0n);
    },
    120_000,
  );

  it("delivers again, once what the body needs has arrived, a message whose body reverted", async () => {
    // As a body does when a hop brings it what it spends: the two arrive in no set order.
    const needed = (await base.publicClient.getBalance({ address: pot })) + parseEther("2");
    const receipt = await cook(
      ethereum,
      `function main(needed: Uint256) {
  Base.remote(() => {
    require(ctx.selfBalance() >= needed, "not arrived yet");
    evm.sstore(${slot("retried")}, 1);
  });
}`,
      [needed],
    );
    await expect(relayHyperlane(receipt, ethereumBridges, base, baseBridges)).rejects.toThrow();
    expect(await read(base, "retried")).toBe(0n);
    await base.deployer.sendTransaction({
      account: DEPLOYER,
      chain: null,
      to: pot,
      value: parseEther("3"),
    });
    await relayHyperlane(receipt, ethereumBridges, base, baseBridges);
    expect(await read(base, "retried")).toBe(1n);
  }, 120_000);

  it("refuses a message any other sender dispatched to the Pot", async () => {
    // A stranger dispatches, from Ethereum, a message in the shape the Pot's own are.
    const program = compileSauceProgram(
      "base",
      `function main() { evm.sstore(${slot("forged")}, 1); }`,
    );
    const message = encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes" }],
      [bytesToHex(program.bytecode), "0x"],
    );
    const stranger = createWalletClient({ account: STRANGER, transport: http(ethereum.rpcUrl) });
    const hash = await stranger.sendTransaction({
      account: STRANGER,
      chain: null,
      to: ethereumBridges.mailbox!,
      data: encodeFunctionData({
        abi: mailboxAbi,
        functionName: "dispatch",
        args: [8453, pad(pot), message],
      }),
      value: HYPERLANE_FEE,
    });
    const receipt = await ethereum.publicClient.waitForTransactionReceipt({ hash });
    const [dispatch] = receipt.logs.filter(
      (log) => log.address.toLowerCase() === ethereumBridges.mailbox!.toLowerCase(),
    );
    const { args } = decodeEventLog({
      abi: mailboxAbi,
      data: dispatch!.data,
      topics: dispatch!.topics,
    });
    // Delivered by the Mailbox, the caller the handler checks first: refused on the sender.
    expect(
      await reverts(
        base,
        DEPLOYER.address,
        baseBridges.mailbox!,
        encodeFunctionData({
          abi: mailboxAbi,
          functionName: "process",
          args: ["0x", (args as { message: Hex }).message],
        }),
      ),
    ).toContain("async: the message is not from this Pot");
    await expect(relayHyperlane(receipt, ethereumBridges, base, baseBridges)).rejects.toThrow();
    expect(await read(base, "forged")).toBe(0n);
  }, 120_000);

  it("refuses a handler called by anyone but the bridge, though it names the Pot as sender", async () => {
    const program = compileSauceProgram(
      "base",
      `function main() { evm.sstore(${slot("forged")}, 2); }`,
    );
    const message = encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes" }],
      [bytesToHex(program.bytecode), "0x"],
    );
    const data = encodeFunctionData({
      abi: potAbi,
      functionName: "handle",
      args: [1, pad(pot), message],
    });
    expect(await reverts(base, STRANGER.address, pot, data)).toContain(
      "async: the call is not from the protocol",
    );
  });
});

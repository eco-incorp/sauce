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
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  keccak256,
  pad,
  parseAbi,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";

import { v12EngineAddress } from "../../../src/deployments/v12-addresses.js";
import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { handlersInstallSource, packageHandlers } from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  DEPLOYER,
  FEE,
  RUNTIME_HEX_PATH,
  startChain,
  type LocalChain,
} from "../../cli-anvil.js";
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

/** Cooks `source`, compiled for `local`'s chain with `args` for its `main`, on the Pot, as its
 *  owner, paying the Kitchen's fee; answers the receipt. */
async function cook(
  local: LocalChain,
  source: string,
  args: readonly (bigint | Hex)[] = [],
): Promise<TransactionReceipt> {
  const program = compileSauceProgram(local.chain.slug, source);
  const input = bytesToHex(concat([program.bytecode, encodeEntryArguments(program, args)]));
  const hash = await local.deployer.sendTransaction({
    account: DEPLOYER,
    chain: null,
    to: pot,
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
      const example = readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../../../../skills/sauce-remote/examples/pay-on-base.sauce.ts",
        ),
        "utf8",
      );
      const recipient = "0x000000000000000000000000000000000000beef" as Address;
      const amount = parseEther("0.001");
      const out = await cook(ethereum, example, [recipient, amount]);
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

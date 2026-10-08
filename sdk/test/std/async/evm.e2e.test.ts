/**
 * `@sauce/async` EXECUTED: a request now, a callback later, and the `.then` body run when it lands,
 * as the same Private Pot, on an anvil running the released gated engine and Kitchen with v12
 * #571's Router — the Router whose fallback runs the handler a Pot registered for a selector.
 *
 * The protocol is `fixtures/EchoProtocol.sol`, in the shape of every request-id protocol: a program
 * requests, the protocol answers an id, and later `fulfill(id)` calls the Pot back with
 * `echo(uint256 id, uint256 value)`. Each step runs as a user would run it:
 *
 *   1. the owner cooks the program the SDK writes to install a package's handlers
 *      (`routes/handlers.ts`): the echo handler compiled for the chain, and an `install` of it for
 *      `echo`'s selector, through the Router's `setHandler`;
 *   2. the owner cooks a program that requests, `Echo.request(value).then((echoed) => { … })`: the
 *      request's id is the key its body is parked under;
 *   3. anyone calls `fulfill(id)`: the Router's fallback cooks the handler, which checks its caller,
 *      `take`s the parked body and `run`s it in the same cook, handing it what arrived. The body
 *      writes the Pot's storage, with a value it captured when the request was made, and the
 *      Kitchen's fee is charged once.
 *
 * And what is refused: a second delivery of the same id, a callback from anyone but the protocol,
 * and `install` on a Shared Pot and on a Private Pot whose Router is fixed.
 *
 * And `.catch`: in place of a body that reverted, with the body's writes undone, and in place of
 * a request the protocol's delivery failed; with no `.catch`, a failed request reverts the
 * callback and its body stays parked.
 *
 * GATED twice. On SAUCE_V12_RUNTIME_CREATION_HEX, as every EVM execution suite is, and on
 * SAUCE_V12_ROUTER_CREATION_HEX, a file of #571's Router creation code
 * (`forge inspect src/Router.sol:Router bytecode` in v12-evm at that branch): no release publishes
 * that Router yet, so CI has none to give and this suite skips there, until a kitchen-evm release
 * carries the handlers and the release's Router runs it. The two `.catch` cases also need an
 * engine built from the compiler's own tree (the one its `try` blocks are written for): on the
 * released engine a `catch (e)` that reads `e` loses its work, so they skip when the engine is the
 * release's.
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { compileHandlers, handlersInstallSource } from "../../../src/routes/handlers.js";
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
const describeAsync = RUNTIME_HEX_PATH && ROUTER !== undefined ? describe : describe.skip;
/** A \`catch (e)\` that reads \`e\` runs on an engine built from the compiler's own tree, and not on
 *  the released one, where its block's work is dropped: the \`.catch\` cases skip there. */
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
const itCatching = RELEASED_ENGINE ? it.skip : it;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const ECHO = JSON.parse(readFileSync(join(FIXTURES, "EchoProtocol.json"), "utf8")) as {
  abi: Abi;
  creationCode: Hex;
};

/** Anvil's first dev account: the Kitchen's owner and the Pot's. A second calls as a stranger. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const PORT = 8750 + (Number(process.env.JEST_WORKER_ID ?? "1") % 50);
const RPC_URL = `http://127.0.0.1:${PORT}`;
/** Non-zero, so a cook provably pays it, and a callback's single fee can be counted. */
const FEE = 1_234n;
/** The chain the programs are compiled for, and the id anvil answers with. */
const CHAIN = "base";
const CHAIN_ID = 8453;

const ECHO_SELECTOR = toFunctionSelector("echo(uint256,uint256)");
const REQUEST_SELECTOR = toFunctionSelector("request(uint256)");
/** keccak256(abi.encode(uint256(keccak256("sauce.storage.Async")) - 1)) & ~0xff. */
const NAMESPACE = (() => {
  const inner = BigInt(keccak256(toHex("sauce.storage.Async"))) - 1n;
  return BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn;
})();
/** The Pot storage slot the body writes. */
const ECHOED_SLOT = keccak256(toHex("async.echoed"));
/** The Pot storage slot a \`.catch\` writes. */
const CAUGHT_SLOT = keccak256(toHex("async.caught"));

const potAbi = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
  "error UnknownSelector(bytes4 selector)",
  "error SharedPot()",
]);
const kitchenAbi = parseAbi([
  "function setExecutionFee(uint256 fee)",
  "function deploySharedPot(bytes32 salt) returns (address)",
  "function predictSharedPot(bytes32 salt) view returns (address)",
  "function deployPot(address owner, bytes32 salt, bool routerFixed) returns (address)",
  "function predictPot(address owner, bytes32 salt, bool routerFixed) view returns (address)",
]);

const word = (value: bigint): Hex => toHex(value, { size: 32 });
const slotOf = (key: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [key, NAMESPACE]));

/** The handler `echo(uint256,uint256)` answers with, for the protocol at `echo`: compiled by the
 *  SDK for the chain, as a package's handler is. */
const handlerSource = (
  echo: Address,
): string => `import { requireCaller, run, take } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): bytes {
  requireCaller(${echo}, caller);
  const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
  return run(take(id), abi.encode(echoed));
}`;

/** The program the owner cooks to install it, as the SDK writes it for a package: the handler
 *  compiled for the chain, and one `install` per selector. */
const installSource = (echo: Address): string =>
  handlersInstallSource(
    compileHandlers(
      CHAIN,
      [{ selector: "echo(uint256,uint256)", program: "echo.handler.js" }],
      (path) => (path === "echo.handler.js" ? handlerSource(echo) : undefined),
    ),
    "the echo protocol",
  );

/** The echo protocol in the shape a package writes one. Its delivery fails the request when the
 *  protocol echoes 13, as a protocol reporting an error does. */
const ECHO_PROTOCOL = (echo: Address): string => `import { Request } from "@sauce/async";

class EchoProtocol {
  request(value: Uint256) {
    return new Request({
      send: (continuation) => {
        const [id] = abi.decode(
          evm.call(${echo}, 0, hex\`${REQUEST_SELECTOR.slice(2)}\`.concat(abi.encode(value))),
          ["Uint256"],
        );
        return id;
      },
      deliver: (input, body, fail) => {
        const [echoed] = abi.decode(input, ["Uint256"]);
        if (echoed == 13) {
          fail(abi.encode(echoed));
        } else {
          body(echoed);
        }
      },
    });
  }
}
const Echo = new EchoProtocol();
`;

/** The program that requests: a body that writes what arrived plus \`bump\`, a value it captured
 *  when the request was made. */
const requestSource = (echo: Address): string => `${ECHO_PROTOCOL(echo)}
function main(value: Uint256, bump: Uint256): void {
  Echo.request(value).then((echoed) => {
    evm.sstore(${ECHOED_SLOT}, echoed + bump);
  });
}`;

/** The same request with a \`.catch\`: a body that reverts on 99 after writing, and a handler that
 *  records the hash of what it was handed. */
const catchingSource = (echo: Address): string => `${ECHO_PROTOCOL(echo)}
function main(value: Uint256, bump: Uint256): void {
  Echo.request(value)
    .then((echoed) => {
      evm.sstore(${ECHOED_SLOT}, echoed + bump);
      require(echoed != 99, "unlucky");
    })
    .catch((e) => {
      evm.sstore(${CAUGHT_SLOT}, crypto.keccak256(e));
    });
}`;

let anvil: ChildProcess;
let publicClient: PublicClient;
let stack: GatedEngine;
let echo: Address;

const owner = createWalletClient({ account: OWNER, transport: http(RPC_URL) });
const stranger = createWalletClient({ account: STRANGER, transport: http(RPC_URL) });

/** Sends a transaction and answers whether it succeeded; a revert is an answer, not a throw. */
async function send(
  from: typeof owner,
  to: Address,
  data: Hex,
  value = 0n,
): Promise<{ ok: boolean; hash: Hex }> {
  const hash = await from.sendTransaction({
    account: from.account,
    chain: null,
    to,
    data,
    value,
    gas: 15_000_000n,
  });
  const { status } = await publicClient.waitForTransactionReceipt({ hash });

  return { ok: status === "success", hash };
}

/** `program` with `args` for its `main`, compiled by the SDK for the chain. */
function compiled(source: string, args: readonly (bigint | Hex)[] = []): Hex {
  const program = compileSauceProgram(CHAIN, source);

  return bytesToHex(concat([program.bytecode, encodeEntryArguments(program, args)]));
}

/** Cooks `program` on the harness Pot as its owner, paying the fee. */
const cook = (program: Hex, pot: Address = stack.pot) =>
  send(
    owner,
    pot,
    encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] }),
    FEE,
  );

/** What a call reverts with, replayed as an `eth_call`: its revert data, and as text. A program's
 *  `require(cond, message)` reverts with the message's bytes as they are, which the handler's cook
 *  and the protocol's `fulfill` both pass on. */
async function revertOf(
  from: Address,
  to: Address,
  data: Hex,
  value = 0n,
): Promise<{ data: Hex; reason: string }> {
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
  if (response.error === undefined) throw new Error("the call did not revert");
  const reverted = response.error.data ?? "0x";
  const reason = Buffer.from(reverted.slice(2), "hex").toString("utf8");

  return { data: reverted, reason };
}

const parked = async (key: bigint, pot: Address = stack.pot): Promise<bigint> =>
  BigInt((await publicClient.getStorageAt({ address: pot, slot: slotOf(key) })) ?? "0x0");

/** Requests `value` from the owner's Pot, answering the id the protocol gave it. */
async function request(
  value: bigint,
  bump: bigint,
  source: (echo: Address) => string = requestSource,
): Promise<bigint> {
  const before = (await publicClient.readContract({
    address: echo,
    abi: ECHO.abi,
    functionName: "requests",
  })) as bigint;
  const { ok } = await cook(compiled(source(echo), [value, bump]));
  expect(ok).toBe(true);

  return BigInt(
    keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [echo, before + 1n])),
  );
}

describeAsync("@sauce/async on the EVM, through the Router's handlers", () => {
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
          encodeFunctionData({
            abi: kitchenAbi,
            functionName: "setExecutionFee",
            args: [FEE],
          }),
        )
      ).ok,
    ).toBe(true);
    // The Router pays a handler's fee from the Pot's balance.
    await testClient.setBalance({ address: stack.pot, value: parseEther("1") });
    const hash = await owner.sendTransaction({
      account: OWNER,
      chain: null,
      data: ECHO.creationCode,
    });
    echo = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;

    const { ok } = await cook(compiled(installSource(echo)));
    expect(ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    if (anvil !== undefined && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("parks the body under the request's id, and the callback runs it once, for one fee", async () => {
    const id = await request(41n, 1_000n);
    expect(await parked(id)).not.toBe(0n);

    const kitchen = gateAnchors().kitchen;
    const kitchenBefore = await publicClient.getBalance({ address: kitchen });
    const potBefore = await publicClient.getBalance({ address: stack.pot });
    const { ok } = await send(
      stranger,
      echo,
      encodeFunctionData({ abi: ECHO.abi, functionName: "fulfill", args: [id] }),
    );
    expect(ok).toBe(true);

    expect(await publicClient.getStorageAt({ address: stack.pot, slot: ECHOED_SLOT })).toBe(
      word(1_041n),
    );
    expect(await parked(id)).toBe(0n);
    expect((await publicClient.getBalance({ address: kitchen })) - kitchenBefore).toBe(FEE);
    expect(potBefore - (await publicClient.getBalance({ address: stack.pot }))).toBe(FEE);
  });

  it("refuses a second delivery of the same id: the body was taken", async () => {
    const id = await request(7n, 0n);
    const fulfill = encodeFunctionData({ abi: ECHO.abi, functionName: "fulfill", args: [id] });
    expect((await send(stranger, echo, fulfill)).ok).toBe(true);
    expect((await revertOf(STRANGER.address, echo, fulfill)).reason).toBe(
      "async: nothing is parked under this key",
    );
  });

  it("refuses a callback from anyone but the protocol, and leaves the body parked", async () => {
    const id = await request(9n, 0n);
    const forged = concat([
      ECHO_SELECTOR,
      encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [id, 666n]),
    ]);
    expect((await revertOf(STRANGER.address, stack.pot, forged)).reason).toBe(
      "async: the call is not from the protocol",
    );
    expect((await send(stranger, stack.pot, forged)).ok).toBe(false);
    expect(await parked(id)).not.toBe(0n);
    // The protocol's own delivery still runs it.
    expect(
      (
        await send(
          stranger,
          echo,
          encodeFunctionData({ abi: ECHO.abi, functionName: "fulfill", args: [id] }),
        )
      ).ok,
    ).toBe(true);
    expect(await publicClient.getStorageAt({ address: stack.pot, slot: ECHOED_SLOT })).toBe(
      word(9n),
    );
  });

  const fulfill = (id: bigint) =>
    send(
      stranger,
      echo,
      encodeFunctionData({ abi: ECHO.abi, functionName: "fulfill", args: [id] }),
    );
  const slot = async (at: Hex): Promise<Hex | undefined> =>
    publicClient.getStorageAt({ address: stack.pot, slot: at });

  itCatching(
    "runs `.catch` in place of a body that reverted, with the body's writes undone",
    async () => {
      const before = await slot(ECHOED_SLOT);
      const id = await request(99n, 1n, catchingSource);
      expect((await fulfill(id)).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(before);
      expect(await slot(CAUGHT_SLOT)).toBe(keccak256(toHex("unlucky")));
      expect(await parked(id)).toBe(0n);
    },
  );

  itCatching(
    "runs `.catch` when the protocol's delivery fails the request, handed why",
    async () => {
      const id = await request(13n, 1n, catchingSource);
      expect((await fulfill(id)).ok).toBe(true);
      expect(await slot(CAUGHT_SLOT)).toBe(keccak256(word(13n)));
    },
  );

  it("reverts a failed request with no `.catch`, and leaves its body parked", async () => {
    const id = await request(13n, 1n);
    const call = encodeFunctionData({ abi: ECHO.abi, functionName: "fulfill", args: [id] });
    expect((await revertOf(STRANGER.address, echo, call)).data).toBe(word(13n));
    expect((await fulfill(id)).ok).toBe(false);
    expect(await parked(id)).not.toBe(0n);
  });

  it("refuses `install` on a Shared Pot, which answers no selector", async () => {
    const salt = word(0x5a5an);
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
    const install = compiled(installSource(echo));
    const refused = await revertOf(
      STRANGER.address,
      shared,
      encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, install] }),
      FEE,
    );
    expect(refused.data).toBe(toFunctionSelector("SharedPot()"));
    expect((await cook(install, shared)).ok).toBe(false);
  });

  it("refuses `install` on a Private Pot whose Router is fixed", async () => {
    const salt = word(0xf1edn);
    expect(
      (
        await send(
          owner,
          stack.kitchen,
          encodeFunctionData({
            abi: kitchenAbi,
            functionName: "deployPot",
            args: [OWNER.address, salt, true],
          }),
        )
      ).ok,
    ).toBe(true);
    const fixed = (await publicClient.readContract({
      address: stack.kitchen,
      abi: kitchenAbi,
      functionName: "predictPot",
      args: [OWNER.address, salt, true],
    })) as Address;
    const refused = await revertOf(
      OWNER.address,
      fixed,
      encodeFunctionData({
        abi: potAbi,
        functionName: "cook",
        args: [stack.engine, compiled(installSource(echo))],
      }),
      FEE,
    );
    expect(refused.data).toBe(toFunctionSelector("RouterFixed()"));
  });
});

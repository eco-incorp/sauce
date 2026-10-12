/**
 * `@sauce/async` EXECUTED: promises on a Private Pot, on an anvil running the released gated Kitchen
 * with v12 #571's Router — the Router whose fallback runs the handler a Pot registered for a
 * selector.
 *
 * Two protocols stand in for every one a package wraps (`fixtures/*.sol`):
 *   - `EchoProtocol`, request-id: a program requests, the protocol answers an id, and later
 *     `fulfill(id)` calls the Pot back with `echo(uint256 id, uint256 value)`. Its promise is keyed
 *     `promiseKey(tag, id)`, one packed word in the settlement table;
 *   - `CarrierProtocol`, echoing: the request sends its own bytes, and later `deliver(id, value)`
 *     calls the Pot back with `carried(bytes payload, bytes value)`, the payload as it was sent. A
 *     plain `.then` carries its continuation and stores nothing.
 * Each step runs as a user would run it. On the harness Pot the owner first cooks the optional
 * pre-install the SDK writes (`routes/handlers.ts`, the two handlers and @sauce/async's public
 * `expire(bytes32)`); on fresh Pots a request installs the handler it lists, and the public `expire`
 * for a deadline, as it runs, a later one only checking them. Then anyone calls the protocols back,
 * and the Router's fallback cooks the handler, which checks its caller and settles the promise,
 * running its body in the same cook.
 *
 * What is held: the body writes the Pot's storage with what arrived and what it captured; the
 * Kitchen's fee is charged once per callback; a second delivery runs nothing and returns; a forged
 * callback reverts; `.catch` runs for a body's revert and a protocol's failure, and a rejection with
 * no `.catch` is logged unhandled and returns; Promise.all/race/any/allSettled settle as
 * JavaScript's do, a child's result of a word or less kept in a slot and a longer one as code; a
 * race against `Async.timeout` is rejected by `expire` after the deadline (refused before it, and
 * without the fee); a deferred is resolved by its key later; a carried continuation runs with
 * nothing stored, or once from the table with a deadline; `install` is refused on a Shared Pot and
 * on a fixed-Router Pot. ASYNC_GAS=1 prints each path's gas.
 *
 * GATED twice. On SAUCE_V12_RUNTIME_CREATION_HEX, as every EVM execution suite is, and on
 * SAUCE_V12_ROUTER_CREATION_HEX, a file of #571's Router creation code
 * (`forge inspect src/Router.sol:Router bytecode` in v12-evm at that branch): no release publishes
 * that Router yet, so CI has none to give and this suite skips there, until a kitchen-evm release
 * carries the handlers and the release's Router runs it. Settling catches a continuation's revert
 * with a `catch (e)` that reads `e`, so every case that settles needs an engine built from the
 * compiler's tree; the released engine refuses that, loudly, and the one case run there holds it.
 */
import { type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bytesToHex,
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeAbiParameters,
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

import { handlerRecord, handlersInPlace } from "../../../src/cli/handlers.js";
import { encodeEntryArguments } from "../../../src/routes/entry.js";
import {
  approvedHashSlot,
  ERC1271_HANDLER,
  potMessageTypedData,
} from "../../../src/routes/erc1271.js";
import {
  compileHandlers,
  handlersInstallSource,
  packageHandlers,
  packageReader,
} from "../../../src/routes/handlers.js";
import {
  ASYNC_ENGINE_DEFINE,
  ASYNC_INSTALLED_DEFINE,
  compileSauceProgram,
} from "../../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../../anvil-process.js";
import { jsonOf, sauce } from "../../cli-anvil.js";
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
/** Settling a promise catches its continuation's revert with a `catch (e)` that reads `e`, which an
 *  engine built from the compiler's tree runs and the released one refuses, loudly: every case that
 *  settles runs on the first (`itSettling`), and on the release one case holds that refusal
 *  (`itOnRelease`). */
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
/** Each case sends several transactions to one anvil, which takes longer than jest's default 5 s
 *  under the load of the whole SDK suite: every case gets a minute, as the token suite's do. */
const CASE_TIMEOUT = 60_000;
const timed =
  (run: jest.It) =>
  (name: string, fn: () => Promise<void>): void =>
    run(name, fn, CASE_TIMEOUT);
const itAlways = timed(it);
const itSettling = timed(RELEASED_ENGINE ? it.skip : it);
const itOnRelease = timed(RELEASED_ENGINE ? it : it.skip);

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
/** The sauce-async skill's examples, run here as a reader runs them. */
const SKILL_EXAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skills/sauce-async/examples",
);
const skillExample = (name: string): string =>
  readFileSync(join(SKILL_EXAMPLES, `${name}.sauce.ts`), "utf8");
const fixture = (name: string): { abi: Abi; creationCode: Hex } =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as {
    abi: Abi;
    creationCode: Hex;
  };
const ECHO = fixture("EchoProtocol");
const CARRIER = fixture("CarrierProtocol");

/** Anvil's first dev account: the Kitchen's owner and the Pot's. A second calls as a stranger. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

/** A port the OS hands out (`anvil-process.ts`): no other suite can meet this one on it. */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
/** Non-zero, so a cook provably pays it, and a callback's single fee can be counted. */
const FEE = 1_234n;
/** The chain the programs are compiled for, and the id anvil answers with. */
const CHAIN = "base";
const CHAIN_ID = 8453;

const ECHO_SELECTOR = toFunctionSelector("echo(uint256,uint256)");
/** The tag the echo protocol keys its promises under. */
const ECHO_TAG = 7n;
const PENDING = keccak256(toHex("PromisePending(bytes32,uint256)"));
const IGNORED = keccak256(toHex("PromiseIgnored(bytes32,uint256)"));
const UNHANDLED = keccak256(toHex("PromiseUnhandled(bytes32,bytes)"));
const REQUEST_SELECTOR = toFunctionSelector("request(uint256)");
/** keccak256(abi.encode(uint256(keccak256("sauce.storage.Async")) - 1)) & ~0xff. */
const NAMESPACE = (() => {
  const inner = BigInt(keccak256(toHex("sauce.storage.Async"))) - 1n;
  return BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn;
})();
/** The Router's handler records, in the Pot's storage: ERC-7201 `sauce.storage.Handlers`. */
const HANDLERS = (() => {
  const inner = BigInt(keccak256(toHex("sauce.storage.Handlers"))) - 1n;
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
 *  SDK for the chain, as a package's handler is. An echoed value with a count `n` above bit 128
 *  settles with `n` words (`wideResult`): a protocol whose answer is longer than a word. */
const handlerSource = (
  echo: Address,
): string => `import { fulfil, promiseKey, requireCaller } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): void {
  requireCaller(${echo}, caller);
  const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
  let delivered = abi.encode(echoed);
  for (let i = 1; i < echoed >> 128; i += 1) {
    delivered = delivered.concat(abi.encode(echoed + i));
  }
  fulfil(promiseKey(${ECHO_TAG}, id), delivered);
}`;

/** The value to request for a result of `words` words, distinct for each `seed`. */
const wideValue = (words: number, seed: bigint): bigint => (BigInt(words) << 128n) | seed;
/** What the handler settles a request for `value` with: `value`, `value + 1`, … one word each. */
const wideResult = (value: bigint): Hex =>
  concat(
    Array.from({ length: Math.max(1, Number(value >> 128n)) }, (_, i) =>
      toHex(value + BigInt(i), { size: 32 }),
    ),
  );

/** The handler `carried(bytes,bytes)` answers with, for the protocol at `carrier`: the payload the
 *  request sent, `(key, stored, program)`, settled with what the protocol delivered. */
const carriedSource = (
  carrier: Address,
): string => `import { requireCaller, settleCarried } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): void {
  requireCaller(${carrier}, caller);
  const [payload, delivered] = abi.decode(data.slice(4, data.length), ["bytes", "bytes"]);
  const [key, stored, program] = abi.decode(payload, ["Uint256", "Uint256", "bytes"]);
  // The protocol reports a failure as 13.
  const [outcome] = abi.decode(delivered, ["Uint256"]);
  settleCarried(key, stored == 1, program, delivered, outcome != 13);
}`;

/** The program the owner cooks to install them, as the SDK writes it for a package: each handler
 *  compiled for the chain, @sauce/async's public `expire(bytes32)` with them, one `install` each. */
const installSource = (echo: Address, carrier: Address): string =>
  handlersInstallSource(
    [
      ...compileHandlers(
        CHAIN,
        [
          { selector: "echo(uint256,uint256)", program: "echo.handler.js" },
          { selector: "carried(bytes,bytes)", program: "carried.handler.js" },
        ],
        (path) =>
          path === "echo.handler.js"
            ? handlerSource(echo)
            : path === "carried.handler.js"
              ? carriedSource(carrier)
              : undefined,
      ),
      ...packageHandlers(CHAIN, "@sauce/async"),
      ...compileHandlers(CHAIN, [ERC1271_HANDLER], packageReader("@sauce/async")),
    ],
    "the echo protocol",
  );

/** The echo protocol in the shape a package writes one. Its delivery fails the request when the
 *  protocol echoes 13, as a protocol reporting an error does. */
const ECHO_PROTOCOL = (
  echo: Address,
): string => `import { Request, promiseKey } from "@sauce/async";

class EchoProtocol {
  request(value: Uint256) {
    return new Request({
      send: (continuation) => {
        const [id] = abi.decode(
          evm.call(${echo}, 0, hex\`${REQUEST_SELECTOR.slice(2)}\`.concat(abi.encode(value))),
          ["Uint256"],
        );
        return promiseKey(${ECHO_TAG}, id);
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

/** A program over two echo requests and the combinator `combinator`, writing what its body is
 *  handed as `write` computes it from `r`. */
const combinedSource = (
  echo: Address,
  combinator: string,
  children: string,
  write: string,
): string => `${ECHO_PROTOCOL(echo).replace("import { Request, promiseKey }", "import { Async, Promise, Request, promiseKey }")}
function main(value: Uint256, bump: Uint256): void {
  Promise.${combinator}([${children}])
    .then((r) => {
      evm.sstore(${ECHOED_SLOT}, ${write});
    })
    .catch((e) => {
      evm.sstore(${CAUGHT_SLOT}, crypto.keccak256(e));
    });
}`;

/** A protocol that carries the continuation back: the shape of a bridge's package. With a deadline
 *  (\`within\`) the table holds the promise, and the message only names it. */
const carrierSource = (
  carrier: Address,
  within: boolean,
): string => `import { Request } from "@sauce/async";

class CarrierProtocol {
  send() {
    return new Request({
      carries: true,
      send: (continuation) => {
        const payload = abi.encode(continuation.key, continuation.stored ? 1 : 0, continuation.program);
        evm.call(${carrier}, 0, hex\`2bb1ae7c\`.concat(abi.encode(payload)));
      },
      deliver: (input, body, fail) => {
        const [value] = abi.decode(input, ["Uint256"]);
        body(value);
      },
    });
  }
}
const Carrier = new CarrierProtocol();

function main(bump: Uint256): void {
  Carrier.send()${within ? ".within(3600)" : ""}.then((value) => {
    evm.sstore(${ECHOED_SLOT}, value + bump);
  });
}`;

/** The echo protocol with no `deliver`: a body takes each result as it arrived, bytes. */
const WIDE_PROTOCOL = (
  echo: Address,
): string => `import { Promise, Request, promiseKey } from "@sauce/async";

class WideEcho {
  request(value: Uint256) {
    return new Request({
      send: (continuation) => {
        const [id] = abi.decode(
          evm.call(${echo}, 0, hex\`${REQUEST_SELECTOR.slice(2)}\`.concat(abi.encode(value))),
          ["Uint256"],
        );
        return promiseKey(${ECHO_TAG}, id);
      },
    });
  }
}
const Wide = new WideEcho();
`;

/** Promise.all of two echo requests, its body writing the hash of both results as they arrived:
 *  `keccak256(abi.encode(r[0], r[1]))`. */
const wideSource = (echo: Address): string => `${WIDE_PROTOCOL(echo)}
function main(first: Uint256, second: Uint256): void {
  Promise.all([Wide.request(first), Wide.request(second)]).then((r) => {
    evm.sstore(${ECHOED_SLOT}, crypto.keccak256(abi.encode(r[0], r[1])));
  });
}`;

/** Results kept both ways, read back by one body: a word and two words from the protocol, and
 *  reasons of 33, 4 and 0 bytes the program rejects with itself. The body writes the hash of
 *  every value, and each status as a digit. */
const THIRTY_THREE: Hex = `0x${"ab".repeat(33)}`;
const keptSource = (echo: Address): string => `${WIDE_PROTOCOL(echo)}
function main(first: Uint256, second: Uint256): void {
  Promise.allSettled([
    Wide.request(first),
    Wide.request(second),
    Promise.reject(hex\`${THIRTY_THREE.slice(2)}\`),
    Promise.reject(hex\`deadbeef\`),
    Promise.reject(hex\`\`),
  ]).then((r) => {
    evm.sstore(
      ${ECHOED_SLOT},
      crypto.keccak256(abi.encode(r[0].value, r[1].value, r[2].value, r[3].value, r[4].value)),
    );
    evm.sstore(
      ${CAUGHT_SLOT},
      r[0].status * 10000 + r[1].status * 1000 + r[2].status * 100 + r[3].status * 10 + r[4].status,
    );
  });
}`;

/** The echo protocol as a package of the family writes one now: its request installs the handler its
 *  callback reaches (`handlers`), on a Pot that installed nothing beforehand. `within` follows the
 *  request (`.within(60)`). */
const lazyEchoSource = (
  echo: Address,
  within: string,
): string => `import { Handler, Request, fulfil, promiseKey, requireCaller } from "@sauce/async";

class LazyEcho {
  request(value: Uint256) {
    return new Request({
      handlers: [
        new Handler(${ECHO_SELECTOR}, (caller: Address, paid: Uint256, data: bytes) => {
          requireCaller(${echo}, caller);
          const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
          fulfil(promiseKey(${ECHO_TAG}, id), abi.encode(echoed));
        }),
      ],
      send: (continuation) => {
        const [id] = abi.decode(
          evm.call(${echo}, 0, hex\`${REQUEST_SELECTOR.slice(2)}\`.concat(abi.encode(value))),
          ["Uint256"],
        );
        return promiseKey(${ECHO_TAG}, id);
      },
      deliver: (input, body, fail) => {
        const [echoed] = abi.decode(input, ["Uint256"]);
        body(echoed);
      },
    });
  }
}
const Echo = new LazyEcho();

function main(value: Uint256, bump: Uint256): void {
  Echo.request(value)${within}.then((echoed) => {
    evm.sstore(${ECHOED_SLOT}, echoed + bump);
  });
}`;

/** A deferred: its body parked, its key the program's answer and logged; settled later by key. */
const deferredSource = `import { Promise } from "@sauce/async";

function main(bump: Uint256): Uint256 {
  const d = Promise.withResolvers();
  d.promise.then((value) => {
    const [v] = abi.decode(value, ["Uint256"]);
    evm.sstore(${ECHOED_SLOT}, v + bump);
  });
  return d.key;
}`;
const resolveSource = `import { Async } from "@sauce/async";

function main(key: Uint256, value: Uint256): void {
  Async.resolve(key, abi.encode(value));
}`;

/** \`run\` hands a program its input: a continuation takes it as its parameters, and a program
 *  that takes none reads it with the deprecated \`received()\`, for one release. */
const runSource = `import { received, run } from "@sauce/async";

function main(value: Uint256): void {
  const taking = program(
    (input: bytes, mode: Uint256) => {
      const [got] = abi.decode(input, ["Uint256"]);
      evm.sstore(${ECHOED_SLOT}, got * 10 + mode);
    },
    { continuation: chainId },
  );
  run(taking.code.concat(taking.args), abi.encode(value));
  const reading = program(
    () => {
      const [got] = abi.decode(received(), ["Uint256"]);
      evm.sstore(${CAUGHT_SLOT}, got);
    },
    { continuation: chainId },
  );
  run(reading.code.concat(reading.args), abi.encode(value + 1));
}`;

/** Gas each path costs, by name: printed with ASYNC_GAS=1. */
const GAS: Record<string, bigint> = {};

let anvil: ChildProcess;
let publicClient: PublicClient;
let stack: GatedEngine;
let echo: Address;
let carrier: Address;

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
  return compiledWith(source, args, {});
}

/** The same, with `defines`: what a sender that read the chain first compiles. */
function compiledWith(
  source: string,
  args: readonly (bigint | Hex)[],
  defines: Readonly<Record<string, bigint>>,
): Hex {
  const program = compileSauceProgram(CHAIN, source, { defines });

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

/** The promise key the echo protocol's request `id` is: `promiseKey(ECHO_TAG, id)`. */
const keyOf = (id: bigint): bigint =>
  BigInt(
    keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [ECHO_TAG, id])),
  );

/** The settlement table's word for the echo request `id`: zero once it settled. */
const parked = async (id: bigint, pot: Address = stack.pot): Promise<bigint> =>
  BigInt((await publicClient.getStorageAt({ address: pot, slot: slotOf(keyOf(id)) })) ?? "0x0");

/** The gas a transaction used. */
const gasOf = async (hash: Hex): Promise<bigint> =>
  (await publicClient.getTransactionReceipt({ hash })).gasUsed;

/** Each promise a transaction parked: its key, and its deadline (zero for none). */
const pendingOf = async (hash: Hex): Promise<{ key: bigint; deadline: bigint }[]> =>
  (await publicClient.getTransactionReceipt({ hash })).logs
    .filter(
      (entry) =>
        entry.address.toLowerCase() === stack.pot.toLowerCase() && entry.topics[0] === PENDING,
    )
    .map((entry) => ({ key: BigInt(entry.topics[1]!), deadline: BigInt(entry.data) }));

/** The payload a cook sent the carrier, from its `Sent` event. */
const sentPayload = async (hash: Hex): Promise<Hex> => {
  const sent = (await publicClient.getTransactionReceipt({ hash })).logs.find(
    (entry) => entry.address.toLowerCase() === carrier.toLowerCase(),
  )!;
  const [payload] = decodeAbiParameters([{ type: "bytes" }], sent.data);

  return payload;
};

/** The echo protocol's next `count` ids, in the order its requests will take them. */
async function nextIds(count: number): Promise<bigint[]> {
  const before = (await publicClient.readContract({
    address: echo,
    abi: ECHO.abi,
    functionName: "requests",
  })) as bigint;

  return Array.from({ length: count }, (_, i) =>
    BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          [echo, before + 1n + BigInt(i)],
        ),
      ),
    ),
  );
}

/** The topics of the logs a transaction's receipt holds from the Pot. */
const potLogs = async (hash: Hex): Promise<readonly (readonly Hex[])[]> =>
  (await publicClient.getTransactionReceipt({ hash })).logs
    .filter((entry) => entry.address.toLowerCase() === stack.pot.toLowerCase())
    .map((entry) => entry.topics as Hex[]);

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
    const carrierHash = await owner.sendTransaction({
      account: OWNER,
      chain: null,
      data: CARRIER.creationCode,
    });
    carrier = (await publicClient.waitForTransactionReceipt({ hash: carrierHash }))
      .contractAddress!;

    const { ok } = await cook(compiled(installSource(echo, carrier)));
    expect(ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    if (process.env.ASYNC_GAS === "1") console.log(GAS);
    if (anvil !== undefined && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  const fulfill = (id: bigint) =>
    send(
      stranger,
      echo,
      encodeFunctionData({ abi: ECHO.abi, functionName: "fulfill", args: [id] }),
    );
  const slot = async (at: Hex): Promise<Hex | undefined> =>
    publicClient.getStorageAt({ address: stack.pot, slot: at });
  const setSlot = (at: Hex, value: bigint): Promise<void> =>
    createTestClient({ mode: "anvil", transport: http(RPC_URL) }).setStorageAt({
      address: stack.pot,
      index: at,
      value: word(value),
    });

  itSettling(
    "parks the body under the request's id, and the callback runs it once, for one fee",
    async () => {
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
    },
  );

  itSettling(
    "lets a second delivery of the same id pass and run nothing: the promise is settled",
    async () => {
      const id = await request(7n, 5n);
      expect((await fulfill(id)).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(12n));
      await setSlot(ECHOED_SLOT, 0n);
      const again = await fulfill(id);
      expect(again.ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(0n));
      expect(await potLogs(again.hash)).toContainEqual([IGNORED, word(keyOf(id))]);
    },
  );

  itSettling(
    "refuses a callback from anyone but the protocol, and leaves the body parked",
    async () => {
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
    },
  );

  itSettling(
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

  itSettling(
    "runs `.catch` when the protocol's delivery fails the request, handed why",
    async () => {
      const id = await request(13n, 1n, catchingSource);
      expect((await fulfill(id)).ok).toBe(true);
      expect(await slot(CAUGHT_SLOT)).toBe(keccak256(word(13n)));
    },
  );

  itSettling(
    "settles a failed request with no `.catch` as rejected, logged unhandled, and returns",
    async () => {
      const id = await request(13n, 1n);
      const delivered = await fulfill(id);
      expect(delivered.ok).toBe(true);
      expect(await parked(id)).toBe(0n);
      expect(await potLogs(delivered.hash)).toContainEqual([UNHANDLED, word(keyOf(id))]);
    },
  );

  const expire = (key: bigint, value: bigint = FEE) =>
    send(stranger, stack.pot, concat([toFunctionSelector("expire(bytes32)"), word(key)]), value);
  const later = async (seconds: number): Promise<void> => {
    const test = createTestClient({ mode: "anvil", transport: http(RPC_URL) });
    await test.increaseTime({ seconds });
    await test.mine({ blocks: 1 });
  };

  itSettling("measures a request-id promise: one word parked, one callback", async () => {
    const [id] = await nextIds(1);
    const requested = await cook(compiled(requestSource(echo), [3n, 0n]));
    expect(requested.ok).toBe(true);
    GAS["request-id: request (continuation already deployed)"] = await gasOf(requested.hash);
    const delivered = await fulfill(id!);
    expect(delivered.ok).toBe(true);
    GAS["request-id: callback"] = await gasOf(delivered.hash);
    expect(await slot(ECHOED_SLOT)).toBe(word(3n));
    // The same request made bare, with no promise: what the protocol and the cook cost alone.
    const bare = await cook(
      compiled(
        `function main(value: Uint256): void {
  evm.call(${echo}, 0, hex\`${REQUEST_SELECTOR.slice(2)}\`.concat(abi.encode(value)));
}`,
        [3n],
      ),
    );
    GAS["request-id: the same request with no promise"] = await gasOf(bare.hash);
  });

  itSettling(
    "Promise.all runs its body once every child has settled, each value in order",
    async () => {
      await setSlot(ECHOED_SLOT, 0n);
      const [first, second] = await nextIds(2);
      const requested = await cook(
        compiled(
          combinedSource(
            echo,
            "all",
            "Echo.request(value), Echo.request(value + 1)",
            "r[0] * 1000 + r[1] + bump",
          ),
          [20n, 5n],
        ),
      );
      expect(requested.ok).toBe(true);
      GAS["all of 2: request"] = await gasOf(requested.hash);
      const last = await fulfill(second!);
      expect(await slot(ECHOED_SLOT)).toBe(word(0n));
      GAS["all of 2: a child's callback"] = await gasOf(last.hash);
      const settling = await fulfill(first!);
      GAS["all of 2: the last child's callback, running the body"] = await gasOf(settling.hash);
      expect(await slot(ECHOED_SLOT)).toBe(word(20n * 1000n + 21n + 5n));
      // Again: the three continuations are deployed already, and the request parks three words.
      const again = await cook(
        compiled(
          combinedSource(
            echo,
            "all",
            "Echo.request(value), Echo.request(value + 1)",
            "r[0] * 1000 + r[1] + bump",
          ),
          [20n, 5n],
        ),
      );
      GAS["all of 2: request, continuations already deployed"] = await gasOf(again.hash);
    },
  );

  itSettling(
    "Promise.all hands its body each child's result as it arrived, however long",
    async () => {
      for (const [words, seed] of [
        [1, 0xa1n],
        [2, 0xa2n],
        [4, 0xa4n],
        [8, 0xa8n],
        [9, 0xa9n],
      ] as const) {
        await setSlot(ECHOED_SLOT, 0n);
        const [first, second] = await nextIds(2);
        const values = [wideValue(words, seed), wideValue(words, seed << 8n)] as const;
        expect((await cook(compiled(wideSource(echo), [...values]))).ok).toBe(true);
        const child = await fulfill(second!);
        expect(child.ok).toBe(true);
        GAS[`all of 2, ${words}-word results: a child's callback`] = await gasOf(child.hash);
        const last = await fulfill(first!);
        expect(last.ok).toBe(true);
        GAS[`all of 2, ${words}-word results: the last child's callback, running the body`] =
          await gasOf(last.hash);
        expect(await slot(ECHOED_SLOT)).toBe(
          keccak256(
            encodeAbiParameters(
              [{ type: "bytes" }, { type: "bytes" }],
              [wideResult(values[0]), wideResult(values[1])],
            ),
          ),
        );
      }
    },
  );

  itSettling(
    "keeps a child's result of a word or less in a slot and a longer one as code, and reads both",
    async () => {
      await setSlot(ECHOED_SLOT, 0n);
      await setSlot(CAUGHT_SLOT, 0n);
      const [first, second] = await nextIds(2);
      const values = [wideValue(1, 0xb1n), wideValue(2, 0xb2n)] as const;
      const requested = await cook(compiled(keptSource(echo), [...values]));
      expect(requested.ok).toBe(true);
      const joinKey = (await pendingOf(requested.hash))
        .map(({ key }) => key)
        .find((key) => key !== keyOf(first!) && key !== keyOf(second!))!;
      expect((await fulfill(second!)).ok).toBe(true);
      expect((await fulfill(first!)).ok).toBe(true);

      const results: Hex[] = [
        wideResult(values[0]),
        wideResult(values[1]),
        THIRTY_THREE,
        "0xdeadbeef",
        "0x",
      ];
      expect(await slot(ECHOED_SLOT)).toBe(
        keccak256(
          encodeAbiParameters(
            results.map(() => ({ type: "bytes" })),
            results,
          ),
        ),
      );
      expect(await slot(CAUGHT_SLOT)).toBe(word(22_333n));
      // Each head: its state and, for a result longer than a word, the address of the code that
      // keeps it; else a zero address, the length, and the result in the next slot, as a number.
      for (const [index, result] of results.entries()) {
        const at = BigInt(
          keccak256(
            encodeAbiParameters(
              [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
              [joinKey, BigInt(index), NAMESPACE],
            ),
          ),
        );
        const state = index < 2 ? 2n : 3n;
        const head = BigInt((await slot(toHex(at, { size: 32 }))) ?? "0x0");
        const length = BigInt((result.length - 2) / 2);
        if (length <= 32n) {
          expect(word(head)).toBe(word((state << 160n) | (length << 168n)));
          expect(await slot(toHex(at + 1n, { size: 32 }))).toBe(
            word(length === 0n ? 0n : BigInt(result)),
          );
        } else {
          expect(word(head >> 160n)).toBe(word(state));
          const code = await publicClient.getCode({
            address: toHex(head & ((1n << 160n) - 1n), { size: 20 }),
          });
          expect(code?.slice(22)).toBe(result.slice(2));
        }
      }
    },
  );

  itSettling("Promise.race settles with the first child; the later one is ignored", async () => {
    const [first, second] = await nextIds(2);
    expect(
      (
        await cook(
          compiled(
            combinedSource(
              echo,
              "race",
              "Echo.request(value), Echo.request(value + 1)",
              "r + bump",
            ),
            [30n, 1n],
          ),
        )
      ).ok,
    ).toBe(true);
    expect((await fulfill(second!)).ok).toBe(true);
    expect(await slot(ECHOED_SLOT)).toBe(word(32n));
    await setSlot(ECHOED_SLOT, 0n);
    const late = await fulfill(first!);
    expect(late.ok).toBe(true);
    expect(await slot(ECHOED_SLOT)).toBe(word(0n));
  });

  itSettling("Promise.any is fulfilled by the first fulfilment", async () => {
    const [first] = await nextIds(2);
    expect(
      (
        await cook(
          compiled(
            combinedSource(echo, "any", "Echo.request(value), Echo.request(value + 1)", "r + bump"),
            [40n, 2n],
          ),
        )
      ).ok,
    ).toBe(true);
    expect((await fulfill(first!)).ok).toBe(true);
    expect(await slot(ECHOED_SLOT)).toBe(word(42n));
  });

  itSettling(
    "a race against a timeout: anyone expires it after the deadline, into `.catch`",
    async () => {
      const [id] = await nextIds(1);
      const requested = await cook(
        compiled(
          combinedSource(echo, "race", "Echo.request(value), Async.timeout(60)", "r + bump"),
          [50n, 0n],
        ),
      );
      expect(requested.ok).toBe(true);
      const timeout = (await pendingOf(requested.hash)).find(({ deadline }) => deadline > 0n)!;
      expect(timeout).toBeDefined();

      // Refused before the deadline, and for less than the Kitchen's fee.
      expect(
        (
          await revertOf(
            STRANGER.address,
            stack.pot,
            concat([toFunctionSelector("expire(bytes32)"), word(timeout.key)]),
            FEE,
          )
        ).reason,
      ).toBe("async: the promise has not expired");
      await later(61);
      expect(
        (
          await revertOf(
            STRANGER.address,
            stack.pot,
            concat([toFunctionSelector("expire(bytes32)"), word(timeout.key)]),
            0n,
          )
        ).reason,
      ).toBe("async: expire pays the Kitchen's fee");

      await setSlot(CAUGHT_SLOT, 0n);
      const expired = await expire(timeout.key);
      expect(expired.ok).toBe(true);
      GAS["expire: a race's timeout, running its .catch"] = await gasOf(expired.hash);
      expect(await slot(CAUGHT_SLOT)).toBe(
        keccak256(concat([toFunctionSelector("Timeout(bytes32)"), word(timeout.key)])),
      );
      // The request answering late settles nothing.
      await setSlot(ECHOED_SLOT, 0n);
      expect((await fulfill(id!)).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(0n));
      // And the timeout, expired once, is no promise any more.
      expect((await expire(timeout.key)).ok).toBe(true);
    },
  );

  itSettling("Promise.allSettled hands each child's state and value", async () => {
    const [id] = await nextIds(1);
    const requested = await cook(
      compiled(
        combinedSource(
          echo,
          "allSettled",
          "Echo.request(value), Async.timeout(60)",
          "r[0].status * 100 + r[1].status * 10 + r[0].value.length + bump",
        ),
        [60n, 0n],
      ),
    );
    const timeout = (await pendingOf(requested.hash)).find(({ deadline }) => deadline > 0n)!;
    expect((await fulfill(id!)).ok).toBe(true);
    await later(61);
    expect((await expire(timeout.key)).ok).toBe(true);
    expect(await slot(ECHOED_SLOT)).toBe(word(2n * 100n + 3n * 10n + 32n));
  });

  itSettling(
    "a deferred: its key logged, its body run when the owner resolves it later",
    async () => {
      const made = await cook(compiled(deferredSource, [7n]));
      expect(made.ok).toBe(true);
      const [deferred] = await pendingOf(made.hash);
      expect(deferred).toBeDefined();
      await setSlot(ECHOED_SLOT, 0n);
      expect((await cook(compiled(resolveSource, [deferred!.key, 70n]))).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(77n));
      // Resolved once: again, nothing.
      await setSlot(ECHOED_SLOT, 0n);
      expect((await cook(compiled(resolveSource, [deferred!.key, 1n]))).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(0n));
    },
  );

  itAlways(
    "run hands its program the input as parameters, and through received() for one release",
    async () => {
      await setSlot(ECHOED_SLOT, 0n);
      await setSlot(CAUGHT_SLOT, 0n);
      expect((await cook(compiled(runSource, [4n]))).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(42n));
      expect(await slot(CAUGHT_SLOT)).toBe(word(5n));
      // As found, so the next case's gas is its own.
      await setSlot(ECHOED_SLOT, 0n);
      await setSlot(CAUGHT_SLOT, 0n);
    },
  );

  itSettling("a carried continuation: nothing parked, run as the message lands", async () => {
    const before = (await publicClient.readContract({
      address: carrier,
      abi: CARRIER.abi,
      functionName: "sent",
    })) as bigint;
    const requested = await cook(compiled(carrierSource(carrier, false), [100n]));
    expect(requested.ok).toBe(true);
    expect(await pendingOf(requested.hash)).toEqual([]);
    GAS["carried: request (nothing stored)"] = await gasOf(requested.hash);
    const delivered = await send(
      stranger,
      carrier,
      encodeFunctionData({
        abi: CARRIER.abi,
        functionName: "deliver",
        args: [before + 1n, await sentPayload(requested.hash), word(5n)],
      }),
    );
    expect(delivered.ok).toBe(true);
    GAS["carried: callback"] = await gasOf(delivered.hash);
    expect(await slot(ECHOED_SLOT)).toBe(word(105n));
  });

  itSettling(
    "a carried continuation rejected with no `.catch` runs nothing, and is logged unhandled",
    async () => {
      const before = (await publicClient.readContract({
        address: carrier,
        abi: CARRIER.abi,
        functionName: "sent",
      })) as bigint;
      const requested = await cook(compiled(carrierSource(carrier, false), [300n]));
      expect(requested.ok).toBe(true);
      await setSlot(ECHOED_SLOT, 0n);
      const rejected = await send(
        stranger,
        carrier,
        encodeFunctionData({
          abi: CARRIER.abi,
          functionName: "deliver",
          args: [before + 1n, await sentPayload(requested.hash), word(13n)],
        }),
      );
      expect(rejected.ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(0n));
      expect((await potLogs(rejected.hash)).map((topics) => topics[0])).toContain(UNHANDLED);
    },
  );

  itSettling(
    "a carried continuation with a deadline: parked, so a second delivery is ignored",
    async () => {
      const before = (await publicClient.readContract({
        address: carrier,
        abi: CARRIER.abi,
        functionName: "sent",
      })) as bigint;
      const requested = await cook(compiled(carrierSource(carrier, true), [200n]));
      expect(requested.ok).toBe(true);
      expect(await pendingOf(requested.hash)).toHaveLength(1);
      const deliver = encodeFunctionData({
        abi: CARRIER.abi,
        functionName: "deliver",
        args: [before + 1n, await sentPayload(requested.hash), word(6n)],
      });
      expect((await send(stranger, carrier, deliver)).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(206n));
      await setSlot(ECHOED_SLOT, 0n);
      expect((await send(stranger, carrier, deliver)).ok).toBe(true);
      expect(await slot(ECHOED_SLOT)).toBe(word(0n));
    },
  );

  itSettling(
    "the skill's sauce-async/examples/approval pays once approve resolves it, and never after the day",
    async () => {
      const recipient = "0x00000000000000000000000000000000000a5a5a" as Address;
      const waiting = await cook(compiled(skillExample("approval"), [recipient, 1_000n]));
      expect(waiting.ok).toBe(true);
      // Parked in order: the race, the approval, and the timeout, the one with a deadline.
      const [race, approval, timeout] = await pendingOf(waiting.hash);
      expect([race!.deadline, approval!.deadline]).toEqual([0n, 0n]);
      expect(timeout!.deadline).toBeGreaterThan(0n);
      const key = approval!.key;
      expect((await cook(compiled(skillExample("approve"), [key]))).ok).toBe(true);
      expect(await publicClient.getBalance({ address: recipient })).toBe(1_000n);
      // Approved once: again, nothing.
      expect((await cook(compiled(skillExample("approve"), [key]))).ok).toBe(true);
      expect(await publicClient.getBalance({ address: recipient })).toBe(1_000n);

      // A second payment, never approved: after the day anyone expires it, and nothing is paid.
      const unpaid = await cook(compiled(skillExample("approval"), [recipient, 5n]));
      const day = (await pendingOf(unpaid.hash)).find(({ deadline }) => deadline > 0n)!;
      await later(86_401);
      expect((await expire(day.key)).ok).toBe(true);
      expect(await publicClient.getBalance({ address: recipient })).toBe(1_000n);
    },
  );

  itOnRelease(
    "on the released engine a callback that settles reverts, and the promise stays pending",
    async () => {
      const [id] = await nextIds(1);
      expect((await cook(compiled(requestSource(echo), [1n, 0n]))).ok).toBe(true);
      expect(await parked(id!)).not.toBe(0n);
      expect((await fulfill(id!)).ok).toBe(false);
      expect(await parked(id!)).not.toBe(0n);
    },
  );

  const MAGIC = "0x1626ba7e00000000000000000000000000000000000000000000000000000000";
  const INVALID = "0xffffffff00000000000000000000000000000000000000000000000000000000";
  const isValid = async (hash: Hex, signature: Hex): Promise<Hex | undefined> =>
    (
      await publicClient.call({
        to: stack.pot,
        data: encodeFunctionData({
          abi: parseAbi([
            "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
          ]),
          functionName: "isValidSignature",
          args: [hash, signature],
        }),
      })
    ).data;

  itAlways(
    "answers ERC-1271 for a hash a program approved, until it is revoked, under 100k gas",
    async () => {
      const hash = keccak256(toHex("a request the Pot made"));
      expect(await isValid(hash, "0x")).toBe(INVALID);
      const approve = (verb: string) => `import { Erc1271 } from "@sauce/async";

function main(hash: Uint256): void {
  Erc1271.${verb}(hash);
}`;
      expect((await cook(compiled(approve("approve"), [hash]))).ok).toBe(true);
      expect(await slot(approvedHashSlot(hash))).toBe(word(1n));
      // The approval is the authorization: whatever the signature bytes.
      expect(await isValid(hash, "0x")).toBe(MAGIC);
      expect(await isValid(hash, `0x${"ab".repeat(65)}`)).toBe(MAGIC);
      // A market's check gives the call 100,000 gas: what it uses, the transaction's 21,000 and its
      // calldata aside.
      const data = encodeFunctionData({
        abi: parseAbi([
          "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
        ]),
        functionName: "isValidSignature",
        args: [hash, "0x"],
      });
      const estimate = await publicClient.estimateGas({
        account: STRANGER.address,
        to: stack.pot,
        data,
      });
      GAS["erc1271: an approved hash, the whole call"] = estimate;
      expect(estimate - 21_000n).toBeLessThan(100_000n);
      expect((await cook(compiled(approve("revoke"), [hash]))).ok).toBe(true);
      expect(await isValid(hash, "0x")).toBe(INVALID);
    },
  );

  itAlways(
    "answers ERC-1271 for the owner's signature over the hash bound to the Pot, and no other",
    async () => {
      const hash = keccak256(toHex("a permit the Pot signs"));
      const typed = potMessageTypedData({ pot: stack.pot, chainId: CHAIN_ID, hash });
      const signature = await OWNER.signTypedData(typed);
      expect(await isValid(hash, signature)).toBe(MAGIC);
      // The library's isValidSignature, which the handler writes out with no call, answers alike.
      const library = async (signed: Hex): Promise<Hex | undefined> =>
        (
          await publicClient.call({
            account: OWNER.address,
            to: stack.pot,
            value: FEE,
            data: encodeFunctionData({
              abi: potAbi,
              functionName: "cook",
              args: [
                stack.engine,
                compiled(
                  `import { isValidSignature } from "@sauce/async";

function main(hash: Uint256, signature: bytes): Uint256 {
  return isValidSignature(hash, signature);
}`,
                  [hash, signed],
                ),
              ],
            }),
          })
        ).data;
      expect(await library(signature)).toBe(MAGIC);
      expect(await library(await STRANGER.signTypedData(typed))).toBe(INVALID);
      const estimate = await publicClient.estimateGas({
        account: STRANGER.address,
        to: stack.pot,
        data: encodeFunctionData({
          abi: parseAbi([
            "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
          ]),
          functionName: "isValidSignature",
          args: [hash, signature],
        }),
      });
      GAS["erc1271: the owner's signature, the whole call"] = estimate;

      // Its malleable twin: s flipped to the upper half, v to the other parity.
      const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
      const r = signature.slice(0, 66);
      const s = BigInt(`0x${signature.slice(66, 130)}`);
      const v = Number.parseInt(signature.slice(130, 132), 16);
      const twin =
        `${r}${(order - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
      expect(await isValid(hash, twin)).toBe(INVALID);
      // Another signer's, and the owner's over the bare hash rather than the Pot's message.
      expect(await isValid(hash, await STRANGER.signTypedData(typed))).toBe(INVALID);
      expect(await isValid(hash, await OWNER.sign({ hash }))).toBe(INVALID);
      // And the same message for another Pot.
      expect(
        await isValid(
          hash,
          await OWNER.signTypedData({
            ...typed,
            domain: { ...typed.domain, verifyingContract: echo },
          }),
        ),
      ).toBe(INVALID);
    },
  );

  /** A Private Pot the owner just made: nothing installed on it, a balance for its callbacks' fee. */
  const freshPot = async (salt: bigint): Promise<Address> => {
    expect(
      (
        await send(
          owner,
          stack.kitchen,
          encodeFunctionData({
            abi: kitchenAbi,
            functionName: "deployPot",
            args: [OWNER.address, word(salt), false],
          }),
        )
      ).ok,
    ).toBe(true);
    const pot = (await publicClient.readContract({
      address: stack.kitchen,
      abi: kitchenAbi,
      functionName: "predictPot",
      args: [OWNER.address, word(salt), false],
    })) as Address;
    await createTestClient({ mode: "anvil", transport: http(RPC_URL) }).setBalance({
      address: pot,
      value: parseEther("1"),
    });
    return pot;
  };
  /** The Router's record for `selector` on `pot`: zero when nothing answers it. */
  const record = async (pot: Address, selector: Hex): Promise<bigint> =>
    BigInt(
      (await publicClient.getStorageAt({
        address: pot,
        slot: keccak256(
          encodeAbiParameters(
            [{ type: "bytes32" }, { type: "uint256" }],
            [
              concat([selector, "0x00000000000000000000000000000000000000000000000000000000"]),
              HANDLERS,
            ],
          ),
        ),
      })) ?? "0x0",
    );

  itSettling(
    "a first request installs the handler its callback reaches, in the same transaction",
    async () => {
      const pot = await freshPot(0x1a2en);
      expect(await record(pot, ECHO_SELECTOR)).toBe(0n);
      // What the CLI reads before it sends: not in place yet.
      const handlers = compileSauceProgram(CHAIN, lazyEchoSource(echo, "")).handlers;
      expect(await handlersInPlace(publicClient, pot, handlers)).toBe(false);
      const [id] = await nextIds(1);
      const first = await cook(compiled(lazyEchoSource(echo, ""), [41n, 1_000n]), pot);
      expect(first.ok).toBe(true);
      GAS["lazy: first request, installing its handler"] = await gasOf(first.hash);
      const installed = await record(pot, ECHO_SELECTOR);
      expect(installed).not.toBe(0n);
      // The record the CLI works out is the one the Router wrote.
      expect(word(installed)).toBe(word(handlerRecord(pot, handlers[0]!)));
      expect(await handlersInPlace(publicClient, pot, handlers)).toBe(true);
      expect((await fulfill(id!)).ok).toBe(true);
      expect(await publicClient.getStorageAt({ address: pot, slot: ECHOED_SLOT })).toBe(
        word(1_041n),
      );
      // Again: the handler is in place, so the request only checks it.
      const again = await cook(compiled(lazyEchoSource(echo, ""), [42n, 1_000n]), pot);
      expect(again.ok).toBe(true);
      GAS["lazy: a later request, checking its handler"] = await gasOf(again.hash);
      expect(await record(pot, ECHO_SELECTOR)).toBe(installed);
      // Compiled by a sender that read it installed: no handler carried, only checked.
      const sent = compiledWith(lazyEchoSource(echo, ""), [43n, 1_000n], {
        [ASYNC_INSTALLED_DEFINE]: 1n,
      });
      const carried = compiled(lazyEchoSource(echo, ""), [43n, 1_000n]);
      expect(sent.length).toBeLessThan(carried.length);
      const checked = await cook(sent, pot);
      expect(checked.ok).toBe(true);
      GAS["lazy: a later request, compiled knowing it installed"] = await gasOf(checked.hash);
      // With no engine to work the address out from while compiling, the check hashes the handler.
      const hashed = await cook(
        compiledWith(lazyEchoSource(echo, ""), [44n, 1_000n], { [ASYNC_ENGINE_DEFINE]: 0n }),
        pot,
      );
      expect(hashed.ok).toBe(true);
      GAS["lazy: a later request, its check hashing the handler"] = await gasOf(hashed.hash);
      // Against the same request with no handler at all, its continuation deployed on this Pot.
      await cook(compiled(requestSource(echo), [45n, 1_000n]), pot);
      const plain = await cook(compiled(requestSource(echo), [46n, 1_000n]), pot);
      GAS["lazy: the same request with no handler"] = await gasOf(plain.hash);
    },
  );

  itAlways(
    "compiled knowing its handlers installed, a program refuses a Pot that lacks one",
    async () => {
      const pot = await freshPot(0x1a2fn);
      const program = compiledWith(lazyEchoSource(echo, ""), [1n, 0n], {
        [ASYNC_INSTALLED_DEFINE]: 1n,
      });
      const refused = await revertOf(
        OWNER.address,
        pot,
        encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] }),
        FEE,
      );
      expect(refused.reason).toContain("async: a handler this program needs is not installed");
      expect(await record(pot, ECHO_SELECTOR)).toBe(0n);
    },
  );

  itSettling(
    "an already-settled promise's .catch runs for its body's revert: the body undone, the program going on",
    async () => {
      const body = keccak256(toHex("async.settled.body"));
      const after = keccak256(toHex("async.settled.after"));
      const source = (cond: string) => `import { Promise } from "@sauce/async";

function main(bump: Uint256): void {
  Promise.resolve(41)
    .then((value) => {
      evm.sstore(${body}, value + bump);
      require(${cond}, "settled-body-failed");
    })
    .catch((e) => {
      evm.sstore(${CAUGHT_SLOT}, crypto.keccak256(e));
    });
  evm.sstore(${after}, 7);
}`;
      await setSlot(CAUGHT_SLOT, 0n);
      // The body reverts: what it wrote is undone, the .catch is handed its revert, and the
      // program goes on after the promise.
      const failed = await cook(compiled(source("ctx.blockNumber() == 0"), [1n]));
      expect(failed.ok).toBe(true);
      expect(await slot(body)).toBe(word(0n));
      expect(await slot(CAUGHT_SLOT)).toBe(keccak256(toHex("settled-body-failed")));
      expect(await slot(after)).toBe(word(7n));
      // The body succeeds: it keeps what it wrote, with what it captured, and the .catch does not run.
      await setSlot(CAUGHT_SLOT, 0n);
      await setSlot(after, 0n);
      const kept = await cook(compiled(source("ctx.blockNumber() > 0"), [1n]));
      expect(kept.ok).toBe(true);
      expect(await slot(body)).toBe(word(42n));
      expect(await slot(CAUGHT_SLOT)).toBe(word(0n));
      expect(await slot(after)).toBe(word(7n));
    },
  );

  itAlways(
    "sauce tx and sauce simulate send a program whose handlers are in place compiled to carry none",
    async () => {
      const pot = await freshPot(0x1a32n);
      const file = join(mkdtempSync(join(tmpdir(), "sauce-lazy-")), "echo.sauce.ts");
      writeFileSync(file, lazyEchoSource(echo, ""));
      const on = ["--chain", CHAIN, "--pot", pot, "--rpc-url", RPC_URL, "--args", "5", "0"];
      const carried = compiled(lazyEchoSource(echo, ""), [5n, 0n]);
      const lean = compiledWith(lazyEchoSource(echo, ""), [5n, 0n], {
        [ASYNC_INSTALLED_DEFINE]: 1n,
      });
      const cookData = (program: Hex) =>
        encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] });

      // Not installed yet: the cook carries the handler, and says it installs it.
      const before = await sauce("tx", file, ...on);
      expect(jsonOf(before).data).toBe(cookData(carried));
      expect(before.stderr).toContain("installs its handlers");
      expect((await cook(carried, pot)).ok).toBe(true);

      // In place: both commands compile it again to carry none, and say so.
      const after = await sauce("tx", file, ...on);
      expect(jsonOf(after).data).toBe(cookData(lean));
      expect(after.stderr).toContain("compiled to carry none of them");
      const rehearsed = await sauce("simulate", file, ...on);
      expect(rehearsed.code).toBe(0);
      expect(rehearsed.stderr + rehearsed.stdout).toContain("compiled to carry none of them");
    },
  );

  itAlways(
    "a request declares the ERC-165 interfaces its protocol checks the Pot for",
    async () => {
      const pot = await freshPot(0x1a31n);
      const supports = async (id: Hex): Promise<boolean> =>
        (await publicClient.readContract({
          address: pot,
          abi: parseAbi(["function supportsInterface(bytes4) view returns (bool)"]),
          functionName: "supportsInterface",
          args: [id],
        })) as boolean;
      /** The calls a transaction made to the Pot's `setInterface(bytes4,bool)`, which the Pot
       *  delegates to its Router: the calls, not the delegations. */
      const declarations = async (hash: Hex): Promise<number> => {
        interface Frame {
          type?: string;
          input?: string;
          calls?: Frame[];
        }
        const trace = (await publicClient.request({
          method: "debug_traceTransaction" as never,
          params: [hash, { tracer: "callTracer" }] as never,
        })) as Frame;
        const count = (frame: Frame): number =>
          (frame.type === "CALL" && frame.input?.startsWith("0xc0a43a7c") ? 1 : 0) +
          (frame.calls ?? []).reduce((n, call) => n + count(call), 0);

        return count(trace);
      };
      expect(await supports("0x805f2132")).toBe(false);
      const source = lazyEchoSource(echo, "").replace(
        "      send: (continuation) => {",
        "      interfaces: [0x805f2132],\n      send: (continuation) => {",
      );
      const first = await cook(compiled(source, [3n, 0n]), pot);
      expect(first.ok).toBe(true);
      expect(await supports("0x805f2132")).toBe(true);
      expect(await declarations(first.hash)).toBe(1);
      // Again: declared already, so one read of the Router's record and no declaration.
      const again = await cook(compiled(source, [4n, 0n]), pot);
      expect(again.ok).toBe(true);
      expect(await declarations(again.hash)).toBe(0);
    },
  );

  itSettling("a request with a deadline installs the public expire too", async () => {
    const pot = await freshPot(0x1a30n);
    const [id] = await nextIds(1);
    const first = await cook(compiled(lazyEchoSource(echo, ".within(60)"), [7n, 0n]), pot);
    expect(first.ok).toBe(true);
    GAS["lazy: first request with a deadline, installing echo and expire"] = await gasOf(
      first.hash,
    );
    expect(await record(pot, ECHO_SELECTOR)).not.toBe(0n);
    expect(await record(pot, toFunctionSelector("expire(bytes32)"))).not.toBe(0n);
    // Past the deadline anyone may expire it, through the handler the request installed.
    await later(61);
    const key = keyOf(id!);
    const expired = await send(
      stranger,
      pot,
      concat([toFunctionSelector("expire(bytes32)"), word(key)]),
      FEE,
    );
    expect(expired.ok).toBe(true);
    expect(
      BigInt(
        (await publicClient.getStorageAt({
          address: pot,
          slot: slotOf(key),
        })) ?? "0x0",
      ),
    ).toBe(0n);
  });

  itAlways("refuses `install` on a Shared Pot, which answers no selector", async () => {
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
    const install = compiled(installSource(echo, carrier));
    const refused = await revertOf(
      STRANGER.address,
      shared,
      encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, install] }),
      FEE,
    );
    expect(refused.data).toBe(toFunctionSelector("SharedPot()"));
    expect((await cook(install, shared)).ok).toBe(false);
  });

  itAlways("refuses `install` on a Private Pot whose Router is fixed", async () => {
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
        args: [stack.engine, compiled(installSource(echo, carrier))],
      }),
      FEE,
    );
    expect(refused.data).toBe(toFunctionSelector("RouterFixed()"));
  });
});

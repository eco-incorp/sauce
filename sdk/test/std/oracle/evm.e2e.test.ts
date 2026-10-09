/**
 * `@sauce/oracle` EXECUTED: a program asks a Chainlink CRE workflow for a result, and its `.then`
 * runs on the same Private Pot when the workflow's report arrives — through Chainlink's own
 * KeystoneForwarder, on an anvil running the gated engine and Kitchen with v12 #571's Router, whose
 * fallback runs the handler a Pot registered for a selector.
 *
 * The forwarder is the one Ethereum and Base run: its deployed runtime, captured
 * (`fixtures/KeystoneForwarder.json`), placed at Base's forwarder address, the address
 * `Chainlink.KeystoneForwarder` names in a program compiled for Base. Its owner is set to the
 * harness account, which configures a DON of four test signers. A report is built and signed as a
 * DON builds one — the 109-byte header (version, workflow execution id, timestamp, DON id and config
 * version, workflow CID, name, owner, report id) then the payload — and `report(...)` is sent by a
 * transmitter: the forwarder checks the signatures, asks the Pot over ERC-165 whether it is an
 * `IReceiver` (OpenZeppelin's checker: three static calls of 30,000 gas), and calls its
 * `onReport(metadata, report)`. Each step runs as a user would run it:
 *
 *   1. the owner cooks the program the SDK writes to install `@sauce/oracle`: the `onReport`
 *      handler, `@sauce/async`'s public `expire`, and the `IReceiver` interface the Router answers
 *      ERC-165 for;
 *   2. the owner cooks a program that requests: `Oracle.cre({ owner, args }).then(…).catch(…)`,
 *      which logs `OracleRequest(id, owner, args)` and parks the body as a promise;
 *   3. the DON's report reaches the Pot through the forwarder: the handler checks its caller,
 *      derives the promise's key from the report's id and the metadata's workflow owner, and
 *      fulfils it (the body runs) or rejects it (`.catch` runs, as it does for a body that reverted).
 *
 * And what changes nothing: a report from another workflow owner, which names no promise; a second
 * report, or one after the request expired, for a promise already settled; a call to `onReport`
 * from anyone but the forwarder, refused. A request nobody answers is expired after its deadline,
 * by anyone, rejecting it with `Timeout(bytes32 key)`.
 *
 * GATED twice, as `@sauce/async`'s suite is: on SAUCE_V12_RUNTIME_CREATION_HEX, and on
 * SAUCE_V12_ROUTER_CREATION_HEX, a file of #571's Router creation code (with its native ERC-165),
 * which no release publishes yet. Every delivery needs an engine built from the compiler's tree:
 * `@sauce/async` settles a promise by running its continuation under `evm.delegate(…).catch(…)`,
 * which the released engine runs out of stack on in this handler, and a `.catch` that reads the
 * error it is handed loses its work there. The deliveries skip on the released engine.
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
  getAddress,
  http,
  keccak256,
  pad,
  parseAbi,
  parseEther,
  toFunctionSelector,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

import { requireChain } from "../../../src/chains/canonical.js";
import { chainlink } from "../../../src/protocols/index.js";
import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { handlersInstallSource, packageInstall } from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import { registryTokenAddress } from "../../../src/routes/token-registry.js";
import {
  gateAnchors,
  routerUnderTest,
  startGatedEngine,
  type GatedEngine,
} from "../../evm/gated-engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const ROUTER = routerUnderTest();
const describeOracle = RUNTIME_HEX_PATH && ROUTER !== undefined ? describe : describe.skip;
/** A promise settles through a `.catch` that reads the error, which the released engine does not
 *  run as written: every delivery skips there. */
const RELEASED_ENGINE =
  RUNTIME_HEX_PATH !== undefined &&
  readFileSync(RUNTIME_HEX_PATH, "utf8").trim().toLowerCase() ===
    (
      JSON.parse(
        readFileSync(join(HERE, "../../../src/artifacts/V12RuntimeBytecode.json"), "utf8"),
      ) as { runtimeCreationCode: string }
    ).runtimeCreationCode.toLowerCase();
const itSettling = RELEASED_ENGINE ? it.skip : it;

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(HERE, "fixtures", name), "utf8")) as T;
const FORWARDER_CODE = fixture<{ codeHash: Hex; runtime: Hex }>("KeystoneForwarder.json");
const PROBE = fixture<{ abi: Abi; creationCode: Hex }>("Erc165Probe.json");
const MOCK_ERC20 = JSON.parse(
  readFileSync(join(HERE, "../token/fixtures/MockERC20.json"), "utf8"),
) as { abi: Abi; creationCode: Hex };
/** The `sauce-oracle` skill's example, executed as it is written. */
const PRICE_GATE = readFileSync(
  join(HERE, "../../../../skills/sauce-oracle/examples/price-gate.sauce.ts"),
  "utf8",
);

/** Anvil's first dev account: the Kitchen's owner, the Pot's and the forwarder's. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** A stranger, and the DON's transmitter, which anyone may be. */
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
/** The DON: four signers, of which F + 1 = 2 sign each report. Generated for this suite. */
const SIGNER_KEYS = [1n, 2n, 3n, 4n].map((n) => pad(toHex(0x5167n * 1000n + n), { size: 32 }));
const SIGNERS = SIGNER_KEYS.map((key) => privateKeyToAccount(key).address);
const DON_ID = 7;
const CONFIG_VERSION = 1;

/** The workflow owner the program asks, and another owner whose workflow answers too. */
const WORKFLOW_OWNER = getAddress("0x00000000000000000000000000000000000f10e5");
const OTHER_OWNER = getAddress("0x0000000000000000000000000000000000ba5e00");

const PORT = 8800 + (Number(process.env.JEST_WORKER_ID ?? "1") % 50);
const RPC_URL = `http://127.0.0.1:${PORT}`;
const FEE = 1_234n;
const CHAIN = "base";
const CHAIN_ID = 8453;
const FORWARDER = getAddress(
  chainlink.deployments.find((d) => d.chainId === CHAIN_ID)!.addresses.keystoneForwarder!,
);

const ON_REPORT = toFunctionSelector("onReport(bytes,bytes)");
const EXPIRE = toFunctionSelector("expire(bytes32)");
/** `@sauce/oracle`'s promise tag, and the key of the promise a request is. */
const ORACLE_CRE = keccak256(toHex("sauce.oracle.cre"));
const keyOf = (id: Hex, workflowOwner: Address = WORKFLOW_OWNER): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [
        ORACLE_CRE,
        keccak256(
          encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [workflowOwner, id]),
        ),
      ],
    ),
  );
const IGNORED = keccak256(toHex("PromiseIgnored(bytes32,uint256)"));
const IERC165 = toFunctionSelector("supportsInterface(bytes4)");
/** The Pot storage slots the bodies write. */
const PRICE_SLOT = keccak256(toHex("oracle.price"));
const ERROR_SLOT = keccak256(toHex("oracle.error"));

const potAbi = parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]);
const kitchenAbi = parseAbi(["function setExecutionFee(uint256 fee)"]);
const forwarderAbi = parseAbi([
  "function setConfig(uint32 donId, uint32 configVersion, uint8 f, address[] signers)",
  "function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)",
  "function isForwarder(address forwarder) view returns (bool)",
  "function getTransmissionInfo(address receiver, bytes32 workflowExecutionId, bytes2 reportId) view returns ((bytes32 transmissionId, uint8 state, address transmitter, bool invalidReceiver, bool success, uint80 gasLimit))",
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);
const requestEvent = parseAbi([
  "event OracleRequest(bytes32 indexed id, address indexed owner, bytes args)",
]);

/** The program that requests: a price for `pair` from the owner's workflow; the body stores it if
 *  it is at most `limit`, a value captured when the request was made, and `.catch` stores the hash
 *  of what it is handed. */
const REQUEST = `import { Oracle } from "@sauce/oracle";

function main(owner: Address, pair: bytes, limit: Uint256): void {
  Oracle.cre({ owner, args: pair })
    .then((report) => {
      const [price] = abi.decode(report, ["Uint256"]);
      require(price <= limit, "above the limit");
      evm.sstore(${PRICE_SLOT}, price);
    })
    .catch((err) => {
      evm.sstore(${ERROR_SLOT}, crypto.keccak256(err));
    });
}`;

/** The same request, which anyone may expire 60 seconds after it is made. */
const REQUEST_WITHIN = REQUEST.replace(
  "Oracle.cre({ owner, args: pair })",
  "Oracle.cre({ owner, args: pair }).within(60)",
);

let anvil: ChildProcess;
let publicClient: PublicClient;
let testClient: TestClient;
let stack: GatedEngine;
let probe: Address;

const owner = createWalletClient({ account: OWNER, transport: http(RPC_URL) });
const stranger = createWalletClient({ account: STRANGER, transport: http(RPC_URL) });

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

function compiled(source: string, args: readonly (bigint | Hex)[] = []): Hex {
  const program = compileSauceProgram(CHAIN, source);

  return bytesToHex(concat([program.bytecode, encodeEntryArguments(program, args)]));
}

const cook = (program: Hex) =>
  send(
    owner,
    stack.pot,
    encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] }),
    FEE,
  );

/** Requests a price from `WORKFLOW_OWNER`'s workflow, answering the request's id as logged. */
async function request(
  limit: bigint,
  source = REQUEST,
  more: readonly (bigint | Hex)[] = [],
): Promise<Hex> {
  // What the workflow reads: the pair's name as one ABI-encoded string, which the skill's example
  // takes as a `string` and encodes itself.
  const pair = encodeAbiParameters([{ type: "string" }], ["ETH/USD"]);
  const given = source === PRICE_GATE ? "ETH/USD" : pair;
  const { ok, hash } = await cook(compiled(source, [WORKFLOW_OWNER, given as Hex, limit, ...more]));
  expect(ok).toBe(true);
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const logged = receipt.logs
    .filter(
      (l) =>
        getAddress(l.address) === getAddress(stack.pot) &&
        l.topics[0] === keccak256(toHex("OracleRequest(bytes32,address,bytes)")),
    )
    .map((l) => decodeEventLog({ abi: requestEvent, data: l.data, topics: l.topics }));
  expect(logged).toHaveLength(1);
  expect(logged[0].args.owner).toBe(WORKFLOW_OWNER);
  expect(logged[0].args.args).toBe(pair);

  return logged[0].args.id;
}

let executions = 0n;

/** The raw report a DON signs: its 109-byte header, then the payload. */
function rawReportOf(payload: Hex, workflowOwner: Address, executionId: Hex): Hex {
  return concat([
    "0x01",
    executionId,
    toHex(1_700_000_000, { size: 4 }),
    toHex(DON_ID, { size: 4 }),
    toHex(CONFIG_VERSION, { size: 4 }),
    keccak256(toHex("workflow cid")),
    pad(toHex("prices"), { size: 10, dir: "right" }),
    workflowOwner,
    "0x0001",
    payload,
  ]);
}

/** A DON's report of `payload` from `workflowOwner`'s workflow, signed by F + 1 of the DON's
 *  signers and transmitted by a stranger through the forwarder's `report(...)`: whether the Pot's
 *  `onReport` succeeded, the forwarder having found the Pot a receiver. */
async function delivered(
  payload: Hex,
  workflowOwner: Address = WORKFLOW_OWNER,
): Promise<{ result: boolean; hash: Hex }> {
  executions += 1n;
  const executionId = keccak256(toHex(executions));
  const rawReport = rawReportOf(payload, workflowOwner, executionId);
  const reportContext = concat([keccak256(toHex("config digest")), pad("0x01", { size: 64 })]);
  const digest = keccak256(concat([keccak256(rawReport), reportContext]));
  const signatures = await Promise.all(
    SIGNER_KEYS.slice(0, 2).map(async (privateKey) => {
      const { r, s, yParity } = await sign({ hash: digest, privateKey });
      return concat([r, s, toHex(yParity ?? 0, { size: 1 })]);
    }),
  );
  const { ok, hash } = await send(
    stranger,
    FORWARDER,
    encodeFunctionData({
      abi: forwarderAbi,
      functionName: "report",
      args: [stack.pot, rawReport, reportContext, signatures],
    }),
  );
  expect(ok).toBe(true);
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const processed = receipt.logs
    .filter((l) => getAddress(l.address) === FORWARDER)
    .map((l) => decodeEventLog({ abi: forwarderAbi, data: l.data, topics: l.topics }))
    .find((e) => e.eventName === "ReportProcessed");
  if (processed?.eventName !== "ReportProcessed") throw new Error("no ReportProcessed");
  const info = await publicClient.readContract({
    address: FORWARDER,
    abi: forwarderAbi,
    functionName: "getTransmissionInfo",
    args: [stack.pot, executionId, "0x0001"],
  });
  expect(info.invalidReceiver).toBe(false);

  return { result: processed.args.result, hash };
}

/** Whether `onReport` succeeded for a report of `payload`. */
const report = async (payload: Hex, workflowOwner: Address = WORKFLOW_OWNER): Promise<boolean> =>
  (await delivered(payload, workflowOwner)).result;

/** The data of the Pot's logs with no topic in a transaction: what a program's `log(data)` wrote. */
async function potData(hash: Hex): Promise<Hex[]> {
  const receipt = await publicClient.getTransactionReceipt({ hash });

  return receipt.logs
    .filter((l) => getAddress(l.address) === getAddress(stack.pot) && l.topics.length === 0)
    .map((l) => l.data);
}

/** The Pot's logs in a transaction, as [topic0, topic1]. */
async function potLogs(hash: Hex): Promise<Hex[][]> {
  const receipt = await publicClient.getTransactionReceipt({ hash });

  return receipt.logs
    .filter((l) => getAddress(l.address) === getAddress(stack.pot))
    .map((l) => l.topics.slice(0, 2) as Hex[]);
}

const payloadOf = (id: Hex, ok: boolean, data: Hex): Hex =>
  encodeAbiParameters([{ type: "bytes32" }, { type: "bool" }, { type: "bytes" }], [id, ok, data]);
const priceOf = (price: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [price]);
const slot = async (at: Hex): Promise<Hex> =>
  (await publicClient.getStorageAt({ address: stack.pot, slot: at })) ?? "0x";
const query = async (interfaceId: Hex) =>
  (await publicClient.readContract({
    address: probe,
    abi: PROBE.abi,
    functionName: "query",
    args: [stack.pot, interfaceId],
  })) as readonly [boolean, bigint];

describeOracle("@sauce/oracle through Chainlink's KeystoneForwarder", () => {
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
      ).ok,
    ).toBe(true);
    // The Router pays a handler's fee from the Pot's balance.
    await testClient.setBalance({ address: stack.pot, value: parseEther("1") });

    // The forwarder Base runs, at Base's address, owned by the harness: slot 0 is its owner, and
    // its constructor's one write, `s_forwarders[this] = true`, is mapping slot 3.
    await testClient.setCode({ address: FORWARDER, bytecode: FORWARDER_CODE.runtime });
    expect(keccak256((await publicClient.getCode({ address: FORWARDER }))!)).toBe(
      FORWARDER_CODE.codeHash,
    );
    await testClient.setStorageAt({
      address: FORWARDER,
      index: 0,
      value: pad(OWNER.address, { size: 32 }),
    });
    await testClient.setStorageAt({
      address: FORWARDER,
      index: keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [FORWARDER, 3n]),
      ),
      value: pad("0x01", { size: 32 }),
    });
    expect(
      await publicClient.readContract({
        address: FORWARDER,
        abi: forwarderAbi,
        functionName: "isForwarder",
        args: [FORWARDER],
      }),
    ).toBe(true);
    expect(
      (
        await send(
          owner,
          FORWARDER,
          encodeFunctionData({
            abi: forwarderAbi,
            functionName: "setConfig",
            args: [DON_ID, CONFIG_VERSION, 1, SIGNERS],
          }),
        )
      ).ok,
    ).toBe(true);

    const deployed = await owner.sendTransaction({
      account: OWNER,
      chain: null,
      data: PROBE.creationCode,
    });
    probe = (await publicClient.waitForTransactionReceipt({ hash: deployed })).contractAddress!;

    const { handlers, interfaces } = packageInstall(CHAIN, "@sauce/oracle");
    const install = handlersInstallSource(handlers, "@sauce/oracle", interfaces);
    expect((await cook(compiled(install))).ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    if (anvil !== undefined && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("installs `onReport` and the public `expire`, run as cooks, and declares `IReceiver`", () => {
    const { handlers, interfaces, skipped } = packageInstall(CHAIN, "@sauce/oracle");
    expect(handlers.map((h) => [h.selector, h.readOnly])).toEqual([
      [ON_REPORT, false],
      [EXPIRE, false],
    ]);
    expect(interfaces).toEqual([ON_REPORT]);
    expect(skipped).toEqual([]);
  });

  it("skips `onReport` on a chain with no forwarder", () => {
    const { handlers, skipped } = packageInstall("optimism", "@sauce/oracle");
    expect(handlers.map((h) => h.selector)).toEqual([EXPIRE]);
    expect(skipped.map((s) => s.selector)).toEqual(["onReport(bytes,bytes)"]);
  });

  it("the forwarder's ERC-165 check: each of its three calls answers within 30,000 gas", async () => {
    // Each call is given exactly 30,000 gas, as the forwarder gives it: an answer is one that fit.
    expect((await query(IERC165))[0]).toBe(true);
    expect((await query("0xffffffff"))[0]).toBe(false);
    expect((await query(ON_REPORT))[0]).toBe(true);
    expect(
      await publicClient.readContract({
        address: probe,
        abi: PROBE.abi,
        functionName: "supportsInterface",
        args: [stack.pot, ON_REPORT],
      }),
    ).toBe(true);
  });

  itSettling(
    "a report from the workflow asked runs the body with its data, once, for one fee",
    async () => {
      const id = await request(4_000n * 10n ** 8n);
      const kitchen = gateAnchors().kitchen;
      const kitchenBefore = await publicClient.getBalance({ address: kitchen });

      expect(await report(payloadOf(id, true, priceOf(3_456n * 10n ** 8n)))).toBe(true);
      expect(await slot(PRICE_SLOT)).toBe(priceOf(3_456n * 10n ** 8n));
      expect((await publicClient.getBalance({ address: kitchen })) - kitchenBefore).toBe(FEE);
    },
  );

  itSettling("a failure report runs `.catch` with the workflow's error", async () => {
    const id = await request(1n);
    const error = toHex("upstream API returned 503");

    expect(await report(payloadOf(id, false, error))).toBe(true);
    expect(await slot(ERROR_SLOT)).toBe(keccak256(error));
  });

  itSettling(
    "a body that reverts runs `.catch` with its reason, everything it did undone",
    async () => {
      const id = await request(1n);
      const before = await slot(PRICE_SLOT);

      expect(await report(payloadOf(id, true, priceOf(2n)))).toBe(true);
      expect(await slot(PRICE_SLOT)).toBe(before);
      expect(await slot(ERROR_SLOT)).toBe(keccak256(toHex("above the limit")));
    },
  );

  itSettling(
    "a report from another workflow owner finds no request, and leaves it waiting",
    async () => {
      const id = await request(10n ** 30n);
      const before = await slot(PRICE_SLOT);

      const other = await delivered(payloadOf(id, true, priceOf(1n)), OTHER_OWNER);
      expect(other.result).toBe(true);
      expect(await potLogs(other.hash)).toContainEqual([IGNORED, keyOf(id, OTHER_OWNER)]);
      expect(await slot(PRICE_SLOT)).toBe(before);

      // The owner's own report still settles it.
      expect(await report(payloadOf(id, true, priceOf(77n)))).toBe(true);
      expect(await slot(PRICE_SLOT)).toBe(priceOf(77n));
    },
  );

  itSettling(
    "refuses `onReport` from anyone but the forwarder, and leaves the request waiting",
    async () => {
      const id = await request(10n ** 30n);
      const metadata = concat([
        keccak256(toHex("workflow id")),
        pad(toHex("prices"), { size: 10, dir: "right" }),
        WORKFLOW_OWNER,
        "0x0001",
      ]);
      const forged = concat([
        ON_REPORT,
        encodeAbiParameters(
          [{ type: "bytes" }, { type: "bytes" }],
          [metadata, payloadOf(id, true, priceOf(1n))],
        ),
      ]);
      expect((await send(stranger, stack.pot, forged)).ok).toBe(false);

      expect(await report(payloadOf(id, true, priceOf(88n)))).toBe(true);
      expect(await slot(PRICE_SLOT)).toBe(priceOf(88n));
    },
  );

  itSettling("a second report for a settled request changes nothing", async () => {
    const id = await request(10n ** 30n);
    expect(await report(payloadOf(id, true, priceOf(5n)))).toBe(true);
    expect(await slot(PRICE_SLOT)).toBe(priceOf(5n));

    const again = await delivered(payloadOf(id, true, priceOf(6n)));
    expect(again.result).toBe(true);
    expect(await potLogs(again.hash)).toContainEqual([IGNORED, keyOf(id)]);
    expect(await slot(PRICE_SLOT)).toBe(priceOf(5n));
  });

  itSettling(
    "a request nobody answers in time rejects with Timeout through `expire`, and a late report changes nothing",
    async () => {
      const id = await request(10n ** 30n, REQUEST_WITHIN);
      const expire = concat([EXPIRE, keyOf(id)]);
      // Before the deadline, refused.
      expect((await send(stranger, stack.pot, expire, FEE)).ok).toBe(false);

      await testClient.increaseTime({ seconds: 61 });
      await testClient.mine({ blocks: 1 });
      const before = await slot(PRICE_SLOT);
      expect((await send(stranger, stack.pot, expire, FEE)).ok).toBe(true);
      expect(await slot(ERROR_SLOT)).toBe(keccak256(concat(["0xe6cc9dd0", keyOf(id)])));

      const late = await delivered(payloadOf(id, true, priceOf(9n)));
      expect(late.result).toBe(true);
      expect(await potLogs(late.hash)).toContainEqual([IGNORED, keyOf(id)]);
      expect(await slot(PRICE_SLOT)).toBe(before);
    },
  );

  itSettling(
    "the skill's example pays USDC when the price is at most the limit, and logs why when it is not",
    async () => {
      // Base's USDC, as the program names it: a mock token at its address, holding the Pot's USDC.
      const usdc = getAddress(
        toHex(registryTokenAddress(requireChain(CHAIN), "USDC")!, { size: 20 }),
      );
      const deployed = await owner.sendTransaction({
        account: OWNER,
        chain: null,
        data: MOCK_ERC20.creationCode,
      });
      const mock = (await publicClient.waitForTransactionReceipt({ hash: deployed }))
        .contractAddress!;
      await testClient.setCode({
        address: usdc,
        bytecode: (await publicClient.getCode({ address: mock }))!,
      });
      const mint = encodeFunctionData({
        abi: MOCK_ERC20.abi,
        functionName: "mint",
        args: [stack.pot, 10_000_000n],
      });
      expect((await send(owner, usdc, mint)).ok).toBe(true);
      const recipient = getAddress("0x00000000000000000000000000000000000beef1");
      const balance = async () =>
        (await publicClient.readContract({
          address: usdc,
          abi: MOCK_ERC20.abi,
          functionName: "balanceOf",
          args: [recipient],
        })) as bigint;

      const paid = await request(4_000n * 10n ** 8n, PRICE_GATE, [recipient, 1_000_000n]);
      expect((await delivered(payloadOf(paid, true, priceOf(3_999n * 10n ** 8n)))).result).toBe(
        true,
      );
      expect(await balance()).toBe(1_000_000n);

      const refused = await request(4_000n * 10n ** 8n, PRICE_GATE, [recipient, 1_000_000n]);
      const over = await delivered(payloadOf(refused, true, priceOf(4_001n * 10n ** 8n)));
      expect(over.result).toBe(true);
      expect(await potData(over.hash)).toContainEqual(toHex("above the limit"));
      expect(await balance()).toBe(1_000_000n);
    },
  );
});

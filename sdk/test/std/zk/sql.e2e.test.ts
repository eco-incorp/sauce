/**
 * `@sauce/zk`'s SQL query EXECUTED: a program asks Space and Time a query now, the QueryRouter
 * verifies its proof later and the CallbackExecutor calls the Pot back with the result, and the
 * `.then` body runs on the same Private Pot — on an anvil running the gated engine and Kitchen with
 * v12 #571's Router, whose fallback runs the handler a Pot registered for `queryCallback`.
 *
 * Space and Time's contracts are its own, deployed as they were on Ethereum and on Base: each
 * creation transaction replayed from its deployer at its nonce (`fixtures/SpaceAndTime.json`), so
 * the QueryRouter and the CallbackExecutor land at their addresses with their constructors'
 * arguments, and each runtime is held to the chain's. The SXT token is each chain's own runtime.
 * Only what a local suite cannot have is not real: the proof (the "latest" verifier takes any, and
 * answers it as the result) and, on Ethereum, Chainlink's two price feeds the executor prices the
 * callback's gas through (`fixtures/SpaceAndTimeMocks.sol`). The results the suite proves are real
 * ones the QueryRouter verified on chain.
 *
 *   1. the owner cooks the program the SDK writes to install `@sauce/zk`'s handlers on the Pot:
 *      `queryCallback`'s, and `@sauce/async`'s `expire(bytes32)`;
 *   2. the owner cooks a program that queries, `Zk.sql({ … }).then((result) => { … })`: the Pot
 *      approves and pays the query's SXT, and parks the body under the query's id;
 *   3. the fulfiller fulfils it: the router verifies, pays the fulfiller, refunds the rest, and the
 *      executor calls the Pot, whose handler fulfils the promise with the result for one Kitchen fee.
 *
 * And what is refused or ignored: a callback from anyone but the executor, a stranger's query naming
 * the Pot, a second fulfilment. A query past its timeout is expired by anyone, its `.catch` runs and
 * `Zk.cancel(e)` takes its payment back.
 */
import {
  concat,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toFunctionSelector,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { QueryRouterABI } from "../../../src/protocols/space-and-time/abis.js";
import { gateAnchors } from "../../evm/gated-engine.js";
import {
  describeOnRouter,
  FEE,
  STRANGER,
  startZkChain,
  text,
  type Sent,
  type ZkChain,
} from "./harness.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
interface Deployed {
  readonly address: Address;
  readonly nonce: number;
  readonly creation: Hex;
  readonly codeHash: Hex;
}
const SXT = JSON.parse(readFileSync(join(FIXTURES, "SpaceAndTime.json"), "utf8")) as {
  chains: Record<
    string,
    {
      deployer: Address;
      executor: Deployed;
      router: Deployed;
      token: { address: Address; codeHash: Hex; runtime: Hex };
      live: { baseCost: string; gasCostConfig: string[] };
    }
  >;
  results: { chain: number; block: number; transaction: Hex; result: Hex }[];
};
const MOCKS = JSON.parse(readFileSync(join(FIXTURES, "SpaceAndTimeMocks.json"), "utf8")) as Record<
  "PoSQLVerifierMock" | "AggregatorMock",
  { abi: Abi; creationCode: Hex; runtime: Hex }
>;

/** Space and Time's fulfiller, a key of the suite's own, given the router's FULFILLER_ROLE. */
const FULFILLER = privateKeyToAccount(keccak256(toHex("sauce.zk.test.fulfiller")));

/** A proof plan: what the query is does not matter to a mocked proof, but it is hashed into the
 *  query's id as a real one is. This one is Space and Time's tutorial's. */
const PLAN =
  "0x0000000000000001000000000000003d5455544f5249414c5f414243384437303943383032363239363533343446353234304144313233463543424535313132332e48454c4c4f5f574f524c440000000000000002000000000000000000000000000000044e414d4500000007000000000000000000000000000000094c4f4e47495455444500000005000000000000000100000000000000044e414d45000000000000000000000000000000020000000000000000000000010000000100000005000000000000003c0000000000000001000000000000000000000000" as Hex;

/** Real results: a staking row (INT, TIMESTAMP, VARBINARY, DECIMAL75), and Base's LONGITUDE (one
 *  BIGINT). Each from its chain's QueryFulfilled. */
const STAKE = SXT.results.find((r) => r.block === 25272381)!.result;
const LONGITUDE = SXT.results.find((r) => r.chain === 8453)!.result;
const VARCHARS = SXT.results.find((r) => r.block === 25199551)!.result;

const QUERY_CALLBACK = toFunctionSelector("queryCallback(bytes32,bytes,bytes)");
const EXPIRE = toFunctionSelector("expire(bytes32)");
const SQL_TAG = keccak256(toHex("sauce.zk.sql"));
const LATEST = keccak256(toHex("latest"));
const PROMISE_IGNORED = keccak256(toHex("PromiseIgnored(bytes32,uint256)"));

/** The Pot storage slots the bodies write. */
const SLOT = keccak256(toHex("zk.sql.value"));
const ROWS = keccak256(toHex("zk.sql.rows"));
const CAUGHT = keccak256(toHex("zk.sql.caught"));

const roleAbi = parseAbi([
  "function grantRole(bytes32 role, address account)",
  "function registerVerifierToVersion(string version, address verifier)",
  "function setBaseCost(uint256 newBaseCost)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

/** The program that queries, and a body that writes one value of the result plus `bump`, a value
 *  it captured when the query was asked, and the result's row count. */
const QUERY = `import { Zk } from "@sauce/zk";

function main(plan: bytes, payment: Uint256, column: Uint256, bump: Uint256): void {
  Zk.sql({ query: plan, payment })
    .then((result) => {
      evm.sstore(${SLOT}, Zk.cell(result, column, 0) + bump);
      evm.sstore(${ROWS}, Zk.rows(result));
    })
    .catch((e) => {
      evm.sstore(${CAUGHT}, Zk.cancel(e) ? 2 : 1);
    });
}`;

/** The skill's example: a payment made once the proven value reaches a minimum. */
const PROVEN_PAYOUT = readFileSync(
  join(FIXTURES, "../../../../../skills/sauce-zk/examples/proven-payout.sauce.ts"),
  "utf8",
);

/** The same with a timeout of a minute. */
const QUERY_WITHIN_A_MINUTE = QUERY.replace(
  "{ query: plan, payment }",
  "{ query: plan, payment, timeout: 60 }",
);

const word = (value: bigint): Hex => toHex(value, { size: 32 });
const promiseKeyOf = (queryId: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [SQL_TAG, queryId]));

interface Requested {
  readonly queryId: Hex;
  readonly queryNonce: bigint;
  readonly requester: Address;
  readonly query: { version: Hex; innerQuery: Hex; parameters: Hex; metadata: Hex };
  readonly callback: {
    maxGasPrice: bigint;
    gasLimit: bigint;
    callbackContract: Address;
    selector: Hex;
    callbackData: Hex;
  };
  readonly payment: { paymentAmount: bigint; refundTo: Address; timeout: bigint };
}

describeOnRouter.each([
  { slug: "ethereum", chainId: 1 },
  { slug: "base", chainId: 8453 },
])("@sauce/zk's SQL query on $slug", ({ slug, chainId }) => {
  const fixture = SXT.chains[String(chainId)]!;
  const router = fixture.router.address;
  const executor = fixture.executor.address;
  const token = fixture.token.address;
  const baseCost = BigInt(fixture.live.baseCost);
  /** Twice the base cost: on Ethereum the callback's gas is paid from it too. */
  const PAYMENT = 2n * baseCost;

  let chain: ZkChain;
  let fulfiller: WalletClient;

  const sxt = (holder: Address) =>
    chain.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder],
    });

  /** Each of the QueryRouter's events a transaction logged, decoded with the registry's ABI. */
  const eventsOf = (sent: Sent) =>
    sent.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== router.toLowerCase()) return [];
      try {
        return [decodeEventLog({ abi: QueryRouterABI, data: log.data, topics: log.topics })];
      } catch {
        return [];
      }
    });

  /** The query a transaction asked, from its `QueryRequested`. */
  const requested = (sent: Sent): Requested => {
    const event = eventsOf(sent).find((e) => e.eventName === "QueryRequested");
    if (event === undefined) throw new Error("the transaction asked no query");

    return event.args as unknown as Requested;
  };

  /** `fulfillQuery` as Space and Time's fulfiller sends it, proving `result`. */
  const fulfil = (asked: Requested, result: Hex) =>
    chain.send(
      fulfiller,
      router,
      encodeFunctionData({
        abi: QueryRouterABI,
        functionName: "fulfillQuery",
        args: [asked.query, asked.callback, asked.payment, asked.queryNonce, result],
      }),
    );

  const ask = async (source: string, column: bigint, bump: bigint): Promise<Requested> => {
    const sent = await chain.cook(chain.compiled(source, [PLAN, PAYMENT, column, bump]));
    expect(sent.ok).toBe(true);

    return requested(sent);
  };

  const ignored = (sent: Sent, key: Hex): boolean =>
    sent.logs.some(
      (log) =>
        log.address.toLowerCase() === chain.stack.pot.toLowerCase() &&
        log.topics[0] === PROMISE_IGNORED &&
        log.topics[1] === key,
    );

  beforeAll(async () => {
    // 9550-9599, which no other suite takes: 25 ports a chain, one per worker.
    chain = await startZkChain(
      slug,
      chainId,
      9550 + (chainId === 1 ? 0 : 25) + (Number(process.env.JEST_WORKER_ID ?? "1") % 25),
    );
    const { testClient, publicClient } = chain;

    // Space and Time's deployer replays its two creation transactions at their nonces.
    const deployer = await chain.impersonate(fixture.deployer);
    for (const contract of [fixture.executor, fixture.router].sort((a, b) => a.nonce - b.nonce)) {
      await testClient.setNonce({ address: fixture.deployer, nonce: contract.nonce });
      const created = await chain.send(deployer, undefined, contract.creation);
      expect(created.contractAddress?.toLowerCase()).toBe(contract.address.toLowerCase());
      expect(keccak256((await publicClient.getCode({ address: contract.address }))!)).toBe(
        contract.codeHash,
      );
    }
    // The chain's SXT, with the Pot's and the stranger's balances.
    await testClient.setCode({ address: token, bytecode: fixture.token.runtime });
    for (const holder of [chain.stack.pot, STRANGER.address]) {
      await testClient.setStorageAt({
        address: token,
        index: keccak256(
          encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 0n]),
        ),
        value: word(100n * baseCost),
      });
    }
    expect(await sxt(chain.stack.pot)).toBe(100n * baseCost);
    // Ethereum's executor prices the callback's gas: ETH at 3,000 USD, SXT at 0.05.
    if (chainId === 1) {
      const [ethUsd, , sxtUsd] = fixture.live.gasCostConfig as [Address, string, Address];
      for (const [feed, price] of [
        [ethUsd, 3_000n * 10n ** 8n],
        [sxtUsd, 5n * 10n ** 6n],
      ] as const) {
        await testClient.setCode({ address: feed, bytecode: MOCKS.AggregatorMock.runtime });
        await testClient.setStorageAt({ address: feed, index: word(0n), value: word(price) });
      }
    }
    // As the deployer configured them: the "latest" verifier, the base cost, the roles.
    const verifier = (
      await chain.send(chain.owner, undefined, MOCKS.PoSQLVerifierMock.creationCode)
    ).contractAddress!;
    fulfiller = await chain.wallet(FULFILLER);
    const admin = async (to: Address, data: Hex) =>
      expect((await chain.send(deployer, to, data)).ok).toBe(true);
    const grant = (to: Address, role: string, account: Address) =>
      admin(
        to,
        encodeFunctionData({
          abi: roleAbi,
          functionName: "grantRole",
          args: [keccak256(toHex(role)), account],
        }),
      );
    await grant(router, "VERSION_EDITOR_ROLE", fixture.deployer);
    await admin(
      router,
      encodeFunctionData({
        abi: roleAbi,
        functionName: "registerVerifierToVersion",
        args: ["latest", verifier],
      }),
    );
    await admin(
      router,
      encodeFunctionData({ abi: roleAbi, functionName: "setBaseCost", args: [baseCost] }),
    );
    await grant(router, "FULFILLER_ROLE", FULFILLER.address);
    await grant(executor, "EXECUTOR_ROLE", router);

    expect(await chain.installPackage("@sauce/zk")).toEqual([QUERY_CALLBACK, EXPIRE]);
  }, 180_000);

  afterAll(async () => {
    await chain?.stop();
  });

  it("asks the query with the Pot as its callback, under the latest version, paying SXT", async () => {
    const potBefore = await sxt(chain.stack.pot);
    const sent = await chain.cook(chain.compiled(QUERY, [PLAN, PAYMENT, 0n, 0n]));
    expect(sent.ok).toBe(true);
    const asked = requested(sent);
    const block = await chain.publicClient.getBlock({ blockNumber: undefined });

    expect(asked.requester).toBe(chain.stack.pot);
    expect(asked.query).toEqual({
      version: LATEST,
      innerQuery: PLAN,
      parameters: "0x0000000000000000",
      metadata: "0x",
    });
    expect(asked.callback).toEqual({
      maxGasPrice: 2n ** 256n - 1n,
      gasLimit: 1_000_000n,
      callbackContract: chain.stack.pot,
      selector: QUERY_CALLBACK,
      callbackData: "0x",
    });
    expect(asked.payment).toEqual({
      paymentAmount: PAYMENT,
      refundTo: chain.stack.pot,
      timeout: block.timestamp + 3_600n,
    });
    expect(potBefore - (await sxt(chain.stack.pot))).toBe(PAYMENT);
    expect(await sxt(router)).toBeGreaterThanOrEqual(PAYMENT);
  });

  it("runs the body with the proven result, pays the fulfiller and refunds the rest, for one fee", async () => {
    const asked = await ask(QUERY, 3n, 7n);
    const kitchen = gateAnchors().kitchen;
    const kitchenBefore = await chain.publicClient.getBalance({ address: kitchen });
    const potBefore = await sxt(chain.stack.pot);

    const fulfilment = await fulfil(asked, STAKE);
    expect(fulfilment.ok).toBe(true);
    // The staking row's AMOUNT, a DECIMAL75, after an INT, a TIMESTAMP and a VARBINARY.
    expect(await chain.slot(SLOT)).toBe(100_000_000_000_000_000_000n + 7n);
    expect(await chain.slot(ROWS)).toBe(1n);
    expect((await chain.publicClient.getBalance({ address: kitchen })) - kitchenBefore).toBe(FEE);

    const payout = eventsOf(fulfilment).find((e) => e.eventName === "PayoutOccurred")!.args as {
      fulfillerAmount: bigint;
      refundAmount: bigint;
    };
    expect(payout.fulfillerAmount + payout.refundAmount).toBe(PAYMENT);
    expect(payout.fulfillerAmount).toBeGreaterThanOrEqual(baseCost);
    if (chainId === 8453) expect(payout.fulfillerAmount).toBe(baseCost);
    expect((await sxt(chain.stack.pot)) - potBefore).toBe(payout.refundAmount);
    expect(await sxt(FULFILLER.address)).toBeGreaterThanOrEqual(payout.fulfillerAmount);

    const gas = await chain.callGas(fulfilment.hash, chain.stack.pot, QUERY_CALLBACK);
    console.log(`${slug}: the callback used ${gas} gas`);
    expect(gas).toBeLessThan(1_000_000n);
  });

  it("reads a BIGINT result, Base's longitude", async () => {
    const asked = await ask(QUERY, 0n, 0n);
    expect((await fulfil(asked, LONGITUDE)).ok).toBe(true);
    expect(await chain.slot(SLOT)).toBe(51n);
  });

  it("refuses a second fulfilment: the router answers a query once", async () => {
    const asked = await ask(QUERY, 0n, 1n);
    expect((await fulfil(asked, LONGITUDE)).ok).toBe(true);
    expect(await chain.slot(SLOT)).toBe(52n);
    const again = encodeFunctionData({
      abi: QueryRouterABI,
      functionName: "fulfillQuery",
      args: [asked.query, asked.callback, asked.payment, asked.queryNonce, STAKE],
    });
    expect(await chain.revertOf(FULFILLER.address, router, again)).toBe(
      toFunctionSelector("QueryNotFound()"),
    );
  });

  it("refuses a callback from anyone but the executor", async () => {
    const asked = await ask(QUERY, 0n, 0n);
    const forged = concat([
      QUERY_CALLBACK,
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes" }, { type: "bytes" }],
        [asked.queryId, STAKE, "0x"],
      ),
    ]);
    expect(text(await chain.revertOf(STRANGER.address, chain.stack.pot, forged))).toBe(
      "async: the call is not from the protocol",
    );
    // The query's own fulfilment still runs it.
    expect((await fulfil(asked, LONGITUDE)).ok).toBe(true);
    expect(await chain.slot(SLOT)).toBe(51n);
  });

  it("settles nothing for a stranger's query naming the Pot", async () => {
    // The stranger asks a query whose callback is the Pot's, paying its own SXT: the executor calls
    // the Pot, which finds no promise under that query's id.
    const stranger = chain.stranger;
    expect(
      (
        await chain.send(
          stranger,
          token,
          encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, PAYMENT] }),
        )
      ).ok,
    ).toBe(true);
    const sent = await chain.send(
      stranger,
      router,
      encodeFunctionData({
        abi: QueryRouterABI,
        functionName: "requestQuery",
        args: [
          { version: LATEST, innerQuery: PLAN, parameters: "0x0000000000000000", metadata: "0x" },
          {
            maxGasPrice: 2n ** 256n - 1n,
            gasLimit: 300_000n,
            callbackContract: chain.stack.pot,
            selector: QUERY_CALLBACK,
            callbackData: "0x",
          },
          { paymentAmount: PAYMENT, refundTo: STRANGER.address, timeout: 2n ** 40n },
        ],
      }),
    );
    expect(sent.ok).toBe(true);
    const asked = requested(sent);
    const before = await chain.slot(SLOT);
    const fulfilment = await fulfil(asked, STAKE);
    expect(fulfilment.ok).toBe(true);
    expect(ignored(fulfilment, promiseKeyOf(asked.queryId))).toBe(true);
    expect(await chain.slot(SLOT)).toBe(before);
  });

  it("expires a query past its timeout: its `.catch` cancels it and takes the payment back", async () => {
    const asked = await ask(QUERY_WITHIN_A_MINUTE, 0n, 0n);
    const key = promiseKeyOf(asked.queryId);
    const expire = concat([EXPIRE, key]);
    // Before the timeout the Pot refuses.
    expect((await chain.send(chain.stranger, chain.stack.pot, expire, FEE)).ok).toBe(false);

    await chain.testClient.increaseTime({ seconds: 61 });
    await chain.testClient.mine({ blocks: 1 });
    const potBefore = await sxt(chain.stack.pot);
    const expired = await chain.send(chain.stranger, chain.stack.pot, expire, FEE);
    expect(expired.ok).toBe(true);
    expect(await chain.slot(CAUGHT)).toBe(2n);
    expect((await sxt(chain.stack.pot)) - potBefore).toBe(PAYMENT);
    expect(
      await chain.publicClient.readContract({
        address: router,
        abi: QueryRouterABI,
        functionName: "pendingPayments",
        args: [asked.queryId],
      }),
    ).toBe(word(0n));
    // The fulfiller is too late: the query is gone.
    expect((await fulfil(asked, LONGITUDE)).ok).toBe(false);
  });

  it.each([
    [51n, 1_000n],
    [52n, 0n],
  ])(
    "the skill's sauce-zk/examples/proven-payout, its minimum %s, pays %s",
    async (minimum, paid) => {
      const recipient = privateKeyToAccount(
        keccak256(toHex(`sauce.zk.test.payee.${minimum}`)),
      ).address;
      const sent = await chain.cook(
        chain.compiled(PROVEN_PAYOUT, [PLAN, PAYMENT, minimum, recipient, 1_000n]),
      );
      expect(sent.ok).toBe(true);
      // Base's longitude, 51, proven.
      expect((await fulfil(requested(sent), LONGITUDE)).ok).toBe(true);
      expect(await chain.publicClient.getBalance({ address: recipient })).toBe(paid);
    },
  );

  it("runs `.catch` for the body's own revert, and `Zk.cancel` leaves the paid query alone", async () => {
    // A VARCHAR column has no fixed width: the body's `Zk.cell` reverts.
    const asked = await ask(QUERY, 0n, 0n);
    const potBefore = await sxt(chain.stack.pot);
    const fulfilment = await fulfil(asked, VARCHARS);
    expect(fulfilment.ok).toBe(true);
    expect(await chain.slot(CAUGHT)).toBe(1n);
    const payout = eventsOf(fulfilment).find((e) => e.eventName === "PayoutOccurred")!.args as {
      refundAmount: bigint;
    };
    expect((await sxt(chain.stack.pot)) - potBefore).toBe(payout.refundAmount);
  });
});

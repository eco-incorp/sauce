/**
 * `@sauce/zk`'s Axiom V2 query EXECUTED: a program sends a query now, AxiomV2Query calls the Pot
 * back later with the proven results, and the `.then` body runs on the same Private Pot — on an
 * anvil running the released gated engine and Kitchen with v12 #571's Router, whose fallback runs
 * the handler a Pot registered for `axiomV2Callback`.
 *
 * AxiomV2Query is Axiom's own, as deployed on Ethereum and on Base (`fixtures/AxiomV2Query.json`:
 * the proxy at the registry's address and the implementation its slot names, read from each
 * chain), initialized with the chain's live fee parameters. Only the proof is not real: a local
 * suite cannot make one, so the header verifier and the query verifier are mocks that accept any
 * (`fixtures/AxiomProofMocks.sol`), and the suite's prover writes a proof carrying the public
 * instances AxiomV2Query reads. Everything else is AxiomV2Query's own code: the query's hash and id,
 * the escrow it takes, the checks a fulfilment passes, the callback's encoding and its gas.
 *
 *   1. the owner cooks a program that installs `@sauce/zk`'s handler for `axiomV2Callback`, compiled
 *      by the SDK for the chain;
 *   2. the owner cooks a program that queries, `Zk.axiom({ … }).then((results) => { … })`: the Pot
 *      pays AxiomV2Query exactly its escrow and the body travels as the callback's extra data;
 *   3. the prover fulfils it: AxiomV2Query calls the Pot, whose handler checks the caller and the
 *      query's sender and runs the body with the results, for one Kitchen fee.
 *
 * And what is refused: a callback for a query another address sent naming the Pot, a callback from
 * anyone but AxiomV2Query, and a second fulfilment. An unfulfilled query's escrow comes back to the
 * Pot after its deadline. The query costs are measured against parking the body instead.
 *
 * GATED twice, as `@sauce/async`'s suite is: on SAUCE_V12_RUNTIME_CREATION_HEX, and on
 * SAUCE_V12_ROUTER_CREATION_HEX, #571's Router creation code, which no release publishes yet.
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
  encodePacked,
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { AxiomV2QueryABI } from "../../../src/protocols/axiom-v2/abis.js";
import { encodeEntryArguments } from "../../../src/routes/entry.js";
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
const describeZk = RUNTIME_HEX_PATH && ROUTER !== undefined ? describe : describe.skip;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const AXIOM = JSON.parse(readFileSync(join(FIXTURES, "AxiomV2Query.json"), "utf8")) as {
  chains: Record<
    string,
    {
      proxy: { address: Address; runtime: Hex };
      implementation: { address: Address; runtime: Hex };
    }
  >;
};
const MOCKS = JSON.parse(readFileSync(join(FIXTURES, "AxiomProofMocks.json"), "utf8")) as Record<
  "AxiomHeaderVerifierMock" | "AxiomVerifierMock",
  { abi: Abi; creationCode: Hex }
>;
const HANDLER = readFileSync(join(process.cwd(), "src", "std", "zk", "axiom.handler.js"), "utf8");

/** Anvil's dev accounts: the Kitchen's owner and the Pot's, and a stranger; and Axiom's prover, a
 *  key of the suite's own, funded where the chain starts. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const PROVER = privateKeyToAccount(keccak256(toHex("sauce.zk.test.prover")));

/** Non-zero, so a callback's single fee can be counted. */
const FEE = 1_234n;
const ERC1967_IMPLEMENTATION = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** The aggregate verifying key the suite's proofs name, which AxiomV2Query is initialized to take. */
const AGGREGATE_VKEY_HASH = keccak256(toHex("sauce.zk.test.aggregate-vkey"));
/** What a query's `sendQuery` was given, as Axiom's tooling would produce it: arbitrary here, since
 *  the proof is mocked, but hashed by AxiomV2Query exactly as a real one is. */
const QUERY = {
  dataQuery: toHex("sauce.zk.test.subqueries"),
  dataQueryHash: keccak256(toHex("sauce.zk.test.subqueries")),
  k: 14n,
  resultLen: 2n,
  vkey: [keccak256(toHex("vkey.0")), keccak256(toHex("vkey.1"))],
  computeProof: concat([
    toHex(0n, { size: 64 }),
    toHex(41n, { size: 32 }),
    toHex(1n, { size: 32 }),
  ]),
};

/** The Pot storage slots the bodies write. */
const SLOT = keccak256(toHex("zk.results"));
const CAUGHT = keccak256(toHex("zk.caught"));

const CALLBACK_SELECTOR = toFunctionSelector(
  "axiomV2Callback(uint64,address,bytes32,uint256,bytes32[],bytes)",
);

const potAbi = parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]);
const kitchenAbi = parseAbi(["function setExecutionFee(uint256 fee)"]);
const initializeAbi = parseAbi([
  "struct AxiomV2QueryInit { address axiomHeaderVerifierAddress; address verifierAddress; address[] proverAddresses; bytes32[] aggregateVkeyHashes; uint32 queryDeadlineInterval; uint32 proofVerificationGas; uint256 axiomQueryFee; uint64 minMaxFeePerGas; uint32 maxQueryDeadlineInterval; address timelock; address guardian; address unfreeze; }",
  "function initialize(AxiomV2QueryInit init)",
]);
const adminAbi = parseAbi(["function updateQueryDeadlineInterval(uint32 interval)"]);
const fulfillAbi = parseAbi([
  "struct MmrWitness { uint32 snapshotPmmrSize; bytes32[] proofMmrPeaks; bytes32[] mmrComplementOrPeaks; }",
  "struct AxiomV2Callback { address target; bytes extraData; }",
  "struct AxiomV2QueryWitness { address caller; bytes32 userSalt; bytes32 queryHash; bytes32 callbackHash; address refundee; }",
  "function fulfillQuery(MmrWitness mmrWitness, bytes32[] computeResults, bytes proof, AxiomV2Callback callback, AxiomV2QueryWitness queryWitness)",
  "error CannotFulfillIfNotActive()",
]);

/** Each chain AxiomV2Query is deployed on, with its live parameters (read 2026-10-08). */
const CHAINS = [
  {
    slug: "ethereum",
    chainId: 1,
    minMaxFeePerGas: 5_000_000_000n,
    queryDeadlineInterval: 7_200,
    maxQueryDeadlineInterval: 50_400,
  },
  {
    slug: "base",
    chainId: 8453,
    minMaxFeePerGas: 10_000_000n,
    queryDeadlineInterval: 43_200,
    maxQueryDeadlineInterval: 302_400,
  },
] as const;
const AXIOM_QUERY_FEE = 3_000_000_000_000_000n;
const PROOF_VERIFICATION_GAS = 420_000n;

const word = (value: bigint): Hex => toHex(value, { size: 32 });
/** A bytes32 as AxiomV2Query reads one from a proof: two field elements, high then low 128 bits. */
const hiLo = (value: Hex): Hex[] => [
  word(BigInt(value) >> 128n),
  word(BigInt(value) & ((1n << 128n) - 1n)),
];

/** AxiomV2Query's `queryHash` for a query with a compute circuit (`sendQuery`, k > 0). */
const queryHashOf = (sourceChainId: number): Hex =>
  keccak256(
    encodePacked(
      ["uint8", "uint64", "bytes32", "uint8", "uint16", "uint8", "bytes32[]", "uint32", "bytes"],
      [
        2,
        BigInt(sourceChainId),
        QUERY.dataQueryHash,
        Number(QUERY.k),
        Number(QUERY.resultLen),
        QUERY.vkey.length,
        QUERY.vkey,
        (QUERY.computeProof.length - 2) / 2,
        QUERY.computeProof,
      ],
    ),
  );
/** The circuit's identity, `keccak(k . resultLen . vkeyLen . vkey)`. */
const QUERY_SCHEMA = keccak256(
  encodePacked(
    ["uint8", "uint16", "uint8", "bytes32[]"],
    [Number(QUERY.k), Number(QUERY.resultLen), QUERY.vkey.length, QUERY.vkey],
  ),
);

/** The program that queries: `@sauce/zk` as a program uses it, and a body that writes what came
 *  back plus `bump`, a value it captured when the query was sent. */
const QUERY_PROGRAM = `import { Zk } from "@sauce/zk";

function main(dataQueryHash: Uint256, dataQuery: bytes, k: Uint256, resultLen: Uint256, vkey: Uint256[], computeProof: bytes, maxFeePerGas: Uint256, bump: Uint256): void {
  Zk.axiom({
    dataQueryHash,
    dataQuery,
    computeQuery: { k, resultLen, vkey, computeProof },
    maxFeePerGas,
  }).then((results) => {
    evm.sstore(${SLOT}, results[0] + results[1] + bump);
  });
}`;

/** The same query with a `.catch`, whose body refuses a non-zero first result. */
const CATCH_PROGRAM = `import { Zk } from "@sauce/zk";

function main(dataQueryHash: Uint256, dataQuery: bytes, k: Uint256, resultLen: Uint256, vkey: Uint256[], computeProof: bytes, maxFeePerGas: Uint256, bump: Uint256): void {
  Zk.axiom({
    dataQueryHash,
    dataQuery,
    computeQuery: { k, resultLen, vkey, computeProof },
    maxFeePerGas,
  })
    .then((results) => {
      require(results[0] == 0, "the first result is not zero");
      evm.sstore(${SLOT}, bump);
    })
    .catch((e) => {
      evm.sstore(${CAUGHT}, bump);
    });
}`;

/** The alternative the brief asked to measure: the body PARKED under the query id `sendQuery`
 *  returns, and taken by a handler that needs no second check (only this Pot parks). */
const PARKED_QUERY_PROGRAM = (query: Address): string => `import { Request } from "@sauce/async";

class Parked {
  axiom(dataQueryHash: Uint256, dataQuery: bytes, k: Uint256, resultLen: Uint256, vkey: Uint256[], computeProof: bytes, maxFeePerGas: Uint256) {
    return new Request({
      send: (continuation) => {
        const price = maxFeePerGas * (300000 + ${PROOF_VERIFICATION_GAS}) + ${AXIOM_QUERY_FEE};
        const [id] = abi.decode(
          evm.call(
            ${query},
            price,
            hex\`ed2d9ba0\`.concat(
              abi.encode(
                chainId,
                dataQueryHash,
                { k, resultLen, vkey, computeProof },
                { target: ctx.self(), extraData: hex\`\` },
                { maxFeePerGas, callbackGasLimit: 300000, overrideAxiomQueryFee: 0 },
                crypto.keccak256(abi.encode(ctx.blockNumber())),
                ctx.self(),
                dataQuery,
              ),
            ),
          ),
          ["Uint256"],
        );
        return id;
      },
      deliver: (input, body, fail) => {
        const [results] = abi.decode(input, ["Uint256[]"]);
        body(results);
      },
    });
  }
}
const Axiom = new Parked();

function main(dataQueryHash: Uint256, dataQuery: bytes, k: Uint256, resultLen: Uint256, vkey: Uint256[], computeProof: bytes, maxFeePerGas: Uint256, bump: Uint256): void {
  Axiom.axiom(dataQueryHash, dataQuery, k, resultLen, vkey, computeProof, maxFeePerGas).then((results) => {
    evm.sstore(${SLOT}, results[0] + results[1] + bump);
  });
}`;
const PARKED_HANDLER = `import { requireCaller, run, take } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): void {
  requireCaller(AxiomV2.Query, caller);
  const [sourceChainId, sender, querySchema, queryId, results, extraData] = abi.decode(
    data.slice(4, data.length),
    ["Uint256", "Address", "Uint256", "Uint256", "Uint256[]", "bytes"],
  );
  run(take(queryId), abi.encode(results));
}`;

/** The program the owner cooks to install a handler for the callback. */
const INSTALL = `import { install } from "@sauce/async";

function main(handler: bytes): void {
  install(${CALLBACK_SELECTOR}, handler, false);
}`;

/** The Pot takes back an unfulfilled query's escrow: AxiomV2Query by its registry name. */
const REFUND = `function main(userSalt: Uint256, queryHash: Uint256, callbackHash: Uint256): Uint256 {
  AxiomV2.Query.refundQuery({ caller: ctx.self(), userSalt, queryHash, callbackHash, refundee: ctx.self() });
  const amount = AxiomV2.Query.balances(ctx.self());
  AxiomV2.Query.withdraw(amount, ctx.self());
  return amount;
}`;

/** What a query's `QueryInitiatedOnchain` said. */
interface Sent {
  readonly queryId: bigint;
  readonly queryHash: Hex;
  readonly userSalt: Hex;
  readonly refundee: Address;
  readonly target: Address;
  readonly extraData: Hex;
  readonly caller: Address;
  readonly gasUsed: bigint;
}

describeZk.each(CHAINS)("@sauce/zk's Axiom V2 query on $slug", (chain) => {
  // 9500-9549, which no other suite takes: 25 ports a chain, one per worker.
  const PORT = 9500 + CHAINS.indexOf(chain) * 25 + (Number(process.env.JEST_WORKER_ID ?? "1") % 25);
  const RPC_URL = `http://127.0.0.1:${PORT}`;
  const query = AXIOM.chains[String(chain.chainId)]!.proxy.address;
  /** What `sendQuery` escrows at the minimum gas price and the default callback gas. */
  const price = chain.minMaxFeePerGas * (300_000n + PROOF_VERIFICATION_GAS) + AXIOM_QUERY_FEE;

  let anvil: ChildProcess;
  let publicClient: PublicClient;
  let testClient: TestClient;
  let stack: GatedEngine;
  const owner = createWalletClient({ account: OWNER, transport: http(RPC_URL) });
  const stranger = createWalletClient({ account: STRANGER, transport: http(RPC_URL) });
  const prover = createWalletClient({ account: PROVER, transport: http(RPC_URL) });

  async function send(
    from: typeof owner,
    to: Address | undefined,
    data: Hex,
    value = 0n,
  ): Promise<{
    ok: boolean;
    hash: Hex;
    logs: readonly { address: Address; topics: Hex[]; data: Hex }[];
    gasUsed: bigint;
    contractAddress?: Address | null;
  }> {
    const hash = await from.sendTransaction({
      account: from.account,
      chain: null,
      to,
      data,
      value,
      gas: 15_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      ok: receipt.status === "success",
      hash,
      logs: receipt.logs as never,
      gasUsed: receipt.gasUsed,
      contractAddress: receipt.contractAddress,
    };
  }

  const compiled = (source: string, args: readonly unknown[] = []): Hex => {
    const program = compileSauceProgram(chain.slug, source);

    return bytesToHex(concat([program.bytecode, encodeEntryArguments(program, args as never)]));
  };

  const cook = (program: Hex) =>
    send(
      owner,
      stack.pot,
      encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] }),
      FEE,
    );

  const install = async (handlerSource: string): Promise<void> => {
    const handler = compileSauceProgram(chain.slug, handlerSource).bytecode;
    expect((await cook(compiled(INSTALL, [bytesToHex(handler)]))).ok).toBe(true);
  };

  const queryArgs = (bump: bigint) => [
    BigInt(QUERY.dataQueryHash),
    QUERY.dataQuery,
    QUERY.k,
    QUERY.resultLen,
    QUERY.vkey.map((v) => BigInt(v)),
    QUERY.computeProof,
    chain.minMaxFeePerGas,
    bump,
  ];

  /** Each of AxiomV2Query's events a transaction logged, decoded with the registry's ABI. */
  const eventsOf = (result: Awaited<ReturnType<typeof send>>) =>
    result.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== query.toLowerCase()) return [];
      try {
        return [
          decodeEventLog({ abi: AxiomV2QueryABI, data: log.data, topics: log.topics as never }),
        ];
      } catch {
        return [];
      }
    });

  /** The query a transaction sent, from its `QueryInitiatedOnchain`. */
  const sentBy = (result: Awaited<ReturnType<typeof send>>): Sent => {
    const event = eventsOf(result).find((e) => e.eventName === "QueryInitiatedOnchain");
    if (event === undefined) throw new Error("the transaction sent no query");

    return { ...(event.args as unknown as Omit<Sent, "gasUsed">), gasUsed: result.gasUsed };
  };

  /** What `QueryFulfilled` said: whether the callback succeeded. */
  const fulfilled = (result: Awaited<ReturnType<typeof send>>): boolean => {
    const event = eventsOf(result).find((e) => e.eventName === "QueryFulfilled");
    if (event === undefined) throw new Error("the transaction fulfilled no query");

    return (event.args as { callbackSucceeded: boolean }).callbackSucceeded;
  };

  /** `fulfillQuery`, as Axiom's prover sends it, with a proof only the mocks accept. */
  const fulfillData = (sent: Sent, results: readonly bigint[]): Hex => {
    const computeResults = results.map(word);
    const proof = concat([
      toHex(0n, { size: 384 }),
      word(BigInt(chain.chainId)),
      ...hiLo(keccak256(encodePacked(["bytes32[]"], [computeResults]))),
      ...hiLo(sent.queryHash),
      ...hiLo(QUERY_SCHEMA),
      ...hiLo(keccak256(toHex("mmr"))),
      AGGREGATE_VKEY_HASH,
      word(BigInt(PROVER.address)),
    ]);

    return encodeFunctionData({
      abi: fulfillAbi,
      functionName: "fulfillQuery",
      args: [
        { snapshotPmmrSize: 0, proofMmrPeaks: [], mmrComplementOrPeaks: [] },
        computeResults,
        proof,
        { target: sent.target, extraData: sent.extraData },
        {
          caller: sent.caller,
          userSalt: sent.userSalt,
          queryHash: sent.queryHash,
          callbackHash: keccak256(concat([sent.target, sent.extraData])),
          refundee: sent.refundee,
        },
      ],
    });
  };

  /** The gas the callback into the Pot used, from the fulfilment's call trace. */
  const callbackGas = async (hash: Hex): Promise<bigint> => {
    interface Frame {
      to?: string;
      input?: string;
      gasUsed?: string;
      calls?: Frame[];
    }
    const trace = (await publicClient.request({
      method: "debug_traceTransaction" as never,
      params: [hash, { tracer: "callTracer" }] as never,
    })) as Frame;
    const find = (frame: Frame): Frame | undefined =>
      frame.to?.toLowerCase() === stack.pot.toLowerCase() &&
      frame.input?.startsWith(CALLBACK_SELECTOR)
        ? frame
        : (frame.calls ?? []).map(find).find((found) => found !== undefined);
    const frame = find(trace);
    if (frame?.gasUsed === undefined) throw new Error("no callback into the Pot");

    return BigInt(frame.gasUsed);
  };

  /** What a call reverts with, replayed as an `eth_call`, as text. */
  const revertOf = async (from: Address, to: Address, data: Hex): Promise<Hex> => {
    const response = (await (
      await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ from, to, data, gas: toHex(15_000_000n) }, "latest"],
        }),
      })
    ).json()) as { result?: Hex; error?: { data?: Hex } };
    if (response.error === undefined) throw new Error("the call did not revert");

    return response.error.data ?? "0x";
  };
  const text = (data: Hex): string => Buffer.from(data.slice(2), "hex").toString("utf8");

  const slot = async (at: Hex): Promise<bigint> =>
    BigInt((await publicClient.getStorageAt({ address: stack.pot, slot: at })) ?? "0x0");

  beforeAll(async () => {
    anvil = spawn(
      "anvil",
      ["--port", String(PORT), "--chain-id", String(chain.chainId), "--silent"],
      { stdio: "ignore" },
    );
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
    // The Pot pays each query's escrow and each callback's Kitchen fee from its balance.
    await testClient.setBalance({ address: stack.pot, value: parseEther("10") });
    await testClient.setBalance({ address: PROVER.address, value: parseEther("10") });

    // AxiomV2Query as deployed, at its addresses, initialized with the chain's parameters.
    const deployed = AXIOM.chains[String(chain.chainId)]!;
    await testClient.setCode({ address: deployed.proxy.address, bytecode: deployed.proxy.runtime });
    await testClient.setCode({
      address: deployed.implementation.address,
      bytecode: deployed.implementation.runtime,
    });
    await testClient.setStorageAt({
      address: deployed.proxy.address,
      index: ERC1967_IMPLEMENTATION,
      value: encodeAbiParameters([{ type: "address" }], [deployed.implementation.address]),
    });
    const headerVerifier = (
      await send(
        owner,
        undefined,
        concat([
          MOCKS.AxiomHeaderVerifierMock.creationCode,
          encodeAbiParameters([{ type: "uint64" }], [BigInt(chain.chainId)]),
        ]),
      )
    ).contractAddress!;
    const verifier = (await send(owner, undefined, MOCKS.AxiomVerifierMock.creationCode))
      .contractAddress!;
    const initialized = await send(
      owner,
      query,
      encodeFunctionData({
        abi: initializeAbi,
        functionName: "initialize",
        args: [
          {
            axiomHeaderVerifierAddress: headerVerifier,
            verifierAddress: verifier,
            proverAddresses: [PROVER.address],
            aggregateVkeyHashes: [AGGREGATE_VKEY_HASH],
            queryDeadlineInterval: chain.queryDeadlineInterval,
            proofVerificationGas: Number(PROOF_VERIFICATION_GAS),
            axiomQueryFee: AXIOM_QUERY_FEE,
            minMaxFeePerGas: chain.minMaxFeePerGas,
            maxQueryDeadlineInterval: chain.maxQueryDeadlineInterval,
            timelock: OWNER.address,
            guardian: OWNER.address,
            unfreeze: OWNER.address,
          },
        ],
      }),
    );
    expect(initialized.ok).toBe(true);

    await install(HANDLER);
  }, 120_000);

  afterAll(async () => {
    if (anvil !== undefined && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("sends the query with exactly its escrow, the body as the callback's extra data", async () => {
    const queryBefore = await publicClient.getBalance({ address: query });
    const result = await cook(compiled(QUERY_PROGRAM, queryArgs(1_000n)));
    expect(result.ok).toBe(true);
    const sent = sentBy(result);

    expect(sent.caller).toBe(stack.pot);
    expect(sent.target).toBe(stack.pot);
    expect(sent.refundee).toBe(stack.pot);
    // AxiomV2Query hashed the compute query the program encoded as Axiom's tooling's would be.
    expect(sent.queryHash).toBe(queryHashOf(chain.chainId));
    expect((await publicClient.getBalance({ address: query })) - queryBefore).toBe(price);
    const [state, , callbackGasLimit, , payment] = (await publicClient.readContract({
      address: query,
      abi: AxiomV2QueryABI,
      functionName: "queries",
      args: [sent.queryId],
    })) as readonly [number, number, number, Address, bigint];
    expect([state, callbackGasLimit, payment]).toEqual([1, 300_000, price]);
    // Paid exactly, so nothing was credited to the Pot's balance at AxiomV2Query.
    expect(
      await publicClient.readContract({
        address: query,
        abi: AxiomV2QueryABI,
        functionName: "balances",
        args: [stack.pot],
      }),
    ).toBe(0n);
  });

  it("runs the body with the proven results when the query is fulfilled, for one fee", async () => {
    const sent = sentBy(await cook(compiled(QUERY_PROGRAM, queryArgs(1_000n))));

    const kitchen = gateAnchors().kitchen;
    const kitchenBefore = await publicClient.getBalance({ address: kitchen });
    const potBefore = await publicClient.getBalance({ address: stack.pot });
    const fulfilment = await send(prover, query, fulfillData(sent, [41n, 1n]));
    expect(fulfilment.ok).toBe(true);
    expect(fulfilled(fulfilment)).toBe(true);

    expect(await slot(SLOT)).toBe(1_042n);
    expect((await publicClient.getBalance({ address: kitchen })) - kitchenBefore).toBe(FEE);
    expect(potBefore - (await publicClient.getBalance({ address: stack.pot }))).toBe(FEE);
    expect(await callbackGas(fulfilment.hash)).toBeLessThan(300_000n);
  });

  it("refuses a second fulfilment: AxiomV2Query calls back once", async () => {
    const sent = sentBy(await cook(compiled(QUERY_PROGRAM, queryArgs(0n))));
    const data = fulfillData(sent, [7n, 0n]);
    expect((await send(prover, query, data)).ok).toBe(true);
    expect(await slot(SLOT)).toBe(7n);

    expect(await revertOf(PROVER.address, query, data)).toBe(
      toFunctionSelector("CannotFulfillIfNotActive()"),
    );
    expect((await send(prover, query, fulfillData(sent, [8n, 0n]))).ok).toBe(false);
    expect(await slot(SLOT)).toBe(7n);
  });

  it("refuses a callback from anyone but AxiomV2Query", async () => {
    const sent = sentBy(await cook(compiled(QUERY_PROGRAM, queryArgs(0n))));
    // The callback AxiomV2Query would make, with results of the caller's choosing.
    const forged = concat([
      CALLBACK_SELECTOR,
      encodeAbiParameters(
        [
          { type: "uint64" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "bytes32[]" },
          { type: "bytes" },
        ],
        [
          BigInt(chain.chainId),
          stack.pot,
          QUERY_SCHEMA,
          sent.queryId,
          [word(666n), word(0n)],
          sent.extraData,
        ],
      ),
    ]);
    expect(text(await revertOf(STRANGER.address, stack.pot, forged))).toBe(
      "async: the call is not from the protocol",
    );
    expect((await send(stranger, stack.pot, forged)).ok).toBe(false);
    expect(await slot(SLOT)).not.toBe(666n);
  });

  it("refuses a callback for a query another address sent naming the Pot", async () => {
    // A stranger's query whose callback names the Pot, with a program of the stranger's own as its
    // extra data: AxiomV2Query fulfils it and calls the Pot, from itself, as it would for the Pot's.
    const own = await cook(compiled(QUERY_PROGRAM, queryArgs(0n)));
    const program = compiled(`function main(): void {
  evm.sstore(${SLOT}, 666);
}`);
    const strangers = await send(
      stranger,
      query,
      encodeFunctionData({
        abi: AxiomV2QueryABI,
        functionName: "sendQuery",
        args: [
          BigInt(chain.chainId),
          QUERY.dataQueryHash,
          {
            k: Number(QUERY.k),
            resultLen: Number(QUERY.resultLen),
            vkey: QUERY.vkey,
            computeProof: QUERY.computeProof,
          },
          { target: stack.pot, extraData: program },
          {
            maxFeePerGas: chain.minMaxFeePerGas,
            callbackGasLimit: 300_000,
            overrideAxiomQueryFee: 0n,
          },
          keccak256(toHex("a stranger's salt")),
          STRANGER.address,
          QUERY.dataQuery,
        ],
      }),
      price,
    );
    expect(strangers.ok).toBe(true);
    const sent = sentBy(strangers);
    expect(sent.caller).toBe(STRANGER.address);
    expect(sentBy(own).queryId).not.toBe(sent.queryId);
    const before = await slot(SLOT);

    const fulfilment = await send(prover, query, fulfillData(sent, [1n, 2n]));
    expect(fulfilment.ok).toBe(true);
    // AxiomV2Query swallows a failed callback, and says so.
    expect(fulfilled(fulfilment)).toBe(false);
    expect(await slot(SLOT)).toBe(before);
    // Why it failed, from AxiomV2Query's own address.
    const callback = concat([
      CALLBACK_SELECTOR,
      encodeAbiParameters(
        [
          { type: "uint64" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "bytes32[]" },
          { type: "bytes" },
        ],
        [
          BigInt(chain.chainId),
          STRANGER.address,
          QUERY_SCHEMA,
          sent.queryId,
          [word(1n), word(2n)],
          program,
        ],
      ),
    ]);
    expect(text(await revertOf(query, stack.pot, callback))).toBe(
      "async: the message is not from this Pot",
    );
  });

  it("runs `.catch` in the body's place when the body reverts", async () => {
    const sent = sentBy(await cook(compiled(CATCH_PROGRAM, queryArgs(77n))));
    const fulfilment = await send(prover, query, fulfillData(sent, [5n, 0n]));
    expect(fulfilled(fulfilment)).toBe(true);
    expect(await slot(CAUGHT)).toBe(77n);
  });

  it("gives an unfulfilled query's escrow back to the Pot after its deadline", async () => {
    // A deadline 10 blocks out, set as Axiom's timelock sets it, rather than mining the chain's.
    const interval = (blocks: number) =>
      send(
        owner,
        query,
        encodeFunctionData({
          abi: adminAbi,
          functionName: "updateQueryDeadlineInterval",
          args: [blocks],
        }),
      );
    expect((await interval(10)).ok).toBe(true);
    const sent = sentBy(await cook(compiled(QUERY_PROGRAM, queryArgs(0n))));
    expect((await interval(chain.queryDeadlineInterval)).ok).toBe(true);
    const callbackHash = keccak256(concat([sent.target, sent.extraData]));
    const refund = compiled(REFUND, [
      BigInt(sent.userSalt),
      BigInt(sent.queryHash),
      BigInt(callbackHash),
    ]);
    // Before the deadline AxiomV2Query refuses.
    expect((await cook(refund)).ok).toBe(false);

    await testClient.mine({ blocks: 11 });
    const potBefore = await publicClient.getBalance({ address: stack.pot });
    expect((await cook(refund)).ok).toBe(true);
    expect((await publicClient.getBalance({ address: stack.pot })) - potBefore).toBe(price);
    const [state] = await publicClient.readContract({
      address: query,
      abi: AxiomV2QueryABI,
      functionName: "queries",
      args: [sent.queryId],
    });
    expect(state).toBe(0);
  });

  it("costs less carrying the body in the extra data than parking it", async () => {
    const carried = await cook(compiled(QUERY_PROGRAM, queryArgs(0n)));
    const carriedFulfilment = await send(prover, query, fulfillData(sentBy(carried), [3n, 0n]));
    expect(fulfilled(carriedFulfilment)).toBe(true);
    const carriedCallback = await callbackGas(carriedFulfilment.hash);

    await install(PARKED_HANDLER);
    try {
      const parked = await cook(compiled(PARKED_QUERY_PROGRAM(query), queryArgs(0n)));
      expect(parked.ok).toBe(true);
      const parkedFulfilment = await send(prover, query, fulfillData(sentBy(parked), [4n, 0n]));
      expect(fulfilled(parkedFulfilment)).toBe(true);
      expect(await slot(SLOT)).toBe(4n);
      const parkedCallback = await callbackGas(parkedFulfilment.hash);

      console.log(
        `${chain.slug}: query cook ${carried.gasUsed} carried / ${parked.gasUsed} parked; ` +
          `callback ${carriedCallback} carried / ${parkedCallback} parked`,
      );
      expect(carried.gasUsed).toBeLessThan(parked.gasUsed);
      expect(carriedCallback).toBeLessThan(parkedCallback);
    } finally {
      await install(HANDLER);
    }
  }, 120_000);
});

/**
 * `@sauce/zk`'s Boundless request EXECUTED: a program asks Boundless's market for a proof that a
 * RISC Zero guest ran on an input, a prover locks it — asking the Pot, as the request's client,
 * whether it signed it — and fulfils it, the market calls the Pot back with the guest's journal, and
 * the `.then` body runs on the same Private Pot. On an anvil at Base's chain id running the gated
 * engine and Kitchen with v12 #571's Router.
 *
 * The market is Boundless's own, as deployed on Base (`fixtures/Boundless.json`): the proxy at the
 * registry's address, the implementation its slot names, the legacy implementation its fallback
 * reaches and ZKC, the collateral token, each its chain runtime at its address, the market
 * initialized as a fresh deployment is. Only the proof is not real: the market's router, which checks
 * a batch's seals and the assessor's proof that the fills meet their predicates, is a mock that
 * passes every batch (`fixtures/BoundlessRouterMock.sol`). Everything else is the market's own code:
 * the request's hash under its domain, the ERC-1271 check of the Pot at lock time with 100,000 gas,
 * the lock, binding the fill to the locked request, paying the prover, the callback and its gas,
 * slashing.
 *
 *   1. the owner cooks the program the SDK writes to install `@sauce/zk`'s handlers: Space and
 *      Time's callback, Boundless's `handleProof`, the read-only `isValidSignature`, and
 *      `@sauce/async`'s `expire(bytes32)`;
 *   2. the owner cooks a program that requests, `Zk.risc0({ … }).then((journal) => { … })`: the Pot
 *      deposits the price, submits the request and approves its hash;
 *   3. a prover locks it, the market asking the Pot `isValidSignature`, and fulfils it: the market
 *      calls the Pot, whose handler fulfils the promise the image and the journal's digest name.
 *
 * And what is refused: a lock of a request the Pot did not make, a callback from anyone but the
 * market, a stranger's proof of the same guest over another input. A request past its deadline is
 * expired by anyone, and `Zk.reclaim(e)` slashes its prover and withdraws its price.
 */
import {
  concat,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseAbi,
  sha256,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BoundlessMarketABI } from "../../../src/protocols/boundless/abis.js";
import { gateAnchors } from "../../evm/gated-engine.js";
import {
  describeOnRouter,
  FEE,
  OWNER,
  STRANGER,
  startZkChain,
  text,
  type Sent,
  type ZkChain,
} from "./harness.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
interface Code {
  readonly address: Address;
  readonly codeHash: Hex;
  readonly runtime: Hex;
}
const BOUNDLESS = JSON.parse(readFileSync(join(FIXTURES, "Boundless.json"), "utf8")) as {
  proxy: Code;
  implementation: Code;
  legacy: Code;
  collateral: Code;
  router: Address;
  domainSeparator: Hex;
};
const ROUTER_MOCK = JSON.parse(
  readFileSync(join(FIXTURES, "BoundlessRouterMock.json"), "utf8"),
) as { runtime: Hex };

const MARKET = BOUNDLESS.proxy.address;
const ZKC = BOUNDLESS.collateral.address;
/** A prover, a key of the suite's own. */
const PROVER = privateKeyToAccount(keccak256(toHex("sauce.zk.test.boundless.prover")));

const IMAGE_ID = keccak256(toHex("sauce.zk.test.guest"));
const IMAGE_URL = toHex("ipfs://sauce-zk-test-guest");
const INPUT = toHex("what the guest reads after its request's id");
/** The offer: 0.001 ETH at most, locked within ten minutes, fulfilled within twenty, 15 ZKC. */
const MAX_PRICE = 1_000_000_000_000_000n;
const COLLATERAL = 15n * 10n ** 18n;

const CALLBACK = toFunctionSelector("handleProof(bytes32,bytes,bytes)");
const SIGNATURE = toFunctionSelector("isValidSignature(bytes32,bytes)");
const QUERY_CALLBACK = toFunctionSelector("queryCallback(bytes32,bytes,bytes)");
const EXPIRE = toFunctionSelector("expire(bytes32)");
const RISC0_TAG = keccak256(toHex("sauce.zk.risc0"));
const PROMISE_IGNORED = keccak256(toHex("PromiseIgnored(bytes32,uint256)"));
const INPUT_TYPEHASH = keccak256(toHex("Input(uint8 inputType,bytes data)"));
const OFFER_TYPEHASH = keccak256(
  toHex(
    "Offer(uint256 minPrice,uint256 maxPrice,uint64 rampUpStart,uint32 rampUpPeriod,uint32 lockTimeout,uint32 timeout,uint256 lockCollateral)",
  ),
);

/** The Pot storage slots the bodies write. */
const SLOT = keccak256(toHex("zk.risc0.value"));
const CAUGHT = keccak256(toHex("zk.risc0.caught"));

const adminAbi = parseAbi(["function initialize(address initialOwner)"]);
const erc20Abi = parseAbi(["function approve(address, uint256) returns (bool)"]);
const collateralAbi = parseAbi(["function depositCollateral(uint256 value)"]);
const signatureAbi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);

/** The program that requests, and a body that writes the journal's first word after the digest plus
 *  `bump`, a value it captured when the request was made. */
const REQUEST = `import { Zk } from "@sauce/zk";

function main(imageId: Uint256, imageUrl: bytes, input: bytes, maxPrice: Uint256, lockTimeout: Uint256, timeout: Uint256, collateral: Uint256, bump: Uint256): void {
  Zk.risc0({
    imageId,
    imageUrl,
    input,
    offer: { maxPrice, rampUpPeriod: 10, lockTimeout, timeout, lockCollateral: collateral },
  })
    .then((journal) => {
      evm.sstore(${SLOT}, journal.slice(0, 32).toBe() + bump);
    })
    .catch((e) => {
      evm.sstore(${CAUGHT}, Zk.reclaim(e) ? 2 : 1);
    });
}`;

/** The skill's example: a payment made once the guest's proven output reaches a minimum. */
const PROVEN_GUEST = readFileSync(
  join(FIXTURES, "../../../../../skills/sauce-zk/examples/proven-guest.sauce.ts"),
  "utf8",
);

const word = (value: bigint): Hex => toHex(value, { size: 32 });

/** A request as EIP-712 typed data under the market's domain, as viem hashes and signs it. */
const typedRequest = (request: Request) =>
  ({
    domain: { name: "IBoundlessMarket", version: "1", chainId: 8453, verifyingContract: MARKET },
    primaryType: "ProofRequest",
    types: {
      ProofRequest: [
        { name: "id", type: "uint256" },
        { name: "requirements", type: "Requirements" },
        { name: "imageUrl", type: "string" },
        { name: "input", type: "Input" },
        { name: "offer", type: "Offer" },
      ],
      Requirements: [
        { name: "callback", type: "Callback" },
        { name: "predicate", type: "Predicate" },
        { name: "selector", type: "bytes4" },
      ],
      Callback: [
        { name: "addr", type: "address" },
        { name: "gasLimit", type: "uint96" },
      ],
      Predicate: [
        { name: "predicateType", type: "uint8" },
        { name: "data", type: "bytes" },
      ],
      Input: [
        { name: "inputType", type: "uint8" },
        { name: "data", type: "bytes" },
      ],
      Offer: [
        { name: "minPrice", type: "uint256" },
        { name: "maxPrice", type: "uint256" },
        { name: "rampUpStart", type: "uint64" },
        { name: "rampUpPeriod", type: "uint32" },
        { name: "lockTimeout", type: "uint32" },
        { name: "timeout", type: "uint32" },
        { name: "lockCollateral", type: "uint256" },
      ],
    },
    message: request,
  }) as const;

type Request = {
  id: bigint;
  requirements: {
    callback: { addr: Address; gasLimit: bigint };
    predicate: { predicateType: number; data: Hex };
    selector: Hex;
  };
  imageUrl: string;
  input: { inputType: number; data: Hex };
  offer: {
    minPrice: bigint;
    maxPrice: bigint;
    rampUpStart: bigint;
    rampUpPeriod: number;
    lockTimeout: number;
    timeout: number;
    lockCollateral: bigint;
  };
};

describeOnRouter("@sauce/zk's Boundless request on base", () => {
  let chain: ZkChain;
  let prover: WalletClient;

  const eventsOf = (sent: Sent) =>
    sent.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== MARKET.toLowerCase()) return [];
      try {
        return [decodeEventLog({ abi: BoundlessMarketABI, data: log.data, topics: log.topics })];
      } catch {
        return [];
      }
    });

  /** The request a transaction submitted, from its `RequestSubmitted`. */
  const submitted = (sent: Sent): Request => {
    const event = eventsOf(sent).find((e) => e.eventName === "RequestSubmitted");
    if (event === undefined) throw new Error("the transaction submitted no request");

    return (event.args as unknown as { request: Request }).request;
  };

  const ask = async (
    bump: bigint,
    lockTimeout = 600n,
    timeout = 1_200n,
    input: Hex = INPUT,
  ): Promise<Request> => {
    const sent = await chain.cook(
      chain.compiled(REQUEST, [
        BigInt(IMAGE_ID),
        IMAGE_URL,
        input,
        MAX_PRICE,
        lockTimeout,
        timeout,
        COLLATERAL,
        bump,
      ]),
    );
    expect(sent.ok).toBe(true);

    return submitted(sent);
  };

  /** The guest's stdin, after the input's version byte, and what its journal begins with. */
  const stdinOf = (request: Request): Hex => `0x${request.input.data.slice(4)}`;
  const promiseKeyOf = (request: Request): Hex =>
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [
          RISC0_TAG,
          keccak256(
            encodeAbiParameters(
              [{ type: "bytes32" }, { type: "bytes32" }],
              [IMAGE_ID, sha256(stdinOf(request))],
            ),
          ),
        ],
      ),
    );

  const lock = (request: Request, from: WalletClient = prover) =>
    chain.send(
      from,
      MARKET,
      encodeFunctionData({
        abi: BoundlessMarketABI,
        functionName: "lockRequest",
        args: [request, "0x"],
      }),
    );

  /** `fulfill` as the prover sends it: the request in its slim form, and the journal. */
  const fulfil = (request: Request, journal: Hex) =>
    chain.send(
      prover,
      MARKET,
      encodeFunctionData({
        abi: BoundlessMarketABI,
        functionName: "fulfill",
        args: [
          [
            {
              requests: [
                {
                  id: request.id,
                  predicate: request.requirements.predicate,
                  callback: request.requirements.callback,
                  selector: request.requirements.selector,
                  imageUrlHash: keccak256(toHex(request.imageUrl)),
                  inputDigest: keccak256(
                    encodeAbiParameters(
                      [{ type: "bytes32" }, { type: "uint8" }, { type: "bytes32" }],
                      [INPUT_TYPEHASH, request.input.inputType, keccak256(request.input.data)],
                    ),
                  ),
                  offerDigest: keccak256(
                    encodeAbiParameters(
                      [
                        { type: "bytes32" },
                        { type: "uint256" },
                        { type: "uint256" },
                        { type: "uint64" },
                        { type: "uint32" },
                        { type: "uint32" },
                        { type: "uint32" },
                        { type: "uint256" },
                      ],
                      [
                        OFFER_TYPEHASH,
                        request.offer.minPrice,
                        request.offer.maxPrice,
                        request.offer.rampUpStart,
                        request.offer.rampUpPeriod,
                        request.offer.lockTimeout,
                        request.offer.timeout,
                        request.offer.lockCollateral,
                      ],
                    ),
                  ),
                },
              ],
              fills: [
                {
                  claimDigest: word(0n),
                  fulfillmentDataType: 1,
                  fulfillmentData: encodeAbiParameters(
                    [
                      {
                        type: "tuple",
                        components: [{ type: "bytes32" }, { type: "bytes" }],
                      },
                    ],
                    [[IMAGE_ID, journal]],
                  ),
                  seal: "0x",
                },
              ],
              assessorSeal: "0x",
              prover: PROVER.address,
            },
          ],
        ],
      }),
    );

  /** What the guest commits: the sha256 of its stdin, then its output. */
  const journalOf = (request: Request, output: bigint): Hex =>
    concat([sha256(stdinOf(request)), word(output)]);

  const marketBalance = (holder: Address) =>
    chain.publicClient.readContract({
      address: MARKET,
      abi: BoundlessMarketABI,
      functionName: "balanceOf",
      args: [holder],
    });

  beforeAll(async () => {
    // 9575-9599, which no other suite takes, one per worker.
    chain = await startZkChain(
      "base",
      8453,
      9575 + (Number(process.env.JEST_WORKER_ID ?? "1") % 25),
    );
    const { testClient, publicClient } = chain;
    for (const contract of [
      BOUNDLESS.proxy,
      BOUNDLESS.implementation,
      BOUNDLESS.legacy,
      BOUNDLESS.collateral,
    ]) {
      await testClient.setCode({ address: contract.address, bytecode: contract.runtime });
      expect(keccak256((await publicClient.getCode({ address: contract.address }))!)).toBe(
        contract.codeHash,
      );
    }
    await testClient.setCode({ address: BOUNDLESS.router, bytecode: ROUTER_MOCK.runtime });
    await testClient.setStorageAt({
      address: MARKET,
      index: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      value: encodeAbiParameters([{ type: "address" }], [BOUNDLESS.implementation.address]),
    });
    expect(
      (
        await chain.send(
          chain.owner,
          MARKET,
          encodeFunctionData({ abi: adminAbi, functionName: "initialize", args: [OWNER.address] }),
        )
      ).ok,
    ).toBe(true);
    // At Base's chain id and the market's address, its domain is the deployed market's.
    expect(
      await publicClient.readContract({
        address: MARKET,
        abi: BoundlessMarketABI,
        functionName: "eip712DomainSeparator",
      }),
    ).toBe(BOUNDLESS.domainSeparator);
    // The prover's ZKC, deposited as collateral.
    prover = await chain.wallet(PROVER);
    await testClient.setStorageAt({
      address: ZKC,
      index: keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [PROVER.address, 0n]),
      ),
      value: word(100n * COLLATERAL),
    });
    for (const data of [
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [MARKET, 100n * COLLATERAL],
      }),
      encodeFunctionData({
        abi: collateralAbi,
        functionName: "depositCollateral",
        args: [100n * COLLATERAL],
      }),
    ]) {
      expect(
        (await chain.send(prover, data.startsWith("0x095ea7b3") ? ZKC : MARKET, data)).ok,
      ).toBe(true);
    }

    expect(await chain.installPackage("@sauce/zk")).toEqual([
      QUERY_CALLBACK,
      CALLBACK,
      SIGNATURE,
      EXPIRE,
    ]);
  }, 180_000);

  afterAll(async () => {
    await chain?.stop();
  });

  it("submits the market's own request, the Pot its client and its callback, its price deposited", async () => {
    const before = await marketBalance(chain.stack.pot);
    const request = await ask(0n);
    const index = request.id & 0xffff_ffffn;

    expect(request.id).toBe((1n << 192n) | (BigInt(chain.stack.pot) << 32n) | index);
    expect(request.requirements).toEqual({
      callback: { addr: chain.stack.pot, gasLimit: 1_000_000n },
      predicate: { predicateType: 1, data: concat([IMAGE_ID, sha256(stdinOf(request))]) },
      selector: "0x00000000",
    });
    expect(stdinOf(request)).toBe(concat([word(request.id), INPUT]));
    expect(request.input).toEqual({ inputType: 0, data: concat(["0x00", stdinOf(request)]) });
    expect(request.offer).toMatchObject({
      minPrice: 0n,
      maxPrice: MAX_PRICE,
      rampUpPeriod: 10,
      lockTimeout: 600,
      timeout: 1_200,
      lockCollateral: COLLATERAL,
    });
    expect((await marketBalance(chain.stack.pot)) - before).toBe(MAX_PRICE);
  });

  it("is locked by a prover the market lets through the Pot's ERC-1271 check, and nothing else", async () => {
    const request = await ask(0n);
    const locked = await lock(request);
    expect(locked.ok).toBe(true);
    expect(eventsOf(locked).some((e) => e.eventName === "RequestLocked")).toBe(true);
    // The check, as the market makes it, within its 100,000 gas.
    const gas = await chain.callGas(locked.hash, chain.stack.pot, SIGNATURE);
    console.log(`base: the Pot answered isValidSignature with ${gas} gas`);
    expect(gas).toBeLessThan(100_000n);
    // A hash the Pot did not approve.
    expect(
      await chain.publicClient.readContract({
        address: chain.stack.pot,
        abi: signatureAbi,
        functionName: "isValidSignature",
        args: [keccak256(toHex("not a request of the Pot's")), "0x"],
      }),
    ).toBe("0xffffffff");
  });

  it("refuses a lock of a request the Pot did not make, which would spend its balance", async () => {
    // A stranger submits a request naming the Pot as its client: the market checks no signature at
    // submission, but the lock asks the Pot, which never approved it.
    const request = await ask(0n);
    const forged: Request = { ...request, id: request.id + 1_000n };
    expect(
      (
        await chain.send(
          chain.stranger,
          MARKET,
          encodeFunctionData({
            abi: BoundlessMarketABI,
            functionName: "submitRequest",
            args: [forged, "0x"],
          }),
        )
      ).ok,
    ).toBe(true);
    const before = await marketBalance(chain.stack.pot);
    expect((await lock(forged)).ok).toBe(false);
    expect(await marketBalance(chain.stack.pot)).toBe(before);
  });

  it("runs the body with the guest's journal when the market calls back, for one fee", async () => {
    const request = await ask(5n);
    // Past the ramp-up, the price is the offer's most.
    await chain.testClient.increaseTime({ seconds: 11 });
    await chain.testClient.mine({ blocks: 1 });
    const potBefore = await marketBalance(chain.stack.pot);
    expect((await lock(request)).ok).toBe(true);
    expect(potBefore - (await marketBalance(chain.stack.pot))).toBe(MAX_PRICE);
    const kitchen = gateAnchors().kitchen;
    const kitchenBefore = await chain.publicClient.getBalance({ address: kitchen });
    const proverBefore = await marketBalance(PROVER.address);

    const fulfilment = await fulfil(request, journalOf(request, 37n));
    expect(fulfilment.ok).toBe(true);
    expect(eventsOf(fulfilment).some((e) => e.eventName === "CallbackFailed")).toBe(false);
    expect(await chain.slot(SLOT)).toBe(42n);
    expect((await chain.publicClient.getBalance({ address: kitchen })) - kitchenBefore).toBe(FEE);
    expect((await marketBalance(PROVER.address)) - proverBefore).toBe(MAX_PRICE);
    const gas = await chain.callGas(fulfilment.hash, chain.stack.pot, CALLBACK);
    console.log(`base: the callback used ${gas} gas`);
    expect(gas).toBeLessThan(1_000_000n);
  });

  it("refuses a callback from anyone but the market", async () => {
    const request = await ask(0n);
    const forged = concat([
      CALLBACK,
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes" }, { type: "bytes" }],
        [IMAGE_ID, journalOf(request, 666n), "0x"],
      ),
    ]);
    expect(text(await chain.revertOf(STRANGER.address, chain.stack.pot, forged))).toBe(
      "async: the call is not from the protocol",
    );
  });

  it("settles nothing for a stranger's proof of the same guest over another input", async () => {
    // The Pot's request waits. A stranger, a client of its own signing as one, asks a proof of the
    // same guest whose stdin differs, with the Pot as its callback, and it is fulfilled.
    const waiting = await ask(0n);
    const id = (BigInt(STRANGER.address) << 32n) | 1n;
    const stdin = concat([word(id), toHex("another input")]);
    const theirs: Request = {
      ...waiting,
      id,
      requirements: {
        ...waiting.requirements,
        predicate: { predicateType: 1, data: concat([IMAGE_ID, sha256(stdin)]) },
      },
      input: { inputType: 0, data: concat(["0x00", stdin]) },
    };
    expect(
      (
        await chain.send(
          chain.stranger,
          MARKET,
          encodeFunctionData({
            abi: BoundlessMarketABI,
            functionName: "submitRequest",
            args: [theirs, "0x"],
          }),
          MAX_PRICE,
        )
      ).ok,
    ).toBe(true);
    const signature = await STRANGER.signTypedData(typedRequest(theirs));
    expect(
      (
        await chain.send(
          prover,
          MARKET,
          encodeFunctionData({
            abi: BoundlessMarketABI,
            functionName: "lockRequest",
            args: [theirs, signature],
          }),
        )
      ).ok,
    ).toBe(true);
    const before = await chain.slot(SLOT);
    const fulfilment = await fulfil(theirs, concat([sha256(stdin), word(999n)]));
    expect(fulfilment.ok).toBe(true);
    // The Pot was called, found no promise under that guest's digest, and returned.
    expect(eventsOf(fulfilment).some((e) => e.eventName === "CallbackFailed")).toBe(false);
    const ignored = fulfilment.logs.some(
      (log) =>
        log.address.toLowerCase() === chain.stack.pot.toLowerCase() &&
        log.topics[0] === PROMISE_IGNORED,
    );
    expect(ignored).toBe(true);
    expect(await chain.slot(SLOT)).toBe(before);
    // Ours still waits, and its own fulfilment runs it.
    expect((await lock(waiting)).ok).toBe(true);
    expect((await fulfil(waiting, journalOf(waiting, 3n))).ok).toBe(true);
    expect(await chain.slot(SLOT)).toBe(3n);
  });

  it("hashes its request as the market's EIP-712 does: the Pot approves exactly that hash", async () => {
    const request = await ask(0n);
    expect(
      await chain.publicClient.readContract({
        address: chain.stack.pot,
        abi: signatureAbi,
        functionName: "isValidSignature",
        args: [hashTypedData(typedRequest(request)), "0x"],
      }),
    ).toBe("0x1626ba7e");
  });

  it.each([
    [100n, 1_000n],
    [99n, 0n],
  ])(
    "the skill's sauce-zk/examples/proven-guest, the guest's output %s, pays %s",
    async (output, paid) => {
      const recipient = privateKeyToAccount(
        keccak256(toHex(`sauce.zk.test.guest.payee.${output}`)),
      ).address;
      const sent = await chain.cook(
        chain.compiled(PROVEN_GUEST, [
          BigInt(IMAGE_ID),
          IMAGE_URL,
          INPUT,
          MAX_PRICE,
          100n,
          recipient,
          1_000n,
        ]),
      );
      expect(sent.ok).toBe(true);
      const request = submitted(sent);
      expect(request.offer.lockCollateral).toBe(COLLATERAL);
      expect((await lock(request)).ok).toBe(true);
      expect((await fulfil(request, journalOf(request, output))).ok).toBe(true);
      expect(await chain.publicClient.getBalance({ address: recipient })).toBe(paid);
    },
  );

  it("expires a locked request past its deadline: Zk.reclaim slashes it and withdraws its price", async () => {
    const request = await ask(0n, 30n, 60n);
    expect((await lock(request)).ok).toBe(true);
    const key = promiseKeyOf(request);
    await chain.testClient.increaseTime({ seconds: 61 });
    await chain.testClient.mine({ blocks: 1 });
    const potBefore = await chain.publicClient.getBalance({ address: chain.stack.pot });
    const expired = await chain.send(chain.stranger, chain.stack.pot, concat([EXPIRE, key]), FEE);
    expect(expired.ok).toBe(true);
    expect(await chain.slot(CAUGHT)).toBe(2n);
    expect(
      await chain.publicClient.readContract({
        address: MARKET,
        abi: BoundlessMarketABI,
        functionName: "requestIsLocked",
        args: [request.id],
      }),
    ).toBe(true);
    // The price came back to the Pot, past its balance at the market.
    expect((await chain.publicClient.getBalance({ address: chain.stack.pot })) - potBefore).toBe(
      MAX_PRICE,
    );
  });

  it("expires a request nobody locked: Zk.reclaim withdraws its price", async () => {
    const request = await ask(0n, 30n, 60n);
    await chain.testClient.increaseTime({ seconds: 61 });
    await chain.testClient.mine({ blocks: 1 });
    const potBefore = await chain.publicClient.getBalance({ address: chain.stack.pot });
    const expired = await chain.send(
      chain.stranger,
      chain.stack.pot,
      concat([EXPIRE, promiseKeyOf(request)]),
      FEE,
    );
    expect(expired.ok).toBe(true);
    expect(await chain.slot(CAUGHT)).toBe(2n);
    expect((await chain.publicClient.getBalance({ address: chain.stack.pot })) - potBefore).toBe(
      MAX_PRICE,
    );
  });
});

// @sauce/zk — EVM arm.
//
// A proven answer, delivered to a `.then`. A program asks a ZK coprocessor a question now — a SQL
// query over indexed chain data, proven with Proof of SQL, or a RISC Zero guest program, proven run
// on an input — and the body runs on the same Private Pot when the coprocessor calls back with the
// result, as a promise of `@sauce/async`'s:
//
//   import { Zk } from "@sauce/zk";
//
//   function main(plan: bytes, payment: Uint256, minimum: Uint256, recipient: Address, amount: Uint256): void {
//     Zk.sql({ query: plan, payment })
//       .then((result) => {
//         require(Zk.cell(result, 0, 0) >= minimum, "below the minimum");
//         USDC.transfer(recipient, amount);
//       })
//       .catch((e) => {
//         Zk.cancel(e);
//       });
//   }
//
// SPACE AND TIME (`Zk.sql`, Ethereum and Base).
//
// THE QUERY. Space and Time's: the SQL is turned into a proof plan off chain (Space and Time's RPC
// answers `commitments_v1_evmProofPlan` with it), and `Zk.sql` asks the chain's QueryRouter for it
// with `requestQuery`, under the `"latest"` version, the router's current Proof of SQL verifier. It
// approves the router for the payment, in the token the router names (SXT), and the router pulls it.
// The callback is the Pot's `queryCallback(bytes32,bytes,bytes)`.
//
// THE PROMISE. The router answers the query's id, and the promise is parked under it
// (`promiseKey(SQL, queryId)`). The query's payment may be cancelled after its timeout, and the
// promise expires at the same moment: after it anyone may call the Pot's `expire(bytes32)`, which
// rejects it with `Timeout(bytes32 key)` and runs its `.catch`. `Zk.cancel(e)` there takes the
// payment back: the Pot keeps the query's id and payment beside the promise until it settles, two
// words in its storage.
//
// THE CALLBACK. Space and Time's CallbackExecutor calls the Pot with
//
//   queryCallback(bytes32 queryId, bytes result, bytes callbackData)
//
// which the Pot answers with the handler whose body is `queryCallback` below: from the executor
// alone, it fulfils the promise parked under the query's id with the result. Anyone may ask a query
// naming the Pot as its callback, but only a query this Pot asked has its id in the table: any other
// finds nothing pending, and the callback returns. The router answers a query once.
//
// THE RESULT is Proof of SQL's table, serialized: `Zk.cell(result, column, row)` reads one value of
// a fixed-width column, `Zk.text(result, column, row)` the bytes of a VARCHAR or VARBINARY one, and
// `Zk.rows(result)` how many rows it has.
//
// BOUNDLESS (`Zk.risc0`, Base), RISC Zero's proof market.
//
// THE REQUEST. A guest program, named by its image id and published at its image URL, run on an
// input: `Zk.risc0({ imageId, imageUrl, input, offer })` builds the market's `ProofRequest` with the
// Pot as its client and its callback, deposits the offer's most as its price, and submits it. The
// guest's stdin is the request's id (32 bytes) followed by `input`, so no two requests share one,
// and the guest must commit the sha256 of its whole stdin as the first 32 bytes of its journal: the
// request's predicate requires it (a `PrefixMatch` on that digest).
//
// A JOURNAL KNOWN IN ADVANCE. A guest whose output the program can state — one that proves a claim
// about its input, as Boundless's own examples do — is asked with `journal`, what it must commit:
// its stdin is then `input` alone, as the guest reads it unchanged, and the request asks for exactly
// that journal (a `DigestMatch` on its sha256), as Boundless's own tooling asks by default. The Pot
// has one such request pending per guest and journal.
//
// THE POT SIGNS ITS OWN REQUESTS. A prover locks a request by asking its client
// `isValidSignature(requestHash, signature)` (ERC-1271), static, with 100,000 gas, and the lock spends
// the client's balance at the market. When it submits a request the Pot hashes it as the market does
// (EIP-712, under the market's own domain) and approves the hash (`@sauce/async`'s `Erc1271`), and
// the Pot's one ERC-1271 handler, `@sauce/async`'s, says yes for it, in about 38,000 of the 100,000.
// An approval is left in place once the request settles: it names one request of one market, which
// is locked once.
//
// THE CALLBACK carries no request id: the market calls `handleProof(bytes32 imageId, bytes journal,
// bytes seal)`. The promise's key is the image id with the journal's first word, the sha256 of the
// guest's stdin (`promiseKey(RISC0, keccak256(abi.encode(imageId, digest)))`), so the handler finds
// the promise from the callback alone, and a proof of the same guest over another input finds
// nothing. The body is handed the rest of the journal. A request that named its journal is keyed by
// the image and the journal's sha256 under a tag of its own (`promiseKey(RISC0_JOURNAL, …)`), which
// the handler looks for first, and its body is handed the whole journal: a proof of that guest and
// that journal settles it, whichever request it answers. A proof delivered again finds the promise
// settled.
//
// The request expires at its deadline (`rampUpStart + timeout`), and so does its promise; there
// `Zk.reclaim(e)` slashes the request if a prover locked it and failed, and withdraws its price.
//
// The calls are written out, selector and arguments, as the contracts declare them. The QueryRouter's:
// `requestQuery((bytes32,bytes,bytes,bytes),(uint256,uint64,address,bytes4,bytes),
// (uint256,address,uint64))` (0x9165fb7f), `PAYMENT_TOKEN()` (0x877c86fb) and
// `cancelQuery(bytes32,(uint256,address,uint64))` (0x4e8d0f8d). BoundlessMarket's:
// `submitRequest((uint256,((address,uint96),(uint8,bytes),bytes4),string,(uint8,bytes),(uint256,
// uint256,uint64,uint32,uint32,uint32,uint256)),bytes)` (0xdf2e6706), `eip712DomainSeparator()`
// (0x5b07fdd8), `requestIsLocked(uint256)` (0xcb74db11), `requestIsFulfilled(uint256)` (0x81bf6c24),
// `slash(uint256)` (0x45bc4d10) and `withdraw(uint256)` (0x2e1a7d4d). The SDK's tests derive each
// from its signature and run them against the contracts as deployed.
import { Request, approveHash, fulfil, promiseKey, requireCaller } from "@sauce/async";
import { approve } from "@sauce/token";

// The tag a query's promise key is made under: keccak256("sauce.zk.sql").
const SAUCE_ZK_SQL = 0xf76c4b9e23420162466a2378daf1b3d87d3d09ffbe97b2f1659860af1309ea12;

// The version a query names: keccak256("latest"), which the QueryRouter maps to its current Proof of
// SQL verifier. A version it has no entry for would be read as a verifier's address.
const SAUCE_ZK_LATEST = 0x5d7c83ff6d08efb2f110018d8b6814a4719a93273a3ea09ced5cfe0d5db1d001;

// The ERC-7201 namespace a query's cancellation is kept in, in the Pot's storage:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Zk")) - 1)) & ~bytes32(uint256(0xff)).
// Under a promise's key, at `keccak256(abi.encode(key, namespace))`: the query's id, and the word
// after it the payment's amount above its timeout (the low 64 bits).
const SAUCE_ZK_NAMESPACE = 0xb17760d84f08c2c9fa647a884d9c84e17f084859463e6c6008dee8454f921500;

// The callback's selector, `queryCallback(bytes32,bytes,bytes)`: the name Space and Time's own
// examples give it, and the one the package's handler answers.
const SAUCE_ZK_QUERY_CALLBACK = 0xd1eefc40;

// `Timeout(bytes32)`, what `expire` rejects a promise with.
const SAUCE_ZK_TIMEOUT = 0xe6cc9dd0;

// The tag a Boundless request's promise key is made under: keccak256("sauce.zk.risc0").
const SAUCE_ZK_RISC0 = 0xb99128647b7cf726b7c5d344394fa65fa7c24e2e70f54d99faf3927ff32222c4;

// The tag of a request that named its journal: keccak256("sauce.zk.risc0.journal").
const SAUCE_ZK_RISC0_JOURNAL = 0x10e9789322c7f6448ed33bcb3bd452509b688c131efd2f80581bb15729c6ac60;

// The ERC-7201 namespace of the Boundless requests, in the Pot's storage:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.ZkRisc0")) - 1)) & ~bytes32(uint256(0xff)).
// Its first word counts the requests the Pot has made, each request's index. At
// `keccak256(abi.encode(key, namespace))`, under a promise's key: the request's index and its price
// above it, until the promise settles.
const SAUCE_ZK_RISC0_NAMESPACE = 0x569afbd4b1cedd4b9d4b5b614f8f04991e23581bad9d682bc2052921d7763600;

// The EIP-712 type hashes of the market's `ProofRequest` and the structs in it, each the keccak256 of
// its type string followed by those of the types it references, in order:
// `Callback(address addr,uint96 gasLimit)`,
const SAUCE_ZK_CALLBACK_TYPEHASH = 0xc0d011520a6b2314053ae9acff853f2e68d4acc34231ca7a0f721507ec141590;
// `Predicate(uint8 predicateType,bytes data)`,
const SAUCE_ZK_PREDICATE_TYPEHASH = 0x0294f25a16f4c103f0fdbc81eeda91cda27d840512cff113bd72c4939b8fe685;
// `Requirements(Callback callback,Predicate predicate,bytes4 selector)` with Callback and Predicate,
const SAUCE_ZK_REQUIREMENTS_TYPEHASH = 0xa4be3f5638620534f7fc09e92fb30a7009441f99acfdf16a3f069fb49d206a7a;
// `Input(uint8 inputType,bytes data)`,
const SAUCE_ZK_INPUT_TYPEHASH = 0x073039c66bce7413182ec91963b518ef97a9eadb8216b337c8ea3be14ac2ac10;
// `Offer(uint256 minPrice,uint256 maxPrice,uint64 rampUpStart,uint32 rampUpPeriod,uint32
// lockTimeout,uint32 timeout,uint256 lockCollateral)`,
const SAUCE_ZK_OFFER_TYPEHASH = 0xa563ca6047b9178e0a2d4ee0299d3e9edb98870eed639d251ef21ea51d6d1794;
// and `ProofRequest(uint256 id,Requirements requirements,string imageUrl,Input input,Offer offer)`
// with Callback, Input, Offer, Predicate and Requirements.
const SAUCE_ZK_PROOF_REQUEST_TYPEHASH = 0x9fcf2e0179af2440b5f4e7adff50bb887832a78929465dcca0d29c2a83b93054;

// What a query leaves out: no parameters (a serialized empty list, its count as eight bytes), the
// callback's gas, and how long the query may wait before it may be cancelled.
const SAUCE_ZK_NO_PARAMETERS = hex`0000000000000000`;
const SAUCE_ZK_GAS_LIMIT = 1000000;
const SAUCE_ZK_TIMEOUT_SECONDS = 3600;

// What `Zk.sql` and `Zk.risc0` take. The compiler refuses a field these do not declare, naming it, and
// a read of a member an object never set unless its type declares it optional, so each is optional
// here and each method says which it requires.
interface SqlQuery {
  query?: bytes;
  payment?: Uint256;
  parameters?: bytes;
  metadata?: bytes;
  timeout?: Uint256;
  gasLimit?: Uint256;
  maxGasPrice?: Uint256;
}

interface ProofOffer {
  maxPrice?: Uint256;
  minPrice?: Uint256;
  rampUpPeriod?: Uint256;
  lockTimeout?: Uint256;
  timeout?: Uint256;
  lockCollateral?: Uint256;
}

interface ProofRequest {
  imageId?: Uint256;
  imageUrl?: bytes;
  input?: bytes;
  journal?: bytes;
  offer?: ProofOffer;
  gasLimit?: Uint256;
}

// The requests a program makes: `Zk.sql(query)`, `Zk.risc0(request)`, and what their `.catch` and
// `.then` call. Each coprocessor's takes its own calls, so a program names only the contracts of the
// coprocessors it asks: one for Ethereum, which has no Boundless market, names none of its.
class Requests {
  // A SQL query to Space and Time:
  //
  //   query        the proof plan, as Space and Time's RPC gives it for the SQL; required
  //   payment      what the query pays, in the router's token's base units (SXT, 18 decimals): at
  //                least the router's `baseCost()`, and on Ethereum the callback's gas too; what the
  //                fulfiller is not paid comes back to the Pot; required
  //   parameters   the query's serialized parameters: none when left out
  //   metadata     the query's metadata: none when left out
  //   timeout      seconds until the query may be cancelled and its promise expired: 3600
  //   gasLimit     the callback's gas: 1,000,000
  //   maxGasPrice  the most per gas the callback is charged at, on Ethereum; the payment caps the
  //                whole charge, so no limit when left out
  sql(config: SqlQuery) {
    if (config === undefined) {
      throw new Error("`Zk.sql(...)` takes one object: `Zk.sql({ query, payment })`");
    }
    if (config.query === undefined || config.payment === undefined) {
      throw new Error(
        "`Zk.sql` needs `query`, the proof plan Space and Time's RPC gives for the SQL, and `payment`, what the query pays in SXT",
      );
    }
    const timeout = config.timeout === undefined ? SAUCE_ZK_TIMEOUT_SECONDS : config.timeout;
    const deadline = ctx.timestamp() + timeout;
    return new Request({
      deadline,
      send: (continuation) => {
        const router = SpaceAndTime.QueryRouter;
        const [token] = abi.decode(evm.static(router, hex`877c86fb`), ["Address"]);
        approve(token, router, config.payment);
        const [queryId] = abi.decode(
          evm.call(
            router,
            0,
            hex`9165fb7f`.concat(
              abi.encode(
                {
                  version: SAUCE_ZK_LATEST,
                  innerQuery: config.query,
                  parameters:
                    config.parameters === undefined ? SAUCE_ZK_NO_PARAMETERS : config.parameters,
                  metadata: config.metadata === undefined ? hex`` : config.metadata,
                },
                {
                  maxGasPrice: config.maxGasPrice === undefined ? ~0 : config.maxGasPrice,
                  gasLimit: config.gasLimit === undefined ? SAUCE_ZK_GAS_LIMIT : config.gasLimit,
                  callbackContract: ctx.self(),
                  selector: SAUCE_ZK_QUERY_CALLBACK << 224,
                  callbackData: hex``,
                },
                { paymentAmount: config.payment, refundTo: ctx.self(), timeout: deadline },
              ),
            ),
          ),
          ["Uint256"],
        );
        const key = promiseKey(SAUCE_ZK_SQL, queryId);
        const slot = recordOf(key);
        evm.sstore(slot, queryId);
        evm.sstore(slot + 1, (config.payment << 64) | deadline);
        return key;
      },
      deliver: (input, body, fail) => {
        body(input);
      },
    });
  }

  // A RISC Zero guest program run on an input, proven by Boundless's market:
  //
  //   imageId   the guest's image id; required
  //   imageUrl  where provers download the guest, its UTF-8 bytes; required
  //   input     what the guest reads from stdin after the request's id: none when left out
  //   journal   what the guest must commit, when the program knows it: the guest then reads
  //             `input` alone, the request asks for exactly this journal, and the body is handed
  //             it; left out, the guest commits the sha256 of its stdin and then its output, and
  //             the body is handed the output
  //   offer     the price and its timing, as the market's Offer: `maxPrice` (wei, deposited),
  //             `rampUpPeriod`, `lockTimeout`, `timeout` (seconds from now) and `lockCollateral`
  //             (ZKC's base units) required, `minPrice` 0 when left out
  //   gasLimit  the callback's gas: 1,000,000
  risc0(config: ProofRequest) {
    if (config === undefined) {
      throw new Error(
        "`Zk.risc0(...)` takes one object: `Zk.risc0({ imageId, imageUrl, input, offer })`",
      );
    }
    if (
      config.imageId === undefined ||
      config.imageUrl === undefined ||
      config.offer === undefined
    ) {
      throw new Error(
        "`Zk.risc0` needs `imageId` and `imageUrl`, the guest and where provers find it, and `offer`, its price",
      );
    }
    const offer = config.offer;
    if (
      offer.maxPrice === undefined ||
      offer.rampUpPeriod === undefined ||
      offer.lockTimeout === undefined ||
      offer.timeout === undefined ||
      offer.lockCollateral === undefined
    ) {
      throw new Error(
        "`offer` is `{ maxPrice, rampUpPeriod, lockTimeout, timeout, lockCollateral }`, and `minPrice` when it is not 0",
      );
    }
    const deadline = ctx.timestamp() + offer.timeout;
    return new Request({
      deadline,
      send: (continuation) => {
        return requestProof(
          Boundless.Market,
          config.imageId,
          config.imageUrl,
          config.input === undefined ? hex`` : config.input,
          config.journal !== undefined,
          config.journal === undefined ? hex`` : config.journal,
          offer.minPrice === undefined ? 0 : offer.minPrice,
          offer.maxPrice,
          offer.rampUpPeriod,
          offer.lockTimeout,
          offer.timeout,
          offer.lockCollateral,
          config.gasLimit === undefined ? SAUCE_ZK_GAS_LIMIT : config.gasLimit,
        );
      },
      deliver: (input, body, fail) => {
        body(input);
      },
    });
  }

  // In a query's `.catch`: when it was rejected for its timeout, cancel the Space and Time query and
  // take its payment back. Anything else — the body's own revert — is left alone. Answers whether it
  // took the payment back.
  cancel(reason) {
    return cancelQuery(timedOut(reason), SpaceAndTime.QueryRouter);
  }

  // In a proof request's `.catch`: when it was rejected for its deadline, slash the Boundless request
  // if a prover locked it and failed, and withdraw its price. Anything else is left alone. Answers
  // whether it took the price back.
  reclaim(reason) {
    return reclaimProof(timedOut(reason), Boundless.Market);
  }

  // One value of a result: column `column`'s `row`th, of a fixed-width type (BOOLEAN, TINYINT,
  // SMALLINT, INT, BIGINT, DECIMAL75, TIMESTAMP, SCALAR), as the unsigned number its bytes are, so a
  // negative number is its two's complement in the type's width.
  cell(result, column, row) {
    return cell(result, column, row);
  }

  // One value of a VARCHAR or VARBINARY column, column `column`'s `row`th: its bytes, UTF-8 for a
  // VARCHAR.
  text(result, column, row) {
    return text(result, column, row);
  }

  // How many rows a result has.
  rows(result) {
    return rows(result);
  }
}

export const Zk = new Requests();

function recordOf(key: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(key, SAUCE_ZK_NAMESPACE));
}

function forget(key: Uint256): void {
  const slot = recordOf(key);
  evm.sstore(slot, 0);
  evm.sstore(slot + 1, 0);
}

// The promise a `.catch` was handed `Timeout(bytes32 key)` for, or zero for any other reason.
function timedOut(reason: bytes): Uint256 {
  if (reason.length != 36) {
    return 0;
  }
  if (reason.slice(0, 4).toBe() != SAUCE_ZK_TIMEOUT) {
    return 0;
  }
  return reason.slice(4, 36).toBe();
}

// `Zk.cancel` for a Space and Time query: cancel it at `router`, its payment back to the Pot. False
// when the promise has no query.
export function cancelQuery(key: Uint256, router: Address): bool {
  if (key == 0) {
    return false;
  }
  const slot = recordOf(key);
  const queryId = evm.sload(slot);
  if (queryId == 0) {
    return false;
  }
  const payment = evm.sload(slot + 1);
  forget(key);
  let cancelled = true;
  evm
    .call(
      router,
      0,
      hex`4e8d0f8d`.concat(
        abi.encode(queryId, {
          paymentAmount: payment >> 64,
          refundTo: ctx.self(),
          timeout: payment & 0xffffffffffffffff,
        }),
      ),
    )
    .catch((e) => {
      cancelled = false;
    });
  return cancelled;
}

// The body of the handler for `queryCallback(bytes32,bytes,bytes)`, the call a fulfilled query
// lands on: from `executor` (the chain's CallbackExecutor) alone, it fulfils the promise parked
// under the query's id with the result. A query this Pot did not ask, or one settled already, finds
// nothing pending, and the call returns.
export function queryCallback(executor: Address, caller: Address, data: bytes): void {
  requireCaller(executor, caller);
  const [queryId, result, callbackData] = abi.decode(data.slice(4, data.length), [
    "Uint256",
    "bytes",
    "bytes",
  ]);
  const key = promiseKey(SAUCE_ZK_SQL, queryId);
  forget(key);
  fulfil(key, result);
}

// ---- a Boundless request -----------------------------------------------------------------------

function risc0SlotOf(x: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(x, SAUCE_ZK_RISC0_NAMESPACE));
}

// The request's id: the Pot as its client, which signs with ERC-1271 (bit 192), and its index.
function requestIdOf(index: Uint256): Uint256 {
  return (1 << 192) | (ctx.self() << 32) | index;
}

// Submit the request `Zk.risc0` describes, its price deposited, its hash approved as the Pot's
// (ERC-1271), and answer its promise's key.
export function requestProof(
  market: Address,
  imageId: Uint256,
  imageUrl: bytes,
  input: bytes,
  exact: bool,
  journal: bytes,
  minPrice: Uint256,
  maxPrice: Uint256,
  rampUpPeriod: Uint256,
  lockTimeout: Uint256,
  timeout: Uint256,
  lockCollateral: Uint256,
  gasLimit: Uint256,
): Uint256 {
  const index = evm.sload(SAUCE_ZK_RISC0_NAMESPACE) + 1;
  require(index < 1 << 32, "zk: the Pot has made every request it can");
  evm.sstore(SAUCE_ZK_RISC0_NAMESPACE, index);
  const id = requestIdOf(index);
  // The guest's stdin, its id first unless the program named the journal; the input as the market
  // carries it, a version byte (0, raw) first; and the predicate, the guest's image and a sha256:
  // of the journal named, which the journal must be (a `DigestMatch`, 0), or else of the stdin,
  // which the journal must begin with (a `PrefixMatch`, 1). The promise's key is the predicate's
  // hash under the tag of its kind.
  let stdin = input;
  let committed = journal;
  let predicateType = 0;
  let tag = SAUCE_ZK_RISC0_JOURNAL;
  if (!exact) {
    stdin = abi.encode(id).concat(input);
    committed = stdin;
    predicateType = 1;
    tag = SAUCE_ZK_RISC0;
  }
  const data = hex`00`.concat(stdin);
  const [digest] = abi.decode(evm.static(2, committed), ["Uint256"]);
  const predicate = abi.encode(imageId, digest);
  const key = promiseKey(tag, crypto.keccak256(predicate));
  require(evm.sload(risc0SlotOf(key)) ==
    0, "zk: the Pot has a request pending for that guest and journal");
  const rampUpStart = ctx.timestamp();
  // The request's EIP-712 hash, as the market's `_hashTypedDataV4(request.eip712Digest())`.
  const requirements = crypto.keccak256(
    abi.encode(
      SAUCE_ZK_REQUIREMENTS_TYPEHASH,
      crypto.keccak256(abi.encode(SAUCE_ZK_CALLBACK_TYPEHASH, ctx.self(), gasLimit)),
      crypto.keccak256(
        abi.encode(SAUCE_ZK_PREDICATE_TYPEHASH, predicateType, crypto.keccak256(predicate)),
      ),
      0,
    ),
  );
  const structHash = crypto.keccak256(
    abi.encode(
      SAUCE_ZK_PROOF_REQUEST_TYPEHASH,
      id,
      requirements,
      crypto.keccak256(imageUrl),
      crypto.keccak256(abi.encode(SAUCE_ZK_INPUT_TYPEHASH, 0, crypto.keccak256(data))),
      crypto.keccak256(
        abi.encode(
          SAUCE_ZK_OFFER_TYPEHASH,
          minPrice,
          maxPrice,
          rampUpStart,
          rampUpPeriod,
          lockTimeout,
          timeout,
          lockCollateral,
        ),
      ),
    ),
  );
  const [domain] = abi.decode(evm.static(market, hex`5b07fdd8`), ["Uint256"]);
  approveHash(crypto.keccak256(hex`1901`.concat(abi.encode(domain, structHash))), true);
  evm.call(
    market,
    maxPrice,
    hex`df2e6706`.concat(
      abi.encode(
        {
          id,
          requirements: {
            callback: { addr: ctx.self(), gasLimit },
            predicate: { predicateType, data: predicate },
            selector: 0,
          },
          imageUrl,
          input: { inputType: 0, data },
          offer: {
            minPrice,
            maxPrice,
            rampUpStart,
            rampUpPeriod,
            lockTimeout,
            timeout,
            lockCollateral,
          },
        },
        hex``,
      ),
    ),
  );
  evm.sstore(risc0SlotOf(key), index | (maxPrice << 32));
  return key;
}

// The body of the handler for `handleProof(bytes32,bytes,bytes)`, the call a fulfilled request lands
// on: from `market` (the chain's BoundlessMarket) alone, it fulfils a promise. One whose request named
// its journal is found by the image id and the journal's sha256, and handed the whole journal; any
// other by the image id and the journal's first word, and handed the rest. A proof of another request
// finds nothing pending, and the call returns.
export function handleProof(market: Address, caller: Address, data: bytes): void {
  requireCaller(market, caller);
  const [imageId, journal, seal] = abi.decode(data.slice(4, data.length), [
    "Uint256",
    "bytes",
    "bytes",
  ]);
  const [digest] = abi.decode(evm.static(2, journal), ["Uint256"]);
  const named = promiseKey(SAUCE_ZK_RISC0_JOURNAL, crypto.keccak256(abi.encode(imageId, digest)));
  if (evm.sload(risc0SlotOf(named)) != 0 || journal.length < 32) {
    evm.sstore(risc0SlotOf(named), 0);
    fulfil(named, journal);
    return;
  }
  const key = promiseKey(
    SAUCE_ZK_RISC0,
    crypto.keccak256(abi.encode(imageId, journal.slice(0, 32).toBe())),
  );
  evm.sstore(risc0SlotOf(key), 0);
  fulfil(key, journal.slice(32, journal.length));
}

// `Zk.reclaim` for a Boundless request: slash it at `market` if a prover locked it and did not fulfil
// it, then withdraw its price from the Pot's balance there. False when the promise has no request.
export function reclaimProof(key: Uint256, market: Address): bool {
  if (key == 0) {
    return false;
  }
  const slot = risc0SlotOf(key);
  const record = evm.sload(slot);
  if (record == 0) {
    return false;
  }
  evm.sstore(slot, 0);
  const id = requestIdOf(record & 0xffffffff);
  const [fulfilled] = abi.decode(evm.static(market, hex`81bf6c24`.concat(abi.encode(id))), [
    "bool",
  ]);
  if (fulfilled) {
    return false;
  }
  const [locked] = abi.decode(evm.static(market, hex`cb74db11`.concat(abi.encode(id))), ["bool"]);
  if (locked) {
    evm.call(market, 0, hex`45bc4d10`.concat(abi.encode(id))).catch((e) => {});
  }
  let withdrawn = true;
  evm.call(market, 0, hex`2e1a7d4d`.concat(abi.encode(record >> 32))).catch((e) => {
    withdrawn = false;
  });
  return withdrawn;
}

// ---- reading a result ---------------------------------------------------------------------------
//
// Proof of SQL's serialized table: a `uint64` column count, then each column — its name (a `uint64`
// length and its bytes), a zero byte, its type as a `uint32` (DECIMAL75 followed by a precision and
// a scale byte, TIMESTAMP by a `uint32` unit and an `int32` zone), and its data: a `uint64` row
// count and the values, fixed-width big-endian, or for VARCHAR and VARBINARY each a `uint64` length
// and its bytes.

// The width of one value of `kind`, or zero for a variable-width kind.
function widthOf(kind: Uint256): Uint256 {
  if (kind == 0 || kind == 2) {
    return 1;
  }
  if (kind == 3) {
    return 2;
  }
  if (kind == 4) {
    return 4;
  }
  if (kind == 5 || kind == 9) {
    return 8;
  }
  if (kind == 8 || kind == 10) {
    return 32;
  }
  require(kind == 7 || kind == 11, "zk: the result has a column of a type it cannot read");
  return 0;
}

// Where column `column`'s data starts in `result`, and its kind.
function columnAt(result: bytes, column: Uint256): Uint256[] {
  const columns = result.slice(0, 8).toBe();
  require(column < columns, "zk: the result has no such column");
  let at = 8;
  for (let c = 0; c <= column; c += 1) {
    at = at + 8 + result.slice(at, at + 8).toBe() + 1;
    const kind = result.slice(at, at + 4).toBe();
    at = at + 4;
    if (kind == 8) {
      at = at + 2;
    }
    if (kind == 9) {
      at = at + 8;
    }
    if (c == column) {
      return [at, kind];
    }
    const count = result.slice(at, at + 8).toBe();
    at = at + 8;
    const width = widthOf(kind);
    if (width == 0) {
      for (let r = 0; r < count; r += 1) {
        at = at + 8 + result.slice(at, at + 8).toBe();
      }
    } else {
      at = at + count * width;
    }
  }
  return [at, 0];
}

// The body of `Zk.cell`.
export function cell(result: bytes, column: Uint256, row: Uint256): Uint256 {
  const found = columnAt(result, column);
  const at = found[0];
  const width = widthOf(found[1]);
  require(width != 0, "zk: the column is not of a fixed width");
  require(row < result.slice(at, at + 8).toBe(), "zk: the result has no such row");
  const start = at + 8 + row * width;
  return result.slice(start, start + width).toBe();
}

// The body of `Zk.text`.
export function text(result: bytes, column: Uint256, row: Uint256): bytes {
  const found = columnAt(result, column);
  require(widthOf(found[1]) == 0, "zk: the column is of a fixed width");
  let at = found[0];
  require(row < result.slice(at, at + 8).toBe(), "zk: the result has no such row");
  at = at + 8;
  for (let r = 0; r < row; r += 1) {
    at = at + 8 + result.slice(at, at + 8).toBe();
  }
  const length = result.slice(at, at + 8).toBe();
  return result.slice(at + 8, at + 8 + length);
}

// The body of `Zk.rows`: the first column's row count, which every column shares.
export function rows(result: bytes): Uint256 {
  const found = columnAt(result, 0);
  return result.slice(found[0], found[0] + 8).toBe();
}

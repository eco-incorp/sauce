// @sauce/zk — EVM arm.
//
// A proven answer about a chain's history, delivered to a `.then`. A program asks a ZK coprocessor
// a question — what a storage slot held, what an account's balance was, what a receipt logged, at
// blocks long past, and what a circuit computes over them — and the body runs on the same Private
// Pot when the coprocessor calls back with the proven results:
//
//   import { Zk } from "@sauce/zk";
//
//   function main(dataQueryHash: Uint256, dataQuery: bytes, k: Uint256, resultLen: Uint256,
//                 vkey: Uint256[], computeProof: bytes, maxFeePerGas: Uint256,
//                 minimum: Uint256, recipient: Address, amount: Uint256): void {
//     Zk.axiom({
//       dataQueryHash,
//       dataQuery,
//       computeQuery: { k, resultLen, vkey, computeProof },
//       maxFeePerGas,
//     }).then((results) => {
//       require(results[0] >= minimum, "below the minimum");
//       USDC.transfer(recipient, amount);
//     });
//   }
//
// THE QUERY. Axiom V2's: the question is a circuit, compiled and proven over its inputs off chain by
// Axiom's own tooling (`@axiom-crypto/client`), which produces the query's parts — `dataQueryHash`
// and the raw `dataQuery` (the subqueries the circuit reads), and `computeQuery` (the circuit's
// degree `k`, how many results it outputs, its verifying key, and the proof of the compute step). A
// program takes them as `main`'s arguments and `Zk.axiom` sends them to the chain's AxiomV2Query
// with `sendQuery`, paying exactly the escrow it asks: the callback's gas and the proof's
// verification at `maxFeePerGas`, and Axiom's fee. The callback's target is the Pot itself.
//
// THE CONTINUATION TRAVELS WITH THE QUERY. The body, compiled as a program of its own, is the
// callback's `extraData`, which AxiomV2Query hands back unchanged: the query id commits to
// `keccak256(target ++ extraData)`, and a fulfilment must present both. So nothing is parked, and a
// query costs its calldata and its event's data rather than a contract deployed and a slot written.
//
// THE CALLBACK. AxiomV2Query calls the Pot with
//
//   axiomV2Callback(uint64 sourceChainId, address caller, bytes32 querySchema, uint256 queryId,
//                   bytes32[] axiomResults, bytes extraData)
//
// which the Pot answers with the handler whose body is `axiomV2Callback` below. It runs the
// continuation only after two checks: the call came from AxiomV2Query (anyone can send the Pot any
// calldata), and the query's `caller` is this Pot (anyone can send a query whose callback names the
// Pot, with any `extraData`). After both, `extraData` is a program this Pot wrote, and the results
// are the ones proven for the query it sent.
//
// WHAT CAN GO WRONG. AxiomV2Query marks a query fulfilled before it calls back, calls with exactly
// the query's `callbackGasLimit`, and does not revert when the callback does: a body that reverts,
// or runs out of gas, is not retried, and the escrow is spent. `.catch(e)` runs in the body's place
// when the body reverts, within the same gas.
//
// Axiom ended support for V2 on December 21, 2024: AxiomV2Query is still deployed on Ethereum and
// Base and still takes a query and its fee, but no prover has fulfilled one since. A query sent now
// escrows its fee until its deadline, when its refundee may take it back.
//
// The calls are written out, selector and arguments, as AxiomV2Query declares them:
// `sendQuery(uint64,bytes32,(uint8,uint16,bytes32[],bytes),(address,bytes),(uint64,uint32,uint256),
// bytes32,address,bytes)` (0xed2d9ba0), `axiomQueryFee()` (0x7393da9e) and `proofVerificationGas()`
// (0xfb035bc3). The SDK's tests derive each from its signature and run them against AxiomV2Query's
// own implementation, as deployed.
import { Request, requireCaller, requireSelf, run } from "@sauce/async";

// The transient-storage slot (EIP-1153) counting the queries a transaction has sent:
// keccak256("sauce.zk.nonce"). A query's default salt mixes it with the block, so two queries alike
// in one transaction, or in two, are two queries with two ids.
const SAUCE_ZK_NONCE = 0xe8690f461ed9278676cbb3a74bbd2b285c9c4297effb2bb98ff011da9486a142;

// The callback's gas when a query does not say: enough for the Pot's handler — the Router's
// fallback, the Kitchen's cook, the checks, the continuation run in the same cook — and a body
// that reads its results and moves a token or two. A body that does more names its own.
const CALLBACK_GAS_LIMIT = 300000;

// The requests a program makes: `Zk.axiom(query)`, one per coprocessor this package speaks.
class Requests {
  // A query to Axiom V2, as Axiom's tooling produces its parts:
  //
  //   dataQueryHash     the hash of the subqueries; required
  //   dataQuery         the subqueries, for the prover (AxiomV2Query does not check them against
  //                     the hash); required
  //   computeQuery      `{ k, resultLen, vkey, computeProof }`, the compute circuit; `{ k: 0,
  //                     resultLen }` for a query of subqueries alone; required
  //   maxFeePerGas      the gas price the callback is paid at, in wei; at least the chain's
  //                     `minMaxFeePerGas()`; required
  //   callbackGasLimit  the callback's gas: 300,000 when left out
  //   queryFee          Axiom's fee when it is above `axiomQueryFee()`; the contract's when left out
  //   refundee          who may take the escrow back if the query is not fulfilled by its
  //                     deadline: this Pot when left out
  //   salt              the query's salt, used as written; one per block and query when left out
  //   sourceChainId     the chain whose history it reads: this one when left out, the only one each
  //                     deployment proves
  axiom(config) {
    if (config === undefined || config.length !== undefined) {
      throw new Error(
        "`Zk.axiom(...)` takes one object: `Zk.axiom({ dataQueryHash, dataQuery, computeQuery, maxFeePerGas })`",
      );
    }
    const fields = {
      dataQueryHash: true,
      dataQuery: true,
      computeQuery: true,
      maxFeePerGas: true,
      callbackGasLimit: true,
      queryFee: true,
      refundee: true,
      salt: true,
      sourceChainId: true,
    };
    for (const key of Object.keys(config)) {
      if (fields[key] === undefined) {
        throw new Error(
          "`Zk.axiom` takes no `" +
            key +
            "`: its fields are dataQueryHash, dataQuery, computeQuery, maxFeePerGas, callbackGasLimit, queryFee, refundee, salt and sourceChainId",
        );
      }
    }
    if (
      config.dataQueryHash === undefined ||
      config.dataQuery === undefined ||
      config.computeQuery === undefined ||
      config.maxFeePerGas === undefined
    ) {
      throw new Error(
        "`Zk.axiom` needs `dataQueryHash`, `dataQuery` and `computeQuery`, the query as Axiom's tooling builds it, and `maxFeePerGas`, the gas price its callback is paid at",
      );
    }
    const compute = config.computeQuery;
    if (compute.k === undefined || compute.resultLen === undefined) {
      throw new Error(
        "`computeQuery` is `{ k, resultLen, vkey, computeProof }`, or `{ k: 0, resultLen }` for a query of subqueries alone",
      );
    }
    const query = AxiomV2.Query;
    const callbackGasLimit =
      config.callbackGasLimit === undefined ? CALLBACK_GAS_LIMIT : config.callbackGasLimit;
    return new Request({
      send: (continuation) => {
        const [fee] = abi.decode(evm.static(query, hex`7393da9e`), ["Uint256"]);
        const [verificationGas] = abi.decode(evm.static(query, hex`fb035bc3`), ["Uint256"]);
        const queryFee =
          config.queryFee !== undefined && config.queryFee > fee ? config.queryFee : fee;
        const price = config.maxFeePerGas * (callbackGasLimit + verificationGas) + queryFee;
        evm.call(
          query,
          price,
          hex`ed2d9ba0`.concat(
            abi.encode(
              config.sourceChainId === undefined ? chainId : config.sourceChainId,
              config.dataQueryHash,
              {
                k: compute.k,
                resultLen: compute.resultLen,
                vkey: compute.vkey === undefined ? new Array(0) : compute.vkey,
                computeProof: compute.computeProof === undefined ? hex`` : compute.computeProof,
              },
              { target: ctx.self(), extraData: continuation.code.concat(continuation.args) },
              {
                maxFeePerGas: config.maxFeePerGas,
                callbackGasLimit,
                overrideAxiomQueryFee: config.queryFee === undefined ? 0 : config.queryFee,
              },
              config.salt === undefined ? defaultSalt() : config.salt,
              config.refundee === undefined ? ctx.self() : config.refundee,
              config.dataQuery,
            ),
          ),
        );
        return undefined;
      },
      deliver: (input, body, fail) => {
        const [results] = abi.decode(input, ["Uint256[]"]);
        body(results);
      },
    });
  }
}

export const Zk = new Requests();

// A salt a query was not given: the block, mixed with how many queries this transaction has sent,
// counting this one.
function defaultSalt(): Uint256 {
  const sent = evm.tload(SAUCE_ZK_NONCE) + 1;
  evm.tstore(SAUCE_ZK_NONCE, sent);
  return crypto.keccak256(abi.encode(ctx.blockNumber(), sent));
}

// The body of the handler for `axiomV2Callback(uint64,address,bytes32,uint256,bytes32[],bytes)`,
// the call a fulfilled query lands on: from `query` (the chain's AxiomV2Query) alone, for a query
// this Pot sent, it runs the query's continuation — its `extraData` — handing it the results.
export function axiomV2Callback(query: Address, caller: Address, data: bytes): void {
  requireCaller(query, caller);
  const [sourceChainId, sender, querySchema, queryId, results, extraData] = abi.decode(
    data.slice(4, data.length),
    ["Uint256", "Address", "Uint256", "Uint256", "Uint256[]", "bytes"],
  );
  requireSelf(sender);
  run(extraData, abi.encode(results));
}

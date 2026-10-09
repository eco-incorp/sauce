// @sauce/zk — EVM arm.
//
// A proven answer, delivered to a `.then`. A program asks a ZK coprocessor a question now — a SQL
// query over indexed chain data, proven with Proof of SQL — and the body runs on the same Private
// Pot when the coprocessor calls back with the result, as a promise of `@sauce/async`'s:
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
// a fixed-width column, and `Zk.rows(result)` how many rows it has.
//
// The calls are written out, selector and arguments, as the QueryRouter declares them:
// `requestQuery((bytes32,bytes,bytes,bytes),(uint256,uint64,address,bytes4,bytes),
// (uint256,address,uint64))` (0x9165fb7f), `PAYMENT_TOKEN()` (0x877c86fb) and
// `cancelQuery(bytes32,(uint256,address,uint64))` (0x4e8d0f8d). The SDK's tests derive each from its
// signature and run them against the QueryRouter and CallbackExecutor as deployed.
import { Request, fulfil, promiseKey, requireCaller } from "@sauce/async";
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

// What a query leaves out: no parameters (a serialized empty list, its count as eight bytes), the
// callback's gas, and how long the query may wait before it may be cancelled.
const SAUCE_ZK_NO_PARAMETERS = hex`0000000000000000`;
const SAUCE_ZK_GAS_LIMIT = 1000000;
const SAUCE_ZK_TIMEOUT_SECONDS = 3600;

// The requests a program makes: `Zk.sql(query)`, and what its `.catch` and `.then` call.
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
  sql(config) {
    if (config === undefined || config.length !== undefined) {
      throw new Error("`Zk.sql(...)` takes one object: `Zk.sql({ query, payment })`");
    }
    const fields = {
      query: true,
      payment: true,
      parameters: true,
      metadata: true,
      timeout: true,
      gasLimit: true,
      maxGasPrice: true,
    };
    for (const key of Object.keys(config)) {
      if (fields[key] === undefined) {
        throw new Error(
          "`Zk.sql` takes no `" +
            key +
            "`: its fields are query, payment, parameters, metadata, timeout, gasLimit and maxGasPrice",
        );
      }
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

  // In a query's `.catch`: when it was rejected for its timeout, cancel the query and take its
  // payment back. Anything else — the body's own revert — is left alone. Answers whether it
  // cancelled.
  cancel(reason) {
    return cancelQuery(reason);
  }

  // One value of a result: column `column`'s `row`th, of a fixed-width type (BOOLEAN, TINYINT,
  // SMALLINT, INT, BIGINT, DECIMAL75, TIMESTAMP, SCALAR), as the unsigned number its bytes are, so a
  // negative number is its two's complement in the type's width.
  cell(result, column, row) {
    return cell(result, column, row);
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

// The body of `Zk.cancel`.
export function cancelQuery(reason: bytes): bool {
  if (reason.length != 36) {
    return false;
  }
  if (reason.slice(0, 4).toBe() != SAUCE_ZK_TIMEOUT) {
    return false;
  }
  const key = reason.slice(4, 36).toBe();
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
      SpaceAndTime.QueryRouter,
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

// The body of `Zk.rows`: the first column's row count, which every column shares.
export function rows(result: bytes): Uint256 {
  const found = columnAt(result, 0);
  return result.slice(found[0], found[0] + 8).toBe();
}

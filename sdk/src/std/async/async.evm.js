// @sauce/async — EVM arm.
//
// Sauce's one async primitive is `.then`. A program makes a request now; the protocol calls the Pot
// back later, in a transaction of its own; the `.then` body, compiled while the program compiles,
// runs when the callback lands, as the same Pot:
//
//   await Random.vrf({ words: 2 }).then((words) => {
//     USDC.transfer(winners[words[0] % 2], prize);
//   });
//
// `Random.vrf` is a protocol package's (`@sauce/random`); this package is what every such package
// is built on, and holds no protocol of its own:
//
//   Request        the class `.then` folds on, which a package's request method returns: it records
//                  the body, and when the statement ends compiles it as a program of its own and
//                  parks it under the request's key (or hands it to the protocol to carry);
//   park, take     a continuation's storage: one program per key, taken once;
//   run            runs a continuation inside the handler's own cook, handing it what arrived;
//   received       what `run` handed the continuation it is running;
//   requireCaller  the check every handler makes first: the call came from the protocol;
//   requireSelf    the check a handler of a message makes: this Pot sent it;
//   install        registers a handler for a selector on the Pot the program runs on.
//
// WHERE A CALLBACK LANDS. A Private Pot answers a selector neither it nor its Router declares with
// the program its owner registered for it (the Router's `setHandler`, which `install` calls): the
// Router runs that handler as a cook of the Pot, paying the Kitchen's fee from the Pot's balance, as
// `main(caller: Address, value: Uint256, data: bytes)` — who called, what it sent, and the whole
// calldata. A handler authenticates its caller, finds the continuation (`take`) and runs it (`run`):
//
//   import { requireCaller, run, take } from "@sauce/async";
//
//   function main(caller: Address, value: Uint256, data: bytes): void {
//     requireCaller(Coordinator, caller);
//     const [id, words] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256[]"]);
//     run(take(id), abi.encode(words));
//   }
//
// A Shared Pot answers no selector, so nothing here works on one: a continuation parked there is
// one any program could take.
//
// WHAT A CONTINUATION IS. `program(body, chainId)` compiles the body as a program for this chain:
// its bytecode and the run-time values it reads from the program around it, encoded as its
// arguments, `code ++ args`. That is what is parked, so the values a body reads are the ones they
// had when the request was made. What the callback delivers reaches it through `run`, which holds it
// in transient storage (EIP-1153) while the continuation runs; `received()` reads it back, and the
// request's `deliver` decodes it into the body's parameters. Transient storage, and not the
// program's input, because a continuation with a `.catch` runs its body in a `try` block, a frame of
// its own whose input is the block's: transient storage is the Pot's in every frame of the
// transaction.
//
// The calls are written out, selector and arguments, as the Pot and its Router declare them:
// `inFlightEngine()` (0x9fd004e1) and `setHandler(bytes4,address,bytes,bool)` (0xeb45e5d0). The
// SDK's tests derive each from its signature.

// The ERC-7201 namespace the continuations live in, in the Pot's storage:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Async")) - 1)) & ~bytes32(uint256(0xff)).
// A key's slot is `keccak256(abi.encode(key, namespace))`, a Solidity `mapping(bytes32 => address)`
// at that location, holding the address of the contract the continuation was deployed as.
const SAUCE_ASYNC_NAMESPACE = 0x4dfff1aabf079bde1221d3a9fbfbe12f9d81161876e97fa9b85215e9f7a8b300;

// The transient-storage slot (EIP-1153) where `run` holds what a callback delivered while the
// continuation runs: its length, and its words in the slots after it. keccak256("sauce.async.received").
const SAUCE_ASYNC_RECEIVED = 0xe0834bde068556530c4cc9d3e560d8055ab88b322f2d933c8fac9a037dbe690e;

// The engine the Pot's cook in flight runs: the one a continuation runs on.
function inFlightEngine(): Address {
  const [engine] = abi.decode(evm.static(ctx.self(), hex`9fd004e1`), ["Address"]);
  return engine;
}

function slotOf(key: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(key, SAUCE_ASYNC_NAMESPACE));
}

// Park `program` under `key`, for one `take`. The program is deployed as the code of a contract that
// answers any call with it, and only that contract's address is stored: one SSTORE, where the bytes
// themselves would cost one per word. The contract's code is a ten-byte copier and the program
// (PUSH2 <length> DUP1 PUSH1 0x0a RETURNDATASIZE CODECOPY RETURNDATASIZE RETURN), and its init code is
// the same copier around that code, so a program may be up to 24,566 bytes (EIP-170). A key already
// parked is refused: one key, one continuation.
export function park(key: Uint256, program: bytes): void {
  const slot = slotOf(key);
  require(evm.sload(slot) == 0, "async: a continuation is already parked under this key");
  const length = program.length;
  require(length <= 24566, "async: the continuation is larger than one contract can hold");
  const code = length + 10;
  const init = hex`61`
    .concat(code.toBytesBe(2))
    .concat(hex`80600a3d393df361`)
    .concat(length.toBytesBe(2))
    .concat(hex`80600a3d393df3`)
    .concat(program);
  const at = evm.create(init);
  require(at != 0, "async: the continuation could not be deployed");
  evm.sstore(slot, at);
}

// The program parked under `key`, which is no longer parked: a second `take` of the key is refused,
// so a callback delivered twice runs its continuation once. Refused when nothing is parked there.
export function take(key: Uint256): bytes {
  const slot = slotOf(key);
  const at = evm.sload(slot);
  require(at != 0, "async: nothing is parked under this key");
  evm.sstore(slot, 0);
  return evm.static(at, hex``);
}

// Run `program` as this Pot, writable, inside the cook in flight — no second cook, no second fee —
// handing it `input`, what the callback delivered (`abi.encode(...)` of it), which the program reads
// with `received()`. Answers what the program returns. A handler calls it only after it has
// authenticated its caller: the program runs with everything the Pot holds.
export function run(program: bytes, input: bytes): bytes {
  const length = input.length;
  evm.tstore(SAUCE_ASYNC_RECEIVED, length);
  // Whole words: the last one padded with zeros.
  const padded = input.concat(hex`00000000000000000000000000000000000000000000000000000000000000`);
  for (let i = 0; i * 32 < length; i += 1) {
    const [word] = abi.decode(padded.slice(i * 32, i * 32 + 32), ["Uint256"]);
    evm.tstore(SAUCE_ASYNC_RECEIVED + 1 + i, word);
  }
  const out = evm.delegate(inFlightEngine(), program);
  evm.tstore(SAUCE_ASYNC_RECEIVED, 0);
  return out;
}

// In a program `run` is running: the `input` it was handed. Empty anywhere else.
export function received(): bytes {
  const length = evm.tload(SAUCE_ASYNC_RECEIVED);
  let out = hex``;
  for (let i = 0; i * 32 < length; i += 1) {
    const word = evm.tload(SAUCE_ASYNC_RECEIVED + 1 + i);
    out = out.concat(word.toBytesBe(32));
  }
  return out.slice(0, length);
}

// The call came from `expected`: a handler's first check, on its `caller`. Anyone can send the Pot
// any calldata, so a handler that skips it runs a continuation for whoever asks.
export function requireCaller(expected: Address, actual: Address): void {
  require(actual == expected, "async: the call is not from the protocol");
}

// `sender` is this Pot: a message's origin sender, as an address or as a 32-byte word holding one.
// A Pot has the same address on every chain its owner mints it on, so a message this Pot sent from
// another chain names it.
export function requireSelf(sender: Uint256): void {
  require(sender == ctx.self(), "async: the message is not from this Pot");
}

// Answer `selector` (its four bytes, `0x1fe543e3`) on the Pot this program runs on with `program`,
// a compiled handler, run on this cook's engine: as a cook (`readOnly` false) or under a static call
// with no fee (`readOnly` true). An empty program clears the selector. The Pot's Router refuses it
// on a Shared Pot, and on a Pot whose Router has no handlers.
export function install(selector: Uint256, program: bytes, readOnly: bool): void {
  evm.call(
    ctx.self(),
    0,
    hex`eb45e5d0`.concat(abi.encode(selector << 224, inFlightEngine(), program, readOnly)),
  );
}

// A request whose callback arrives later: what a protocol package's request method returns, and the
// class `.then` folds on. The package gives it
//
//   send     `(continuation) => key`: makes the request, at run time, and answers the key the
//            continuation is parked under, the request's id. `continuation` is the body as a
//            program, `{ code, args }`: a protocol that carries data back to the Pot (a bridge's
//            message, a proof's extra data) can carry `continuation.code.concat(continuation.args)`
//            itself, and answer `undefined`, which parks nothing.
//   deliver  `(input, body, fail) => { … }`: runs in the continuation, handed what the callback
//            delivered (`received()`), and calls `body` with it decoded, or `fail` with why the
//            request failed. Left out, the body is handed `input` as it is.
//   chain    the id of the chain the callback lands on, which the body is compiled for, a number
//            the compiler knows (`Optimism.valueOf()`): this chain's (`chainId`) when left out.
//
// and the program gives it the body, `.then((…) => { … })`, or the code after `await`. `.catch(e)`
// handles both failures: the body's revert (everything it did undone) and the protocol's `fail`.
// With no `.catch`, a failure reverts the callback, and the continuation stays parked.
//
// The compiler runs all of this while it compiles: a package's request method must be a method of
// an object the program reads (`Random.vrf(…)`), which the compiler can run, and not a plain
// function.
export class Request {
  constructor(spec) {
    if (spec === undefined || spec.send === undefined) {
      throw new Error(
        "`new Request({ send, deliver, chain })` needs `send`: the request, made at run time, answering the key its continuation is parked under",
      );
    }
    this._send = spec.send;
    this._deliver = spec.deliver;
    this._chain = spec.chain;
    // 1 after the request, 2 after `then`, 3 after `catch`.
    this._stage = 1;
  }

  // The body: compiled as a program for the chain the callback lands on, run there when it does.
  then(body) {
    if (this._stage > 1) {
      throw new Error(
        "`.then(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (body === undefined) {
      throw new Error("`.then(...)` takes the body: `.then((result) => { … })`");
    }
    this._body = body;
    this._stage = 2;
    return this;
  }

  // What runs in the body's place when the body reverts or the request failed, handed why.
  catch(handler) {
    if (this._stage < 2) {
      throw new Error("`.catch(...)` follows `.then(...)`: it handles the request's failure");
    }
    if (this._stage > 2) {
      throw new Error("`.catch(...)` is not a step after `.catch(...)`: nothing follows it");
    }
    this._handler = handler;
    this._stage = 3;
    return this;
  }

  toString() {
    if (this._stage == 1) {
      return "a request's one step is `.then((result) => { … })`, the body; or `await` it, and the body is what follows";
    }
    if (this._stage == 2) {
      return "after `.then(...)` its one step is `.catch(...)`";
    }
    return "after `.catch(...)` nothing follows it";
  }

  // The statement ends: compile the body, make the request, park the body under its key.
  [Symbol.dispose]() {
    if (this._stage == 1) {
      throw new Error(
        "a request has no body. Finish it with `.then((result) => { … })`, or `await` it and write the body after it: the code that runs when the callback arrives",
      );
    }
    const chain = this._chain === undefined ? chainId : this._chain;
    const continuation = program(this._run(), chain);
    const send = this._send;
    const key = send(continuation);
    if (key !== undefined) park(key, continuation.code.concat(continuation.args));
  }

  // What the continuation runs: the delivery into the body, or with a handler that in a `try`, the
  // handler in its place when the body reverts and when the request failed.
  _run() {
    const body = this._body;
    const handler = this._handler;
    const deliver =
      this._deliver === undefined ? (input, body, fail) => body(input) : this._deliver;
    if (handler === undefined) {
      return () => {
        deliver(received(), body, (reason) => {
          revert(reason);
        });
      };
    }
    return () => {
      try {
        deliver(received(), body, handler);
      } catch (e) {
        handler(e);
      }
    };
  }
}

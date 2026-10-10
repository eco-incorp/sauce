// @sauce/remote — EVM arm.
//
// The message-based way to run code on another chain. A Private Pot has the same address on every
// chain its owner minted it on, so a program on one of them can send a program to itself on
// another, over a bridge, and that Pot runs it when the bridge delivers it. Unlike a hop, nothing
// moves with it, and the program runs as the owner's own Pot rather than one every intent shares,
// so its storage and balances persist between messages.
//
//   Base.remote(() => {
//     return USDC.balanceOf(self); // runs on Base, as this same Pot
//   }).then((result) => {
//     const [balance] = abi.decode(result, ["Uint256"]); // back here, with what the body returned
//   });
//
// `Base.remote` is a method of the chain's name, which the SDK writes for each program from the
// chain it is compiled for, knowing both chains' bridges: each one's contract on each side and the
// id it names each chain by. It returns a `Remote`, whose steps only record what they are given; the
// compiler runs all of it while it compiles, and when the statement ends it runs
// `[Symbol.dispose]()`, which compiles what runs there as a program for the destination and leaves
// the program the run-time work: pricing the message with the bridge and sending it.
//
// A MESSAGE is `abi.encode(0, program, input)`, a whole program and what it is handed, or
// `abi.encode(1, key, stored, program, value, ok)`, an answer. The receiving Pot's handler for the
// bridge (`Receive`, which the Pot's owner installs once per chain with `sauce run @sauce/remote`)
// checks its caller is the bridge's contract on that chain and the message's sender on its origin
// is this same Pot, then runs the program in its own cook with `@sauce/async`'s `run`, or settles
// the promise the answer names with `settleCarried`, once. Nothing else is trusted.
//
// A ONE-WAY message is the body alone. A body that reverts reverts the delivery, which the bridge
// can retry.
//
// A ROUND TRIP is a promise: `@sauce/async`'s `Request` with `carries: true`, composed while
// compiling. Its continuation, the `.then` and the `.catch` compiled for this chain, travels in the
// message as the input of a program that runs the body there in a frame of its own, caught, and
// sends back over the same bridge the answer: what the body returned, fulfilling the promise, or
// what it reverted with, rejecting it, everything the body did undone. A plain round trip stores
// nothing on either Pot; a deadline or a combinator keeps the promise in this Pot's table, and the
// answer only names it. Each leg is paid on the chain it leaves: this Pot pays the way there, the
// destination's Pot the way back, and each Pot the Kitchen's fee for every message it runs.
//
// The calls are written out, selector and arguments, as each bridge's ABI encodes them; the reads
// are typed calls through the ABIs beside this file, which the SDK holds to its registry's evidenced
// ABIs: Hyperlane's `dispatch(uint32,bytes32,bytes,bytes)`, LayerZero's
// `send((uint32,bytes32,bytes,bytes,bool),address)`, the MetalayerRouter's
// `dispatch(uint32,bytes32,(uint32,address,bytes)[],bytes,uint8,uint256)`, and for Polymer a log.
import { Request, requireCaller, requireSelf, run, settleCarried } from "@sauce/async";
import Mailbox from "./hyperlane-mailbox.abi.json";
import Endpoint from "./layerzero-endpoint.abi.json";
import MetalayerRouter from "./metalayer-router.abi.json";
import Prover from "./polymer-prover.abi.json";

// The log a Pot emits to send a message over Polymer, and the topic the receiving Pot checks:
// keccak256("RemoteMessage(uint256,bytes)"), the event `RemoteMessage(uint256 indexed chainId,
// bytes message)` — the chain whose Pot may run it, and the message.
const SAUCE_REMOTE_TOPIC = 0x14021f465312ca78398455623921447618a4b2f17c8c2c92c70c6b4702ba68b6;

// The ERC-7201 namespace a Pot that receives over Polymer keeps its delivered logs in:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Remote")) - 1)) & ~bytes32(uint256(0xff)).
// A log's slot is `keccak256(abi.encode(srcChain, blockNumber, receiptIndex, logIndex, namespace))`,
// its place as the proof proves it, holding 1 once the log has run.
const SAUCE_REMOTE_NAMESPACE = 0x1525874021e6c09cdc55221a93ef44a332285f3245b5be9206bc84993cc94100;

// The transient-storage slot (EIP-1153) where the far side of a round trip keeps what the body
// returned, past the frame it ran in: keccak256("sauce.remote.out"), its length, and its words after.
const SAUCE_REMOTE_OUT = 0x060f47f4cf8915d03a5bd9eecaa2f85d38b0536343fffc5d1adbc0a0ea1c1710;

// The gas the destination's handler is given when a message names none: the Router's dispatch, the
// Kitchen's cook, the handler's checks, and the program it runs.
const SAUCE_REMOTE_GAS = 500000;

// The chain a program runs on, as every message it sends or receives sees it: its chain id, its name,
// and its bridges, each one's contract here and the id it names this chain by. A bridge this chain
// lacks is left unset.
//
//   hyperlane  { mailbox, domain }
//   metalayer  { router, domain }
//   layerzero  { endpoint, eid }
//   polymer    { prover }
export class Link {
  constructor(fields) {
    this.fields = fields;
  }
}

// One message to this same Pot on `there`, as the chain the program runs on (`here`) sends it, with
// what `options` gives:
//
//   via       the bridge: "hyperlane", "layerzero", "metalayer" or "polymer". Left out, the first
//             of those both chains have: the bridges that relay on their own before Polymer, whose
//             proof someone must submit
//   gas       the gas the destination's handler is given (a relayed bridge prices the message by
//             it; whoever submits a Polymer proof gives it their own)
//   replyGas  the same for the way back, after a `.then` or a `.catch`
//
// The SDK makes one from each chain's `remote(body, options)`.
interface RemoteOptions {
  via?: string;
  gas?: Uint256;
  replyGas?: Uint256;
}

export class Remote {
  constructor(there, here, body, options?: RemoteOptions) {
    if (body === undefined) {
      throw new Error(
        "`remote(...)` takes the body, the code that runs there: `remote(() => { … })`",
      );
    }
    if (options !== undefined) {
      for (const key of Object.keys(options)) {
        if (key != "via" && key != "gas" && key != "replyGas") {
          throw new Error("`remote` takes no `" + key + "`: its options are via, gas and replyGas");
        }
      }
    }
    this._there = there.fields;
    this._here = here.fields;
    this._body = body;
    this._bridge = options === undefined ? undefined : options.via;
    this._gas = options === undefined ? undefined : options.gas;
    this._replyGas = options === undefined ? undefined : options.replyGas;
    // 1 after `remote`, 2 after `then`, 3 after `catch`.
    this._stage = 1;
  }

  // What runs back here with what the body returned: the bytes its program answered.
  then(continuation) {
    if (this._stage > 1) {
      throw new Error("`.then(...)` follows `remote(...)` once, and before `.catch(...)`");
    }
    if (continuation === undefined) {
      throw new Error("`.then(...)` takes what runs back here: `.then((result) => { … })`");
    }
    this._then = continuation;
    this._stage = 2;
    return this;
  }

  // What runs back here, with what the body reverted with (at most its first 256 bytes), when it
  // reverts there; and here, in place of the `.then`, when that reverts.
  catch(handler) {
    if (this._stage > 2) {
      throw new Error("`.catch(...)` is not a step after `.catch(...)`: nothing follows it");
    }
    if (handler === undefined) {
      throw new Error("`.catch(...)` takes what runs back here: `.catch((e) => { … })`");
    }
    this._catch = handler;
    this._stage = 3;
    return this;
  }

  toString() {
    if (this._stage == 1) {
      return "after `remote(() => { … })` its steps are `.then((result) => { … })`, what runs back here, and `.catch((e) => { … })`";
    }
    if (this._stage == 2) {
      return "after `.then(...)` its one step is `.catch(...)`";
    }
    return "after `.catch(...)` nothing follows it";
  }

  // A deadline `seconds` from when the message is sent: after it, anyone may `expire` the promise
  // here, rejecting it with `Timeout(bytes32)`, and an answer that comes later is ignored.
  within(seconds) {
    if (seconds === undefined) {
      throw new Error("`.within(...)` takes the seconds the answer has: `.within(3600)`");
    }
    this._deadline = ctx.timestamp() + seconds;
    return this;
  }

  // The statement ends: compile what runs there and send it. The bridge is passed as an argument
  // rather than held by a `const`: a string a `const` holds is a run-time value, and the bridge must
  // be one the compiler knows, so that only its calls are compiled.
  [Symbol.dispose]() {
    if (this._then === undefined && this._catch === undefined) {
      if (this._deadline !== undefined) {
        throw new Error(
          "`.within(...)` bounds the answer, and a remote message with no `.then` or `.catch` has none",
        );
      }
      this._oneWay(this._via());
    } else if (this._catch === undefined) {
      this._roundTrip(this._via());
    } else {
      this._roundTripCaught(this._via());
    }
  }

  // As a combinator's child (`Promise.all([Base.remote(…), Optimism.remote(…)])`): a round trip whose
  // answer settles the child the combinator counts.
  _join(joinKey, index, settles) {
    new Request(this._spec(this._via()))._join(joinKey, index, settles);
  }

  // How a combinator hands on what this message answered: the bytes the body returned.
  _decoder() {
    return (input, next, fail) => next(input);
  }

  // The bridge: the one the options name, which both chains must have, or the first both have.
  _via() {
    const here = this._here;
    const there = this._there;
    if (this._bridge !== undefined) {
      if (Bridge.has(here, this._bridge) && Bridge.has(there, this._bridge)) {
        return this._bridge;
      }
      throw new Error(
        "`via: " +
          this._bridge +
          "` needs " +
          this._bridge +
          " on both chains, and " +
          (Bridge.has(here, this._bridge) ? there.name : here.name) +
          " has none: name a bridge both have (hyperlane, layerzero, metalayer, polymer)",
      );
    }
    if (Bridge.has(here, "hyperlane") && Bridge.has(there, "hyperlane")) return "hyperlane";
    if (Bridge.has(here, "layerzero") && Bridge.has(there, "layerzero")) return "layerzero";
    if (Bridge.has(here, "metalayer") && Bridge.has(there, "metalayer")) return "metalayer";
    if (Bridge.has(here, "polymer") && Bridge.has(there, "polymer")) return "polymer";
    throw new Error(
      "no bridge joins " +
        here.name +
        " and " +
        there.name +
        ": a remote message needs Hyperlane, LayerZero, Metalayer or Polymer on both",
    );
  }

  _gas() {
    return this._gas === undefined ? SAUCE_REMOTE_GAS : this._gas;
  }

  _replyGas() {
    return this._replyGas === undefined ? SAUCE_REMOTE_GAS : this._replyGas;
  }

  // The body alone, handed nothing. A body that reverts reverts the delivery, which the bridge can
  // retry.
  _oneWay(via) {
    Bridge.send(
      this._here,
      this._there,
      via,
      Message.run(Reply.compiled(this._body, this._there.chainId), hex``),
      this._gas(),
    );
  }

  // The body, and the `.then` back here with what it returned.
  _roundTrip(via) {
    const request = new Request(this._spec(via));
    request.then(this._then);
  }

  // The body, and back here the `.then` with what it returned or the `.catch` with why it was
  // rejected: the body's revert there, the `.then`'s here, or a deadline past.
  _roundTripCaught(via) {
    const request = new Request(this._spec(via));
    request.then(this._continuation()).catch(this._catch);
  }

  // A `.catch` with no `.then`: nothing more runs back here when the body returns.
  _continuation() {
    if (this._then !== undefined) return this._then;
    return () => {};
  }

  // The promise a round trip is, carried: `@sauce/async` compiles its continuation for this chain
  // and picks its key, and `send` sends the program that runs the body there, handed the
  // continuation to carry back, or, when the table here holds the promise (a deadline, a
  // combinator), only its key.
  _spec(via) {
    const here = this._here;
    const there = this._there;
    const gas = this._gas();
    const remote = this;
    return {
      carries: true,
      chain: here.chainId,
      deadline: this._deadline,
      send: (continuation) => {
        const reply = program(remote._reply(via, continuation.key, continuation.stored), {
          continuation: there.chainId,
        });
        Bridge.send(
          here,
          there,
          via,
          Message.run(
            reply.code.concat(reply.args),
            continuation.stored ? hex`` : continuation.program,
          ),
          gas,
        );
      },
    };
  }

  // What runs there on a round trip: the body, then the answer sent back over the same bridge to
  // settle the promise `key`, with what it was handed, its parameter `back` (the continuation,
  // unless the table holds the promise; `run` appends it with its mode). The flag form: the body runs in a frame of its own, caught at that one call, its
  // answer kept in transient storage, and the answer is sent after the call either way — what the
  // body returned, fulfilling the promise, or what it reverted with, rejecting it, everything the
  // body did undone.
  _reply(via, key, stored) {
    const body = this._body;
    const here = this._here;
    const there = this._there;
    const gas = this._replyGas();
    return (back: bytes, mode: Uint256) => {
      let ok = 1;
      let value = hex``;
      evm
        .delegate(
          Reply.engine(),
          Reply.compiled(() => {
            Reply.keep(run(Reply.compiled(body, there.chainId), hex``));
          }, there.chainId),
        )
        .catch((e) => {
          ok = 0;
          value = e;
        });
      if (ok == 1) {
        value = Reply.kept();
      }
      Bridge.send(there, here, via, Message.settle(key, stored, back, value, ok), gas);
    };
  }
}

// A message: the program a Pot runs where it arrives and what it is handed, or the answer that
// settles a promise there. The first word says which.
class Message {
  // `abi.encode(0, program, input)`: run `program`, handed `input`.
  static run(code, input) {
    return abi.encode(0, code, input);
  }

  // `abi.encode(1, key, stored, program, value, ok)`: settle the promise `key`, fulfilled (`ok` 1)
  // with `value` or rejected (0) with it, running `program` when no table holds it.
  static settle(key, stored, code, value, ok) {
    return abi.encode(1, key, stored ? 1 : 0, code, value, ok);
  }
}

// The way back from the destination, compiled into the program the destination runs.
class Reply {
  // `body` as a program for `chainId`, with its arguments.
  static compiled(body, chainId) {
    const compiled = program(body, { continuation: chainId });
    return compiled.code.concat(compiled.args);
  }

  // The engine the Pot's cook in flight runs: `inFlightEngine()`.
  static engine() {
    const [engine] = abi.decode(evm.static(ctx.self(), hex`9fd004e1`), ["Address"]);
    return engine;
  }

  // Keep `out` in transient storage, its length and its words, past the frame that made it.
  static keep(out) {
    const length = out.length;
    evm.tstore(SAUCE_REMOTE_OUT, length);
    const padded = out.concat(hex`00000000000000000000000000000000000000000000000000000000000000`);
    for (let i = 0; i * 32 < length; i += 1) {
      const [w] = abi.decode(padded.slice(i * 32, i * 32 + 32), ["Uint256"]);
      evm.tstore(SAUCE_REMOTE_OUT + 1 + i, w);
    }
  }

  // What `keep` kept.
  static kept() {
    const length = evm.tload(SAUCE_REMOTE_OUT);
    let out = hex``;
    for (let i = 0; i * 32 < length; i += 1) {
      out = out.concat(evm.tload(SAUCE_REMOTE_OUT + 1 + i).toBytesBe(32));
    }
    return out.slice(0, length);
  }
}

// One bridge's half of a message, as the chain it leaves sends it.
class Bridge {
  static has(chain, name) {
    return chain[name] !== undefined;
  }

  // Hyperlane's standard hook metadata (`StandardHookMetadata.formatMetadata`, variant 1): the value
  // sent with the message (32 bytes), the gas the destination call is given (32 bytes) and who is
  // refunded what the gas payment overpays (20 bytes).
  static metadata(value, gas, refund) {
    return hex`0001`.concat(abi.encode(value, gas)).concat(refund.toBytesBe(20));
  }

  // Price `message` to this same Pot on `to`, from `from`, and send it, paying the bridge from this
  // Pot's balance.
  static send(from, to, via, message, gas) {
    const self = ctx.self();
    if (via == "hyperlane") {
      const metadata = Bridge.metadata(0, gas, self);
      const fee = Mailbox.at(from.hyperlane.mailbox).quoteDispatch(
        to.hyperlane.domain,
        self,
        message,
        metadata,
      );
      // dispatch(uint32,bytes32,bytes,bytes)
      evm.call(
        from.hyperlane.mailbox,
        fee,
        hex`48aee8d4`.concat(abi.encode(to.hyperlane.domain, self, message, metadata)),
      );
    } else if (via == "layerzero") {
      // Options of type 3: one executor option, `lzReceive`, with the gas it is given (16 bytes).
      const options = hex`000301001101`.concat(gas.toBytesBe(16));
      const params = {
        dstEid: to.layerzero.eid,
        receiver: self,
        message,
        options,
        payInLzToken: false,
      };
      const quoted = Endpoint.at(from.layerzero.endpoint).quote(params, self);
      // send((uint32,bytes32,bytes,bytes,bool),address), refunding this Pot what it overpays
      evm.call(
        from.layerzero.endpoint,
        quoted.nativeFee,
        hex`2637a450`.concat(abi.encode(params, self)),
      );
    } else if (via == "metalayer") {
      // Quoted as eco-routes' MetaProver quotes it: the router builds its own metadata from the
      // value it is sent, so the quote's names a value too large to fall short.
      const fee = MetalayerRouter.at(from.metalayer.router).quoteDispatch(
        to.metalayer.domain,
        self,
        message,
        Bridge.metadata(10 ** 36, gas, self),
      );
      // dispatch(uint32,bytes32,(uint32,address,bytes)[],bytes,uint8,uint256), with no reads and
      // instant finality
      evm.call(
        from.metalayer.router,
        fee,
        hex`e8dd7ad7`.concat(abi.encode(to.metalayer.domain, self, new Array(0), message, 0, gas)),
      );
    } else {
      log(abi.encode(message), SAUCE_REMOTE_TOPIC, to.chainId);
    }
  }
}

// The handlers a Pot answers each bridge with (the package's `*.handler.js`, one per selector): each
// checks the call came from the bridge's contract on this chain and that the message's sender on its
// origin is this same Pot, then runs the message's program in this cook, handed its input. `caller`
// and `data` are the handler's own arguments: who called the Pot, and the whole calldata, selector
// included.
export class Receive {
  // handle(uint32 origin, bytes32 sender, bytes message), from the Mailbox.
  static hyperlane(mailbox, caller, data) {
    requireCaller(mailbox, caller);
    const [origin, sender, message] = abi.decode(data.slice(4, data.length), [
      "Uint256",
      "Uint256",
      "bytes",
    ]);
    requireSelf(sender);
    Receive.run(message);
  }

  // handle(uint32 origin, bytes32 sender, bytes message, ReadOperation[] reads, bytes[] results),
  // from the MetalayerRouter.
  static metalayer(router, caller, data) {
    requireCaller(router, caller);
    const [origin, sender, message] = abi.decode(data.slice(4, data.length), [
      "Uint256",
      "Uint256",
      "bytes",
    ]);
    requireSelf(sender);
    Receive.run(message);
  }

  // lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, bytes32 guid, bytes message,
  // address executor, bytes extraData), from the EndpointV2.
  static layerzero(endpoint, caller, data) {
    requireCaller(endpoint, caller);
    const [srcEid, sender, nonce, guid, message] = abi.decode(data.slice(4, data.length), [
      "Uint256",
      "Uint256",
      "Uint256",
      "Uint256",
      "bytes",
    ]);
    requireSelf(sender);
    Receive.run(message);
  }

  // allowInitializePath((uint32 srcEid, bytes32 sender, uint64 nonce) origin), read-only: the
  // endpoint opens a path to this Pot only from this same Pot.
  static allowInitializePath(data) {
    const [srcEid, sender, nonce] = abi.decode(data.slice(4, data.length), [
      "Uint256",
      "Uint256",
      "Uint256",
    ]);
    return sender == ctx.self();
  }

  // deliver(bytes proof), from anyone: a proof of the log this same Pot emitted on another chain
  // for this one. Each log runs once.
  static polymer(prover, data) {
    const [proof] = abi.decode(data.slice(4, data.length), ["bytes"]);
    const [chainId, emitter, topics, logData] = Prover.at(prover).validateEvent(proof);
    requireSelf(emitter);
    require(topics.length == 64, "remote: not a remote message");
    require(topics.slice(0, 32).toBe() == SAUCE_REMOTE_TOPIC, "remote: not a remote message");
    require(topics.slice(32, 64).toBe() == ctx.chainId(), "remote: not for this chain");
    const [srcChain, blockNumber, receiptIndex, logIndex] =
      Prover.at(prover).inspectLogIdentifier(proof);
    const key = crypto.keccak256(
      abi.encode(srcChain, blockNumber, receiptIndex, logIndex, SAUCE_REMOTE_NAMESPACE),
    );
    require(evm.sload(key) == 0, "remote: proof already delivered");
    evm.sstore(key, 1);
    const [message] = abi.decode(logData, ["bytes"]);
    Receive.run(message);
  }

  // A message this same Pot sent: run its program, writable, as this Pot, in the cook the handler
  // runs in, handed its input; or settle the promise its answer names, once.
  static run(message) {
    if (message.slice(0, 32).toBe() == 0) {
      const [kind, code, input] = abi.decode(message, ["Uint256", "bytes", "bytes"]);
      run(code, input);
    } else {
      const [kind, key, stored, code, value, ok] = abi.decode(message, [
        "Uint256",
        "Uint256",
        "Uint256",
        "bytes",
        "bytes",
        "Uint256",
      ]);
      settleCarried(key, stored == 1, code, value, ok == 1);
    }
  }
}

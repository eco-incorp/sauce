// @sauce/hop — EVM arm.
//
// The intent-based way to move money to another chain. A hop is an Eco intent a program opens: the
// source escrows what it sends, a solver delivers what it asks for on the destination, and its body
// runs there on the destination's Shared Pot. That Pot is public, the one every hop to the chain
// cooks on, so nothing persists on it between transactions: a body keeps no state, and moves what
// it receives on within its own transaction.
//
//   Arbitrum.hop({
//     send: { token: USDC, amount },
//     receive: { token: USDC, amount: delivered },
//     refundee: owner,
//   }).then(() => {
//     USDC.transfer(recipient, delivered); // runs on Arbitrum
//   });
//
// `Arbitrum.hop` is a method of the chain's name in the SDK's module for the chain the program is
// compiled for, which knows that pair of chains: both Portals, the prover, the destination's Shared
// Pot, its engine and its Kitchen fee, and its tokens by symbol. It returns an `Intent`, whose steps
// only record what they are given. The compiler runs all of it while it compiles, and when the
// statement ends it runs `[Symbol.dispose]()`, which builds the intent as one literal, the body
// compiled as a program for the destination, and leaves the program only the run-time work: reading
// the vault, paying the reward into it, and publishing.
//
// Every intent a program opens takes Eco's defaults for what it leaves out, as Eco's solver quotes
// an intent and its Portal app publishes one: the route's deadline 300 seconds after the intent
// opens, the reward's seven days after that (the floor the solver holds a reward deadline to), the
// registry's prover, and the destination's Kitchen fee. The refundee has no default: the Pot a
// program runs on may be shared, so a refund there could go to anyone.
//
// The calls are written out, selector and arguments, as the Portal's ABI encodes them:
// `publish(uint64,bytes,(uint64,address,address,uint256,(address,uint256)[]))` and
// `publishAndFund(…,bool)` send the intent, `intentVaultAddress(…)` reads its vault, a route call
// moves a delivered token with ERC-20's `transfer(address,uint256)` and cooks the body with the Pot's
// `cook(address,bytes)`. The SDK's intent suites execute each of them against eco-routes' own Portal.
import { Token } from "@sauce/names";
import { approve, transfer } from "@sauce/token";

// The transient-storage slot (EIP-1153) counting the intents a transaction has opened:
// keccak256("sauce.intents.nonce"). Transient, so it starts at zero in every transaction and
// survives a `try` block, which runs as a program of its own.
const SAUCE_INTENTS_NONCE = 0x91da66d2ed07997bae5bcd0c9e8b6e7824eb17d69e494553b5ad7ec46532b578;

// What a hop's `send` or `receive` lists, recorded as it is given, and what a list of them becomes.
class Items {
  constructor() {
    this.list = Lists.empty();
  }
  add(item) {
    this.list.push(item);
  }
  // The list as a run-time value: an empty one has no element to type it by.
  value() {
    return this.list.length == 0 ? new Array(0) : this.list;
  }
}

// An empty list that grows while compiling.
class Lists {
  static empty(...none) {
    return none;
  }
}

// One token the reward funds: each distinct token once, for the largest amount the reward lists of
// it, which is the balance the Portal checks each of its entries against.
class Funds {
  constructor() {
    this.list = Lists.empty();
  }
  add(token, amount) {
    const seen = new Seen();
    for (const fund of this.list) {
      if (fund.token == token) seen.at(fund);
    }
    if (seen.fund === undefined) {
      this.list.push(new Fund(token, amount));
    } else {
      seen.fund.amount = amount > seen.fund.amount ? amount : seen.fund.amount;
    }
  }
}

class Fund {
  constructor(token, amount) {
    this.token = token;
    this.amount = amount;
  }
}

class Seen {
  at(fund) {
    this.fund = fund;
  }
}

// The chain a program runs on, as every intent it opens sees it: its Portal, and the defaults its
// compile gives what an intent leaves out — the route's salt, the deadlines or the time the intents
// open, the wallet publishing them, how the reward is funded.
export class Level {
  constructor(fields) {
    this.fields = fields;
  }
}

// One hop: an Eco intent a program opens, whose body runs on `destination`, as the chain the program
// runs on (`level`) sees it — that chain's Portal, the prover, its shared Pot and engine, its Kitchen
// fee, its tokens by symbol — with what `config` gives:
//
//   send            what leaves this chain: escrowed here, it pays the solver (the Portal's reward):
//                   `{ token, amount }`, `{ native: amount }`, or a list of them
//   receive         what the solver delivers there, for the body: `{ token, amount }` or a list
//   refundee        who may reclaim what was sent, unearned (the reward's `creator`); required
//   deadline        the last second the intent may be filled
//   rewardDeadline  from when what was sent, if no fill is proven, may be refunded
//   prover          the prover on this chain
//   salt            the route's salt, used as written
//   fee             the destination Kitchen's fee the body's cook pays, in wei
//   before, after   calls the destination Portal's Executor makes before the delivered tokens
//                   move into the Pot, and after the body: a closure, or a list of closures, each
//                   one external call, made exactly as written
//
// The SDK's module for the chain makes one from each chain's `hop(config)`.
export class Intent {
  constructor(destination, level, config) {
    if (config === undefined || config.length !== undefined) {
      throw new Error(
        "`hop(...)` takes one object: `hop({ send: { token, amount }, receive: { token, amount }, refundee })`",
      );
    }
    // A field the hop does not take is a mistake, said by its name, as the editor's declarations say
    // it (`routes/intent-syntax.ts#HOP_FIELDS`, which the SDK's tests hold to this list).
    const fields = {
      send: true,
      receive: true,
      refundee: true,
      deadline: true,
      rewardDeadline: true,
      prover: true,
      salt: true,
      fee: true,
      before: true,
      after: true,
    };
    // A field under its former name says what it is called now.
    const renamed = { reward: "what the source sends is `send`" };
    for (const key of Object.keys(config)) {
      if (renamed[key] !== undefined) {
        throw new Error("a hop takes no `" + key + "`: " + renamed[key]);
      }
      if (fields[key] === undefined) {
        throw new Error(
          "a hop takes no `" +
            key +
            "`: its fields are send, receive, refundee, deadline, rewardDeadline, prover, salt, fee, before and after",
        );
      }
    }
    this._destination = destination;
    this._here = level.fields;
    this._config = config;
    // 1 after `hop`, 2 after `then`, 3 after `catch`.
    this._stage = 1;
    // Raw route calls the Executor makes before the delivered tokens move into the Pot, and after
    // the cook, as written: the hooks' (`before`, `after`).
    this._before = Lists.empty();
    this._after = Lists.empty();
  }

  // The body: compiled as a program for the destination, run there on its shared Pot with what was
  // received.
  then(body) {
    if (this._stage > 1) {
      throw new Error(
        "`.then(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (body === undefined) {
      throw new Error("`.then(...)` takes the body: `.then(() => { … })`");
    }
    this._body = body;
    this._stage = 2;
    return this;
  }

  // What runs on the destination in the body's place when the body reverts.
  catch(handler) {
    if (this._stage < 2) {
      throw new Error("`.catch(...)` follows `.then(...)`: it handles the body's failure");
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
      return "after `hop({ … })` its one step is `.then(() => { … })`, the body";
    }
    if (this._stage == 2) {
      return "after `.then(...)` its one step is `.catch(...)`";
    }
    return "after `.catch(...)` nothing follows it";
  }

  // The statement ends: build the intent, pay its reward into its vault, publish it.
  [Symbol.dispose]() {
    if (this._stage == 1) {
      throw new Error(
        "`<Chain>.hop({ … })` has no body. Finish it with `.then(() => { … })`: the code that runs on its destination with what was received",
      );
    }
    const config = this._config;
    const creator = config.refundee;
    if (creator === undefined) {
      throw new Error(
        "a hop needs a `refundee`: the address an unfilled intent's reward is refunded to, and the only one that may redirect a refund. No default is safe: the Pot a program runs on may be shared, so a refund there is one anyone can take. Name the owner, or an address the program is given (`hop({ send, refundee: refundTo })`).",
      );
    }

    // What the hop sends: escrowed here, the Portal's reward.
    if (config.send === undefined) {
      throw new Error(
        "a hop needs a `send`: what leaves this chain to pay the solver, `{ token, amount }`, `{ native: amount }`, or a list of them",
      );
    }
    const rewardTokens = new Items();
    const funds = new Funds();
    const native = new Native();
    if (config.send.length !== undefined) {
      for (const item of config.send) this._rewardItem(item, rewardTokens, funds, native);
    } else {
      this._rewardItem(config.send, rewardTokens, funds, native);
    }
    if (rewardTokens.list.length == 0 && native.amount === undefined) {
      throw new Error(
        "a hop's `send` must offer something: a token amount, or `{ native: amount }`",
      );
    }
    const nativeAmount = native.amount === undefined ? 0 : native.amount;
    if (native.amount !== undefined && this._here.nativeToken !== undefined) {
      for (const fund of funds.list) {
        if (fund.token == this._here.nativeToken) throw new Error(this._here.nativeConflict);
      }
    }

    // The delivery, on the destination: the destination's token of each symbol.
    const deliveryTokens = new Items();
    if (config.receive !== undefined) {
      if (config.receive.length !== undefined) {
        for (const item of config.receive) this._deliveryToken(item, deliveryTokens);
      } else {
        this._deliveryToken(config.receive, deliveryTokens);
      }
    }

    // The body, a program for the destination, cooked on its shared Pot after the delivered tokens
    // are moved into it from the Executor they land on.
    const fee = config.fee === undefined ? this._destination.fee : config.fee;
    if (fee === undefined) {
      throw new Error(
        "the intent runs a program, so its cook must pay that chain's Kitchen fee — give the hop a `fee`, or set `intents.executionFee` (`destinationExecutionFee()` reads it)",
      );
    }
    const body = program(this._run(), this._destination.chainId);
    // The hooks: each closure's one call, read as data in the destination's scope — its target,
    // calldata and value, a value the program computes written in where the intent opens — and
    // made by the Executor exactly as written. Nothing is added for them: no delivery, no reset of
    // an allowance. What the Executor holds when one runs is the intent's to arrange.
    this._hooks("before", config.before, this._before);
    this._hooks("after", config.after, this._after);
    const calls = new Items();
    for (const call of this._before) calls.add(call);
    for (const delivered of deliveryTokens.list) {
      calls.add({
        target: delivered.token,
        data: hex`a9059cbb`.concat(abi.encode(this._destination.pot, delivered.amount)),
        value: 0,
      });
    }
    calls.add({
      target: this._destination.pot,
      data: hex`b38dbf14`.concat(abi.encode(this._destination.engine, body.code.concat(body.args))),
      value: fee,
    });
    for (const call of this._after) calls.add(call);

    // The deadlines: the route's 300 seconds after the intent opens — when the compile says, else
    // as the program runs — and the reward's seven days after the route's.
    const routeDeadline =
      config.deadline !== undefined
        ? config.deadline
        : this._here.deadline !== undefined
          ? this._here.deadline
          : this._here.openedAt !== undefined
            ? this._here.openedAt + 300
            : ctx.timestamp() + 300;
    const rewardDeadline =
      config.rewardDeadline !== undefined
        ? config.rewardDeadline
        : this._here.rewardDeadline !== undefined
          ? this._here.rewardDeadline
          : routeDeadline + 604800;

    const route = abi.encode({
      route: {
        salt: config.salt === undefined ? this._defaultSalt() : config.salt,
        deadline: routeDeadline,
        portal: this._destination.portal,
        nativeAmount: this._native(fee),
        tokens: deliveryTokens.value(),
        calls: calls.value(),
      },
    });
    const prover = config.prover === undefined ? this._destination.prover : config.prover;
    if (prover === undefined) throw new Error(this._destination.unproven);
    const reward = {
      deadline: rewardDeadline,
      creator,
      prover,
      nativeAmount,
      tokens: rewardTokens.value(),
    };

    if (this._here.fund == false) {
      // A rehearsal: the intent published, its reward not paid.
      evm.call(
        this._here.portal,
        0,
        hex`645c890c`.concat(abi.encode(this._destination.chainId, route, reward)),
      );
    } else if (this._here.fundVia == "publishAndFund") {
      // The Portal pulls the reward into the vault itself. `approve` resets a standing allowance
      // first: one Pot publishes every intent on a chain.
      for (const fund of funds.list) approve(fund.token, this._here.portal, fund.amount);
      const data = hex`df00f8fa`.concat(
        abi.encode(this._destination.chainId, route, reward, this._here.allowPartial),
      );
      evm.call(this._here.portal, nativeAmount, data);
    } else {
      // Pay the vault, then publish: the vault is read from the Portal over the very intent
      // published.
      const intent = abi.encode(this._destination.chainId, route, reward);
      const [vault] = abi.decode(evm.static(this._here.portal, hex`0742ebe4`.concat(intent)), [
        "Address",
      ]);
      for (const fund of funds.list) {
        if (fund.amount > 0) transfer(fund.token, vault, fund.amount);
      }
      if (nativeAmount > 0) evm.call(vault, nativeAmount, hex``);
      evm.call(this._here.portal, 0, hex`645c890c`.concat(intent));
    }
  }

  // What the destination runs: the body, or with a handler the body in a `try`, the handler in its
  // place when the body reverts, everything the body did undone, handed what the body reverted
  // with (a handler that names no parameter drops it, as JavaScript does).
  _run() {
    const body = this._body;
    const handler = this._handler;
    if (handler === undefined) return body;
    return () => {
      try {
        body();
      } catch (e) {
        handler(e);
      }
    };
  }

  // A hook's closure, or its list of closures, each the one call it makes, in the order written.
  _hooks(field, given, calls) {
    if (given === undefined) return;
    if (typeof given === "function") {
      calls.push(callOf(given, this._destination.chainId));
      return;
    }
    if (!Array.isArray(given)) {
      throw new Error(`\`${field}\` is a closure or a list of closures, each one external call`);
    }
    for (const hook of given) calls.push(callOf(hook, this._destination.chainId));
  }

  // The native the solver brings, which the Portal hands the Executor to pay the route's calls:
  // the body's cook its fee, and each hook what it sends.
  _native(fee) {
    // A hop with no hook is the program it was before hooks: its native is the fee.
    if (this._before.length == 0 && this._after.length == 0) return fee;
    let total = fee;
    for (const call of this._before) total = total + call.value;
    for (const call of this._after) total = total + call.value;
    return total;
  }

  // A salt the intent was not given: the compile's, mixed with how many intents this transaction
  // has opened, counting this one, so two intents built alike — twice in a program, or in a loop —
  // are two intents with two hashes. A salt given (`salt: x`) is used as written.
  _defaultSalt() {
    const opened = evm.tload(SAUCE_INTENTS_NONCE) + 1;
    evm.tstore(SAUCE_INTENTS_NONCE, opened);
    return crypto.keccak256(abi.encode(this._here.salt, opened));
  }

  _rewardItem(item, tokens, funds, native) {
    if (item.native !== undefined) {
      if (native.amount !== undefined) {
        throw new Error("a hop's `send` names its native amount once");
      }
      native.amount = item.native;
      return;
    }
    if (item.token === undefined || item.amount === undefined) {
      throw new Error("each item of a hop's `send` is `{ token, amount }` or `{ native: amount }`");
    }
    tokens.add({ token: item.token, amount: item.amount });
    funds.add(item.token, item.amount);
  }

  _deliveryToken(item, tokens) {
    if (item.native !== undefined) {
      throw new Error("a hop's `receive` names tokens: the native coin is paid in its `send`");
    }
    if (item.token === undefined || item.amount === undefined) {
      throw new Error("each item of a hop's `receive` is `{ token, amount }`");
    }
    // A name this chain does not declare (`USDT0`, where only the destination has it) is the
    // destination's token of that name.
    if (nameOf(item.token) !== undefined) {
      tokens.add({ token: globalIn(this._destination.chainId, item.token), amount: item.amount });
      return;
    }
    // An address, or a `Token(address)`, is used as written; a token the registry names is the
    // destination's token of its symbol.
    if (!(item.token instanceof Token) || item.token.symbol === undefined) {
      tokens.add({ token: item.token, amount: item.amount });
      return;
    }
    const token = this._destination.tokens[item.token.symbol];
    if (token === undefined) throw new Error(this._destination.missing);
    tokens.add({ token, amount: item.amount });
  }
}

class Native {}

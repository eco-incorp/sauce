// @sauce/intents — EVM arm.
//
// An Eco intent opened from inside a program:
//
//   Arbitrum.Portal.send({ token: USDC, amount })
//     .refundee(owner)
//     .receive({ token: USDC, amount: delivered })
//     .then(() => { USDC.transfer(recipient, delivered); });
//
// `Arbitrum.Portal` is a `Portal`, made by the SDK's module for the chain the program is compiled
// for, with what the SDK knows about that pair of chains: both Portals, the prover, the destination's
// shared Pot, its engine and its Kitchen fee, and its tokens by symbol. `send` returns an `Intent`,
// whose methods only record what they are given. The compiler runs all of it while it compiles, and
// when the statement ends it runs `[Symbol.dispose]()`, which builds the intent as one literal, the
// body compiled as a program for the destination, and leaves the program only the run-time work:
// reading the vault, paying the reward into it, and publishing.
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
// `cook(address,bytes)`. `test/std/intents/compile.test.ts` holds each selector to the registry's ABI.
import { approve, transfer } from "@sauce/token";

// What `.send(...)` lists, recorded as it is given, and what a list of them becomes.
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

// A chain's Portal, opening an intent whose body runs on `destination`: what the SDK knows of that
// chain as seen from `level` — its Portal, the prover, its shared Pot and engine, its Kitchen fee,
// its tokens by symbol.
export class Portal {
  constructor(destination, level) {
    this._destination = destination;
    this._here = level.fields;
  }
  // The reward: what the program pays the solver, escrowed on the chain it runs on. Each item an
  // argument, `{ token, amount }` or `{ native: amount }`, the tokens also as one list of them.
  send(...reward) {
    return new Intent(this._destination, this._here, reward);
  }
  toString() {
    return "a chain's `Portal` takes one step, `.send(...)`: the reward the solver earns";
  }
}

class Intent {
  constructor(destination, here, reward) {
    this._destination = destination;
    this._here = here;
    this._reward = reward;
    // 1 after `send`, 2 after `receive`, 3 after `then`, 4 after `catch`.
    this._stage = 1;
  }

  // Who may reclaim an unearned reward: the reward's `creator` on the Portal.
  refundee(address) {
    if (this._stage == 2) {
      throw new Error(
        "`.refundee(...)` is not a step after `.receive(...)`: its steps are `.deadline(...)`, `.salt(...)`, `.fee(...)` and `.then(...)`",
      );
    }
    if (this._stage > 2) {
      throw new Error(
        "`.refundee(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (this._refundee !== undefined) {
      throw new Error("`.refundee(...)` is given twice after `.send(...)`: give it once");
    }
    if (address === undefined) {
      throw new Error(
        "`.refundee(...)` takes the address an unfilled intent's reward is refunded to",
      );
    }
    this._refundee = address;
    return this;
  }

  // After `send`, from when an unproven reward may be refunded; after `receive`, the last second
  // the intent may be filled. Unix seconds.
  deadline(seconds) {
    if (seconds === undefined) {
      throw new Error("`.deadline(...)` takes the deadline, in Unix seconds");
    }
    if (this._stage == 1) {
      if (this._rewardDeadline !== undefined) {
        throw new Error("`.deadline(...)` is given twice after `.send(...)`: give it once");
      }
      this._rewardDeadline = seconds;
      return this;
    }
    if (this._stage > 2) {
      throw new Error(
        "`.deadline(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (this._routeDeadline !== undefined) {
      throw new Error("`.deadline(...)` is given twice after `.receive(...)`: give it once");
    }
    this._routeDeadline = seconds;
    return this;
  }

  // The source chain's prover.
  prover(address) {
    if (this._stage == 2) {
      throw new Error(
        "`.prover(...)` is not a step after `.receive(...)`: its steps are `.deadline(...)`, `.salt(...)`, `.fee(...)` and `.then(...)`",
      );
    }
    if (this._stage > 2) {
      throw new Error(
        "`.prover(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (this._prover !== undefined) {
      throw new Error("`.prover(...)` is given twice after `.send(...)`: give it once");
    }
    if (address === undefined) {
      throw new Error("`.prover(...)` takes the source chain's prover's address");
    }
    this._prover = address;
    return this;
  }

  // What the solver delivers on the destination, for the body to run with: each item an argument,
  // `{ token, amount }`, or one list of them. A token is the destination's of the same symbol.
  receive(...delivery) {
    if (this._stage == 2) {
      throw new Error(
        "`.receive(...)` is not a step after `.receive(...)`: its steps are `.deadline(...)`, `.salt(...)`, `.fee(...)` and `.then(...)`",
      );
    }
    if (this._stage > 2) {
      throw new Error(
        "`.receive(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    this._delivery = delivery;
    this._stage = 2;
    return this;
  }

  // The route's salt.
  salt(salt) {
    if (this._stage == 1) {
      throw new Error(
        "`.salt(...)` is not a step after `.send(...)`: its steps are `.refundee(...)`, `.deadline(...)`, `.prover(...)` and `.receive(...)`",
      );
    }
    if (this._stage > 2) {
      throw new Error(
        "`.salt(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (this._salt !== undefined) {
      throw new Error("`.salt(...)` is given twice after `.receive(...)`: give it once");
    }
    if (salt === undefined) {
      throw new Error("`.salt(...)` takes the route's salt");
    }
    this._salt = salt;
    return this;
  }

  // The destination Kitchen's fee the body's cook pays, in wei.
  fee(wei) {
    if (this._stage == 1) {
      throw new Error(
        "`.fee(...)` is not a step after `.send(...)`: its steps are `.refundee(...)`, `.deadline(...)`, `.prover(...)` and `.receive(...)`",
      );
    }
    if (this._stage > 2) {
      throw new Error(
        "`.fee(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (this._fee !== undefined) {
      throw new Error("`.fee(...)` is given twice after `.receive(...)`: give it once");
    }
    if (wei === undefined) {
      throw new Error("`.fee(...)` takes the destination Kitchen's fee, in wei");
    }
    this._fee = wei;
    return this;
  }

  // The body: compiled as a program for the destination, run there on its shared Pot with what was
  // received.
  then(body) {
    if (this._stage == 1) {
      throw new Error(
        "`<Chain>.Portal.send(...)` stops before `.receive(...)`, which every intent has: what the solver delivers on its destination, `.receive({ token, amount })`, or `.receive()` for nothing, then the body that runs there with it, `.then(() => { … })`",
      );
    }
    if (this._stage > 2) {
      throw new Error(
        "`.then(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    if (body === undefined) {
      throw new Error("`.then(...)` takes the body: `.then(() => { … })`");
    }
    this._body = body;
    this._stage = 3;
    return this;
  }

  // What runs on the destination in the body's place when the body reverts.
  catch(handler) {
    if (this._stage < 3) {
      throw new Error("`.catch(...)` follows `.then(...)`: it handles the body's failure");
    }
    if (this._stage > 3) {
      throw new Error("`.catch(...)` is not a step after `.catch(...)`: nothing follows it");
    }
    this._handler = handler;
    this._stage = 4;
    return this;
  }

  toString() {
    if (this._stage == 1) {
      return "after `.send(...)` its steps are `.refundee(...)`, `.deadline(...)`, `.prover(...)` and `.receive(...)`";
    }
    if (this._stage == 2) {
      return "after `.receive(...)` its steps are `.deadline(...)`, `.salt(...)`, `.fee(...)` and `.then(...)`";
    }
    if (this._stage == 3) {
      return "after `.then(...)` its one step is `.catch(...)`";
    }
    return "after `.catch(...)` nothing follows it";
  }

  // The statement ends: build the intent, pay its reward into its vault, publish it.
  [Symbol.dispose]() {
    if (this._stage == 1) {
      throw new Error(
        "`<Chain>.Portal.send(...)` stops before `.receive(...)`, which every intent has: what the solver delivers on its destination, `.receive({ token, amount })`, or `.receive()` for nothing, then the body that runs there with it, `.then(() => { … })`",
      );
    }
    if (this._stage == 2) {
      throw new Error(
        "`<Chain>.Portal.send(...).receive(...)` has no body. Finish it with `.then(() => { … })`: the code that runs on its destination with what was received",
      );
    }
    if (this._handler !== undefined) {
      throw new Error(
        "`.catch(...)` needs a compiler that compiles `try`, which this one does not: leave the handler out",
      );
    }
    const creator = this._refundee;
    if (creator === undefined) {
      throw new Error(
        "an intent needs `.refundee(<address>)` after `.send(...)`: the address an unfilled intent's reward is refunded to, and the only one that may redirect a refund. No default is safe: the Pot a program runs on may be shared, so a refund there is one anyone can take. Name the owner, or an address the program is given (`.refundee(refundTo)`).",
      );
    }

    // The reward, escrowed here.
    const rewardTokens = new Items();
    const funds = new Funds();
    const native = new Native();
    for (const item of this._reward) {
      if (item.length !== undefined) {
        for (const listed of item) this._rewardItem(listed, rewardTokens, funds, native);
      } else {
        this._rewardItem(item, rewardTokens, funds, native);
      }
    }
    if (rewardTokens.list.length == 0 && native.amount === undefined) {
      throw new Error("`.send(...)` must offer something: a token amount, or `{ native: amount }`");
    }
    const nativeAmount = native.amount === undefined ? 0 : native.amount;
    if (native.amount !== undefined && this._here.nativeToken !== undefined) {
      for (const fund of funds.list) {
        if (fund.token == this._here.nativeToken) throw new Error(this._here.nativeConflict);
      }
    }

    // The delivery, on the destination: the destination's token of each symbol.
    const deliveryTokens = new Items();
    for (const item of this._delivery) {
      if (item.length !== undefined) {
        for (const listed of item) this._deliveryToken(listed, deliveryTokens);
      } else {
        this._deliveryToken(item, deliveryTokens);
      }
    }

    // The body, a program for the destination, cooked on its shared Pot after the delivered tokens
    // are moved into it from the Executor they land on.
    const fee = this._fee === undefined ? this._destination.fee : this._fee;
    if (fee === undefined) {
      throw new Error(
        "the intent runs a program, so its cook must pay that chain's Kitchen fee — give it `.fee(...)` after `.receive(...)`, or set `intents.executionFee` (`destinationExecutionFee()` reads it)",
      );
    }
    const body = program(this._body, this._destination.chainId);
    const calls = new Items();
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

    // The deadlines: the route's 300 seconds after the intent opens — when the compile says, else
    // as the program runs — and the reward's seven days after the route's.
    const routeDeadline =
      this._routeDeadline !== undefined
        ? this._routeDeadline
        : this._here.deadline !== undefined
          ? this._here.deadline
          : this._here.openedAt !== undefined
            ? this._here.openedAt + 300
            : ctx.timestamp() + 300;
    const rewardDeadline =
      this._rewardDeadline !== undefined
        ? this._rewardDeadline
        : this._here.rewardDeadline !== undefined
          ? this._here.rewardDeadline
          : routeDeadline + 604800;

    const route = abi.encode({
      route: {
        salt: this._salt === undefined ? this._here.salt : this._salt,
        deadline: routeDeadline,
        portal: this._destination.portal,
        nativeAmount: fee,
        tokens: deliveryTokens.value(),
        calls: calls.value(),
      },
    });
    const prover = this._prover === undefined ? this._destination.prover : this._prover;
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

  _rewardItem(item, tokens, funds, native) {
    if (item.native !== undefined) {
      if (native.amount !== undefined) {
        throw new Error("`.send(...)` names its native amount once");
      }
      native.amount = item.native;
      return;
    }
    if (item.token === undefined || item.amount === undefined) {
      throw new Error(
        "each item `.send(...)` takes is `{ token, amount }`, `{ native: amount }`, or a list of token amounts",
      );
    }
    tokens.add({ token: item.token, amount: item.amount });
    funds.add(item.token, item.amount);
  }

  _deliveryToken(item, tokens) {
    if (item.native !== undefined) {
      throw new Error("`.receive(...)` names tokens: the native coin is paid with `.send(...)`");
    }
    if (item.token === undefined || item.amount === undefined) {
      throw new Error(
        "each item `.receive(...)` takes is `{ token, amount }`, or a list of token amounts",
      );
    }
    if (item.token.symbol === undefined) {
      tokens.add({ token: item.token, amount: item.amount });
      return;
    }
    const token = this._destination.tokens[item.token.symbol];
    if (token === undefined) throw new Error(this._destination.missing);
    tokens.add({ token, amount: item.amount });
  }
}

class Native {}

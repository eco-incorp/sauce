// @sauce/random — EVM arm.
//
// Verifiable randomness, delivered to a `.then`. A program asks for it, pays for it, and writes in
// place what to do with it; the body runs on the same Private Pot when the provider calls back:
//
//   import { Random } from "@sauce/random";
//
//   function main(heads: Address, tails: Address, prize: Uint256): void {
//     Random.vrf({ words: 1 }).then((words) => {
//       USDC.transfer(words[0] % 2 == 0 ? heads : tails, prize);
//     });
//   }
//
// Two providers, each a method of `Random`, on the chains the registry has them:
//
//   Random.vrf({ words, confirmations, gas, deadline })
//       Chainlink VRF v2.5 by direct funding: a request paid in the native coin through the chain's
//       VRFV2PlusWrapper (`ChainlinkVrf.Wrapper`); the body is handed the random words, a
//       `Uint256[]`.
//   Random.entropy({ provider, gas, deadline })
//       Pyth Entropy v2 (`PythEntropy.Entropy`); the body is handed one random 32-byte word.
//
// Each is a promise, `@sauce/async`'s `Request`: `.then`, `.catch`, `await`, `.within(seconds)`, and
// a child of `Promise.all`/`race`/`any`/`allSettled`, as `Promise.race([Random.vrf(), Async.timeout(3600)])`.
//
// THE REQUEST is made and paid from the Pot when the program runs, and the promise is parked under
// its key: VRF's request id under the wrapper's address, `promiseKey(wrapper, requestId)`; Entropy's
// provider and sequence number under the Entropy contract's,
// `promiseKey(entropy, keccak256(abi.encode(provider, sequence)))`, since a sequence number counts
// per provider. The Pot pays the provider's price from its balance: `calculateRequestPriceNative(gas,
// words)` at the transaction's gas price, or `getFeeV2(provider, gas)`. Both keep what is paid above
// it, so exactly the price is paid. The request is refused unless the Pot still holds the Kitchen's
// fee after paying it: the callback is a cook of the Pot, which pays that fee from its balance, and a
// callback that cannot is lost (VRF never retries one). A Pot keeps that much for every request it
// waits on.
//
// THE CALLBACK is the provider calling the Pot: VRF's wrapper with
// `rawFulfillRandomWords(uint256 requestId, uint256[] randomWords)`, Entropy with
// `_entropyCallback(uint64 sequence, address provider, bytes32 randomNumber)`. The Pot answers each
// with this package's handler (its `package.json`'s `handlers`, installed on the Pot once:
// `sauce run @sauce/random`), which checks the caller is the chain's provider contract, logs what
// arrived (`RandomDelivered`), and fulfils the promise. A promise already settled — delivered
// before, or expired past its deadline — is left alone, and the callback returns: a late or
// duplicate delivery is a no-op, never a revert. A body that reverts is undone and its `.catch` runs
// (or the core logs it unhandled); the callback still returns, and the value stays in the log for
// the owner to act on.
//
// THE CALLBACK'S GAS is fixed when the request is made, and paid for then. Left out, `gas` is what
// landing costs — the Router's dispatch, the handler's cook, settling and running the body — plus an
// allowance per byte of what runs, as compiled: the body, or for a request raced or joined with
// others, its part and the combinator's body. A body that loops, or calls out more than its size
// says, needs `gas` given. VRF's wrapper hands the callback exactly that much, and a callback that
// runs out is spent: the wrapper catches it, and the request is paid and never retried. Entropy hands
// it at most that much (and never less than its provider's default), and a callback that fails stays
// open: anyone may reveal it again.
//
// A request no provider fulfils rejects only through a deadline: `deadline` (a unix time) or
// `.within(seconds)`, after which anyone may call the Pot's `expire(key)`, rejecting it with
// `Timeout(bytes32)` into its `.catch`. Neither provider reports a failure of its own.
//
// The calls are written out, selector and arguments, as the registry's ABIs declare them:
// `requestRandomWordsInNative(uint32,uint16,uint32,bytes)` (0x9cfc058e) and
// `requestV2(address,uint32)` (0x0e33da29), which a bound call cannot send value with. The SDK's
// tests derive each from its signature.
import { Request, fulfil, kitchenFee, promiseKey, requireCaller } from "@sauce/async";

// VRFV2PlusClient's ExtraArgsV1 asking for native payment: the tag
// bytes4(keccak256("VRF ExtraArgsV1")), then the struct's one field, `nativePayment`, true.
const SAUCE_RANDOM_VRF_NATIVE = hex`92fd13380000000000000000000000000000000000000000000000000000000000000001`;

// What a callback costs before the body runs: the Router's fallback dispatching to the handler,
// the handler's cook (the engine gate, the Kitchen's fee), the handler, and settling the promise and
// starting its continuation. Measured on the engine, with a margin.
const SAUCE_RANDOM_LANDING_GAS = 150000;
// The allowance per byte of the continuation as compiled, its captured values included.
const SAUCE_RANDOM_GAS_PER_BYTE = 600;

// The event the handlers log, from the Pot, before settling: what the provider delivered for the
// promise `key`, `abi.encode` of it. keccak256("RandomDelivered(bytes32,bytes)").
const SAUCE_RANDOM_DELIVERED = 0xe500aac90a32f50f556ab717cc2f13033477bf25fe300ef4167ccaab39617fd5;

// The requests a program makes: `Random.vrf(config)` and `Random.entropy(config)`.
class Requests {
  // Chainlink VRF v2.5, direct funding, paid in the native coin:
  //
  //   words          how many random words, 1 to 10 (the wrapper's cap); 1 when left out
  //   confirmations  how many blocks the request waits; 3 when left out, the most any chain's
  //                  coordinator asks for (Base's allows 0)
  //   gas            the callback's gas limit; sized from the body when left out
  //   deadline       a unix time after which anyone may expire the request
  vrf(config) {
    this._checkFields(
      "vrf",
      config,
      { words: true, confirmations: true, gas: true, deadline: true },
      "`Random.vrf({ words, confirmations, gas, deadline })`",
    );
    if (ChainlinkVrf.Wrapper == 0) {
      throw new Error(
        "`Random.vrf` requests through Chainlink VRF's VRFV2PlusWrapper, and the registry has none on the chain this program is compiled for",
      );
    }
    const options = config === undefined ? {} : config;
    const words = options.words === undefined ? 1 : options.words;
    const confirmations = options.confirmations === undefined ? 3 : options.confirmations;
    const gas = options.gas;
    return new Request({
      deadline: options.deadline,
      send: (continuation) => {
        require(words >= 1 && words <= 10, "random: a VRF request asks for 1 to 10 words");
        const limit = this._callbackGas(gas, continuation);
        const wrapper = ChainlinkVrf.Wrapper;
        const price = wrapper.calculateRequestPriceNative(limit, words);
        this._requireFunds(price);
        const [id] = abi.decode(
          evm.call(
            wrapper,
            price,
            hex`9cfc058e`.concat(abi.encode(limit, confirmations, words, SAUCE_RANDOM_VRF_NATIVE)),
          ),
          ["Uint256"],
        );
        return promiseKey(wrapper, id);
      },
      deliver: (input, body, fail) => {
        const [randomWords] = abi.decode(input, ["Uint256[]"]);
        body(randomWords);
      },
    });
  }

  // Pyth Entropy v2:
  //
  //   provider  the randomness provider; Entropy's default provider, read when the request is
  //             made, when left out
  //   gas       the callback's gas limit; sized from the body when left out. Entropy rounds it up
  //             to 10,000 and raises it to the provider's default, whose fee is the least a
  //             request pays
  //   deadline  a unix time after which anyone may expire the request
  entropy(config) {
    this._checkFields(
      "entropy",
      config,
      { provider: true, gas: true, deadline: true },
      "`Random.entropy({ provider, gas, deadline })`",
    );
    if (PythEntropy.Entropy == 0) {
      throw new Error(
        "`Random.entropy` requests from Pyth Entropy, and the registry has no Entropy contract on the chain this program is compiled for",
      );
    }
    const options = config === undefined ? {} : config;
    const given = options.provider;
    const gas = options.gas;
    return new Request({
      deadline: options.deadline,
      send: (continuation) => {
        const limit = this._callbackGas(gas, continuation);
        const entropy = PythEntropy.Entropy;
        const provider = given === undefined ? entropy.getDefaultProvider() : given;
        const fee = entropy.getFeeV2(provider, limit);
        this._requireFunds(fee);
        const [sequence] = abi.decode(
          evm.call(entropy, fee, hex`0e33da29`.concat(abi.encode(provider, limit))),
          ["Uint256"],
        );
        return promiseKey(entropy, crypto.keccak256(abi.encode(provider, sequence)));
      },
      deliver: (input, body, fail) => {
        const [value] = abi.decode(input, ["Uint256"]);
        body(value);
      },
    });
  }

  // The callback's gas limit a request asks for: `gas`, else sized from what settling runs: the
  // continuation, and for a combinator's child the combinator's continuation too (`settles`).
  _callbackGas(gas, continuation) {
    if (gas !== undefined) return gas;
    const settles = continuation.settles;
    const bytes =
      settles === undefined
        ? continuation.code.length + continuation.args.length
        : continuation.code.length +
          continuation.args.length +
          settles.code.length +
          settles.args.length;
    return SAUCE_RANDOM_LANDING_GAS + SAUCE_RANDOM_GAS_PER_BYTE * bytes;
  }

  // The Pot pays `price` now and keeps the Kitchen's fee for the callback's cook.
  _requireFunds(price) {
    const needed = price + kitchenFee();
    const message =
      "random: the Pot cannot pay the request and keep the Kitchen's fee for its callback";
    require(ctx.selfBalance() >= needed, message);
  }

  // A config's fields: each one `fields` names, or a compile error naming the one it does not take.
  _checkFields(method, config, fields, usage) {
    if (config === undefined) return;
    if (config.length !== undefined) {
      throw new Error("`Random." + method + "(...)` takes one object: " + usage);
    }
    for (const key of Object.keys(config)) {
      if (fields[key] === undefined) {
        throw new Error("`Random." + method + "` takes no `" + key + "`: " + usage);
      }
    }
  }
}

export const Random = new Requests();

// The body of the handler for `rawFulfillRandomWords(uint256 requestId, uint256[] randomWords)`,
// the call VRF's wrapper makes: from `wrapper` alone, it fulfils the request's promise with the
// words. A request settled already is left alone, and the call returns.
export function rawFulfillRandomWords(wrapper: Address, caller: Address, data: bytes): void {
  requireCaller(wrapper, caller);
  const [id, randomWords] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256[]"]);
  const key = promiseKey(wrapper, id);
  const value = abi.encode(randomWords);
  log(abi.encode(value), SAUCE_RANDOM_DELIVERED, key);
  fulfil(key, value);
}

// The body of the handler for `_entropyCallback(uint64 sequence, address provider, bytes32
// randomNumber)`, the call Pyth Entropy makes: from `entropy` alone, it fulfils the provider's
// request's promise with the number. A request settled already is left alone, and the call returns.
export function entropyCallback(entropy: Address, caller: Address, data: bytes): void {
  requireCaller(entropy, caller);
  const [sequence, provider, number] = abi.decode(data.slice(4, data.length), [
    "Uint256",
    "Address",
    "Uint256",
  ]);
  const key = promiseKey(entropy, crypto.keccak256(abi.encode(provider, sequence)));
  const value = abi.encode(number);
  log(abi.encode(value), SAUCE_RANDOM_DELIVERED, key);
  fulfil(key, value);
}

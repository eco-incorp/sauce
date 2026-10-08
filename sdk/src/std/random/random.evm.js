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
//   Random.vrf({ words, confirmations, gas })   Chainlink VRF v2.5 by direct funding: a request
//                                               paid in the native coin through the chain's
//                                               VRFV2PlusWrapper (`ChainlinkVrf.Wrapper`); the body
//                                               is handed the random words, a `Uint256[]`.
//   Random.entropy({ provider, gas })           Pyth Entropy v2 (`PythEntropy.Entropy`); the body is
//                                               handed one random 32-byte word.
//
// THE REQUEST is made and paid from the Pot when the program runs, and the body, compiled while the
// program compiles, is parked under the request's key (`@sauce/async`'s `Request`, `park`): Chainlink
// VRF's request id, bound to the wrapper; Pyth Entropy's provider and sequence number, bound to the
// Entropy contract (a sequence number counts per provider). The Pot pays the provider's price from
// its balance: `calculateRequestPriceNative(gas, words)` at the transaction's gas price, or
// `getFeeV2(provider, gas)`. Both keep what is paid above it, so exactly the price is paid.
//
// THE CALLBACK is the provider calling the Pot: VRF's wrapper with
// `rawFulfillRandomWords(uint256 requestId, uint256[] randomWords)`, Entropy with
// `_entropyCallback(uint64 sequence, address provider, bytes32 randomNumber)`. The Pot answers each
// with this package's handler (its `package.json`'s `handlers`, installed on the Pot once:
// `sauce run @sauce/random`), which checks the caller is the provider's contract, takes the body
// parked under the request's key — once: a second delivery of the key finds nothing — and runs it
// as the Pot, in the callback's cook, with what arrived. The cook pays the Kitchen's fee from the
// Pot's balance, so a Pot waiting on a callback keeps that much.
//
// THE CALLBACK'S GAS is fixed when the request is made, and paid for then. Left out, `gas` is what
// landing costs — the Router's dispatch, the handler's cook, taking and running the body — plus an
// allowance per byte of the body as compiled. A body that loops, or calls out more than its size
// says, needs `gas` given. VRF's wrapper hands the callback exactly that much, and a callback that
// runs out is spent: the wrapper catches it, and the request is paid and never retried. Entropy
// hands it at most that much (and never less than its provider's default), and a callback that
// fails stays open: anyone may reveal it again.
//
// `.catch((e) => { … })` runs in the body's place when the body reverts, with what it reverted
// with; neither provider reports a failure of its own.
//
// The calls are written out, selector and arguments, as the registry's ABIs declare them:
// `requestRandomWordsInNative(uint32,uint16,uint32,bytes)` (0x9cfc058e) and
// `requestV2(address,uint32)` (0x0e33da29), which a bound call cannot send value with. The SDK's
// tests derive each from its signature.
import { Request, requireCaller, run, take } from "@sauce/async";

// VRFV2PlusClient's ExtraArgsV1 asking for native payment: the tag
// bytes4(keccak256("VRF ExtraArgsV1")), then the struct's one field, `nativePayment`, true.
const SAUCE_RANDOM_VRF_NATIVE = hex`92fd13380000000000000000000000000000000000000000000000000000000000000001`;

// What a callback costs before the body runs: the Router's fallback dispatching to the handler,
// the handler's cook (the engine gate, the Kitchen's fee), the handler, and taking and starting
// the body. Measured on the released engine, with a margin.
const SAUCE_RANDOM_LANDING_GAS = 150000;
// The allowance per byte of the body as compiled, its captured values included.
const SAUCE_RANDOM_GAS_PER_BYTE = 600;

// The requests a program makes: `Random.vrf(config)` and `Random.entropy(config)`.
class Requests {
  // Chainlink VRF v2.5, direct funding, paid in the native coin:
  //
  //   words          how many random words, 1 to 10 (the wrapper's cap); 1 when left out
  //   confirmations  how many blocks the request waits; 3 when left out, the most any chain's
  //                  coordinator asks for (Base's allows 0)
  //   gas            the callback's gas limit; sized from the body when left out
  vrf(config) {
    this._checkFields(
      "vrf",
      config,
      { words: true, confirmations: true, gas: true },
      "`Random.vrf({ words, confirmations, gas })`",
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
      send: (continuation) => {
        require(words >= 1 && words <= 10, "random: a VRF request asks for 1 to 10 words");
        const limit = this._callbackGas(gas, continuation);
        const wrapper = ChainlinkVrf.Wrapper;
        const price = wrapper.calculateRequestPriceNative(limit, words);
        const [id] = abi.decode(
          evm.call(
            wrapper,
            price,
            hex`9cfc058e`.concat(abi.encode(limit, confirmations, words, SAUCE_RANDOM_VRF_NATIVE)),
          ),
          ["Uint256"],
        );
        return crypto.keccak256(abi.encode(wrapper, id));
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
  entropy(config) {
    this._checkFields(
      "entropy",
      config,
      { provider: true, gas: true },
      "`Random.entropy({ provider, gas })`",
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
      send: (continuation) => {
        const limit = this._callbackGas(gas, continuation);
        const entropy = PythEntropy.Entropy;
        const provider = given === undefined ? entropy.getDefaultProvider() : given;
        const fee = entropy.getFeeV2(provider, limit);
        const [sequence] = abi.decode(
          evm.call(entropy, fee, hex`0e33da29`.concat(abi.encode(provider, limit))),
          ["Uint256"],
        );
        return crypto.keccak256(abi.encode(entropy, provider, sequence));
      },
      deliver: (input, body, fail) => {
        const [value] = abi.decode(input, ["Uint256"]);
        body(value);
      },
    });
  }

  // The callback's gas limit a request asks for: `gas`, else sized from the body.
  _callbackGas(gas, continuation) {
    if (gas !== undefined) return gas;
    return (
      SAUCE_RANDOM_LANDING_GAS +
      SAUCE_RANDOM_GAS_PER_BYTE * (continuation.code.length + continuation.args.length)
    );
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
// the call VRF's wrapper makes: from `wrapper` alone, it runs the body parked under the request's
// key with the words.
export function rawFulfillRandomWords(wrapper: Address, caller: Address, data: bytes): void {
  requireCaller(wrapper, caller);
  const [id, randomWords] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256[]"]);
  run(take(crypto.keccak256(abi.encode(wrapper, id))), abi.encode(randomWords));
}

// The body of the handler for `_entropyCallback(uint64 sequence, address provider, bytes32
// randomNumber)`, the call Pyth Entropy makes: from `entropy` alone, it runs the body parked under
// the provider's request with the number.
export function entropyCallback(entropy: Address, caller: Address, data: bytes): void {
  requireCaller(entropy, caller);
  const [sequence, provider, value] = abi.decode(data.slice(4, data.length), [
    "Uint256",
    "Address",
    "Uint256",
  ]);
  run(take(crypto.keccak256(abi.encode(entropy, provider, sequence))), abi.encode(value));
}

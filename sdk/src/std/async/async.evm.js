// @sauce/async — EVM arm.
//
// Sauce's promises. A program makes a request now; the protocol calls the Pot back later, in a
// transaction of its own; the request is a PROMISE, settled exactly once, fulfilled with a value or
// rejected with a reason, and its `.then` body, compiled while the program compiles, runs when it
// settles, as the same Pot:
//
//   Random.vrf({ words: 2 }).then((words) => {
//     USDC.transfer(players[words[0] % 2], prize);
//   });
//
//   Promise.race([Oracle.price(feed), Async.timeout(3600)])
//     .then((price) => { … })
//     .catch((e) => { … }); // the oracle failed, or an hour passed and anyone called expire
//
// `Random.vrf` is a protocol package's (`@sauce/random`); this package is what every such package
// is built on, and holds no protocol of its own:
//
//   Request             a promise a package's request method returns, which `.then` and `.catch`
//                       fold on
//   Promise             all, race, any, allSettled, resolve, reject and withResolvers, with
//                       JavaScript's semantics, folded while the program compiles
//   Async               resolve/reject a promise by its key in a later transaction, expire one
//                       past its deadline, and a timeout to race against
//   fulfil, reject      what a handler calls to settle the promise a callback names: once; a
//                       callback for a promise unknown or already settled does nothing, and
//                       returns
//   settleCarried       the same for a protocol that carries the continuation in its message
//   promiseKey, salt    a promise's key: a protocol's id under its tag, or one the Pot picks
//   park, run, received the settlement table's parts, for a package that needs them directly
//   requireCaller, requireSelf  a handler's checks
//   Handler             a program the Pot answers a selector with, which a request installs as it
//                       runs (`handlers`) unless the Pot already answers with it
//   ensureInstalled, install, declareInterface  installing a handler, and an ERC-165 id
//   isValidSignature, Erc1271   the Pot as an ERC-1271 signer: a hash a program approved, or its
//                               owner's signature over the hash bound to the Pot
//
// WHERE A CALLBACK LANDS. A Private Pot answers a selector neither it nor its Router declares with
// the program registered for it (the Router's `setHandler`, which `install` calls, from the owner
// or from a cook of the Pot): the Router runs that handler as a cook of the Pot, paying the
// Kitchen's fee from the Pot's balance, handed `(caller: Address, value: Uint256, data: bytes)`. A
// handler authenticates its caller and settles the promise the callback names. A package's request
// lists its handlers, and installs them as it runs, in the same transaction, unless the Pot already
// answers with them; nothing is installed beforehand:
//
//   new Request({
//     handlers: [
//       new Handler(VRF_FULFIL, (caller: Address, value: Uint256, data: bytes) => {
//         requireCaller(Coordinator, caller);
//         const [id, words] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256[]"]);
//         fulfil(promiseKey(VRF_TAG, id), abi.encode(words));
//       }),
//     ],
//     send: (continuation) => { … },
//   });
//
// A request checks a handler in place by the Router's record of it, against the CREATE2 address of
// `0x00 ++ engine ++ program` from the Pot (salt zero), worked out while compiling when the SDK
// sets `SAUCE_ASYNC_ENGINE`; and with a deadline it installs the Pot's public `expire(bytes32)`
// too.
//
// A Shared Pot, and a Private Pot whose Router is fixed, answer no selector: their Router refuses
// `install`.
//
// THE SETTLEMENT TABLE. Each pending promise is one word in the Pot's storage, in the ERC-7201
// namespace `sauce.storage.Async`, at `keccak256(abi.encode(key, namespace))`:
//
//   bits   0..159  the continuation's code: a contract holding the program `.then`/`.catch`
//                  compiled to, deployed once by CREATE2 from the Pot (salt zero, so its address
//                  is its bytes'), and shared by every request that compiles to it
//   bits 160..199  the deadline, a unix time after which `expire` rejects it; zero for none
//   bits 200..201  the state: 1 pending (settled promises are cleared, or marked 2 fulfilled and
//                  3 rejected where their key is one the Pot picked, so it is never picked again)
//   bit  202       the continuation has a `.catch`
//   bits 203..210  how many words the continuation captured from the program around it
//   bit  211       those words are kept as code (more than three) rather than in the words after
//   bit  212       the key is one the Pot picked (`salt`)
//   bits 213..215  a combinator's kind: 0 none, 1 all, 2 race, 3 any, 4 allSettled
//   bits 216..223  a combinator's children still to settle
//   bits 224..231  a combinator's children
//
// The captured words follow in the next slots, or, more than three, as code whose address the next
// slot holds. A combinator's child result is a word at `keccak256(abi.encode(key, index,
// namespace))`: the child's state at bits 160..161 and, for a result longer than a word, the
// address of the code that keeps it in bits 0..159; a word or less is in the next slot, as a
// number, those bits zero and its length in bytes at bits 168..173.
//
// Every continuation is compiled with `program((input: bytes, mode: Uint256) => …, { continuation:
// chainId })`: the SDK compiles it for that chain's names and reports it as a continuation
// (`continuations`), not as an intent's body, since nothing opens an intent for it. It runs with
// what settled it, the value or the reason, and how, 2 fulfilled or 3 rejected, appended as its
// parameters: `code ++ captured words ++ abi.encode(input, mode)`.
//
// SETTLING. `fulfil(key, value)` and `reject(key, reason)` clear the promise, then run its
// continuation inside the handler's own cook (`evm.delegate` into the in-flight engine: no second
// cook, no second fee), handing it what arrived as its parameters, which the request's `deliver`
// decodes into the body's. The body's revert is caught at that call: everything it did is undone
// and, with a `.catch`, the continuation runs again for the catch with the revert's data (its first
// 256 bytes). A promise rejected with no `.catch`, or whose `.catch` reverts, is logged unhandled.
// Either way the callback RETURNS: a protocol that retries a failed delivery must not retry
// forever, and a late or duplicate callback is no failure of the protocol's.
//
// EVENTS, from the Pot: `PromisePending(bytes32 indexed key, uint256 deadline)` when a promise is
// parked (how a later transaction learns a deferred's key), `PromiseSettled(bytes32 indexed key,
// uint256 state)`, `PromiseIgnored(bytes32 indexed key, uint256 state)` for a callback that found
// nothing pending, and `PromiseUnhandled(bytes32 indexed key, bytes reason)`.
//
// THE POT AS A SIGNER. A Pot answers ERC-1271's `isValidSignature(bytes32 hash, bytes signature)`
// with one handler, `erc1271.handler.js`, which every package that needs the Pot to sign declares
// (`"program": "@sauce/async/erc1271.handler.js"`), registered as a view (static, no fee). It is
// valid, with the magic value 0x1626ba7e, for
//   (a) a hash a program running as the Pot approved, `Erc1271.approve(hash)` (and `revoke`), kept
//       in the ERC-7201 namespace `sauce.storage.Erc1271`, WHATEVER the signature bytes: the
//       approval is the authorization, as a Safe's approved hash is, and a market that checks a
//       request the Pot made passes whatever signature the Pot gave it;
//   (b) the owner's signature over `hash` bound to the Pot, EIP-712's
//         domain      { name: "Sauce Pot", version: "1", chainId, verifyingContract: the Pot }
//         PotMessage  { hash: bytes32 }
//       never over `hash` itself, so a signature the owner made for its own account, or for another
//       Pot it owns, is no signature of this Pot's. A 65-byte `r ‖ s ‖ v` is checked with
//       `crypto.ecdsaVerify`, refusing first a malleable one (`s` in the upper half of the curve's
//       order) and any `v` but 27 and 28; an owner with code is asked EIP-1271 itself, with the
//       signature as it is (OpenZeppelin's `SignatureChecker` order).
// and 0xffffffff otherwise. (a) is checked first: one storage read, well under the 100,000 gas a
// market's check gives it.
//
// The calls are written out, selector and arguments, as the Pot, its Router and its Kitchen
// declare them: `inFlightEngine()` (0x9fd004e1), `setHandler(bytes4,address,bytes,bool)`
// (0xeb45e5d0), `setInterface(bytes4,bool)` (0xc0a43a7c), `kitchen()` (0xba0909dd),
// `executionFee()` (0x40e9903b), `owner()` (0x8da5cb5b) and EIP-1271's
// `isValidSignature(bytes32,bytes)` (0x1626ba7e). The SDK's tests derive each from its signature,
// and each EIP-712 hash from its type.

// The ERC-7201 namespace of the settlement table, in the Pot's storage:
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Async")) - 1)) & ~bytes32(uint256(0xff)).
const SAUCE_ASYNC_NAMESPACE = 0x4dfff1aabf079bde1221d3a9fbfbe12f9d81161876e97fa9b85215e9f7a8b300;

// Transient storage (EIP-1153), the Pot's in every frame of the transaction. What `run` hands its
// program for `received()`, deprecated, `keccak256("sauce.async.received")`: its length, then its
// words.
const SAUCE_ASYNC_RECEIVED = 0xe0834bde068556530c4cc9d3e560d8055ab88b322f2d933c8fac9a037dbe690e;
// How it settled, `keccak256("sauce.async.mode")`: 2 fulfilled, 3 rejected.
const SAUCE_ASYNC_MODE = 0x93281666bb76cfd6e9531316fbd9a988b1822676b7d07d7f32d40d855f438c9d;
// Which child settled a race or an any, `keccak256("sauce.async.index")`.
const SAUCE_ASYNC_INDEX = 0x58535832c2900ad8740d61598b790aecc898c95082de61b7d5227f24e856e89e;
// How many keys this transaction has picked, `keccak256("sauce.async.salt")`.
const SAUCE_ASYNC_SALT = 0x075e4a5084d2dc043a0243230720d8dd0648fb9056883a1705a9af977d762a05;

// The events' topics: keccak256 of each signature above.
const SAUCE_ASYNC_PENDING = 0xa9fed18a6daa7ac27b0c8841db87de302152eef27a9dee4fee5e725a1bfe6af3;
const SAUCE_ASYNC_SETTLED = 0x342fcbff839055def4dafe8765f6f8399033786c2c76c3ee0a036fd6bef23a54;
const SAUCE_ASYNC_IGNORED = 0xb78a14745c133668926b46e976911778cad8e45d0b3c54ff164aac96531f8b45;
const SAUCE_ASYNC_UNHANDLED = 0x8f909674cc09cc463bd1460b4e447d647049a064ca7f9d175f9ff541bea55c1f;

// The ERC-7201 namespace of the hashes the Pot approved as signed (ERC-1271):
// keccak256(abi.encode(uint256(keccak256("sauce.storage.Erc1271")) - 1)) & ~bytes32(uint256(0xff)).
const SAUCE_ERC1271_NAMESPACE = 0x3ecee999f28b5e8fad18912a6f2e29ef0ffcf6ba8ef27fb61168d26e4308d900;
// keccak256 of each EIP-712 type and domain field of the owner's signature for the Pot.
// EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
const SAUCE_ERC1271_DOMAIN = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
// "Sauce Pot"
const SAUCE_ERC1271_NAME = 0x65e82c940f55e84d80e8c004a4c586bf80f61f10a7c0218cc8c7ca657f1e4edd;
// "1"
const SAUCE_ERC1271_VERSION = 0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6;
// PotMessage(bytes32 hash)
const SAUCE_ERC1271_MESSAGE = 0x285c77bc77dfca76b6f099853b19373bb19a687adfc951011417a67ac42dded3;
// Half the order of secp256k1: a signature's `s` above it is the malleable twin of one below.
const SAUCE_ERC1271_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
// The event `Erc1271.approve`/`revoke` logs, from the Pot: SignatureApproved(bytes32 indexed hash,
// bool approved).
const SAUCE_ERC1271_APPROVED = 0xcb06a503ad3aecd2681872ad5ca2bd35af8bd0d65247dedef3505baa3f031f43;

// The states, and the combinators' kinds.
const SAUCE_ASYNC_PENDING_STATE = 1;
const SAUCE_ASYNC_FULFILLED = 2;
const SAUCE_ASYNC_REJECTED = 3;
const SAUCE_ASYNC_ALL = 1;
const SAUCE_ASYNC_RACE = 2;
const SAUCE_ASYNC_ANY = 3;
const SAUCE_ASYNC_ALL_SETTLED = 4;

// What the SDK may set while compiling (a define replaces a module constant). The engine the Pot's
// cooks run on, the release's: with it a request checks its handlers against an address worked out
// while it compiles, and carries none of their code to check them. And 1 when the program's sender
// read every handler the program installs already in place on the Pot: then the program carries
// no handler at all, and refuses to run if one is gone rather than park a promise its callback
// could not reach.
const SAUCE_ASYNC_ENGINE = 0;
const SAUCE_ASYNC_INSTALLED = 0;
// `expire(bytes32)`, the selector of the Pot's public `expire` handler.
const SAUCE_ASYNC_EXPIRE = 0xc6441798;

// ---- keys ---------------------------------------------------------------------------------------

// The key of the promise a protocol's request `id` is, under the package's `tag` (a word naming
// the protocol, so two protocols' ids never meet): `keccak256(abi.encode(tag, id))`.
export function promiseKey(tag: Uint256, id: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(tag, id));
}

// A key no promise on this Pot has: one for a promise the Pot names itself (a deferred, a
// combinator, a message a protocol carries back). Unordered, so requests made in parallel never
// contend on a counter: the block, the time and how many this transaction has picked, hashed, and
// rehashed while the slot is taken. A settled promise under such a key keeps a mark, so a key is
// never picked twice.
export function salt(): Uint256 {
  const picked = evm.tload(SAUCE_ASYNC_SALT) + 1;
  evm.tstore(SAUCE_ASYNC_SALT, picked);
  let key = crypto.keccak256(abi.encode(ctx.self(), ctx.blockNumber(), ctx.timestamp(), picked));
  while (evm.sload(slotOf(key)) != 0) {
    key = crypto.keccak256(abi.encode(key));
  }
  return key;
}

function slotOf(key: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(key, SAUCE_ASYNC_NAMESPACE));
}

function resultSlot(key: Uint256, index: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(key, index, SAUCE_ASYNC_NAMESPACE));
}

// ---- code ---------------------------------------------------------------------------------------

// `data` as the code of a contract that answers any call with it, deployed by CREATE2 from the Pot
// with salt zero, so its address is a function of `data` and the same bytes are deployed once. The
// code is a ten-byte copier (PUSH2 <length> DUP1 PUSH1 0x0a RETURNDATASIZE CODECOPY
// RETURNDATASIZE RETURN) and `data`, and the init code is the same copier around it: `data` may be
// up to 24,566 bytes (EIP-170).
function initOf(data: bytes): bytes {
  const length = data.length;
  require(length <= 24566, "async: more than one contract can hold");
  const code = length + 10;
  return hex`61`
    .concat(code.toBytesBe(2))
    .concat(hex`80600a3d393df361`)
    .concat(length.toBytesBe(2))
    .concat(hex`80600a3d393df3`)
    .concat(data);
}

// `data` kept as code (see `initOf`), its init code hashed here: for bytes known only as the
// program runs, a result or captured words.
function keep(data: bytes): Uint256 {
  const init = initOf(data);
  const at = evm.create2Address(ctx.self(), 0, crypto.keccak256(init));
  if (ctx.codeSize(at) == 0) {
    require(evm.create2(init, 0) == at, "async: the code could not be deployed");
  }
  return at;
}

// `data` kept as code, its init code's hash `initHash` given: a continuation, whose code the
// compiler knows, so `Code.initHash` works the hash out while the program compiles. The init code
// is built only to deploy, the first time.
function keepAt(data: bytes, initHash: Uint256): Uint256 {
  const at = evm.create2Address(ctx.self(), 0, initHash);
  if (ctx.codeSize(at) == 0) {
    require(evm.create2(initOf(data), 0) == at, "async: the code could not be deployed");
  }
  return at;
}

// What `keep` deployed at `at`.
function kept(at: Uint256): bytes {
  return evm.static(at, hex``);
}

// The engine the Pot's cook in flight runs: the one a continuation runs on.
function inFlightEngine(): Address {
  const [engine] = abi.decode(evm.static(ctx.self(), hex`9fd004e1`), ["Address"]);
  return engine;
}

// ---- the table ----------------------------------------------------------------------------------

function stateOf(word: Uint256): Uint256 {
  return (word >> 200) & 3;
}

// Park a pending promise under `key`: its continuation `code`, compiled once and kept once, and the
// words `args` it captured; `deadline` (zero for none) after which `expire` rejects it; whether it
// has a `.catch`. Refuses a key already in the table. The low-level form of what `Request` does.
export function park(
  key: Uint256,
  code: bytes,
  args: bytes,
  deadline: Uint256,
  catches: bool,
): void {
  parkRecord(key, crypto.keccak256(initOf(code)), code, args, deadline, catches, 0, 0, false);
}

function parkRecord(
  key: Uint256,
  codeHash: Uint256,
  code: bytes,
  args: bytes,
  deadline: Uint256,
  catches: bool,
  kind: Uint256,
  count: Uint256,
  salted: bool,
): void {
  const slot = slotOf(key);
  require(evm.sload(slot) == 0, "async: a promise is already parked under this key");
  require(deadline < 1 << 40, "async: the deadline is past 2^40 seconds");
  // A continuation's captured values are whole words, each padded to 32 bytes (a bytes value
  // too): split into words here and joined back by `takeRecord`, so a tail shorter than a word
  // would be lost.
  require(args.length % 32 == 0, "async: a continuation's captured values are not whole words");
  const words = args.length / 32;
  require(words < 256, "async: a continuation captures at most 255 words");
  let word =
    keepAt(code, codeHash) |
    (deadline << 160) |
    (SAUCE_ASYNC_PENDING_STATE << 200) |
    (words << 203);
  if (catches) {
    word = word | (1 << 202);
  }
  if (salted) {
    word = word | (1 << 212);
  }
  word = word | (kind << 213) | (count << 216) | (count << 224);
  if (words > 3) {
    word = word | (1 << 211);
    evm.sstore(slot + 1, keep(args));
  } else {
    for (let i = 0; i < words; i += 1) {
      const [w] = abi.decode(args.slice(i * 32, i * 32 + 32), ["Uint256"]);
      evm.sstore(slot + 1 + i, w);
    }
  }
  evm.sstore(slot, word);
  log(abi.encode(deadline), SAUCE_ASYNC_PENDING, key);
}

// Whether the promise under `key` is pending.
export function isPending(key: Uint256): bool {
  return stateOf(evm.sload(slotOf(key))) == SAUCE_ASYNC_PENDING_STATE;
}

// Take the pending promise under `key` out of the table: its continuation with its captured words,
// ready to run, and its word. Settled promises are cleared, but for a key the Pot picked, which
// keeps its state so it is never picked again.
function takeRecord(key: Uint256, state: Uint256): bytes {
  const slot = slotOf(key);
  const word = evm.sload(slot);
  const words = (word >> 203) & 255;
  let args = hex``;
  if (((word >> 211) & 1) == 1) {
    args = kept(evm.sload(slot + 1));
    evm.sstore(slot + 1, 0);
  } else {
    for (let i = 0; i < words; i += 1) {
      const w = evm.sload(slot + 1 + i);
      args = args.concat(w.toBytesBe(32));
      evm.sstore(slot + 1 + i, 0);
    }
  }
  if (((word >> 212) & 1) == 1) {
    evm.sstore(slot, (state << 200) | (1 << 212));
  } else {
    evm.sstore(slot, 0);
  }
  return kept(word & ((1 << 160) - 1)).concat(args);
}

// ---- what arrives -------------------------------------------------------------------------------

// Hold `input` and how it settled where `received()` and `fulfilled()` read them, in every frame of
// the cook: `run`'s, for one release.
function hand(input: bytes, mode: Uint256): void {
  const length = input.length;
  evm.tstore(SAUCE_ASYNC_RECEIVED, length);
  evm.tstore(SAUCE_ASYNC_MODE, mode);
  // Whole words: the last one padded with zeros.
  const padded = input.concat(hex`00000000000000000000000000000000000000000000000000000000000000`);
  for (let i = 0; i * 32 < length; i += 1) {
    const [w] = abi.decode(padded.slice(i * 32, i * 32 + 32), ["Uint256"]);
    evm.tstore(SAUCE_ASYNC_RECEIVED + 1 + i, w);
  }
}

// DEPRECATED, removed in the next release: a continuation takes what settled it as its
// parameters. In a program `run` runs: what it was handed. Empty anywhere else.
export function received(): bytes {
  const length = evm.tload(SAUCE_ASYNC_RECEIVED);
  let out = hex``;
  for (let i = 0; i * 32 < length; i += 1) {
    const w = evm.tload(SAUCE_ASYNC_RECEIVED + 1 + i);
    out = out.concat(w.toBytesBe(32));
  }
  return out.slice(0, length);
}

// DEPRECATED, removed in the next release, as `received()`: in a program `run` runs, true.
export function fulfilled(): bool {
  return evm.tload(SAUCE_ASYNC_MODE) == SAUCE_ASYNC_FULFILLED;
}

// In a race's or an any's continuation: the child that settled it.
export function winner(): Uint256 {
  return evm.tload(SAUCE_ASYNC_INDEX);
}

// Run `program` as this Pot, writable, inside the cook in flight — no second cook, no second fee —
// handing it `input` as a fulfilment: as its parameters, `abi.encode(input, 2)` appended, which a
// continuation, `program((input: bytes, mode: Uint256) => …)`, takes, and a program that takes
// none ignores. For one release `received()` reads it too. Answers what the program returns. For a
// continuation a protocol carried and no table holds; a handler calls it only after it has
// authenticated its caller, since the program runs with everything the Pot holds.
export function run(program: bytes, input: bytes): bytes {
  hand(input, SAUCE_ASYNC_FULFILLED);
  return evm.delegate(inFlightEngine(), program.concat(abi.encode(input, SAUCE_ASYNC_FULFILLED)));
}

// ---- settling -----------------------------------------------------------------------------------

// Settle the promise under `key` as fulfilled with `value` (`abi.encode(…)` of what arrived), and
// run its `.then`. Once: a promise unknown or already settled is left alone, the call logged as
// ignored, and it returns. Never reverts for the body: see "SETTLING" above.
export function fulfil(key: Uint256, value: bytes): void {
  settle(key, SAUCE_ASYNC_FULFILLED, value);
}

// Settle the promise under `key` as rejected with `reason`, and run its `.catch`. Once, as
// `fulfil`.
export function reject(key: Uint256, reason: bytes): void {
  settle(key, SAUCE_ASYNC_REJECTED, reason);
}

// A promise past its deadline, rejected with `Timeout(bytes32 key)`. Anyone may call it, through
// the Pot's `expire(bytes32)` handler; refused before the deadline, and for a promise with none.
export function expire(key: Uint256): void {
  const word = evm.sload(slotOf(key));
  if (stateOf(word) != SAUCE_ASYNC_PENDING_STATE) {
    log(abi.encode(stateOf(word)), SAUCE_ASYNC_IGNORED, key);
    return;
  }
  const deadline = (word >> 160) & ((1 << 40) - 1);
  require(deadline != 0, "async: the promise has no deadline");
  require(ctx.timestamp() > deadline, "async: the promise has not expired");
  settle(key, SAUCE_ASYNC_REJECTED, hex`e6cc9dd0`.concat(abi.encode(key)));
}

function settle(key: Uint256, state: Uint256, input: bytes): void {
  const word = evm.sload(slotOf(key));
  if (stateOf(word) != SAUCE_ASYNC_PENDING_STATE) {
    log(abi.encode(stateOf(word)), SAUCE_ASYNC_IGNORED, key);
    return;
  }
  log(abi.encode(state), SAUCE_ASYNC_SETTLED, key);
  const catches = ((word >> 202) & 1) == 1;
  const program = takeRecord(key, state);
  runSettled(key, program, state, input, catches);
}

// Run a settled promise's continuation: for its `.then`, and for its `.catch` when the `.then`
// reverts; a rejection with no `.catch` to run is logged unhandled.
function runSettled(
  key: Uint256,
  program: bytes,
  state: Uint256,
  input: bytes,
  catches: bool,
): void {
  let failed = 0;
  let reason = input;
  if (state == SAUCE_ASYNC_FULFILLED) {
    evm
      .delegate(inFlightEngine(), program.concat(abi.encode(input, SAUCE_ASYNC_FULFILLED)))
      .catch((e) => {
        failed = 1;
        reason = e;
      });
    if (failed == 0) {
      return;
    }
  }
  if (!catches) {
    log(abi.encode(reason), SAUCE_ASYNC_UNHANDLED, key);
    return;
  }
  failed = 0;
  evm
    .delegate(inFlightEngine(), program.concat(abi.encode(reason, SAUCE_ASYNC_REJECTED)))
    .catch((e) => {
      failed = 1;
      reason = e;
    });
  if (failed == 1) {
    log(abi.encode(reason), SAUCE_ASYNC_UNHANDLED, key);
  }
}

// For a protocol that carries the continuation back in its message (a bridge, a proof's extra
// data): settle the promise `key` names. With `stored` false — a plain `.then`, no deadline, no
// combinator — nothing is in the table: `program` is the continuation the message carried, run as
// it settles; the protocol's own delivery-once is the replay protection. With `stored` true the
// promise is in the table and settles there, once, as `fulfil`/`reject`. `ok` says which.
// A handler calls it only after `requireSelf`: the carried program runs as this Pot.
export function settleCarried(
  key: Uint256,
  stored: bool,
  program: bytes,
  value: bytes,
  ok: bool,
): void {
  const state = ok ? SAUCE_ASYNC_FULFILLED : SAUCE_ASYNC_REJECTED;
  if (stored) {
    settle(key, state, value);
    return;
  }
  log(abi.encode(state), SAUCE_ASYNC_SETTLED, key);
  runSettled(key, program, state, value, true);
}

// ---- combinators, at run time -------------------------------------------------------------------

// A combinator's child settled: record it, and settle the combinator when it is decided. Called by
// the child's continuation, which a combinator compiles in place of the child's own.
export function childSettled(joinKey: Uint256, index: Uint256, state: Uint256, input: bytes): void {
  const slot = slotOf(joinKey);
  const word = evm.sload(slot);
  if (stateOf(word) != SAUCE_ASYNC_PENDING_STATE) {
    // Decided already: a race's later child, an all's child after the first rejection.
    log(abi.encode(state), SAUCE_ASYNC_IGNORED, joinKey);
    return;
  }
  const kind = (word >> 213) & 7;
  if (kind == SAUCE_ASYNC_RACE) {
    evm.tstore(SAUCE_ASYNC_INDEX, index);
    settle(joinKey, state, input);
    return;
  }
  if (kind == SAUCE_ASYNC_ALL && state == SAUCE_ASYNC_REJECTED) {
    settle(joinKey, state, input);
    return;
  }
  if (kind == SAUCE_ASYNC_ANY && state == SAUCE_ASYNC_FULFILLED) {
    evm.tstore(SAUCE_ASYNC_INDEX, index);
    settle(joinKey, state, input);
    return;
  }
  // Kept for later: an all's value, an any's reason, an allSettled's either. A word or less in the
  // next slot, which costs less than the CREATE2 of code; longer, as code.
  const at = resultSlot(joinKey, index);
  let head = input.length << 168;
  if (input.length > 32) {
    head = keep(input);
  } else {
    evm.sstore(at + 1, input.toBe());
  }
  evm.sstore(at, head | (state << 160));
  const remaining = ((word >> 216) & 255) - 1;
  evm.sstore(slot, (word & ~(255 << 216)) | (remaining << 216));
  if (remaining > 0) {
    return;
  }
  if (kind == SAUCE_ASYNC_ANY) {
    // Every child rejected: `AggregateError(bytes32 joinKey)`, each reason a child's `result`.
    settle(joinKey, SAUCE_ASYNC_REJECTED, hex`5585cec3`.concat(abi.encode(joinKey)));
    return;
  }
  settle(joinKey, SAUCE_ASYNC_FULFILLED, abi.encode(joinKey));
}

// A combinator's child `index`, kept by `childSettled`: what it settled with.
export function result(joinKey: Uint256, index: Uint256): bytes {
  const at = resultSlot(joinKey, index);
  const head = evm.sload(at);
  const code = head & ((1 << 160) - 1);
  if (code == 0) {
    return evm.sload(at + 1).toBytesBe(head >> 168);
  }
  return kept(code);
}

// A combinator's child `index`: 2 fulfilled, 3 rejected (or 0 not kept).
export function resultState(joinKey: Uint256, index: Uint256): Uint256 {
  return (evm.sload(resultSlot(joinKey, index)) >> 160) & 3;
}

// ---- a handler's checks, and installing ---------------------------------------------------------

// The call came from `expected`: a handler's first check, on its `caller`. Anyone can send the Pot
// any calldata, so a handler that skips it settles promises for whoever asks.
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
// a compiled handler, run on this cook's engine: as a cook (`readOnly` false) or as a view, static
// and with no fee (`readOnly` true). An empty program clears the selector. The Pot's Router refuses
// on a Shared Pot and on a Pot whose Router is fixed.
export function install(selector: Uint256, program: bytes, readOnly: bool): void {
  evm.call(
    ctx.self(),
    0,
    hex`eb45e5d0`.concat(abi.encode(selector << 224, inFlightEngine(), program, readOnly)),
  );
}

// The ERC-7201 namespace of the Pot's handler records, the Router's: selector to
// `{ address bytecode; bool isView; }` in one word, the flag in the byte above the address.
const SAUCE_HANDLERS_LOCATION = 0x3ede71929532386d53b5e25665f65f4ad4a552935973d8ba46f290dd0524c500;

// Answer `selector` with `program` on this Pot, unless it already does: the record the Router keeps
// names the code contract `0x00 ++ engine ++ program` that `install` deploys by CREATE2 from the
// Pot (salt zero), with this mode. Answers whether it installed.
export function ensureInstalled(selector: Uint256, program: bytes, readOnly: bool): bool {
  const word = evm.sload(crypto.keccak256(abi.encode(selector << 224, SAUCE_HANDLERS_LOCATION)));
  const engine = inFlightEngine();
  const init = hex`61`
    .concat((program.length + 21).toBytesBe(2))
    .concat(hex`80600a3d393df300`)
    .concat(engine.toBytesBe(20))
    .concat(program);
  const code = evm.create2Address(ctx.self(), 0, crypto.keccak256(init));
  if (word == (code | ((readOnly ? 1 : 0) << 160))) {
    return false;
  }
  evm.call(
    ctx.self(),
    0,
    hex`eb45e5d0`.concat(abi.encode(selector << 224, engine, program, readOnly)),
  );
  return true;
}

// Declare (or stop declaring) the ERC-165 interface `id` (its four bytes) on the Pot this program
// runs on, which its Router then answers natively to `supportsInterface`: what a protocol that
// checks its receiver before it calls back asks.
export function declareInterface(id: Uint256, supported: bool): void {
  evm.call(ctx.self(), 0, hex`c0a43a7c`.concat(abi.encode(id << 224, supported)));
}

// The Kitchen's fee for one cook of this Pot: what a public handler asks its caller to pay.
export function kitchenFee(): Uint256 {
  const [kitchen] = abi.decode(evm.static(ctx.self(), hex`ba0909dd`), ["Address"]);
  const [fee] = abi.decode(evm.static(kitchen, hex`40e9903b`), ["Uint256"]);
  return fee;
}

// ---- the Pot as a signer (ERC-1271) -------------------------------------------------------------

function approvedSlot(hash: Uint256): Uint256 {
  return crypto.keccak256(abi.encode(hash, SAUCE_ERC1271_NAMESPACE));
}

// Approve (`approved` true) or revoke `hash` as one the Pot signed: `Erc1271.approve`/`revoke`.
export function approveHash(hash: Uint256, approved: bool): void {
  evm.sstore(approvedSlot(hash), approved ? 1 : 0);
  log(abi.encode(approved), SAUCE_ERC1271_APPROVED, hash);
}

// Whether a program running as the Pot approved `hash`.
export function isApprovedHash(hash: Uint256): bool {
  return evm.sload(approvedSlot(hash)) == 1;
}

// What the owner signs for the Pot to answer ERC-1271 for `hash`: `hash` bound to this Pot and this
// chain (`PotMessage` under the Pot's EIP-712 domain).
export function potMessageDigest(hash: Uint256): Uint256 {
  const domain = crypto.keccak256(
    abi.encode(
      SAUCE_ERC1271_DOMAIN,
      SAUCE_ERC1271_NAME,
      SAUCE_ERC1271_VERSION,
      ctx.chainId(),
      ctx.self(),
    ),
  );
  return crypto.keccak256(
    hex`1901`.concat(abi.encode(domain, crypto.keccak256(abi.encode(SAUCE_ERC1271_MESSAGE, hash)))),
  );
}

// ERC-1271's answer for the Pot: the magic value, left-aligned, for a hash the Pot approved or the
// owner signed for this Pot, and 0xffffffff otherwise. See "THE POT AS A SIGNER" above. Written
// flat, the approved slot and the digest inline rather than through `approvedSlot` and
// `potMessageDigest`: a helper call costs a frame, and this runs under a market's gas cap.
export function isValidSignature(hash: Uint256, signature: bytes): Uint256 {
  if (evm.sload(crypto.keccak256(abi.encode(hash, SAUCE_ERC1271_NAMESPACE))) == 1) {
    return 0x1626ba7e00000000000000000000000000000000000000000000000000000000;
  }
  const digest = crypto.keccak256(
    hex`1901`.concat(
      abi.encode(
        crypto.keccak256(
          abi.encode(
            SAUCE_ERC1271_DOMAIN,
            SAUCE_ERC1271_NAME,
            SAUCE_ERC1271_VERSION,
            ctx.chainId(),
            ctx.self(),
          ),
        ),
        crypto.keccak256(abi.encode(SAUCE_ERC1271_MESSAGE, hash)),
      ),
    ),
  );
  const [signer] = abi.decode(evm.static(ctx.self(), hex`8da5cb5b`), ["Address"]);
  let valid = false;
  if (signature.length == 65) {
    const s = signature.slice(32, 64).toBe();
    const v = signature.slice(64, 65).toBe();
    if (s <= SAUCE_ERC1271_HALF_ORDER && (v == 27 || v == 28)) {
      valid = crypto.ecdsaVerify(digest, signature, signer);
    }
  }
  if (!valid && ctx.codeSize(signer) > 0) {
    const answer = evm.static(signer, hex`1626ba7e`.concat(abi.encode(digest, signature)));
    valid = answer.length >= 32 && answer.slice(0, 4).toBe() == 0x1626ba7e;
  }
  if (valid) {
    return 0x1626ba7e00000000000000000000000000000000000000000000000000000000;
  }
  return 0xffffffff00000000000000000000000000000000000000000000000000000000;
}

// ---- the classes the compiler runs --------------------------------------------------------------

// A continuation's code, as the compiler knows it.
class Code {
  // keccak256 of the init code `keepAt` deploys `program`'s code with (`initOf`), worked out while
  // the program compiles, where the compiler folds a hash over bytes it knows: a park only checks
  // the address it gives.
  static initHash(program) {
    const code = program.code;
    if (code.length > 24566) {
      throw new Error("a continuation compiles to more bytes than one contract can hold");
    }
    const size = code.length + 10;
    const length = code.length;
    return crypto.keccak256(
      hex`61`
        .concat(size.toBytesBe(2))
        .concat(hex`80600a3d393df361`)
        .concat(length.toBytesBe(2))
        .concat(hex`80600a3d393df3`)
        .concat(code),
    );
  }
}

// A handler's record and code, as the compiler knows them.
class HandlerCode {
  // The slot of the Router's record for `selector`, in the Pot's storage.
  static slot(selector) {
    return crypto.keccak256(abi.encode(selector << 224, SAUCE_HANDLERS_LOCATION));
  }
  // keccak256 of the init code the Router deploys `program`'s code with, for `engine`: its code
  // contract is `0x00 ++ engine ++ program`, by CREATE2 from the Pot with salt zero.
  static initHash(program, engine) {
    const code = program.code;
    if (code.length > 24555) {
      throw new Error(
        "a handler compiles to more bytes than one contract can hold beside its engine",
      );
    }
    const size = code.length + 21;
    return crypto.keccak256(
      hex`61`
        .concat(size.toBytesBe(2))
        .concat(hex`80600a3d393df300`)
        .concat(engine.toBytesBe(20))
        .concat(code),
    );
  }
}

// A program the Pot answers a selector with, which a request installs for its callback to reach:
// `new Handler(selector, (caller: Address, value: Uint256, data: bytes) => { … }, readOnly)`. The
// Router runs it for `selector` as a cook (a view with `readOnly`), handed who called the Pot, the
// value sent and the whole calldata. It captures nothing of the program around it: it runs on its
// own, whenever the selector reaches the Pot.
export class Handler {
  constructor(selector, run, readOnly) {
    this.selector = selector;
    this.readOnly = readOnly === true;
    this.program = program(run, {
      handler: chainId,
      selector,
      readOnly: this.readOnly ? 1 : 0,
    });
  }
  // Install it on the Pot unless the Pot already answers `selector` with it, as it runs. With
  // `SAUCE_ASYNC_INSTALLED`, only check, and refuse to run without it.
  ensure() {
    const p = this.program;
    if (SAUCE_ASYNC_ENGINE != 0) {
      const expected =
        evm.create2Address(ctx.self(), 0, HandlerCode.initHash(p, SAUCE_ASYNC_ENGINE)) |
        ((this.readOnly ? 1 : 0) << 160);
      const word = evm.sload(HandlerCode.slot(this.selector));
      if (SAUCE_ASYNC_INSTALLED == 1) {
        require(word ==
          expected, "async: a handler this program needs is not installed on the Pot");
        return;
      }
      if (word != expected) {
        install(this.selector, p.code.concat(p.args), this.readOnly);
      }
      return;
    }
    ensureInstalled(this.selector, p.code.concat(p.args), this.readOnly);
  }
}

// The handlers the core installs itself.
class CoreHandlers {
  // The Pot's public `expire(bytes32 key)`: anyone may reject a promise whose deadline has passed,
  // with `Timeout(bytes32 key)`, paying the Kitchen's fee for the cook (`expire.handler.js`, the
  // same program).
  static expire() {
    return new Handler(SAUCE_ASYNC_EXPIRE, (caller: Address, value: Uint256, data: bytes) => {
      require(value >= kitchenFee(), "async: expire pays the Kitchen's fee");
      const [key] = abi.decode(data.slice(4, data.length), ["Uint256"]);
      expire(key);
    });
  }
}

// An empty list that grows while compiling.
class Lists {
  static empty(...none) {
    return none;
  }
}

// A promise a protocol's request makes: what a package's request method returns, and the class
// `.then` folds on. The package gives it
//
//   send      `(continuation) => key`: makes the request, at run time, and answers the key of the
//             promise it is — `promiseKey(TAG, id)`, under the id the request answered.
//             `continuation` is `{ code, args, settles }`: the program settling it runs, and, for a
//             combinator's child, `settles`, the combinator's own `{ code, args }`, which the same
//             callback may run after it (a package sizing its callback's gas counts both). With
//             `carries`, the protocol carries the continuation back itself: the key is picked
//             first (`continuation.key`), and `continuation.stored` says whether the table holds
//             the promise (a deadline or a combinator needs it) or the message must carry
//             `continuation.program`, `code ++ args`; `send` answers nothing.
//   deliver   `(input, body, fail) => { … }`: runs in the continuation, handed what the callback
//             delivered, and calls `body` with it decoded, or `fail` with why the request failed.
//             Left out, the body is handed `input` as it is.
//   carries   true for a protocol that carries the continuation back (above).
//   chain     the chain the callback lands on, `Optimism` or its id: this chain (`chainId`)
//             when left out.
//   deadline  a unix time after which anyone may `expire` the promise, rejecting it with
//             `Timeout(bytes32)`; or call `.within(seconds)`.
//
// and the program gives it the body, `.then((…) => { … })`. `.catch(e)`
// handles a rejection: the protocol's `fail`, `reject` or `expire`, and the body's own revert, with
// everything the body did undone.
//
// The compiler runs all of this while it compiles: a package's request method must be a method of
// an object the program reads (`Random.vrf(…)`), which the compiler can run, and not a plain
// function.
// What `new Request(...)` takes: `send` always (refused, with how to write it, when absent), the
// rest when the protocol needs them.
interface RequestOptions {
  handlers?: any;
  send?: (continuation: any) => any;
  deliver?: (input: bytes, body: any, fail: any) => void;
  carries?: bool;
  chain?: any;
  deadline?: Uint256;
}

export class Request {
  // Set by `.then` and `.catch`, and read as `undefined` when neither ran.
  _body;
  _handler;
  constructor(spec: RequestOptions) {
    if (spec === undefined || spec.send === undefined) {
      throw new Error(
        "`new Request({ send, deliver, carries, chain, deadline })` needs `send`: the request, made at run time",
      );
    }
    this._send = spec.send;
    this._handlers = spec.handlers;
    this._deliver = spec.deliver;
    this._carries = spec.carries === true;
    this._chain = spec.chain;
    this._deadline = spec.deadline;
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

  // What runs in the body's place when the promise is rejected or the body reverts, handed why.
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

  // A deadline `seconds` from when the request is made.
  within(seconds) {
    this._deadline = ctx.timestamp() + seconds;
    return this;
  }

  toString() {
    if (this._stage == 1) {
      return "a request's one step is `.then((result) => { … })`, the body";
    }
    if (this._stage == 2) {
      return "after `.then(...)` its one step is `.catch(...)`";
    }
    return "after `.catch(...)` nothing follows it";
  }

  // The statement ends: compile the continuation, make the request, park the promise.
  [Symbol.dispose]() {
    if (this._stage == 1) {
      throw new Error(
        "a request has no body. Finish it with `.then((result) => { … })`: the code that runs when the callback arrives",
      );
    }
    const continuation = program(this._continuation(), { continuation: this._chainId() });
    this._make(continuation, this._handler !== undefined, 0, 0, undefined);
  }

  _chainId() {
    return this._chain === undefined ? chainId : this._chain;
  }

  // Before the request: the handlers its callback reaches, and with a deadline the public
  // `expire`, installed on the Pot unless they are already.
  _install() {
    if (this._handlers !== undefined) {
      for (const handler of this._handlers) {
        handler.ensure();
      }
    }
    if (this._deadline !== undefined) {
      CoreHandlers.expire().ensure();
    }
  }

  _deadlineOr0() {
    return this._deadline === undefined ? 0 : this._deadline;
  }

  // Make the request with `continuation` as its continuation; `joined` 1 when it is a combinator's
  // child, so the table always holds it, and `settles` the combinator's continuation, which
  // settling it may run too.
  _make(continuation, catches, joinKey, joined, settles) {
    this._install();
    const deadline = this._deadlineOr0();
    const send = this._send;
    if (!this._carries) {
      const key = send({ code: continuation.code, args: continuation.args, settles });
      if (key === undefined) {
        throw new Error(
          "a request's `send` answers the key of its promise (`promiseKey(TAG, id)`); a protocol that carries its continuation back says `carries: true`",
        );
      }
      parkRecord(
        key,
        Code.initHash(continuation),
        continuation.code,
        continuation.args,
        deadline,
        catches,
        0,
        0,
        false,
      );
      return;
    }
    const key = salt();
    const stored = joined == 1 || this._deadline !== undefined;
    if (stored) {
      parkRecord(
        key,
        Code.initHash(continuation),
        continuation.code,
        continuation.args,
        deadline,
        catches,
        0,
        0,
        true,
      );
    }
    send({
      code: continuation.code,
      args: continuation.args,
      program: continuation.code.concat(continuation.args),
      key,
      stored,
      settles,
    });
  }

  // What the continuation runs: the delivery into the body for a fulfilment, the handler for a
  // rejection — the protocol's, or the body's own revert.
  _continuation() {
    const body = this._body;
    const handler = this._handler;
    const deliver =
      this._deliver === undefined ? (input, body, fail) => body(input) : this._deliver;
    // With no handler, a rejection reverts the run, which the settlement logs unhandled: a carried
    // continuation is run for a rejection too, whatever it handles.
    if (handler === undefined) {
      return (input: bytes, mode: Uint256) => {
        if (mode == 2) {
          deliver(input, body, (reason) => {
            revert(reason);
          });
        } else {
          revert(input);
        }
      };
    }
    return (input: bytes, mode: Uint256) => {
      if (mode == 2) {
        deliver(input, body, (reason) => {
          revert(reason);
        });
      } else {
        handler(input);
      }
    };
  }

  // As a combinator's child `index`: its continuation records what it settled with in the
  // combinator `joinKey`, and the request is made with it.
  _join(joinKey, index, settles) {
    const child = program(
      (input: bytes, mode: Uint256) => {
        childSettled(joinKey, index, mode, input);
      },
      { continuation: this._chainId() },
    );
    this._make(child, true, joinKey, 1, settles);
  }

  // How a combinator's continuation decodes what this child settled with.
  _decoder() {
    return this._deliver === undefined ? (input, next, fail) => next(input) : this._deliver;
  }
}

// A promise already settled: `Promise.resolve(value)` fulfilled with a word,
// `Promise.reject(reason)` rejected with bytes. Composes with the combinators; on its own, its
// body runs where it is written.
class Settled {
  _body;
  _handler;
  constructor(state, value) {
    this._state = state;
    this._value = value;
    this._stage = 1;
  }
  then(body) {
    this._body = body;
    this._stage = 2;
    return this;
  }
  catch(handler) {
    this._handler = handler;
    this._stage = 3;
    return this;
  }
  [Symbol.dispose]() {
    if (this._state == SAUCE_ASYNC_FULFILLED) {
      if (this._body !== undefined) {
        const body = this._body;
        body(this._value);
      }
      return;
    }
    if (this._handler === undefined) {
      revert(this._value);
    } else {
      const handler = this._handler;
      handler(this._value);
    }
  }
  _join(joinKey, index, settles) {
    childSettled(
      joinKey,
      index,
      this._state,
      this._state == SAUCE_ASYNC_FULFILLED ? abi.encode(this._value) : this._value,
    );
  }
  _decoder() {
    return (input, next, fail) => {
      const [value] = abi.decode(input, ["Uint256"]);
      next(value);
    };
  }
}

// A promise the program settles itself, later: `Promise.withResolvers()`'s, and `Async.timeout`'s.
// Its key is picked when it is made (`deferred.key`), and logged with `PromisePending` when its
// body is parked, so a later transaction names it: `Async.resolve(key, value)`, `Async.reject(key,
// reason)`, from the owner's cook or from a handler the owner installed. It is its own resolvers:
// `const d = Promise.withResolvers(); d.promise.then((value) => { … });`, the value as bytes.
class Deferred {
  _body;
  _handler;
  constructor(deadline, timeout, expires) {
    this.key = salt();
    this._deadline = deadline;
    this._timeout = timeout;
    // A deadline given: `expire` must be installed for anyone to reach it.
    this._expires = expires;
    this._stage = 1;
    // Fields, not methods, so `const { promise, resolve, reject } = Promise.withResolvers()`
    // takes them: fulfil it with `value`, or reject it with `reason`, at run time. Its body is
    // parked when the block that holds it ends, so in the transaction that made it, settle it after
    // that block; later, `Async.resolve(key, v)` or `Async.reject(key, reason)`.
    this.resolve = (value) => fulfil(this.key, value);
    this.reject = (reason) => reject(this.key, reason);
  }
  then(body) {
    if (this._stage > 1) {
      throw new Error(
        "`.then(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    this._body = body;
    this._stage = 2;
    return this;
  }
  catch(handler) {
    if (this._stage != 2) {
      throw new Error("`.catch(...)` follows `.then(...)`: it handles the promise's rejection");
    }
    this._handler = handler;
    this._stage = 3;
    return this;
  }
  // The promise itself, as `Promise.withResolvers()` answers it: `d.promise.then(…)`.
  get promise() {
    return this;
  }
  [Symbol.dispose]() {
    if (this._stage == 1) {
      return;
    }
    const body = this._body;
    const handler = this._handler;
    const continuation =
      handler === undefined
        ? program(
            (input: bytes, mode: Uint256) => {
              if (mode == 2) {
                body(input);
              } else {
                revert(input);
              }
            },
            { continuation: chainId },
          )
        : program(
            (input: bytes, mode: Uint256) => {
              if (mode == 2) {
                body(input);
              } else {
                handler(input);
              }
            },
            { continuation: chainId },
          );
    if (this._expires) {
      CoreHandlers.expire().ensure();
    }
    parkRecord(
      this.key,
      Code.initHash(continuation),
      continuation.code,
      continuation.args,
      this._deadline,
      handler !== undefined,
      0,
      0,
      true,
    );
  }
  _join(joinKey, index, settles) {
    const child = program(
      (input: bytes, mode: Uint256) => {
        childSettled(joinKey, index, mode, input);
      },
      { continuation: chainId },
    );
    if (this._expires) {
      CoreHandlers.expire().ensure();
    }
    parkRecord(
      this.key,
      Code.initHash(child),
      child.code,
      child.args,
      this._deadline,
      true,
      0,
      0,
      true,
    );
  }
  _decoder() {
    // A timeout is never fulfilled: its branch of a race's continuation never runs.
    return this._timeout ? (input, next, fail) => fail(input) : (input, next, fail) => next(input);
  }
}

// A combinator over `children`, settled by `childSettled` as they settle.
class Join {
  _body;
  _handler;
  constructor(kind, children) {
    if (children === undefined || children.length == 0) {
      throw new Error("a combinator takes a list of promises: `Promise.all([a, b])`");
    }
    if (children.length > 255) {
      throw new Error("a combinator takes at most 255 promises");
    }
    this._kind = kind;
    this._children = children;
    this._stage = 1;
  }
  then(body) {
    if (this._stage > 1) {
      throw new Error(
        "`.then(...)` is not a step after `.then(...)`: its one step is `.catch(...)`",
      );
    }
    this._body = body;
    this._stage = 2;
    return this;
  }
  catch(handler) {
    if (this._stage != 2) {
      throw new Error("`.catch(...)` follows `.then(...)`: it handles the combinator's rejection");
    }
    this._handler = handler;
    this._stage = 3;
    return this;
  }
  [Symbol.dispose]() {
    if (this._stage == 1) {
      throw new Error("a combinator has no body. Finish it with `.then((results) => { … })`");
    }
    const joinKey = salt();
    const continuation = program(this._continuation(joinKey), { continuation: chainId });
    parkRecord(
      joinKey,
      Code.initHash(continuation),
      continuation.code,
      continuation.args,
      0,
      this._handler !== undefined,
      this._kind,
      this._children.length,
      true,
    );
    Fold.join(this._children, 0, joinKey, continuation);
  }
  _continuation(joinKey) {
    const kind = this._kind;
    // Each child's decoder alone, so the continuation captures nothing else of the children.
    const children = Lists.empty();
    for (const child of this._children) {
      children.push(child._decoder());
    }
    const body = this._body;
    const handler = this._handler;
    const fail = (reason) => {
      revert(reason);
    };
    const settledBody =
      kind == SAUCE_ASYNC_ALL
        ? (input) => {
            Fold.all(children, 0, undefined, joinKey, body, fail);
          }
        : kind == SAUCE_ASYNC_ALL_SETTLED
          ? (input) => {
              Fold.settled(children, 0, Lists.empty(), joinKey, body);
            }
          : (input) => {
              Fold.first(children, 0, winner(), input, body, fail);
            };
    if (handler === undefined) {
      return (input: bytes, mode: Uint256) => {
        if (mode == 2) {
          settledBody(input);
        } else {
          revert(input);
        }
      };
    }
    return (input: bytes, mode: Uint256) => {
      if (mode == 2) {
        settledBody(input);
      } else {
        handler(input);
      }
    };
  }
}

// What a combinator's continuation hands its body, built while the program compiles.
class Fold {
  // Each child made as the combinator's child `index`.
  static join(children, index, joinKey, settles) {
    if (index == children.length) {
      return;
    }
    children[index]._join(joinKey, index, settles);
    Fold.join(children, index + 1, joinKey, settles);
  }

  // Every child's value, decoded by its own decoder, in order: what `Promise.all` hands its body.
  // A decoder may hand on its value inside an `if`, where a list made outside cannot grow, so the
  // values travel as a chain of new objects, and the list is made where the last one arrives.
  static all(children, index, chain, joinKey, body, fail) {
    if (index == children.length) {
      const values = Lists.empty();
      Fold.fill(values, chain);
      body(values);
      return;
    }
    const decode = children[index];
    decode(
      result(joinKey, index),
      (value) => {
        Fold.all(children, index + 1, { value, rest: chain }, joinKey, body, fail);
      },
      fail,
    );
  }

  // `chain`'s values into `values`, first first.
  static fill(values, chain) {
    if (chain === undefined) {
      return;
    }
    Fold.fill(values, chain.rest);
    values.push(chain.value);
  }

  // Each child's `{ status, value }`, as it arrived: what `Promise.allSettled` hands its body.
  static settled(children, index, results, joinKey, body) {
    if (index == children.length) {
      body(results);
      return;
    }
    results.push({ status: resultState(joinKey, index), value: result(joinKey, index) });
    Fold.settled(children, index + 1, results, joinKey, body);
  }

  // The winning child's value, decoded by its own decoder: what `race` and `any` hand their body.
  static first(children, index, winning, input, body, fail) {
    if (index == children.length) {
      return;
    }
    if (winning == index) {
      const decode = children[index];
      decode(input, body, fail);
    } else {
      Fold.first(children, index + 1, winning, input, body, fail);
    }
  }
}

// JavaScript's `Promise`, on a Pot, folded while the program compiles.
export class Promise {
  // Fulfilled with every child's value, in order, when the last is; rejected with the first
  // rejection, the later children ignored.
  static all(children) {
    return new Join(SAUCE_ASYNC_ALL, children);
  }
  // Settled as the first child to settle is; the rest are ignored.
  static race(children) {
    return new Join(SAUCE_ASYNC_RACE, children);
  }
  // Fulfilled as the first child to fulfil is; rejected with `AggregateError(bytes32 key)` when all
  // reject, each child's reason kept (`result(key, i)`).
  static any(children) {
    return new Join(SAUCE_ASYNC_ANY, children);
  }
  // Fulfilled when every child has settled, with `{ status, value }` for each: status 2 fulfilled
  // or 3 rejected, value what it settled with, as it arrived.
  static allSettled(children) {
    return new Join(SAUCE_ASYNC_ALL_SETTLED, children);
  }
  // Already fulfilled with `value`, a word.
  static resolve(value) {
    return new Settled(SAUCE_ASYNC_FULFILLED, value);
  }
  // Already rejected with `reason`, bytes.
  static reject(reason) {
    return new Settled(SAUCE_ASYNC_REJECTED, reason);
  }
  // A promise the program settles itself: `d.promise`, `d.resolve(value)`, `d.reject(reason)` and
  // `d.key` (no destructuring in SauceScript). `deadline`, a unix time, lets anyone `expire` it.
  static withResolvers(deadline) {
    return new Deferred(deadline === undefined ? 0 : deadline, false, deadline !== undefined);
  }
}

// A promise's settlement by its key, in a later transaction.
export class Async {
  // Fulfil the promise `key` with `value`: the owner's cook, or a handler the owner installed.
  static resolve(key, value) {
    fulfil(key, value);
  }
  // Reject the promise `key` with `reason`.
  static reject(key, reason) {
    reject(key, reason);
  }
  // Reject the promise `key` with `Timeout(bytes32)`, its deadline past.
  static expire(key) {
    expire(key);
  }
  // A promise that only times out: rejected with `Timeout(bytes32)` once `seconds` have passed and
  // anyone calls `expire`. For `Promise.race([request, Async.timeout(3600)])`.
  static timeout(seconds) {
    return new Deferred(ctx.timestamp() + seconds, true, true);
  }
}

// The Pot as an ERC-1271 signer, from a program running as the Pot.
export class Erc1271 {
  // Approve `hash` as one the Pot signed: `isValidSignature(hash, …)` is valid until revoked.
  static approve(hash) {
    approveHash(hash, true);
  }
  // Revoke `hash`.
  static revoke(hash) {
    approveHash(hash, false);
  }
  // Whether the Pot approved `hash`.
  static approved(hash) {
    return isApprovedHash(hash);
  }
  // The Pot's ERC-1271 handler, a view, for a package's request to install: `handlers:
  // [Erc1271.handler()]`. The same program as `erc1271.handler.js`, written out with no call.
  static handler() {
    return new Handler(
      0x1626ba7e,
      (caller: Address, value: Uint256, data: bytes): Uint256 => {
        const [hash, signature] = abi.decode(data.slice(4, data.length), ["Uint256", "bytes"]);
        if (evm.sload(crypto.keccak256(abi.encode(hash, SAUCE_ERC1271_NAMESPACE))) == 1) {
          return 0x1626ba7e00000000000000000000000000000000000000000000000000000000;
        }
        const digest = crypto.keccak256(
          hex`1901`.concat(
            abi.encode(
              crypto.keccak256(
                abi.encode(
                  SAUCE_ERC1271_DOMAIN,
                  SAUCE_ERC1271_NAME,
                  SAUCE_ERC1271_VERSION,
                  ctx.chainId(),
                  ctx.self(),
                ),
              ),
              crypto.keccak256(abi.encode(SAUCE_ERC1271_MESSAGE, hash)),
            ),
          ),
        );
        const [signer] = abi.decode(evm.static(ctx.self(), hex`8da5cb5b`), ["Address"]);
        let valid = false;
        if (signature.length == 65) {
          const s = signature.slice(32, 64).toBe();
          const v = signature.slice(64, 65).toBe();
          if (s <= SAUCE_ERC1271_HALF_ORDER && (v == 27 || v == 28)) {
            valid = crypto.ecdsaVerify(digest, signature, signer);
          }
        }
        if (!valid && ctx.codeSize(signer) > 0) {
          const answer = evm.static(signer, hex`1626ba7e`.concat(abi.encode(digest, signature)));
          valid = answer.length >= 32 && answer.slice(0, 4).toBe() == 0x1626ba7e;
        }
        if (valid) {
          return 0x1626ba7e00000000000000000000000000000000000000000000000000000000;
        }
        return 0xffffffff00000000000000000000000000000000000000000000000000000000;
      },
      true,
    );
  }
}

// @eco-incorp/sauce/evm/engine — viem-native view of the EVM Sauce engine contracts.
//
// Mirrors ./svm/engine (a consumer-facing engine subpath) for the EVM side. The SDK vendored the
// V12Pot / V12Kitchen ABIs (src/artifacts/*.json) but never exported them, so viem consumers
// (eco-solver) re-declare them by hand. This exports them as viem `parseAbi` objects plus
// ready-to-use handles with calldata encoders, so a consumer imports the final thing instead of
// re-writing the ABI.
//
// deployPot uses the CANONICAL engine signature deployPot(address owner, bytes32 salt) — matching
// the released Kitchen ABI. (Some consumers hand-wrote a salt-only form; the engine has no such
// variant.) Drift-guarded against src/artifacts/*.json by test/evm/engine.test.ts: each ABI below
// is the released contract's COMPLETE ABI — every entry of the release appears here and nothing
// else does, with the same signature — so a release that adds, drops or changes an entry fails
// there rather than leaving a consumer to read the artifact by hand.

import {
  bytesToHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  hashTypedData,
  hexToBigInt,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  recoverAddress,
  size,
  slice,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { v12PredictPot } from "../deployments/pot.js";
import { assertEngineRunsCompiler } from "../deployments/releases.js";
import { v12PotDerivation } from "../deployments/v12-addresses.js";

/**
 * V12Pot — private Pots restrict `cook()` to their owner; Shared Pots allow any caller.
 *
 * **The engine is named per cook.** A Pot holds no engine: `cook(address engine, bytes program)`
 * takes the interpreter as an argument, and `inFlightEngine()` reports the engine of the cook
 * currently executing — it is `address(0)` outside one. The SVM kitchen takes an `engine_program`
 * account per call for the same reason: which interpreter runs is the caller's choice at call time.
 *
 * A cook runs exactly ONE program.
 *
 * **The Router is the Pot's own.** Its fallback delegatecalls `router()`: the Router the Kitchen had
 * when the Pot was minted. A private Pot's owner can change it unless minted with a fixed Router;
 * Shared Pots always fix it. Neither the Kitchen nor its owner can move a deployed Pot.
 */
export const v12PotAbi = parseAbi([
  "constructor()",
  "fallback() external payable",
  "receive() external payable",
  "function cook(address engine, bytes program) payable returns (bytes)",
  "function cookSigned(address engine, bytes program, uint256 maxExecutionFee, uint256 nonce, uint256 deadline, address submitter, bytes signature) payable returns (bytes)",
  "function eval(bytes program) returns (bytes)",
  "function gateSalt() view returns (bytes32)",
  "function inFlightEngine() view returns (address armed)",
  "function invalidateNonces(uint256 word, uint256 mask)",
  "function kitchen() view returns (address)",
  "function owner() view returns (address)",
  "function router() view returns (address)",
  "function setRouter(address newRouter)",
  "function userSalt() view returns (bytes32)",
  "event RouterSet(address indexed router)",
  "event NoncesInvalidated(uint256 indexed word, uint256 mask)",
  "event SignedCook(uint256 indexed nonce, address indexed submitter)",
  "error BadSignature()",
  "error Expired()",
  "error NonceUsed()",
  "error WrongSubmitter()",
  "error EmptyProgram()",
  "error EngineHasNoCode()",
  "error FeeNotPaid(uint256 required, uint256 provided)",
  "error FeeTransferFailed()",
  "error NotOwner()",
  "error NotInFlightEngine()",
  "error RouterFixed()",
  "error SharedRouterNotFixed()",
  "error RouterHasNoCode()",
  "error RouterUnset()",
]);

/**
 * V12Kitchen — CREATE2 Pot factory behind a UUPS proxy. `deployPot` bakes `owner` into the Pot's
 * CREATE2 address.
 *
 * `router()` is the Router Pots minted FROM NOW ON start on. The Kitchen's owner moves it with
 * `setRouter`; that moves no Pot address, no engine gate and no deployed Pot. The owner-only
 * administration (`initialize`, `setExecutionFee`, `withdrawExecutionFees`, the two-step ownership
 * transfer, `upgradeToAndCall`) is part of the ABI too, so a deployment script needs no artifact.
 */
export const v12KitchenAbi = parseAbi([
  "constructor()",
  "receive() external payable",
  "function UPGRADE_INTERFACE_VERSION() view returns (string)",
  "function acceptOwnership()",
  "function deployPot(address owner, bytes32 salt) returns (address pot)",
  "function deployPot(address owner, bytes32 salt, bool routerFixed) returns (address pot)",
  "function deploySharedPot(bytes32 salt) returns (address pot)",
  "function executionFee() view returns (uint256)",
  "function initialize(address initialOwner, uint256 initialExecutionFee)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function potInitCodeHash() view returns (bytes32)",
  "function potParameters() view returns (address owner, bytes32 salt, bool routerFixed)",
  "function predictPot(address owner, bytes32 salt) view returns (address)",
  "function predictPot(address owner, bytes32 salt, bool routerFixed) view returns (address)",
  "function predictSharedPot(bytes32 salt) view returns (address)",
  "function proxiableUUID() view returns (bytes32)",
  "function renounceOwnership() pure",
  "function router() view returns (address)",
  "function setExecutionFee(uint256 fee)",
  "function setRouter(address newRouter)",
  "function transferOwnership(address newOwner)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function withdrawExecutionFees(address recipient, uint256 amount)",
  "event ExecutionFeeSet(uint256 fee)",
  "event ExecutionFeesWithdrawn(address indexed recipient, uint256 amount)",
  "event Initialized(uint64 version)",
  "event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event PotDeployed(address indexed owner, bytes32 indexed salt, address pot)",
  "event RouterSet(address indexed router)",
  "event Upgraded(address indexed implementation)",
  "error AddressEmptyCode(address target)",
  "error ERC1967InvalidImplementation(address implementation)",
  "error ERC1967NonPayable()",
  "error FailedCall()",
  "error InsufficientBalance(uint256 requested, uint256 available)",
  "error InvalidInitialization()",
  "error NotInitializing()",
  "error OwnableInvalidOwner(address owner)",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnershipIsPermanent()",
  "error RouterHasNoCode()",
  "error UUPSUnauthorizedCallContext()",
  "error UUPSUnsupportedProxiableUUID(bytes32 slot)",
  "error WithdrawalFailed()",
  "error ZeroInitialExecutionFee()",
  "error ZeroOwner()",
  "error ZeroRecipient()",
]);

/** Ready-to-use V12Pot handle: the viem ABI plus calldata encoders for route/batch legs. */
export const v12Pot = {
  abi: v12PotAbi,
  /**
   * Encode `cook(engine, program)` calldata.
   *
   * `engine` is the interpreter this cook runs on — the Pot no longer holds one. `program` is a
   * single compiled sauce blob, where this used to take an array whose first element was the only
   * one ever executed.
   *
   * Throws for an engine a v12 release set names for another compiler than the SDK's
   * (`assertEngineRunsCompiler`): that engine cannot run this SDK's programs.
   */
  encodeCook: (engine: Address, program: Hex): Hex => {
    assertEngineRunsCompiler("evm", engine);

    return encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [engine, program] });
  },
} as const;

/**
 * The EIP-712 domain a Pot's owner signs a cook under: `{ name: "Sauce Pot", version: "1", chainId,
 * verifyingContract: the Pot }`. `chainId` and the Pot are the signature's: a Private Pot has one
 * address on every chain, and the chain id is what keeps a signature to one of them.
 */
export const POT_SIGN_DOMAIN = { name: "Sauce Pot", version: "1" } as const;

/** `Cook`'s EIP-712 type, field order and all: the Pot hashes exactly these, in this order. */
export const COOK_TYPE =
  "Cook(address engine,bytes program,uint256 value,uint256 maxExecutionFee,uint256 nonce,uint256 deadline,address submitter)";

/** `keccak256(COOK_TYPE)`, the constant the Pot hashes with (`Pot.sol`'s `COOK_TYPEHASH`). */
export const COOK_TYPEHASH: Hex =
  "0xee063c16caa92a203b808bd65797df72ea8c821b890805ab457c5fdb28c7fc67";

/** The ERC-7201 slot of `sauce.storage.CookNonces`: word `w` of the nonce bitmap is at
 *  `keccak256(abi.encode(w, COOK_NONCES_LOCATION))` ({@link cookNonceSlot}). */
export const COOK_NONCES_LOCATION: Hex =
  "0x08184ababcb38dd115581f50f6ee2ae87aeba9473b07b25b94798bbfbf936b00";

/** The `Cook` struct as a wallet's `signTypedData` takes it. */
export const COOK_TYPES = {
  Cook: [
    { name: "engine", type: "address" },
    { name: "program", type: "bytes" },
    { name: "value", type: "uint256" },
    { name: "maxExecutionFee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "submitter", type: "address" },
  ],
} as const;

const UINT256_MAX = (1n << 256n) - 1n;

/** The top of the curve order's lower half: `cookSigned` accepts no `s` above it. */
const SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/** ERC-1271's `isValidSignature` answer as the Pot reads it: the first word of the return data, the
 *  selector in its top 4 bytes and the other 28 zero. Bytes after that word are not read. */
const ERC1271_MAGIC: Hex = `0x1626ba7e${"00".repeat(28)}`;

const erc1271Abi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);

/**
 * One cook a Private Pot's owner signs, for anyone (or one named account) to submit with
 * `cookSigned`. Every field is covered by the signature: the Pot runs the cook if and only if the
 * owner signed this engine, this program, this value, this fee ceiling, this nonce, this deadline and
 * this submitter, for this Pot on this chain.
 */
export interface SignedCookExecution {
  /** The chain it runs on; the signature is good for no other. */
  readonly chainId: number | bigint;
  /** The Private Pot that runs it, and whose owner signs. */
  readonly pot: Address;
  /** The engine the Pot delegatecalls, with the Pot's whole authority: `v12EngineAddress()`. */
  readonly engine: Address;
  /** The bytecode with its entry arguments appended: exactly what the engine runs, all of it signed. */
  readonly program: Hex;
  /**
   * What the submitter's `msg.value` must be, in wei; `0n` when left out. The Pot hashes the value
   * it was sent, so any other amount is `BadSignature`. The Kitchen's fee comes out of the Pot's
   * balance, which includes it: a Pot holding no native coin needs a `value` that covers the fee.
   */
  readonly value?: bigint;
  /** The most of the Kitchen's fee the Pot pays for this cook. The Kitchen's owner may raise the fee
   *  after the owner signs; a fee above this (or above the Pot's balance) is `FeeNotPaid`. */
  readonly maxExecutionFee: bigint;
  /** Runs once, in any order: bit `nonce & 255` of word `nonce >> 8` ({@link cookNonceWordBit}). */
  readonly nonce: bigint;
  /** The last second it runs, inclusive: a unix time, compared with `block.timestamp`. */
  readonly deadline: bigint;
  /** The only caller that may submit it; the zero address, or left out, for anyone. */
  readonly submitter?: Address;
}

/** {@link SignedCookExecution} with the owner's signature: what {@link encodeCookSigned} submits. */
export interface SignedCookCall extends SignedCookExecution {
  /** The owner's 65-byte `r ‖ s ‖ v` (`s` in the lower half, `v` 27 or 28), or what an ERC-1271
   *  owner's `isValidSignature` takes, of any length. */
  readonly signature: Hex;
}

type ResolvedCook = Required<Omit<SignedCookExecution, "chainId">> & { readonly chainId: bigint };

function uint256(name: string, value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n || value > UINT256_MAX) {
    throw new Error(`${name} is an unsigned 256-bit integer (a bigint), not ${String(value)}`);
  }

  return value;
}

function addressOf(name: string, value: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} is an EVM address, not ${value}`);
  }

  return getAddress(value);
}

/** The cook with its defaults, every field checked: nothing is signed or built from a value the
 *  Pot's ABI would encode differently, or refuse. */
function resolved(execution: SignedCookExecution): ResolvedCook {
  const chainId = BigInt(execution.chainId);
  if (chainId < 1n || chainId > UINT256_MAX) {
    throw new Error(`chainId is a positive integer, not ${String(execution.chainId)}`);
  }
  if (!isHex(execution.program) || size(execution.program) === 0) {
    throw new Error(
      "program is the compiled bytecode with its arguments appended, as 0x hex, and not empty",
    );
  }
  const engine = addressOf("engine", execution.engine);
  assertEngineRunsCompiler("evm", engine);

  return {
    chainId,
    pot: addressOf("pot", execution.pot),
    engine,
    program: execution.program,
    value: uint256("value", execution.value ?? 0n),
    maxExecutionFee: uint256("maxExecutionFee", execution.maxExecutionFee),
    nonce: uint256("nonce", execution.nonce),
    deadline: uint256("deadline", execution.deadline),
    submitter: addressOf("submitter", execution.submitter ?? zeroAddress),
  };
}

/**
 * The typed data the owner of `pot` signs to let anyone run `program` there: domain `Sauce Pot`
 * (the Pot, the chain), message `Cook { engine, program, value, maxExecutionFee, nonce, deadline,
 * submitter }`. It is viem's `signTypedData` input as it stands, and `eth_signTypedData_v4`'s through
 * {@link signedCookTypedDataJson}:
 *
 * ```ts
 * const signature = await wallet.signTypedData(signedCookTypedData(cook));
 * const { to, data, value } = encodeCookSigned({ ...cook, signature }); // sent by anyone
 * ```
 *
 * Throws for a field `cookSigned` could not carry (an address that is not one, a number outside 256
 * bits, an empty program) and for an engine a release names for another compiler.
 */
export function signedCookTypedData(execution: SignedCookExecution) {
  const cook = resolved(execution);

  return {
    domain: { ...POT_SIGN_DOMAIN, chainId: cook.chainId, verifyingContract: cook.pot },
    types: COOK_TYPES,
    primaryType: "Cook",
    message: {
      engine: cook.engine,
      program: cook.program,
      value: cook.value,
      maxExecutionFee: cook.maxExecutionFee,
      nonce: cook.nonce,
      deadline: cook.deadline,
      submitter: cook.submitter,
    },
  } as const;
}

/** The 32-byte digest the owner's signature is over: what the Pot hashes in `cookSigned`. */
export function signedCookDigest(execution: SignedCookExecution): Hex {
  return hashTypedData(signedCookTypedData(execution));
}

/** {@link signedCookTypedData} as JSON, in `eth_signTypedData_v4`'s spelling: the domain's type
 *  written out, every number a decimal string. What a wallet that is not viem is handed. */
export function signedCookTypedDataJson(execution: SignedCookExecution) {
  const { domain, types, primaryType, message } = signedCookTypedData(execution);

  return {
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId.toString(),
      verifyingContract: domain.verifyingContract,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...types,
    },
    primaryType,
    message: {
      engine: message.engine,
      program: message.program,
      value: message.value.toString(),
      maxExecutionFee: message.maxExecutionFee.toString(),
      nonce: message.nonce.toString(),
      deadline: message.deadline.toString(),
      submitter: message.submitter,
    },
  } as const;
}

/** The call a Pot's `cookSigned` submits, for any account to send. */
export interface SignedCookTransaction {
  /** The Pot. */
  readonly to: Address;
  readonly data: Hex;
  /** Exactly the signed `value`: the Pot hashes what it is sent, so no other amount is accepted. The
   *  submitter pays gas on top, and nothing else; the Kitchen's fee is the Pot's. */
  readonly value: bigint;
}

/**
 * `cookSigned(engine, program, maxExecutionFee, nonce, deadline, submitter, signature)` on the Pot,
 * as `{ to: pot, data, value }`. Anyone sends it (only the named `submitter`, when there is one)
 * with `value` as the signed value and nothing on top: the Pot pays the Kitchen's fee itself, out of
 * its balance, which includes that value.
 *
 * The Pot answers raw: call it, and do not ABI-decode the result. Only a Private Pot minted under
 * this release has the call ({@link checkSignedCookPot}); an older one sends it on to its Router,
 * which reverts.
 */
export function encodeCookSigned(call: SignedCookCall): SignedCookTransaction {
  const cook = resolved(call);
  if (!isHex(call.signature)) {
    throw new Error(`signature is 0x hex, not ${String(call.signature)}`);
  }

  return {
    to: cook.pot,
    data: encodeFunctionData({
      abi: v12PotAbi,
      functionName: "cookSigned",
      args: [
        cook.engine,
        cook.program,
        cook.maxExecutionFee,
        cook.nonce,
        cook.deadline,
        cook.submitter,
        call.signature,
      ],
    }),
    value: cook.value,
  };
}

/**
 * `invalidateNonces(word, mask)` calldata: sets every bit of `mask` in nonce word `word`, so no
 * signature for those nonces runs. Sent to the Pot by its owner, or by the Pot itself from a cook
 * ({@link cookNonceMasks} turns nonces into words and masks). Bits are only ever set.
 */
export function encodeInvalidateNonces(word: bigint, mask: bigint): Hex {
  return encodeFunctionData({
    abi: v12PotAbi,
    functionName: "invalidateNonces",
    args: [uint256("word", word), uint256("mask", mask)],
  });
}

/** A fresh nonce: 256 random bits, which no two signatures share but by chance. A nonce in a word the
 *  Pot has not written costs its submitter about 17,000 gas more than one in a word it has. */
export function randomCookNonce(): bigint {
  return hexToBigInt(bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32))));
}

/** Where a nonce lives: bit `bit` of nonce word `word`, which is `mask` in that word. */
export interface CookNonceBit {
  readonly word: bigint;
  readonly bit: number;
  readonly mask: bigint;
}

/** The word and bit a nonce is recorded in: word `nonce >> 8`, bit `nonce & 255`. */
export function cookNonceWordBit(nonce: bigint): CookNonceBit {
  uint256("nonce", nonce);
  const bit = Number(nonce & 255n);

  return { word: nonce >> 8n, bit, mask: 1n << BigInt(bit) };
}

/** The nonce at `bit` of `word`: the inverse of {@link cookNonceWordBit}. */
export function cookNonceAt(word: bigint, bit: number): bigint {
  if (!Number.isInteger(bit) || bit < 0 || bit > 255) {
    throw new Error(`a nonce's bit is 0 to 255, not ${bit}`);
  }
  if (uint256("word", word) > UINT256_MAX >> 8n) {
    throw new Error(`a nonce word is below 2^248, not ${word}`);
  }

  return (word << 8n) | BigInt(bit);
}

/** `nonces` as the `(word, mask)` pairs `invalidateNonces` takes: one per word, every bit named. */
export function cookNonceMasks(
  nonces: readonly bigint[],
): readonly { readonly word: bigint; readonly mask: bigint }[] {
  const byWord = new Map<bigint, bigint>();
  for (const nonce of nonces) {
    const { word, mask } = cookNonceWordBit(nonce);
    byWord.set(word, (byWord.get(word) ?? 0n) | mask);
  }

  return [...byWord].map(([word, mask]) => ({ word, mask }));
}

/** The storage slot of nonce word `word` in a Pot, for `eth_getStorageAt`. */
export function cookNonceSlot(word: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }],
      [uint256("word", word), COOK_NONCES_LOCATION],
    ),
  );
}

/** Whether `nonce` is spent on `pot`: used by a signed cook, or cancelled. */
export async function cookNonceUsed(
  client: Pick<PublicClient, "getStorageAt">,
  pot: Address,
  nonce: bigint,
): Promise<boolean> {
  const { word, mask } = cookNonceWordBit(nonce);
  const stored = await client.getStorageAt({ address: pot, slot: cookNonceSlot(word) });

  return stored !== undefined && (hexToBigInt(stored) & mask) !== 0n;
}

/**
 * Whether `call.signature` is `owner`'s over this cook, as the Pot reads it: a 65-byte `r ‖ s ‖ v`
 * with `s` in the lower half of the curve order and `v` 27 or 28 that recovers `owner` (a compact
 * 64-byte signature, or `v` 0 or 1, is refused on chain, and here). An owner with code — a contract
 * wallet, or an EIP-7702 account — can sign through its ERC-1271 `isValidSignature` as well, which
 * only a chain can answer: given a `client`, it is asked when the key does not match. Its answer is
 * read as the Pot reads it (`Pot.sol` `_signedByOwner`): the call succeeds, returns at least 32
 * bytes, and the first word is the magic value with its other 28 bytes zero; anything after that
 * word is ignored.
 */
export async function verifySignedCook(
  call: SignedCookCall & { readonly owner: Address },
  client?: Pick<PublicClient, "call" | "getCode">,
): Promise<boolean> {
  const digest = signedCookDigest(call);
  const owner = addressOf("owner", call.owner);
  if (!isHex(call.signature)) return false;
  if (size(call.signature) === 65) {
    const s = hexToBigInt(slice(call.signature, 32, 64));
    const v = hexToBigInt(slice(call.signature, 64, 65));
    if (s <= SECP256K1_HALF_ORDER && (v === 27n || v === 28n)) {
      try {
        const signer = await recoverAddress({ hash: digest, signature: call.signature });
        if (getAddress(signer) === owner) return true;
      } catch {
        // A signature that recovers no key is not the owner's.
      }
    }
  }
  if (client === undefined || ((await client.getCode({ address: owner })) ?? "0x") === "0x") {
    return false;
  }
  try {
    const answer = await client.call({
      to: owner,
      data: encodeFunctionData({
        abi: erc1271Abi,
        functionName: "isValidSignature",
        args: [digest, call.signature],
      }),
    });

    if (answer.data === undefined || size(answer.data) < 32) return false;

    return slice(answer.data, 0, 32).toLowerCase() === ERC1271_MAGIC;
  } catch {
    return false;
  }
}

/** What {@link checkSignedCookPot} found. */
export type SignedCookPotCheck =
  { readonly ok: true; readonly owner: Address } | { readonly ok: false; readonly reason: string };

/**
 * Whether `pot` answers `cookSigned`: a Private Pot minted under this release, fixed Router or not.
 * `cookSigned` is in the Pot's creation code, so it moved the Pot init-code hash: a Pot is this
 * release's when its address derives from its Kitchen and `gateSalt()` under the pinned hash, read,
 * not assumed. An older Pot keeps its bytecode and has no `cookSigned` (a call to one goes to its
 * Router, which reverts); its owner signs for a Pot minted under this release. A Shared Pot has no
 * owner to sign, and refuses every signed cook.
 */
export async function checkSignedCookPot(
  client: Pick<PublicClient, "readContract" | "getCode">,
  pot: Address,
): Promise<SignedCookPotCheck> {
  if (((await client.getCode({ address: pot })) ?? "0x") === "0x") {
    return { ok: false, reason: `${pot} has no code: no Pot is deployed there` };
  }
  let owner: Address;
  let kitchen: Address;
  let gateSalt: Hex;
  try {
    [owner, kitchen, gateSalt] = await Promise.all([
      client.readContract({ address: pot, abi: v12PotAbi, functionName: "owner" }),
      client.readContract({ address: pot, abi: v12PotAbi, functionName: "kitchen" }),
      client.readContract({ address: pot, abi: v12PotAbi, functionName: "gateSalt" }),
    ]);
  } catch {
    return {
      ok: false,
      reason: `${pot} does not answer owner(), kitchen() and gateSalt(): it is not a Pot`,
    };
  }
  if (owner === zeroAddress) {
    return {
      ok: false,
      reason: `${pot} is a Shared Pot: it has no owner to sign, and anyone may cook it directly`,
    };
  }
  const derived = getCreate2Address({
    from: kitchen,
    salt: gateSalt,
    bytecodeHash: v12PotDerivation().initCodeHash as Hex,
  });
  if (derived !== getAddress(pot)) {
    return {
      ok: false,
      reason:
        `${pot} was minted before signed cooks (its address does not derive under this release's ` +
        "Pot init-code hash) and has no cookSigned: sign for a Pot minted under this release",
    };
  }

  return { ok: true, owner: getAddress(owner) };
}

/** Ready-to-use V12Kitchen handle: the viem ABI plus calldata encoders. */
export const v12Kitchen = {
  abi: v12KitchenAbi,
  /** Encode `deployPot(owner, salt)` calldata. `owner` is baked into the Pot's CREATE2 address. */
  encodeDeployPot: (owner: Address, salt: Hex): Hex =>
    encodeFunctionData({ abi: v12KitchenAbi, functionName: "deployPot", args: [owner, salt] }),
  /** Encode `predictPot(owner, salt)` calldata (a view call returning the Pot address). */
  encodePredictPot: (owner: Address, salt: Hex): Hex =>
    encodeFunctionData({ abi: v12KitchenAbi, functionName: "predictPot", args: [owner, salt] }),
} as const;

/** The one read {@link potRouterUpdate} needs from a client — viem's `PublicClient` has it. */
export type PotRouterClient = Pick<PublicClient, "readContract">;

/** The call that points a Pot at its Kitchen's current Router — for the Pot's OWNER to sign. */
export interface PotRouterUpdate {
  readonly to: Address;
  readonly data: Hex;
}

/**
 * Whether `pot` runs its Kitchen's current Router, and if not, the call that switches it.
 *
 * Reads `pot.router()` and the Kitchen's `router()` through `client` — the caller's, since the SDK
 * holds no RPC endpoint — and returns `undefined` when they are the same Router, or the
 * `pot.setRouter(kitchenRouter)` call otherwise. It never sends anything, and the Router's address
 * never passes through the caller: the Kitchen names it.
 *
 * **Only the Pot's owner can make this call** — `setRouter` has `cook`'s gate and reverts
 * `NotOwner()` for anyone else — and nothing makes it on the owner's behalf: **the Kitchen cannot
 * move an existing Pot.** Its owner's `setRouter` changes the Router Pots minted afterwards start on,
 * never a deployed Pot's, so a Router rollout reaches an existing Pot only when its owner signs this.
 *
 * Throws for a Pot this SDK's release does not mint: one minted before the Router moved into Pot
 * storage has no `setRouter` at all and keeps its Router for good, so any call built for it would
 * revert. A Pot is this release's when its address derives from its owner and salt under the pinned
 * init-code hash, which is read, not assumed.
 */
export async function potRouterUpdate(
  client: PotRouterClient,
  pot: Address,
): Promise<PotRouterUpdate | undefined> {
  const [current, kitchen, owner, salt] = await Promise.all([
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "router" }),
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "kitchen" }),
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "owner" }),
    client.readContract({ address: pot, abi: v12PotAbi, functionName: "userSalt" }),
  ]);
  if (v12PredictPot(owner, salt, kitchen) !== getAddress(pot)) {
    throw new Error(
      `potRouterUpdate: ${pot} is not a Pot of the pinned Kitchen release — its address does not ` +
        "derive from its owner and salt under the release's Pot init-code hash. A Pot minted " +
        "before the Router moved into Pot storage has no setRouter and keeps its Router for good.",
    );
  }
  const target = await client.readContract({
    address: kitchen,
    abi: v12KitchenAbi,
    functionName: "router",
  });
  if (getAddress(current) === getAddress(target)) return undefined;

  return {
    to: getAddress(pot),
    data: encodeFunctionData({ abi: v12PotAbi, functionName: "setRouter", args: [target] }),
  };
}

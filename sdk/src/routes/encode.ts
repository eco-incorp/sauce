/**
 * eco-routes on-chain encoding — E3.2.
 *
 * Encodes the runtime `Route`/`Reward`/`Intent` shapes (`types.ts`) into the
 * exact on-chain bytes each chain KIND expects, and computes the intent hash
 * the Portal contracts commit to. Forks by `ChainKind` (`../chains/canonical.js`):
 *
 *  - `evm` (and, for now, `tvm` — see the module doc risk note below) uses
 *    viem `encodeAbiParameters` against the deployed Portal ABI's `Route`/
 *    `Reward` tuple shapes.
 *  - `svm` uses a Borsh schema built from `@solana/kit` codecs, replicating
 *    the Portal IDL's `Route`/`Reward`/`TokenAmount`/`Call`/`Bytes32` types.
 *    SVM `Call` has no `value` field.
 *
 * SVM PARITY CAVEAT (read before trusting this for a real on-chain intent):
 * the SVM codec below is a standard Borsh schema built with `@solana/kit`,
 * replicating the Portal IDL's declared `Route`/`Reward`/`TokenAmount`/`Call`/
 * `Bytes32` layout (field order, u64 widths, u32-length-prefixed vecs). The
 * golden vector in `routes-encode.test.ts` was computed from THIS schema and
 * is independently checkable as correct standard Borsh — it was NOT produced
 * by running a real `@coral-xyz/anchor` `BorshCoder`. So it pins the schema
 * against regressions, but does NOT prove parity with the deployed Portal
 * program's serializer on any cluster, and is NOT an on-chain integration
 * test. Closing that gap needs one real vector (a mainnet `publish`/
 * `publishAndFund` whose emitted `intentHash` this module reproduces) —
 * recommended as a follow-up, not bundled here.
 *
 * `ChainKind` is currently `"evm" | "svm"` only — there is no `"tvm"`. A Tron
 * (or other TVM) chain reaching this module today must already be registered
 * with `kind: "evm"` (encoding-correct: TVM ABI-encodes identically to EVM;
 * identity-misleading) or this fork has nothing to dispatch on.
 */
import {
  encodeAbiParameters,
  decodeAbiParameters,
  keccak256,
  encodePacked,
  hexToBytes,
  bytesToHex,
  type AbiParameter,
  type Hex,
} from "viem";
import {
  getStructCodec,
  getBytesCodec,
  fixCodecSize,
  addCodecSizePrefix,
  getU32Codec,
  getU64Codec,
  getArrayCodec,
  type Codec,
} from "@solana/kit";

import { type CanonicalChain, type ChainKind, requireChain } from "../chains/canonical.js";
import { toUniversalAddress } from "./normalize.js";
import type { Call, Intent, Reward, Route, TokenAmount, UniversalAddress } from "./types.js";

// ---------------------------------------------------------------------------
// Chain-kind resolution
// ---------------------------------------------------------------------------

/** Anything that can select which encoding fork to use: an explicit kind, or anything `resolveChain` accepts
 *  — including a native `bigint` chain id (eco-routes `Intent.destination`/`sourceChainId` are bigint), so a
 *  caller can pass those straight through without a silent evm mis-classification. */
export type ChainKindRef = ChainKind | number | bigint | string | CanonicalChain;

const CHAIN_KINDS = new Set<string>(["evm", "svm"]);

function isChainKindLiteral(ref: ChainKindRef): ref is ChainKind {
  return typeof ref === "string" && CHAIN_KINDS.has(ref);
}

/**
 * Resolves a `ChainKindRef` to a `ChainKind`. An explicit `"evm"`/`"svm"`
 * literal is returned as-is (the escape hatch for a chain id not yet in the
 * canonical registry). Anything else is looked up via `requireChain`, which
 * THROWS for an unregistered id — this never silently defaults to `"evm"`.
 */
export function kindOf(ref: ChainKindRef): ChainKind {
  if (isChainKindLiteral(ref)) return ref;
  return requireChain(ref).kind;
}

// ---------------------------------------------------------------------------
// EVM/TVM path — viem ABI encoding
// ---------------------------------------------------------------------------

const EVM_TOKEN_AMOUNT_COMPONENT = {
  type: "tuple",
  components: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

const EVM_CALL_COMPONENT = {
  type: "tuple",
  components: [
    { name: "target", type: "address" },
    { name: "data", type: "bytes" },
    { name: "value", type: "uint256" },
  ],
} as const;

/** The deployed Portal `Route` tuple shape (`fulfillAndProve.inputs[1]`). */
export const EVM_ROUTE_PARAM = {
  name: "route",
  type: "tuple",
  components: [
    { name: "salt", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "portal", type: "address" },
    { name: "nativeAmount", type: "uint256" },
    { name: "tokens", type: "tuple[]", components: EVM_TOKEN_AMOUNT_COMPONENT.components },
    { name: "calls", type: "tuple[]", components: EVM_CALL_COMPONENT.components },
  ],
} as const satisfies AbiParameter;

/** The deployed Portal `Reward` tuple shape (`publish.inputs[2]`). */
export const EVM_REWARD_PARAM = {
  name: "reward",
  type: "tuple",
  components: [
    { name: "deadline", type: "uint64" },
    { name: "creator", type: "address" },
    { name: "prover", type: "address" },
    { name: "nativeAmount", type: "uint256" },
    { name: "tokens", type: "tuple[]", components: EVM_TOKEN_AMOUNT_COMPONENT.components },
  ],
} as const satisfies AbiParameter;

/**
 * Narrows a 32-byte `UniversalAddress` to a 20-byte EVM address. Throws
 * (rather than silently truncating) if the leading 12 bytes aren't zero —
 * that shape means the address is not EVM-representable (e.g. a real SVM
 * pubkey), and truncating it would produce a plausible-looking but wrong hash.
 */
export function denormalizeToEvm(u: UniversalAddress): Hex {
  const bytes = hexToBytes(u);
  if (bytes.length !== 32) {
    throw new Error(
      `denormalizeToEvm: expected a 32-byte UniversalAddress, got ${bytes.length} bytes`,
    );
  }
  for (let i = 0; i < 12; i++) {
    if (bytes[i] !== 0) {
      throw new Error(
        `denormalizeToEvm: '${u}' is not EVM-representable (nonzero high 12 bytes) — check the destination chain`,
      );
    }
  }
  return bytesToHex(bytes.slice(12)) as Hex;
}

function assertSalt32(salt: Hex): void {
  if (hexToBytes(salt).length !== 32) {
    throw new Error(`Invalid salt: expected 32 bytes, got '${salt}'`);
  }
}

function evmTokenAmount(t: TokenAmount) {
  return { token: denormalizeToEvm(t.token), amount: t.amount };
}

function evmCall(c: Call) {
  return { target: denormalizeToEvm(c.target), data: c.data, value: c.value };
}

/** Encodes a `Route` for an EVM (or TVM) destination via the deployed Portal ABI shape. */
export function encodeRouteEvm(route: Route): Hex {
  assertSalt32(route.salt);
  return encodeAbiParameters(
    [EVM_ROUTE_PARAM],
    [
      {
        salt: route.salt,
        deadline: route.deadline,
        portal: denormalizeToEvm(route.portal),
        nativeAmount: route.nativeAmount,
        tokens: route.tokens.map(evmTokenAmount),
        calls: route.calls.map(evmCall),
      },
    ],
  );
}

/** Encodes a `Reward` for an EVM (or TVM) source via the deployed Portal ABI shape. */
export function encodeRewardEvm(reward: Reward): Hex {
  return encodeAbiParameters(
    [EVM_REWARD_PARAM],
    [
      {
        deadline: reward.deadline,
        creator: denormalizeToEvm(reward.creator),
        prover: denormalizeToEvm(reward.prover),
        nativeAmount: reward.nativeAmount,
        tokens: reward.tokens.map(evmTokenAmount),
      },
    ],
  );
}

/** Decodes a `Route` previously produced by `encodeRouteEvm`, re-normalizing addresses back to 32-byte form. */
export function decodeRouteEvm(encoded: Hex): Route {
  const [decoded] = decodeAbiParameters([EVM_ROUTE_PARAM], encoded);
  return {
    salt: decoded.salt,
    deadline: decoded.deadline,
    portal: toUniversalAddress(decoded.portal),
    nativeAmount: decoded.nativeAmount,
    tokens: decoded.tokens.map((t: { token: Hex; amount: bigint }) => ({
      token: toUniversalAddress(t.token),
      amount: t.amount,
    })),
    calls: decoded.calls.map((c: { target: Hex; data: Hex; value: bigint }) => ({
      target: toUniversalAddress(c.target),
      data: c.data,
      value: c.value,
    })),
  };
}

/** Decodes a `Reward` previously produced by `encodeRewardEvm`, re-normalizing addresses back to 32-byte form. */
export function decodeRewardEvm(encoded: Hex): Reward {
  const [decoded] = decodeAbiParameters([EVM_REWARD_PARAM], encoded);
  return {
    deadline: decoded.deadline,
    creator: toUniversalAddress(decoded.creator),
    prover: toUniversalAddress(decoded.prover),
    nativeAmount: decoded.nativeAmount,
    tokens: decoded.tokens.map((t: { token: Hex; amount: bigint }) => ({
      token: toUniversalAddress(t.token),
      amount: t.amount,
    })),
  };
}

// ---------------------------------------------------------------------------
// SVM path — Borsh via @solana/kit codecs
// ---------------------------------------------------------------------------

const MAX_U64 = 2n ** 64n - 1n;

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > MAX_U64) {
    throw new Error(`${label}: value ${value} does not fit in a u64 (Portal IDL field)`);
  }
}

/** `Bytes32` (and a raw pubkey) — 32 raw bytes, Borsh fixed-size. */
const svmBytes32 = fixCodecSize(getBytesCodec(), 32);

const svmU64 = getU64Codec();
const svmU32 = getU32Codec();

/** Borsh `Vec<T>` = a u32 LE element count followed by each element, pinned explicitly. */
function svmVec<TFrom, TTo extends TFrom = TFrom>(
  itemCodec: Codec<TFrom, TTo>,
): Codec<TFrom[], TTo[]> {
  return getArrayCodec(itemCodec, { size: svmU32 });
}

interface SvmTokenAmount {
  readonly token: Uint8Array;
  readonly amount: bigint;
}

interface SvmCall {
  readonly target: Uint8Array;
  readonly data: Uint8Array;
}

interface SvmRoute {
  readonly salt: Uint8Array;
  readonly deadline: bigint;
  readonly portal: Uint8Array;
  readonly nativeAmount: bigint;
  readonly tokens: SvmTokenAmount[];
  readonly calls: SvmCall[];
}

interface SvmReward {
  readonly deadline: bigint;
  readonly creator: Uint8Array;
  readonly prover: Uint8Array;
  readonly nativeAmount: bigint;
  readonly tokens: SvmTokenAmount[];
}

/**
 * Codecs are declared without an explicit `Codec<T>` annotation: `@solana/kit`
 * decodes a fixed-size byte field as its own `ReadonlyUint8Array` variant,
 * which isn't structurally assignable to a plain `Uint8Array`-typed field —
 * pinning the annotation would fight that instead of just letting it infer.
 * `encode()`/`decode()` call sites below convert at the boundary instead
 * (`toBytes`, and a plain-`Uint8Array` input object, which IS assignable the
 * other direction).
 */

/** Portal IDL `TokenAmount { token: Bytes32, amount: u64 }`. */
export const svmTokenAmountCodec = getStructCodec([
  ["token", svmBytes32],
  ["amount", svmU64],
]);

/** Portal IDL `Call { target: Bytes32, data: bytes }` — NO `value` field. */
export const svmCallCodec = getStructCodec([
  ["target", svmBytes32],
  ["data", addCodecSizePrefix(getBytesCodec(), svmU32)],
]);

/** Portal IDL `Route { salt, deadline, portal, native_amount, tokens, calls }`, field order per the IDL. */
export const svmRouteCodec = getStructCodec([
  ["salt", svmBytes32],
  ["deadline", svmU64],
  ["portal", svmBytes32],
  ["nativeAmount", svmU64],
  ["tokens", svmVec(svmTokenAmountCodec)],
  ["calls", svmVec(svmCallCodec)],
]);

/** Portal IDL `Reward { deadline, creator, prover, native_amount, tokens }`, field order per the IDL. */
export const svmRewardCodec = getStructCodec([
  ["deadline", svmU64],
  ["creator", svmBytes32],
  ["prover", svmBytes32],
  ["nativeAmount", svmU64],
  ["tokens", svmVec(svmTokenAmountCodec)],
]);

/** A `UniversalAddress` is already the 32 raw bytes the Portal IDL wants — identity, no base58 hop. */
function denormalizeToSvm(u: UniversalAddress): Uint8Array {
  const bytes = hexToBytes(u);
  if (bytes.length !== 32) {
    throw new Error(
      `denormalizeToSvm: expected a 32-byte UniversalAddress, got ${bytes.length} bytes`,
    );
  }
  return bytes;
}

function svmTokenAmountOf(t: TokenAmount): SvmTokenAmount {
  assertU64(t.amount, "TokenAmount.amount");
  return { token: denormalizeToSvm(t.token), amount: t.amount };
}

function svmCallOf(c: Call): SvmCall {
  if (c.value !== 0n) {
    throw new Error(
      "encodeRouteSvm: SVM Call has no value field (nonzero Call.value cannot be encoded)",
    );
  }
  return { target: denormalizeToSvm(c.target), data: hexToBytes(c.data) };
}

/** Encodes a `Route` for an SVM destination via the Portal IDL's Borsh layout. */
export function encodeRouteSvm(route: Route): Hex {
  assertSalt32(route.salt);
  assertU64(route.deadline, "Route.deadline");
  assertU64(route.nativeAmount, "Route.nativeAmount");
  const value: SvmRoute = {
    salt: hexToBytes(route.salt),
    deadline: route.deadline,
    portal: denormalizeToSvm(route.portal),
    nativeAmount: route.nativeAmount,
    tokens: route.tokens.map(svmTokenAmountOf),
    calls: route.calls.map(svmCallOf),
  };
  return bytesToHex(toBytes(svmRouteCodec.encode(value)));
}

/** Encodes a `Reward` for an SVM source via the Portal IDL's Borsh layout. */
export function encodeRewardSvm(reward: Reward): Hex {
  assertU64(reward.deadline, "Reward.deadline");
  assertU64(reward.nativeAmount, "Reward.nativeAmount");
  const value: SvmReward = {
    deadline: reward.deadline,
    creator: denormalizeToSvm(reward.creator),
    prover: denormalizeToSvm(reward.prover),
    nativeAmount: reward.nativeAmount,
    tokens: reward.tokens.map(svmTokenAmountOf),
  };
  return bytesToHex(toBytes(svmRewardCodec.encode(value)));
}

/**
 * Materializes any (possibly readonly, kit-branded) byte view into a plain
 * mutable `Uint8Array` for viem's `bytesToHex`. Untyped input on purpose: the
 * decode side of a `@solana/kit` fixed-size codec returns its own
 * `ReadonlyUint8Array` variant, which is not structurally assignable to
 * `Uint8Array` even though it is one at runtime (`Uint8Array.from` copies
 * either way, so this is correct regardless of which variant is passed).
 */
function toBytes(view: unknown): Uint8Array {
  return Uint8Array.from(view as ArrayLike<number>);
}

/** Decodes a `Route` previously produced by `encodeRouteSvm`. `calls[].value` is reconstituted as `0n`. */
export function decodeRouteSvm(encoded: Hex): Route {
  const decoded = svmRouteCodec.decode(hexToBytes(encoded));
  return {
    salt: bytesToHex(toBytes(decoded.salt)),
    deadline: decoded.deadline,
    portal: toUniversalAddress(bytesToHex(toBytes(decoded.portal))),
    nativeAmount: decoded.nativeAmount,
    tokens: decoded.tokens.map((t) => ({
      token: toUniversalAddress(bytesToHex(toBytes(t.token))),
      amount: t.amount,
    })),
    calls: decoded.calls.map((c) => ({
      target: toUniversalAddress(bytesToHex(toBytes(c.target))),
      data: bytesToHex(toBytes(c.data)),
      value: 0n,
    })),
  };
}

/** Decodes a `Reward` previously produced by `encodeRewardSvm`. */
export function decodeRewardSvm(encoded: Hex): Reward {
  const decoded = svmRewardCodec.decode(hexToBytes(encoded));
  return {
    deadline: decoded.deadline,
    creator: toUniversalAddress(bytesToHex(toBytes(decoded.creator))),
    prover: toUniversalAddress(bytesToHex(toBytes(decoded.prover))),
    nativeAmount: decoded.nativeAmount,
    tokens: decoded.tokens.map((t) => ({
      token: toUniversalAddress(bytesToHex(toBytes(t.token))),
      amount: t.amount,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fork + intent hash
// ---------------------------------------------------------------------------

/** Encodes a `Route` for the given chain, forking by `ChainKind`. */
export function encodeRoute(route: Route, chain: ChainKindRef): Hex {
  return kindOf(chain) === "svm" ? encodeRouteSvm(route) : encodeRouteEvm(route);
}

/** Encodes a `Reward` for the given chain, forking by `ChainKind`. */
export function encodeReward(reward: Reward, chain: ChainKindRef): Hex {
  return kindOf(chain) === "svm" ? encodeRewardSvm(reward) : encodeRewardEvm(reward);
}

/** Decodes a `Route` for the given chain, forking by `ChainKind`. */
export function decodeRoute(encoded: Hex, chain: ChainKindRef): Route {
  return kindOf(chain) === "svm" ? decodeRouteSvm(encoded) : decodeRouteEvm(encoded);
}

/** Decodes a `Reward` for the given chain, forking by `ChainKind`. */
export function decodeReward(encoded: Hex, chain: ChainKindRef): Reward {
  return kindOf(chain) === "svm" ? decodeRewardSvm(encoded) : decodeRewardEvm(encoded);
}

/** Encodes an `Intent`'s route (for `intent.destination`) and reward (for `intent.sourceChainId`). */
export function encodeIntent(intent: Intent): { route: Hex; reward: Hex } {
  return {
    route: encodeRoute(intent.route, chainIdRefOf(intent.destination)),
    reward: encodeReward(intent.reward, chainIdRefOf(intent.sourceChainId)),
  };
}

/** `keccak256(encodeRoute(route, destination))`. */
export function routeHash(route: Route, destination: ChainKindRef): Hex {
  return keccak256(encodeRoute(route, destination));
}

/** `keccak256(encodeReward(reward, source))`. */
export function rewardHash(reward: Reward, source: ChainKindRef): Hex {
  return keccak256(encodeReward(reward, source));
}

export interface IntentHashes {
  readonly intentHash: Hex;
  readonly routeHash: Hex;
  readonly rewardHash: Hex;
}

const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER);

function chainIdRefOf(id: bigint): number {
  if (id < 0n || id > MAX_SAFE_CHAIN_ID) {
    throw new Error(`hashIntent: chain id ${id} is out of safe-integer range`);
  }
  return Number(id);
}

/**
 * Computes the eco-routes intent hash: `keccak256(abi.encodePacked(uint64
 * destination, bytes32 routeHash, bytes32 rewardHash))`, with the route
 * encoded for `intent.destination`'s kind and the reward encoded for
 * `intent.sourceChainId`'s kind — the asymmetry that makes a cross-VM
 * (e.g. EVM source -> SVM destination) leg hash correctly.
 */
export function hashIntent(intent: Intent): IntentHashes {
  const rHash = routeHash(intent.route, chainIdRefOf(intent.destination));
  const wHash = rewardHash(intent.reward, chainIdRefOf(intent.sourceChainId));
  const intentHashValue = keccak256(
    encodePacked(["uint64", "bytes32", "bytes32"], [intent.destination, rHash, wHash]),
  );
  return { intentHash: intentHashValue, routeHash: rHash, rewardHash: wHash };
}

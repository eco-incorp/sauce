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
import { type Hex } from "viem";
import { type CanonicalChain, type ChainKind } from "../chains/canonical.js";
import type { Intent, Reward, Route, UniversalAddress } from "./types.js";
/** Anything that can select which encoding fork to use: an explicit kind, or anything `resolveChain` accepts
 *  — including a native `bigint` chain id (eco-routes `Intent.destination`/`sourceChainId` are bigint), so a
 *  caller can pass those straight through without a silent evm mis-classification. */
export type ChainKindRef = ChainKind | number | bigint | string | CanonicalChain;
/**
 * Resolves a `ChainKindRef` to a `ChainKind`. An explicit `"evm"`/`"svm"`
 * literal is returned as-is (the escape hatch for a chain id not yet in the
 * canonical registry). Anything else is looked up via `requireChain`, which
 * THROWS for an unregistered id — this never silently defaults to `"evm"`.
 */
export declare function kindOf(ref: ChainKindRef): ChainKind;
/** The deployed Portal `Route` tuple shape (`fulfillAndProve.inputs[1]`). */
export declare const EVM_ROUTE_PARAM: {
    readonly name: "route";
    readonly type: "tuple";
    readonly components: readonly [{
        readonly name: "salt";
        readonly type: "bytes32";
    }, {
        readonly name: "deadline";
        readonly type: "uint64";
    }, {
        readonly name: "portal";
        readonly type: "address";
    }, {
        readonly name: "nativeAmount";
        readonly type: "uint256";
    }, {
        readonly name: "tokens";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
        }];
    }, {
        readonly name: "calls";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "target";
            readonly type: "address";
        }, {
            readonly name: "data";
            readonly type: "bytes";
        }, {
            readonly name: "value";
            readonly type: "uint256";
        }];
    }];
};
/** The deployed Portal `Reward` tuple shape (`publish.inputs[2]`). */
export declare const EVM_REWARD_PARAM: {
    readonly name: "reward";
    readonly type: "tuple";
    readonly components: readonly [{
        readonly name: "deadline";
        readonly type: "uint64";
    }, {
        readonly name: "creator";
        readonly type: "address";
    }, {
        readonly name: "prover";
        readonly type: "address";
    }, {
        readonly name: "nativeAmount";
        readonly type: "uint256";
    }, {
        readonly name: "tokens";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
        }];
    }];
};
/**
 * Narrows a 32-byte `UniversalAddress` to a 20-byte EVM address. Throws
 * (rather than silently truncating) if the leading 12 bytes aren't zero —
 * that shape means the address is not EVM-representable (e.g. a real SVM
 * pubkey), and truncating it would produce a plausible-looking but wrong hash.
 */
export declare function denormalizeToEvm(u: UniversalAddress): Hex;
/** Encodes a `Route` for an EVM (or TVM) destination via the deployed Portal ABI shape. */
export declare function encodeRouteEvm(route: Route): Hex;
/** Encodes a `Reward` for an EVM (or TVM) source via the deployed Portal ABI shape. */
export declare function encodeRewardEvm(reward: Reward): Hex;
/** Decodes a `Route` previously produced by `encodeRouteEvm`, re-normalizing addresses back to 32-byte form. */
export declare function decodeRouteEvm(encoded: Hex): Route;
/** Decodes a `Reward` previously produced by `encodeRewardEvm`, re-normalizing addresses back to 32-byte form. */
export declare function decodeRewardEvm(encoded: Hex): Reward;
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
export declare const svmTokenAmountCodec: import("@solana/kit").FixedSizeCodec<{
    token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    amount: number | bigint;
}, {
    token: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    amount: bigint;
} & {
    token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    amount: number | bigint;
}>;
/** Portal IDL `Call { target: Bytes32, data: bytes }` — NO `value` field. */
export declare const svmCallCodec: import("@solana/kit").VariableSizeCodec<{
    target: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    data: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
}, {
    target: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    data: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
} & {
    target: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    data: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
}>;
/** Portal IDL `Route { salt, deadline, portal, native_amount, tokens, calls }`, field order per the IDL. */
export declare const svmRouteCodec: import("@solana/kit").VariableSizeCodec<{
    salt: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    deadline: number | bigint;
    portal: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    nativeAmount: number | bigint;
    calls: {
        target: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        data: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    }[];
    tokens: {
        token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: number | bigint;
    }[];
}, {
    salt: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    deadline: bigint;
    portal: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    nativeAmount: bigint;
    calls: ({
        target: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        data: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    } & {
        target: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        data: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    })[];
    tokens: ({
        token: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: bigint;
    } & {
        token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: number | bigint;
    })[];
} & {
    salt: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    deadline: number | bigint;
    portal: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    nativeAmount: number | bigint;
    calls: {
        target: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        data: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    }[];
    tokens: {
        token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: number | bigint;
    }[];
}>;
/** Portal IDL `Reward { deadline, creator, prover, native_amount, tokens }`, field order per the IDL. */
export declare const svmRewardCodec: import("@solana/kit").VariableSizeCodec<{
    deadline: number | bigint;
    creator: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    prover: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    nativeAmount: number | bigint;
    tokens: {
        token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: number | bigint;
    }[];
}, {
    deadline: bigint;
    creator: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    prover: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    nativeAmount: bigint;
    tokens: ({
        token: import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: bigint;
    } & {
        token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: number | bigint;
    })[];
} & {
    deadline: number | bigint;
    creator: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    prover: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
    nativeAmount: number | bigint;
    tokens: {
        token: Uint8Array<ArrayBufferLike> | import("@solana/kit").ReadonlyUint8Array<ArrayBufferLike>;
        amount: number | bigint;
    }[];
}>;
/** Encodes a `Route` for an SVM destination via the Portal IDL's Borsh layout. */
export declare function encodeRouteSvm(route: Route): Hex;
/** Encodes a `Reward` for an SVM source via the Portal IDL's Borsh layout. */
export declare function encodeRewardSvm(reward: Reward): Hex;
/** Decodes a `Route` previously produced by `encodeRouteSvm`. `calls[].value` is reconstituted as `0n`. */
export declare function decodeRouteSvm(encoded: Hex): Route;
/** Decodes a `Reward` previously produced by `encodeRewardSvm`. */
export declare function decodeRewardSvm(encoded: Hex): Reward;
/** Encodes a `Route` for the given chain, forking by `ChainKind`. */
export declare function encodeRoute(route: Route, chain: ChainKindRef): Hex;
/** Encodes a `Reward` for the given chain, forking by `ChainKind`. */
export declare function encodeReward(reward: Reward, chain: ChainKindRef): Hex;
/** Decodes a `Route` for the given chain, forking by `ChainKind`. */
export declare function decodeRoute(encoded: Hex, chain: ChainKindRef): Route;
/** Decodes a `Reward` for the given chain, forking by `ChainKind`. */
export declare function decodeReward(encoded: Hex, chain: ChainKindRef): Reward;
/** Encodes an `Intent`'s route (for `intent.destination`) and reward (for `intent.sourceChainId`). */
export declare function encodeIntent(intent: Intent): {
    route: Hex;
    reward: Hex;
};
/** `keccak256(encodeRoute(route, destination))`. */
export declare function routeHash(route: Route, destination: ChainKindRef): Hex;
/** `keccak256(encodeReward(reward, source))`. */
export declare function rewardHash(reward: Reward, source: ChainKindRef): Hex;
export interface IntentHashes {
    readonly intentHash: Hex;
    readonly routeHash: Hex;
    readonly rewardHash: Hex;
}
/**
 * Computes the eco-routes intent hash: `keccak256(abi.encodePacked(uint64
 * destination, bytes32 routeHash, bytes32 rewardHash))`, with the route
 * encoded for `intent.destination`'s kind and the reward encoded for
 * `intent.sourceChainId`'s kind — the asymmetry that makes a cross-VM
 * (e.g. EVM source -> SVM destination) leg hash correctly.
 */
export declare function hashIntent(intent: Intent): IntentHashes;
//# sourceMappingURL=encode.d.ts.map
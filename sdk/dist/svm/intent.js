// @eco-incorp/sauce-sdk/svm/verify — extract settle params from an Eco intent's SVM calls.
//
// The EVM twin (`@eco-incorp/sauce-sdk/verify`'s `extractEvmSettleFromIntent`) reads the settle program
// straight out of a `Pot.cook(bytes[])` call, because an EVM intent's `route.calls[].data` is plain ABI
// calldata. An SVM intent is one wrapper deeper: each `route.calls[].data` is the Eco **Portal**
// program's `CalldataWithAccounts` Borsh envelope — `{ calldata: { data, account_count }, accounts:
// [{ pubkey, is_signer, is_writable }] }` — where `calldata.data` is the Sauce engine's
// `execute_from_account` instruction data (`[disc][flags][pin?][slice?][args]`) and `accounts` is that
// instruction's account list. This module decodes that envelope and hands the two halves to
// `decodeSvmSettleExecution` / `verifySvmSettleExecution`, so an external partner goes from a published
// intent to `(minOut, splCount, tokenProgram0/1)` + resolved account identities with ONLY this package.
//
// WHY THIS LIVES IN THE SDK (not in a solver adapter): this surface is for partners CONSUMING Eco
// intents, who have neither the solver's internals nor its `decodeRouteCall`. So the Portal envelope
// layout is mirrored here — it is a small, stable on-chain Anchor struct (Portal program IDL), decoded
// with `@solana/kit` codecs (no new dependency). `test/svm/intent.test.ts` pins the byte layout against
// a hand-built fixture so a Portal IDL change can't drift it silently.
//
// GENUINENESS WITHOUT PARTNER BYTECODE. A staged settle carries no structural signature (unlike EVM's
// prologue), so "right shape" is NOT "is a settle" — a non-settle staged execute, or an adversarial
// decoy, has the same shape. The extraction here therefore does not trust shape: it recompiles the
// canonical `svmSettleSource(N)` ITSELF and requires the calldata pin to equal `sha256(canonical settle)`
// (or, if the caller passes the staged `bytecode` from `fulfillmentMetadata.svm.sauceStage`, a full
// byte-match). A partner needs no bytecode to get a genuine verdict; a decoy is REJECTED, not returned.
import { addDecoderSizePrefix, addEncoderSizePrefix, getArrayDecoder, getArrayEncoder, getAddressDecoder, getAddressEncoder, getBooleanDecoder, getBooleanEncoder, getBytesDecoder, getBytesEncoder, getStructDecoder, getStructEncoder, getU8Decoder, getU8Encoder, getU32Decoder, getU32Encoder, } from '@solana/kit';
import { verifySvmSettleExecution } from './verify.js';
// Borsh (Anchor): `bytes` = u32 LE length prefix + bytes; `Vec<T>` = u32 LE length + elements;
// `bool` = 1 byte; `pubkey` = 32 bytes; `u8` = 1 byte. Field order is the IDL struct order.
const calldataDecoder = getStructDecoder([
    ['data', addDecoderSizePrefix(getBytesDecoder(), getU32Decoder())],
    ['accountCount', getU8Decoder()],
]);
const accountMetaDecoder = getStructDecoder([
    ['pubkey', getAddressDecoder()],
    ['isSigner', getBooleanDecoder()],
    ['isWritable', getBooleanDecoder()],
]);
const calldataWithAccountsDecoder = getStructDecoder([
    ['calldata', calldataDecoder],
    ['accounts', getArrayDecoder(accountMetaDecoder, { size: getU32Decoder() })],
]);
function toBytes(input, label) {
    if (input instanceof Uint8Array)
        return input;
    if (typeof input !== 'string')
        throw new Error(`${label} must be a Uint8Array or string, got ${typeof input}`);
    if (input.startsWith('0x') || input.startsWith('0X')) {
        const hex = input.slice(2);
        if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex))
            throw new Error(`${label} is not valid 0x-hex`);
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++)
            out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return out;
    }
    // Not 0x-prefixed → base64 (Buffer is available; this module is node-side like the rest of svm/verify).
    return new Uint8Array(Buffer.from(input, 'base64'));
}
/**
 * Decodes a Portal `CalldataWithAccounts` envelope (the form of every SVM `route.calls[].data`) into the
 * wrapped instruction data and its account list. Accepts the envelope as raw bytes, `0x`-hex (the viem
 * `Hex` a call carries), or base64. Throws on a truncated / malformed envelope.
 */
export function decodePortalCalldataWithAccounts(data) {
    const bytes = toBytes(data, 'portal calldata');
    const decoded = calldataWithAccountsDecoder.decode(bytes);
    // Both `account_count` (the Calldata field) and the attached `accounts` vec length are decoded and
    // surfaced; they are NOT asserted equal here. eco-solver's own `decodeRouteCall` does not enforce it
    // either, and the exact `account_count` semantics for the settle envelope (whether it counts the
    // leading buffer account) are not something to hard-fail a partner's decode on — a caller that wants
    // the check can compare `accountCount` against `accounts.length` itself.
    return {
        // @solana/kit's bytes decoder yields a ReadonlyUint8Array — copy to a plain Uint8Array so the
        // downstream payload parser (subarray / DataView) has a mutable, standard view.
        instructionData: new Uint8Array(decoded.calldata.data),
        accountCount: decoded.calldata.accountCount,
        accounts: decoded.accounts.map((a) => ({ pubkey: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable })),
    };
}
// Encoder side of the exact same envelope — kept beside the decoder above so the Portal
// `CalldataWithAccounts` Borsh layout has exactly one source of truth (field order, u32-length
// prefixes, u8 account_count, u32-length-prefixed accounts vec).
const calldataEncoder = getStructEncoder([
    ['data', addEncoderSizePrefix(getBytesEncoder(), getU32Encoder())],
    ['accountCount', getU8Encoder()],
]);
const accountMetaEncoder = getStructEncoder([
    ['pubkey', getAddressEncoder()],
    ['isSigner', getBooleanEncoder()],
    ['isWritable', getBooleanEncoder()],
]);
const calldataWithAccountsEncoder = getStructEncoder([
    ['calldata', calldataEncoder],
    ['accounts', getArrayEncoder(accountMetaEncoder, { size: getU32Encoder() })],
]);
/**
 * Encodes a Portal `CalldataWithAccounts` envelope — the exact inverse of
 * {@link decodePortalCalldataWithAccounts}, sharing its codec byte-for-byte (both are built from the
 * same field list above), so encoder and decoder cannot drift apart. This is what a route `Call.data`
 * for a staged SVM Sauce execution looks like on the wire.
 */
export function encodePortalCalldataWithAccounts(input) {
    const accountCount = input.accountCount ?? input.accounts.length;
    const encoded = calldataWithAccountsEncoder.encode({
        calldata: { data: input.instructionData, accountCount },
        accounts: input.accounts.map((a) => ({ pubkey: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable })),
    });
    return `0x${Buffer.from(Uint8Array.from(encoded)).toString('hex')}`;
}
/**
 * Scans SVM intent calls and returns the first call that is a GENUINE settle execution — the SVM twin of
 * `extractEvmSettleFromCalls`. Each call is a Portal envelope; the settle is found by VERIFYING it
 * (`verifySvmSettleExecution`), not by shape: the calldata pin must equal `sha256` of the SDK's own
 * recompiled canonical settle (or the supplied `bytecode` must byte-match it). A shape-only lookalike or
 * an adversarial decoy is REJECTED — the scan keeps going and never returns a non-genuine call — so this
 * cannot be tricked into reporting attacker-chosen params: `minOut`/`splCount` are what the CALLER
 * expects, and a genuine verdict is itself the proof the program enforces them. Returns `null` if no
 * call is a genuine settle.
 *
 * (To inspect a call's raw structural params without a genuineness proof — e.g. a decoy's claimed values —
 * decode the envelope with `decodePortalCalldataWithAccounts` and call `decodeSvmSettleExecution` directly.)
 */
export function extractSvmSettleFromCalls(calls, options) {
    const bytecode = options.bytecode !== undefined ? toBytes(options.bytecode, 'bytecode') : undefined;
    for (let i = 0; i < calls.length; i++) {
        let envelope;
        try {
            envelope = decodePortalCalldataWithAccounts(calls[i].data);
        }
        catch {
            continue; // not a decodable Portal envelope — skip
        }
        let verified;
        try {
            verified = verifySvmSettleExecution({
                instructionData: envelope.instructionData,
                accounts: envelope.accounts,
                bytecode,
                minOut: options.minOut,
                splCount: options.splCount,
            });
        }
        catch {
            continue; // a decodable envelope, but its instruction is not even settle-SHAPED — skip
        }
        if (verified.genuine)
            return { ...verified, callIndex: i };
        // shape-matched but NOT a genuine settle (decoy / wrong program / wrong escrow count) — keep scanning,
        // so a genuine settle later in the batch is never masked by an earlier lookalike.
    }
    return null;
}
/**
 * Extracts the GENUINE SVM settle params + resolved account identities from an intent object — the thin
 * intent-level wrapper over `extractSvmSettleFromCalls`, and the SVM twin of `extractEvmSettleFromIntent`.
 * Duck-typed on `{ route: { calls } }`, so it takes an eco-solver `Intent` (runtime or persisted) as-is.
 * Genuineness is proven from the intent alone (recompile + pin); pass `options.bytecode` (from the
 * intent's `fulfillmentMetadata.svm.sauceStage`) for the additional full byte-match. `null` if the intent
 * carries no genuine settle execution.
 */
export function extractSvmSettleFromIntent(intent, options) {
    return extractSvmSettleFromCalls(intent.route.calls, options);
}
//# sourceMappingURL=intent.js.map
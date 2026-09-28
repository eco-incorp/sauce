# Verifying settlement programs

[Documentation](../README.md) · [Intents](intents.md) · [Compiler API](../api/compiler.md)

Somebody hands you an intent and says it settles a swap to your address. These helpers answer one
question about it: **is the program inside really the settlement program, and with what parameters?**

That is a narrower question than "is this intent safe to sign", and the gap matters. A genuine
settlement can sit next to calls that are not, on a chain you did not expect, aimed at a Pot you do
not control. Verification identifies the program and decodes its arguments. The destination, the
execution target, the account identities and every other call in the intent remain yours to check.

| Surface                        | Mechanism                                                                                          | Environment                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@eco-incorp/sauce/verify`     | Validate the EVM program hash and decode its canonical runtime argument tail                       | Node, browsers, and edge runtimes; depends on `viem`, not the compiler |
| `@eco-incorp/sauce/svm/verify` | Recompile SVM settlement with expected parameters, compare bytecode, and inspect attached accounts | Node; loads the compiler                                               |

## Settlement behavior

The EVM recipe sweeps the Pot's **entire current balance** of every listed token to one recipient.
Before the first transfer it checks `minOut` against the balance of `tokens[0]`; `minOut: 0n` turns
that floor off.

Read "current balance" literally. A balance that was already there, or that somebody donated, counts
toward the floor and is swept along with everything else. The floor tells you what the Pot holds, not
what the swap before it produced.

The SVM recipe applies the same pattern to escrow token accounts. It takes an
escrow count and compile-time `minOut`/`splCount`, then attaches token programs,
escrows, mints, destination token accounts, and the owner. `splCount` selects how
the escrows are split between the two token-program slots.

## EVM: validate a complete payload

For EVM, a payload is the reusable compiled program followed by ABI-v1 runtime
arguments. The compiler never sees the argument values.

```ts
import {
  SETTLE_PROGRAM,
  encodeSettleProgram,
  validateSettleProgram,
} from "@eco-incorp/sauce/verify";

const payload = encodeSettleProgram(
  ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"], // Base USDC
  1_000_000n,
  "0x1111111111111111111111111111111111111111", // Example recipient
  SETTLE_PROGRAM,
);

const settlement = validateSettleProgram(payload);
console.log(settlement.tokens, settlement.minOut, settlement.recipient);
console.log(settlement.floorToken, settlement.programHash);
```

`validateSettleProgram()` checks the whole program hash and the argument encoding. The pin it checks
against is `SETTLE_WIRE` — a hash and a byte length, exported so your code can import them instead of
keeping a second copy that will drift.

A payload built against an earlier compiler has a different hash and length. To accept one, pass its
`{ hash, bytes }` record explicitly; see [pins](#compiler-upgrades-and-historical-pins) below.

The tail contains three 32-byte head words—token-array offset, minimum output,
recipient—followed by the token count and token addresses in source order. The
verifier requires the canonical offset, a nonempty token list, a nonzero
recipient, clean address words, and no trailing data. Some alternate encodings
execute on an engine but are deliberately rejected here, so a successful decode
has a unique byte representation.

This surface verifies the pinned **ABI-v1** settlement artifact. Recompiling the
recipe with `compactArgs: true` changes that contract and is not accepted by the
existing settlement decoder.

### Inspection levels

| Helper                                                    | Result                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `validateSettleProgram(payload, accepted?)`               | Hash-pinned program identity and strict argument decode; preferred for validation         |
| `decodeSettleProgram(payload)`                            | Strict argument shape at the expected program length; does not authenticate program bytes |
| `parseSettleProgram(payload)`                             | A non-throwing structural report, including a `fatal` failure when present                |
| `bestEffortDecode(parse)`                                 | Best-effort inspection or `null` when reporting values would be misleading                |
| `encodeSettleProgram(tokens, minOut, recipient, program)` | Canonical payload construction                                                            |

Reach for `validateSettleProgram` unless you have a reason not to. Structural decoding will happily
accept any bytes of the right length — only the hash check establishes that what you have is the
settlement program. Failures carry a `SettleDecodeError.code` such as `PROGRAM_HASH`,
`TOKENS_OFFSET`, `DIRTY_ADDRESS_WORD` or `ARGS_OVERLONG`.

### Extract a settlement from an intent

The intent helpers unwrap `cook` calldata and validate the program they find.
This reusable check expects exactly one current Pot settlement call:

```ts
import { extractEvmSettleFromIntent, type IntentLike } from "@eco-incorp/sauce/verify";
import type { Address } from "viem";

export function inspectSingleSettle(
  intent: IntentLike,
  trustedPot: Address,
  trustedEngine: Address,
) {
  const result = extractEvmSettleFromIntent(intent);
  if (!result) throw new Error("No recognized settlement");
  if (intent.route.calls.length !== 1 || result.callIndex !== 0) {
    throw new Error("Expected exactly one settlement call");
  }
  if (result.ingredientCount !== 1) throw new Error("Unexpected extra program");
  if (result.target?.toLowerCase() !== trustedPot.toLowerCase()) {
    throw new Error("Unexpected Pot");
  }
  if (result.engine?.toLowerCase() !== trustedEngine.toLowerCase()) {
    throw new Error("Unexpected engine");
  }
  return result; // Compare tokens, minOut, and recipient to application expectations.
}
```

For a swap-plus-settle intent, use the expected call count and positions for that
application and validate every other call. `extractEvmSettleFromIntent()` returns
the first recognized settlement; it does not approve the whole batch or check
the intent's destination chain.

`decodeSettleCall(data)` examines one cook, and
`extractEvmSettleFromCalls(calls)` operates without the intent wrapper. The
decoder also recognizes the historical `cook(bytes[])` wrapper: only its first
ingredient is inspected. A legacy router executes every ingredient, so check
`ingredientCount` and interpret an absent `engine` according to that contract.
Current `Pot.cook(address,bytes)` carries exactly one program and reports the
engine it names.

### Compiler upgrades and historical pins

`validateSettleProgram` accepts an explicit list of program hashes or
`{ hash, bytes }` `ProgramPin` records. Use the full record for a historical
program with a different length. Passing an empty list accepts no program; it
does not fall back to the default pin.

A compiler change can change program bytes without changing a line of the recipe. So an SDK or
compiler upgrade is the moment to check two separate things: which program version your application
now _produces_, and which versions it still _accepts_. Import the SDK's pins rather than copying
their values, and keep an older pin only for a version you have decided to accept.

The source is available through `settleSource()` from
`@eco-incorp/sauce/recipes`, and as the
`@eco-incorp/sauce/recipes/settle.sauce.ts` asset. `SAUCE_BASE_DIRS` locates its ABI
dependencies for a reproducing resolver. The verifier itself does not load that
source or recompile it.

## SVM: verify program and accounts

SVM settle parameters are compiled into the program, and account identities live
outside it. State the expected floor and token-program split, then verify both
parts.

```ts
import { compile } from "@eco-incorp/sauce/compiler";
import { svmSettleSource } from "@eco-incorp/sauce/svm";
import { verifySvmSettleProgram } from "@eco-incorp/sauce/svm/verify";

const expected = { minOut: 1_000_000n, splCount: 1n };
const source = new TextEncoder().encode(svmSettleSource(1));
const artifact = compile({
  target: "svm",
  resolve: (path) => (path === "main.js" ? source : undefined),
  defines: [
    ["SETTLE_MIN_OUT", expected.minOut.toString()],
    ["SETTLE_SPL_COUNT", expected.splCount.toString()],
  ],
});
if (!artifact.manifest) throw new Error("Expected SVM accounts");

const result = verifySvmSettleProgram(artifact.bytecode, artifact.manifest, expected);
if (!result.genuine) throw new Error(result.mismatch);
console.log(result.escrowCount, result.refs);
```

This example demonstrates reproduction. To verify received data, pass the
received bytecode and manifest instead. The helper infers the escrow count from
the `3N + 3` account shape, checks canonical slot names, and recompiles the shipped
source with the expected values. Supported settle generators accept 1–16 escrows.
The result does not establish that the account addresses attached to an actual
instruction are the ones the application expects.

### Execution verification

`decodeSvmSettleExecution({ instructionData, accounts })` resolves accounts
positionally against the canonical settlement refs. The default `wireFormat: "gated-v1"` accepts raw **engine CPI instructions** produced by Kitchen 1.0.0 for
engine 1.2.0:

| Instruction            | Data                                                               | Full CPI account list                  |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `execute`              | discriminator (8 bytes), owner (32), salt (32), bump (1), bytecode | settlement accounts, Pot               |
| `execute_from_account` | discriminator (8 bytes), owner (32), salt (32), bump (1)           | code account, settlement accounts, Pot |

The decoder removes the code account and trailing Pot before resolving the
`3N + 3` settlement slots. It returns parsed `gate` metadata and the staged
`codeAccount` when present. It rejects truncated headers, extra staged data,
invalid account addresses, and incompatible account counts. Labels are diagnostic;
account positions determine identities. Structural decoding alone cannot identify
settlement: unrelated programs can use the same account count.

Historical 8-byte headers require explicit `wireFormat: "legacy-ungated"`.
That inspection mode accepts the user account tail or its code-prefixed form;
it does not make legacy instructions executable on the released engine.
Kitchen `cook` and `cook_from_account` have different data and account layouts
and must not be passed directly to this decoder.

`verifySvmSettleExecution()` adds `minOut`, `splCount`, and optional `bytecode`
and `pin` inputs. Check both its `genuine` and `verifiedBy` fields:

| `verifiedBy`          | What was compared                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `inline-bytecode`     | The program inside an `execute` instruction matches the canonical program; supplied bytecode, if any, must match it too |
| `bytecode`            | Supplied staged bytecode matches the canonical program and the supplied pin hashes those bytes                          |
| `caller-asserted-pin` | A caller-supplied pin equals the hash of the canonical program; no staged bytes were supplied                           |
| `none`                | No basis to authenticate the staged program                                                                             |

For staged execution, the pin comes from the **caller**, not from the released
engine's `execute_from_account` calldata. That instruction has no content-pin
field. A `bytecode` or `caller-asserted-pin` result therefore depends on the
caller's evidence connecting that pin to the code account that will execute,
such as the relevant Kitchen `cook_from_account` instruction and staged account
contents. The helper does not fetch that evidence. Supplying canonical bytes
without a pin cannot authenticate a staged execution.

Also check the engine program ID and the account identities, roles, mints,
owners, and destinations required by the application. Parsed gate metadata is
not proof of a valid Pot derivation or signature. The verifier does not validate
the Kitchen invocation, account roles, on-chain state, or execution success;
`genuine` describes the recognized program under the stated pin assumptions.

### Eco Portal envelopes

`decodePortalCalldataWithAccounts()` unwraps the SVM Portal's instruction data
and ordered account metas. It requires the declared account count to match the
full account list, canonical Borsh flags, and no trailing bytes. Envelope decoding
alone does not validate the target, program identity, or settlement.
`extractSvmSettleFromIntent()` and
`extractSvmSettleFromCalls()` combine envelope extraction with execution
verification and report the call target. They expect the raw engine format
above, default to `gated-v1`, and do **not** decode Kitchen cook envelopes. Supply
expected `minOut`, `splCount`, optional `wireFormat`, and optional `bytecode`
through their options. When verifying staged code, attach
the independently obtained `pin` to the relevant input call; pins are per call,
not shared across the batch.

A working Kitchen-targeted route needs separate Kitchen decoding before its
program and account plan can be checked. For an already executed transaction,
inspect the recorded inner engine instruction instead. The SDK's legacy SVM
route builder cannot produce that Kitchen integration; see the
[Solana guide](solana.md#svm-destinations-in-eco-intents).

As on EVM, finding a genuine settlement does not validate adjacent calls or an
arbitrary callee that accepts the same instruction discriminator. Match the
reported target and account plan to the deployment and intent your application
expects.

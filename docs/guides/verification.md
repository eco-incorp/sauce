# Verifying settlement programs

**How-to guide** · [Documentation](../README.md) · [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md) · [Compiler API](../api/compiler.md)

> Someone hands you a payload or a cook and says "this settles your swap". Verification is the
> label check: it confirms that the program inside is the real settlement program, and reads its
> settings. It does not check everything around it. That part is still yours.

This page is for a developer whose application receives settlement payloads, cooks or transactions
that someone else built, such as a partner's front end or service, and must check them before
relying on them. It assumes you know what a Pot and a cook are
([Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md)). The program it checks is the
**settlement program**, `settle.sauce.ts`, which the package ships: it sweeps a Pot's tokens to one
recipient, with a floor. The checks answer one question: **is the program inside really the
settlement program, and with what parameters?**

That is a narrower question than "is this transaction safe to sign", and the gap matters. A genuine
settlement can sit next to calls that are not, on a chain you did not expect, aimed at a Pot you do
not control. Verification identifies the program and decodes its arguments. The chain, the
execution target, the account identities and every other call in the batch remain yours to check.

| Surface                        | Mechanism                                                                                          | Environment                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@eco-incorp/sauce/verify`     | Validate the EVM program hash and decode its canonical runtime argument tail                       | Node, browsers, and edge runtimes; depends on `viem`, not the compiler     |
| `@eco-incorp/sauce/svm/verify` | Recompile SVM settlement with expected parameters, compare bytecode, and inspect attached accounts | Node and browsers; loads the compiler (`await ready()` first in a browser) |

## Check a settlement from the command line

`sauce verify` runs the same checks on a payload, a cook's calldata, or a transaction:

```sh
sauce verify 0x<payload>
sauce verify 0x<tx hash> --chain base
sauce verify <signature> --chain solana --min-out 0 --spl-count 1
```

It prints the tokens, the floor and the recipient, or exits 1 with the reason it refused, such as
`PROGRAM_HASH` or `NO_SETTLE`. A cook must name the released engine, or one you add with
`--engine <address>`. `--pin <hash:bytes>` also accepts a historical settlement program, as
[below](#compiler-upgrades-and-historical-pins). On Solana, the floor and the split are compiled
into the program, so give them with `--min-out` and `--spl-count`. An agent runs the same checks
through the MCP tool `sauce_verify`. The rest of this page does it in code.

## Settlement behavior

The EVM settlement program sweeps the Pot's **entire current balance** of every listed token to one recipient.
Before the first transfer it checks `minOut` against the balance of `tokens[0]`; `minOut: 0n` turns
that floor off.

Read "current balance" literally. A balance that was already there, or that somebody donated, counts
toward the floor and is swept along with everything else. The floor tells you what the Pot holds, not
what the swap before it produced.

The SVM settlement program applies the same pattern to escrow token accounts. It takes an
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

Each transfer in the sweep follows OpenZeppelin `SafeERC20`: a token that returns nothing from
`transfer` (USDT) is swept like any other, while a token that returns `false` or anything else that
does not decode as a word equal to `1`, a token address with no code, or a reverting transfer reverts
the whole sweep.

A payload built against an earlier compiler has a different hash and length. To accept one, pass its
`{ hash, bytes }` record explicitly; see [pins](#compiler-upgrades-and-historical-pins) below.

The tail contains three 32-byte head words—token-array offset, minimum output,
recipient—followed by the token count and token addresses in source order. The
verifier requires the canonical offset, a nonempty token list, a nonzero
recipient, clean address words, and no trailing data. Some alternate encodings
execute on an engine but are deliberately rejected here, so a successful decode
has a unique byte representation.

This surface verifies the pinned **ABI-v1** settlement artifact. Historical compact-encoded
payloads are not accepted by the settlement decoder. Compiler 2.6 produces ABI-v1 only.

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

### Extract a settlement from a cook

`decodeSettleCall(data)` unwraps one `Pot.cook` calldata and validates the program it carries, or
returns `null` when the calldata is not a cook of the settlement program.
`extractEvmSettleFromCalls(calls)` does the same across a batch of calls, each `{ data, target }`,
and reports where it found the settlement. This reusable check expects exactly one call, a
settlement cook on your Pot:

```ts
import { extractEvmSettleFromCalls } from "@eco-incorp/sauce/verify";
import type { Address, Hex } from "viem";

export function inspectSingleSettle(
  calls: readonly { data: Hex; target?: Address }[],
  trustedPot: Address,
  trustedEngine: Address,
) {
  const result = extractEvmSettleFromCalls(calls);
  if (!result) throw new Error("No recognized settlement");
  if (calls.length !== 1 || result.callIndex !== 0) {
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

For a batch that swaps and then settles, use the expected call count and positions for that
application and validate every other call. `extractEvmSettleFromCalls()` returns the first
recognized settlement; it does not approve the whole batch or check the chain it runs on.

The decoder also recognizes the historical `cook(bytes[])` wrapper: only its first ingredient is
inspected. A legacy router executes every ingredient, so check `ingredientCount` and interpret an
absent `engine` according to that contract. Current `Pot.cook(address,bytes)` carries exactly one
program and reports the engine it names.

### Compiler upgrades and historical pins

`validateSettleProgram` accepts an explicit list of program hashes or
`{ hash, bytes }` `ProgramPin` records. Use the full record for a historical
program with a different length. Passing an empty list accepts no program; it
does not fall back to the default pin.

Four earlier builds of the settlement program can still be accepted when you list them. The last
two predate the sweep following `SafeERC20`:

| Built by                                   | `bytes` | Published in        |
| ------------------------------------------ | ------- | ------------------- |
| Compiler 2.4.0 and 2.5.0                   | 435     | before this upgrade |
| Compiler 2.3.0, with the `SafeERC20` sweep | 435     | no release          |
| Compiler 2.3.0                             | 356     | 0.99.2 – 0.99.4     |
| Compiler 2.2.0 and 2.2.1                   | 362     | 0.99.0 – 0.99.1     |

Each one's `{ hash, bytes }` record is in the documentation comment of `SETTLE_WIRE`, which your
editor shows on hover. The current pin is
`{ hash: SETTLE_WIRE.PROGRAM_HASH, bytes: SETTLE_WIRE.PROGRAM_BYTES }`: the 410-byte program
produced by compiler 2.6.0. An explicit list replaces the default, so include the current pin
alongside any historical ones you accept. On the command line, `sauce verify --pin <hash:bytes>`
adds one.

A compiler change can change program bytes without changing a line of the source. So an SDK or
compiler upgrade is the moment to check two separate things: which program version your application
now _produces_, and which versions it still _accepts_. Import the SDK's pins rather than copying
their values, and keep an older pin only for a version you have decided to accept.

The source is available through `settleSource()` from
`@eco-incorp/sauce/recipes`, and as the
`@eco-incorp/sauce/recipes/settle.sauce.ts` asset. `resolveSdkModule` from
`@eco-incorp/sauce/compiler` serves its ABI dependency to a reproducing resolver:

```ts
import { compile, resolveSdkModule } from "@eco-incorp/sauce/compiler";
import { settleSource } from "@eco-incorp/sauce/recipes";
import { SETTLE_PROGRAM } from "@eco-incorp/sauce/verify";
import { bytesToHex } from "viem";

const settle = new TextEncoder().encode(settleSource());
const { bytecode } = compile({
  target: "evm",
  entry: "settle.sauce.ts",
  resolve: (path) => (path === "settle.sauce.ts" ? settle : resolveSdkModule(path)),
});
if (bytesToHex(bytecode) !== SETTLE_PROGRAM.toLowerCase()) {
  throw new Error("Did not reproduce the settle program");
}
```

The verifier itself does not load that source or recompile it.

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
positionally against the canonical settlement refs. The default `wireFormat: "gated-v1"` accepts raw **engine CPI instructions** produced by the Kitchen for
the engine this package pins:

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

As on EVM, finding a genuine settlement does not validate adjacent instructions or an arbitrary
callee that accepts the same instruction discriminator. For a transaction that has already run,
check the inner engine instruction the Kitchen made: `sauce verify <signature> --chain solana` does
that. Match the engine program and the account plan to the deployment your application expects.

## Next

- What changed in each release, the settlement program included: the [changelog](../changelog.md).
- Run the same checks from a terminal: [Look things up](cli-lookup.md).
- Moving to a newer package, and the pins to accept: [Upgrading](upgrading.md).

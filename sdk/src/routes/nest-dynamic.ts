/**
 * eco-routes V2 DYNAMIC nesting — a child intent CREATED ON-CHAIN, from an amount nobody knew when
 * the parent was signed.
 *
 * `nest.ts` is the static twin and opens with the reason this file exists: "A STATIC child (every
 * reward field known off-chain) needs no on-chain struct construction and no Sauce-program
 * involvement at all". The converse is what a real cascade needs and what that path cannot express:
 * the child's reward IS the output of a swap that runs earlier in the SAME fulfillment, so its
 * amount does not exist until the parent is already executing. You cannot pre-encode a number you
 * have not measured.
 *
 * WHAT THIS DOES INSTEAD, in the parent's own Sauce program, on the parent's destination chain:
 *
 *   1. MEASURE — read the Pot's balance of the token the earlier calls produced (`ctx.self()` is the
 *      Pot; see CLAUDE.md's engine notes). This is the one runtime measurement in the whole flow,
 *      exactly as `IntentChainer._measure` describes it.
 *   2. DERIVE — `amountOut = ceil(amountIn * scale / WAD)`. A delivery obligation is generally not
 *      the measured input: `scale` carries both the decimals conversion and the proportional margin.
 *   3. RENDER — concatenate the child's precompiled `publishAndFund` calldata around those two
 *      numbers (`template.ts`), which is only possible because an ABI word splice moves nothing
 *      after it.
 *   4. CALL — `evm.call(portal, value, rendered)`. One call, no intermediary.
 *
 * NO CHAINER CONTRACT IS IN THE PATH, deliberately (2026-09-25 USER DIRECTIVE: "Chainer contracts in
 * routes and routes-svm are just examples of how it should work. we don't need to use them. We can
 * precompile sauce for nested intents and then template the bytes on the fly with numbers same way
 * chainer does it."). `../eco-routes/contracts/chain/IntentChainer.sol` and `IntentTemplate.sol`
 * were read as the REFERENCE DESIGN — the `Template { segments, items }` shape, the single
 * measurement, the WAD-scaled `amountOut`, the ceil rounding, the `minAmountIn` floor — and none of
 * it is called. There is nothing to deploy and nothing to trust beyond the Portal itself.
 *
 * WHY THIS IS SAFE WITHOUT ACCESS CONTROL — the same anchor `IntentChainer`'s NatSpec names, one
 * layer down. The whole child (its route bytes, its `reward.creator`, its prover) is baked into the
 * bytecode of a program that rides inside `parent.route.calls[k].data`, which
 * `keccak256(abi.encode(route))` covers, which the `intentHash` `Inbox` re-derives covers. A solver
 * choosing to fulfill the parent cannot alter the child it is publishing; it can only decline.
 *
 * WHAT IS DELIBERATELY NOT DEFENDED AGAINST, stated so it is a choice and not an oversight:
 *
 *   - A DONATED BALANCE rides along. The measurement is the Pot's CURRENT balance, not a delta
 *     against a baseline — the same accepted property `svm/recipes/settle.sauce.ts` and
 *     `nest.ts`'s transfer mode already carry, and the same one `IntentChainer` accepts. Do not add
 *     baseline machinery here without changing those too.
 *   - A RESIDUAL ALLOWANCE. `IntentSource._fundToken` pulls
 *     `min(remaining, allowance(funder, portal), balanceOf(funder))`, so a fully funded leg consumes
 *     the approval exactly; a PARTIALLY funded one (`allowPartial: true`, or a short balance) leaves
 *     the remainder approved to the Portal. The Portal can only ever spend it into a vault, so this
 *     is untidy rather than dangerous, and resetting would cost a second call on every cascade.
 *   - NATIVE OVER-SEND. `publishAndFund` ends in `Refund.excessNative()`, which forwards the
 *     Portal's ENTIRE balance to `msg.sender` — here the Pot. That is the hazard that made
 *     `IntentChainer` refuse to be payable at all, but its `msg.sender` was a shared, solver-driven
 *     contract; ours is the Pot executing this very program. `Refund.excessNative` also swallows a
 *     failed send rather than reverting, so a Pot with no payable fallback loses the excess instead
 *     of bricking the fulfillment. The emitted `value` is therefore exactly `reward.nativeAmount`,
 *     never rounded up.
 *
 * Pure SOURCE text, no compiler import — same posture as `nest.ts`. `intent-dsl.ts` owns the
 * `compile()` seam.
 */
import { denormalizeToEvm } from "./encode.js";
import { formatBigint } from "../deposit/format.js";
import { toAddressBigint } from "../token/params.js";
import { ERC20_IMPORT_LINE } from "../token/evm.js";
import { uncheckedApproveStatements } from "../token/unchecked.js";
import { TOKEN_BASE_DIRS } from "../token/source.js";
import { publishAndFundTx } from "./portal.js";
import {
  emitTemplate,
  renderTemplate,
  scaleAmount,
  splitByPlaceholders,
  maxScalableBase,
  WAD,
  type ByteTemplate,
  type PlaceholderSpec,
} from "./template.js";
import type { AddressInput, Hex, Intent, UniversalAddress } from "./types.js";

export { WAD } from "./template.js";
export type { AmountSource, ByteTemplate, PlaceholderSpec, TemplateSlot } from "./template.js";

/**
 * The canonical 32-byte sentinels a caller writes into a child intent wherever a runtime amount
 * belongs — one ABI word each, which is every amount field on the EVM path (`reward.tokens[].amount`,
 * `route.tokens[].amount`, `nativeAmount`, and any `uint256` inside a `route.calls[].data` the
 * caller encodes itself).
 *
 * The tag `0x5acef00d` in the high bytes and a one-byte discriminant in the low byte make these
 * ~1.5e77 — far outside any token amount — and structurally unmistakable in a trace. They are only a
 * DEFAULT, though, not a magic value the splice recognises: `splitByPlaceholders` matches whatever
 * sentinel the caller declares, and every match is counted and checked, so a collision fails loudly
 * rather than corrupting a field.
 */
export const AMOUNT_IN_PLACEHOLDER = BigInt(`0x5acef00d${"00".repeat(27)}01`);
/** @see AMOUNT_IN_PLACEHOLDER */
export const AMOUNT_OUT_PLACEHOLDER = BigInt(`0x5acef00d${"00".repeat(27)}02`);

/**
 * The u64-sized twins, for a child whose DESTINATION is Solana: `encodeRouteSvm` Borsh-encodes
 * `route.tokens[].amount` as a `u64` and `assertU64` REJECTS the 32-byte sentinels above outright,
 * so a route-side amount on that leg needs one of these plus `width: 8, littleEndian: true`. The
 * reward side of the same intent still uses the 32-byte sentinels — the reward is escrowed on the
 * EVM source chain and ABI-encoded, whatever the destination is. That asymmetry is `encode.ts`'s,
 * not this module's: `hashIntent` already encodes route and reward for different chain kinds.
 */
export const AMOUNT_IN_PLACEHOLDER_U64 = BigInt("0x5acef00d00000001");
/** @see AMOUNT_IN_PLACEHOLDER_U64 */
export const AMOUNT_OUT_PLACEHOLDER_U64 = BigInt("0x5acef00d00000002");

/**
 * Where the one runtime number comes from.
 *
 *  - `erc20Balance` — `IERC20.at(token).balanceOf(ctx.self())`, i.e. what the parent's earlier calls
 *    left in the Pot. The default shape, and `IntentChainer`'s only one.
 *  - `nativeBalance` — `ctx.selfBalance()`, for a native-in cascade.
 *  - `expression` — verbatim SauceScript, the escape hatch for a program that ALREADY holds the
 *    number in a local (a swap's own return value, when these statements are inlined into the
 *    parent's own body rather than compiled as their own `cook()`). Not validated: whatever is
 *    written here is what compiles.
 */
export type AmountMeasurement =
  | { readonly kind: "erc20Balance"; readonly token: AddressInput }
  | { readonly kind: "nativeBalance" }
  | { readonly kind: "expression"; readonly expression: string };

export interface DynamicChildOptions {
  /** The Portal the child is published on — the parent's own `route.portal`, since the child's
   *  source chain IS the parent's execution chain (`nest.ts`'s module doc has the grounding). */
  readonly portal: AddressInput;
  readonly measure: AmountMeasurement;
  /** WAD-denominated: `amountOut = ceil(amountIn * scale / WAD)`. Defaults to `WAD` (identity, so
   *  `amountOut === amountIn`). Carries BOTH the decimals conversion (`1e30` for 6 -> 18 decimals,
   *  `1e6` for 18 -> 6) and the proportional margin. */
  readonly scale?: bigint;
  /**
   * Reject a measurement below this floor, reverting the parent's whole fulfillment. Defaults to
   * `1n` — `IntentChainer.ZeroAmount`'s behaviour, and the right default: publishing a child funded
   * with nothing burns the parent for nothing, and the revert is free because it unwinds the same
   * transaction that produced the balance. Pass `0n` to opt out entirely.
   */
  readonly minAmountIn?: bigint;
  /** Passed through to `publishAndFund`. Defaults to `false` — a partially funded child is a
   *  stalled cascade (same default as `nest.ts`'s publishAndFund mode). */
  readonly allowPartial?: boolean;
  /**
   * Which sentinels to cut the encoded child at. Defaults to both canonical 32-byte placeholders
   * with no declared occurrence count. Supply this explicitly to PIN the counts (strongly
   * recommended — see `PlaceholderSpec.occurrences`), to apply a per-slot scale, or to template a
   * narrower/little-endian field such as a Borsh `u64`.
   */
  readonly placeholders?: readonly PlaceholderSpec[];
  /**
   * `"auto"` (default) emits one `approve(portal, amount)` per DISTINCT reward token before the
   * publish — the Portal pulls reward legs with `safeTransferFrom(funder = msg.sender)`, and
   * `msg.sender` here is the Pot, so without this the funding silently moves nothing and the call
   * reverts on `InsufficientFunds`. `"none"` emits nothing, for a caller that approved elsewhere.
   */
  readonly approve?: "auto" | "none";
  /** Overrides the native value forwarded to `publishAndFund`. Defaults to `reward.nativeAmount` —
   *  exactly, never rounded up; see the module doc's note on `Refund.excessNative`. */
  readonly value?: bigint;
}

function defaultPlaceholders(): readonly PlaceholderSpec[] {
  return [
    { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn" },
    { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut" },
  ];
}

/**
 * The child's `publishAndFund` calldata, cut into literal segments and slots.
 *
 * Built by `portal.ts#publishAndFundTx` — the SAME encoder the static path uses, so a dynamic child
 * and the concrete intent it renders to are bytes-identical by construction rather than by a second
 * implementation agreeing. That is also what makes the off-chain check in `renderDynamicChild`
 * meaningful: it compares this module's output against an encoder neither this module nor the test
 * re-implements.
 */
export function dynamicChildTemplate(child: Intent, opts: DynamicChildOptions): ByteTemplate {
  const tx = publishAndFundTx(child, opts.allowPartial ?? false, { portal: opts.portal });
  return splitByPlaceholders(tx.data, opts.placeholders ?? defaultPlaceholders());
}

/**
 * The exact calldata the emitted program would build for a given measurement — the off-chain twin
 * of the on-chain concatenation, and the only way to check this codegen without an engine. Pair it
 * with `publishAndFundTx` on the equivalent CONCRETE child and the two must be byte-identical.
 */
export function renderDynamicChild(
  child: Intent,
  opts: DynamicChildOptions,
  amountIn: bigint,
): Hex {
  const scale = opts.scale ?? WAD;
  return renderTemplate(dynamicChildTemplate(child, opts), amountIn, scaleAmount(amountIn, scale));
}

function evmTokenLiteral(token: UniversalAddress): string {
  return formatBigint(BigInt(denormalizeToEvm(token)));
}

/** Every distinct sentinel the caller declared, so a reward leg's amount can be recognised as
 *  templated rather than literal. */
function placeholderIndexOf(
  amount: bigint,
  placeholders: readonly PlaceholderSpec[],
): number | undefined {
  const i = placeholders.findIndex((p) => p.value === amount);
  return i === -1 ? undefined : i;
}

/** The local a given placeholder's value lands in, found by matching its (source, scale) against
 *  the slots `emitTemplate` named — never re-derived, so the approve and the reward tuple can never
 *  disagree about the number. */
function localForPlaceholder(
  spec: PlaceholderSpec,
  template: ByteTemplate,
  slotVars: readonly string[],
): string {
  const scale = spec.scale ?? WAD;
  const i = template.slots.findIndex((s) => s.source === spec.source && s.scale === scale);
  if (i === -1) {
    // Unreachable via `dynamicChildStatements` (every slot comes from a declared placeholder), but
    // a wrong local name here would approve or forward a different number than the bytes carry.
    throw new Error(
      `nest-dynamic: no template slot renders (${spec.source}, scale ${scale}) — cannot name the local ` +
        `holding that amount.`,
    );
  }
  return slotVars[i]!;
}

/**
 * Asserts the child really is dynamic. `nest.ts#assertStaticChild` documents itself as "the SEAM
 * where an S6 runtime-computed child will be rejected here, rather than silently mis-encoded by
 * treating a placeholder as a real amount" — this is the other side of that seam, and it fails for
 * the mirror-image reason: a child routed through THIS path with no sentinel anywhere would compile,
 * publish, and fund a completely static intent while the program dutifully measured a balance and
 * used it for nothing.
 */
export function assertDynamicChild(child: Intent, index: number, opts: DynamicChildOptions): void {
  // Building the template IS the check: `splitByPlaceholders` throws when a declared sentinel matched
  // nothing. What it cannot know is WHY that is interesting here, so its diagnostic is wrapped rather
  // than re-derived -- the cause keeps the byte-level detail (which sentinel, how long the payload
  // was) while this message names the decision the caller has to revisit.
  try {
    dynamicChildTemplate(child, opts);
  } catch (cause) {
    const placeholders = opts.placeholders ?? defaultPlaceholders();
    throw new Error(
      `assertDynamicChild: child[${index}] does not carry all ${placeholders.length} declared ` +
        `placeholder(s), so there is nothing for a measurement to fill. Either write the sentinels into ` +
        `the child's amount fields, or nest it with via: "publishAndFund"/"transfer" — a fully static ` +
        `child routed through here would measure a balance and use it for nothing.`,
      { cause },
    );
  }
}

/**
 * The SauceScript statements ONE dynamic child contributes to a program: measure, floor-check,
 * derive, approve, render, publish. `index` namespaces every local (`d<index>_…`) so several
 * children merge into one program scope without colliding — the same discipline
 * `nest.ts#nestedTransferStatements` uses.
 *
 * Emitted in exactly this order, and the order is load-bearing: the approve must precede the
 * publish (the Portal pulls during it), and every guard must precede the approve (so a rejected
 * measurement costs nothing and leaves no allowance behind).
 */
export function dynamicChildStatements(
  child: Intent,
  index: number,
  opts: DynamicChildOptions,
): readonly string[] {
  assertDynamicChild(child, index, opts);

  const placeholders = opts.placeholders ?? defaultPlaceholders();
  const template = dynamicChildTemplate(child, opts);
  const scale = opts.scale ?? WAD;
  if (scale <= 0n) {
    throw new Error(
      `dynamicChildStatements: child[${index}] scale must be positive (a zero scale obliges the solver ` +
        `to deliver nothing while collecting the whole escrow), got ${scale}`,
    );
  }
  const minAmountIn = opts.minAmountIn ?? 1n;
  const portalLiteral = formatBigint(toAddressBigint(opts.portal, "portal"));
  const prefix = `d${index}_`;
  const inVar = `${prefix}in`;
  const statements: string[] = [];

  // 1. MEASURE.
  switch (opts.measure.kind) {
    case "erc20Balance":
      statements.push(
        `const ${inVar} = IERC20.at(${formatBigint(toAddressBigint(opts.measure.token, "measure.token"))}).balanceOf(ctx.self());`,
      );
      break;
    case "nativeBalance":
      statements.push(`const ${inVar} = ctx.selfBalance();`);
      break;
    case "expression":
      statements.push(`const ${inVar} = ${opts.measure.expression};`);
      break;
  }

  // 2. FLOOR. Before anything is derived or approved, so a rejected measurement leaves no trace.
  if (minAmountIn > 0n) {
    statements.push(
      `if (${inVar} < ${formatBigint(minAmountIn)}) { throw 'sauce: measured amount below floor'; }`,
    );
  }

  // 3. DERIVE. The identity scale needs no arithmetic and no local at all -- `amountOut` IS the
  // measurement -- which keeps the common case free of the overflow guard below entirely.
  let outVar = inVar;
  if (scale !== WAD) {
    outVar = `${prefix}out`;
    statements.push(
      `if (${inVar} > ${formatBigint(maxScalableBase(scale))}) { throw 'sauce: measured amount overflows scale'; }`,
      `const ${outVar} = (${inVar} * ${formatBigint(scale)} + ${formatBigint(WAD - 1n)}) / ${formatBigint(WAD)};`,
    );
  }

  // 4. RENDER.
  const emitted = emitTemplate(template, { prefix, amountInVar: inVar, amountOutVar: outVar });
  statements.push(...emitted.statements);

  // 5. APPROVE, one per DISTINCT reward token. A token whose legs are all literal approves the
  // LARGEST of them, never their sum, for the reason `portal.ts#approvalTxs` states: `_fundToken`
  // compares each leg against the vault's TOTAL balance and short-circuits, so the largest leg is
  // the binding allowance. A token with exactly one leg, and that leg templated, approves the local
  // holding the rendered amount. Anything else -- a templated leg alongside another leg in the same
  // token -- has no single correct allowance to emit without runtime max arithmetic, and is
  // rejected rather than guessed at.
  //
  // Issued as a raw `evm.call` with no declared output (`token/unchecked.ts`), NOT as
  // `IERC20.at(t).approve(...)`. The vendored IERC20 declares a `bool` return, the compiler lowers
  // that to call-then-decode even though nothing reads it, and decoding from empty returndata
  // reverts on this engine -- so a USDT reward used to revert the entire parent fulfilment. A token
  // that genuinely refuses the approve still does, because `evm.call` propagates its revert.
  if ((opts.approve ?? "auto") === "auto") {
    const byToken = new Map<string, { literal: string; amounts: bigint[] }>();
    for (const t of child.reward.tokens) {
      const key = evmTokenLiteral(t.token);
      const group = byToken.get(key) ?? { literal: key, amounts: [] };
      group.amounts.push(t.amount);
      byToken.set(key, group);
    }
    const portalWord = { literal: toAddressBigint(opts.portal, "portal") } as const;
    let approveIndex = 0;
    for (const [key, group] of byToken) {
      const approvePrefix = `${prefix}${approveIndex++}`;
      const templated = group.amounts
        .map((a) => placeholderIndexOf(a, placeholders))
        .filter((i): i is number => i !== undefined);
      if (templated.length === 0) {
        const max = group.amounts.reduce((a, b) => (b > a ? b : a), 0n);
        statements.push(
          ...uncheckedApproveStatements(approvePrefix, key, portalWord, { literal: max }),
        );
        continue;
      }
      if (group.amounts.length !== 1) {
        throw new Error(
          `dynamicChildStatements: child[${index}]'s reward has ${group.amounts.length} legs in token ` +
            `${key} and at least one is templated — there is no single allowance to approve without ` +
            `runtime max arithmetic. Collapse them into one leg, or pass approve: "none" and emit the ` +
            `approval yourself.`,
        );
      }
      const local = localForPlaceholder(placeholders[templated[0]!]!, template, emitted.slotVars);
      statements.push(...uncheckedApproveStatements(approvePrefix, key, portalWord, { local }));
    }
  }

  // 6. PUBLISH. `value` is the reward's own declared native amount -- templated too when the caller
  // made it a placeholder, so the forwarded ETH and the encoded `reward.nativeAmount` are the same
  // number by construction rather than by two agreeing derivations.
  let valueExpr: string;
  if (opts.value !== undefined) {
    valueExpr = formatBigint(opts.value);
  } else {
    const nativeSpec = placeholderIndexOf(child.reward.nativeAmount, placeholders);
    valueExpr =
      nativeSpec === undefined
        ? formatBigint(child.reward.nativeAmount)
        : localForPlaceholder(placeholders[nativeSpec]!, template, emitted.slotVars);
  }
  statements.push(`evm.call(${portalLiteral}, ${valueExpr}, ${emitted.dataVar});`);

  return statements;
}

/** One `{ child, opts }` pair per dynamic child, merged (in this array's order) into ONE program. */
export interface DynamicNestEntry {
  readonly child: Intent;
  readonly opts: DynamicChildOptions;
}

/**
 * Merges every entry's `dynamicChildStatements` into ONE `function main(){...}` program, shaped
 * exactly like `nest.ts#nestedTransferProgram` so `intent-dsl.ts` slots it the same way: one extra
 * `cook()` call in the parent's `route.calls`. `imports`/`baseDirs` are surfaced separately so a
 * caller with its own `baseDirs` merges rather than re-derives them.
 *
 * WHY A SEPARATE COOK RATHER THAN APPENDED TO THE PARENT'S OWN BODY: the measurement is the Pot's
 * BALANCE, which persists across calls, so a later cook sees exactly what an earlier one earned.
 * That keeps the parent's own program untouched — the caller's body is compiled from the caller's
 * source, byte for byte, with nothing injected. A caller who wants the two fused (to measure a
 * swap's own RETURN value instead of a balance) inlines `dynamicChildStatements` with
 * `measure: { kind: "expression", … }` into their own body instead.
 */
export function dynamicChildProgram(entries: readonly DynamicNestEntry[]): {
  readonly source: string;
  readonly imports: readonly string[];
  readonly baseDirs: readonly string[];
} {
  if (entries.length === 0) {
    throw new Error("dynamicChildProgram: no entries — nothing to compile");
  }
  const statements = entries.flatMap((e, i) => dynamicChildStatements(e.child, i, e.opts));
  // Sniffed from the emitted text rather than re-derived from the options on purpose: a caller's own
  // `measure: { kind: "expression" }` may name `IERC20.at(...)` itself, and an options-derived check
  // would miss that and emit a program referencing an unimported binding. The statements are what
  // actually compiles, so they are what decides.
  const needsErc20 = statements.some((s) => s.includes("IERC20.at("));
  const imports = needsErc20 ? [ERC20_IMPORT_LINE] : [];
  const body = statements.join("\n");
  const source = `${imports.length > 0 ? `${imports.join("\n")}\n` : ""}function main() {\n${body}\n}`;
  return { source, imports, baseDirs: needsErc20 ? [...TOKEN_BASE_DIRS] : [] };
}

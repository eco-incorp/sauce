/**
 * eco-routes V2 STATIC nesting — the cross-chain cascade, pure and DSL-free.
 *
 * A STATIC child (every reward field known off-chain) needs no on-chain struct construction and no
 * Sauce-program involvement at all: its `publishAndFund` is a fully pre-encoded `Call`
 * (`portal.ts#publishAndFundTx`) appended to the PARENT's own `route.calls`. This module produces
 * exactly those calls and the build-time invariants that keep a cascade honest — see the design
 * doc's §15 for the full grounding; the load-bearing facts are restated inline below.
 *
 * `P` (the target Portal for `nestedChildCalls`) is always the PARENT's own `route.portal` — not new
 * configuration. The child's source chain IS the parent's destination chain (its execution chain), so
 * the Portal the child publishes on is the Portal on the chain the parent executes on, and
 * `Inbox._fulfill` already requires `route.portal == address(this)`.
 *
 * WHY THE APPROVE IS FROM THE EXECUTOR TO THE PORTAL (`Inbox._fulfill`/`Executor.execute`, verbatim):
 * `_fulfill` `safeTransferFrom`s every `route.tokens` entry from the solver to `address(executor)`,
 * then calls `executor.execute{value: route.nativeAmount}(route.calls)`; `Executor.execute` does a
 * plain `call.target.call{value}(call.data)` per entry (`onlyPortal`). So `msg.sender` for EVERY
 * `route.calls` entry — including a spliced child `approve`/`publishAndFund` — is the EXECUTOR, which
 * is also what holds `route.tokens`/`route.nativeAmount`. `IntentSource._fundToken` reads
 * `token.allowance(funder = msg.sender, address(this) = Portal)`, so the approve must be issued FROM
 * the Executor TO the Portal — exactly what an `approve` `route.calls` entry is.
 */

import type { CanonicalChain } from "../chains/canonical.js";
import { formatAddressField, formatBigint } from "../deposit/format.js";
import { toAddressBigint } from "../token/params.js";
import { ERC20_IMPORT_LINE } from "../token/evm.js";
import { uncheckedTransferStatements } from "../token/unchecked.js";
import { TOKEN_BASE_DIRS } from "../token/source.js";
import { denormalizeToEvm, hashIntent } from "./encode.js";
import { approvalTxs, intentVaultAddressCall, publishAndFundTx, type PortalTx } from "./portal.js";
import { predictVaultAddress, type VaultConfig } from "./vault.js";
import type { AddressInput, CallInput, Intent, Route, UniversalAddress } from "./types.js";

/** Per-child options for `nestedChildCalls` — `portal` is always the PARENT's own `route.portal`. */
export interface NestedChildOptions {
  readonly portal: AddressInput;
  readonly allowPartial: boolean;
}

function toCallInput(tx: PortalTx): CallInput {
  return { target: tx.to, data: tx.data, value: tx.value };
}

/**
 * The calls a static child contributes to the PARENT's own `route.calls`:
 * `[...approve(P, amount) per distinct reward token, publishAndFund(childDestination, childRouteBytes,
 * childReward, allowPartial)]`, all issued against `opts.portal` (the parent's own `route.portal`).
 * Reuses `portal.ts#approvalTxs`/`publishAndFundTx` entirely — no second encoder.
 */
export function nestedChildCalls(child: Intent, opts: NestedChildOptions): readonly CallInput[] {
  const target = { portal: opts.portal };
  return [...approvalTxs(child, target), publishAndFundTx(child, opts.allowPartial, target)].map(
    toCallInput,
  );
}

/**
 * Asserts every field of `child`'s reward is concrete (known off-chain). Vacuous today — `Intent`'s
 * runtime shape has no lazy/runtime-computed field, so a fully-built `Intent` is always static by
 * construction. This is deliberately kept as its own named assertion because it is the SEAM where an
 * S6 runtime-computed child (design doc §7) will be rejected here, rather than silently mis-encoded
 * by treating a placeholder as a real amount.
 */
export function assertStaticChild(_child: Intent): void {
  // Intentionally a no-op today — see the doc comment above.
}

/**
 * The nesting mechanism a child uses. This PURE MODULE's own default is `"publishAndFund"` (so every
 * already-landed caller of `assertNestingInvariants`/`nestedChildCalls` keeps its exact meaning
 * unchanged) — the DSL's own default (`intent-dsl.ts`) is `"transfer"`, a deliberate, documented
 * asymmetry (see that file's module doc). `"transfer"` is the 2026-08-11 USER DIRECTIVE default: the
 * parent's route TRANSFERS a balance-capped amount to the child's (fully static) vault address
 * instead of splicing a runtime `publishAndFund` — see `nestedTransferStatements`/
 * `nestedTransferProgram` below for the codegen, and this file's module doc for the on-chain grounding
 * (balance-based payout, no funded-flag gate, no publication requirement).
 *
 * `"dynamic"` is the one mode whose child is NOT static: its amounts are placeholders until the
 * parent runs, and `nest-dynamic.ts` (not this file) emits the program that measures, derives and
 * splices them. Everything here still applies to it EXCEPT the two invariants that read a child's
 * amounts as numbers — see `assertNestingInvariants`'s 3 and 5.
 */
export type NestVia = "transfer" | "publishAndFund" | "dynamic";

export interface NestChild {
  readonly intent: Intent;
  /** Opt-out of invariant 5's funding-coverage check for this one child: the legitimate case where
   *  the parent's own Sauce program EARNS the child's reward tokens/native and forwards them to the
   *  Executor (its `cook()` caller) rather than the solver delivering them via `route.tokens`.
   *  publishAndFund-mode only — meaningless (and ignored) for a `"transfer"`-mode child, since
   *  invariant 5 is unconditionally dropped for those regardless of this flag. */
  readonly fundedByBody?: boolean;
  /** This PURE module's own default: `"publishAndFund"` (see {@link NestVia}'s doc for why). */
  readonly via?: NestVia;
}

/** `.nest()`'s vault-address resolution, precedence explicit > predicted > runtime (the default) —
 *  see the design doc's "vaultAddrResolution" section for the full rationale of each rung. */
export type ChildVaultResolution =
  | { readonly mode: "explicit"; readonly vault: AddressInput }
  | { readonly mode: "predicted"; readonly config: VaultConfig }
  | { readonly mode: "runtime"; readonly portal: AddressInput };

/** Per-child options for the transfer codegen below. */
export interface TransferChildOptions {
  readonly vaultResolution: ChildVaultResolution;
  /** Caps the transferred amount at the child's own declared reward amount. Default `true` — see
   *  the design doc's "capModel" section for why this is a pure improvement, never a restriction. */
  readonly clamp?: boolean;
  /** Reverts the whole parent fulfillment (rather than quietly stalling the child) when the Pot's
   *  own balance is already short of the declared cap. Default `false`. */
  readonly requireCap?: boolean;
  /** `"skip"` omits the native leg entirely even when `child.reward.nativeAmount > 0`. Default
   *  `"balance"` — transfer `ctx.selfBalance()`, clamped/guarded exactly like an ERC20 leg. */
  readonly native?: "balance" | "skip";
}

export interface AssertNestingInvariantsArgs {
  /** The parent's DESTINATION chain — i.e. its own execution chain, and therefore every child's
   *  source chain. */
  readonly parentChain: CanonicalChain;
  /** The parent's own (already-normalized) `Route` — its `tokens`/`nativeAmount`/`deadline` are what
   *  invariants 4 and 5 check children against. */
  readonly parentRoute: Route;
  readonly children: readonly NestChild[];
}

function tokenKey(token: string): string {
  return token.toLowerCase();
}

/**
 * Asserts the six build-time invariants a static cascade must satisfy (design doc §15.4), all fail
 * closed:
 *
 *  1. EVM parent — `parentChain.kind === "evm"`. The Solana Portal PROGRAM is not in eco-routes on
 *     `main` (zero `.rs`); a child's OWN destination may still be `svm`.
 *  2. Source match — every child's `sourceChainId` equals the parent's destination chain id.
 *  3. Static child — `assertStaticChild` per child (the S6 seam). SKIPPED for a `via: "dynamic"`
 *     child, which is the case that seam was reserved for: its reward amounts are deliberately
 *     placeholders. `nest-dynamic.ts#assertDynamicChild` is its mirror-image check (a child routed
 *     there with NO placeholder is the error), and it runs at codegen time, where the options that
 *     say which sentinels to look for are in scope.
 *  4. Deadlines INCREASE with depth — `child.route.deadline >= parentRoute.deadline` AND
 *     `child.reward.deadline >= parentRoute.deadline`. The child publishes DURING the parent's
 *     fulfillment, which `Inbox._fulfill` allows right up to the parent's own `route.deadline`
 *     (`block.timestamp > route.deadline` is the only revert condition), so an earlier child deadline
 *     is publishable-but-already-dead.
 *  5. Funding coverage — per reward token, `Σ children reward amounts <= Σ parentRoute.tokens
 *     amounts` for that token, and `Σ children reward nativeAmount <= parentRoute.nativeAmount` —
 *     skipping any child with `fundedByBody: true`, and (2026-08-11 directive) UNCONDITIONALLY
 *     skipping every `via: "transfer"` child regardless of `fundedByBody` — the transfer itself IS
 *     the (balance-based) funding, so there is nothing static left to compare against
 *     `parentRoute.tokens`/`nativeAmount`. See `intent-dsl.ts`'s T5 for the one native-only coverage
 *     check that DOES still apply to a transfer child (only when it opts into `fundNativeFromRoute`).
 *     A `via: "dynamic"` child is skipped for a STRONGER reason than a transfer one: its reward
 *     amount is a ~1.5e77 sentinel, so summing it would not merely be uninformative, it would fail
 *     every parent. The funding is the runtime measurement, bounded by the Pot's own balance.
 *  6. No duplicate intent hash — `normalizeRoute` defaults `salt` to 32 zero bytes, so two
 *     structurally identical children silently collapse into the SAME intent. A repeat `intentHash`
 *     anywhere in `children` throws, pointing at `options.salt`.
 */
export function assertNestingInvariants(args: AssertNestingInvariantsArgs): void {
  const { parentChain, parentRoute, children } = args;

  // 1. EVM parent.
  if (parentChain.kind !== "evm") {
    throw new Error(
      `assertNestingInvariants: parent chain '${parentChain.slug}' is not EVM (kind='${parentChain.kind}') — ` +
        `static nesting requires an EVM parent (no Solana Portal PROGRAM in eco-routes on \`main\`); ` +
        `a child's own DESTINATION may still be svm.`,
    );
  }

  const parentDestinationId = BigInt(parentChain.id);
  const parentTokenTotals = new Map<string, bigint>();
  for (const t of parentRoute.tokens) {
    const key = tokenKey(t.token);
    parentTokenTotals.set(key, (parentTokenTotals.get(key) ?? 0n) + t.amount);
  }

  const childTokenTotals = new Map<string, bigint>();
  let childNativeTotal = 0n;
  const seenHashes = new Set<string>();

  children.forEach((child, i) => {
    const { intent } = child;

    // 2. Source match.
    if (intent.sourceChainId !== parentDestinationId) {
      throw new Error(
        `assertNestingInvariants: child[${i}].sourceChainId (${intent.sourceChainId}) does not equal ` +
          `the parent's destination chain id (${parentDestinationId}) — a child's source chain is always ` +
          `the parent's execution chain.`,
      );
    }

    // 3. Static child (the S6 seam) — the `"dynamic"` child is exactly what that seam was held
    // open for, so it is the one mode that skips it rather than being rejected by it.
    const via = child.via ?? "publishAndFund";
    if (via !== "dynamic") assertStaticChild(intent);

    // 4. Deadlines increase with depth.
    if (intent.route.deadline < parentRoute.deadline) {
      throw new Error(
        `assertNestingInvariants: child[${i}].route.deadline (${intent.route.deadline}) is earlier than ` +
          `the parent's route.deadline (${parentRoute.deadline}) — a child published during the parent's ` +
          `fulfillment can be published as late as the parent's own deadline, so an earlier child deadline ` +
          `is publishable-but-already-dead. Use a real margin, not just >=.`,
      );
    }
    if (intent.reward.deadline < parentRoute.deadline) {
      throw new Error(
        `assertNestingInvariants: child[${i}].reward.deadline (${intent.reward.deadline}) is earlier than ` +
          `the parent's route.deadline (${parentRoute.deadline}) — see the route.deadline check above for why.`,
      );
    }

    // 5. Funding coverage (accumulate; checked after the loop) — dropped entirely for a
    // "transfer"- or "dynamic"-mode child (see the doc comment above); `fundedByBody` remains the
    // publishAndFund-only opt-out it always was.
    if (via === "publishAndFund" && !child.fundedByBody) {
      childNativeTotal += intent.reward.nativeAmount;
      for (const t of intent.reward.tokens) {
        const key = tokenKey(t.token);
        childTokenTotals.set(key, (childTokenTotals.get(key) ?? 0n) + t.amount);
      }
    }

    // 6. No duplicate intent hash.
    const { intentHash } = hashIntent(intent);
    if (seenHashes.has(intentHash)) {
      throw new Error(
        `assertNestingInvariants: child[${i}]'s intentHash (${intentHash}) duplicates an earlier child in ` +
          `this cascade — normalizeRoute defaults salt to 32 zero bytes, so two structurally identical ` +
          `children collapse into the SAME intent. Set a distinct options.salt for each child.`,
      );
    }
    seenHashes.add(intentHash);
  });

  if (childNativeTotal > parentRoute.nativeAmount) {
    throw new Error(
      `assertNestingInvariants: children's total reward nativeAmount (${childNativeTotal}) exceeds the ` +
        `parent's route.nativeAmount (${parentRoute.nativeAmount}) — the Executor cannot fund the shortfall ` +
        `(${childNativeTotal - parentRoute.nativeAmount}). Increase route.nativeAmount, reduce the child ` +
        `reward(s), or mark the underfunded child \`fundedByBody: true\` if the parent's own Sauce program ` +
        `earns and forwards it.`,
    );
  }

  for (const [key, childTotal] of childTokenTotals) {
    const parentTotal = parentTokenTotals.get(key) ?? 0n;
    if (childTotal > parentTotal) {
      throw new Error(
        `assertNestingInvariants: children's total reward amount for token ${key} (${childTotal}) exceeds ` +
          `the parent's route.tokens amount for that token (${parentTotal}) — shortfall ` +
          `${childTotal - parentTotal}. Increase that route.tokens entry, reduce the child reward(s), or mark ` +
          `the underfunded child \`fundedByBody: true\`.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Transfer-mode codegen (2026-08-11 directive: the DEFAULT nesting mechanism)
// ---------------------------------------------------------------------------
//
// Pure Sauce-SOURCE text templating — no compiler import, matching this file's/`token/source.ts`'s
// posture (see `intent-dsl.ts`, which owns the `compile()` + call-slotting seam). Per child, per
// reward token: a `balanceOf(self)` read, an optional cap-underfunded revert, an optional clamp to
// the declared cap, and a zero-guarded `transfer` to the resolved vault address. A native leg mirrors
// the same shape using `ctx.selfBalance()` + `evm.call(vault, amount, hex``)`.

/** Resolves `resolution` into a Sauce expression assignment for this child's vault address, bound to
 *  a fresh `n<index>_vault` local so a multi-token/native child only ever resolves it ONCE. */
function vaultAddressStatement(
  child: Intent,
  index: number,
  resolution: ChildVaultResolution,
): { readonly varName: string; readonly statement: string } {
  const varName = `n${index}_vault`;
  let expr: string;
  switch (resolution.mode) {
    case "explicit":
      expr = formatAddressField(toAddressBigint(resolution.vault, "vault"));
      break;
    case "predicted": {
      const { intentHash } = hashIntent(child);
      const addr = predictVaultAddress(intentHash, resolution.config);
      expr = formatBigint(BigInt(addr));
      break;
    }
    case "runtime": {
      const portalLit = formatAddressField(toAddressBigint(resolution.portal, "portal"));
      const calldata = intentVaultAddressCall(child, { portal: resolution.portal }).data;
      const bytesLit = `hex\`${calldata.slice(2)}\``;
      expr = `abi.decode(evm.static(${portalLit}, ${bytesLit}), ["Address"])[0]`;
      break;
    }
  }
  return { varName, statement: `const ${varName} = ${expr};` };
}

/** T2: every reward token must denormalize to a 20-byte EVM address — the transfer runs on the
 *  parent's own EVM (source) chain regardless of the child's destination. Reuses
 *  `encode.ts#denormalizeToEvm`'s own named throw rather than re-deriving the check. */
function evmTokenLiteral(token: UniversalAddress): string {
  return formatBigint(BigInt(denormalizeToEvm(token)));
}

function assertNonEmptyChildReward(child: Intent, index: number): void {
  if (child.reward.tokens.length === 0 && child.reward.nativeAmount === 0n) {
    throw new Error(
      `nestedTransferStatements: child[${index}]'s reward is empty (no tokens, nativeAmount=0) — ` +
        `"transfer" mode has nothing to fund; declare a nonzero reward.tokens/reward.nativeAmount, or ` +
        `use \`via: "publishAndFund"\` explicitly (T1).`,
    );
  }
}

/**
 * The Sauce statements one child contributes to a merged transfer program (see
 * `nestedTransferProgram`): a `balanceOf`/clamp/zero-guard/`transfer` block per reward token, plus an
 * analogous native leg, each capped at exactly the amount the caller declared in `child.reward` (the
 * design doc's "capModel"). `index` namespaces every local this child introduces (`n<index>_...`) so
 * several children merge into ONE program scope without colliding.
 */
export function nestedTransferStatements(
  child: Intent,
  index: number,
  opts: TransferChildOptions,
): readonly string[] {
  assertNonEmptyChildReward(child, index);

  const clamp = opts.clamp ?? true;
  const requireCap = opts.requireCap ?? false;
  const nativeMode = opts.native ?? "balance";
  const willTransferNative = child.reward.nativeAmount > 0n && nativeMode !== "skip";

  if (child.reward.tokens.length === 0 && !willTransferNative) {
    // Every token leg is empty and the native leg was explicitly skipped — nothing to emit (the
    // caller opted out of the only fundable leg this child declared); T1 above already rejected the
    // genuinely-empty-reward case, so this is a deliberate `native: "skip"` no-op, not an error.
    return [];
  }

  const { varName: vaultVar, statement: vaultStmt } = vaultAddressStatement(
    child,
    index,
    opts.vaultResolution,
  );
  const stmts: string[] = [vaultStmt];

  child.reward.tokens.forEach((t, i) => {
    const tokenLit = evmTokenLiteral(t.token);
    const capLit = formatBigint(t.amount);
    const balVar = `n${index}_bal${i}`;
    const amtVar = `n${index}_amt${i}`;
    stmts.push(`const ${balVar} = IERC20.at(${tokenLit}).balanceOf(ctx.self());`);
    if (requireCap) {
      stmts.push(`if (${balVar} < ${capLit}) { throw 'nest: child underfunded'; }`);
    }
    const amtExpr = clamp ? amtVar : balVar;
    if (clamp) {
      stmts.push(`const ${amtVar} = ${balVar} > ${capLit} ? ${capLit} : ${balVar};`);
    }
    // The transfer is a raw `evm.call` with no declared output, not `IERC20.at(t).transfer(...)`:
    // the vendored IERC20 declares a `bool` return, the compiler lowers that to call-then-DECODE
    // even though nothing reads it, and decoding from empty returndata reverts on this engine. A
    // no-return token (USDT) therefore used to revert the whole parent fulfilment from the DEFAULT
    // nesting mode. `balanceOf` above keeps its binding -- a `uint256` return is always there. See
    // `token/unchecked.ts`; a transfer the token itself refuses still reverts.
    const transferStmts = uncheckedTransferStatements(
      `n${index}_${i}_`,
      tokenLit,
      { local: vaultVar },
      { local: amtExpr },
    );
    // The calldata consts are hoisted out of the zero-guard; only the call belongs inside it.
    stmts.push(...transferStmts.slice(0, -1));
    stmts.push(`if (${amtExpr} > 0n) { ${transferStmts.at(-1)!} }`);
  });

  if (willTransferNative) {
    const capLit = formatBigint(child.reward.nativeAmount);
    const nbalVar = `n${index}_nbal`;
    const namtVar = `n${index}_namt`;
    stmts.push(`const ${nbalVar} = ctx.selfBalance();`);
    if (requireCap) {
      stmts.push(`if (${nbalVar} < ${capLit}) { throw 'nest: child underfunded'; }`);
    }
    const namtExpr = clamp ? namtVar : nbalVar;
    if (clamp) {
      stmts.push(`const ${namtVar} = ${nbalVar} > ${capLit} ? ${capLit} : ${nbalVar};`);
    }
    // The empty calldata is BOUND, not inline: a method call on a `hex` literal is outside the
    // compiler's supported subset. Per-child, like every other name here, so the statements stay
    // valid on their own and several children merge into one program without redeclaring.
    const dataVar = `n${index}_ndata`;
    stmts.push(`const ${dataVar} = hex\`\`;`);
    stmts.push(`if (${namtExpr} > 0n) { evm.call(${vaultVar}, ${namtExpr}, ${dataVar}); }`);
  }

  return stmts;
}

/** One `{ child, opts }` pair per transfer-mode nested child, merged (in this array's order) into
 *  ONE `nestedTransferProgram` output. */
export interface TransferNestEntry {
  readonly child: Intent;
  readonly opts: TransferChildOptions;
}

/**
 * Merges every entry's `nestedTransferStatements` into ONE `function main(){...}` Sauce program —
 * `intent-dsl.ts` is the only caller that ever `compile()`s this text, keeping the compiler
 * dependency out of this pure module entirely. `imports`/`baseDirs` are surfaced separately so a
 * caller with its own `baseDirs`/compile options can merge them rather than re-deriving what this
 * program needs.
 */
export function nestedTransferProgram(entries: readonly TransferNestEntry[]): {
  readonly source: string;
  readonly imports: readonly string[];
  readonly baseDirs: readonly string[];
} {
  const statements = entries.flatMap((e, i) => nestedTransferStatements(e.child, i, e.opts));
  const needsErc20 = entries.some((e) => e.child.reward.tokens.length > 0);
  const imports = needsErc20 ? [ERC20_IMPORT_LINE] : [];
  const body = statements.join("\n");
  const source = `${imports.length > 0 ? `${imports.join("\n")}\n` : ""}function main() {\n${body}\n}`;
  return { source, imports, baseDirs: needsErc20 ? [...TOKEN_BASE_DIRS] : [] };
}

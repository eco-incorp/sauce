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
import { hashIntent } from "./encode.js";
import { approvalTxs, publishAndFundTx, type PortalTx } from "./portal.js";
import type { AddressInput, CallInput, Intent, Route } from "./types.js";

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
 * `[...approve(P, amount) per reward token, publishAndFund(childDestination, childRouteBytes,
 * childReward, allowPartial)]`, all issued against `opts.portal` (the parent's own `route.portal`).
 * Reuses `portal.ts#approvalTxs`/`publishAndFundTx` entirely — no second encoder.
 */
export function nestedChildCalls(child: Intent, opts: NestedChildOptions): readonly CallInput[] {
  const target = { portal: opts.portal };
  return [...approvalTxs(child, target), publishAndFundTx(child, opts.allowPartial, target)].map(toCallInput);
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

export interface NestChild {
  readonly intent: Intent;
  /** Opt-out of invariant 5's funding-coverage check for this one child: the legitimate case where
   *  the parent's own Sauce program EARNS the child's reward tokens/native and forwards them to the
   *  Executor (its `cook()` caller) rather than the solver delivering them via `route.tokens`. */
  readonly fundedByBody?: boolean;
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
 *  3. Static child — `assertStaticChild` per child (the S6 seam).
 *  4. Deadlines INCREASE with depth — `child.route.deadline >= parentRoute.deadline` AND
 *     `child.reward.deadline >= parentRoute.deadline`. The child publishes DURING the parent's
 *     fulfillment, which `Inbox._fulfill` allows right up to the parent's own `route.deadline`
 *     (`block.timestamp > route.deadline` is the only revert condition), so an earlier child deadline
 *     is publishable-but-already-dead.
 *  5. Funding coverage — per reward token, `Σ children reward amounts <= Σ parentRoute.tokens
 *     amounts` for that token, and `Σ children reward nativeAmount <= parentRoute.nativeAmount` —
 *     skipping any child with `fundedByBody: true`.
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

    // 3. Static child (the S6 seam).
    assertStaticChild(intent);

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

    // 5. Funding coverage (accumulate; checked after the loop).
    if (!child.fundedByBody) {
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

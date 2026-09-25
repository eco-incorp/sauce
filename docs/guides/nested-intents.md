# Nested intents

[Documentation](../README.md) · [Create an intent](intents.md) · [Routes API](../api/routes.md)

`.nest(...)` adds a child intent whose source is the parent's destination. When the parent fulfills, its route funds the child's reward. A solver can fulfill that child in a later transaction on the child's destination chain. Each leg is a separate intent; a failure on a later chain does not roll back a completed parent.

Use the thunk form to receive the parent's destination as the child's source:

```ts
import "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

export function buildCascade(
  parentOptions: routes.IntentOptions,
  childOptions: routes.IntentOptions,
  parentReward: routes.SauceRewardSpec,
  childReward: Omit<routes.SauceRewardSpec, "source">,
  executionFee: bigint,
) {
  return Base("return 1n;", parentOptions)
    .nest(
      (on) =>
        Arbitrum("return 1n;", childOptions).reward({
          ...childReward,
          source: on,
        }),
      { requireCap: true, executionFee },
    )
    .reward(parentReward);
}
```

The example isolates composition: replace the no-op bodies with your programs. Each options object supplies its destination execution, Portal, deadline, and body cook fee. `executionFee` is the Base Kitchen quote for the additional transfer cook; include it in `parentOptions.nativeAmount` alongside the parent body and any native reward forwarding. Configure `childOptions.sourcePortal` as the Portal on Base. Deliver or earn the child's reward assets in the parent fulfillment before the funding step; see [the Executor-to-Pot example](intents.md#build-a-base-usdc-transfer-intent).

You can also pass an already built child. The SDK checks that its source matches the parent's destination. Both forms produce static children: reward amounts and other hashed fields are fixed before execution. A runtime balance can determine how much is transferred to a child's vault; it does not rewrite the child's reward or hash.

## Default: transfer to the child vault

The fluent API defaults to `via: "transfer"` and `position: "after"`. After the parent program, another Sauce program reads the Pot's balance and transfers assets to the child vault. By default each transfer is capped at the declared child reward amount. Deliver or earn those assets in the same parent fulfillment; do not leave user funds in the Executor-owned Pot between transactions.

| Option                | Default     | Effect                                                                               |
| --------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `clamp`               | `true`      | Transfer at most the declared child reward amount                                    |
| `requireCap`          | `false`     | If enabled, revert the parent fulfillment when the Pot cannot cover the cap          |
| `native`              | `"balance"` | Include the native leg; `"skip"` omits it                                            |
| `fundNativeFromRoute` | `false`     | Forward the child's declared native reward from route value into the transfer `cook` |
| `executionFee`        | `0n`        | Additional wei for the merged transfer cook's Kitchen fee                            |
| `position`            | `"after"`   | Run after the parent body; `"before"` runs before it                                 |

With default `requireCap: false`, a short Pot balance can leave the child underfunded while the parent succeeds. Select `requireCap: true` when full child funding must be a condition of parent fulfillment. With multiple children, transfers consume balances sequentially.

Read the current Kitchen fee and supply `executionFee` for every transfer child. Children merged into one position share one fee and must specify the same value; separate `"before"` and `"after"` cooks each pay. The generated call adds this fee to any `fundNativeFromRoute` reward amounts, so the fee does not reduce the child's funding. Zero works only on a fee-free Kitchen. When a nonzero fee is supplied, the builder checks that `nativeAmount` covers the calls' combined value, excluding publication funding explicitly marked `fundedByBody`.

The default vault resolution calls the Portal from the generated program. Alternatively, pass `vault` after verifying it with `child.vaultCall()`, or pass `vaultConfig` containing the verified `vaultInitCodeHash` for an offline prediction. Explicit `vault` takes precedence over `vaultConfig`.

Transfer funding does not emit a child `IntentPublished` event. Share the built child with your solver or intent-distribution system; an indexer relying only on publication events cannot discover it from such an event.

## Opt in to publication and Portal funding

Use `{ via: "publishAndFund" }` to insert ERC-20 approvals followed by a Portal `publishAndFund` call in the parent route. This mode adds no Sauce cook or Kitchen fee. Those calls run as the Executor, so child reward assets must remain in the Executor or return there from the parent program before publication. `allowPartial` defaults to `false`. Budget the parent's `nativeAmount` for its cook fee, native program spending, and the child's native reward.

The builder checks that declared parent route assets cover child rewards for this mode. Set `fundedByBody: true` only when the parent program actually earns or supplies those assets and makes them available to the Executor. That option skips a static coverage check; it does not move assets.

`allowPartial` and `fundedByBody` belong to publication mode. `vault`, `vaultConfig`, `clamp`, `requireCap`, `native`, `fundNativeFromRoute`, `executionFee`, `pot`, `engine`, and `compile` belong to transfer mode. Mixing mode-specific options throws.

## Ordering and constraints

The current call order is:

1. Parent `precalls`.
2. Children positioned `"before"`.
3. The parent's compiled program.
4. Children positioned `"after"`.

Within either position group, publication-mode calls precede the merged transfer program. Transfer children execute in their `.nest()` order inside that program. Do not depend on an interleaving of different funding modes. Transfer children merged into one position must use the same Pot, engine, and execution fee.

The builder enforces an EVM parent destination, matching parent-destination/child-source chains, and child route and reward deadlines at least as late as the parent route deadline. The codec accepts SVM children, but the [built-in SVM Sauce route is incompatible with the released engine](solana.md#svm-destinations-in-eco-intents). Duplicate direct-child intent hashes are rejected; use distinct salts for otherwise identical children. The default salt is zero, so separate construction alone does not create a distinct intent.

`.intents()` lists the root and descendants in preorder, while `.children` lists direct children. Store the whole cascade if your application must distribute every leg. The root's approval helpers fund only the root; child funding is part of parent fulfillment.

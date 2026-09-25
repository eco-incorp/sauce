# Nested intents

[Documentation](../README.md) · [Create an intent](intents.md) · [Routes API](../api/routes.md)

`.nest(...)` adds a child intent whose source is the parent's destination. When the parent fulfills, its route funds the child's reward. A solver can fulfill that child in a later transaction on the child's destination chain. Each leg is a separate intent; a failure on a later chain does not roll back a completed parent.

Use the thunk form to receive the parent's destination as the child's source:

```ts
import { Arbitrum, Base } from "@eco-incorp/sauce";
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

You can also pass an already built child. The SDK checks that its source matches the parent's destination. Under the two default modes both forms produce static children: reward amounts and other hashed fields are fixed before execution. A runtime balance can determine how much is transferred to a child's vault; it does not rewrite the child's reward or hash. [`via: "dynamic"`](#create-the-child-on-chain-from-a-measured-amount) is the exception, and it changes the child's hash.

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

`fundedByBody` belongs to publication mode, and `allowPartial` to publication and dynamic modes. `vault`, `vaultConfig`, `clamp`, `requireCap`, `native`, and `fundNativeFromRoute` belong to transfer mode; `executionFee`, `pot`, `engine`, and `compile` to transfer and dynamic modes. `measure`, `scale`, `minAmountIn`, `placeholders`, `approve`, and `value` belong to dynamic mode. Mixing mode-specific options throws, naming the modes the option is valid under.

## Create the child on-chain from a measured amount

The two modes above require every child reward amount before the parent is signed. When the amount is the output of a swap the parent itself performs, it does not exist yet. `{ via: "dynamic" }` builds that child anyway.

Write a placeholder wherever a runtime amount belongs, then name the measurement:

```ts
import "@eco-incorp/sauce";
import { routes } from "@eco-incorp/sauce";

const { AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER } = routes;

const child = Arbitrum("return 1n;", {
  ...childOptions,
  tokens: [{ token: USDC_ARBITRUM, amount: AMOUNT_OUT_PLACEHOLDER }],
}).reward({ ...childReward, tokens: [{ token: USDC_BASE, amount: AMOUNT_IN_PLACEHOLDER }] });

const parent = Base(swapProgram, parentOptions)
  .nest(child, {
    via: "dynamic",
    measure: { kind: "erc20Balance", token: USDC_BASE },
    scale: 990000000000000000n,
    placeholders: [
      { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
      { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
    ],
  })
  .reward(parentReward);
```

The child's `publishAndFund` calldata is encoded once off-chain, cut at every placeholder, and emitted as literal byte runs inside an additional cook. At execution that cook reads the Pot's balance, derives `amountOut = ceil(amountIn * scale / WAD)` with `WAD = 1e18`, approves the Portal, concatenates the calldata around the two numbers, and calls the Portal. No additional contract is involved.

| Option         | Default                     | Effect                                                                                   |
| -------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `measure`      | required                    | `erc20Balance`, `nativeBalance`, or a caller-supplied SauceScript expression             |
| `scale`        | `10n ** 18n`                | `amountOut = ceil(amountIn * scale / WAD)`; carries decimals conversion and margin       |
| `minAmountIn`  | `1n`                        | Revert the parent fulfillment below this floor; `0n` removes the check                   |
| `placeholders` | both 32-byte sentinels      | Which sentinels to cut at, with per-slot `scale`, `width`, `littleEndian`, `occurrences` |
| `approve`      | `"auto"`                    | Emit the Pot's reward-token approvals; `"none"` leaves them to you                       |
| `value`        | `child.reward.nativeAmount` | Native forwarded to `publishAndFund`                                                     |
| `allowPartial` | `false`                     | Passed through to `publishAndFund`                                                       |
| `executionFee` | `0n`                        | The cook's total value: Kitchen fee plus any native the child forwards                   |

Every guard in the generated program — the floor, the scale-overflow check, and the per-field width check — reverts the parent's whole fulfilment when it trips. No earlier route call survives it, so a rejected measurement cannot leave a parent completed with its child unpublished and the measured funds sitting in the Pot.

Declare `occurrences` for every placeholder. Without it any count above zero is accepted, and a sentinel that matched one word too few leaves a placeholder amount in a published intent.

The measurement is the Pot's current balance, not a delta against a baseline, so a donated balance rides along — the same property transfer mode has. A child whose destination is Solana needs `AMOUNT_IN_PLACEHOLDER_U64`/`AMOUNT_OUT_PLACEHOLDER_U64` with `width: 8, littleEndian: true` for its Borsh route amounts; its reward stays on the EVM source chain and keeps the 32-byte sentinels.

The child's hash is not known until the parent executes, so `child.hash()`, `child.vaultCall()`, and the approval helpers describe the placeholder intent, not the published one. Recover the real hash from the Portal's `IntentPublished` event. Off-chain, `routes.renderDynamicChild(child.intent, dynamicOptions, amountIn)` returns the exact `publishAndFund` calldata a given measurement produces, where `dynamicOptions` is the `portal`/`measure`/`scale`/`placeholders` set passed to `.nest()`; rebuild the child with those amounts and hash it with `routes.hashIntent`. Funding coverage is not checked for this mode: the funding is the measurement, bounded by the Pot's balance.

## Ordering and constraints

The current call order is:

1. Parent `precalls`.
2. Children positioned `"before"`.
3. The parent's compiled program.
4. Children positioned `"after"`.

Within either position group, publication-mode calls precede the merged transfer program, which precedes the merged dynamic program. Children of one mode execute in their `.nest()` order inside that mode's program. Do not depend on an interleaving of different funding modes; when one must run before another, put it in the other position group. Transfer children merged into one position must use the same Pot, engine, and execution fee, and so must dynamic children.

The builder enforces an EVM parent destination, matching parent-destination/child-source chains, and child route and reward deadlines at least as late as the parent route deadline. The codec accepts SVM children, but the [built-in SVM Sauce route is incompatible with the released engine](solana.md#svm-destinations-in-eco-intents). Duplicate direct-child intent hashes are rejected; use distinct salts for otherwise identical children. The default salt is zero, so separate construction alone does not create a distinct intent.

`.intents()` lists the root and descendants in preorder, while `.children` lists direct children. Store the whole cascade if your application must distribute every leg. The root's approval helpers fund only the root; child funding is part of parent fulfillment.

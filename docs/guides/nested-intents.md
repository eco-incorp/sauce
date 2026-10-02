# Nested intents

[Documentation](../README.md) · [Create an intent](intents.md) · [Routes API](../api/routes.md)

`.nest(...)` adds a child intent whose source is the parent's destination. When the parent fulfills, its route funds the child's reward. A solver can fulfill that child in a later transaction on the child's destination chain. Each leg is a separate intent; a failure on a later chain does not roll back a completed parent.

The examples here hop through Arbitrum and Optimism, which are preview chains for the initial
release: the SDK builds them as shown, at your own risk, while the `sauce` command and the MCP server
publish an intent only when its source and destination are Ethereum, Base or Solana
([Supported chains](../README.md#supported-chains)). They check the first level only, so keep every
later level of a cascade on a supported chain too.

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
  return Base("function main() { return 1n; }", parentOptions)
    .nest(
      (on) =>
        Arbitrum("function main() { return 1n; }", childOptions).reward({
          ...childReward,
          source: on,
        }),
      { requireCap: true, executionFee },
    )
    .reward(parentReward);
}
```

The example isolates composition: replace the no-op bodies with your programs. Each options object supplies its deadline and body cook fee. Each level's Portals, prover, Pot and engine come from the registry — the child's source Portal is the one on Base, its source — and each level's Pot must exist before that level is fulfilled. `executionFee` is the Base Kitchen quote for the additional transfer cook; the parent's `nativeAmount` defaults to every call's value, so it covers the parent body's cook, this one and any native reward forwarding. Deliver or earn the child's reward assets in the parent fulfillment before the funding step; see [the Executor-to-Pot example](intents.md#build-a-base-usdc-transfer-intent).

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

Read the current Kitchen fee and supply `executionFee` for every transfer child. Children merged into one position share one fee and must specify the same value; separate `"before"` and `"after"` cooks each pay. The generated call adds this fee to any `fundNativeFromRoute` reward amounts, so the fee does not reduce the child's funding. Zero works only on a fee-free Kitchen. The route's `nativeAmount` defaults to the calls' combined value, excluding publication funding explicitly marked `fundedByBody`; one you set is checked to cover it when a nonzero fee is supplied.

The default vault resolution calls the Portal from the generated program. Alternatively, pass `vault` after verifying it with `child.vaultCall()`, or pass `vaultConfig` for an offline prediction: `routes.ecoRoutesVaultConfig(portal)` is the configuration of an eco-routes Portal, the one `child.predictVault()` uses. Explicit `vault` takes precedence over `vaultConfig`.

Transfer funding does not emit a child `IntentPublished` event. Share the built child with your solver or intent-distribution system; an indexer relying only on publication events cannot discover it from such an event. That is the one difference from an intent a program opens with `Chain(() => …).reward(…)`, which is also funded by transfer to its vault by default but is then published, in the same transaction — see [intents](intents.md#how-the-reward-is-funded).

## Opt in to publication and Portal funding

Use `{ via: "publishAndFund" }` to insert ERC-20 approvals followed by a Portal `publishAndFund` call in the parent route. This mode adds no Sauce cook or Kitchen fee. Those calls run as the Executor, so child reward assets must remain in the Executor or return there from the parent program before publication. `allowPartial` defaults to `false`. The parent's `nativeAmount` defaults to what its calls spend, which includes its cook fee, native program spending, and the child's native reward.

The builder checks that declared parent route assets cover child rewards for this mode. Set `fundedByBody: true` only when the parent program actually earns or supplies those assets and makes them available to the Executor. That option skips a static coverage check; it does not move assets.

`fundedByBody` belongs to publication mode, and `allowPartial` to publication and dynamic modes. `vault`, `vaultConfig`, `clamp`, `requireCap`, `native`, and `fundNativeFromRoute` belong to transfer mode; `executionFee`, `pot`, `engine`, and `compile` to transfer and dynamic modes. `measure`, `scale`, `minAmountIn`, `placeholders`, `approve`, and `value` belong to dynamic mode. Mixing mode-specific options throws, naming the modes the option is valid under.

## Create the child on-chain from a measured amount

The two modes above require every child reward amount before the parent is signed. When the amount is the output of a swap the parent itself performs, it does not exist yet. `{ via: "dynamic" }` builds that child anyway.

Write a placeholder wherever a runtime amount belongs, then name the measurement:

```ts
import { Arbitrum, Base, routes } from "@eco-incorp/sauce";

const { AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER } = routes;

const child = Arbitrum("function main() { return 1n; }", {
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

A child built this way is an ordinary built intent, so it can nest dynamically in turn; see [Chain more than one hop](#chain-more-than-one-hop).

## A cascade in native syntax

The shortest way to chain hops is to write them inside the program, one intent opening the next:

```js
// Three hops, written as three intents opening one another.
//
// No amount below the first exists when this is signed. `amount` is measured here. `swapped` is
// measured on Arbitrum while that hop is being fulfilled, by the program the middle braces compiled
// to, and it is the reward of the third hop. Each level's numbers are filled in by the level above
// it, at that level's own execution time.
//
// The middle body is more than token writes, so it compiles to a program and runs on Arbitrum's
// Pot; its second argument names what a solver must deliver for it to have something to measure.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it, so the Arbitrum hop's reward is the first chain's
// USDC and the Optimism hop's is Arbitrum's.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(
    () => {
      const swapped = USDC.balanceOf(ctx.self());
      Optimism(() => {
        USDC.transfer(RECIPIENT, swapped);
      }).reward({ tokens: [{ token: USDC, amount: swapped }] });
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
```

Three hops, and **no amount below the first exists when this is signed**. `amount` is measured on the
first chain. `swapped` is measured on Arbitrum, while that hop is being fulfilled, by the program the
middle braces compiled to — and it is the reward of the third. Each level's numbers are filled in by
the level above it, at that level's own execution time.

Each hop is funded on the chain whose program offers it. The Arbitrum hop's reward is the first
chain's USDC, escrowed and approved there. The Optimism hop's reward is Arbitrum's USDC, out of what
the solver delivered to Arbitrum's Pot, and its body pays in Optimism's. See
[names resolve per chain](intents.md#names-resolve-per-chain).

Nesting is recursive rather than special-cased: the middle body is compiled by re-entering the same
pipeline, so the same lowering runs inside it at any depth. [Create an intent from inside a
program](intents.md#create-an-intent-from-inside-a-program) covers what may be captured, the two
lowerings, and the values you supply.

Use this when the hops are a chain and the amounts are discovered as you go. Use the `.nest(...)`
builder below when you are assembling intents in TypeScript from data you already hold, when you
want several children on one parent, or when you need the transfer and publication modes it offers.

## Chain more than one hop

A dynamic child is an ordinary built intent, so it can carry a dynamic nest of its own. That is how a chain of swaps whose every hop's output is only known at that hop works: the parent swaps A for B and publishes the child, the child swaps B for C and publishes the grandchild, and the grandchild delivers C. Nothing below the first amount exists when the parent is signed.

```ts
import { Arbitrum, Base, Optimism, routes } from "@eco-incorp/sauce";

const { AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER } = routes;

const placeholders = [
  { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
  { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
] as const;

const grandchild = Optimism("function main() { return 1n; }", {
  ...grandchildOptions,
  tokens: [{ token: USDC_OPTIMISM, amount: AMOUNT_OUT_PLACEHOLDER }],
}).reward({
  ...grandchildReward,
  tokens: [{ token: USDC_ARBITRUM, amount: AMOUNT_IN_PLACEHOLDER }],
});

const child = Arbitrum(swapBforC, {
  ...childOptions,
  tokens: [{ token: USDC_ARBITRUM, amount: AMOUNT_OUT_PLACEHOLDER }],
})
  .nest(grandchild, {
    via: "dynamic",
    measure: { kind: "erc20Balance", token: USDC_ARBITRUM },
    placeholders: [...placeholders],
  })
  .reward({ ...childReward, tokens: [{ token: USDC_BASE, amount: AMOUNT_IN_PLACEHOLDER }] });

const parent = Base(swapAforB, parentOptions)
  .nest(child, {
    via: "dynamic",
    measure: { kind: "erc20Balance", token: USDC_BASE },
    placeholders: [...placeholders],
  })
  .reward(parentReward);
```

The middle level is not a special form. It is the same construct applied twice, so depth 3 and beyond follow from depth 2 without new options.

### Why levels do not collide

Each level's route embeds the next level's compiled program as literal calldata, and the level above splices amounts into that. The obvious hazard is that a parent's placeholder search also matches the sentinels belonging to levels below it, overwriting a placeholder the grandchild still needs.

It cannot, and this is an invariant of the mechanism rather than a property of any particular cascade. Splitting a payload **cuts the sentinels out**: a compiled dynamic program holds the literal segments that sat _around_ each placeholder and never the placeholder bytes themselves. So when a parent splits its child's encoding it finds the child's own slots and nothing else, and adding a nest to a level does not change that level's own `occurrences` counts — the extra cook call contributes bytes, not sentinels.

Each level's numbers are therefore spliced by the level directly above it, at that level's own execution time. No level needs to know the amounts below it, and none can disturb them.

### Cost and depth

Growth is linear, not multiplicative: each level's bytes appear exactly once in the chain, so the outermost payload is the sum of the per-level overheads. On the SDK's own fixture that is about 1,500 bytes of `cook` calldata at depth 1 and about 1,950 bytes for each level after it. A measured depth-2 cascade cost roughly 286,000 gas to fulfill the parent and 267,000 to fulfill the child; every one of these numbers moves with the size of the intents you nest, so treat them as an order of magnitude rather than a budget.

The hard ceiling is the compiler's, and it is named rather than silent. A `hex` segment carries a `u16` length, so no single segment may exceed 65,535 bytes; on that fixture the deepest cascade that compiles is 34 levels, and one level further fails with `an array literal has … elements, beyond the 65535 the engine can encode`. Nothing truncates. In practice gas binds long before that, and a cascade deep enough to approach the limit is one to reconsider rather than to budget for.

Depth 2 is executed end to end against a real engine, Pot and Portal in the SDK's own suite. Deeper cascades are established by compilation and encoding only — none has been run on a chain.

### What changes beyond the first hop

Hash recovery becomes sequential. At depth 1 the child's real hash is unknown until the parent executes; at depth 2 the grandchild's is unknown until the _child_ executes, which is a separate fulfillment by a different solver at a later time. An indexer must follow `IntentPublished` level by level, and no amount of off-chain computation shortens that — the input to each level is a measurement that has not happened yet.

Everything else compounds rather than changes. Deadlines must still increase with depth, checked per level, and every level cooks on an Executor-owned Pot — the derived shared one unless you name one, deployed beforehand either way — and pays the current Kitchen fee on its own chain. The `Create the child on-chain from a measured amount` section's properties — the current-balance measurement, the guard behavior, the Solana sentinel widths — apply unchanged at every level.

## Ordering and constraints

The current call order is:

1. Parent `precalls`.
2. Children positioned `"before"`.
3. The parent's compiled program.
4. Children positioned `"after"`.

Within either position group, publication-mode calls precede the merged transfer program, which precedes the merged dynamic program. Children of one mode execute in their `.nest()` order inside that mode's program. Do not depend on an interleaving of different funding modes; when one must run before another, put it in the other position group. Transfer children merged into one position must use the same Pot, engine, and execution fee, and so must dynamic children.

The builder enforces an EVM parent destination, matching parent-destination/child-source chains, and child route and reward deadlines at least as late as the parent route deadline. The codec accepts SVM children, but the [built-in SVM Sauce route is incompatible with the released engine](solana.md#svm-destinations-in-eco-intents). Duplicate direct-child intent hashes are rejected; use distinct salts for otherwise identical children. The default salt is zero, so separate construction alone does not create a distinct intent.

`.intents()` lists the root and descendants in preorder, while `.children` lists direct children. Store the whole cascade if your application must distribute every leg. The root's approval helpers fund only the root; child funding is part of parent fulfillment.

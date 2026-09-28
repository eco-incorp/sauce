# Actions

[Documentation](../README.md) · [Intents](intents.md) · [Nested intents](nested-intents.md) · [Compiling](compiling.md)

An **action** is one protocol operation written as data: swap on a Uniswap V3 pool, supply to Aave, bridge through Across, wrap ETH. An **action program** is an ordered list of actions for one chain. `@eco-incorp/sauce/actions` compiles it into one Sauce program that executes, atomically, in a Pot on that chain — directly, or as the destination route of an Eco intent.

A program is plain JSON. You can write it by hand, store it, sign it, generate it from a service in any language, and validate it against the published [JSON Schema](../../actions/action-program.schema.json) before it reaches TypeScript.

```json
{
  "version": 1,
  "chainId": 1,
  "actions": [
    {
      "type": "wrapETH",
      "weth": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "amount": "1000000000000000000"
    },
    {
      "type": "approve",
      "token": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "spender": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
    },
    {
      "type": "uniswapV3ExactInput",
      "router": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      "tokenIn": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "tokenOut": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "fee": 500,
      "amountIn": "1000000000000000000",
      "amountOutMin": "3000000000",
      "recipient": "self",
      "deadline": 1893456000,
      "saveOutputAs": "usdc"
    },
    {
      "type": "aaveV3Supply",
      "pool": "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "onBehalfOf": "0x3000000000000000000000000000000000000001",
      "referralCode": 0,
      "amountRef": "usdc"
    }
  ]
}
```

This wraps 1 ETH, approves the router for exactly what was wrapped, swaps it for USDC into the executing Pot, and supplies whatever the swap returned to Aave on the owner's behalf. The approve and the supply name no amount: the approve spends the previous action's output, and the supply spends the output saved as `usdc`. (The supply also needs an approval of the Pool; it is left out to keep the example short.)

## Compile and run a program

```ts
import { compileActions, parseActionProgram } from "@eco-incorp/sauce/actions";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, type Address } from "viem";

export function cookProgram(json: string, engine: Address) {
  const program = parseActionProgram(json); // throws, listing every problem with its path
  const { bytecode, source } = compileActions(program);
  console.log(source); // the SauceScript that will execute

  return v12Pot.encodeCook(engine, bytesToHex(bytecode));
}
```

Send the resulting calldata to the Pot from its owner, with the Kitchen's execution fee plus any native value the program spends (for `wrapETH` above, 1 ETH). The Pot is the account whose balances the program uses: fund it before the program runs. See [compiling programs](compiling.md) for the execution boundary.

`compileActions` also accepts a bare `RoutingAction[]`, held to the chain of its first action. The older entry points keep working: `actionsToSauce(actions)` returns the bytecode and `actionsToSauceSource(actions)` the source.

## The JSON format

A program is `{ "version": 1, "chainId": <chain>, "actions": [ … ] }`. Each action is an object whose `type` selects its fields; the [reference](#supported-actions) lists every type, and the schema lists every field with its documentation. A `$schema` key is allowed and ignored.

| Value                                                    | Encoding                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Amounts, prices, gas, fees, strategy ids                 | Base-10 string: `"1000000"`. No sign, exponent, or leading zeros. |
| Addresses                                                | `0x` + 40 hex digits. Mixed case must be a valid EIP-55 checksum. |
| Recipients (`recipient`, `to`, `onBehalfOf`)             | An address, or `"self"` for the executing Pot.                    |
| Byte strings (`path`, `message`, `auxiliaryData`)        | `0x` + an even number of hex digits.                              |
| 32-byte values (`poolId`, `salt`, `mintRecipient`)       | `0x` + 64 hex digits.                                             |
| Fee tiers, indices, domains, pool ids, Unix-second times | JSON integers.                                                    |

JSON numbers cannot represent integers above 2^53, so the parser rejects an amount written as a number instead of rounding it. Each amount must also fit the width of the field it becomes: a Uniswap V4 `amountOutMin` is a `uint128`, and a larger value is an error rather than a silently truncated one.

An action may carry its own `chainId` (a bridge: `srcChainId`); it must equal the program's, and is filled in from it when omitted. Every action in a program runs in one transaction on one chain. A bridge action's destination is its `destChainId`, not a second place the program runs.

### Validation and errors

`parseActionProgram(input)` takes the JSON text or a parsed value, checks it strictly, and returns a fresh program in canonical key order. It throws an `ActionProgramError` whose `issues` list every problem, each with a path:

```text
invalid action program (2 issues):
  actions[0].amount: expected a base-10 string, got the JSON number 1000000 — JSON numbers lose precision above 2^53, so amounts are strings: write "1000000"
  actions[1].amountin: unknown field — did you mean `amountIn`? (allowed: type, chainId, amountIn, router, …)
```

`validateActionProgram(input)` returns `{ ok, program }` or `{ ok, issues }` without throwing. `serializeActionProgram(program)` writes canonical JSON, so two equal programs serialize to the same bytes, and `parseActionProgram(serializeActionProgram(p))` equals `p`.

### The schema

The schema ships in the package as `@eco-incorp/sauce/actions/action-program.schema.json` (JSON Schema draft 2020-12). `actionProgramJsonSchema()` returns the same document. It is generated from the table the parser reads, so a document the schema rejects is always rejected by the parser.

The schema cannot express three rules, which the parser enforces and the schema's description states: EIP-55 checksums, exact numeric ranges (the schema bounds digit counts), and the chaining rules below. Validate with the schema at the edge of your system, and parse before compiling.

## Chaining amounts

Each action that spends an amount takes it from, in order of precedence:

1. its own amount field (`amountIn` for swaps, `amount` for most others, `stETHAmount`/`wstETHAmount` for stETH wrapping and Lido withdrawals);
2. `amountRef`, naming the output an **earlier** action saved with `saveOutputAs`;
3. otherwise, the **previous** action's output.

Setting both an amount and an `amountRef` is an error, as is an `amountRef` to a name no earlier action saved, or a first action with no amount at all. Saving a second output under a name reassigns it.

What an action outputs depends on the action:

| Output               | Actions                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Realized amount      | Swaps (the router's returned amount, or the balance delta where the return is not an amount), `aaveV3Withdraw` |
| The input, unchanged | Transfers, approvals, wrapping, staking, lending other than withdrawal, bridges                                |
| None                 | `integralSwap`: the order executes in a later transaction                                                      |
| The value read       | `balanceOf`, `nativeBalance`, `argument`                                                                       |

When an action's output is consumed — by the next action or by `saveOutputAs` — a swap delivers it to the Pot so the next action can spend it, whatever its `recipient` says. An action whose output nothing consumes pays its own `recipient`. Use `"recipient": "self"` to keep an unconsumed output in the Pot, for example for a [dynamic child](#fund-a-child-from-a-measured-amount).

A "passed-through" output is the number the action received, not the number of tokens it produced. `wrapStETH` passes on its stETH input, not the wstETH it minted; follow it with a `balanceOf` of wstETH when the next action needs the minted amount.

### Source actions

Three actions produce a value and move nothing:

- `balanceOf` reads the Pot's balance of `token` when the program reaches it, so the next action spends whatever is actually there.
- `nativeBalance` reads the Pot's native balance.
- `argument` declares a runtime parameter; see [runtime amounts](#runtime-amounts).

A source action whose value nothing reads is an error.

```json
[
  { "type": "balanceOf", "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  {
    "type": "transfer",
    "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "to": "0x3000000000000000000000000000000000000001"
  }
]
```

## Turn a program into an intent

`actionsIntent(destination, program, options)` makes the program the route body of an Eco intent. It is the same as `Base(body, options)` with the program's source as the body; its ABI bindings are merged into `options.compile.contracts`. The destination must be the program's chain.

```ts
import { actionsIntent, type ActionProgram } from "@eco-incorp/sauce/actions";
import type { routes } from "@eco-incorp/sauce";

export function buildActionIntent(
  program: ActionProgram,
  options: routes.IntentOptions,
  reward: routes.RewardArg,
) {
  return actionsIntent(program.chainId, program, options).reward(reward);
}
```

Everything in [creating an intent](intents.md) applies: the Pot must be owned by the destination Portal's Executor, delivered route tokens arrive in the Executor and need a precall to reach the Pot, and every cook pays the Kitchen fee. `actionsRouteBody(program)` returns the `{ source, contracts }` pair when you call `compileSauceRoute` or `Base(...)` yourself.

### Fund a child from a measured amount

A program's output is only known once it runs. [Dynamic nesting](nested-intents.md#create-the-child-on-chain-from-a-measured-amount) publishes a child intent funded from what the parent's Pot holds after its program ran, so the pattern is:

1. The parent program keeps its output in the Pot (`"recipient": "self"`, or `saveOutputAs` on its last action).
2. `.nest(child, { via: "dynamic", measure: { kind: "erc20Balance", token } })` measures that balance.
3. The child program starts with `balanceOf`, so it spends exactly what was delivered rather than an amount written before the parent ran.

```ts
import { actionsIntent, type ActionProgram } from "@eco-incorp/sauce/actions";
import { routes } from "@eco-incorp/sauce";
import { encodeFunctionData, parseAbi, type Address } from "viem";

const { AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER } = routes;

export function buildCascade(
  parentProgram: ActionProgram, // e.g. a Base swap into USDC with "recipient": "self"
  childProgram: ActionProgram, // e.g. balanceOf USDC on Arbitrum, then aaveV3Supply
  parentOptions: routes.IntentOptions,
  childOptions: routes.IntentOptions & { pot: Address },
  usdcBase: Address,
  usdcArbitrum: Address,
  parentReward: routes.SauceRewardSpec,
  childReward: Omit<routes.SauceRewardSpec, "tokens">,
) {
  // The Executor receives the child's tokens; move them into the Pot the child program runs in.
  const toPot = encodeFunctionData({
    abi: parseAbi(["function transfer(address,uint256)"]),
    functionName: "transfer",
    args: [childOptions.pot, AMOUNT_OUT_PLACEHOLDER],
  });
  const child = actionsIntent(childProgram.chainId, childProgram, {
    ...childOptions,
    tokens: [{ token: usdcArbitrum, amount: AMOUNT_OUT_PLACEHOLDER }],
    precalls: [{ target: usdcArbitrum, data: toPot }],
  }).reward({ ...childReward, tokens: [{ token: usdcBase, amount: AMOUNT_IN_PLACEHOLDER }] });

  return actionsIntent(parentProgram.chainId, parentProgram, parentOptions)
    .nest(child, {
      via: "dynamic",
      measure: { kind: "erc20Balance", token: usdcBase },
      placeholders: [
        { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
        // The route's token amount and the precall that moves it.
        { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 2 },
      ],
    })
    .reward(parentReward);
}
```

The measurement is the Pot's balance after the parent program, not the program's own output figure: another action, or a donation, that leaves the same token in the Pot is measured too. The rest of the nested-intents guide — scale, floors, hash recovery — applies unchanged.

## Runtime amounts

An `argument` action makes an amount a parameter of the compiled program instead of a value fixed at compile time, so one program serves every amount. The program's bytecode, and its hash, stay the same; the amounts travel as argument bytes appended to it.

```ts
import { compileActions, parseActionProgram } from "@eco-incorp/sauce/actions";

export function reusableApproval(token: string, spender: string) {
  const compiled = compileActions(
    parseActionProgram({
      version: 1,
      chainId: 1,
      actions: [
        { type: "argument", name: "amount" },
        { type: "approve", token, spender },
      ],
    }),
  );

  // The `program` argument of Pot.cook, for two different amounts, from one compile.
  return [compiled.payload({ amount: 5n }), compiled.payload({ amount: "900000" })];
}
```

Arguments are ABI-v1 by default: each is a 32-byte word, and `argumentOffset(name)` is where it starts in the payload. With `compileActions(program, { compactArgs: true })` they are compact-v1, which is smaller; pass `{ scalarWidth: 32 }` to `payload`/`encodeArguments` to encode every number at a fixed width, so `argumentOffset(name, { scalarWidth: 32 })` locates it. A fixed offset is what lets a caller splice a number measured later into a payload built earlier. The [compiler guide](compiling.md#compact-v1-entry-arguments) describes both encodings.

An intent route body is compiled without arguments, so `actionsIntent` refuses a program that has them. Inside an intent, read a runtime amount on-chain with `balanceOf` instead.

## What the compiled program does

Each action becomes an ABI-bound call, `IBinding.at(address).method(...)`, the same form an SDK route body compiles to; the compiler derives the selector and argument encoding from the ABI. Inspect the result with `compileActions(program).source`:

```js
const amt1 = ISwapRouter02.at(0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45n).exactInputSingle({
  tokenIn: 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2n,
  tokenOut: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
  fee: 500n,
  recipient: ctx.self(),
  amountIn: 1000000000000000000n,
  amountOutMinimum: 3000000000n,
  sqrtPriceLimitX96: 0n,
});
let v_usdc = amt1;
```

- ABIs come from the SDK's protocol registry wherever it declares the exact function an action calls, and from a fragment in the actions package otherwise. `contracts` on the compiled result lists every binding.
- A binding decodes only the outputs an action reads.
- ERC-20 `transfer` and `approve` decode nothing. Tokens such as USDT return no `bool` from them, and decoding empty return data reverts, so these two are encoded ahead of time and issued as raw calls with the amount spliced in — the same decode-free lowering the SDK's nested intents use. A token that refuses the write still reverts the program.
- A call carrying native value (`wrapETH`, the stake actions, the Stargate and Hyperlane fees) is a raw `evm.call`, because a bound call cannot attach value. Its selector comes from the same ABI fragment.
- Binding names start with `I` and contain no underscore, so they cannot collide with the route compiler's protocol namespaces or its own `IERC20`. Do not bind a different ABI under one of them in `compile.contracts`.

The package builds calldata; it does not select routes, quote, or submit transactions. `actionToQuote` builds a protocol quoter call for an `eth_call`, and `megasSwapToSauce` splits a trade across several venues using on-chain quotes.

## Supported actions

"Verified" says how each action has been checked against real contracts. **Fork**: executed through the engine against a fork of Ethereum mainnet. **Calldata**: executed through the engine against contracts that record the call, and compared byte for byte with the intended Solidity call — the encoding is checked, the protocol's behavior is not.

### Swaps

| Action                        | Calls                                                                                 | Amount           | Output   | Verified  |
| ----------------------------- | ------------------------------------------------------------------------------------- | ---------------- | -------- | --------- |
| `uniswapV3ExactInput`         | SwapRouter02 `exactInputSingle`                                                       | `amountIn`       | realized | Fork      |
| `uniswapV3ExactInputMultiHop` | SwapRouter02 `exactInput`                                                             | `amountIn`       | realized | Fork      |
| `uniswapV4ExactInput`         | ERC-20 `transfer` to the router, then Universal Router `execute` (swap, settle, take) | `amountIn`       | realized | Fork      |
| `uniswapV4ExactInputMultiHop` | Same, with a path                                                                     | `amountIn`       | realized | Fork      |
| `curveSwap`                   | Pool `exchange(int128,int128,uint256,uint256)`; output is a balance delta             | `amountIn`       | realized | Fork      |
| `curveRouterNGSwap`           | RouterNG `exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)`     | `amountIn`       | realized | Fork      |
| `balancerV2Swap`              | Vault `swap`                                                                          | `amountIn`       | realized | Calldata  |
| `balancerV2BatchSwap`         | Vault `batchSwap`; output is a balance delta                                          | `steps[].amount` | realized | Calldata  |
| `balancerV3Swap`              | Router `swapSingleTokenExactIn`                                                       | `amountIn`       | realized | Calldata  |
| `uniswapV2Swap`               | Router `swapExactTokensForTokens`; output is a balance delta                          | `amountIn`       | realized | Fork      |
| `ambientSwap`                 | CrocSwapDex `userCmd(1, …)`; output is a balance delta                                | `amountIn`       | realized | Fork      |
| `dodoSwap`                    | DODO proxy `dodoSwapV2TokenToToken`, or `dodoSwapV1` with `"version": "v1"`           | `amountIn`       | realized | Fork (v1) |
| `maverickSwap`                | Maverick V2 router `exactInputSingle`                                                 | `amountIn`       | realized | Calldata  |
| `maverickMultiHopSwap`        | Maverick V2 router `exactInputMultiHop`                                               | `amountIn`       | realized | Calldata  |
| `carbonSwap`                  | CarbonController `tradeBySourceAmount`                                                | `amountIn`       | realized | Calldata  |
| `fraxswapSwap`                | Router `swapExactTokensForTokens`; output is a balance delta                          | `amountIn`       | realized | Calldata  |
| `clipperSwap`                 | Exchange `sellTokenForToken`                                                          | `amountIn`       | realized | Calldata  |
| `integralSwap`                | TwapDelay `sell`                                                                      | `amountIn`       | none     | Calldata  |
| `fluidDexT1Swap`              | Pool `swapIn`                                                                         | `amountIn`       | realized | Calldata  |
| `fluidDexLiteSwap`            | DEX Lite `swapSingle`; output is a balance delta                                      | `amountIn`       | realized | Calldata  |

### Bridges

| Action            | Calls                                                        | Amount   | Output    | Verified |
| ----------------- | ------------------------------------------------------------ | -------- | --------- | -------- |
| `acrossBridge`    | SpokePool `depositV3`, same token on the destination         | `amount` | the input | Fork     |
| `stargateBridge`  | Stargate V1 router `swap`, with `lzFee` as value             | `amount` | the input | Calldata |
| `cctpBridge`      | CCTP V1 TokenMessenger `depositForBurn`                      | `amount` | the input | Calldata |
| `hyperlaneBridge` | `dispatch(uint32,bytes32,bytes)`, with `gasPayment` as value | `amount` | the input | Calldata |

### Wrapping, staking, and lending

| Action               | Calls                                | Amount                  | Output    | Verified |
| -------------------- | ------------------------------------ | ----------------------- | --------- | -------- |
| `wrapETH`            | WETH `deposit`                       | `amount`, sent as value | the input | Fork     |
| `unwrapETH`          | WETH `withdraw`                      | `amount`                | the input | Fork     |
| `wrapStETH`          | wstETH `wrap`                        | `stETHAmount`           | the input | Calldata |
| `unwrapStETH`        | wstETH `unwrap`                      | `wstETHAmount`          | the input | Calldata |
| `lidoStake`          | stETH `submit`                       | `amount`, sent as value | the input | Calldata |
| `lidoUnstake`        | WithdrawalQueue `requestWithdrawals` | `stETHAmount`           | the input | Calldata |
| `rocketPoolStake`    | Rocket deposit pool `deposit`        | `amount`, sent as value | the input | Calldata |
| `rocketPoolUnstake`  | rETH `burn`                          | `amount`                | the input | Calldata |
| `coinbaseStake`      | cbETH `deposit`                      | `amount`, sent as value | the input | Calldata |
| `etherFiStake`       | ether.fi LiquidityPool `deposit`     | `amount`, sent as value | the input | Calldata |
| `aaveV3Supply`       | Pool `supply`                        | `amount`                | the input | Fork     |
| `aaveV3Withdraw`     | Pool `withdraw`                      | `amount`                | realized  | Fork     |
| `aaveV3Borrow`       | Pool `borrow` (variable rate)        | `amount`                | the input | Calldata |
| `aaveV3Repay`        | Pool `repay` (variable rate)         | `amount`                | the input | Calldata |
| `compoundV3Supply`   | Comet `supply`                       | `amount`                | the input | Fork     |
| `compoundV3Withdraw` | Comet `withdraw`                     | `amount`                | the input | Fork     |

### Tokens and sources

| Action          | Calls                               | Amount   | Output         | Verified                    |
| --------------- | ----------------------------------- | -------- | -------------- | --------------------------- |
| `transfer`      | ERC-20 `transfer`, decoding nothing | `amount` | the input      | Fork, and a no-return token |
| `approve`       | ERC-20 `approve`, decoding nothing  | `amount` | the input      | Fork, and a no-return token |
| `balanceOf`     | ERC-20 `balanceOf(Pot)`             | —        | the value read | Execution                   |
| `nativeBalance` | The Pot's native balance            | —        | the value read | Calldata                    |
| `argument`      | A runtime parameter of the program  | —        | the value read | Execution                   |

### Notes and limitations

- **Approvals.** A swap or supply pulls from the Pot, so approve its spender first. DODO pulls through its DODOApprove contract, not the proxy; approve that.
- **Uniswap V4** transfers the input to the Universal Router and settles from the router's balance, so the input must be an ERC-20; native ETH input is not supported. A chained output is taken to the Pot, and its amount may be a runtime value.
- **Curve `curveSwap`** calls the pool's 4-argument `exchange`, which older pools implement without a return value, and forwards the balance delta to `recipient`.
- **Balancer V2 batch** amounts are per step (a later step's `"0"` spends the previous step's output), so the action takes no `amountRef`.
- **Carbon** trades the per-strategy `tradeActions` amounts; **Clipper** sells tokens already transferred to the exchange, against a signed quote from Clipper's API. Neither passes `amountIn` to the protocol.
- **Integral** places an order that a keeper executes later; nothing can chain from it, and the action attaches no keeper fee.
- **Across** records the Pot's caller as depositor and recipient, and requests the same amount out as in. **Stargate** refunds and pays the Pot's caller; **Lido withdrawals** are owned by it.
- **cbETH** cannot be minted by depositing ETH: the live cbETH contract has no `deposit`, so `coinbaseStake` reverts against it.
- **Maverick**: confirm the router address and its return values for your deployment. The output is the first word the router returns.

## TypeScript types

Every action has a type (`UniswapV3ExactInputAction`, `AaveV3SupplyAction`, …) in the `RoutingAction` union, and `ActionProgram` is the program document. A typed action list is already valid JSON: `toActionProgram(actions, chainId)` validates it as a program. `ACTION_SPECS` describes every action's fields, as the parser and the schema read them.

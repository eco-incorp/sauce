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
      "amount": "1000000000000000000",
      "weth": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
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
      "amountOutMin": "3000000000",
      "recipient": "self",
      "saveOutputAs": "usdc"
    },
    {
      "type": "approve",
      "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "spender": "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
    },
    {
      "type": "aaveV3Supply",
      "pool": "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "onBehalfOf": "0x3000000000000000000000000000000000000001",
      "amountRef": "usdc"
    }
  ]
}
```

This wraps 1 ETH, approves the router for exactly what was wrapped, swaps it for USDC into the executing Pot, approves Aave for whatever the swap returned, and supplies it on the owner's behalf. Only the first action names an amount: each approve and the swap spend the previous action's output, and the supply spends the output saved as `usdc`.

## Compile and run a program

```ts
import { compileProgram, parseProgram } from "@eco-incorp/sauce/actions";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, type Address } from "viem";

export function cookProgram(json: string, engine: Address) {
  const program = parseProgram(json); // throws, listing every problem with its path
  const { bytecode, source } = compileProgram(program);
  console.log(source); // the SauceScript that will execute

  return v12Pot.encodeCook(engine, bytesToHex(bytecode));
}
```

Send the resulting calldata to the Pot from its owner, with the Kitchen's execution fee. The Pot is the account whose balances the program uses — its ETH pays for `wrapETH` above — so fund it before the program runs. See [compiling programs](compiling.md) for the execution boundary. The [action-program example](../examples/action-program.ts) runs end to end offline.

| Export                              | Does                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `parseProgram(json)`                | Validates a program; throws a `ProgramError` listing every problem with its path             |
| `serializeProgram(program, space?)` | Writes canonical JSON                                                                        |
| `programSchema()`                   | Returns the JSON Schema                                                                      |
| `compileProgram(program, options?)` | Compiles standalone: bytecode, source, and a payload for [runtime amounts](#runtime-amounts) |
| `programIntent(program, options)`   | Opens the program as an [intent route](#turn-a-program-into-an-intent) on its chain          |
| `quoteAction(action, quoters?)`     | Builds the `eth_call` that [prices a swap](#quotes-and-split-swaps)                          |
| `compileSplitSwap(splitSwap)`       | Compiles a swap [split across venues](#quotes-and-split-swaps) by on-chain quotes            |

`compileProgram` and `programIntent` validate the program too, so a typed program that skipped `parseProgram` is held to the same rules.

## The JSON format

A program is `{ "version": 1, "chainId": <chain>, "actions": [ … ] }`. Every action runs in one transaction on `chainId`; a bridge's destination is one of its own fields, not a second place the program runs. Each action is an object whose `type` selects its fields; the [reference](#supported-actions) lists every type, and the schema lists every field with its documentation. A `$schema` key is allowed and ignored.

| Value                                                         | Encoding                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Amounts, prices, fees, strategy ids                           | Base-10 string: `"1000000"`. No sign, exponent, or leading zeros.            |
| Addresses                                                     | `0x` + 40 hex digits. Mixed case must be a valid EIP-55 checksum.            |
| Recipients on this chain (`recipient`, `onBehalfOf`, `owner`) | An address, or `"self"` for the executing Pot.                               |
| Recipients on another chain (a bridge's `recipient`)          | An address, or a 32-byte account (`0x` + 64 hex digits) for a non-EVM chain. |
| Byte strings (`path`, `message`)                              | `0x` + an even number of hex digits.                                         |
| 32-byte values (`poolId`)                                     | `0x` + 64 hex digits.                                                        |
| Fee tiers, indices, domains, endpoint ids, Unix-second times  | JSON integers.                                                               |

JSON numbers cannot represent integers above 2^53, so the parser rejects an amount written as a number instead of rounding it. Each amount must also fit the width of the field it becomes: a Uniswap V4 `amountOutMin` is a `uint128`, and a larger value is an error rather than a silently truncated one.

The same words mean the same thing on every action: `amount` is what it spends, `amountOutMin` is the least output it accepts before the venue reverts, and `recipient` receives its output.

### Validation and errors

`parseProgram(input)` takes the JSON text or a parsed value, checks it, and returns a fresh program with its keys in canonical order. It fills in nothing: an optional field left out stays out. It throws a `ProgramError` whose `issues` list every problem, each with a path:

```text
invalid action program (2 issues):
  actions[0].amount: expected a base-10 string, got the JSON number 1000000 — JSON numbers lose precision above 2^53, so amounts are strings: write "1000000"
  actions[1].amuont: unknown field — did you mean `amount`? (allowed: type, amount, router, …)
```

`serializeProgram(program)` writes canonical JSON, so two equal programs serialize to the same text, and `parseProgram(serializeProgram(p))` equals `p`.

### The schema

The schema ships in the package as `@eco-incorp/sauce/actions/action-program.schema.json` (JSON Schema draft 2020-12), and `programSchema()` returns the same document. It is generated from the table the parser reads, so a document the schema rejects is always rejected by the parser.

The schema cannot express three rules, which the parser enforces and the schema's description states: EIP-55 checksums, exact numeric ranges (the schema bounds digit counts), and the chaining rules below. Validate with the schema at the edge of your system, and parse before compiling.

## Chaining amounts

An action that spends an amount takes it from, in order:

1. its `amount`;
2. `amountRef`, naming the output an **earlier** action saved with `saveOutputAs`;
3. otherwise, the **previous** action's output.

Setting both `amount` and `amountRef` is an error, as is an `amountRef` to a name no earlier action saved, or a first action with no amount. Saving a second output under a name reassigns it. Two actions carry their amounts in their own fields and take neither: `balancerV2BatchSwap` (`steps[].amount`) and `carbonSwap` (`tradeActions[].amount`).

An action's output is one of:

- **received** — what it delivered to the Pot: a swap's proceeds, the staking or wrapped token minted, the ETH from burning rETH, the amount an Aave withdrawal returned. Where the venue's return value is that amount the program reads it; where it is not (an array, shares, nothing) the program measures the Pot's balance before and after.
- **its amount** — the amount the action spent, unchanged: transfers, approvals, supplies, borrows, repayments, bridges, WETH wrapping.
- **the value read** — for a source action.

When a later action spends an output, the action delivers it to the Pot so it can be spent, whatever its `recipient` says. An action whose output nothing spends pays its own `recipient`. Use `"recipient": "self"` to keep an unspent output in the Pot, for example for a [dynamic child](#fund-a-child-from-a-measured-amount).

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
    "recipient": "0x3000000000000000000000000000000000000001"
  }
]
```

## Turn a program into an intent

`programIntent(program, options)` opens the program as the route of an Eco intent on the program's own `chainId`. It is `Base(body, options)` with the program as the body; its ABI bindings are merged into `options.compile.contracts`, and a caller binding of the same name with a different ABI is an error.

```ts
import { programIntent, type ActionProgram } from "@eco-incorp/sauce/actions";
import type { routes } from "@eco-incorp/sauce";

export function buildActionIntent(
  program: ActionProgram,
  options: routes.IntentOptions,
  reward: routes.RewardArg,
) {
  return programIntent(program, options).reward(reward);
}
```

Everything in [creating an intent](intents.md) applies: the Pot must be owned by the destination Portal's Executor, delivered route tokens arrive in the Executor and need a precall to reach the Pot, and every cook pays the Kitchen fee.

### Fund a child from a measured amount

A program's output is only known once it runs. [Dynamic nesting](nested-intents.md#create-the-child-on-chain-from-a-measured-amount) publishes a child intent funded from what the parent's Pot holds after its program ran, so the pattern is:

1. The parent program keeps its output in the Pot (`"recipient": "self"`).
2. `.nest(child, { via: "dynamic", measure: { kind: "erc20Balance", token } })` measures that balance.
3. The child program starts with `balanceOf`, so it spends exactly what was delivered rather than an amount written before the parent ran.

```ts
import { programIntent, type ActionProgram } from "@eco-incorp/sauce/actions";
import { routes } from "@eco-incorp/sauce";
import { encodeFunctionData, parseAbi, type Address } from "viem";

const { AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER } = routes;

export function buildCascade(
  parentProgram: ActionProgram, // e.g. a Base swap into USDC with "recipient": "self"
  childProgram: ActionProgram, // e.g. balanceOf USDC on Arbitrum, an approve, then aaveV3Supply
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
  const child = programIntent(childProgram, {
    ...childOptions,
    tokens: [{ token: usdcArbitrum, amount: AMOUNT_OUT_PLACEHOLDER }],
    precalls: [{ target: usdcArbitrum, data: toPot }],
  }).reward({ ...childReward, tokens: [{ token: usdcBase, amount: AMOUNT_IN_PLACEHOLDER }] });

  return programIntent(parentProgram, parentOptions)
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
import { compileProgram } from "@eco-incorp/sauce/actions";

export function reusableApproval(token: `0x${string}`, spender: `0x${string}`) {
  const compiled = compileProgram({
    version: 1,
    chainId: 1,
    actions: [
      { type: "argument", name: "amount" },
      { type: "approve", token, spender },
    ],
  });

  // The `program` argument of Pot.cook, for two different amounts, from one compile.
  return [compiled.payload({ amount: 5n }), compiled.payload({ amount: "900000" })];
}
```

Arguments are ABI-v1 by default: each is a 32-byte word, and `argumentOffset(name)` is where it starts in the payload. With `compileProgram(program, { compactArgs: true })` they are compact-v1, which is smaller; pass `{ scalarWidth: 32 }` to `payload` to encode every number at a fixed width, so `argumentOffset(name, { scalarWidth: 32 })` locates it. A fixed offset is what lets a caller splice a number measured later into a payload built earlier. The [compiler guide](compiling.md#pass-arguments-with-compact-v1) describes both encodings.

An intent route is compiled without arguments, so `programIntent` refuses a program that has them. Inside an intent, read a runtime amount on-chain with `balanceOf` instead.

## Quotes and split swaps

`quoteAction(action, quoters)` returns the `eth_call` that prices a swap action at its own `amount` — `{ to, data, decode }`. Send it with a JSON-RPC client and pass the result to `decode` for the output amount. It needs no balance or allowance. Venues that price through a separate contract take its address in `quoters`: `uniswapV3Quoter` (QuoterV2), `uniswapV4Quoter`, `maverickQuoter`, `ambientImpact` (CrocImpact) and `fluidDexResolver`. Send the Balancer V3 quote from the zero address: its Vault answers a query only outside a transaction.

`compileSplitSwap({ candidates, amount, buckets, amountOutMin, approvals, sweep, quoters })` compiles one program that divides `amount` into `buckets` equal slices and hands each, in turn, to the candidate whose on-chain quote pays most for it, then executes every candidate's share. Candidates are ordinary swap actions without an amount; each delivers to the Pot. `amountOutMin` bounds the total output, checked once after every leg, and `"0"` waives it explicitly. A candidate must have an on-chain quote with a runtime amount, which every swap has except Uniswap V4, Balancer and Carbon.

## What the compiled program does

Each action becomes an ABI-bound call, `IBinding.at(address).method(...)`, the same form an SDK route body compiles to; the compiler derives the selector and argument encoding from the ABI. Inspect the result with `compileProgram(program).source`:

```js
const amt1 = ISwapRouter02.at(0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45n).exactInputSingle({
  tokenIn: 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2n,
  tokenOut: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
  fee: 500n,
  recipient: ctx.self(),
  amountIn: t_out1,
  amountOutMinimum: 3000000000n,
  sqrtPriceLimitX96: 0n,
});
let v_usdc = amt1;
```

- ABIs come from the SDK's protocol registry wherever it declares the exact function an action calls, and from a fragment in the actions package otherwise.
- A binding decodes only the outputs an action reads.
- ERC-20 `transfer` and `approve` follow OpenZeppelin `SafeERC20`, through the lowering every SDK token write uses. Tokens such as USDT return no `bool`, and decoding empty return data reverts, so the call is raw, with the amount spliced into calldata encoded ahead of time; its returndata must then be empty from a contract, or decode as an ABI word equal to `1`. A token that returns `false` or fewer than 32 bytes, or an address with no code, reverts the program. `approve` first reads the allowance and resets a non-zero one to zero, as `forceApprove` does, because USDT refuses to change one non-zero allowance to another.
- A call carrying native value (`wrapETH`, the staking deposits, the Stargate and Hyperlane fees) is a raw `evm.call`, because a bound call cannot attach value. Its selector comes from the same ABI fragment. The bridges' fees are quoted on-chain, just before the call that pays them, and come from the Pot's balance.
- Binding names start with `I` and contain no underscore, so they cannot collide with the route compiler's protocol namespaces or its own `IERC20`.

## Supported actions

Every action below is executed in CI against the deployed Ethereum contracts it names, through the released engine and a real Pot, replayed from mainnet state at a pinned block — and its calldata is compared byte for byte with the intended Solidity call. "Output" is what a later action spends; see [chaining amounts](#chaining-amounts).

### Swaps

| Action                        | Calls                                                                             | Output   |
| ----------------------------- | --------------------------------------------------------------------------------- | -------- |
| `uniswapV3ExactInput`         | SwapRouter02 `exactInputSingle`                                                   | received |
| `uniswapV3ExactInputMultiHop` | SwapRouter02 `exactInput`                                                         | received |
| `uniswapV4ExactInput`         | ERC-20 `transfer` to the Universal Router, then `execute` (swap, settle, take)    | received |
| `uniswapV4ExactInputMultiHop` | The same, along a path                                                            | received |
| `curveSwap`                   | Pool `exchange(int128,int128,uint256,uint256)`                                    | received |
| `curveRouterNGSwap`           | RouterNG `exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)` | received |
| `balancerV2Swap`              | Vault `swap`                                                                      | received |
| `balancerV2BatchSwap`         | Vault `batchSwap`                                                                 | received |
| `balancerV3Swap`              | Router `swapSingleTokenExactIn`, pulling through Permit2                          | received |
| `uniswapV2Swap`               | Router `swapExactTokensForTokens`                                                 | received |
| `ambientSwap`                 | CrocSwapDex `userCmd(1, …)`                                                       | received |
| `dodoSwap`                    | DODO proxy `dodoSwapV2TokenToToken`, or `dodoSwapV1` with `"version": "v1"`       | received |
| `maverickSwap`                | Maverick V2 router `exactInputSingle`                                             | received |
| `maverickMultiHopSwap`        | Maverick V2 router `exactInputMultiHop`                                           | received |
| `carbonSwap`                  | CarbonController `tradeBySourceAmount`                                            | received |
| `fraxswapSwap`                | Router `swapExactTokensForTokens`                                                 | received |
| `fluidDexT1Swap`              | Pool `swapIn`                                                                     | received |

### Bridges

| Action            | Calls                                                    | Output     |
| ----------------- | -------------------------------------------------------- | ---------- |
| `acrossBridge`    | SpokePool `depositV3`, the same token on the destination | its amount |
| `stargateBridge`  | Stargate V2 pool `quoteSend`, then `send` (taxi)         | its amount |
| `cctpBridge`      | CCTP V2 TokenMessenger `depositForBurn`                  | its amount |
| `hyperlaneBridge` | Warp route `quoteGasPayment`, then `transferRemote`      | its amount |

### Wrapping and staking

| Action              | Calls                                                      | Output     |
| ------------------- | ---------------------------------------------------------- | ---------- |
| `wrapETH`           | WETH `deposit`, with the amount as value                   | its amount |
| `unwrapETH`         | WETH `withdraw`                                            | its amount |
| `wrapStETH`         | wstETH `wrap`                                              | received   |
| `unwrapStETH`       | wstETH `unwrap`                                            | received   |
| `lidoStake`         | stETH `submit`, with the amount as value                   | received   |
| `lidoUnstake`       | WithdrawalQueueERC721 `requestWithdrawals`                 | its amount |
| `rocketPoolStake`   | RocketDepositPool `deposit`, with the amount as value      | received   |
| `rocketPoolUnstake` | rETH `burn`                                                | received   |
| `etherFiStake`      | ether.fi LiquidityPool `deposit`, with the amount as value | received   |

### Lending

| Action               | Calls                         | Output     |
| -------------------- | ----------------------------- | ---------- |
| `aaveV3Supply`       | Pool `supply`                 | its amount |
| `aaveV3Withdraw`     | Pool `withdraw`               | received   |
| `aaveV3Borrow`       | Pool `borrow` (variable rate) | its amount |
| `aaveV3Repay`        | Pool `repay` (variable rate)  | its amount |
| `compoundV3Supply`   | Comet `supply`                | its amount |
| `compoundV3Withdraw` | Comet `withdraw`              | its amount |

### Tokens and sources

| Action           | Calls                                                   | Output         |
| ---------------- | ------------------------------------------------------- | -------------- |
| `transfer`       | ERC-20 `transfer`, checked like `SafeERC20`             | its amount     |
| `approve`        | ERC-20 `approve`, reset and checked like `forceApprove` | its amount     |
| `permit2Approve` | Permit2 `approve(address,address,uint160,uint48)`       | its amount     |
| `balanceOf`      | ERC-20 `balanceOf(Pot)`                                 | the value read |
| `nativeBalance`  | The Pot's native balance                                | the value read |
| `argument`       | A runtime parameter of the program                      | the value read |

### Notes

- **Approvals.** A venue that pulls from the Pot needs an approval first; the field docs in the schema say which. DODO pulls through its DODOApprove contract, not the proxy. Balancer V3's router pulls through Permit2: `approve` the token to Permit2, then `permit2Approve` the router. A Hyperlane warp route that charges a fee pulls the amount plus the fee, so approve more than the amount.
- **Uniswap V4** transfers the input to the Universal Router and settles from the router's balance, so the input must be an ERC-20; native ETH input is not supported.
- **Curve `curveSwap`** calls the pool's 4-argument `exchange`, which older pools implement without a return value; the pool pays the Pot, which forwards the balance delta to `recipient`.
- **Balancer V2 batch** amounts are per step: a later step's `"0"` spends the previous step's output.
- **Across** deposits from the Pot, which is refunded if no relayer fills; the relayer keeps `relayerFee`, so the destination receives `amount - relayerFee`. `quoteTimestamp` must be within the SpokePool's quote buffer of the block time, and `fillDeadline` within its fill buffer.
- **Stargate** sends in taxi mode and refunds the Pot. **CCTP** lets anyone relay the mint (`destinationCaller` is zero); `maxFee` defaults to `"0"` and `minFinalityThreshold` to 2000, a standard transfer.
- **Lido withdrawals** mint the withdrawal NFT to `owner`, which claims the ETH once Lido finalizes it.
- **Rocket Pool** upgrades move the deposit pool: read the live address from RocketStorage. rETH refuses to move in the block it was minted in, so a program cannot stake and then transfer or burn the same rETH.
- **Maverick** V2's router is `0x62e31802c6145A2D5E842EeD8efe01fC224422fA` on Ethereum. A multi-hop `path` is, per hop, the pool's 20 bytes followed by one byte for `tokenAIn`.
- **Fluid DEX T1** takes no native value from this action, so it sells the pool's ERC-20 side (for the wstETH/ETH pool, wstETH for ETH), pulling it by allowance.

### On Arc

Arc (`chainId` 5042) pays gas in USDC, which is also the ERC-20 at
`0x3600000000000000000000000000000000000000`: one balance, 18 decimals natively and 6 through the
ERC-20 ([details](../api/coverage.md#arc-usdc-is-the-native-coin)). Actions take every address and
domain as a field, so nothing here is per chain, but a program on Arc is checked for what that
changes:

- `wrapETH`, `unwrapETH`, `lidoStake`, `rocketPoolStake` and `etherFiStake` are rejected: Arc has no
  native ETH and no canonical wrapped native. Its registry `WETH` is bridged ETH. So is
  `balancerV3Swap` with `wethIsEth: true`.
- A `nativeBalance` that a token action spends is rejected: it is 10¹² times the same balance read
  by `balanceOf` of `0x3600…0000`. Read that instead.
- The Hyperlane fee is native value, so on Arc it is USDC, paid from the balance the bridged USDC
  also comes from. A `hyperlaneBridge` of the Pot's whole USDC balance cannot also pay its fee:
  bridge less. Hyperlane's CCTP-backed USDC warp route on Arc,
  `0x16BF93e259ee7f7074453a2948379C35C6851b71`, quoted about 0.054 USDC to Base on 2026-09-28.

What the registry has on Arc for these actions: Uniswap V2, V3 and V4 (`uniswapV2Swap`,
`uniswapV3ExactInput`, `uniswapV4ExactInput` and their multi-hop forms), CCTP (`cctpBridge`; Arc is
domain 26), Across (`acrossBridge`, ERC-20 deposits; Arc's SpokePool has no wrapped native token), and
Permit2. It has no Arc deployment of Curve, Balancer, DODO, Maverick, Fluid, Carbon, Fraxswap,
Ambient, Aave V3, Compound V3, Stargate, Lido, Rocket Pool or ether.fi. The CI runs above replay
Ethereum; no action is executed against Arc.

## TypeScript types

Every type is the JSON it describes. `ActionProgram` is the document, `Action` the union of every action, `ActionType` its `type`, and each action has its own interface (`UniswapV3ExactInputAction`, `AaveV3SupplyAction`, …), grouped as `SwapAction`, `BridgeAction`, `WrapAction`, `StakeAction`, `LendingAction`, `TokenAction` and `SourceAction`. A program typed in TypeScript is already valid input for `serializeProgram`, and `parseProgram` returns the same shape it accepts.

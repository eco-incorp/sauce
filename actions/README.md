# Actions

[SDK documentation](../docs/README.md) · [Actions guide](../docs/guides/actions.md)

`@eco-incorp/sauce/actions` compiles **action programs** — ordered lists of protocol operations
(swaps, bridges, wrapping, staking, lending, transfers, approvals) written as plain JSON — into one
Sauce program that executes atomically in a Pot, directly or as the destination route of an Eco
intent. Install `@eco-incorp/sauce` to use it.

```ts
import { compileProgram, parseProgram, programIntent } from "@eco-incorp/sauce/actions";

const program = parseProgram({
  version: 1,
  chainId: 8453,
  actions: [
    {
      type: "approve",
      amount: "1000000",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
      spender: "0x1111111111111111111111111111111111111111", // example spender
    },
  ],
});

const { bytecode, source } = compileProgram(program); // Pot.cook(engine, bytecode)
// or, as an intent on the program's chain: programIntent(program, intentOptions).reward(reward)
```

| Export                              | Does                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `parseProgram(json)`                | Validates a program strictly; throws a `ProgramError` listing every problem with its path |
| `serializeProgram(program)`         | Canonical JSON text                                                                       |
| `programSchema()`                   | The JSON Schema, also shipped as [action-program.schema.json](action-program.schema.json) |
| `compileProgram(program, options?)` | Bytecode, source, and the payload for runtime arguments                                   |
| `programIntent(program, options)`   | The program as an intent route on its own chain                                           |
| `quoteAction(action, quoters?)`     | The `eth_call` that prices a swap action                                                  |
| `compileSplitSwap(splitSwap)`       | One program that splits a swap across venues by on-chain quotes                           |

- **Types follow the JSON.** Every type the package exports is exactly the document it describes:
  amounts are base-10 strings, `"self"` is the executing Pot, and `parseProgram` returns the same
  shape it accepts.
- **Composition is part of the document.** An action spends its `amount`, an earlier output named
  with `saveOutputAs`/`amountRef`, or the previous action's output. A `balanceOf` action spends what
  the Pot actually holds, which is how a child of a dynamic `.nest()` spends exactly what its parent
  delivered; an `argument` action makes an amount a runtime parameter of one compiled program.
- **One swap implementation.** A swap at one of [`@sauce/router`](../docs/api/router.md)'s nine
  venues is a call into that SauceScript library, so an action program and a hand-written Sauce
  program trade a venue through the same code.
- **Verified on mainnet.** Every action type executes in CI against the deployed contracts it names
  (on Ethereum, and on Avalanche and Base for the two venues Ethereum lacks), replayed offline from
  chain state at a pinned block. Each other protocol call is an ABI binding, with ABIs from the SDK
  protocol registry where it has the exact function; ERC-20 `transfer`/`approve` follow OpenZeppelin
  `SafeERC20`, so a token that returns nothing (USDT) works, one that returns `false` reverts, and a
  standing allowance is reset before it is changed.

## Supported actions

The guide's [reference](../docs/guides/actions.md#supported-actions) says what each action calls and
what a later action can spend from it.

- **Swaps through @sauce/router:** `uniswapV2Swap`, `uniswapV3Swap`, `uniswapV4Swap`,
  `curveSwap`, `balancerV2Swap`, `dodoV2Swap`, `traderJoeLBSwap`, `woofiSwap`, `maverickV2Swap`
- **Other swaps:** `curveRouterNGSwap`, `balancerV2BatchSwap`, `balancerV3Swap`, `ambientSwap`,
  `dodoV1Swap`, `carbonSwap`, `fraxswapSwap`, `fluidDexT1Swap`
- **Bridges:** `acrossBridge`, `stargateBridge`, `cctpBridge`, `hyperlaneBridge`
- **Wrapping and staking:** `wrapETH`, `unwrapETH`, `wrapStETH`, `unwrapStETH`, `lidoStake`,
  `lidoUnstake`, `rocketPoolStake`, `rocketPoolUnstake`, `etherFiStake`
- **Lending:** `aaveV3Supply`, `aaveV3Withdraw`, `aaveV3Borrow`, `aaveV3Repay`, `compoundV3Supply`,
  `compoundV3Withdraw`
- **Tokens and sources:** `transfer`, `approve`, `permit2Approve`, `balanceOf`, `nativeBalance`,
  `argument`

The [actions guide](../docs/guides/actions.md) covers the format, chaining, intents, runtime
amounts, quotes, and every supported action. [AMM_SWAP_INTERFACES.md](AMM_SWAP_INTERFACES.md) is a
contributor's reference to the protocols' Solidity interfaces.

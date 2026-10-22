# Actions

[SDK documentation](../docs/README.md) · [Actions guide](../docs/guides/actions.md)

`@eco-incorp/sauce/actions` compiles **action programs** — ordered lists of protocol operations
(swaps, bridges, wrapping, staking, lending, transfers, approvals) written as plain JSON — into one
Sauce program that executes atomically in a Pot. Install `@eco-incorp/sauce` to use it. Tokens and
contracts are named the way a Sauce program names them, so one document compiles for every chain
that has them:

```ts
import { compileProgram, parseProgram } from "@eco-incorp/sauce/actions";

const program = parseProgram({
  version: 1,
  actions: [
    {
      type: "uniswapV3Swap",
      amount: "1000000000",
      tokenIn: "USDC", // the registry's USDC on the chain it is compiled for
      tokenOut: "WETH",
      factory: "UniswapV3.Factory", // the pool is read from the factory while the program runs
      fee: 500,
      amountOutMin: "1",
      recipient: "self",
    },
  ],
});

const onBase = compileProgram(program, { chain: "base" }); // Pot.cook(engine, onBase.bytecode)
const onEthereum = compileProgram(program, { chain: "ethereum" }); // the same source, Ethereum's addresses
```

From the command line, `sauce actions swap.json --chain base` prints the SauceScript the document
lowers to and its bytecode, and `sauce tx`, `simulate` and `run` take the document as they take a
`.sauce.ts` file.

| Export                              | Does                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `parseProgram(json)`                | Validates a program strictly; throws a `ProgramError` listing every problem with its path |
| `serializeProgram(program)`         | Canonical JSON text                                                                       |
| `programSchema()`                   | The JSON Schema, also shipped as [action-program.schema.json](action-program.schema.json) |
| `compileProgram(program, options?)` | Bytecode, source, and the payload for runtime arguments, for `options.chain`              |
| `quoteAction(action, options?)`     | The `eth_call` that prices a swap action                                                  |
| `compileSplitSwap(splitSwap)`       | One program that splits a swap across venues by on-chain quotes                           |

- **Names, as a program writes them.** A token is a registry symbol (`"USDC"`) or an address, and a
  protocol contract a namespace reference (`"UniswapV3.Factory"`, `"BalancerV2.Vault"`) or an
  address. A name lowers to the program global of that name, so it resolves on the chain the program
  is compiled for; a name that chain lacks is refused at compile time, naming the chain, the name and
  its path. `chainId` is optional: without it a document compiles for any chain where its names
  exist, with it for that chain alone.
- **Pools by key.** `uniswapV2Swap`, `uniswapV3Swap` and `traderJoeLBSwap` may leave out `pool` and
  name the factory and its key (`fee`, `tickSpacing`, `binStep`); the program reads the pool from
  the factory while it runs and reverts if there is none.
- **Types follow the JSON.** Every type the package exports is exactly the document it describes:
  amounts are base-10 strings, `"self"` is the executing Pot, and `parseProgram` returns the same
  shape it accepts.
- **Composition is part of the document.** An action spends its `amount`, an earlier output named
  with `saveOutputAs`/`amountRef`, or the previous action's output. A `balanceOf` action spends what
  the Pot actually holds; an `argument` action makes an amount a runtime parameter of one compiled
  program.
- **One swap implementation.** A swap at one of [`@sauce/router`](../docs/api/router.md)'s nine
  venues is a call into that SauceScript library, so an action program and a hand-written Sauce
  program trade a venue through the same code.
- **Verified on mainnet.** Every action type executes in CI against the deployed contracts it names
  (on Ethereum, and on Avalanche and Base for the two venues Ethereum lacks), replayed offline from
  chain state at a pinned block, and one chain-agnostic document by names and pool keys executes on
  Ethereum, Base and Avalanche. Each other protocol call is an ABI binding, with ABIs from the SDK
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

The [actions guide](../docs/guides/actions.md) covers the format, names and pool keys, the `sauce
actions` command, chaining, runtime amounts, quotes, and every supported action. [AMM_SWAP_INTERFACES.md](AMM_SWAP_INTERFACES.md) is a
contributor's reference to the protocols' Solidity interfaces.

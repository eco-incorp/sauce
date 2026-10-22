# Builders and actions

**How-to guide** · [Documentation](../README.md) · [Protocol calls](protocols-and-tokens.md) · [Compiler](../api/compiler.md)

> Sometimes your app already knows what it wants: a token, an amount, a vault. Builders are forms
> that fill in a program for you from those facts. You get the program's text back, and compile it
> like any other.

This page is for a TypeScript developer whose application assembles programs from data it already
holds: a token and an amount, a vault and a deposit. It assumes you can compile a program from
TypeScript ([Compiling programs](compiling.md)). The builders on this page take that data and emit
SauceScript source you compile like any other program.

They emit source. They do not pick a market route, quote a price, or send anything. The ABIs that
source imports ship inside the SDK, and `routes.compileSauceProgram` serves them itself, so the
output compiles with no resolver option.

## Token operations

An application that already holds the token, the recipient and the amount does not need a new
program for each call: compile one program that names the operation and takes the rest as `main`'s
inputs, then encode the inputs per call. `Token(asset)` takes any ERC-20 by address:

```ts
import { Base, routes } from "@eco-incorp/sauce";

const source = `
function main(asset: Address, to: Address, amount: Uint256) {
  Token(asset).transfer(to, amount);
}
`;

export function compileTokenTransfer(chain: routes.ChainRef) {
  return routes.compileSauceProgram(chain, source);
}

const program = compileTokenTransfer("base");
// One compile, any number of calls: only the encoded inputs change.
const first = routes.encodeEntryArguments(program, [
  Base.USDC.address, // a token's address: here Base's USDC, by its registry name
  "0x2222222222222222222222222222222222222222", // the recipient: a stand-in
  1_000_000n,
]);
console.log("bytecode:", program.bytecode.length, "bytes; arguments:", first.length, "bytes");
```

Every token write the SDK emits, `Token(asset).transfer` above and the builders below alike, follows OpenZeppelin's
`SafeERC20`: a token such as USDT that returns nothing is accepted, a token that returns `false` or
an address with no code reverts, and `approve` resets a standing allowance to zero first.
Only an `IERC20.at(address)` binding you write yourself is the raw, unchecked call.
[Safety](../concepts/safety.md) explains why the checks matter.

`token.Token` is the host builder for the same operations, for an application that wants the source
text with its values written in: `token.Token.transfer({ token, to, amount }).toSauceScript("evm")`
returns an object whose `.source` field is a program `routes.compileSauceProgram` compiles like any
other (its `imports` and `statement` are the same program in parts). A literal amount is encoded into
the calldata rather than appearing as a decimal in that source.

`TokenCall.toCall()` instead returns `{ target, data, value }` for a fixed EVM call. Values that require runtime state, such as `amount: "balance"` or balance owner `"self"`, must be compiled. `.statement(target)` emits a transfer/approval statement; `.expression(target)` emits a balance read. `Token.program(specs, { target })` combines several operations into one program.

Use `Token.approve({ token, spender, amount })` for approvals and `Token.balanceOf({ token, owner })` for reads. SVM specs name account references instead of ERC-20 addresses; see [Solana](solana.md).

## Swaps

A swap is not a builder: it is a call into [`@sauce/router`](../api/router.md), the SauceScript
library with one function per venue. It has eleven: Uniswap V2, V3 and V4, Curve, Balancer V2, DODO
V2, Trader Joe LB, WOOFi, Maverick V2, and PancakeSwap Infinity's CL and Bin pools. Its functions
take the pool, tokens and amount as run-time arguments, so a program can spend what an earlier call
returned, or choose the venue while it runs, and each returns what it received. Write the call into
your program, with its inputs as `main`'s parameters:

```js
import { uniswapV3 } from "@sauce/router";

function main(pool: Address, amountIn: Uint256, minOut: Uint256, recipient: Address): Uint256 {
  return uniswapV3(pool, WETH, USDC, amountIn, 0, minOut, recipient);
}
```

The last argument decides where the output ends: your wallet, or `ctx.self()` to keep it in the Pot,
where only another cook moves it
([Where a program's results end](../concepts/kitchen-pot-cook.md#where-a-programs-results-end)).

From data, write the swap as a [JSON action](actions.md#swaps) instead — `uniswapV3Swap`,
`curveSwap`, … — which compiles to the same call. An action names its tokens and contracts as a
program does (`"USDC"`, `"UniswapV3.Factory"`), and may name its pool by its factory's key, read
while the program runs: see [pools by key](actions.md#pools-by-key).

## Deposits, withdrawals, staking, and wrapping

A supply whose protocol and token are fixed is a program you write once, by name, with the amount
and the beneficiary as `main`'s inputs. Save it as `supply.sauce.ts`:

```js
// Supplies `amount` of the Pot's USDC to Aave V3 for `onBehalfOf`, who receives the aTokens.
//   amount: Uint256        how much USDC, in its smallest unit: 1000000 is 1 USDC
//   onBehalfOf: Address    who receives the aTokens: your wallet, or your Pot's address to keep them there
function main(amount: Uint256, onBehalfOf: Address) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, onBehalfOf, 0);
}
```

Compile it once, and encode the inputs for each supply:

```ts
import { readFileSync } from "node:fs";
import { routes } from "@eco-incorp/sauce";

export function compileSupply(chain: routes.ChainRef) {
  return routes.compileSauceProgram(chain, readFileSync("supply.sauce.ts", "utf8"));
}

const program = compileSupply("base");
const args = routes.encodeEntryArguments(program, [
  1_000_000n, // amount: 1 USDC
  "0x2222222222222222222222222222222222222222", // onBehalfOf: a stand-in for your wallet
]);
console.log("bytecode:", program.bytecode.length, "bytes; arguments:", args.length, "bytes");
```

`deposit.depositSource(spec)` builds the same kind of program from data: it emits the protocol call
and its required approval, as source that `routes.compileSauceProgram` compiles. Discover supported pairs with `deposit.listDepositTemplates()`; template coverage is separate from the protocol catalog. Templates include Aave/Spark supply and withdrawal, Compound V3 supply, ERC-4626/Euler deposits, Lido operations, and WETH wrapping/unwrapping.

The default approval policy is `"exact"`; `"none"` assumes an existing allowance, and `"max"` grants the maximum allowance. The default beneficiary is the executing Pot where the protocol supports it. Native-funded templates require value in the executing Pot and use a call carrying native value.

`amount: "balance"` reads the executing Pot's balance: native ETH for native-funded templates, the WETH `target` for unwrapping, or the supplied `token` for other templates — which is how a deposit spends what a swap before it delivered. To swap and then supply in one program from data, write an [actions document](actions.md): a swap action's output is what the next action spends.

On Arc the native coin is USDC at 18 decimals, and it is also the 6-decimal ERC-20 at `0x3600…0000`; a native-funded template's `"balance"` is that 18-decimal figure. Arc has no canonical wrapped native, so the `weth` templates have nothing to target there: `toDeposit` rejects Arc's `USDC` and its registry tokens, whose `WETH` is bridged ETH, as a `weth` target. See [Arc: USDC is the native coin](../reference/chains/arc.md#notes).

For Aave/Spark withdrawals, use a fixed underlying-asset amount or `amount: "max"` to withdraw the full position. `"balance"` reads the underlying token held by the Pot, not its supplied position, and should not size a withdrawal.

## Routing actions

Higher-level routing actions (swaps, bridges, wraps, stakes, and the chaining between them) live
behind the package's `/actions` subpath and are documented in [Actions](actions.md). An actions
document is plain JSON that compiles, for a chain, to one program: one document for every chain
where its tokens and contracts exist. `sauce actions` prints what it lowers to.

## Next

- Write the same steps as JSON instead of TypeScript: [Actions](actions.md).
- Every swap function and its arguments: [`@sauce/router`](../api/router.md).
- Run what you built from your tests: [Testing programs](testing.md).

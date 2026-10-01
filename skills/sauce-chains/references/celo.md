<!-- Generated from the SDK's registries. Do not edit. -->

# Celo

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `celo` |
| Chain id | 42220 |
| Kind | EVM |
| Name in a program | `Celo` |
| Native coin | CELO (CELO), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000064576f9C95a8623Bc0eff3db6d296ea6df` |
| Intent Executor | `0x645dADD5Bf354526b68A2befd9A305F7E03b91Ca` |
| Shared intent Pot | `0x48e8316d8084Ea76098257f32C431263b171744a`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |

## In a program

Compiled with `--chain celo`, a program names Celo's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=celo
function main() {
  // `UniswapV3.Factory` is Celo's factory: `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc`.
  require(UniswapV3.Factory != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Celo.UniswapV3.Factory == UniswapV3.Factory);
}
```

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` | `UniswapV3.SwapRouter02` |

<!-- Generated from the SDK's registries. Do not edit. -->

# Ink

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `ink` |
| Chain id | 57073 |
| Kind | EVM |
| Name in a program | `Ink` |
| Native coin | not recorded |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000064576f9C95a8623Bc0eff3db6d296ea6df` |
| Intent Executor | `0x645dADD5Bf354526b68A2befd9A305F7E03b91Ca` |
| Shared intent Pot | `0x48e8316d8084Ea76098257f32C431263b171744a`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |

## In a program

Compiled with `--chain ink`, a program names Ink's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=ink
function main() {
  // `UniswapV4.PoolManager` is Ink's poolManager: `0x360e68faccca8ca495c1b759fd9eee466db9fb32`.
  require(UniswapV4.PoolManager != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Ink.UniswapV4.PoolManager == UniswapV4.PoolManager);
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
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` | `UniswapV4.StateView` |

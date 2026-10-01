<!-- Generated from the SDK's registries. Do not edit. -->

# Zora

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `zora` |
| Chain id | 7777777 |
| Kind | EVM |
| Name in a program | `Zora` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain zora`, a program names Zora's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=zora
function main() {
  // `UniswapV2.Factory` is Zora's factory: `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C`.
  require(UniswapV2.Factory != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Zora.UniswapV2.Factory == UniswapV2.Factory);
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
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | factory | `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C` | `UniswapV2.Factory` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | router | `0xa00F34A632630EFd15223B1968358bA4845bEEC7` | `UniswapV2.Router` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x0575338e4c17006ae181b47900a84404247ca30f` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0x385785af07d63b50d0a0ea57c4ff89d06adf7328` | `UniswapV4.StateView` |

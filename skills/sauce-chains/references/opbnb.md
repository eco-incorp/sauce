<!-- Generated from the SDK's registries. Do not edit. -->

# opBNB

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `opbnb` |
| Chain id | 204 |
| Kind | EVM |
| Name in a program | `Opbnb` |
| Native coin | BNB (BNB), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain opbnb`, a program names opBNB's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=opbnb
function main() {
  // `PancakeswapV2.Factory` is opBNB's factory: `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E`.
  require(PancakeswapV2.Factory != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Opbnb.PancakeswapV2.Factory == PancakeswapV2.Factory);
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
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |

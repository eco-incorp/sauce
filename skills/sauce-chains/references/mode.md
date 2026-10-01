<!-- Generated from the SDK's registries. Do not edit. -->

# Mode

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `mode` |
| Chain id | 34443 |
| Kind | EVM |
| Name in a program | `Mode` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## In a program

Compiled with `--chain mode`, a program names Mode's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=mode
function main() {
  // `Across.SpokePool` is Mode's spokePool: `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96`.
  require(Across.SpokePool != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Mode.Across.SpokePool == Across.SpokePool);
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
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool` |
| [Kim](../../sauce-protocols/references/registry/kim.md) | v2Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` | `Kim.V2Router` |

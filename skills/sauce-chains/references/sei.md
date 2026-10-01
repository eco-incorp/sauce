<!-- Generated from the SDK's registries. Do not edit. -->

# Sei

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `sei`; also `sei-evm` |
| Chain id | 1329 |
| Kind | EVM |
| Name in a program | `Sei` |
| Native coin | SEI (SEI), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | none recorded |

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |

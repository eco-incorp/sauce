<!-- Generated from the SDK's registries. Do not edit. -->

# Sonic

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `sonic` |
| Chain id | 146 |
| Kind | EVM |
| Name in a program | `Sonic` |
| Native coin | not recorded |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000064576f9C95a8623Bc0eff3db6d296ea6df` |
| Intent Executor | `0x645dADD5Bf354526b68A2befd9A305F7E03b91Ca` |
| Shared intent Pot | `0x48e8316d8084Ea76098257f32C431263b171744a`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |
| CCTP domain | 13 |

## In a program

Compiled with `--chain sonic`, a program names Sonic's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=sonic
function main() {
  // `Cctp.TokenMessenger` is Sonic's tokenMessenger: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.
  require(Cctp.TokenMessenger != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Sonic.Cctp.TokenMessenger == Cctp.TokenMessenger);
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
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |

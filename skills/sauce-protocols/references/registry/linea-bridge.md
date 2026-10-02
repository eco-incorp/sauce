<!-- Generated from the SDK's registries. Do not edit. -->

# Linea Native Bridge (`linea-bridge`)

Official Linea zkEVM bridge via L1MessageService. Deposits ETH and ERC-20 tokens from Ethereum to Linea with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `LineaBridge` on ethereum, linea |
| Chains | ethereum, linea |
| Document | [linea-bridge.md](../linea-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `LineaBridge` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's l1MessageService, `0xd19d4B5d358258f05D7B411E21A1460D11B0876F`.
  require(LineaBridge.L1MessageService != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1MessageService | `0xd19d4B5d358258f05D7B411E21A1460D11B0876F` | `LineaBridge.L1MessageService` |
| [Linea](../../../sauce-chains/references/linea.md) | l2MessageService | `0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec` | `LineaBridge.L2MessageService` |

## ABI

### `LineaL1MessageServiceABI`

`import LineaL1MessageServiceABI from "./protocols/linea-bridge/LineaL1MessageServiceABI.json";` Speaks for: l1MessageService.

- `sendMessage(address _to, uint256 _fee, bytes _calldata) payable`
- `claimMessage(address _from, address _to, uint256 _fee, uint256 _value, address _feeRecipient, bytes _calldata, uint256 _nonce)`

<!-- Generated from the SDK's registries. Do not edit. -->

# Linea Native Bridge (`linea-bridge`)

Official Linea zkEVM bridge via L1MessageService. Deposits ETH and ERC-20 tokens from Ethereum to Linea with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, linea |
| Document | [linea-bridge.md](../linea-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's l1MessageService):

```sauce chain=ethereum
import LineaL1MessageServiceABI from "./protocols/linea-bridge/LineaL1MessageServiceABI.json";

const L1_MESSAGE_SERVICE = 0xd19d4B5d358258f05D7B411E21A1460D11B0876Fn;

function main() {
  const bound = LineaL1MessageServiceABI.at(L1_MESSAGE_SERVICE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1MessageService | `0xd19d4B5d358258f05D7B411E21A1460D11B0876F` | `LineaL1MessageServiceABI.at(0xd19d4B5d358258f05D7B411E21A1460D11B0876Fn)` |
| [Linea](../../../sauce-chains/references/linea.md) | l2MessageService | `0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec` | no registry ABI |

## ABI

### `LineaL1MessageServiceABI`

`import LineaL1MessageServiceABI from "./protocols/linea-bridge/LineaL1MessageServiceABI.json";` Speaks for: l1MessageService.

- `sendMessage(address _to, uint256 _fee, bytes _calldata) payable`
- `claimMessage(address _from, address _to, uint256 _fee, uint256 _value, address _feeRecipient, bytes _calldata, uint256 _nonce)`

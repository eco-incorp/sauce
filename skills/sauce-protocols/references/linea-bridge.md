# Linea Native Bridge

Official Linea zkEVM bridge via L1MessageService. Deposits ETH from Ethereum to Linea with ZK proof-based finality.

## Category

native L2 bridge | Direction: L1 to L2 (Ethereum to Linea) | Chains: Ethereum (1), Linea (59144)

## SauceScript Functions

### bridgeETH

Bridge ETH from Ethereum L1 to Linea L2 via the message service.

```typescript
import { LineaL1MessageServiceABI as IL1MessageService } from "./abis";

function main(messageServiceAddress: Address, recipient: Address, fee: Uint256): Uint256 {
  const service = IL1MessageService.at(messageServiceAddress);
  service.sendMessage(recipient, fee, 0x00);
  return 1;
}
```

- `recipient`: Address to receive ETH on Linea L2
- `fee`: Fee for the postman (relayer) to deliver the message on L2. Set to 0 for self-claim
- `_calldata`: Optional calldata to execute on L2 when message is delivered. `0x00` for simple ETH transfers
- ETH amount (minus fee) is sent as `msg.value`

## Deployed Addresses

| Chain    | Contract         | Address                                      |
| -------- | ---------------- | -------------------------------------------- |
| Ethereum | l1MessageService | `0xd19d4B5d358258f05D7B411E21A1460D11B0876F` |
| Linea    | l2MessageService | `0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec` |

## ABI Reference

### LineaL1MessageServiceABI

- `sendMessage(address _to, uint256 _fee, bytes _calldata)` [payable] - Send ETH and/or message from L1 to L2. `msg.value` = amount to bridge + fee
- `claimMessage(address _from, address _to, uint256 _fee, uint256 _value, address _feeRecipient, bytes _calldata, uint256 _nonce)` - Claim a message on the destination side (called by relayers or self-claim)

## Notes

- **L1 to L2** via L1MessageService. L2 to L1 via L2MessageService on Linea
- `sendMessage` is a general-purpose L1-to-L2 message sender -- ETH transfer is implicit via msg.value
- The `_fee` parameter incentivizes postmen (relayers) to deliver the message. Set to 0 and self-claim via `claimMessage`
- `_calldata` enables arbitrary contract execution on L2 when the message is delivered
- zkEVM architecture -- finality with ZK proofs (typically 8-32 hours for proof generation)
- L2 to L1 withdrawals also require ZK proof finalization
- For ERC-20 bridging, use the Linea Token Bridge contracts (separate from the message service)
- Canonical bridge -- no third-party risk, secured by Linea's ZK proving system (Consensys)
- Audited

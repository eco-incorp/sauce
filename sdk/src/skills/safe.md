# Safe

The most trusted multi-signature smart contract wallet, securing billions in digital assets. Supports programmable account abstraction and modular security.

## Category

infrastructure | Chains: Ethereum, Arbitrum, Optimism, Base, Polygon

## Key Operations

- **getThreshold**: Query the signing threshold of a Safe multisig
- **execTransaction**: Execute a transaction with collected signatures

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/safe";
```

## SauceScript Examples

```typescript
// Get Safe threshold
import { SafeABI as ISafe } from "./abis";
function main(safeAddress: Address): Uint256 {
  const safe = ISafe.at(safeAddress);
  return safe.getThreshold();
}
```

## Key Addresses

| Chain    | Contract   | Address                                      |
| -------- | ---------- | -------------------------------------------- |
| Ethereum | safeV141   | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| Ethereum | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` |
| Arbitrum | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` |
| Optimism | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` |
| Base     | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` |
| Polygon  | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` |

## ABI Methods

### SafeABI

- `execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)` - Execute signed transaction. Payable. Params: to (target), value (ETH), data (calldata), operation (0=call, 1=delegatecall), safeTxGas, baseGas, gasPrice, gasToken (address(0) for ETH), refundReceiver, signatures (packed owner signatures). Returns success bool
- `getOwners()` - List all Safe owners. Returns address[] of current owners
- `getThreshold()` - Get signing threshold. Returns uint256 (M in M-of-N)

## Notes

- Secures $100B+ in assets across DeFi
- safeV141 is for Ethereum L1; safeL2V130 is the L2-optimized version (emits events for cheaper indexing)
- operation: 0 = CALL (normal), 1 = DELEGATECALL (execute in Safe context)
- signatures are sorted by owner address, packed as 65 bytes each (r, s, v)
- Modular: supports Guards (pre/post checks), Modules (extend functionality), and Fallback handlers

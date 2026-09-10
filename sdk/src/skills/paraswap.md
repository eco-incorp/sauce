# ParaSwap

Multi-chain DEX aggregator optimizing swap rates across decentralized exchanges. Supports limit orders and delta algorithm for MEV protection.

## Category

aggregator | Chains: Ethereum, Arbitrum, Optimism, Polygon, BSC, Avalanche, Base

## Key Operations

- **simpleSwap**: Execute a simple single-path swap via Augustus router

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/paraswap";
```

## SauceScript Examples

```typescript
// Note: ParaSwap requires off-chain route computation via API before on-chain execution.
// The simpleSwap function uses complex tuple params populated from API response.
```

## Key Addresses

| Chain     | Contract   | Address                                      |
| --------- | ---------- | -------------------------------------------- |
| Ethereum  | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Ethereum  | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` |
| Arbitrum  | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Arbitrum  | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` |
| Optimism  | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Polygon   | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| BSC       | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Avalanche | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Base      | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |

## ABI Methods

### AugustusV5ABI

- `simpleSwap(tuple)` - Simple single-path swap. Payable. Returns receivedAmount. Tuple params:
  - `fromToken` (address) - Source token
  - `toToken` (address) - Destination token
  - `fromAmount` (uint256) - Input amount
  - `toAmount` (uint256) - Expected output
  - `expectedAmount` (uint256) - Expected amount for positive slippage tracking
  - `callees` (address[]) - DEX contracts to call
  - `exchangeData` (bytes) - Encoded calldata for each callee
  - `startIndexes` (uint256[]) - Byte offsets in exchangeData for each callee
  - `values` (uint256[]) - ETH values for each callee call
  - `beneficiary` (address) - Recipient of output tokens
  - `partner` (address) - Partner/referrer address
  - `feePercent` (uint256) - Fee percentage
  - `permit` (bytes) - EIP-2612 permit data (empty if pre-approved)
  - `deadline` (uint256) - Transaction deadline
  - `uuid` (bytes16) - Unique swap identifier

## Notes

- Augustus V5 and V6 both deployed on all chains
- Delta algorithm protects against MEV/sandwich attacks
- Route computation happens off-chain via ParaSwap API - callees/exchangeData come from API
- Approve srcToken to Augustus contract before swapping
- V6 is newer but V5 is more widely integrated

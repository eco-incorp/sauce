# Optimism Native Bridge

Official Optimism L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Optimism. OP Stack architecture with 7-day withdrawal finality.

## Category
native L2 bridge | Direction: L1 to L2 (Ethereum to Optimism) | Chains: Ethereum (1), Optimism (10)

## SauceScript Functions

### depositETH
Deposit ETH from Ethereum L1 to Optimism L2.
```typescript
import { OptimismL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(bridgeAddress: Address): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositETH(200000, 0x00);
  return 1;
}
```
- ETH amount is sent as `msg.value`
- `_minGasLimit`: Minimum gas for the L2 deposit execution (200000 is a safe default)
- `_extraData`: Optional extra data (typically `0x00`)

### depositERC20
Deposit ERC-20 tokens from Ethereum L1 to Optimism L2.
```typescript
import { OptimismL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(bridgeAddress: Address, l1Token: Address, l2Token: Address, amount: Uint256): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositERC20(l1Token, l2Token, amount, 200000, 0x00);
  return 1;
}
```
- `l1Token`: Token address on Ethereum L1
- `l2Token`: Corresponding token address on Optimism L2 (must be the official bridged representation)
- `amount`: Amount of tokens to deposit
- `_minGasLimit`: Minimum gas for L2 execution (200000 is a safe default)
- `_extraData`: Optional extra data (typically `0x00`)
- Requires ERC-20 approval to the L1StandardBridge

## Deployed Addresses

| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | l1StandardBridge | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` |
| Optimism | l2StandardBridge | `0x4200000000000000000000000000000000000010` |

## ABI Reference

### OptimismL1StandardBridgeABI
- `depositETH(uint32 _minGasLimit, bytes _extraData)` [payable] - Deposit ETH to your own address on L2. Amount = msg.value
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)` - Deposit ERC-20 tokens to your own address on L2
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData)` [payable] - Deposit ETH to a specific recipient on L2
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)` - Deposit ERC-20 tokens to a specific recipient on L2

## Notes
- **L1 to L2 only** via this contract. For L2 to L1 withdrawals, use the L2StandardBridge on Optimism (takes 7 days)
- OP Stack architecture -- same pattern used by Base, Mode, Zora, and other OP chains
- `depositETH` / `depositERC20` send to `msg.sender` on L2. Use `depositETHTo` / `depositERC20To` to specify a different recipient
- L1 to L2 deposits finalize in ~2-5 minutes (after L1 inclusion + sequencer processing)
- L2 to L1 withdrawals require 7-day challenge period (optimistic rollup security)
- `_l2Token` must be the official bridged token representation on Optimism -- incorrect L2 token address will cause deposit to fail
- Canonical bridge -- no third-party risk, secured by the Optimism rollup itself
- L2StandardBridge is at a predefined address: `0x4200000000000000000000000000000000000010`
- Audited

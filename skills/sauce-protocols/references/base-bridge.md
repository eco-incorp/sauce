# Base Native Bridge

Official Base L1StandardBridge for depositing ETH and ERC-20 tokens from Ethereum to Base. OP Stack architecture with 7-day withdrawal finality.

## Category

native L2 bridge | Direction: L1 to L2 (Ethereum to Base) | Chains: Ethereum (1), Base (8453)

## SauceScript Functions

### depositETH

Deposit ETH from Ethereum L1 to Base L2.

```typescript
import { BaseL1StandardBridgeABI as IL1StandardBridge } from "./abis";

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

Deposit ERC-20 tokens from Ethereum L1 to Base L2.

```typescript
import { BaseL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(
  bridgeAddress: Address,
  l1Token: Address,
  l2Token: Address,
  amount: Uint256,
): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositERC20(l1Token, l2Token, amount, 200000, 0x00);
  return 1;
}
```

- `l1Token`: Token address on Ethereum L1
- `l2Token`: Corresponding token address on Base L2 (must be the official bridged representation)
- `amount`: Amount of tokens to deposit
- `_minGasLimit`: Minimum gas for L2 execution (200000 is a safe default)
- `_extraData`: Optional extra data (typically `0x00`)
- Requires ERC-20 approval to the L1StandardBridge

## Deployed Addresses

| Chain    | Contract         | Address                                      |
| -------- | ---------------- | -------------------------------------------- |
| Ethereum | l1StandardBridge | `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` |
| Base     | l2StandardBridge | `0x4200000000000000000000000000000000000010` |

## ABI Reference

### BaseL1StandardBridgeABI

- `depositETH(uint32 _minGasLimit, bytes _extraData)` [payable] - Deposit ETH to your own address on Base. Amount = msg.value
- `depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)` - Deposit ERC-20 tokens to your own address on Base
- `depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData)` [payable] - Deposit ETH to a specific recipient on Base
- `depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)` - Deposit ERC-20 tokens to a specific recipient on Base

## Notes

- **L1 to L2 only** via this contract. For L2 to L1 withdrawals, use the L2StandardBridge on Base (takes 7 days)
- OP Stack architecture -- same bridge pattern as Optimism, Mode, Zora
- `depositETH` / `depositERC20` send to `msg.sender` on L2. Use `depositETHTo` / `depositERC20To` to specify a different recipient
- L1 to L2 deposits finalize in ~2-5 minutes (after L1 inclusion + sequencer processing)
- L2 to L1 withdrawals require 7-day challenge period (optimistic rollup security)
- `_l2Token` must be the official bridged token representation on Base -- incorrect L2 token address will cause deposit to fail
- Canonical bridge -- no third-party risk, secured by the Base (OP Stack) rollup itself
- L2StandardBridge is at a predefined address: `0x4200000000000000000000000000000000000010`
- Audited

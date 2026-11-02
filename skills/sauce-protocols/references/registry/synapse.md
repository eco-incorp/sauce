<!-- Generated from the SDK's registries. Do not edit. -->

# Synapse Protocol (`synapse`)

Cross-chain bridge and DEX with multi-chain AMM pools. Supports token swaps and bridging via SynapseBridge and CCTP router.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Synapse` on ethereum, optimism, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |
| Document | [synapse.md](../synapse.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Synapse` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cctpRouter, `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E`.
  require(Synapse.CctpRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cctpRouter | `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E` | `Synapse.CctpRouter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | synapseBridge | `0x2796317b0fF8538F253012862c06787Adfb8cEb6` | `Synapse.SynapseBridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | synapseBridge | `0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6b` | `Synapse.SynapseBridge` |
| [Polygon](../../../sauce-chains/references/polygon.md) | synapseBridge | `0x8F5BBB2BB8c2Ee94639E55d5F41de9b4839C1280` | `Synapse.SynapseBridge` |
| [Base](../../../sauce-chains/references/base.md) | synapseBridge | `0xf07d1C752fAb503E47FEF309bf14fbDD3E867089` | `Synapse.SynapseBridge` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | synapseBridge | `0x6F4e8eBa4D337f874Ab57478AcC2Cb5BACdc19c9` | `Synapse.SynapseBridge` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | synapseBridge | `0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACE` | `Synapse.SynapseBridge` |

## ABI

### `SynapseBridgeABI`

`import SynapseBridgeABI from "./protocols/synapse/SynapseBridgeABI.json";` Speaks for: synapseBridge. The import is the contract's full ABI across every deployment; call it through the `Synapse` namespace to have a function a chain's deployment does not run refused.

- `addKappas(bytes32[] kappas)`
- `bridgeVersion() view returns (uint256)`
- `chainGasAmount() view returns (uint256)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `deposit(address to, uint256 chainId, address token, uint256 amount)`
- `depositAndSwap(address to, uint256 chainId, address token, uint256 amount, uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 minDy, uint256 deadline)`
- `getFeeBalance(address tokenAddress) view returns (uint256)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getRoleMember(bytes32 role, uint256 index) view returns (address)`
- `getRoleMemberCount(bytes32 role) view returns (uint256)`
- `GOVERNANCE_ROLE() view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initialize()`
- `isLegacySendDisabled() view returns (bool)`
- `kappaExists(bytes32 kappa) view returns (bool)`
- `mint(address to, address token, uint256 amount, uint256 fee, bytes32 kappa)`
- `mintAndSwap(address to, address token, uint256 amount, uint256 fee, address pool, uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 minDy, uint256 deadline, bytes32 kappa)`
- `NODEGROUP_ROLE() view returns (bytes32)`
- `pause()`
- `paused() view returns (bool)`
- `redeem(address to, uint256 chainId, address token, uint256 amount)`
- `redeemAndRemove(address to, uint256 chainId, address token, uint256 amount, uint8 swapTokenIndex, uint256 swapMinAmount, uint256 swapDeadline)`
- `redeemAndSwap(address to, uint256 chainId, address token, uint256 amount, uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 minDy, uint256 deadline)`
- `redeemV2(bytes32 to, uint256 chainId, address token, uint256 amount)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `setChainGasAmount(uint256 amount)`
- `setLegacySendDisabled(bool _isLegacySendDisabled)`
- `setWethAddress(address _wethAddress)`
- `startBlockNumber() view returns (uint256)`
- `unpause()`
- `WETH_ADDRESS() view returns (address)`
- `withdraw(address to, address token, uint256 amount, uint256 fee, bytes32 kappa)`
- `withdrawAndRemove(address to, address token, uint256 amount, uint256 fee, address pool, uint8 swapTokenIndex, uint256 swapMinAmount, uint256 swapDeadline, bytes32 kappa)`
- `withdrawChainGas()`
- `withdrawFees(address token, address to)`

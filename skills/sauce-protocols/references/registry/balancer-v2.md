<!-- Generated from the SDK's registries. Do not edit. -->

# Balancer V2 (`balancer-v2`)

Generalized AMM with weighted pools, single Vault architecture, and flash loans. Supports custom pool types and multi-token pools.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Balancer`: `balancer-v2` |
| Namespace | `BalancerV2` on ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche |
| Document | [balancer-v2.md](../balancer-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `BalancerV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's vault, `0xBA12222222228d8Ba445958a75a0704d566BF2C8`.
  require(BalancerV2.Vault != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Optimism](../../../sauce-chains/references/optimism.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Gnosis](../../../sauce-chains/references/gnosis.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Polygon](../../../sauce-chains/references/polygon.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Base](../../../sauce-chains/references/base.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |

## ABI

### `BalancerV2VaultABI`

`import BalancerV2VaultABI from "./protocols/balancer-v2/BalancerV2VaultABI.json";` Speaks for: vault. The import is the contract's full ABI across every deployment; call it through the `BalancerV2` namespace to have a function a chain's deployment does not run refused.

- `batchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, int256[] limits, uint256 deadline) payable returns (int256[] assetDeltas)`
- `deregisterTokens(bytes32 poolId, address[] tokens)`
- `exitPool(bytes32 poolId, address sender, address recipient, (address[] assets, uint256[] minAmountsOut, bytes userData, bool toInternalBalance) request)`
- `flashLoan(address recipient, address[] tokens, uint256[] amounts, bytes userData)`
- `getActionId(bytes4 selector) view returns (bytes32)`
- `getAuthorizer() view returns (address)`
- `getDomainSeparator() view returns (bytes32)`
- `getInternalBalance(address user, address[] tokens) view returns (uint256[] balances)`
- `getNextNonce(address user) view returns (uint256)`
- `getPausedState() view returns (bool paused, uint256 pauseWindowEndTime, uint256 bufferPeriodEndTime)`
- `getPool(bytes32 poolId) view returns (address, uint8)`
- `getPoolTokenInfo(bytes32 poolId, address token) view returns (uint256 cash, uint256 managed, uint256 lastChangeBlock, address assetManager)`
- `getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)`
- `getProtocolFeesCollector() view returns (address)`
- `hasApprovedRelayer(address user, address relayer) view returns (bool)`
- `joinPool(bytes32 poolId, address sender, address recipient, (address[] assets, uint256[] maxAmountsIn, bytes userData, bool fromInternalBalance) request) payable`
- `managePoolBalance((uint8 kind, bytes32 poolId, address token, uint256 amount)[] ops)`
- `manageUserBalance((uint8 kind, address asset, uint256 amount, address sender, address recipient)[] ops) payable`
- `queryBatchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds) returns (int256[])`
- `registerPool(uint8 specialization) returns (bytes32)`
- `registerTokens(bytes32 poolId, address[] tokens, address[] assetManagers)`
- `setAuthorizer(address newAuthorizer)`
- `setPaused(bool paused)`
- `setRelayerApproval(address sender, address relayer, bool approved)`
- `swap((bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) payable returns (uint256 amountCalculated)`
- `WETH() view returns (address)`

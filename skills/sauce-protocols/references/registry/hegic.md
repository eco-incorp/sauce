<!-- Generated from the SDK's registries. Do not edit. -->

# Hegic (`hegic`)

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Hegic` on arbitrum |
| Chains | arbitrum |
| Document | [hegic.md](../hegic.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Hegic` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's hegic, `0x431402e8b9dE9aa016C743880e04E517074D8cEC`.
  require(Hegic.Hegic != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | hegic | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` | `Hegic.Hegic` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371` | `Hegic.OperationalTreasury` |

## ABI

### `HegicABI`

`import HegicABI from "./protocols/hegic/HegicABI.json";` Speaks for: operationalTreasury. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Hegic` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `acceptedStrategy(address) view returns (bool)`
- `addStrategy(address s)`
- `benchmark() view returns (uint256)`
- `buy(address strategy, address holder, uint256 amount, uint256 period, bytes[] additional)`
- `connectStrategy(address s)`
- `coverPool() view returns (address)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `lockedByStrategy(address) view returns (uint256)`
- `lockedLiquidity(uint256) view returns (uint8 state, address strategy, uint128 negativepnl, uint128 positivepnl, uint32 expiration)`
- `lockedPremium() view returns (uint256)`
- `manager() view returns (address)`
- `maxLockupPeriod() view returns (uint256)`
- `mayBeAcceptedAtEpoch(address) view returns (uint256)`
- `payOff(uint256 positionID, address account)`
- `renounceRole(bytes32 role, address account)`
- `replenish()`
- `revokeRole(bytes32 role, address account)`
- `setBenchmark(uint256 value)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `token() view returns (address)`
- `totalBalance() view returns (uint256)`
- `totalLocked() view returns (uint256)`
- `unlock(uint256 lockedLiquidityID)`
- `withdraw(address to, uint256 amount)`

Left out of this ABI, though its deployments declare them:

- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

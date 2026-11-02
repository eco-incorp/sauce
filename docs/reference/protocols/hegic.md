<!-- Generated from the SDK's registries. Do not edit. -->

# Hegic (`hegic`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Hegic is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Hegic` on arbitrum |
| Chains | arbitrum |

## What it offers

- **exerciseOption**: Exercise an options position to claim profit

## Notes

- Simplified options UX - no order books, instant settlement
- Supports ETH and BTC options on Arbitrum
- Options are represented as NFTs with unique IDs
- Exercise is only profitable if option is in-the-money at time of exercise

## Its names in a program

On Arbitrum One, `Hegic` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's hegic, `0x431402e8b9dE9aa016C743880e04E517074D8cEC`.
  require(Hegic.Hegic != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | hegic | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` | `Hegic.Hegic` |
| [Arbitrum One](../chains/arbitrum.md) | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371` | `Hegic.OperationalTreasury` |

## ABI

### `HegicABI`

`import HegicABI from "./protocols/hegic/HegicABI.json";` Speaks for: operationalTreasury.

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

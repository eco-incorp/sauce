<!-- Generated from the SDK's registries. Do not edit. -->

# Yearn V3 (`yearn-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Yearn V3 is a yield vault: deposits are put to work to earn interest. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Yield aggregator protocol. V3 vaults follow the ERC-4626 standard for automated yield optimization with multi-strategy allocations.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | `Yearn`: `yearn-v3` |
| Namespace | `YearnV3` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Deposit assets into vault, receive yield-bearing shares
- **withdraw**: Withdraw assets by specifying asset amount
- **redeem**: Withdraw by specifying share amount

## Notes

- TVL: $500M+. ERC-4626 compliant (same interface as sfrxETH, pufETH, sDAI)
- Each vault has a unique address per underlying asset + strategy combination
- Approve underlying token to vault before depositing
- Vaults are deployed via factory - no single canonical vault address

## Its names in a program

On Ethereum, `YearnV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's vaultFactory, `0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F`.
  require(YearnV3.VaultFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F` | `YearnV3.VaultFactory` |

## ABI

### `YearnV3VaultABI`

`import YearnV3VaultABI from "./protocols/yearn-v3/YearnV3VaultABI.json";`

- `accept_role_manager()`
- `accountant() view returns (address)`
- `add_role(address account, uint256 role)`
- `add_strategy(address new_strategy)`
- `add_strategy(address new_strategy, bool add_to_queue)`
- `allowance(address arg0, address arg1) view returns (uint256)`
- `apiVersion() view returns (string)`
- `approve(address spender, uint256 amount) returns (bool)`
- `assess_share_of_unrealised_losses(address strategy, uint256 assets_needed) view returns (uint256)`
- `asset() view returns (address)`
- `balanceOf(address account) view returns (uint256)`
- `buy_debt(address strategy, uint256 amount)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `decimals() view returns (uint8)`
- `default_queue(uint256 arg0) view returns (address)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `deposit_limit() view returns (uint256)`
- `deposit_limit_module() view returns (address)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `FACTORY() view returns (address)`
- `force_revoke_strategy(address strategy)`
- `fullProfitUnlockDate() view returns (uint256)`
- `future_role_manager() view returns (address)`
- `get_default_queue() view returns (address[])`
- `initialize(address asset, string name, string symbol, address role_manager, uint256 profit_max_unlock_time)`
- `isShutdown() view returns (bool)`
- `lastProfitUpdate() view returns (uint256)`
- `maxDeposit(address receiver) view returns (uint256)`
- `maxMint(address receiver) view returns (uint256)`
- `maxRedeem(address owner) view returns (uint256)`
- `maxRedeem(address owner, uint256 max_loss) view returns (uint256)`
- `maxRedeem(address owner, uint256 max_loss, address[] strategies) view returns (uint256)`
- `maxWithdraw(address owner) view returns (uint256)`
- `maxWithdraw(address owner, uint256 max_loss) view returns (uint256)`
- `maxWithdraw(address owner, uint256 max_loss, address[] strategies) view returns (uint256)`
- `minimum_total_idle() view returns (uint256)`
- `mint(uint256 shares, address receiver) returns (uint256)`
- `name() view returns (string)`
- `nonces(address arg0) view returns (uint256)`
- `permit(address owner, address spender, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (bool)`
- `previewDeposit(uint256 assets) view returns (uint256)`
- `previewMint(uint256 shares) view returns (uint256)`
- `previewRedeem(uint256 shares) view returns (uint256)`
- `previewWithdraw(uint256 assets) view returns (uint256)`
- `pricePerShare() view returns (uint256)`
- `process_report(address strategy) returns (uint256, uint256)`
- `profitMaxUnlockTime() view returns (uint256)`
- `profitUnlockingRate() view returns (uint256)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `redeem(uint256 shares, address receiver, address owner, uint256 max_loss) returns (uint256)`
- `redeem(uint256 shares, address receiver, address owner, uint256 max_loss, address[] strategies) returns (uint256)`
- `remove_role(address account, uint256 role)`
- `revoke_strategy(address strategy)`
- `role_manager() view returns (address)`
- `roles(address arg0) view returns (uint256)`
- `set_accountant(address new_accountant)`
- `set_default_queue(address[] new_default_queue)`
- `set_deposit_limit(uint256 deposit_limit)`
- `set_deposit_limit(uint256 deposit_limit, bool override)`
- `set_deposit_limit_module(address deposit_limit_module)`
- `set_deposit_limit_module(address deposit_limit_module, bool override)`
- `set_minimum_total_idle(uint256 minimum_total_idle)`
- `set_role(address account, uint256 role)`
- `set_use_default_queue(bool use_default_queue)`
- `set_withdraw_limit_module(address withdraw_limit_module)`
- `setProfitMaxUnlockTime(uint256 new_profit_max_unlock_time)`
- `shutdown_vault()`
- `strategies(address arg0) view returns ((uint256 activation, uint256 last_report, uint256 current_debt, uint256 max_debt))`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalDebt() view returns (uint256)`
- `totalIdle() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address receiver, uint256 amount) returns (bool)`
- `transfer_role_manager(address role_manager)`
- `transferFrom(address sender, address receiver, uint256 amount) returns (bool)`
- `unlockedShares() view returns (uint256)`
- `update_debt(address strategy, uint256 target_debt) returns (uint256)`
- `update_debt(address strategy, uint256 target_debt, uint256 max_loss) returns (uint256)`
- `update_max_debt_for_strategy(address strategy, uint256 new_max_debt)`
- `use_default_queue() view returns (bool)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `withdraw(uint256 assets, address receiver, address owner, uint256 max_loss) returns (uint256)`
- `withdraw(uint256 assets, address receiver, address owner, uint256 max_loss, address[] strategies) returns (uint256)`
- `withdraw_limit_module() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

<!-- Generated from the SDK's registries. Do not edit. -->

# Harvest Finance (`harvest`)

Yield farming protocol that automatically compounds rewards across DeFi strategies via Vault+Strategy pattern.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Harvest` on ethereum |
| Chains | ethereum |
| Document | [harvest.md](../harvest.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Harvest` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's controller, `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C`.
  require(Harvest.Controller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | controller | `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C` | `Harvest.Controller` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | depositHelper | `0xF8ce90c2710713552fb564869694B2505Bfc0846` | `Harvest.DepositHelper` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | farm | `0xa0246c9032bC3A600820415aE600c6388619A14D` | `Harvest.Farm` |

## ABI

### `VaultABI`

`import VaultABI from "./protocols/harvest/VaultABI.json";`

- `allowance(address owner, address spender) view returns (uint256)`
- `announceStrategyUpdate(address _strategy)`
- `approve(address spender, uint256 amount) returns (bool)`
- `asset() view returns (address)`
- `assetsOf(address _depositor) view returns (uint256)`
- `assetsPerShare() view returns (uint256)`
- `availableToInvestOut() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `canUpdateStrategy(address _strategy) view returns (bool)`
- `controller() view returns (address)`
- `convertToAssets(uint256 _shares) view returns (uint256)`
- `convertToShares(uint256 _assets) view returns (uint256)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `deposit(uint256 amount) returns (uint256)`
- `deposit(uint256 _assets, address _receiver) returns (uint256)`
- `depositFor(uint256 amount, address holder) returns (uint256 minted)`
- `doHardWork()`
- `finalizeStrategyUpdate()`
- `finalizeUpgrade()`
- `getPricePerFullShare() view returns (uint256)`
- `governance() view returns (address)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize()`
- `initialize(address _storage)`
- `initialize(address _underlying, uint256 _toInvestNumerator, uint256 _toInvestDenominator, uint256 _underlyingUnit)`
- `initializeVault(address _storage, address _underlying, uint256 _toInvestNumerator, uint256 _toInvestDenominator)`
- `maxDeposit(address) view returns (uint256)`
- `maxMint(address) view returns (uint256)`
- `maxRedeem(address _caller) view returns (uint256)`
- `maxWithdraw(address _caller) view returns (uint256)`
- `mint(uint256 _shares, address _receiver) returns (uint256)`
- `name() view returns (string)`
- `nextImplementation() view returns (address)`
- `nextImplementationDelay() view returns (uint256)`
- `nextImplementationTimestamp() view returns (uint256)`
- `nextStrategy() view returns (address)`
- `nextStrategyTimestamp() view returns (uint256)`
- `previewDeposit(uint256 _assets) view returns (uint256)`
- `previewMint(uint256 _shares) view returns (uint256)`
- `previewRedeem(uint256 _shares) view returns (uint256)`
- `previewWithdraw(uint256 _assets) view returns (uint256)`
- `rebalance()`
- `redeem(uint256 _shares, address _receiver, address _owner) returns (uint256)`
- `scheduleUpgrade(address impl)`
- `setStorage(address _store)`
- `setStrategy(address _strategy)`
- `setVaultFractionToInvest(uint256 numerator, uint256 denominator)`
- `shouldUpgrade() view returns (bool, address)`
- `strategy() view returns (address)`
- `symbol() view returns (string)`
- `TEN() view returns (uint256)`
- `totalAssets() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address recipient, uint256 amount) returns (bool)`
- `transferFrom(address sender, address recipient, uint256 amount) returns (bool)`
- `underlying() view returns (address)`
- `underlyingBalanceInVault() view returns (uint256)`
- `underlyingBalanceWithInvestment() view returns (uint256)`
- `underlyingBalanceWithInvestmentForHolder(address holder) view returns (uint256)`
- `underlyingUnit() view returns (uint256)`
- `vaultFractionToInvestDenominator() view returns (uint256)`
- `vaultFractionToInvestNumerator() view returns (uint256)`
- `withdraw(uint256 numberOfShares) returns (uint256)`
- `withdraw(uint256 _assets, address _receiver, address _owner) returns (uint256)`
- `withdrawAll()`

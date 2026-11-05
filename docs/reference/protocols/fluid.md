<!-- Generated from the SDK's registries. Do not edit. -->

# Fluid (`fluid`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Fluid is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Liquidity layer that unifies lending and DEX liquidity. Deposited assets simultaneously serve as lending collateral and DEX liquidity.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Fluid` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Notes

- Deposited assets serve dual purpose as lending collateral AND DEX liquidity
- No interest rate mode selection -- all rates are algorithmically determined
- Same contract address on Ethereum and Arbitrum
- Built by the Instadapp team
- All deposit/repay operations require ERC-20 approval (to the fToken or Vault)
- TVL: $1B+. Audited

## Its names in a program

On Ethereum, `Fluid` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's liquidity, `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497`.
  require(Fluid.Liquidity != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |
| [Arbitrum One](../chains/arbitrum.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `FluidLendingABI`

`import FluidLendingABI from "./protocols/fluid/FluidLendingABI.json";`

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `asset() view returns (address)`: the address is a token
- `balanceOf(address account) view returns (uint256)`
- `convertToAssets(uint256 shares_) view returns (uint256)`
- `convertToShares(uint256 assets_) view returns (uint256)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `deposit(uint256 assets_, address receiver_, uint256 minAmountOut_) returns (uint256 shares_)`
- `depositWithSignature(uint256 assets_, address receiver_, uint256 minAmountOut_, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit_, bytes signature_) returns (uint256 shares_)`
- `depositWithSignatureEIP2612(uint256 assets_, address receiver_, uint256 minAmountOut_, uint256 deadline_, bytes signature_) returns (uint256 shares_)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `getData() view returns (address liquidity_, address lendingFactory_, address lendingRewardsRateModel_, address permit2_, address rebalancer_, bool rewardsActive_, uint256 liquidityBalance_, uint256 liquidityExchangePrice_, uint256 tokenExchangePrice_)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `liquidityCallback(address token_, uint256 amount_, bytes data_)`
- `maxDeposit(address) view returns (uint256)`
- `maxMint(address) view returns (uint256)`
- `maxRedeem(address owner_) view returns (uint256)`
- `maxWithdraw(address owner_) view returns (uint256)`
- `minDeposit() view returns (uint256)`
- `mint(uint256 shares_, address receiver_) returns (uint256 assets_)`
- `mint(uint256 shares_, address receiver_, uint256 maxAssets_) returns (uint256 assets_)`
- `mintWithSignature(uint256 shares_, address receiver_, uint256 maxAssets_, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit_, bytes signature_) returns (uint256 assets_)`
- `mintWithSignatureEIP2612(uint256 shares_, address receiver_, uint256 maxAssets_, uint256 deadline_, bytes signature_) returns (uint256 assets_)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `previewDeposit(uint256 assets_) view returns (uint256)`
- `previewMint(uint256 shares_) view returns (uint256)`
- `previewRedeem(uint256 shares_) view returns (uint256)`
- `previewWithdraw(uint256 assets_) view returns (uint256)`
- `rebalance() payable returns (uint256 assets_)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `redeem(uint256 shares_, address receiver_, address owner_, uint256 minAmountOut_) returns (uint256 assets_)`
- `redeemWithSignature(uint256 shares_, address receiver_, address owner_, uint256 minAmountOut_, uint256 deadline_, bytes signature_) returns (uint256 assets_)`
- `rescueFunds(address token_)`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `updateRates() returns (uint256 tokenExchangePrice_, uint256 liquidityExchangePrice_)`
- `updateRebalancer(address newRebalancer_)`
- `updateRewards(address rewardsRateModel_)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`
- `withdraw(uint256 assets_, address receiver_, address owner_, uint256 maxSharesBurn_) returns (uint256 shares_)`
- `withdrawWithSignature(uint256 sharesToPermit_, uint256 assets_, address receiver_, address owner_, uint256 maxSharesBurn_, uint256 deadline_, bytes signature_) returns (uint256 shares_)`

### `FluidVaultABI`

`import FluidVaultABI from "./protocols/fluid/FluidVaultABI.json";`

- `absorb()`
- `constantsView() view returns ((address liquidity, address factory, address adminImplementation, address secondaryImplementation, address supplyToken, address borrowToken, uint8 supplyDecimals, uint8 borrowDecimals, uint256 vaultId, bytes32 liquiditySupplyExchangePriceSlot, bytes32 liquidityBorrowExchangePriceSlot, bytes32 liquidityUserSupplySlot, bytes32 liquidityUserBorrowSlot) constantsView_)`
- `fetchLatestPosition(int256 positionTick_, uint256 positionTickId_, uint256 positionRawDebt_, uint256 tickData_) view returns (int256, uint256, uint256 positionRawCol_, uint256 branchId_, uint256 branchData_)`
- `liquidate(uint256 debtAmt_, uint256 colPerUnitDebt_, address to_, bool absorb_) payable returns (uint256 actualDebtAmt_, uint256 actualColAmt_)`
- `LIQUIDITY() view returns (address)`
- `liquidityCallback(address token_, uint256 amount_, bytes data_)`
- `operate(uint256 nftId, int256 newCol, int256 newDebt, address to) payable returns (uint256, int256, int256)`
- `readFromStorage(bytes32 slot_) view returns (uint256 result_)`
- `rebalance() payable returns (int256 supplyAmt_, int256 borrowAmt_)`
- `updateExchangePrices(uint256 vaultVariables2_) view returns (uint256 liqSupplyExPrice_, uint256 liqBorrowExPrice_, uint256 vaultSupplyExPrice_, uint256 vaultBorrowExPrice_)`
- `updateExchangePricesOnStorage() returns (uint256 liqSupplyExPrice_, uint256 liqBorrowExPrice_, uint256 vaultSupplyExPrice_, uint256 vaultBorrowExPrice_)`
- `VAULT_FACTORY() view returns (address)`
- `VAULT_ID() view returns (uint256)`

Left out of this ABI, though its deployments declare them:

- `event LogAbsorb` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event LogRebalance` taking `(int256,int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

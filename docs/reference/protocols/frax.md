<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Finance (`frax`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Frax Finance is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against
> them. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Frax` on ethereum |
| Chains | ethereum |

## What it offers

- **transfer**: Transfer FRAX tokens
- **approve**: Approve FRAX token spender

## Notes

- TVL: $1B+. V1 was fractional-algorithmic, V2 (Frax v3) is fully collateralized
- FXS is the governance/value accrual token
- sFRAX is the staked FRAX vault (ERC-4626) for earning yield - see frax-ether module for sfrxETH
- Frax ecosystem includes: FRAX (stablecoin), frxETH/sfrxETH (liquid staking), FPI (inflation-pegged)

## Its names in a program

On Ethereum, `Frax` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's frax, `0x853d955aCEf822Db058eb8505911ED77F175b99e`.
  require(Frax.Frax != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `Frax.Frax` |

## ABI

### `FraxERC20ABI`

`import FraxERC20ABI from "./protocols/frax/FraxERC20ABI.json";` Speaks for: frax.

- `addPool(address pool_address)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(uint256 amount)`
- `burnFrom(address account, uint256 amount)`
- `collateral_ratio_paused() view returns (bool)`
- `COLLATERAL_RATIO_PAUSER() view returns (bytes32)`
- `controller_address() view returns (address)`
- `creator_address() view returns (address)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DEFAULT_ADMIN_ADDRESS() view returns (address)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `eth_usd_consumer_address() view returns (address)`
- `eth_usd_price() view returns (uint256)`
- `frax_eth_oracle_address() view returns (address)`
- `frax_info() view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)`
- `frax_pools(address) view returns (bool)`
- `frax_pools_array(uint256) view returns (address)`
- `frax_price() view returns (uint256)`
- `frax_step() view returns (uint256)`
- `fxs_address() view returns (address)`
- `fxs_eth_oracle_address() view returns (address)`
- `fxs_price() view returns (uint256)`
- `genesis_supply() view returns (uint256)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getRoleMember(bytes32 role, uint256 index) view returns (address)`
- `getRoleMemberCount(bytes32 role) view returns (uint256)`
- `global_collateral_ratio() view returns (uint256)`
- `globalCollateralValue() view returns (uint256)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `last_call_time() view returns (uint256)`
- `minting_fee() view returns (uint256)`
- `name() view returns (string)`
- `owner_address() view returns (address)`
- `pool_burn_from(address b_address, uint256 b_amount)`
- `pool_mint(address m_address, uint256 m_amount)`
- `price_band() view returns (uint256)`
- `price_target() view returns (uint256)`
- `redemption_fee() view returns (uint256)`
- `refresh_cooldown() view returns (uint256)`
- `refreshCollateralRatio()`
- `removePool(address pool_address)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `setController(address _controller_address)`
- `setETHUSDOracle(address _eth_usd_consumer_address)`
- `setFRAXEthOracle(address _frax_oracle_addr, address _weth_address)`
- `setFraxStep(uint256 _new_step)`
- `setFXSAddress(address _fxs_address)`
- `setFXSEthOracle(address _fxs_oracle_addr, address _weth_address)`
- `setMintingFee(uint256 min_fee)`
- `setOwner(address _owner_address)`
- `setPriceBand(uint256 _price_band)`
- `setPriceTarget(uint256 _new_price_target)`
- `setRedemptionFee(uint256 red_fee)`
- `setRefreshCooldown(uint256 _new_cooldown)`
- `setTimelock(address new_timelock)`
- `symbol() view returns (string)`
- `timelock_address() view returns (address)`
- `toggleCollateralRatio()`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address sender, address recipient, uint256 amount) returns (bool)`
- `weth_address() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

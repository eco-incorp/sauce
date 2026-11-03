<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Finance (`frax`)

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Frax` on ethereum |
| Chains | ethereum |
| Document | [frax.md](../frax.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Frax` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's frax, `0x853d955aCEf822Db058eb8505911ED77F175b99e`.
  require(Frax.Frax != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `Frax.Frax` |

## ABI

### `FraxERC20ABI`

`import FraxERC20ABI from "./protocols/frax/FraxERC20ABI.json";` Speaks for: frax. The import is the contract's full ABI across every deployment; call it through the `Frax` namespace to have a function a chain's deployment does not run refused.

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

Left out of this ABI, though its deployments declare them:

- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

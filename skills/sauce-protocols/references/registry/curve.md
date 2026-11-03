<!-- Generated from the SDK's registries. Do not edit. -->

# Curve Finance (`curve`)

StableSwap AMM optimized for low-slippage swaps between pegged assets (stablecoins, wrapped tokens).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Curve` on ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| Chains | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| Document | [curve.md](../curve.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Curve` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's addressProvider, `0x0000000022D53366457F9d5E68Ec105046FC4383`.
  require(Curve.AddressProvider != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | crvToken | `0xD533a949740bb3306d119CC777fa900bA034cd52` | `Curve.CrvToken` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | routerNG | `0x16C6521Dff6baB339122a0FE25a9116693265353` | `Curve.RouterNG` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | threePool | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` | `Curve.ThreePool` |
| [Optimism](../../../sauce-chains/references/optimism.md) | routerNG | `0x0DCDED3545D565bA3B19E683431381007245d983` | `Curve.RouterNG` |
| [Gnosis](../../../sauce-chains/references/gnosis.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Polygon](../../../sauce-chains/references/polygon.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Fantom](../../../sauce-chains/references/fantom.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Base](../../../sauce-chains/references/base.md) | routerNG | `0x4f37A9d177470499A2dD084621020b023fcffc1F` | `Curve.RouterNG` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | routerNG | `0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D` | `Curve.RouterNG` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |

## ABI

### `CurveAddressProviderABI`

`import CurveAddressProviderABI from "./protocols/curve/CurveAddressProviderABI.json";` Speaks for: addressProvider. The import is the contract's full ABI across every deployment; call it through the `Curve` namespace to have a function a chain's deployment does not run refused.

- `add_new_id(address _address, string _description) returns (uint256)`
- `admin() view returns (address)`
- `apply_transfer_ownership() returns (bool)`
- `commit_transfer_ownership(address _new_admin) returns (bool)`
- `future_admin() view returns (address)`
- `get_address(uint256 _id) view returns (address)`
- `get_id_info(uint256 arg0) view returns (address addr, bool is_active, uint256 version, uint256 last_modified, string description)`
- `get_registry() view returns (address)`
- `max_id() view returns (uint256)`
- `revert_transfer_ownership() returns (bool)`
- `set_address(uint256 _id, address _address) returns (bool)`
- `transfer_ownership_deadline() view returns (uint256)`
- `unset_address(uint256 _id) returns (bool)`

### `CurveRouterNGABI`

`import CurveRouterNGABI from "./protocols/curve/CurveRouterNGABI.json";` Speaks for: routerNG. The import is the contract's full ABI across every deployment; call it through the `Curve` namespace to have a function a chain's deployment does not run refused.

- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy) payable returns (uint256)`
- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools) payable returns (uint256)`
- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy, address[5] _pools, address _receiver) payable returns (uint256)`
- `get_dx(address[11] _route, uint256[5][5] _swap_params, uint256 _out_amount, address[5] _pools) view returns (uint256)`
- `get_dx(address[11] _route, uint256[5][5] _swap_params, uint256 _out_amount, address[5] _pools, address[5] _base_pools) view returns (uint256)`
- `get_dx(address[11] _route, uint256[5][5] _swap_params, uint256 _out_amount, address[5] _pools, address[5] _base_pools, address[5] _base_tokens) view returns (uint256)`
- `get_dy(address[11] _route, uint256[5][5] _swap_params, uint256 _amount) view returns (uint256)`
- `get_dy(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, address[5] _pools) view returns (uint256)`
- `version() view returns (string)`

### `CurveStableSwapABI`

`import CurveStableSwapABI from "./protocols/curve/CurveStableSwapABI.json";`

- `A() view returns (uint256)`
- `A_precise() view returns (uint256)`
- `add_liquidity(uint256[] amounts, uint256 min_mint_amount) returns (uint256)`
- `add_liquidity(uint256[] _amounts, uint256 _min_mint_amount, address _receiver) returns (uint256)`
- `admin_balances(uint256 arg0) view returns (uint256)`
- `admin_fee() view returns (uint256)`
- `allowance(address arg0, address arg1) view returns (uint256)`
- `approve(address _spender, uint256 _value) returns (bool)`
- `balanceOf(address arg0) view returns (uint256)`
- `balances(uint256 i) view returns (uint256)`
- `BASE_COINS(uint256 arg0) view returns (address)`
- `BASE_N_COINS() view returns (uint256)`
- `BASE_POOL() view returns (address)`
- `calc_token_amount(uint256[] _amounts, bool _is_deposit) view returns (uint256)`
- `calc_withdraw_one_coin(uint256 _burn_amount, int128 i) view returns (uint256)`
- `coins(uint256 arg0) view returns (address)`
- `D_ma_time() view returns (uint256)`
- `D_oracle() view returns (uint256)`
- `decimals() view returns (uint8)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `dynamic_fee(int128 i, int128 j) view returns (uint256)`
- `ema_price(uint256 i) view returns (uint256)`
- `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)`
- `exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)`
- `exchange_received(int128 i, int128 j, uint256 _dx, uint256 _min_dy) returns (uint256)`
- `exchange_received(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)`
- `exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)`
- `exchange_underlying(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)`
- `fee() view returns (uint256)`
- `future_A() view returns (uint256)`
- `future_A_time() view returns (uint256)`
- `get_balances() view returns (uint256[])`
- `get_dx(int128 i, int128 j, uint256 dy) view returns (uint256)`
- `get_dx_underlying(int128 i, int128 j, uint256 dy) view returns (uint256)`
- `get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_dy_underlying(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_p(uint256 i) view returns (uint256)`
- `get_virtual_price() view returns (uint256)`
- `initial_A() view returns (uint256)`
- `initial_A_time() view returns (uint256)`
- `last_price(uint256 i) view returns (uint256)`
- `ma_exp_time() view returns (uint256)`
- `ma_last_time() view returns (uint256)`
- `N_COINS() view returns (uint256)`
- `name() view returns (string)`
- `nonces(address arg0) view returns (uint256)`
- `offpeg_fee_multiplier() view returns (uint256)`
- `permit(address _owner, address _spender, uint256 _value, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s) returns (bool)`
- `price_oracle(uint256 i) view returns (uint256)`
- `ramp_A(uint256 _future_A, uint256 _future_time)`
- `remove_liquidity(uint256 _amount, uint256[] min_amounts) returns (uint256[])`
- `remove_liquidity(uint256 _burn_amount, uint256[] _min_amounts, address _receiver) returns (uint256[])`
- `remove_liquidity(uint256 _burn_amount, uint256[] _min_amounts, address _receiver, bool _claim_admin_fees) returns (uint256[])`
- `remove_liquidity_imbalance(uint256[] _amounts, uint256 _max_burn_amount) returns (uint256)`
- `remove_liquidity_imbalance(uint256[] _amounts, uint256 _max_burn_amount, address _receiver) returns (uint256)`
- `remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount) returns (uint256)`
- `remove_liquidity_one_coin(uint256 _burn_amount, int128 i, uint256 _min_received, address _receiver) returns (uint256)`
- `salt() view returns (bytes32)`
- `set_ma_exp_time(uint256 _ma_exp_time, uint256 _D_ma_time)`
- `set_new_fee(uint256 _new_fee, uint256 _new_offpeg_fee_multiplier)`
- `stop_ramp_A()`
- `stored_rates() view returns (uint256[])`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address _to, uint256 _value) returns (bool)`
- `transferFrom(address _from, address _to, uint256 _value) returns (bool)`
- `version() view returns (string)`
- `withdraw_admin_fees()`

Not every contract reached through this interface runs every function listed: the contracts the registry checked it against do not all dispatch the same ones. A call to one the contract does not run does not run the function, and whether it reverts is up to that code.

### `CurveThreePoolABI`

`import CurveThreePoolABI from "./protocols/curve/CurveThreePoolABI.json";` Speaks for: threePool. The import is the contract's full ABI across every deployment; call it through the `Curve` namespace to have a function a chain's deployment does not run refused.

- `A() view returns (uint256)`
- `add_liquidity(uint256[3] amounts, uint256 min_mint_amount)`
- `admin_actions_deadline() view returns (uint256)`
- `admin_balances(uint256 i) view returns (uint256)`
- `admin_fee() view returns (uint256)`
- `apply_new_fee()`
- `apply_transfer_ownership()`
- `balances(uint256 arg0) view returns (uint256)`
- `calc_token_amount(uint256[3] amounts, bool deposit) view returns (uint256)`
- `calc_withdraw_one_coin(uint256 _token_amount, int128 i) view returns (uint256)`
- `coins(uint256 arg0) view returns (address)`
- `commit_new_fee(uint256 new_fee, uint256 new_admin_fee)`
- `commit_transfer_ownership(address _owner)`
- `donate_admin_fees()`
- `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)`
- `fee() view returns (uint256)`
- `future_A() view returns (uint256)`
- `future_A_time() view returns (uint256)`
- `future_admin_fee() view returns (uint256)`
- `future_fee() view returns (uint256)`
- `future_owner() view returns (address)`
- `get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_dy_underlying(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_virtual_price() view returns (uint256)`
- `initial_A() view returns (uint256)`
- `initial_A_time() view returns (uint256)`
- `kill_me()`
- `owner() view returns (address)`
- `ramp_A(uint256 _future_A, uint256 _future_time)`
- `remove_liquidity(uint256 _amount, uint256[3] min_amounts)`
- `remove_liquidity_imbalance(uint256[3] amounts, uint256 max_burn_amount)`
- `remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount)`
- `revert_new_parameters()`
- `revert_transfer_ownership()`
- `stop_ramp_A()`
- `transfer_ownership_deadline() view returns (uint256)`
- `unkill_me()`
- `withdraw_admin_fees()`

<!-- Generated from the SDK's registries. Do not edit. -->

# Curve Finance (`curve`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Curve Finance is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

StableSwap AMM optimized for low-slippage swaps between pegged assets (stablecoins, wrapped tokens). Uses a specialized invariant that provides near-zero slippage for like-kind assets while maintaining AMM properties.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Curve` on ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| Chains | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |

## What it offers

- **swap**: Exchange tokens within a pool using index-based routing
- **addLiquidity**: Add liquidity with flexible token amounts (can be imbalanced)
- **removeLiquidity**: Remove liquidity proportionally or single-sided

## Notes

- Pool tokens are indexed (i, j) not addressed; you must know the token order for each pool
- Common pool token orders: 3pool = [DAI(0), USDC(1), USDT(2)]
- `exchange_underlying` is used for metapools or lending pools where tokens wrap underlying assets
- `remove_liquidity_one_coin` is useful for single-sided withdrawal (higher slippage than proportional)
- Each pool is a separate contract; use the AddressProvider or registry to discover pools
- RouterNG enables cross-pool routing for multi-hop swaps across different pools
- The `get_virtual_price` never decreases and represents the LP token value growth over time
- Tokens must be ERC20-approved to the pool contract (not a router) for direct pool swaps
- For Router NG swaps, approve tokens to the Router NG contract
- The StableSwap-NG pool interface (plain and meta pools). Classic pools such as 3pool have their own shape: see `CurveThreePoolABI` below.
- 3pool (`threePool` in the addresses), a classic StableSwap pool. Its liquidity arrays are fixed-size, and its state-changing functions return nothing: read amounts as balance changes.
- From a Pot program, `@sauce/router` swaps at the pool directly: `curve(pool, tokenIn, tokenOut, amountIn, i, j, uint256Indices, minOut, recipient)`, with `uint256Indices` `false` for StableSwap and NG pools (`int128` indices) and `true` for CryptoSwap, approves the pool for exactly `amountIn` and calls the 4-argument `exchange` with `minOut` as `min_dy`, without decoding a return (3pool-era pools have none); the allowance ends at zero, and it returns the Pot's balance change, forwarded when the recipient is not the Pot. `tryCurve` catches a failed `exchange`, resets the approval and returns `0`. The `curveSwap` action is the same call. The Sauce Router's own Curve handler cannot trade a pool whose `exchange` returns nothing, nor a uint256-index pool

## Its names in a program

On Ethereum, `Curve` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's addressProvider, `0x0000000022D53366457F9d5E68Ec105046FC4383`.
  require(Curve.AddressProvider != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Ethereum](../chains/ethereum.md) | crvToken | `0xD533a949740bb3306d119CC777fa900bA034cd52` | `Curve.CrvToken` |
| [Ethereum](../chains/ethereum.md) | routerNG | `0x16C6521Dff6baB339122a0FE25a9116693265353` | `Curve.RouterNG` |
| [Ethereum](../chains/ethereum.md) | threePool | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` | `Curve.ThreePool` |
| [Optimism](../chains/optimism.md) | routerNG | `0x0DCDED3545D565bA3B19E683431381007245d983` | `Curve.RouterNG` |
| [Gnosis](../chains/gnosis.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Polygon](../chains/polygon.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Fantom](../chains/fantom.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Base](../chains/base.md) | routerNG | `0x4f37A9d177470499A2dD084621020b023fcffc1F` | `Curve.RouterNG` |
| [Arbitrum One](../chains/arbitrum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Arbitrum One](../chains/arbitrum.md) | routerNG | `0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D` | `Curve.RouterNG` |
| [Avalanche C-Chain](../chains/avalanche.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |

## ABI

### `CurveAddressProviderABI`

`import CurveAddressProviderABI from "./protocols/curve/CurveAddressProviderABI.json";` Speaks for: addressProvider.

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

`import CurveRouterNGABI from "./protocols/curve/CurveRouterNGABI.json";` Speaks for: routerNG.

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

### `CurveThreePoolABI`

`import CurveThreePoolABI from "./protocols/curve/CurveThreePoolABI.json";` Speaks for: threePool.

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

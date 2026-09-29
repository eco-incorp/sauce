# Aave V4

Hub-and-spoke lending. Liquidity sits in a Hub; users supply, borrow and repay through Spokes, and each Spoke addresses its assets by reserve id rather than by token address.

## Category

lending | Chains: Arc (5042)

## SauceScript Functions

### supply

```typescript
import { AaveV4SpokeABI as ISpoke } from "./abis";

function main(
  spokeAddress: Address,
  reserveId: Uint256,
  amount: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const spoke = ISpoke.at(spokeAddress);
  spoke.supply(reserveId, amount, onBehalfOf);
  return 1;
}
```

- `reserveId`: the Spoke's reserve id for the asset. Resolve it with `spoke.getReserveId(hub, hub.getAssetId(token))`
- The underlying token must be `approve`d to the Spoke first

`withdraw`, `borrow` and `repay` take the same `(reserveId, amount, onBehalfOf)` arguments.

## Deployed Addresses

| Chain | Contract    | Address                                      |
| ----- | ----------- | -------------------------------------------- |
| Arc   | Core Hub    | `0x17288dfc86205301064577b98B02b81017e6F79C` |
| Arc   | Main Spoke  | `0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d` |
| Arc   | Forex Spoke | `0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB` |

## ABI Reference

### AaveV4SpokeABI

- `supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `borrow(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `repay(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `setUsingAsCollateral(uint256 reserveId, bool usingAsCollateral, address onBehalfOf)`
- `getReserveId(address hub, uint256 assetId) returns (uint256)` (view)
- `getReserveCount() returns (uint256)` (view)
- `getUserSuppliedAssets(uint256 reserveId, address user) returns (uint256)` (view)
- `getUserTotalDebt(uint256 reserveId, address user) returns (uint256)` (view)

### AaveV4HubABI

- `getAssetId(address underlying) returns (uint256)` (view)
- `getAssetCount() returns (uint256)` (view)
- `getAssetLiquidity(uint256 assetId) returns (uint256)` (view)
- `isUnderlyingListed(address underlying) returns (bool)` (view)

## Notes

- Arc's market lists USDC, EURC, WETH and cirBTC. The Main Spoke carries all four; the Forex Spoke carries USDC and EURC
- Hub, Spokes and their implementations are upgradeable (EIP-1967) proxies
- Addresses come from bgd-labs/aave-address-book (`AaveV4Arc`)

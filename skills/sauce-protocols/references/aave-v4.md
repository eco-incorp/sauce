# Aave V4

Hub-and-spoke lending. Liquidity sits in a Hub; users supply, borrow and repay through Spokes, and each Spoke addresses its assets by reserve id rather than by token address.

## Category

lending | Chains and addresses: [registry/aave-v4.md](registry/aave-v4.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/aave-v4.md](registry/aave-v4.md).

## Notes

- Arc's market lists USDC, EURC, WETH and cirBTC. The Main Spoke carries all four; the Forex Spoke carries USDC and EURC
- A chain can carry several Hubs, and a Spoke draws on one or more of them: `getReserveId(hub, assetId)` needs the Hub the asset lives in. Base carries only an equities market (tokenized stocks and USDC) with no core hub
- Each chain also has a Treasury Spoke, which collects fees; it is not a market and is not registered
- Hub, Spokes and their implementations are upgradeable (EIP-1967) proxies
- Addresses come from bgd-labs/aave-address-book (`AaveV4Ethereum`, `AaveV4Base`, `AaveV4Avalanche`, `AaveV4Arc`)

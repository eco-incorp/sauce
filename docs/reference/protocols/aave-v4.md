<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V4 (`aave-v4`)

Hub-and-spoke lending. Liquidity sits in a Hub; users supply, borrow and repay through Spokes, and each Spoke addresses its assets by reserve id rather than by token address.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV4` on ethereum, arc, base, avalanche |
| Chains | ethereum, arc, base, avalanche |

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

## Notes

- Arc's market lists USDC, EURC, WETH and cirBTC. The Main Spoke carries all four; the Forex Spoke carries USDC and EURC
- A chain can carry several Hubs, and a Spoke draws on one or more of them: `getReserveId(hub, assetId)` needs the Hub the asset lives in. Base carries only an equities market (tokenized stocks and USDC) with no core hub
- Each chain also has a Treasury Spoke, which collects fees; it is not a market and is not registered
- Hub, Spokes and their implementations are upgradeable (EIP-1967) proxies
- Addresses come from bgd-labs/aave-address-book (`AaveV4Ethereum`, `AaveV4Base`, `AaveV4Avalanche`, `AaveV4Arc`)

## Its names in a program

On Ethereum, `AaveV4` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's bluechipSpoke, `0x973a023A77420ba610f06b3858aD991Df6d85A08`.
  require(AaveV4.BluechipSpoke != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | bluechipSpoke | `0x973a023A77420ba610f06b3858aD991Df6d85A08` | `AaveV4.BluechipSpoke` |
| [Ethereum](../chains/ethereum.md) | coreHub | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` | `AaveV4.CoreHub` |
| [Ethereum](../chains/ethereum.md) | ethenaCorrelatedSpoke | `0x58131E79531caB1d52301228d1f7b842F26B9649` | `AaveV4.EthenaCorrelatedSpoke` |
| [Ethereum](../chains/ethereum.md) | ethenaEcosystemSpoke | `0xba1B3D55D249692b669A164024A838309B7508AF` | `AaveV4.EthenaEcosystemSpoke` |
| [Ethereum](../chains/ethereum.md) | etherfiESpoke | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` | `AaveV4.EtherfiESpoke` |
| [Ethereum](../chains/ethereum.md) | forexSpoke | `0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1` | `AaveV4.ForexSpoke` |
| [Ethereum](../chains/ethereum.md) | globalDollarHub | `0x62d63197660c080236193CA60b70E49A08E90368` | `AaveV4.GlobalDollarHub` |
| [Ethereum](../chains/ethereum.md) | goldSpoke | `0x65407b940966954b23dfA3caA5C0702bB42984DC` | `AaveV4.GoldSpoke` |
| [Ethereum](../chains/ethereum.md) | kelpESpoke | `0x3131FE68C4722e726fe6B2819ED68e514395B9a4` | `AaveV4.KelpESpoke` |
| [Ethereum](../chains/ethereum.md) | lidoESpoke | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` | `AaveV4.LidoESpoke` |
| [Ethereum](../chains/ethereum.md) | lombardBtcSpoke | `0x7EC68b5695e803e98a21a9A05d744F28b0a7753D` | `AaveV4.LombardBtcSpoke` |
| [Ethereum](../chains/ethereum.md) | mainSpoke | `0x94e7A5dCbE816e498b89aB752661904E2F56c485` | `AaveV4.MainSpoke` |
| [Ethereum](../chains/ethereum.md) | paxgGoldSpoke | `0xAD75cE6354f87F3135cE10621d385d8D1e2562C2` | `AaveV4.PaxgGoldSpoke` |
| [Ethereum](../chains/ethereum.md) | plusHub | `0x06002e9c4412CB7814a791eA3666D905871E536A` | `AaveV4.PlusHub` |
| [Ethereum](../chains/ethereum.md) | primeHub | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` | `AaveV4.PrimeHub` |
| [Ethereum](../chains/ethereum.md) | usdgMapleESpoke | `0x774b9655413c34809c1f1b16b654465A89EBE989` | `AaveV4.UsdgMapleESpoke` |
| [Ethereum](../chains/ethereum.md) | usdgPendleSpoke | `0x956d8e0A89cfa3744428C4641b5a53B56167a7f9` | `AaveV4.UsdgPendleSpoke` |
| [Arc](../chains/arc.md) | coreHub | `0x17288dfc86205301064577b98B02b81017e6F79C` | `AaveV4.CoreHub` |
| [Arc](../chains/arc.md) | forexSpoke | `0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB` | `AaveV4.ForexSpoke` |
| [Arc](../chains/arc.md) | mainSpoke | `0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d` | `AaveV4.MainSpoke` |
| [Base](../chains/base.md) | equitiesHub | `0xa4d5947Eb727A052bae69C593FfC84247EC9864E` | `AaveV4.EquitiesHub` |
| [Base](../chains/base.md) | mag7Spoke | `0x17905Db0e4A3514467539956c084180616AE7B8D` | `AaveV4.Mag7Spoke` |
| [Avalanche C-Chain](../chains/avalanche.md) | avaxCorrelatedSpoke | `0x3b517594277c67307CF2d7CBE6FE1D4399B68c41` | `AaveV4.AvaxCorrelatedSpoke` |
| [Avalanche C-Chain](../chains/avalanche.md) | coreHub | `0xd07369fAE4A5BB13c9Ce446B052c7867B1AbDf6e` | `AaveV4.CoreHub` |
| [Avalanche C-Chain](../chains/avalanche.md) | forexSpoke | `0x6a37776B5E026dBdF043b4F933c323C84DD1B514` | `AaveV4.ForexSpoke` |
| [Avalanche C-Chain](../chains/avalanche.md) | mainSpoke | `0x435272CefF93a1E657E8ABfdf0A13e95900A3a56` | `AaveV4.MainSpoke` |

## ABI

### `AaveV4HubABI`

`import AaveV4HubABI from "./protocols/aave-v4/AaveV4HubABI.json";` Speaks for: coreHub, plusHub, primeHub, globalDollarHub, equitiesHub.

- `getAssetId(address underlying) view returns (uint256)`
- `getAssetCount() view returns (uint256)`
- `getAssetLiquidity(uint256 assetId) view returns (uint256)`
- `isUnderlyingListed(address underlying) view returns (bool)`

### `AaveV4SpokeABI`

`import AaveV4SpokeABI from "./protocols/aave-v4/AaveV4SpokeABI.json";` Speaks for: mainSpoke, forexSpoke, bluechipSpoke, ethenaCorrelatedSpoke, ethenaEcosystemSpoke, goldSpoke, paxgGoldSpoke, lombardBtcSpoke, usdgPendleSpoke, etherfiESpoke, kelpESpoke, lidoESpoke, usdgMapleESpoke, mag7Spoke, avaxCorrelatedSpoke.

- `supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `borrow(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `repay(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `setUsingAsCollateral(uint256 reserveId, bool usingAsCollateral, address onBehalfOf)`
- `getReserveId(address hub, uint256 assetId) view returns (uint256)`
- `getReserveCount() view returns (uint256)`
- `getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)`
- `getUserTotalDebt(uint256 reserveId, address user) view returns (uint256)`

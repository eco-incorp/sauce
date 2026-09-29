# Aave V4

Hub-and-spoke lending. Liquidity sits in a Hub; users supply, borrow and repay through Spokes, and each Spoke addresses its assets by reserve id rather than by token address.

## Category

lending | Chains: Ethereum (1), Base (8453), Avalanche (43114), Arc (5042)

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

| Chain     | Contract                | Address                                      |
| --------- | ----------------------- | -------------------------------------------- |
| Ethereum  | Core Hub                | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` |
| Ethereum  | Plus Hub                | `0x06002e9c4412CB7814a791eA3666D905871E536A` |
| Ethereum  | Prime Hub               | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` |
| Ethereum  | Global Dollar Hub       | `0x62d63197660c080236193CA60b70E49A08E90368` |
| Ethereum  | Main Spoke              | `0x94e7A5dCbE816e498b89aB752661904E2F56c485` |
| Ethereum  | Forex Spoke             | `0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1` |
| Ethereum  | Bluechip Spoke          | `0x973a023A77420ba610f06b3858aD991Df6d85A08` |
| Ethereum  | Ethena Correlated Spoke | `0x58131E79531caB1d52301228d1f7b842F26B9649` |
| Ethereum  | Ethena Ecosystem Spoke  | `0xba1B3D55D249692b669A164024A838309B7508AF` |
| Ethereum  | Gold Spoke              | `0x65407b940966954b23dfA3caA5C0702bB42984DC` |
| Ethereum  | PAXG Gold Spoke         | `0xAD75cE6354f87F3135cE10621d385d8D1e2562C2` |
| Ethereum  | Lombard BTC Spoke       | `0x7EC68b5695e803e98a21a9A05d744F28b0a7753D` |
| Ethereum  | USDG Pendle Spoke       | `0x956d8e0A89cfa3744428C4641b5a53B56167a7f9` |
| Ethereum  | ether.fi E-Spoke        | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` |
| Ethereum  | Kelp E-Spoke            | `0x3131FE68C4722e726fe6B2819ED68e514395B9a4` |
| Ethereum  | Lido E-Spoke            | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` |
| Ethereum  | USDG Maple E-Spoke      | `0x774b9655413c34809c1f1b16b654465A89EBE989` |
| Base      | Equities Hub            | `0xa4d5947Eb727A052bae69C593FfC84247EC9864E` |
| Base      | Mag7 Spoke              | `0x17905Db0e4A3514467539956c084180616AE7B8D` |
| Avalanche | Core Hub                | `0xd07369fAE4A5BB13c9Ce446B052c7867B1AbDf6e` |
| Avalanche | Main Spoke              | `0x435272CefF93a1E657E8ABfdf0A13e95900A3a56` |
| Avalanche | Forex Spoke             | `0x6a37776B5E026dBdF043b4F933c323C84DD1B514` |
| Avalanche | AVAX Correlated Spoke   | `0x3b517594277c67307CF2d7CBE6FE1D4399B68c41` |
| Arc       | Core Hub                | `0x17288dfc86205301064577b98B02b81017e6F79C` |
| Arc       | Main Spoke              | `0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d` |
| Arc       | Forex Spoke             | `0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB` |

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
- A chain can carry several Hubs, and a Spoke draws on one or more of them: `getReserveId(hub, assetId)` needs the Hub the asset lives in. Base carries only an equities market (tokenized stocks and USDC) with no core hub
- Each chain also has a Treasury Spoke, which collects fees; it is not a market and is not registered
- Hub, Spokes and their implementations are upgradeable (EIP-1967) proxies
- Addresses come from bgd-labs/aave-address-book (`AaveV4Ethereum`, `AaveV4Base`, `AaveV4Avalanche`, `AaveV4Arc`)

<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V4 (`aave-v4`)

Hub-and-spoke lending. Liquidity sits in a Hub; users supply, borrow and repay through Spokes, each addressing its assets by reserve id.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, arc, base, avalanche |
| Document | [aave-v4.md](../aave-v4.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's bluechipSpoke):

```sauce chain=ethereum
import AaveV4SpokeABI from "./protocols/aave-v4/AaveV4SpokeABI.json";

const BLUECHIP_SPOKE = 0x973a023A77420ba610f06b3858aD991Df6d85A08n;

function main() {
  const bound = AaveV4SpokeABI.at(BLUECHIP_SPOKE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bluechipSpoke | `0x973a023A77420ba610f06b3858aD991Df6d85A08` | `AaveV4SpokeABI.at(0x973a023A77420ba610f06b3858aD991Df6d85A08n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coreHub | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` | `AaveV4HubABI.at(0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethenaCorrelatedSpoke | `0x58131E79531caB1d52301228d1f7b842F26B9649` | `AaveV4SpokeABI.at(0x58131E79531caB1d52301228d1f7b842F26B9649n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethenaEcosystemSpoke | `0xba1B3D55D249692b669A164024A838309B7508AF` | `AaveV4SpokeABI.at(0xba1B3D55D249692b669A164024A838309B7508AFn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | etherfiESpoke | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` | `AaveV4SpokeABI.at(0xbF10BDfE177dE0336aFD7fcCF80A904E15386219n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | forexSpoke | `0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1` | `AaveV4SpokeABI.at(0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | globalDollarHub | `0x62d63197660c080236193CA60b70E49A08E90368` | `AaveV4HubABI.at(0x62d63197660c080236193CA60b70E49A08E90368n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | goldSpoke | `0x65407b940966954b23dfA3caA5C0702bB42984DC` | `AaveV4SpokeABI.at(0x65407b940966954b23dfA3caA5C0702bB42984DCn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | kelpESpoke | `0x3131FE68C4722e726fe6B2819ED68e514395B9a4` | `AaveV4SpokeABI.at(0x3131FE68C4722e726fe6B2819ED68e514395B9a4n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lidoESpoke | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` | `AaveV4SpokeABI.at(0xe1900480ac69f0B296841Cd01cC37546d92F35Cdn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lombardBtcSpoke | `0x7EC68b5695e803e98a21a9A05d744F28b0a7753D` | `AaveV4SpokeABI.at(0x7EC68b5695e803e98a21a9A05d744F28b0a7753Dn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | mainSpoke | `0x94e7A5dCbE816e498b89aB752661904E2F56c485` | `AaveV4SpokeABI.at(0x94e7A5dCbE816e498b89aB752661904E2F56c485n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | paxgGoldSpoke | `0xAD75cE6354f87F3135cE10621d385d8D1e2562C2` | `AaveV4SpokeABI.at(0xAD75cE6354f87F3135cE10621d385d8D1e2562C2n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | plusHub | `0x06002e9c4412CB7814a791eA3666D905871E536A` | `AaveV4HubABI.at(0x06002e9c4412CB7814a791eA3666D905871E536An)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | primeHub | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` | `AaveV4HubABI.at(0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usdgMapleESpoke | `0x774b9655413c34809c1f1b16b654465A89EBE989` | `AaveV4SpokeABI.at(0x774b9655413c34809c1f1b16b654465A89EBE989n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usdgPendleSpoke | `0x956d8e0A89cfa3744428C4641b5a53B56167a7f9` | `AaveV4SpokeABI.at(0x956d8e0A89cfa3744428C4641b5a53B56167a7f9n)` |
| [Arc](../../../sauce-chains/references/arc.md) | coreHub | `0x17288dfc86205301064577b98B02b81017e6F79C` | `AaveV4HubABI.at(0x17288dfc86205301064577b98B02b81017e6F79Cn)` |
| [Arc](../../../sauce-chains/references/arc.md) | forexSpoke | `0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB` | `AaveV4SpokeABI.at(0x4164EBCAF74670aa74C8D4F59de6157c0780F1bBn)` |
| [Arc](../../../sauce-chains/references/arc.md) | mainSpoke | `0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d` | `AaveV4SpokeABI.at(0xB843bdC3a87A05E77E07Df9FE48928b3A34b134dn)` |
| [Base](../../../sauce-chains/references/base.md) | equitiesHub | `0xa4d5947Eb727A052bae69C593FfC84247EC9864E` | `AaveV4HubABI.at(0xa4d5947Eb727A052bae69C593FfC84247EC9864En)` |
| [Base](../../../sauce-chains/references/base.md) | mag7Spoke | `0x17905Db0e4A3514467539956c084180616AE7B8D` | `AaveV4SpokeABI.at(0x17905Db0e4A3514467539956c084180616AE7B8Dn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | avaxCorrelatedSpoke | `0x3b517594277c67307CF2d7CBE6FE1D4399B68c41` | `AaveV4SpokeABI.at(0x3b517594277c67307CF2d7CBE6FE1D4399B68c41n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | coreHub | `0xd07369fAE4A5BB13c9Ce446B052c7867B1AbDf6e` | `AaveV4HubABI.at(0xd07369fAE4A5BB13c9Ce446B052c7867B1AbDf6en)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | forexSpoke | `0x6a37776B5E026dBdF043b4F933c323C84DD1B514` | `AaveV4SpokeABI.at(0x6a37776B5E026dBdF043b4F933c323C84DD1B514n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | mainSpoke | `0x435272CefF93a1E657E8ABfdf0A13e95900A3a56` | `AaveV4SpokeABI.at(0x435272CefF93a1E657E8ABfdf0A13e95900A3a56n)` |

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

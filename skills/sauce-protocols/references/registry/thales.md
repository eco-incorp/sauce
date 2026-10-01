<!-- Generated from the SDK's registries. Do not edit. -->

# Thales (`thales`)

Positional markets protocol built on Synthetix offering binary options, speed markets, and sports markets on Optimism.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | none: import its ABI |
| Chains | optimism |
| Document | [thales.md](../thales.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Optimism's speedMarketsAMM):

```sauce chain=optimism
import SpeedMarketsAMMABI from "./protocols/thales/SpeedMarketsAMMABI.json";

const SPEED_MARKETS_AMM = 0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001n;

function main() {
  const bound = SpeedMarketsAMMABI.at(SPEED_MARKETS_AMM);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../../../sauce-chains/references/optimism.md) | speedMarketsAMM | `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001` | `SpeedMarketsAMMABI.at(0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | thalesAMM | `0x278B5A44397c9D8E52743fEdec263c4760dc1A1A` | `ThalesAMMABI.at(0x278B5A44397c9D8E52743fEdec263c4760dc1A1An)` |

## ABI

### `PositionalMarketABI`

`import PositionalMarketABI from "./protocols/thales/PositionalMarketABI.json";`

- `exerciseOptions() returns (uint256)`

### `SpeedMarketsAMMABI`

`import SpeedMarketsAMMABI from "./protocols/thales/SpeedMarketsAMMABI.json";` Speaks for: speedMarketsAMM.

- `createNewMarket((address user, bytes32 asset, uint64 strikeTime, uint64 delta, int64 strikePrice, uint64 strikePricePublishTime, uint8 oracleSource, uint8 direction, address collateral, uint256 collateralAmount, address referrer, uint256 skewImpact) params) returns (address marketAddress)`

### `ThalesAMMABI`

`import ThalesAMMABI from "./protocols/thales/ThalesAMMABI.json";` Speaks for: thalesAMM.

- `buyFromAMM(address market, uint8 position, uint256 amount, uint256 expectedPayout, uint256 additionalSlippage) returns (uint256)`

<!-- Generated from the SDK's registries. Do not edit. -->

# Thales (`thales`)

Positional markets protocol built on Synthetix offering binary options, speed markets, and sports markets on Optimism.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Thales` on optimism |
| Chains | optimism |
| Document | [thales.md](../thales.md): what it is for, how to choose it, its pitfalls |

## In a program

On Optimism, `Thales` is a namespace: its contracts need no import.

```sauce chain=optimism
function main() {
  // Optimism's speedMarketsAMM, `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001`.
  require(Thales.SpeedMarketsAMM != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../../../sauce-chains/references/optimism.md) | speedMarketsAMM | `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001` | `Thales.SpeedMarketsAMM` |
| [Optimism](../../../sauce-chains/references/optimism.md) | thalesAMM | `0x278B5A44397c9D8E52743fEdec263c4760dc1A1A` | `Thales.ThalesAMM` |

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

<!-- Generated from the SDK's registries. Do not edit. -->

# Reflexer (`reflexer`)

Non-pegged stablecoin protocol issuing RAI. Uses a PID controller to dampen RAI price volatility against ETH collateral.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [reflexer.md](../reflexer.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's coinJoin):

```sauce chain=ethereum
import CoinJoinABI from "./protocols/reflexer/CoinJoinABI.json";

const COIN_JOIN = 0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45n;

function main() {
  const bound = CoinJoinABI.at(COIN_JOIN);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coinJoin | `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45` | `CoinJoinABI.at(0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethJoin | `0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3a` | `ETHJoinABI.at(0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3an)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rai | `0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | safeEngine | `0xCC88a9d330da1133Df3A7bD823B95e52511A6962` | `SAFEEngineABI.at(0xCC88a9d330da1133Df3A7bD823B95e52511A6962n)` |

## ABI

### `CoinJoinABI`

`import CoinJoinABI from "./protocols/reflexer/CoinJoinABI.json";` Speaks for: coinJoin.

- `join(address account, uint256 wad)`
- `exit(address account, uint256 wad)`

### `ETHJoinABI`

`import ETHJoinABI from "./protocols/reflexer/ETHJoinABI.json";` Speaks for: ethJoin.

- `join(address account, uint256 wad)`
- `exit(address account, uint256 wad)`

### `SAFEEngineABI`

`import SAFEEngineABI from "./protocols/reflexer/SAFEEngineABI.json";` Speaks for: safeEngine.

- `modifySAFECollateralization(bytes32 collateralType, address safe, address collateralSource, address debtDestination, int256 deltaCollateral, int256 deltaDebt)`
- `safes(bytes32 collateralType, address safe) view returns (uint256 lockedCollateral, uint256 generatedDebt)`

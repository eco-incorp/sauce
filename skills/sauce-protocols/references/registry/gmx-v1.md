<!-- Generated from the SDK's registries. Do not edit. -->

# GMX V1 (`gmx-v1`)

Decentralized perpetual exchange with multi-asset liquidity pool (GLP). Supports leverage trading with low swap fees and zero price impact trades.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum, avalanche |
| Document | [gmx-v1.md](../gmx-v1.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arbitrum One's positionRouter):

```sauce chain=arbitrum
import PositionRouterABI from "./protocols/gmx-v1/PositionRouterABI.json";

const POSITION_ROUTER = 0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868n;

function main() {
  const bound = PositionRouterABI.at(POSITION_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | glp | `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | positionRouter | `0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868` | `PositionRouterABI.at(0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064` | `RouterABI.at(0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | vault | `0x489ee077994B6658eAfA855C308275EAd8097C4A` | `VaultABI.at(0x489ee077994B6658eAfA855C308275EAd8097C4An)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | router | `0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8` | `RouterABI.at(0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | vault | `0x9ab2De34A33fB459b538c43f251eB825645e8595` | `VaultABI.at(0x9ab2De34A33fB459b538c43f251eB825645e8595n)` |

## ABI

### `PositionRouterABI`

`import PositionRouterABI from "./protocols/gmx-v1/PositionRouterABI.json";` Speaks for: positionRouter.

- `createIncreasePosition(address[] _path, address _indexToken, uint256 _amountIn, uint256 _minOut, uint256 _sizeDelta, bool _isLong, uint256 _acceptablePrice, uint256 _executionFee, bytes32 _referralCode, address _callbackTarget) payable returns (bytes32 requestKey)`
- `createDecreasePosition(address[] _path, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _acceptablePrice, uint256 _minOut, uint256 _executionFee, bool _withdrawETH, address _callbackTarget) payable returns (bytes32 requestKey)`

### `RouterABI`

`import RouterABI from "./protocols/gmx-v1/RouterABI.json";` Speaks for: router.

- `approvePlugin(address _plugin)`
- `swap(address[] _path, uint256 _amountIn, uint256 _minOut, address _receiver)`

### `VaultABI`

`import VaultABI from "./protocols/gmx-v1/VaultABI.json";` Speaks for: vault.

- `swap(address _tokenIn, address _tokenOut, address _receiver) returns (uint256)`
- `increasePosition(address _account, address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong)`
- `decreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver) returns (uint256)`

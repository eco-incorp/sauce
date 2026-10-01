<!-- Generated from the SDK's registries. Do not edit. -->

# DODO (`dodo`)

Proactive market maker (PMM) DEX with capital-efficient liquidity provision. Features single-token LP, customizable price curves, and smart routing.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, bsc |
| Document | [dodo.md](../dodo.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's dodoV2Proxy):

```sauce chain=ethereum
import DODOV2ProxyABI from "./protocols/dodo/DODOV2ProxyABI.json";

const DODO_V2_PROXY = 0xa356867fDCeA8e71AEaf87805808803806231FDcn;

function main() {
  const bound = DODOV2ProxyABI.at(DODO_V2_PROXY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | dodoV2Proxy | `0xa356867fDCeA8e71AEaf87805808803806231FDc` | `DODOV2ProxyABI.at(0xa356867fDCeA8e71AEaf87805808803806231FDcn)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | dodoV2Proxy | `0x8F8Dd7DB1bDA5eD3da8C9dAf3bFA471c12d58486` | `DODOV2ProxyABI.at(0x8F8Dd7DB1bDA5eD3da8C9dAf3bFA471c12d58486n)` |

## ABI

### `DODOV2ProxyABI`

`import DODOV2ProxyABI from "./protocols/dodo/DODOV2ProxyABI.json";` Speaks for: dodoV2Proxy.

- `dodoSwapV2TokenToToken(address fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) returns (uint256 returnAmount)`

<!-- Generated from the SDK's registries. Do not edit. -->

# Across (`across`)

Optimistic cross-chain bridge powered by UMA's optimistic oracle. Uses relayers for fast fills and canonical bridges for settlement.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Across` on ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| Chains | ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| Document | [across.md](../across.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Across` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's hubPool, `0xc186fA914353c44b2E33eBE05f21846F1048bEda`.
  require(Across.HubPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | hubPool | `0xc186fA914353c44b2E33eBE05f21846F1048bEda` | `Across.HubPool` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | spokePool | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `Across.SpokePool` |
| [Optimism](../../../sauce-chains/references/optimism.md) | spokePool | `0x6f26Bf09B1C792e3228e5467807a900A503c0281` | `Across.SpokePool` |
| [Polygon](../../../sauce-chains/references/polygon.md) | spokePool | `0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096` | `Across.SpokePool` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | spokePool | `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF` | `Across.SpokePool` |
| [Arc](../../../sauce-chains/references/arc.md) | spokePool | `0x9b4A302A548c7e313c2b74C461db7b84d3074A84` | `Across.SpokePool` |
| [Base](../../../sauce-chains/references/base.md) | spokePool | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | `Across.SpokePool` |
| [Mode](../../../sauce-chains/references/mode.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | spokePool | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` | `Across.SpokePool` |
| [Linea](../../../sauce-chains/references/linea.md) | spokePool | `0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75` | `Across.SpokePool` |
| [Blast](../../../sauce-chains/references/blast.md) | spokePool | `0x2D509190Ed0172ba588407D4c2df918F955Cc6E1` | `Across.SpokePool` |
| [Scroll](../../../sauce-chains/references/scroll.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `AcrossHubPoolABI`

`import AcrossHubPoolABI from "./protocols/across/AcrossHubPoolABI.json";` Speaks for: hubPool.

- `liquidityUtilizationCurrent(address l1Token) returns (uint256)`
- `pooledTokens(address l1Token) view returns (address lpToken, bool isEnabled, uint32 lastLpFeeUpdate, int256 utilizedReserves, uint256 liquidReserves, uint256 undistributedLpFees)`: `lpToken` is a token

### `AcrossSpokePoolABI`

`import AcrossSpokePoolABI from "./protocols/across/AcrossSpokePoolABI.json";` Speaks for: spokePool.

- `depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable`
- `deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable`

<!-- Generated from the SDK's registries. Do not edit. -->

# Across (`across`)

Optimistic cross-chain bridge powered by UMA's optimistic oracle. Uses relayers for fast fills and canonical bridges for settlement.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Across` on ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| Chains | ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### bridge

Deposit tokens into the SpokePool for a cross-chain transfer, through `depositV3`.

```typescript
import { AcrossSpokePoolABI as ISpokePool } from "./abis";

function main(
  spokePoolAddress: Address,
  token: Address,
  outputToken: Address,
  amount: Uint256,
  outputAmount: Uint256,
  destinationChainId: Uint256,
  recipient: Address,
  quoteTimestamp: Uint256,
  fillDeadline: Uint256,
): Uint256 {
  const spokePool = ISpokePool.at(spokePoolAddress);
  spokePool.depositV3(
    ctx.msgSender(),
    recipient,
    token,
    outputToken,
    amount,
    outputAmount,
    destinationChainId,
    0x0000000000000000000000000000000000000000,
    quoteTimestamp,
    fillDeadline,
    0,
    "",
  );
  return 1;
}
```

- `token` / `outputToken`: ERC-20 to bridge, and the token the recipient receives on the destination
- `outputAmount`: amount the relayer delivers (input minus the quoted fees)
- `quoteTimestamp`: the quote's timestamp; the SpokePool rejects one outside its `depositQuoteTimeBuffer`
- `fillDeadline`: unix time after which the deposit can no longer be filled
- `recipient`: Address to receive tokens on destination chain
- Requires ERC-20 approval to the SpokePool

## Notes

- Fast fills: relayers fill deposits on destination within minutes, then claim reimbursement via optimistic oracle
- Finality: deposit confirmation on source chain, fill within 1-10 minutes typically
- Requires ERC-20 approval to the SpokePool address on source chain
- HubPool on Ethereum only -- SpokePools on all supported L2s
- TVL: $500M+. Audited
- On Arc (5042) the SpokePool's `wrappedNativeToken()` is the zero address, so deposit ERC-20s (USDC is `0x3600000000000000000000000000000000000000`), not native value

## Its names in a program

On Ethereum, `Across` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's hubPool, `0xc186fA914353c44b2E33eBE05f21846F1048bEda`.
  require(Across.HubPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | hubPool | `0xc186fA914353c44b2E33eBE05f21846F1048bEda` | `Across.HubPool` |
| [Ethereum](../chains/ethereum.md) | spokePool | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `Across.SpokePool` |
| [Optimism](../chains/optimism.md) | spokePool | `0x6f26Bf09B1C792e3228e5467807a900A503c0281` | `Across.SpokePool` |
| [Polygon](../chains/polygon.md) | spokePool | `0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096` | `Across.SpokePool` |
| [zkSync Era](../chains/zksync.md) | spokePool | `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF` | `Across.SpokePool` |
| [Arc](../chains/arc.md) | spokePool | `0x9b4A302A548c7e313c2b74C461db7b84d3074A84` | `Across.SpokePool` |
| [Base](../chains/base.md) | spokePool | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | `Across.SpokePool` |
| [Mode](../chains/mode.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool` |
| [Arbitrum One](../chains/arbitrum.md) | spokePool | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` | `Across.SpokePool` |
| [Linea](../chains/linea.md) | spokePool | `0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75` | `Across.SpokePool` |
| [Blast](../chains/blast.md) | spokePool | `0x2D509190Ed0172ba588407D4c2df918F955Cc6E1` | `Across.SpokePool` |
| [Scroll](../chains/scroll.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool` |

## ABI

### `AcrossHubPoolABI`

`import AcrossHubPoolABI from "./protocols/across/AcrossHubPoolABI.json";` Speaks for: hubPool.

- `liquidityUtilizationCurrent(address l1Token) returns (uint256)`
- `pooledTokens(address l1Token) view returns (address lpToken, bool isEnabled, uint32 lastLpFeeUpdate, int256 utilizedReserves, uint256 liquidReserves, uint256 undistributedLpFees)`

### `AcrossSpokePoolABI`

`import AcrossSpokePoolABI from "./protocols/across/AcrossSpokePoolABI.json";` Speaks for: spokePool.

- `depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable`
- `deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable`

<!-- Generated from the SDK's registries. Do not edit. -->

# Polygon Native Bridge (`polygon-bridge`)

Official Polygon PoS bridge via RootChainManager. Supports ETH, ERC-20, ERC-721, and ERC-1155 deposits with checkpoint-based withdrawals.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `PolygonBridge` on ethereum, polygon |
| Chains | ethereum, polygon |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### depositETH

Deposit ETH from Ethereum to Polygon (received as WETH on Polygon).

```typescript
import { PolygonRootChainManagerABI as IRootChainManager } from "./abis";

function main(rootChainManagerAddress: Address, recipient: Address): Uint256 {
  const manager = IRootChainManager.at(rootChainManagerAddress);
  manager.depositEtherFor(recipient);
  return 1;
}
```

- `recipient`: Address to receive WETH on Polygon
- ETH amount is sent as `msg.value`
- ETH is received as WETH on Polygon (Polygon uses WMATIC as native token)

### depositERC20

Deposit ERC-20 tokens from Ethereum to Polygon.

```typescript
import { PolygonRootChainManagerABI as IRootChainManager } from "./abis";

function main(
  rootChainManagerAddress: Address,
  recipient: Address,
  rootToken: Address,
  depositData: bytes,
): Uint256 {
  const manager = IRootChainManager.at(rootChainManagerAddress);
  manager.depositFor(recipient, rootToken, depositData);
  return 1;
}
```

- `recipient`: Address to receive tokens on Polygon
- `rootToken`: L1 (Ethereum) ERC-20 token address
- `depositData`: ABI-encoded amount as bytes. Encode via `abi.encode(uint256 amount)`
- Requires ERC-20 approval to the **ERC20Predicate** contract (NOT the RootChainManager)

## Notes

- **L1 to L2** deposits via RootChainManager. **L2 to L1** withdrawals require burning tokens on Polygon, then calling `exit()` on L1 with the burn proof
- **Approval target for ERC-20**: approve tokens to the **ERC20Predicate** (`0x40ec5B...`), NOT the RootChainManager
- `depositData` for ERC-20 is `abi.encode(amount)` -- the amount encoded as a 32-byte uint256
- ETH deposits are received as WETH on Polygon (Polygon's native token is MATIC)
- L1 to L2 deposits finalize after the next Polygon checkpoint (~30-60 minutes)
- L2 to L1 withdrawals require checkpoint inclusion + `exit()` call on Ethereum (~3 hours for checkpoint)
- Supports ERC-20, ERC-721, and ERC-1155 via different predicate contracts
- Canonical bridge -- no third-party risk, secured by the Polygon PoS validator set
- Audited

## Its names in a program

On Ethereum, `PolygonBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's erc20Predicate, `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf`.
  require(PolygonBridge.Erc20Predicate != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | erc20Predicate | `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf` | `PolygonBridge.Erc20Predicate` |
| [Ethereum](../chains/ethereum.md) | etherPredicate | `0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30` | `PolygonBridge.EtherPredicate` |
| [Ethereum](../chains/ethereum.md) | rootChainManager | `0xA0c68C638235ee32657e8f720a23ceC1bFc77C77` | `PolygonBridge.RootChainManager` |
| [Polygon](../chains/polygon.md) | childChainManager | `0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa` | `PolygonBridge.ChildChainManager` |

## ABI

### `PolygonRootChainManagerABI`

`import PolygonRootChainManagerABI from "./protocols/polygon-bridge/PolygonRootChainManagerABI.json";` Speaks for: rootChainManager.

- `depositEtherFor(address user) payable`
- `depositFor(address user, address rootToken, bytes depositData)`
- `exit(bytes inputData)`

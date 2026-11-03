<!-- Generated from the SDK's registries. Do not edit. -->

# Polygon Native Bridge (`polygon-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Polygon Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official Polygon PoS bridge via RootChainManager. Supports ETH, ERC-20, ERC-721, and ERC-1155 deposits with checkpoint-based withdrawals.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `PolygonBridge` on ethereum, polygon |
| Chains | ethereum, polygon |

## Notes

- **L1 to L2** deposits via RootChainManager. **L2 to L1** withdrawals require burning tokens on Polygon, then calling `exit()` on L1 with the burn proof
- **Approval target for ERC-20**: approve tokens to the **ERC20Predicate** (`0x40ec5B...`), NOT the RootChainManager
- `depositData` for ERC-20 is `abi.encode(amount)` -- the amount encoded as a 32-byte uint256
- ETH deposits are received as WETH on Polygon (Polygon's native token is MATIC)
- L1 to L2 deposits finalize after the next Polygon checkpoint (~30-60 minutes)
- L2 to L1 withdrawals require checkpoint inclusion + `exit()` call on Ethereum (~3 hours for checkpoint)
- Supports ERC-20, ERC-721, and ERC-1155 via different predicate contracts
- Canonical bridge, secured by the Polygon PoS validator set
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

`import PolygonRootChainManagerABI from "./protocols/polygon-bridge/PolygonRootChainManagerABI.json";` Speaks for: rootChainManager. The import is the contract's full ABI across every deployment; call it through the `PolygonBridge` namespace to have a function a chain's deployment does not run refused.

- `checkpointManagerAddress() view returns (address)`
- `childChainManagerAddress() view returns (address)`
- `childToRootToken(address) view returns (address)`
- `cleanMapToken(address rootToken, address childToken)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `DEPOSIT() view returns (bytes32)`
- `depositEtherFor(address user) payable`
- `depositFor(address user, address rootToken, bytes depositData)`
- `ERC712_VERSION() view returns (string)`
- `ETHER_ADDRESS() view returns (address)`
- `executeMetaTransaction(address userAddress, bytes functionSignature, bytes32 sigR, bytes32 sigS, uint8 sigV) payable returns (bytes)`
- `exit(bytes inputData)`
- `getChainId() pure returns (uint256)`
- `getDomainSeperator() view returns (bytes32)`
- `getNonce(address user) view returns (uint256 nonce)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getRoleMember(bytes32 role, uint256 index) view returns (address)`
- `getRoleMemberCount(bytes32 role) view returns (uint256)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initialize(address _owner)`
- `initializeEIP712()`
- `isMigrated(address rootToken) view returns (bool)`
- `MAP_TOKEN() view returns (bytes32)`
- `MAPPER_ROLE() view returns (bytes32)`
- `mapToken(address rootToken, address childToken, bytes32 tokenType)`
- `migrateBridgeFunds(address rootToken, bytes data)`
- `MIGRATION_MANAGER_ROLE() view returns (bytes32)`
- `migrationStatus(address) view returns (bool isDepositDisabled, bool isExitDisabled, uint256 lastExitBlockNumber)`
- `processedExits(bytes32) view returns (bool)`
- `registerPredicate(bytes32 tokenType, address predicateAddress)`
- `remapToken(address rootToken, address childToken, bytes32 tokenType)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `rootToChildToken(address) view returns (address)`
- `setCheckpointManager(address newCheckpointManager)`
- `setChildChainManagerAddress(address newChildChainManager)`
- `setStateSender(address newStateSender)`
- `setupContractId()`
- `stateSenderAddress() view returns (address)`
- `tokenToType(address) view returns (bytes32)`
- `typeToPredicate(bytes32) view returns (address)`
- `updateTokenMigrationStatus(address rootToken, bool isDepositDisable, bool isExitDisabled, uint256 lastExitBlockNumber)`
- `USDT_ADDRESS() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

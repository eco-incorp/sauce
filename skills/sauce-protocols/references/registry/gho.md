<!-- Generated from the SDK's registries. Do not edit. -->

# GHO (`gho`)

Aave-native decentralized stablecoin minted against Aave V3 collateral. Multi-collateral, transparent, and governed by Aave DAO.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Gho` on ethereum |
| Chains | ethereum |
| Document | [gho.md](../gho.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Gho` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's gho, `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f`.
  require(Gho.Gho != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gho | `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f` | `Gho.Gho` |

## ABI

### `GhoTokenABI`

`import GhoTokenABI from "./protocols/gho/GhoTokenABI.json";` Speaks for: gho.

- `addFacilitator(address facilitatorAddress, string facilitatorLabel, uint128 bucketCapacity)`
- `allowance(address, address) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `BUCKET_MANAGER_ROLE() view returns (bytes32)`
- `burn(uint256 amount)`
- `decimals() view returns (uint8)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `FACILITATOR_MANAGER_ROLE() view returns (bytes32)`
- `getFacilitator(address facilitator) view returns ((uint128 bucketCapacity, uint128 bucketLevel, string label))`
- `getFacilitatorBucket(address facilitator) view returns (uint256, uint256)`
- `getFacilitatorsList() view returns (address[])`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `mint(address account, uint256 amount)`
- `name() view returns (string)`
- `nonces(address) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `removeFacilitator(address facilitatorAddress)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `setFacilitatorBucketCapacity(address facilitator, uint128 newCapacity)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`

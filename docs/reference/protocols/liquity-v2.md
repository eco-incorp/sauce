<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V2 (`liquity-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Liquity V2 is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | `Liquity`: `liquity-v1`, `liquity-v2` |
| Namespace | `LiquityV2` on ethereum |
| Chains | ethereum |

## What it offers

- **transfer**: Transfer BOLD tokens
- **approve**: Approve BOLD token spender

## Notes

- User-set interest rates - borrowers choose their own rate (higher rate = lower liquidation risk)
- Multi-collateral: ETH, wstETH, rETH, and other LSTs
- BOLD is fully redeemable 1:1 for collateral at any time
- Successor to Liquity V1 with improved capital efficiency

## Its names in a program

On Ethereum, `LiquityV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's bold, `0x6440f144b7e50D6a8439336510312d2F54beB01D`.
  require(LiquityV2.Bold != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | bold | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | `LiquityV2.Bold` |

## ABI

### `BoldTokenABI`

`import BoldTokenABI from "./protocols/liquity-v2/BoldTokenABI.json";` Speaks for: bold.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(address _account, uint256 _amount)`
- `collateralRegistryAddress() view returns (address)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `isOwner() view returns (bool)`
- `mint(address _account, uint256 _amount)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `owner() view returns (address)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `returnFromPool(address _poolAddress, address _receiver, uint256 _amount)`
- `sendToPool(address _sender, address _poolAddress, uint256 _amount)`
- `setBranchAddresses(address _troveManagerAddress, address _stabilityPoolAddress, address _borrowerOperationsAddress, address _activePoolAddress)`
- `setCollateralRegistry(address _collateralRegistryAddress)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address sender, address recipient, uint256 amount) returns (bool)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

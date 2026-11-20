<!-- Generated from the SDK's registries. Do not edit. -->

# Liquity V2 (`liquity-v2`)

Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | `Liquity`: `liquity-v1`, `liquity-v2` |
| Namespace | `LiquityV2` on ethereum |
| Chains | ethereum |
| Document | [liquity-v2.md](../liquity-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `LiquityV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's bold, `0x6440f144b7e50D6a8439336510312d2F54beB01D`.
  require(LiquityV2.Bold != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bold | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | `LiquityV2.Bold` |

## ABI

### `BoldTokenABI`

`import BoldTokenABI from "./protocols/liquity-v2/BoldTokenABI.json";` Speaks for: bold. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `LiquityV2` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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

Left out of this ABI, though its deployments declare them:

- `error InvalidShortString` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StringTooLong` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event EIP712DomainChanged` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

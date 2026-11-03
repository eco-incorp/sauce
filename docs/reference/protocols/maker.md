<!-- Generated from the SDK's registries. Do not edit. -->

# Maker (`maker`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Maker is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against them. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Decentralized credit protocol behind DAI and USDS stablecoins. Users deposit collateral into Vaults to mint/borrow DAI. Includes the DAI Savings Rate (DSR) via sDAI.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Maker` on ethereum |
| Chains | ethereum |

## What it offers

- **depositToSDAI**: Deposit DAI into Savings DAI vault (ERC-4626)
- **withdrawFromSDAI**: Withdraw DAI from sDAI vault by asset amount
- **redeemFromSDAI**: Redeem sDAI shares for DAI

## Notes

- TVL: $8B+. sDAI earns DSR yield (ERC-4626 compliant)
- DSR yield accrues automatically - sDAI appreciates against DAI over time
- Approve DAI to sDAI contract before depositing
- Pot is the internal DSR accumulator - chi() tracks the accumulated rate
- USDS is the rebranded DAI stablecoin

## Its names in a program

On Ethereum, `Maker` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's dai, `0x6B175474E89094C44Da98b954EedeAC495271d0F`.
  require(Maker.Dai != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | dai | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | `Maker.Dai` |
| [Ethereum](../chains/ethereum.md) | pot | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` | `Maker.Pot` |
| [Ethereum](../chains/ethereum.md) | sDAI | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` | `Maker.SDAI` |
| [Ethereum](../chains/ethereum.md) | usds | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` | `Maker.Usds` |
| [Ethereum](../chains/ethereum.md) | vat | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` | `Maker.Vat` |

## ABI

### `PotABI`

`import PotABI from "./protocols/maker/PotABI.json";` Speaks for: pot. The import is the contract's full ABI across every deployment; call it through the `Maker` namespace to have a function a chain's deployment does not run refused.

- `cage()`
- `chi() view returns (uint256)`
- `deny(address guy)`
- `drip() returns (uint256 tmp)`
- `dsr() view returns (uint256)`
- `exit(uint256 wad)`
- `file(bytes32 what, address addr)`
- `join(uint256 wad)`
- `live() view returns (uint256)`
- `pie(address) view returns (uint256)`
- `Pie() view returns (uint256)`
- `rely(address guy)`
- `rho() view returns (uint256)`
- `vat() view returns (address)`
- `vow() view returns (address)`
- `wards(address) view returns (uint256)`

Left out of this ABI, though its deployments declare them:

- `file` taking `(bytes32,uint256)`: an overload of file(bytes32,address), which takes as many arguments: a call picks its overload by argument count.

### `SavingsDaiABI`

`import SavingsDaiABI from "./protocols/maker/SavingsDaiABI.json";` Speaks for: sDAI. The import is the contract's full ABI across every deployment; call it through the `Maker` namespace to have a function a chain's deployment does not run refused.

- `allowance(address, address) view returns (uint256)`
- `approve(address spender, uint256 value) returns (bool)`
- `asset() view returns (address)`
- `balanceOf(address) view returns (uint256)`
- `convertToAssets(uint256 shares) view returns (uint256)`
- `convertToShares(uint256 assets) view returns (uint256)`
- `dai() view returns (address)`
- `daiJoin() view returns (address)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `deploymentChainId() view returns (uint256)`
- `deposit(uint256 assets, address receiver) returns (uint256 shares)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `maxDeposit(address) pure returns (uint256)`
- `maxMint(address) pure returns (uint256)`
- `maxRedeem(address owner) view returns (uint256)`
- `maxWithdraw(address owner) view returns (uint256)`
- `mint(uint256 shares, address receiver) returns (uint256 assets)`
- `name() view returns (string)`
- `nonces(address) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, bytes signature)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `pot() view returns (address)`
- `previewDeposit(uint256 assets) view returns (uint256)`
- `previewMint(uint256 shares) view returns (uint256)`
- `previewRedeem(uint256 shares) view returns (uint256)`
- `previewWithdraw(uint256 assets) view returns (uint256)`
- `redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)`
- `symbol() view returns (string)`
- `totalAssets() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 value) returns (bool)`
- `transferFrom(address from, address to, uint256 value) returns (bool)`
- `vat() view returns (address)`
- `version() view returns (string)`
- `withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

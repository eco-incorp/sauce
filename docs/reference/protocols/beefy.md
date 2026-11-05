<!-- Generated from the SDK's registries. Do not edit. -->

# Beefy Finance (`beefy`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Beefy Finance is a yield vault: deposits are put to work to earn interest. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Multi-chain yield optimizer. Auto-compounds rewards from LP tokens and other yield sources across many chains.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Beefy` on ethereum, optimism, bsc, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, arbitrum, avalanche |

## What it offers

- **deposit**: Deposit want tokens into Beefy vault
- **depositAll**: Deposit entire balance of want token
- **withdraw**: Withdraw by specifying share amount
- **withdrawAll**: Withdraw entire position

## Notes

- TVL: $300M+. Each vault has a unique address per strategy
- Approve want token to vault before depositing
- Use want() to discover which token a vault accepts
- getPricePerFullShare() returns the exchange rate between shares and want tokens
- Auto-compounds rewards - no manual claiming needed

## Its names in a program

On Ethereum, `Beefy` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's BIFI, `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1`.
  require(Beefy.BIFI != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | BIFI | `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1` | `Beefy.BIFI` |
| [Optimism](../chains/optimism.md) | BIFI | `0x4E720DD3Ac5CFe1e1fbDE4935f386Bb1C66F4642` | `Beefy.BIFI` |
| [BNB Chain](../chains/bsc.md) | BIFI | `0xCa3F508B8e4Dd382eE878A314789373D80A5190A` | `Beefy.BIFI` |
| [Arbitrum One](../chains/arbitrum.md) | BIFI | `0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE` | `Beefy.BIFI` |
| [Avalanche C-Chain](../chains/avalanche.md) | BIFI | `0xd6070ae98b8069de6B494332d1A1a81B6179D960` | `Beefy.BIFI` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `BeefyVaultABI`

`import BeefyVaultABI from "./protocols/beefy/BeefyVaultABI.json";`

- `allowance(address owner, address spender) view returns (uint256)`
- `approvalDelay() view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balance() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `deposit(uint256 _amount)`
- `depositAll()`
- `earn()`
- `getPricePerFullShare() view returns (uint256)`
- `inCaseTokensGetStuck(address _token)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(address _strategy, string _name, string _symbol, uint256 _approvalDelay)`
- `name() view returns (string)`
- `owner() view returns (address)`
- `proposeStrat(address _implementation)`
- `proxiableUUID() view returns (bytes32)`
- `renounceOwnership()`
- `stratCandidate() view returns (address implementation, uint256 proposedTime)`
- `strategy() view returns (address)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner)`
- `upgradeStrat()`
- `upgradeTo(address newImplementation)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `want() view returns (address)`: the address is a token
- `withdraw(uint256 _shares)`
- `withdrawAll()`

Not every contract reached through this interface runs every function listed: the contracts the registry checked it against do not all dispatch the same ones. A call to one the contract does not run does not run the function, and whether it reverts is up to that code.

Left out of this ABI by name, and called by their signature through the namespace:

- `Beefy.Vault(<address>)["available()"](…)`: `available() view returns (uint256)`; its name is an accessor's own property, so it is called by its signature.

Left out of this ABI, though its deployments declare them:

- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BeaconUpgraded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

<!-- Generated from the SDK's registries. Do not edit. -->

# Coinbase Wrapped Staked ETH (`cbeth`)

Coinbase's liquid staking token for Ethereum. cbETH represents staked ETH plus accrued staking rewards.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Cbeth` on ethereum, base |
| Chains | ethereum, base |
| Document | [cbeth.md](../cbeth.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Cbeth` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cbETH, `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704`.
  require(Cbeth.CbETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cbETH | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` | `Cbeth.CbETH`; not on this deployment: `bridge`, `BRIDGE`, `burn`, `initialize`, `l1Token`, `l2Bridge`, `REMOTE_TOKEN`, `remoteToken`, `supportsInterface` |
| [Base](../../../sauce-chains/references/base.md) | cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | `Cbeth.CbETH`; not on this deployment: `authorizationState`, `blacklist`, `blacklister`, `burn`, `CANCEL_AUTHORIZATION_TYPEHASH`, `cancelAuthorization`, `configureMinter`, `currency`, `DOMAIN_SEPARATOR`, `exchangeRate`, `initialize`, `initializeV2`, `initializeV2_1`, `isBlacklisted`, `isMinter`, `masterMinter`, `mint`, `minterAllowance`, `nonces`, `oracle`, `owner`, `pause`, `paused`, `pauser`, `permit`, `PERMIT_TYPEHASH`, `RECEIVE_WITH_AUTHORIZATION_TYPEHASH`, `receiveWithAuthorization`, `removeMinter`, `rescueERC20`, `rescuer`, `TRANSFER_WITH_AUTHORIZATION_TYPEHASH`, `transferOwnership`, `transferWithAuthorization`, `unBlacklist`, `unpause`, `updateBlacklister`, `updateExchangeRate`, `updateMasterMinter`, `updateOracle`, `updatePauser`, `updateRescuer` |

## ABI

### `CbETHABI`

`import CbETHABI from "./protocols/cbeth/CbETHABI.json";` Speaks for: cbETH. The import is the contract's full ABI across every deployment; call it through the `Cbeth` namespace to have a function a chain's deployment does not run refused.

- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `authorizationState(address authorizer, bytes32 nonce) view returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `blacklist(address _account)`
- `blacklister() view returns (address)`
- `bridge() view returns (address)`
- `BRIDGE() view returns (address)`
- `burn(uint256 _amount)`
- `burn(address _from, uint256 _amount)`
- `CANCEL_AUTHORIZATION_TYPEHASH() view returns (bytes32)`
- `cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)`
- `configureMinter(address minter, uint256 minterAllowedAmount) returns (bool)`
- `currency() view returns (string)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 decrement) returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `exchangeRate() view returns (uint256)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize(string _name, string _symbol)`
- `initialize(string tokenName, string tokenSymbol, string tokenCurrency, uint8 tokenDecimals, address newMasterMinter, address newPauser, address newBlacklister, address newOwner)`
- `initializeV2(string newName)`
- `initializeV2_1(address lostAndFound)`
- `isBlacklisted(address _account) view returns (bool)`
- `isMinter(address account) view returns (bool)`
- `l1Token() view returns (address)`
- `l2Bridge() view returns (address)`
- `masterMinter() view returns (address)`
- `mint(address to, uint256 amount) returns (bool)`
- `minterAllowance(address minter) view returns (uint256)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `oracle() view returns (address _oracle)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `pauser() view returns (address)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `RECEIVE_WITH_AUTHORIZATION_TYPEHASH() view returns (bytes32)`
- `receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)`
- `REMOTE_TOKEN() view returns (address)`
- `remoteToken() view returns (address)`
- `removeMinter(address minter) returns (bool)`
- `rescueERC20(address tokenContract, address to, uint256 amount)`
- `rescuer() view returns (address)`
- `supportsInterface(bytes4 _interfaceId) pure returns (bool)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `TRANSFER_WITH_AUTHORIZATION_TYPEHASH() view returns (bytes32)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner)`
- `transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)`
- `unBlacklist(address _account)`
- `unpause()`
- `updateBlacklister(address _newBlacklister)`
- `updateExchangeRate(uint256 newExchangeRate)`
- `updateMasterMinter(address _newMasterMinter)`
- `updateOracle(address newOracle)`
- `updatePauser(address _newPauser)`
- `updateRescuer(address newRescuer)`
- `version() view returns (string)`

Not on Ethereum's cbETH (`0xBe9895146f7AF43049ca1c1AE358B0541Ea49704`), whose code does not dispatch them or declares them otherwise: `bridge`, `BRIDGE`, `burn`, `initialize`, `l1Token`, `l2Bridge`, `REMOTE_TOKEN`, `remoteToken`, `supportsInterface`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's cbETH (`0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22`), whose code does not dispatch them or declares them otherwise: `authorizationState`, `blacklist`, `blacklister`, `burn`, `CANCEL_AUTHORIZATION_TYPEHASH`, `cancelAuthorization`, `configureMinter`, `currency`, `DOMAIN_SEPARATOR`, `exchangeRate`, `initialize`, `initializeV2`, `initializeV2_1`, `isBlacklisted`, `isMinter`, `masterMinter`, `mint`, `minterAllowance`, `nonces`, `oracle`, `owner`, `pause`, `paused`, `pauser`, `permit`, `PERMIT_TYPEHASH`, `RECEIVE_WITH_AUTHORIZATION_TYPEHASH`, `receiveWithAuthorization`, `removeMinter`, `rescueERC20`, `rescuer`, `TRANSFER_WITH_AUTHORIZATION_TYPEHASH`, `transferOwnership`, `transferWithAuthorization`, `unBlacklist`, `unpause`, `updateBlacklister`, `updateExchangeRate`, `updateMasterMinter`, `updateOracle`, `updatePauser`, `updateRescuer`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

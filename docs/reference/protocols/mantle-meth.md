<!-- Generated from the SDK's registries. Do not edit. -->

# Mantle mETH (`mantle-meth`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Mantle mETH is a liquid staking protocol: stake a chain's coin and get back a token you can still
> use. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Mantle's liquid staking token for Ethereum. Stake ETH and receive mETH, a non-rebasing token that accrues staking rewards over time.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `MantleMeth` on ethereum |
| Chains | ethereum |

## What it offers

- **stake**: Stake ETH for mETH with minimum output check

## Notes

- TVL: $1.5B+. Non-rebasing token backed by Mantle treasury
- stake() is payable - send ETH as msg.value
- minMETHAmount param provides slippage protection
- Use mETHToETH()/ethToMETH() to preview exchange rates
- The Staking contract (`staking`), not the token.
- The mETH token (`mETH`).

## Its names in a program

On Ethereum, `MantleMeth` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's mETH, `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa`.
  require(MantleMeth.METH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | mETH | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` | `MantleMeth.METH` |
| [Ethereum](../chains/ethereum.md) | staking | `0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f` | `MantleMeth.Staking` |

## ABI

### `METHABI`

`import METHABI from "./protocols/mantle-meth/METHABI.json";` Speaks for: mETH. The import is the contract's full ABI across every deployment; call it through the `MantleMeth` namespace to have a function a chain's deployment does not run refused.

- `ADD_BLOCK_LIST_CONTRACT_ROLE() view returns (bytes32)`
- `addBlockListContract(address blockListAddress)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(uint256 amount)`
- `BURNER_ROLE() view returns (bytes32)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `forceBurn(address account, uint256 amount)`
- `forceMint(address account, uint256 amount, bool excludeBlockList)`
- `getBlockLists() view returns (address[])`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getRoleMember(bytes32 role, uint256 index) view returns (address)`
- `getRoleMemberCount(bytes32 role) view returns (uint256)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `initialize((address admin, address staking, address unstakeRequestsManager) init)`
- `isBlocked(address account) view returns (bool)`
- `mint(address staker, uint256 amount)`
- `MINTER_ROLE() view returns (bytes32)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `REMOVE_BLOCK_LIST_CONTRACT_ROLE() view returns (bytes32)`
- `removeBlockListContract(address blockListAddress)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `stakingContract() view returns (address)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `unstakeRequestsManagerContract() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `event EIP712DomainChanged` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `METHStakingABI`

`import METHStakingABI from "./protocols/mantle-meth/METHStakingABI.json";` Speaks for: staking. The import is the contract's full ABI across every deployment; call it through the `MantleMeth` namespace to have a function a chain's deployment does not run refused.

- `allocatedETHForDeposits() view returns (uint256)`
- `allocateETH(uint256 allocateToUnstakeRequestsManager, uint256 allocateToDeposits, uint256 allocateToLiquidityBuffer)`
- `ALLOCATOR_SERVICE_ROLE() view returns (bytes32)`
- `claimUnstakeRequest(uint256 unstakeRequestID)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `depositContract() view returns (address)`
- `ethToMETH(uint256 ethAmount) view returns (uint256)`
- `exchangeAdjustmentRate() view returns (uint16)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getRoleMember(bytes32 role, uint256 index) view returns (address)`
- `getRoleMemberCount(bytes32 role) view returns (uint256)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initializationBlockNumber() view returns (uint256)`
- `initialize((address admin, address manager, address allocatorService, address initiatorService, address returnsAggregator, address withdrawalWallet, address mETH, address depositContract, address oracle, address pauser, address unstakeRequestsManager) init)`
- `initializeV2(address lb)`
- `initiateValidatorsWithDeposits((uint256 operatorID, uint256 depositAmount, bytes pubkey, bytes withdrawalCredentials, bytes signature, bytes32 depositDataRoot)[] validators, bytes32 expectedDepositRoot)`
- `INITIATOR_SERVICE_ROLE() view returns (bytes32)`
- `isStakingAllowlist() view returns (bool)`
- `liquidityBuffer() view returns (address)`
- `maximumDepositAmount() view returns (uint256)`
- `maximumMETHSupply() view returns (uint256)`
- `mETH() view returns (address)`
- `mETHToETH(uint256 mETHAmount) view returns (uint256)`
- `minimumDepositAmount() view returns (uint256)`
- `minimumStakeBound() view returns (uint256)`
- `minimumUnstakeBound() view returns (uint256)`
- `numInitiatedValidators() view returns (uint256)`
- `oracle() view returns (address)`
- `pauser() view returns (address)`
- `receiveFromUnstakeRequestsManager() payable`
- `receiveReturns() payable`
- `receiveReturnsFromLiquidityBuffer() payable`
- `reclaimAllocatedETHSurplus()`
- `renounceRole(bytes32 role, address account)`
- `returnsAggregator() view returns (address)`
- `revokeRole(bytes32 role, address account)`
- `setExchangeAdjustmentRate(uint16 exchangeAdjustmentRate_)`
- `setMaximumDepositAmount(uint256 maximumDepositAmount_)`
- `setMaximumMETHSupply(uint256 maximumMETHSupply_)`
- `setMinimumDepositAmount(uint256 minimumDepositAmount_)`
- `setMinimumStakeBound(uint256 minimumStakeBound_)`
- `setMinimumUnstakeBound(uint256 minimumUnstakeBound_)`
- `setStakingAllowlist(bool isStakingAllowlist_)`
- `setWithdrawalWallet(address withdrawalWallet_)`
- `stake(uint256 minMETHAmount) payable`
- `STAKING_ALLOWLIST_MANAGER_ROLE() view returns (bytes32)`
- `STAKING_ALLOWLIST_ROLE() view returns (bytes32)`
- `STAKING_MANAGER_ROLE() view returns (bytes32)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `TOP_UP_ROLE() view returns (bytes32)`
- `topUp() payable`
- `totalControlled() view returns (uint256)`
- `totalDepositedInValidators() view returns (uint256)`
- `unallocatedETH() view returns (uint256)`
- `unstakeRequest(uint128 methAmount, uint128 minETHAmount) returns (uint256)`
- `unstakeRequestInfo(uint256 unstakeRequestID) view returns (bool, uint256)`
- `unstakeRequestsManager() view returns (address)`
- `unstakeRequestWithPermit(uint128 methAmount, uint128 minETHAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)`
- `usedValidators(bytes pubkey) view returns (bool exists)`
- `withdrawalWallet() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

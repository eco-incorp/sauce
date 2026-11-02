<!-- Generated from the SDK's registries. Do not edit. -->

# Gamma Strategies (`gamma`)

Active concentrated liquidity management protocol. Manages Uniswap V3 and other DEX positions with automated rebalancing.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Gamma` on ethereum, polygon |
| Chains | ethereum, polygon |
| Document | [gamma.md](../gamma.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Gamma` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's uniProxy, `0xF5BFA20F4A77933fEE0C7bB7F39E7642A070d599`.
  require(Gamma.UniProxyLegacy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | uniProxy | `0xF5BFA20F4A77933fEE0C7bB7F39E7642A070d599` | `Gamma.UniProxyLegacy` |
| [Polygon](../../../sauce-chains/references/polygon.md) | uniProxy | `0xA42d55074869491D60Ac05490376B74cF19B00e6` | `Gamma.UniProxy` |

## ABI

### `HypervisorABI`

`import HypervisorABI from "./protocols/gamma/HypervisorABI.json";`

- `addLiquidity(int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1, uint256[2] inMin)`
- `algebraMintCallback(uint256 amount0, uint256 amount1, bytes data)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `baseLower() view returns (int24)`
- `baseUpper() view returns (int24)`
- `compound(uint256[4] inMin) returns (uint128 baseToken0Owed, uint128 baseToken1Owed, uint128 limitToken0Owed, uint128 limitToken1Owed)`
- `currentTick() view returns (int24 tick)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `deposit(uint256 deposit0, uint256 deposit1, address to, address from, uint256[4] inMin) returns (uint256 shares)`
- `deposit0Max() view returns (uint256)`
- `deposit1Max() view returns (uint256)`
- `directDeposit() view returns (bool)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `fee() view returns (uint8)`
- `feeRecipient() view returns (address)`
- `getBasePosition() view returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `getLimitPosition() view returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `getTotalAmounts() view returns (uint256 total0, uint256 total1)`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `limitLower() view returns (int24)`
- `limitUpper() view returns (int24)`
- `maxTotalSupply() view returns (uint256)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `owner() view returns (address)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `pool() view returns (address)`
- `PRECISION() view returns (uint256)`
- `pullLiquidity(int24 tickLower, int24 tickUpper, uint128 shares, uint256[2] amountMin) returns (uint256 amount0, uint256 amount1)`
- `rebalance(int24 _baseLower, int24 _baseUpper, int24 _limitLower, int24 _limitUpper, address _feeRecipient, uint256[4] inMin, uint256[4] outMin)`
- `removeWhitelisted()`
- `setFee(uint8 newFee)`
- `setWhitelist(address _address)`
- `symbol() view returns (string)`
- `tickSpacing() view returns (int24)`
- `toggleDirectDeposit()`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `totalSupply() view returns (uint256)`
- `transfer(address recipient, uint256 amount) returns (bool)`
- `transferFrom(address sender, address recipient, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner)`
- `whitelistedAddress() view returns (address)`
- `withdraw(uint256 shares, address to, address from, uint256[4] minAmounts) returns (uint256 amount0, uint256 amount1)`

### `UniProxyABI`

`import UniProxyABI from "./protocols/gamma/UniProxyABI.json";` Speaks for: uniProxy. The import is the contract's full ABI across every deployment; call it through the `Gamma` namespace to have a function a chain's deployment does not run refused.

- `deposit(uint256 deposit0, uint256 deposit1, address to, address pos, uint256[4] minIn) returns (uint256 shares)`
- `getDepositAmount(address pos, address token, uint256 _deposit) view returns (uint256 amountStart, uint256 amountEnd)`

### `UniProxyLegacyABI`

`import UniProxyLegacyABI from "./protocols/gamma/UniProxyLegacyABI.json";` Speaks for: uniProxy. The import is the contract's full ABI across every deployment; call it through the `Gamma` namespace to have a function a chain's deployment does not run refused.

- `addPosition(address pos, uint8 version)`
- `appendList(address pos, address[] listed)`
- `checkPriceChange(address pos, uint32 _twapInterval, uint256 _priceThreshold) view returns (uint256 price)`
- `customDeposit(address pos, uint256 deposit0Max, uint256 deposit1Max, uint256 maxTotalSupply)`
- `deltaScale() view returns (uint256)`
- `deposit(uint256 deposit0, uint256 deposit1, address to, address pos) returns (uint256 shares)`
- `depositDelta() view returns (uint256)`
- `freeDeposit() view returns (bool)`
- `getDepositAmount(address pos, address token, uint256 _deposit) view returns (uint256 amountStart, uint256 amountEnd)`
- `getSqrtTwapX96(address pos, uint32 _twapInterval) view returns (uint160 sqrtPriceX96)`
- `owner() view returns (address)`
- `positions(address) view returns (uint8 version, bool twapOverride, uint32 twapInterval, uint256 priceThreshold, bool depositOverride, uint256 deposit0Max, uint256 deposit1Max, uint256 maxTotalSupply, bool freeDeposit)`
- `priceThreshold() view returns (uint256)`
- `removeListed(address pos, address listed)`
- `setDeltaScale(uint256 _deltaScale)`
- `setDepositDelta(uint256 _depositDelta)`
- `setPriceThreshold(uint256 _priceThreshold)`
- `setTwapInterval(uint32 _twapInterval)`
- `setTwapOverride(address pos, bool twapOverride, uint32 _twapInterval)`
- `toggleDepositFree()`
- `toggleDepositFreeOverride(address pos)`
- `toggleDepositOverride(address pos)`
- `toggleTwap()`
- `transferOwnership(address newOwner)`
- `twapCheck() view returns (bool)`
- `twapInterval() view returns (uint32)`

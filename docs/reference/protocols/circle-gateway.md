<!-- Generated from the SDK's registries. Do not edit. -->

# Circle Gateway (`circle-gateway`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Circle Gateway is a messenger between chains: it carries messages and tokens from one to another.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another chain through the GatewayMinter with a Circle-signed attestation.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `CircleGateway` on ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche, base-sepolia, arc-testnet, sepolia |
| Chains | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche, base-sepolia, arc-testnet, sepolia |

## In a Sauce program

Deposit the Pot's USDC into Gateway for `depositor`, the user's own address:

```ts
function main(amount: Uint256, depositor: Address): Uint256 {
  // USDC in its 6-decimal base units, on Arc too: 5000000 is 5 USDC.
  require(pot.USDC >= amount, "amount is not in the Pot");
  const before = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  USDC.approve(CircleGateway.GatewayWallet, amount);
  CircleGateway.GatewayWallet.depositFor(USDC, depositor, amount);
  const total = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  require(total - before == amount, "the Gateway balance did not rise by the deposit");
  return total;
}
```

- **Whose balance it credits.** `depositFor(token, depositor, value)` credits `depositor`.
  `deposit(token, value)` credits the caller, which in a Sauce program is the Pot: the Gateway
  balance is then the Pot's, not the user's. A balance credited to the Pot can be spent only by a
  burn intent signed by a delegate the Pot adds for itself with the GatewayWallet's `addDelegate`,
  which the registry's ABI does not declare. To let the user spend it through Gateway from their
  wallet, deposit for their address.
- **Approve exactly the amount** for `CircleGateway.GatewayWallet` first, and deposit exactly what
  the Pot means to: a given `amount`, or the USDC a swap just delivered measured as a delta. On Arc
  never deposit `pot.USDC` whole, because the same balance is the Pot's native coin, from which
  any native fee the program pays comes.
- **Read it back.** `totalBalance(USDC, depositor)` and `availableBalance(USDC, depositor)` both
  rise by the deposit in the same transaction.
- **Where the program ends.** The deposit is the on-chain step. Spending the balance on another
  chain is off-chain first: a burn intent signed for the depositor goes to Circle's Gateway API,
  which returns an attestation, and `CircleGateway.GatewayMinter.gatewayMint(attestationPayload,
signature)` on the destination is a transaction of its own.
- `isTokenSupported(USDC)` says whether the chain's Gateway takes USDC.

## Notes

- Gateway uses Circle domain ids, the same ids as CCTP (Arc is 26), not EVM chain ids
- Spending a Gateway balance on another chain is off-chain first: sign a burn intent, submit it to Circle's Gateway API, then call `gatewayMint` with the returned attestation
- Both contracts are upgradeable (EIP-1967) proxies. Arc's Minter runs a different, smaller implementation from the other chains' that dispatches the same functions
- Circle also runs Gateway on HyperEVM (domain 19) and World Chain (14), which are not SDK chains. It has no Solana mainnet deployment
- On a testnet (Arc Testnet, Base Sepolia, Ethereum Sepolia) the Wallet and Minter are Circle's
  testnet pair, not the mainnet addresses; `CircleGateway.GatewayWallet` and
  `CircleGateway.GatewayMinter` resolve to the chain's own. Their burn intents go to Circle's
  testnet Gateway API, `https://gateway-api-testnet.circle.com`

## Its names in a program

On Ethereum, `CircleGateway` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's gatewayMinter, `0x2222222d7164433c4C09B0b0D809a9b52C04C205`.
  require(CircleGateway.GatewayMinter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Ethereum](../chains/ethereum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Optimism](../chains/optimism.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Optimism](../chains/optimism.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Unichain](../chains/unichain.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Unichain](../chains/unichain.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Polygon](../chains/polygon.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Polygon](../chains/polygon.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sonic](../chains/sonic.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sonic](../chains/sonic.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sei](../chains/sei.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sei](../chains/sei.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arc](../chains/arc.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arc](../chains/arc.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Base](../chains/base.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Base](../chains/base.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arbitrum One](../chains/arbitrum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arbitrum One](../chains/arbitrum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Avalanche C-Chain](../chains/avalanche.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Avalanche C-Chain](../chains/avalanche.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Base Sepolia](../chains/base-sepolia.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Base Sepolia](../chains/base-sepolia.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Arc Testnet](../chains/arc-testnet.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Arc Testnet](../chains/arc-testnet.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Ethereum Sepolia](../chains/sepolia.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Ethereum Sepolia](../chains/sepolia.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |

## ABI

### `GatewayMinterABI`

`import GatewayMinterABI from "./protocols/circle-gateway/GatewayMinterABI.json";` Speaks for: gatewayMinter.

- `gatewayMint(bytes attestationPayload, bytes signature)`
- `isTokenSupported(address token) view returns (bool)`
- `domain() view returns (uint32)`

### `GatewayWalletABI`

`import GatewayWalletABI from "./protocols/circle-gateway/GatewayWalletABI.json";` Speaks for: gatewayWallet.

- `deposit(address token, uint256 value)`
- `depositFor(address token, address depositor, uint256 value)`
- `totalBalance(address token, address depositor) view returns (uint256)`
- `availableBalance(address token, address depositor) view returns (uint256)`
- `isTokenSupported(address token) view returns (bool)`
- `domain() view returns (uint32)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

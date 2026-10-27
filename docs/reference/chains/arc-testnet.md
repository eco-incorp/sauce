<!-- Generated from the SDK's registries. Do not edit. -->

# Arc Testnet

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Arc Testnet: its tokens, and every protocol deployed there with
> the name a program writes for each contract. The `sauce` command builds and sends transactions on
> Arc Testnet.

**Supported testnet.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Arc Testnet a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them. Arc Testnet is a test network: its coin and tokens have no value.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `arc-testnet` |
| Chain id | 5042002 |
| Kind | EVM |
| Network | testnet: its coin and tokens have no value |
| Name in a program | `ArcTestnet` |
| In TypeScript | `import { ArcTestnet } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | USDC (USDC), 18 decimals; also the ERC-20 `USDC` (6 decimals), one balance |
| Minimum base fee | 20 gwei: a transaction with a lower `maxFeePerGas` is never included |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 26 |

## Notes

Arc Testnet is Arc's model exactly: USDC is the native coin at 18 decimals and the ERC-20
`0x3600000000000000000000000000000000000000` at 6, one balance, with the same minimum base fee.
Every note on the [Arc](arc.md) page holds here too. Its USDC and EURC come from Circle's
faucet.

Arc Testnet has no DEX, lending market or oracle in the registry: it is for USDC and EURC
moves, CCTP and Circle Gateway. For a pool, a swap, Morpho, Aave or Aerodrome, compile and
simulate on `arc`. `USDC` has the same address on both; `EURC` differs, and `WETH` and `USYC`
exist only on `arc`.

## In a program

Compiled with `--chain arc-testnet`, a program names Arc Testnet's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `EURC` is Arc Testnet's EURC: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.
  const held = EURC.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(EURC).balanceOf(pot) == held);
  // `Cctp.TokenMessenger` is Arc Testnet's tokenMessenger: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`.
  require(Cctp.TokenMessenger != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(ArcTestnet.Cctp.TokenMessenger == Cctp.TokenMessenger);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `EURC` | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 |
| `USDC` | `0x3600000000000000000000000000000000000000` | 6 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.

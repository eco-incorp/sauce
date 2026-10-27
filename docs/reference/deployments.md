<!-- Generated from the SDK's registries. Do not edit. -->

# Deployments

**Reference** · [Documentation](../README.md)

> Sauce's own contracts and programs: the Kitchen that makes Pots, the engine that runs programs,
> and the Routers that help with swaps. They sit at the same address on every chain, so this one
> page lists them. You rarely need them: the `sauce` command and the SDK fill them in for you.

The Sauce contracts have the same address on every EVM chain, and its programs the same id on
every Solana cluster, so this page is the one place the manual lists them: each chain's page
points here. An address is where the contract is deployed, not proof that it is there: before
relying on one, confirm it has code on the chain (`eth_getCode` returns more than `0x`; on
Solana, `getAccountInfo` returns an executable account). In TypeScript each value comes from
`@eco-incorp/sauce/deployments`, by the function its table names.

The released EVM engine and Kitchen are deployed on Ethereum Sepolia, Base Sepolia and Arc
Testnet. The released Solana engine and Kitchen are deployed on devnet and testnet, with zero
execution fees: `--chain solana-devnet` and `--chain solana-testnet`. Testnet runs devnet's
engine build, so a program compiled for either reads chain id 1399811150; `solana-testnet`'s
own id, 1399811151, is the SDK's key for the chain. Engine deployment does not establish venue
deployments: the SDK records its Solana venues per cluster, on mainnet and seven of them on
devnet, and none on testnet.

## The release

The compiler this package pins, and the four components its programs run on. They pair by exact
version, in both directions:
[which engine runs a program](../api/compiler.md#which-engine-runs-a-program).

| Component | Version |
| --- | --- |
| Compiler, `@eco-incorp/sauce-compiler` | 2.6.1 |
| EVM engine, `v12-evm` | 1.3.0 |
| EVM Kitchen, `kitchen-evm` | 1.3.0 |
| Solana engine, `v12-svm` | 1.4.0 |
| Solana Kitchen, `kitchen-svm` | 1.1.0 |

## EVM chains

| Contract | Address | What it is | In TypeScript |
| --- | --- | --- | --- |
| Engine | `0x0F50E5dB8d30c102f1da1301a1C8A06E06Fa0f67` | the interpreter that runs a program: a cook is the Pot's `cook(engine, program)` | `v12EngineAddress()` |
| Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` | creates Pots (`deployPot(owner, salt)`) and sets the fee every cook pays (`executionFee()`) | `v12KitchenAddress()` |
| Kitchen implementation | `0xDDAEf9AFa92F86Bd89132F18FCA79B10Ed25e99c` | behind the Kitchen, an upgradeable proxy: call the Kitchen | `v12KitchenImplementationAddress()` |
| Router | `0x4dF3b7C7d63261368489b330C36913cEee5D0044` | the Router a new Pot starts on, through which the swaps a pool calls back for run | `v12RouterAddress()` |
| Quote Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` | generation 3: quotes Uniswap V3 and V4 swaps through `eth_call`, holding no tokens; no Pot's Router | `v12QuoteRouterAddress()` |

### Pots

The Kitchen deploys an owner's Pot under a 32-byte salt, zero unless another is chosen, at
`CREATE2(kitchen, keccak256(abi.encode(owner, salt)), initCodeHash)`, with the Pot init-code
hash:

`0xe8e1f54a0a3c700fedc0e0019c5a7dc7ca08e676862db576b864e744186cd7f2`

`v12PredictPot(owner, salt)` computes a Pot's address, `v12PotDerivation()` returns the formula
and the hash, and `sauce pot --owner <address>` prints an owner's Pot.

## Solana

| Program | Program id | Key, the value a program holds | In TypeScript |
| --- | --- | --- | --- |
| Engine | `53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW` | `0x3c1c3c1e1b25a58a15a88145bcc823446ec88fec133af645d0621bacfcdb0303` | `v12SvmEngineProgramId()` |
| Kitchen | `SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot` | `0x068ddbf2073c779081c9b11a48aea267e5545cb7f387144de6b7ff8c7138818b` | `v12SvmKitchenProgramId()` |

The engine owns every Pot, and a program on Solana reads it as `ctx.self()`. A Pot is the
Kitchen's program address for the seeds `"pot"`, the owner and the 32-byte salt.

## Next

- [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md): what these contracts do.
- [Upgrading](../guides/upgrading.md): moving to a new release of Sauce.
- [Glossary](../concepts/glossary.md): the words these pages use, in plain terms.

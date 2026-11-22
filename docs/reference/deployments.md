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
deployments: the SDK's Solana venues remain mainnet-only.

## The release

The compiler the SDK pins and the engine and Kitchen versions it uses by default; the
[changelog](../changelog.md) and [compiler compatibility](../api/compiler.md#which-engine-runs-a-program)
say what each release changed and which engines run a compiler's programs.

| Component | Version |
| --- | --- |
| Compiler, `@eco-incorp/sauce-compiler` | 2.6.3 |
| EVM engine, `v12-evm` | 1.4.0 |
| EVM Kitchen, `kitchen-evm` | 1.4.0 |
| Solana engine, `v12-svm` | 1.4.1 |
| Solana Kitchen, `kitchen-svm` | 1.1.0 |

## EVM chains

| Contract | Address | What it is | In TypeScript |
| --- | --- | --- | --- |
| Engine | `0x983C102aa6321187877530723dDF6921AB4861a6` | the interpreter that runs a program: a cook is the Pot's `cook(engine, program)` | `v12EngineAddress()` |
| Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` | creates Pots (`deployPot(owner, salt)`) and sets the fee every cook pays (`executionFee()`) | `v12KitchenAddress()` |
| Kitchen implementation | `0x961Bb7e8C5304961e0E5F92B2BB3cdbE6e936a3c` | behind the Kitchen, an upgradeable proxy: call the Kitchen | `v12KitchenImplementationAddress()` |
| Router | `0xcc5e707d3c063Faae1e0dAf2C6CBc2Fd076AE759` | the Router a new Pot starts on, through which the swaps a pool calls back for run | `v12RouterAddress()` |
| Quote Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` | generation 3: quotes Uniswap V3 and V4 swaps through `eth_call`, holding no tokens; no Pot's Router | `v12QuoteRouterAddress()` |

### Pots

The Kitchen places an owner's Pot under a 32-byte salt, zero unless another is chosen, by CREATE3:
a proxy is created at `CREATE2(kitchen, gateSalt, potProxyInitCodeHash)`, and the Pot is the
contract that proxy creates first, `CREATE(proxy, 1)`. `gateSalt` is
`keccak256(abi.encode(owner, salt))`, and `keccak256(abi.encode(owner, salt, true))` for a Pot with
a fixed Router or a Shared Pot (the zero address as owner), so the three differ for one owner and
salt.

| What | Value |
| --- | --- |
| Pot proxy init-code hash | `0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f` |
| Pot profile hash | `0x1ca6981b8c987e444f750b8c3c7224aee18696dfb2ceea3bbee2c086edbc9167` |
| Fixed Router | `0xcc5e707d3c063Faae1e0dAf2C6CBc2Fd076AE759` |
| Pot creation code hash, which the Kitchen's `potInitCodeHash()` reports | `0x127f4d767a3585b9d2bb1a4d6ef3b46289cfa0452ac8323baf91fc8ffbcb03dc` |

`v12PredictPot(owner, salt)` computes a Pot's address, `v12PotDerivation()` returns the formula
and the hashes, and `sauce pot --owner <address>` prints an owner's Pot.

### Pots of earlier releases

Pots an earlier Kitchen release made keep their address. The SDK cooks a
kitchen-evm 1.3.0 Pot on its own engine:

| Engine | Version | Address |
| --- | --- | --- |
| EVM engine, `v12-evm` | 1.3.0 | `0x0F50E5dB8d30c102f1da1301a1C8A06E06Fa0f67` |
| Solana engine, `v12-svm` | 1.4.0 | `53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW` |

## Solana

| Program | Program id | Key, the value a program holds | In TypeScript |
| --- | --- | --- | --- |
| Engine | `8ukALvkKyJcyf5aEAUwTbLwSr9iMYktnRZL5if8vYBhg` | `0x7584d01e59afbe682c8faba4c2ff0695f16b2e8cdce42c07504e2e7e152ce127` | `v12SvmEngineProgramId()` |
| Kitchen | `SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot` | `0x068ddbf2073c779081c9b11a48aea267e5545cb7f387144de6b7ff8c7138818b` | `v12SvmKitchenProgramId()` |

A Pot is owned by the engine that created it. The SDK creates new Pots under the engine above and
cooks a Pot on the engine that owns it where that engine runs this SDK's programs (the Solana
engine listed under the earlier releases); a Pot of an engine that does not run them is cooked on
the engine above. The Kitchen binds no engine to a Pot, so that choice is the SDK's, and a program on
Solana reads the engine running the cook as `ctx.self()`. A Pot's address does not depend on the
engine: it is the Kitchen's program address for the seeds `"pot"`, the owner and the 32-byte salt.

## Next

- [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md): what these contracts do.
- [Upgrading](../guides/upgrading.md): moving to a new release of Sauce.
- [Glossary](../concepts/glossary.md): the words these pages use, in plain terms.

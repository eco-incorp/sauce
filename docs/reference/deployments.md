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

## The release

The compiler this package pins, and the four components its programs run on. They pair by exact
version, in both directions:
[which engine runs a program](../api/compiler.md#which-engine-runs-a-program).

| Component | Version |
| --- | --- |
| Compiler, `@eco-incorp/sauce-compiler` | 2.5.0 |
| EVM engine, `v12-evm` | 1.2.0 |
| EVM Kitchen, `kitchen-evm` | 1.2.0 |
| Solana engine, `v12-svm` | 1.3.0 |
| Solana Kitchen, `kitchen-svm` | 1.0.0 |

## EVM chains

| Contract | Address | What it is | In TypeScript |
| --- | --- | --- | --- |
| Engine | `0xcF7A92abCC7Ede43277AcCBAfda910b8829bF9AD` | the interpreter that runs a program: a cook is the Pot's `cook(engine, program)` | `v12EngineAddress()` |
| Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` | creates Pots (`deployPot(owner, salt)`) and sets the fee every cook pays (`executionFee()`) | `v12KitchenAddress()` |
| Kitchen implementation | `0xC8419328dC889C312CbcDf09d939eF93D590d9d5` | behind the Kitchen, an upgradeable proxy: call the Kitchen | `v12KitchenImplementationAddress()` |
| Router | `0x0542D51Fc0b7666B4FF7Ea12646BF30d1D2C4E49` | generation 4: the Router a new Pot starts on, through which the swaps a pool calls back for run | `v12RouterAddress()` |
| Quote Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` | generation 3: quotes Uniswap V3 and V4 swaps through `eth_call`, holding no tokens; no Pot's Router | `v12QuoteRouterAddress()` |

### Pots

The Kitchen deploys an owner's Pot under a 32-byte salt, zero unless another is chosen, at
`CREATE2(kitchen, keccak256(abi.encode(owner, salt)), initCodeHash)`, with the Pot init-code
hash:

`0xb4f700d3ee5e337e97dbf06e283bd19b35a9267b601c735c24ced66813d5d520`

`v12PredictPot(owner, salt)` computes a Pot's address, `v12PotDerivation()` returns the formula
and the hash, and `sauce pot --owner <address>` prints an owner's Pot.

### The shared intent Pot

An intent's program body cooks on the Pot of the destination's eco-routes Executor under salt
zero. One Executor serves every EVM chain that takes intents, so one Pot does:

| Fact | Value |
| --- | --- |
| Address | `0x6340080a1967a03cAAD490a170828d4C59EE5983`: `destinationPot(chain)` |
| Owner, the eco-routes Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Salt | `0x0000000000000000000000000000000000000000000000000000000000000000`: `SAUCE_INTENT_POT_SALT` |

The Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account.
[The destination Pot](../guides/intents.md#the-destination-pot) says who deploys it and what a
body may leave in it.

## Solana

| Program | Program id | Key, the value a program holds | In TypeScript |
| --- | --- | --- | --- |
| Engine | `2HH8xZ7ZN8SSDD8B3ALYANTVKBbMKGxTzjX7LTzvtSzT` | `0x130739ec93130b575cec4892d3e56cb416a3f5b7c530200070a6922610d31c70` | `v12SvmEngineProgramId()` |
| Kitchen | `SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot` | `0x068ddbf2073c779081c9b11a48aea267e5545cb7f387144de6b7ff8c7138818b` | `v12SvmKitchenProgramId()` |

The engine owns every Pot, and a program on Solana reads it as `ctx.self()`. A Pot is the
Kitchen's program address for the seeds `"pot"`, the owner and the 32-byte salt.

## Next

- [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md): what these contracts do.
- [Upgrading](../guides/upgrading.md): moving to a new release of Sauce.
- [Glossary](../concepts/glossary.md): the words these pages use, in plain terms.

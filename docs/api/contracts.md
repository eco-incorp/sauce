# Contracts and tokens API

[API reference](README.md) · [Protocols and tokens](../guides/protocols-and-tokens.md) · [Protocols](../reference/protocols.md)

Every registry protocol is a namespace and every registered token a name, with the same names in a
program and in TypeScript. This page lists both surfaces; the
[guide](../guides/protocols-and-tokens.md) shows them in use.

| Registry entry             | In a program                                    | In TypeScript                                        |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| A token                    | `USDC`                                          | `Base.USDC`                                          |
| A deployed contract        | `UniswapV3.QuoterV2`                            | `Base.UniswapV3.QuoterV2`                            |
| Its method                 | `UniswapV3.QuoterV2.quoteExactInputSingle(...)` | `Base.UniswapV3.QuoterV2.quoteExactInputSingle(...)` |
| The ABI at another address | `UniswapV3.Factory.at(address).getPool(...)`    | `Base.UniswapV3.Factory.at(address).getPool(...)`    |
| An interface               | `Erc4626.Vault(vault).deposit(...)`             | `Base.Erc4626.Vault.at(vault).deposit(...)`          |
| A family alias             | `Uniswap.UniversalRouter`                       | `Base.Uniswap.UniversalRouter`                       |
| Another chain's address    | `Arbitrum.UniswapV3.Factory`                    | `Arbitrum.UniswapV3.Factory`                         |
| Whether the chain has it   | `available(UniswapV3.Factory)`                  | `Base.UniswapV3.Factory.available`                   |

## Names

A namespace is its protocol's slug in PascalCase, a contract its role in the protocol's
`addresses.ts`, an interface its ABI's name, and a family alias groups a protocol's versions:
[Names](../guides/protocols-and-tokens.md#names) has the rules, and each protocol's page in the
[reference](../reference/protocols.md) the names they give. `contracts.deriveContractName` derives an
interface's name from its ABI export. No protocol, family, token or venue name can collide with a
chain export's own `route`, `chain`, or a function property: composing the export refuses it.

## TypeScript: chain exports

`import { Base } from "@eco-incorp/sauce"` — one export per canonical chain — carries:

| Property               | What it is                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Base.Portal`          | Opens an intent on Base, `Base.Portal.send(...).receive(...).then(body)`; see [routes](routes.md#the-portal-form)                                                                                     |
| `Base.chain`, `.route` | The chain record, and the lower-level route builder; see [routes](routes.md#chain-entry-points)                                                                                                       |
| `Base.<Symbol>`        | A registry token: a frozen `{ address, decimals, symbol, chain }` (`routes.RegistryToken`); on `Solana`, a registered mint, its `address` the mint's 32-byte key as hex and `mint` its base58 address |
| `Base.<Namespace>`     | A protocol or family namespace, typed by the generated `contracts.ChainContracts`                                                                                                                     |

A chain's token properties are exactly its registry rows, and the type names only those: `Base.USDT`
is a type error and `undefined`. `routes.registryTokens(chain)` returns the same objects for a
chain chosen at run time, and `contracts.on(ref)` the same namespace tree.

## TypeScript: a contract

| Member              | Type                                  | Meaning                                                                            |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `address`           | `` `0x${string}` `` or `undefined`    | The deployment on this chain; `undefined` where there is none, or for an interface |
| `available`         | `boolean`                             | Whether `address` is set                                                           |
| `chains`            | `ChainSlug[]`                         | Every chain the registry has an address for                                        |
| `abi`, `methods`    | the ABI, `DescriptorMethod[]`         | What the registry declares, with signatures and selectors                          |
| `coverage`          | `ContractCoverage`                    | `caveats`: deployments that differ from the ABI, from the registry's evidence      |
| `descriptor`        | `ContractDescriptor`                  | The chain-independent registry entry                                               |
| `at(address)`       | the same contract, bound to `address` | Required before an interface's methods                                             |
| `<method>(...args)` | `ContractCall`                        | One per ABI function, arguments typed by viem from the ABI                         |

An address-only contract (`contracts.AddressOnlyContract`) has no methods, and an interface
(`contracts.InterfaceContract`) has them only after `.at(address)`. Calling a method of a contract
with no deployment on the chain throws, naming the chains that have one.

## TypeScript: a call

A `ContractCall` is built synchronously and reads nothing.

| Member                      | Meaning                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `chain`, `address`          | Where it calls                                                                                             |
| `protocol`, `contract`      | The registry entry                                                                                         |
| `method`, `args`            | The ABI method (the overload, by argument count) and the arguments                                         |
| `data`, `encode(options?)`  | The calldata                                                                                               |
| `toCall(options?)`          | `{ target, data, value }`                                                                                  |
| `toSauceScript(options?)`   | The same call as a program, with its ABI import                                                            |
| `read(client)`              | An `eth_call` through viem's `readContract`, resolving to the decoded outputs; sends nothing               |
| `simulate(client, options)` | `simulateContract` as `options.account`, with `options.value`; resolves to `{ result, request }`           |
| `write(client, options?)`   | `writeContract` from `options.account` or the client's account, with `options.value`; resolves to the hash |

`read` exists on every call: a view's value, or what a state-changing method would return. `simulate`
and `write` exist on a state-changing method's call only, and throw on a view or pure one. All three
take a viem client the caller creates; the SDK embeds no RPC endpoint. Each first checks that the
client is on the call's chain — from `client.chain`, or by asking a client that has none for its
chain id once — and refuses one on another chain. viem's actions are imported on the first call.

## Programs

In a program, a namespace member is a Sauce scalar: a deployed or address-only contract is its
address on the chain the program is compiled for, a method call is an ABI call there, and
`.at(address).method(...)` calls the same ABI at `address`. An interface, which has no address of its
own, is called with one: `Erc4626.Vault(vault).deposit(...)` (`.at(vault)` too). A deployed
contract's name is never called with an address. `<Chain>.<Namespace>.<Contract>` reads
another chain's address, without moving execution there. A protocol with a single deployed
contract also takes its methods directly (`Cctp.depositForBurn(...)`).

`available(<contract or token symbol>)` is a compile-time `boolean`: whether the chain the program
is compiled for has it. A branch it rules out is removed before anything in it resolves; see
[use a venue only where the chain has it](../guides/protocols-and-tokens.md#use-a-venue-only-where-the-chain-has-it).

The declarations a typed closure checks against, for every namespace, token and `available`, ship
in the package root's types. The ERC-20 syntax for tokens is in the
[guide](../guides/protocols-and-tokens.md#token-methods-and-balances).

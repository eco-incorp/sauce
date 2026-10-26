# Contracts and tokens API

**Reference** · [API reference](README.md) · [Protocols and tokens](../guides/protocols-and-tokens.md) · [Protocols](../reference/protocols.md)

> Every protocol and token in Sauce's address book has a name, and you use the same name in a program
> and in TypeScript. This page lists the shapes those names take.

This page is for a developer who already calls protocols by name and needs the exact shape of a
name: what `Base.UniswapV3.Factory` is, what a call built from it holds, and what each member does.
It assumes the [protocols and tokens guide](../guides/protocols-and-tokens.md), which shows the names
in use. Which registry a name comes from, and whether a chain has it, is [Coverage](coverage.md).

Every registry protocol is a namespace and every registered token a name, with the same names in a
program and in TypeScript:

| Registry entry             | In a program                                    | In TypeScript                                        |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| A token                    | `USDC`                                          | `Base.USDC`                                          |
| A deployed contract        | `UniswapV3.QuoterV2`                            | `Base.UniswapV3.QuoterV2`                            |
| Its method                 | `UniswapV3.QuoterV2.quoteExactInputSingle(...)` | `Base.UniswapV3.QuoterV2.quoteExactInputSingle(...)` |
| The ABI at another address | `UniswapV3.Factory.at(address).getPool(...)`    | `Base.UniswapV3.Factory.at(address).getPool(...)`    |
| An interface               | `Erc4626.Vault(vault).deposit(...)`             | `Base.Erc4626.Vault.at(vault).deposit(...)`          |
| A contract a call returns  | `UniswapV3.Factory.getPool(a, b, 500).fee()`    | the method's `returns`                               |
| A family alias             | `Uniswap.UniversalRouter`                       | `Base.Uniswap.UniversalRouter`                       |
| Another chain's address    | `Arbitrum.UniswapV3.Factory`                    | `Arbitrum.UniswapV3.Factory`                         |
| Whether the chain has it   | `UniswapV3.Factory ? a : b`                     | `Base.UniswapV3.Factory.available`                   |

## One name, both sides

The same pool lookup on Base, first in a program:

```js
function main(): Uint256 {
  const pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  return pool.liquidity();
}
```

Compiled for Base, `UniswapV3.Factory`, `USDC` and `WETH` become Base's addresses, and `pool` is a
`UniswapV3.Pool` because the registry knows what `getPool` returns. Then in TypeScript, as a call you
build offline and read through your own viem client:

```ts
import { Base } from "@eco-incorp/sauce";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http("<your Base RPC URL>") });

const getPool = Base.UniswapV3.Factory.getPool(Base.USDC.address, Base.WETH.address, 500);
console.log(getPool.toCall()); // { target, data, value }, built with no network access
const pool = await getPool.read(client); // one eth_call through your client
```

## Names

A namespace is its protocol's slug in PascalCase, a contract its role in the protocol's
`addresses.ts`, an interface its ABI's name, and a family alias groups a protocol's versions:
[Names](../guides/protocols-and-tokens.md#names) has the rules, and each protocol's page in the
[reference](../reference/protocols.md) the names they give. `contracts.deriveContractName` derives an
interface's name from its ABI export. No protocol, family, token or venue name can collide with a
chain export's own `chain`, or with another name on the same export: composing the export refuses it.

## TypeScript: chain exports

`import { Base } from "@eco-incorp/sauce"` — one export per canonical chain — is a plain namespace,
not a function, and carries:

| Property           | What it is                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Base.chain`       | The canonical chain record                                                                                                                                                                            |
| `Base.<Symbol>`    | A registry token: a frozen `{ address, decimals, symbol, chain }` (`routes.RegistryToken`); on `Solana`, a registered mint, its `address` the mint's 32-byte key as hex and `mint` its base58 address |
| `Base.<Namespace>` | A protocol or family namespace, typed by the generated `contracts.ChainContracts`                                                                                                                     |

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

A method's `returns` lists, where the registry knows them, the registry contracts its address
outputs are: `{ path, protocol, contract }` each, `path` empty for the one output and the field
names for a field of what it returns. `UniswapV3.Factory`'s `getPool` has
`{ path: [], protocol: "uniswap-v3", contract: "Pool" }`.

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
take a viem client the caller creates; no import of the package carries an RPC endpoint. Each first
checks that the client is on the call's chain — from `client.chain`, or by asking a client that has
none for its chain id once — and refuses one on another chain. viem's actions are imported on the
first call.

## Programs

In a program, a namespace member is a Sauce scalar: a deployed or address-only contract is its
address on the chain the program is compiled for, a method call is an ABI call there, and
`.at(address).method(...)` calls the same ABI at `address`. An interface, which has no address of its
own, is called with one: `Erc4626.Vault(vault).deposit(...)` (`.at(vault)` too). A deployed
contract's name is never called with an address. Where a method's `returns` names the contract an
address it returns is, that contract's methods are called on the result, or on a `const` holding
it: `UniswapV3.Factory.getPool(a, b, 500).fee()` compiles as `UniswapV3.Pool(<the call>).fee()`, a
deployed contract's ABI is bound with `.at(...)` the same way, and a token's writes are
`Token(address)`'s. `<Chain>.<Namespace>.<Contract>` reads
another chain's address, without moving execution there. A protocol with a single deployed
contract also takes its methods directly (`Cctp.depositForBurn(...)`).

Every registry name — each namespace with every contract it has on any chain, each token symbol
some chain registers — is declared on every chain, and a name the chain a program is compiled for
lacks is zero there. A test of it (`if (UniswapV3.Factory)`, `!USDT`, `X != 0`, `X ? a : b`) is
decided at compile time, and the branch it rules out is not compiled; any other use of an absent
name is refused at the use, naming the chain. See
[use a venue only where the chain has it](../guides/protocols-and-tokens.md#use-a-venue-only-where-the-chain-has-it).

The declarations a typed closure checks against, for every namespace and token, ship
in the package root's types. The ERC-20 syntax for tokens is in the
[guide](../guides/protocols-and-tokens.md#token-methods-and-balances).

## Next

[Coverage](coverage.md) says which registry each name comes from and how to check that a chain has
it. To compile a program that uses these names from TypeScript, see
[Programs and cooks](routes.md).

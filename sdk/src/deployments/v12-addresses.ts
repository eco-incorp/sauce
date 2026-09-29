/**
 * The deterministic addresses of the pinned Sauce v12 releases.
 *
 * `sync-engine-artifacts` assembles these from the `addresses.json` each of the four v12 releases
 * publishes and writes `artifacts/V12Deployments.json` — `dist/artifacts` in an installed package,
 * `src/artifacts` in a from-source tree — which `files: ["sdk/dist"]` carries into the tarball. It is
 * a JSON import, like `pot.ts`'s `V12EngineGate.json`, so no filesystem is read at run time and a
 * bundler inlines it; from a source checkout, run the sync before `tsc`.
 *
 * These are the deterministic addresses — CREATE3 on EVM, a fixed/derived keypair on SVM — so they are
 * `chainIndependent` / `clusterIndependent`: one address set, the same everywhere it is deployed. They
 * are ADDRESSES, not liveness: check code/programs on the target chain before use.
 */
import deployments from "../artifacts/V12Deployments.json" with { type: "json" };

/** One EVM contract as the release records it: the address plus its CREATE3 derivation metadata. */
export interface V12EvmContractRef {
  address: string;
  saltName?: string;
  rawSalt?: string;
  guardedSalt?: string;
  derivation?: string;
  /** Present on the Kitchen — it is a UUPS proxy. */
  proxyKind?: string;
  generation?: number;
  note?: string;
}

/** How a Pot address is derived — `CREATE2(kitchen, keccak256(abi.encode(owner, salt)), initCodeHash)`. */
export interface V12PotDerivation {
  deployer: string;
  initCodeHash: string;
  saltFormula: string;
  derivation?: string;
}

/** One SVM program as the release records it. */
export interface V12SvmProgramRef {
  programId: string;
  label?: string;
  derivation?: string;
  upgradeAuthority?: string;
}

/** The assembled `V12Deployments.json`: release addresses and per-component provenance. */
export interface V12DeployedAddresses {
  /** The compiler version these releases were synced for: the row of `releases.json` they come
   *  from. Every program this SDK compiles is that compiler's output. */
  compiler: string;
  /** Legacy EVM Kitchen version; use `releases` for per-component versions. */
  version: string;
  /** Legacy EVM Kitchen commit; use `releases` for per-component commits. */
  commit: string;
  releases: Record<
    "v12-evm" | "kitchen-evm" | "v12-svm" | "kitchen-svm",
    { version: string; commit: string }
  >;
  evm: {
    chainIndependent: true;
    /** The CreateX-style factory every contract is deployed through. */
    factory: string;
    deployer: string;
    contracts: {
      /** The Huff interpreter runtime that executes Sauce bytecode. */
      engine: V12EvmContractRef;
      /** Swap surface every Pot's fallback delegatecalls into. */
      router: V12EvmContractRef;
      /** The UUPS Kitchen proxy — mints Pots and gates every cook. */
      kitchen: V12EvmContractRef;
      /** The Kitchen implementation behind the proxy. */
      kitchenImplementation: V12EvmContractRef;
    };
    pot: V12PotDerivation;
  };
  svm: {
    clusterIndependent: true;
    programs: {
      /** The SVM engine program — pass as `programId` to `createSauceSvmClient`. */
      engine: V12SvmProgramRef;
      /** The SVM Kitchen program every cook is gated to. */
      kitchen: V12SvmProgramRef;
    };
  };
}

/** The assembled release-address record. */
export function v12DeployedAddresses(): V12DeployedAddresses {
  return deployments as V12DeployedAddresses;
}

/** Legacy EVM Kitchen version. Engine versions are in `v12DeployedAddresses().releases`. */
export const v12DeployedVersion = (): string => v12DeployedAddresses().version;

/** The current EVM engine (interpreter runtime) address. */
export const v12EngineAddress = (): string => v12DeployedAddresses().evm.contracts.engine.address;

/** The current EVM Router address. */
export const v12RouterAddress = (): string => v12DeployedAddresses().evm.contracts.router.address;

/** The current EVM Kitchen (UUPS proxy) address — mints Pots and gates every cook. */
export const v12KitchenAddress = (): string => v12DeployedAddresses().evm.contracts.kitchen.address;

/** The current EVM Kitchen implementation address (behind the proxy). */
export const v12KitchenImplementationAddress = (): string =>
  v12DeployedAddresses().evm.contracts.kitchenImplementation.address;

/** How a Pot address is derived from `(owner, salt)` under the current Kitchen. */
export const v12PotDerivation = (): V12PotDerivation => v12DeployedAddresses().evm.pot;

/** The current SVM engine program id — pass as `programId` to `createSauceSvmClient`. */
export const v12SvmEngineProgramId = (): string =>
  v12DeployedAddresses().svm.programs.engine.programId;

/** The current SVM Kitchen program id every cook is gated to. */
export const v12SvmKitchenProgramId = (): string =>
  v12DeployedAddresses().svm.programs.kitchen.programId;

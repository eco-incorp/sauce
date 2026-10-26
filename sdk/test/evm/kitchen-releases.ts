/**
 * The released Kitchen made to mint what a Pot-guard suite needs, on a local anvil with the released
 * gated stack (`cli-anvil.ts`): its proxy pointed, for a while, at another implementation through
 * its EIP-1967 slot, and back after.
 *
 * `MispredictingKitchen` (`fixtures/`) puts every Pot at {@link ELSEWHERE}, an address with no
 * code, and reports the Pot init-code hash it is given: an older release's, as a chain whose Kitchen
 * was not upgraded yet answers, or one no release records, as a Kitchen newer than the SDK answers.
 * `OldPotDeployer` (`fixtures/`) mints a kitchen-evm 1.2.0 Pot (compiler 2.5.0) AT the Kitchen's own
 * address, from the released creation code `fixtures/pot-kitchen-evm-1.2.0.json` pins: a Pot an SDK
 * of that release deployed, whose release `pots.ts` tells from the chain.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concat,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  pad,
  stringToBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  v12KitchenAddress,
  v12KitchenImplementationAddress,
  v12ReleaseSet,
  v12RouterAddress,
} from "../../src/deployments/index.js";
import type { LocalChain } from "../cli-anvil.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(name: string): T =>
  JSON.parse(readFileSync(join(HERE, "fixtures", name), "utf8")) as T;

const MISPREDICTING = json<{ abi: Abi; creationCode: Hex }>("MispredictingKitchen.json");
const OLD_POT = json<{ version: string; creationCode: Hex }>("pot-kitchen-evm-1.2.0.json");
const OLD_POT_DEPLOYER = json<{ abi: Abi; creationCode: Hex }>("OldPotDeployer.json");

/** EIP-1967's implementation slot, which the Kitchen's UUPS proxy delegates through. */
export const IMPLEMENTATION_SLOT: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** Where the mispredicting Kitchen says every Pot is: an address with no code. */
export const ELSEWHERE = getAddress("0x00000000000000000000000000000000005e1f00");

/** A Pot init-code hash no release records: what a Kitchen newer than the SDK reports. */
export const UNKNOWN_POT_HASH = keccak256(stringToBytes("a Pot release no SDK records"));

/** The release the old Pot is of: compiler 2.5.0's row of `releases.json`. */
export const OLD_RELEASE = v12ReleaseSet("2.5.0");

/** Runs `body` with the Kitchen proxy delegating to `implementation`, then the release's again. */
export async function withKitchenImplementation<T>(
  local: LocalChain,
  implementation: Address,
  body: () => Promise<T>,
): Promise<T> {
  const kitchen = getAddress(v12KitchenAddress());
  await local.testClient.setStorageAt({
    address: kitchen,
    index: IMPLEMENTATION_SLOT,
    value: pad(implementation),
  });
  try {
    return await body();
  } finally {
    await local.testClient.setStorageAt({
      address: kitchen,
      index: IMPLEMENTATION_SLOT,
      value: pad(getAddress(v12KitchenImplementationAddress())),
    });
  }
}

/** Deploys a Kitchen implementation that predicts every Pot elsewhere and reports `potInitCodeHash`. */
export const plantMispredictingKitchen = (local: LocalChain, potInitCodeHash: Hex) =>
  local.plant(
    encodeDeployData({
      abi: MISPREDICTING.abi,
      bytecode: MISPREDICTING.creationCode,
      args: [getAddress(v12KitchenImplementationAddress()), ELSEWHERE, potInitCodeHash],
    }),
  );

/**
 * Mints `owner`'s kitchen-evm 1.2.0 Pot at `salt`, at the Kitchen's own address as that release's
 * Kitchen did: `CREATE2(kitchen, keccak256(abi.encode(owner, salt)), keccak256(initCode))`, its
 * `kitchen()` the Kitchen proxy. The deployer's two storage words (its owner and salt) are written
 * in the proxy's storage while it runs there, and put back after. Returns the Pot's address.
 */
export async function mintOldReleasePot(
  local: LocalChain,
  owner: Address,
  salt: Hex,
): Promise<Address> {
  const kitchen = getAddress(v12KitchenAddress());
  if (keccak256(OLD_POT.creationCode) !== OLD_RELEASE["kitchen-evm"].potInitCodeHash) {
    throw new Error(`the kitchen-evm ${OLD_POT.version} Pot fixture is not the release's`);
  }
  const deployer = await local.plant(
    concat([
      OLD_POT_DEPLOYER.creationCode,
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [getAddress(v12RouterAddress()), 0n],
      ),
    ]),
  );
  const slots = [toHex(0, { size: 32 }), toHex(1, { size: 32 })] as const;
  const words = await Promise.all(
    slots.map((slot) => local.publicClient.getStorageAt({ address: kitchen, slot })),
  );
  try {
    await withKitchenImplementation(local, deployer, () =>
      local.send(
        local.deployer,
        kitchen,
        encodeFunctionData({
          abi: OLD_POT_DEPLOYER.abi,
          functionName: "deploy",
          args: [OLD_POT.creationCode, owner, salt],
        }),
      ),
    );
  } finally {
    for (const [index, slot] of slots.entries()) {
      await local.testClient.setStorageAt({
        address: kitchen,
        index: slot,
        value: words[index] ?? toHex(0, { size: 32 }),
      });
    }
  }

  return getCreate2Address({
    from: kitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [getAddress(owner), salt]),
    ),
    bytecodeHash: keccak256(OLD_POT.creationCode),
  });
}

import { decodeFunctionData, getAddress, getCreate2Address, keccak256, type Address } from "viem";
import { v12ReleaseSet } from "../../src/deployments/releases.js";
import { DEFAULT_POT_SALT, v12PotGateSalt } from "../../src/deployments/pot.js";
import {
  potRouterUpdate,
  v12PotAbi,
  type PotRouterClient,
  type EvmPotBindingInput,
} from "../../src/evm/engine.js";

const OWNER = "0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082" as Address;
const OLD_ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const NEW_ROUTER = "0x2222222222222222222222222222222222222222" as Address;
const release = v12ReleaseSet("2.6.0");
const kitchen = getAddress(release["kitchen-evm"].kitchen!);
const gateSalt = v12PotGateSalt(OWNER, DEFAULT_POT_SALT, false);
const POT = getCreate2Address({
  from: kitchen,
  salt: gateSalt,
  bytecodeHash: release["kitchen-evm"].potInitCodeHash as `0x${string}`,
});
const code = "0x6000" as const;
const binding: EvmPotBindingInput = {
  pot: POT,
  owner: OWNER,
  kitchen,
  userSalt: DEFAULT_POT_SALT,
  kind: "private",
  chainId: 1,
  engine: getAddress(release["v12-evm"].engine!),
  compiler: "2.6.0",
  engineCodeHash: keccak256(code),
  router: OLD_ROUTER,
  routerCodeHash: keccak256(code),
  release: { compiler: "2.6.0", "v12-evm": "1.3.0", "kitchen-evm": "1.3.0" },
  wireProfile: "compiler-2.6.0",
  storageProfile: "kitchen-evm-1.3.0",
};

// These unit reads exercise policy only; actual released and candidate runtime tests live in e2e.
const client = (router: Address, target: Address): PotRouterClient => ({
  getChainId: async () => binding.chainId,
  request: async () => {
    throw new Error("Legacy policy fixtures must not run compatibility requests");
  },
  getCode: async () => code,
  readContract: (async ({ address, functionName }: { address: Address; functionName: string }) => {
    if (getAddress(address) === kitchen && functionName === "router") return target;

    return (
      { owner: OWNER, kitchen, userSalt: DEFAULT_POT_SALT, gateSalt, router } as Record<
        string,
        string
      >
    )[functionName];
  }) as PotRouterClient["readContract"],
});

describe("potRouterUpdate explicit service policy", () => {
  it("requires an authenticated binding, never a getter-only default", async () => {
    await expect(potRouterUpdate(client(OLD_ROUTER, NEW_ROUTER), POT)).rejects.toThrow(/explicit/);
  });

  it("retains old compiler provenance when proposing an owner-selected Router update", async () => {
    const update = await potRouterUpdate(client(OLD_ROUTER, NEW_ROUTER), POT, binding);
    expect(update?.to).toBe(POT);
    expect(decodeFunctionData({ abi: v12PotAbi, data: update!.data }).args).toEqual([NEW_ROUTER]);
  });

  it("returns nothing when the explicitly pinned Router already matches", async () => {
    expect(await potRouterUpdate(client(OLD_ROUTER, OLD_ROUTER), POT, binding)).toBeUndefined();
  });

  it("rejects changed runtime before offering an owner signature", async () => {
    await expect(
      potRouterUpdate(client(OLD_ROUTER, NEW_ROUTER), POT, {
        ...binding,
        codeHash: DEFAULT_POT_SALT,
      }),
    ).rejects.toThrow(/code hash changed/);
  });
});

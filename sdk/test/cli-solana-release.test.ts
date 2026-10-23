/**
 * The Solana release check, offline: a cluster's engine and Kitchen read through an injected
 * reader, held to the release's binaries as the upgradeable loader and any other loader lay them
 * out, and every way a cluster can fail it.
 */
import { getAddressEncoder } from "@solana/kit";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import {
  deployedProgram,
  isReleasedProgram,
  packagedRelease,
  requireSolanaRelease,
  type ProgramAccount,
  type ReadProgram,
  type ReleasedPrograms,
} from "../src/cli/solana-release.js";

const UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111";
const LOADER_V2 = "BPFLoader2111111111111111111111111111111111";
const ENGINE = v12SvmEngineProgramId();
const KITCHEN = v12SvmKitchenProgramId();
/** Two accounts no program id is, for the programdata accounts. */
const ENGINE_DATA = "11111111111111111111111111111112";
const KITCHEN_DATA = "11111111111111111111111111111113";

const RELEASE: ReleasedPrograms = {
  engine: [Uint8Array.of(0x7f, 1, 2, 3), Uint8Array.of(0x7f, 9, 9)],
  // Ends in a zero byte: the comparison must not read it as padding.
  kitchen: Uint8Array.of(0x7f, 4, 5, 0),
};

/** The upgradeable loader's two accounts: the program, naming its programdata, and the programdata. */
function upgradeable(program: Uint8Array, programData: string, padding = 0): ProgramAccount[] {
  const account = new Uint8Array(36);
  new DataView(account.buffer).setUint32(0, 2, true);
  account.set(getAddressEncoder().encode(programData as never), 4);
  const data = new Uint8Array(45 + program.length + padding);
  new DataView(data.buffer).setUint32(0, 3, true);
  data.set(program, 45);

  return [
    { owner: UPGRADEABLE, data: account },
    { owner: UPGRADEABLE, data },
  ];
}

const reader =
  (accounts: Record<string, ProgramAccount | undefined>): ReadProgram =>
  async (address) =>
    accounts[address];

function cluster(engine: Uint8Array, kitchen: Uint8Array, padding = 0): ReadProgram {
  const [engineAccount, engineData] = upgradeable(engine, ENGINE_DATA, padding);
  const [kitchenAccount, kitchenData] = upgradeable(kitchen, KITCHEN_DATA, padding);

  return reader({
    [ENGINE]: engineAccount,
    [ENGINE_DATA]: engineData,
    [KITCHEN]: kitchenAccount,
    [KITCHEN_DATA]: kitchenData,
  });
}

const refusal = (name: string, program: string) =>
  `the released ${name} ${program} is not deployed on solana: this SDK's cook cannot run there`;

describe("the Solana release check", () => {
  it("passes a cluster running the release's engine and Kitchen, padded as programdata is", async () => {
    await expect(
      requireSolanaRelease(
        cluster(RELEASE.engine[0]!, RELEASE.kitchen, 64),
        ["engine", "Kitchen"],
        "solana",
        RELEASE,
      ),
    ).resolves.toBeUndefined();
    // Either engine build is the release's.
    await expect(
      requireSolanaRelease(
        cluster(RELEASE.engine[1]!, RELEASE.kitchen),
        ["engine", "Kitchen"],
        "solana",
        RELEASE,
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses the release's addresses holding another build of the Kitchen", async () => {
    const old = Uint8Array.of(0x7f, 4, 6, 0);
    await expect(
      requireSolanaRelease(
        cluster(RELEASE.engine[0]!, old),
        ["engine", "Kitchen"],
        "solana",
        RELEASE,
      ),
    ).rejects.toThrow(refusal("Kitchen", KITCHEN));
  });

  it("refuses another engine build first, as the EVM path names the engine first", async () => {
    const old = Uint8Array.of(0x7f, 1, 2, 4);
    await expect(
      requireSolanaRelease(
        cluster(old, Uint8Array.of(1)),
        ["engine", "Kitchen"],
        "solana",
        RELEASE,
      ),
    ).rejects.toThrow(refusal("engine", ENGINE));
  });

  it("refuses an absent program, and a program account whose programdata is gone", async () => {
    await expect(requireSolanaRelease(reader({}), ["engine"], "solana", RELEASE)).rejects.toThrow(
      /has no such program/,
    );
    const [account] = upgradeable(RELEASE.engine[0]!, ENGINE_DATA);
    await expect(
      requireSolanaRelease(reader({ [ENGINE]: account }), ["engine"], "solana", RELEASE),
    ).rejects.toThrow(refusal("engine", ENGINE));
  });

  it("checks only what the cook needs: straight to the engine, no Kitchen", async () => {
    const [engineAccount, engineData] = upgradeable(RELEASE.engine[0]!, ENGINE_DATA);
    await expect(
      requireSolanaRelease(
        reader({ [ENGINE]: engineAccount, [ENGINE_DATA]: engineData }),
        ["engine"],
        "solana",
        RELEASE,
      ),
    ).resolves.toBeUndefined();
  });

  it("reads a program another loader holds in its own account", async () => {
    await expect(
      deployedProgram(reader({ [ENGINE]: { owner: LOADER_V2, data: RELEASE.engine[0]! } }), ENGINE),
    ).resolves.toEqual(RELEASE.engine[0]);
  });

  it("compares by the release's length: zero padding passes, anything else past it does not", () => {
    const released = Uint8Array.of(7, 0);
    expect(isReleasedProgram(Uint8Array.of(7, 0, 0, 0), released)).toBe(true);
    expect(isReleasedProgram(Uint8Array.of(7, 0, 0, 1), released)).toBe(false);
    expect(isReleasedProgram(Uint8Array.of(7), released)).toBe(false);
    expect(isReleasedProgram(Uint8Array.of(8, 0), released)).toBe(false);
  });

  it("takes the release from the packaged binaries, each held to the digest releases.json pins", () => {
    const release = packagedRelease();
    expect(release.engine).toHaveLength(2);
    expect(release.kitchen.length).toBeGreaterThan(0);
  });
});

/**
 * The Solana release check, offline: a cluster's engine and Kitchen read through an injected
 * reader, held to the release's binaries as the upgradeable loader and any other loader lay them
 * out, and every way a cluster can fail it.
 */
import { readFileSync } from "node:fs";

import { getAddressEncoder } from "@solana/kit";

import {
  sdkCompilerVersion,
  v12ReleaseSet,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../src/deployments/index.js";
import {
  deployedProgram,
  isReleasedProgram,
  packagedRelease,
  programsCalled,
  releasedProgramCode,
  requireSolanaRelease,
  type ProgramAccount,
  type ReadProgram,
  type ReleasedPrograms,
} from "../src/cli/solana-release.js";
import { svmEnginePath, svmKitchenPath } from "../src/svm/engine-artifacts.js";
import { elfLength, isPinnedProgram, svmEngineReleases } from "../src/svm/engine-release.js";
import { hasLegacyArtifacts, legacyArtifactsDir } from "./release-arm.js";

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
    { owner: UPGRADEABLE, executable: true, data: account },
    // The programdata account is not itself executable.
    { owner: UPGRADEABLE, executable: false, data },
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
      deployedProgram(
        reader({ [ENGINE]: { owner: LOADER_V2, executable: true, data: RELEASE.engine[0]! } }),
        ENGINE,
      ),
    ).resolves.toEqual(RELEASE.engine[0]);
  });

  it("refuses the release's bytes in an account that is no program: not executable, or no BPF loader's", async () => {
    for (const account of [
      { owner: LOADER_V2, executable: false, data: RELEASE.engine[0]! },
      { owner: "11111111111111111111111111111111", executable: true, data: RELEASE.engine[0]! },
      {
        owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        executable: false,
        data: RELEASE.engine[0]!,
      },
    ]) {
      await expect(deployedProgram(reader({ [ENGINE]: account }), ENGINE)).resolves.toBeUndefined();
      await expect(
        requireSolanaRelease(reader({ [ENGINE]: account }), ["engine"], "solana", RELEASE),
      ).rejects.toThrow(refusal("engine", ENGINE));
    }
    // An upgradeable program account that is not executable is no program either.
    const [program, programData] = upgradeable(RELEASE.engine[0]!, ENGINE_DATA);
    await expect(
      deployedProgram(
        reader({ [ENGINE]: { ...program!, executable: false }, [ENGINE_DATA]: programData }),
        ENGINE,
      ),
    ).resolves.toBeUndefined();
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

describe("a deployed program held to its release's digest", () => {
  const set = v12ReleaseSet();
  const programs = [
    ["engine-devnet.so", svmEnginePath("devnet"), set["v12-svm"].assets["engine-devnet.so"]!],
    ["engine-mainnet.so", svmEnginePath("mainnet"), set["v12-svm"].assets["engine-mainnet.so"]!],
    ["kitchen.so", svmKitchenPath(), set["kitchen-svm"].assets["kitchen.so"]!],
  ] as const;
  /** Another release's digest of the same asset: the earlier engine's, or, for the Kitchen
   *  (which both releases share), the engine's. */
  const another = (name: string, digest: string): string =>
    name === "kitchen.so"
      ? set["v12-svm"].assets["engine-devnet.so"]!
      : (v12ReleaseSet("2.6.2")["v12-svm"].assets[name] ?? digest);

  it.each(programs)(
    "%s: its length is its header's; only zero padding after it, and its own digest, pass",
    (name, file, digest) => {
      const elf = new Uint8Array(readFileSync(file));
      expect(elfLength(elf)).toBe(elf.length);
      const padded = new Uint8Array(elf.length + 100);
      padded.set(elf);
      expect(elfLength(padded)).toBe(elf.length);
      expect(isPinnedProgram(elf, [digest])).toBe(true);
      expect(isPinnedProgram(padded, [digest])).toBe(true);
      const dirty = padded.slice();
      dirty[dirty.length - 1] = 1;
      expect(isPinnedProgram(dirty, [digest])).toBe(false);
      expect(isPinnedProgram(padded, [another(name, digest)])).toBe(false);
      expect(isPinnedProgram(elf.subarray(0, elf.length - 1), [digest])).toBe(false);
      expect(isPinnedProgram(padded, [])).toBe(false);
    },
  );

  it("has no length for bytes that are no ELF64 little-endian object, or whose header outruns them", () => {
    expect(elfLength(new Uint8Array(100))).toBeUndefined();
    expect(elfLength(Uint8Array.of(0x7f, 0x45, 0x4c, 0x46))).toBeUndefined();
    const elf = new Uint8Array(readFileSync(svmKitchenPath()));
    expect(elfLength(elf.subarray(0, elf.length - 1))).toBeUndefined();
    const big = elf.slice();
    big[4] = 1;
    expect(elfLength(big)).toBeUndefined();
    expect(
      isPinnedProgram(
        big,
        programs.map(([, , digest]) => digest),
      ),
    ).toBe(false);
  });
});

describe("the engines a transaction calls", () => {
  const EARLIER = "53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW";
  /** v12-svm 1.3.0's engine: no release of this SDK's compiler runs on it. */
  const OLD = "2HH8xZ7ZN8SSDD8B3ALYANTVKBbMKGxTzjX7LTzvtSzT";

  it("lists every release engine among the programs, and needs the Kitchen where it is there", () => {
    const called = programsCalled([KITCHEN, EARLIER, ENGINE, "11111111111111111111111111111111"]);
    expect([...called.engines].sort()).toEqual([EARLIER, ENGINE].sort());
    expect(called.needs).toEqual(["engine", "Kitchen"]);
    expect(programsCalled([EARLIER])).toEqual({ needs: ["engine"], engines: [EARLIER] });
    expect(programsCalled([KITCHEN])).toEqual({ needs: ["Kitchen"], engines: [] });
    expect(programsCalled(["11111111111111111111111111111111"])).toEqual({
      needs: [],
      engines: [],
    });
    expect([...svmEngineReleases().keys()]).toEqual(expect.arrayContaining([EARLIER, ENGINE, OLD]));
  });

  it("holds an earlier release's engine to that release's digests: absent, or another build, is refused by name", async () => {
    await expect(
      requireSolanaRelease(reader({}), ["engine"], "solana", RELEASE, [EARLIER]),
    ).rejects.toThrow(
      `the engine ${EARLIER} (v12-svm 1.4.0) is not deployed on solana as that release's build: ` +
        "the cluster has no such program. Nothing was simulated, built or sent",
    );
    const [program, programData] = upgradeable(RELEASE.engine[0]!, ENGINE_DATA);
    await expect(
      requireSolanaRelease(
        reader({ [EARLIER]: program, [ENGINE_DATA]: programData }),
        ["engine"],
        "solana",
        RELEASE,
        [EARLIER],
      ),
    ).rejects.toThrow("the program there is not that release's engine");
  });

  it("refuses an engine whose programs do not run this SDK's, saying what it runs and what pairs with it", async () => {
    await expect(
      requireSolanaRelease(reader({}), ["engine"], "solana", RELEASE, [OLD]),
    ).rejects.toThrow(
      `the engine ${OLD} (v12-svm 1.3.0), which runs compiler 2.4.0, 2.5.0 output: this SDK ` +
        `compiles with compiler ${sdkCompilerVersion()}`,
    );
    await expect(
      requireSolanaRelease(reader({}), ["engine"], "solana", RELEASE, [OLD]),
    ).rejects.toThrow(
      /@eco-incorp\/sauce \d+\.\d+\.\d+ (?:to \d+\.\d+\.\d+ )?pairs? with that engine/,
    );
  });

  it("refuses a program no release names as an engine, and checks each engine given", async () => {
    const nobody = "11111111111111111111111111111112";
    await expect(
      requireSolanaRelease(reader({}), ["engine"], "solana", RELEASE, [nobody]),
    ).rejects.toThrow(`${nobody} is not an engine release this SDK knows`);
    // The installed engine passes where it is the release's; the next one given is checked too.
    const { engine, kitchen } = { engine: RELEASE.engine[0]!, kitchen: RELEASE.kitchen };
    await expect(
      requireSolanaRelease(cluster(engine, kitchen), ["engine"], "solana", RELEASE, [ENGINE, OLD]),
    ).rejects.toThrow(`the engine ${OLD}`);
  });
});

describe("the code a local copy runs", () => {
  const EARLIER = "53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW";
  const OLD = "2HH8xZ7ZN8SSDD8B3ALYANTVKBbMKGxTzjX7LTzvtSzT";
  const real = packagedRelease();

  it("is the packaged build of the cluster's kind for the installed engine, and the Kitchen's, once the cluster runs them", async () => {
    const read = cluster(real.engine[0]!, real.kitchen, 64);
    const devnet = await releasedProgramCode(read, ENGINE, "devnet", "solana");
    const mainnet = await releasedProgramCode(read, ENGINE, "mainnet", "solana");
    expect(Buffer.from(devnet).equals(Buffer.from(real.engine[0]!))).toBe(true);
    expect(Buffer.from(mainnet).equals(Buffer.from(real.engine[1]!))).toBe(true);
    const kitchen = await releasedProgramCode(read, KITCHEN, "mainnet", "solana");
    expect(Buffer.from(kitchen).equals(Buffer.from(real.kitchen))).toBe(true);
  });

  it("refuses the installed engine and Kitchen where the cluster holds another build, never substituting", async () => {
    const read = cluster(Uint8Array.of(0x7f, 1), Uint8Array.of(0x7f, 2));
    await expect(releasedProgramCode(read, ENGINE, "mainnet", "solana")).rejects.toThrow(
      refusal("engine", ENGINE),
    );
    await expect(releasedProgramCode(read, KITCHEN, "mainnet", "solana")).rejects.toThrow(
      refusal("Kitchen", KITCHEN),
    );
  });

  it("needs an earlier release's engine as the cluster holds it: another build, none, or a program that does not run this SDK's is refused", async () => {
    const refused = "needs that engine's own code, and solana does not run that release's build";
    // Another build at its address.
    const [program, programData] = upgradeable(Uint8Array.of(0x7f, 1), ENGINE_DATA);
    await expect(
      releasedProgramCode(
        reader({ [EARLIER]: program, [ENGINE_DATA]: programData }),
        EARLIER,
        "devnet",
        "solana",
      ),
    ).rejects.toThrow(refused);
    // None there.
    await expect(releasedProgramCode(reader({}), EARLIER, "mainnet", "solana")).rejects.toThrow(
      refused,
    );
    // An engine this SDK's programs do not run on, and a program no release names.
    await expect(releasedProgramCode(reader({}), OLD, "mainnet", "solana")).rejects.toThrow(
      refused,
    );
    await expect(
      releasedProgramCode(reader({}), "11111111111111111111111111111112", "mainnet", "solana"),
    ).rejects.toThrow(refused);
  });

  // The earlier engine's own ELF is a suite input like the legacy arm's: absent, a local run skips
  // and CI fails.
  const present = hasLegacyArtifacts("svm");
  if (!present && process.env.CI) {
    throw new Error(
      "the earlier Solana engine's artifacts are absent in CI (sync-engine-artifacts)",
    );
  }
  (present ? it : it.skip)(
    "is the cluster's own bytes, without the account's zero padding, for the earlier engine as its release built it",
    async () => {
      const elf = new Uint8Array(readFileSync(`${legacyArtifactsDir("svm")}/svm/engine-devnet.so`));
      const [program, programData] = upgradeable(elf, ENGINE_DATA, 64);
      const read = reader({ [EARLIER]: program, [ENGINE_DATA]: programData });
      const code = await releasedProgramCode(read, EARLIER, "devnet", "solana");
      expect(Buffer.from(code).equals(Buffer.from(elf))).toBe(true);
      // The mainnet build is another ELF: a copy for a mainnet cluster refuses the devnet one.
      await expect(releasedProgramCode(read, EARLIER, "mainnet", "solana")).rejects.toThrow(
        "needs that engine's own code",
      );
      await expect(
        requireSolanaRelease(read, ["engine"], "solana", RELEASE, [EARLIER]),
      ).resolves.toBeUndefined();
    },
  );
});

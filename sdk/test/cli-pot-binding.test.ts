import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, pad, type PublicClient } from "viem";
import { requireChain } from "../src/chains/canonical.js";
import { cookOf } from "../src/cli/commands.js";
import { keeping } from "../src/cli/keep.js";
import { POT_SCHEMA, PotStore } from "../src/cli/pot-store.js";
import {
  sdkCompilerVersion,
  v12EngineAddress,
  v12KitchenAddress,
} from "../src/deployments/index.js";
import {
  executionEngine,
  getVerifiedPotBinding,
  readPotCandidate,
  requestedPotBinding,
  resolvePotTarget,
  verifyRecordedPot,
  withPotBinding,
} from "../src/cli/pot-binding.js";
import type { EvmPotBindingInput } from "../src/evm/engine.js";

// Persisted compiler selection must fail before compiling with a different installed compiler.
it("does not compile ordinary work for a persisted Pot with the SDK default compiler", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sauce-pinned-compiler-"));
  try {
    const store = new PotStore(dir);
    const pot = getAddress("0x1111111111111111111111111111111111111111");
    store.save({
      schema: POT_SCHEMA,
      chain: "base",
      chainId: 8453,
      pot,
      owner: getAddress("0x2222222222222222222222222222222222222222"),
      salt: pad("0x00", { size: 32 }),
      kind: "private",
      kitchen: v12KitchenAddress(),
      engine: v12EngineAddress(),
      release: { compiler: `${sdkCompilerVersion()}-different` },
      sdk: "0.0.0",
      origin: "imported",
      recordedAt: "2026-10-31T00:00:00.000Z",
    });
    await keeping({ stores: { pots: store }, say: () => undefined }, async () => {
      expect(() =>
        cookOf(
          {
            chain: requireChain("base"),
            target: { pot },
            file: "unused.sauce",
            text: "",
            defines: {},
          },
          { readText: () => "", readModule: () => undefined },
        ),
      ).toThrow(/compiler/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses incomplete explicit release provenance before using a descriptor", () => {
  const descriptor = {
    compiler: "2.6.1",
    engine: v12EngineAddress(),
    kitchen: v12KitchenAddress(),
    engineCodeHash: `0x${"11".repeat(32)}`,
    router: v12EngineAddress(),
    routerCodeHash: `0x${"22".repeat(32)}`,
    wireProfile: "compiler:2.6.1",
    storageProfile: "sauce.storage.Pot",
    release: {},
  };
  expect(() => readPotCandidate(JSON.stringify(descriptor))).toThrow(/release/);
  expect(() =>
    readPotCandidate(
      JSON.stringify({
        ...descriptor,
        release: { compiler: "wrong", "v12-evm": "1.0.0", "kitchen-evm": "1.0.0" },
      }),
    ),
  ).toThrow(/compiler/);
});

it("accepts an owner-controlled Router selection without rewriting its release Router", () => {
  const descriptor = {
    compiler: "2.6.1",
    engine: v12EngineAddress(),
    kitchen: v12KitchenAddress(),
    engineCodeHash: `0x${"11".repeat(32)}`,
    router: "0x2222222222222222222222222222222222222222",
    routerCodeHash: `0x${"22".repeat(32)}`,
    wireProfile: "compiler:2.6.1",
    storageProfile: "sauce.storage.Pot",
    profile: {},
    release: {
      compiler: "2.6.1",
      "v12-evm": "1.0.0",
      "kitchen-evm": "1.0.0",
      router: "0x1111111111111111111111111111111111111111",
    },
  };
  expect(readPotCandidate(JSON.stringify(descriptor))).toEqual(descriptor);
});

it("keeps explicit request selection isolated and never exposes an unverified proof", async () => {
  const input: EvmPotBindingInput = {
    pot: getAddress("0x1111111111111111111111111111111111111111"),
    owner: getAddress("0x2222222222222222222222222222222222222222"),
    kitchen: getAddress(v12KitchenAddress()),
    userSalt: pad("0x00", { size: 32 }),
    kind: "private",
    chainId: 8453,
    compiler: sdkCompilerVersion(),
    engine: getAddress("0x3333333333333333333333333333333333333333"),
    engineCodeHash: pad("0x01", { size: 32 }),
    router: getAddress(v12EngineAddress()),
    routerCodeHash: pad("0x02", { size: 32 }),
    wireProfile: "request-wire",
    storageProfile: "request-storage",
    release: { compiler: sdkCompilerVersion(), "v12-evm": "LOCAL", "kitchen-evm": "LOCAL" },
  };
  const client = {
    getChainId: async () => 8453,
    getCode: async () => undefined,
  } as unknown as PublicClient;
  await withPotBinding(input, async () => {
    expect(requestedPotBinding()).toEqual(input);
    expect(resolvePotTarget(8453, { owner: input.owner, salt: input.userSalt })).toBe(input.pot);
    expect(executionEngine(8453, input.pot)).toBe(input.engine);
    expect(getVerifiedPotBinding()).toBeUndefined();
    await expect(verifyRecordedPot(client, 8453, input.pot)).rejects.toThrow(/code|binding/);
    expect(getVerifiedPotBinding()).toBeUndefined();
    await withPotBinding(undefined, async () => {
      expect(requestedPotBinding()).toBeUndefined();
      expect(getVerifiedPotBinding()).toBeUndefined();
    });
    expect(requestedPotBinding()).toEqual(input);
  });
  const dir = mkdtempSync(join(tmpdir(), "sauce-request-pins-"));
  try {
    const store = new PotStore(dir);
    store.save({
      schema: POT_SCHEMA,
      chain: "base",
      chainId: input.chainId,
      pot: input.pot,
      owner: input.owner,
      salt: input.userSalt,
      kind: input.kind,
      kitchen: input.kitchen,
      engine: input.engine,
      release: input.release,
      sdk: "test",
      origin: "imported",
      recordedAt: "2026-10-31T00:00:00.000Z",
    });
    await keeping({ stores: { pots: store }, say: () => undefined }, async () => {
      await withPotBinding({ ...input, engine: getAddress(v12EngineAddress()) }, async () => {
        expect(() => executionEngine(8453, input.pot)).toThrow(/persisted Pot pins/);
        expect(getVerifiedPotBinding()).toBeUndefined();
      });
      expect(store.recordsOf(8453, input.pot)[0]!.engine).toBe(input.engine);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(requestedPotBinding()).toBeUndefined();
  expect(getVerifiedPotBinding()).toBeUndefined();
});

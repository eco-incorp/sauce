/** Gas suggestions rehearse only an authenticated deployed Pot and its preceding transfers. */
import { join } from "node:path";
import type { PublicClient } from "viem";

import { planGas } from "../src/cli/commands.js";
import { rehearse, type Rehearsal, type RehearsalInput } from "../src/cli/rehearse.js";
import { CLI_FIXTURES, sauce } from "./cli-anvil.js";

const OWNER = "0x5555555555555555555555555555555555555555";
const POT = "0x7777777777777777777777777777777777777777";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const cook = { to: POT, data: "0x1234", value: 1000n } as const;
const client = {} as PublicClient;
const base = { path: "eth_simulateV1", notes: [] } as const;
const answering = (result: Rehearsal | Error) => async (): Promise<Rehearsal> => {
  if (result instanceof Error) throw result;
  return result;
};

describe("gas on an authenticated deployed Pot", () => {
  it("adds 30% room to the cook without inventing a deployment transaction", async () => {
    const gas = await planGas(
      client,
      { owner: OWNER },
      cook,
      answering({
        ...base,
        ok: true,
        returns: "0x",
        gas: 128_999n,
        beforeGas: [],
        gasKind: "used",
        traced: true,
      }),
    );
    expect(gas.cook).toBe(167_698n);
    expect(gas).not.toHaveProperty("deploy");
    expect(gas.note).toContain("30% room");
    expect(gas.note).not.toMatch(/deployment|no code/);
  });

  it("preserves transfer order and suggests each transfer's gas separately", async () => {
    const before = [
      {
        what: "transfer 100 USDC to the Pot",
        tx: { to: USDC, data: "0xa9059cbb", value: 0n },
      },
    ] as const;
    let asked: RehearsalInput | undefined;
    const gas = await planGas(client, { owner: OWNER, before }, cook, async (_, input) => {
      asked = input;
      return {
        ...base,
        ok: true,
        returns: "0x",
        gas: 128_999n,
        beforeGas: [40_000n],
        gasKind: "used",
        traced: true,
      };
    });
    expect(asked).toEqual({ owner: OWNER, pot: POT, before, cook, overrides: [] });
    expect(gas.before).toEqual([52_000n]);
    expect(gas.cook).toBe(167_698n);
    expect(gas).not.toHaveProperty("deploy");
    expect(gas.note).toContain("transfers");
  });

  it("suggests no gas when a preceding transfer fails", async () => {
    const gas = await planGas(
      client,
      { owner: OWNER },
      cook,
      answering({
        ...base,
        ok: false,
        stage: "before",
        what: "transfer 100 USDC to the Pot",
        reason: "ERC20: transfer amount exceeds balance",
      }),
    );
    expect(gas.cook).toBeUndefined();
    expect(gas.before).toBeUndefined();
    expect(gas.note).toContain("transfer 100 USDC to the Pot would revert");
    expect(gas.note).toContain("the owner must hold what it transfers");
  });

  it("reports a reverting cook without suggesting deployment or replacement", async () => {
    const gas = await planGas(
      client,
      { owner: OWNER },
      cook,
      answering({
        ...base,
        ok: false,
        stage: "cook",
        reason: "ERC20InsufficientBalance",
      }),
    );
    expect(gas.cook).toBeUndefined();
    expect(gas.note).toContain("ERC20InsufficientBalance");
    expect(gas.note).not.toMatch(/deploy|no code/);
  });

  it("does not invent gas when the endpoint cannot estimate it", async () => {
    const gas = await planGas(
      client,
      { owner: OWNER },
      cook,
      answering({
        ...base,
        path: "eth_call",
        ok: true,
        returns: "0x",
        beforeGas: [],
        gasKind: "estimated",
        traced: false,
      }),
    );
    expect(gas.cook).toBeUndefined();
    expect(gas.note).toContain("could not estimate");
    expect(gas.note).not.toMatch(/deploy|no code/);
  });

  it("reports transport failure without fabricating an estimate", async () => {
    const gas = await planGas(
      client,
      { owner: OWNER },
      cook,
      answering(new Error("RPC unavailable\nprivate details")),
    );
    expect(gas.cook).toBeUndefined();
    expect(gas.note).toContain("RPC unavailable");
    expect(gas.note).not.toContain("private details");
  });

  it("refuses explicit counterfactual rehearsal before any RPC", async () => {
    const result = await rehearse(client, {
      owner: OWNER,
      pot: POT,
      deploy: { salt: `0x${"00".repeat(32)}` },
      cook,
      overrides: [{ address: POT, balance: 10n }],
    });
    expect(result).toMatchObject({ ok: false, stage: "deploy" });
    expect(!result.ok && result.reason).toMatch(/Explicitly deploy, verify and persist/);
  });

  it("refuses offline transaction construction even with an explicit value", async () => {
    const result = await sauce(
      "tx",
      join(CLI_FIXTURES, "pay.sauce.ts"),
      "--chain",
      "ethereum",
      "--owner",
      OWNER,
      "--args-json",
      JSON.stringify([POT, "1"]),
      "--value",
      "1000",
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("requires an RPC endpoint and an authenticated deployed Pot");
    expect(result.stdout).toBe("");
  });
});

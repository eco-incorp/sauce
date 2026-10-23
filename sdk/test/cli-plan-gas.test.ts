/**
 * The gas `sauce tx` suggests for a plan that deploys the Pot, then cooks (`commands.ts#planGas`),
 * with the owner's `--fund` transfers between them, or alone before the cook on a Pot already there,
 * from each thing the simulation of the two can answer: both ran (each with 30% room, the cook's
 * as if the deployment had landed), both ran with the deployment's gas not reported apart (the cook's
 * alone, and why), the deployment reverts (no gas for either), the cook reverts
 * after it (no gas, and why), the endpoint could not estimate, or could not simulate at all (the
 * plan stands without). And with no endpoint there is no plan to give gas to: the cook alone.
 */
import { join } from "node:path";
import type { PublicClient } from "viem";

import { planGas } from "../src/cli/commands.js";
import type { Rehearsal } from "../src/cli/rehearse.js";
import { CLI_FIXTURES, jsonOf, sauce } from "./cli-anvil.js";

const OWNER = "0x5555555555555555555555555555555555555555";
const POT = "0x7777777777777777777777777777777777777777";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const target = { owner: OWNER, salt: `0x${"00".repeat(32)}` } as const;
const cook = { to: POT, data: "0x1234", value: 1000n } as const;
const client = {} as PublicClient;
const answering = (rehearsal: Rehearsal | Error) => async (): Promise<Rehearsal> => {
  if (rehearsal instanceof Error) throw rehearsal;

  return rehearsal;
};
const base = { path: "eth_simulateV1", notes: [] } as const;

describe("the gas sauce tx suggests for a plan's deployment and cook", () => {
  it("gives each the gas the simulation used, with 30% room, the cook's after the deployment", async () => {
    const gas = await planGas(
      client,
      target,
      cook,
      answering({
        ...base,
        ok: true,
        returns: "0x",
        gas: 128_999n,
        deployGas: 160_415n,
        beforeGas: [],
        gasKind: "used",
        traced: true,
      }),
    );
    expect(gas.deploy).toBe(208_539n);
    expect(gas.cook).toBe(167_698n);
    expect(gas.note).toMatch(
      /the cook's, 167698, is estimated as if the deployment had landed \(128999 used, simulated after it\), with 30% room/,
    );
  });

  it("gives the cook its gas alone when the endpoint does not report the deployment's apart", async () => {
    const gas = await planGas(
      client,
      target,
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
    expect(gas.deploy).toBeUndefined();
    expect(gas.cook).toBe(167_698n);
    expect(gas.note).toMatch(
      /The deployment carries no gas: the endpoint did not report it apart, and a signer's own estimate of it is right, as the Kitchen it calls has code$/,
    );
  });

  it("gives neither when the Pot's deployment would revert", async () => {
    const gas = await planGas(
      client,
      target,
      cook,
      answering({ ...base, ok: false, stage: "deploy", reason: "PotExists()" }),
    );
    expect(gas.deploy).toBeUndefined();
    expect(gas.cook).toBeUndefined();
    expect(gas.note).toBe(
      "the Pot's deployment would revert (PotExists()), so no gas is suggested",
    );
  });

  it("gives the cook none when it would revert after the deployment, and says to fund the Pot", async () => {
    const gas = await planGas(
      client,
      target,
      cook,
      answering({ ...base, ok: false, stage: "cook", reason: "ERC20InsufficientBalance" }),
    );
    expect(gas.cook).toBeUndefined();
    expect(gas.note).toMatch(
      /^the cook is given no gas: simulated after the deployment, on the chain as it is, it would revert \(ERC20InsufficientBalance\)\. Fund the Pot first/,
    );
  });

  it("gives none when the endpoint ran the cook but could not estimate it", async () => {
    const gas = await planGas(
      client,
      target,
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
    expect(gas.note).toMatch(
      /^the endpoint could not estimate the cook after the deployment: sign/,
    );
  });

  it("leaves the plan as it is when the endpoint cannot simulate the two", async () => {
    const gas = await planGas(
      client,
      target,
      cook,
      answering(new Error("the endpoint serves neither eth_simulateV1 nor state overrides\nmore")),
    );
    expect(gas.cook).toBeUndefined();
    expect(gas.note).toBe(
      "the endpoint could not simulate the cook after the deployment (the endpoint serves " +
        "neither eth_simulateV1 nor state overrides): sign the cook with a gas limit that has " +
        "room, or once the deployment has landed: a signer's own estimate, taken while the Pot " +
        "has no code, is far too low",
    );
  });

  it("gives the transfers before the cook theirs, and simulates them in what lands first", async () => {
    let asked: Parameters<typeof planGas>[1] | undefined;
    const before = [
      { what: "transfer 100 USDC to the Pot", tx: { to: USDC, data: "0xa9059cbb", value: 0n } },
    ] as const;
    const gas = await planGas(client, { ...target, before }, cook, async (_, input) => {
      asked = { owner: input.owner, ...(input.deploy ?? {}), before: input.before ?? [] };

      return {
        ...base,
        ok: true,
        returns: "0x",
        gas: 128_999n,
        deployGas: 160_415n,
        beforeGas: [40_000n],
        gasKind: "used",
        traced: true,
      };
    });
    expect(asked).toEqual({ owner: OWNER, salt: target.salt, before });
    expect([gas.deploy, gas.before, gas.cook]).toEqual([208_539n, [52_000n], 167_698n]);
    expect(gas.note).toMatch(
      /as if the deployment and the transfers had landed \(128999 used, simulated after them\)/,
    );
    // On a Pot already there, the transfers alone come first.
    const deployed = await planGas(
      client,
      { owner: OWNER, before },
      cook,
      answering({
        ...base,
        ok: true,
        returns: "0x",
        gas: 128_999n,
        beforeGas: [40_000n],
        gasKind: "used",
        traced: true,
      }),
    );
    expect([deployed.deploy, deployed.before, deployed.cook]).toEqual([
      undefined,
      [52_000n],
      167_698n,
    ]);
    expect(deployed.note).toMatch(/as if the transfers had landed/);
    expect(deployed.note).not.toMatch(/The deployment carries no gas/);
  });

  it("gives no gas when a transfer would revert, and says the owner must hold it", async () => {
    const gas = await planGas(
      client,
      {
        owner: OWNER,
        before: [{ what: "transfer 100 USDC to the Pot", tx: { to: USDC, data: "0x", value: 0n } }],
      },
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
    expect(gas.note).toBe(
      "transfer 100 USDC to the Pot would revert (ERC20: transfer amount exceeds balance), so no " +
        "gas is suggested: the owner must hold what it transfers",
    );
  });

  it("has no plan to give gas to with no endpoint: the cook alone, with no gas", async () => {
    const run = await sauce(
      ...["tx", join(CLI_FIXTURES, "pay.sauce.ts"), "--chain", "ethereum", "--owner", OWNER],
      ...["--args-json", JSON.stringify([POT, "1"]), "--value", "1000"],
    );
    const out = jsonOf(run);
    expect(run.stderr).toContain("Release availability is NOT verified: no RPC endpoint was given");
    expect(out).toMatchObject({ chainId: 1, value: "0x3e8" });
    expect(out.transactions).toBeUndefined();
    expect(out.gas).toBeUndefined();
  });
});

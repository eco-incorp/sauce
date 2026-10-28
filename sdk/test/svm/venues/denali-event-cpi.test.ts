/**
 * Denali's upgraded `SwapExactIn` (program redeployed at slot 454,575,418) takes Anchor's
 * `#[event_cpi]` accounts after the swap's 12: the event authority, the program's
 * `["__event_authority"]` PDA, then the program itself, both read-only. The SDK's account order ends
 * with them in that order, and the event authority it records is the derived PDA.
 */
import { getProgramDerivedAddress } from "@solana/kit";

import {
  ROUTER_SVM_VENUES,
  routerSvmAccountOrder,
  routerSvmAccounts,
} from "../../../src/svm/router-accounts.js";
import { routerSvmDataTemplate } from "../../../src/svm/router-data.js";
import { DENALI_EVENT_AUTHORITY, DENALI_PROGRAM_ID } from "../../../src/svm/venues/denali/index.js";

describe("Denali's event-CPI accounts", () => {
  it("records the program's __event_authority PDA", async () => {
    const [derived] = await getProgramDerivedAddress({
      programAddress: DENALI_PROGRAM_ID,
      seeds: [new TextEncoder().encode("__event_authority")],
    });
    expect(DENALI_EVENT_AUTHORITY).toBe(derived);
    expect(ROUTER_SVM_VENUES.denali.program).toBe(DENALI_PROGRAM_ID);
  });

  it.each([true, false])(
    "preserves the twelve swap accounts and appends read-only event accounts (aToB %s)",
    (aToB) => {
      // Independent of the vector and the implementation's order: only the user's A/B accounts
      // switch with direction; the pool accounts and their privileges never do.
      const names = [
        "authority",
        "pool",
        "mintA",
        "mintB",
        "vaultA",
        "vaultB",
        "tokenProgramA",
        "tokenProgramB",
        "oracle",
        "globalConfig",
        aToB ? "source" : "recipient",
        aToB ? "recipient" : "source",
        "eventAuthority",
        "program",
      ];
      const expected = names.map((name, i) => ({
        name,
        writable: [1, 4, 5, 10, 11].includes(i),
        signer: i === 0,
      }));
      expect(routerSvmAccountOrder("denali", { aToB })).toEqual(expected);
      const refs: Record<string, string> = {
        ...Object.fromEntries(names.map((name) => [name, `ref:${name}`])),
        eventAuthority: DENALI_EVENT_AUTHORITY,
        program: DENALI_PROGRAM_ID,
      };
      expect(routerSvmAccounts("denali", { aToB }, refs)).toEqual(
        expected.map((role) => ({ ...role, ref: refs[role.name] })),
      );
    },
  );

  it.each([true, false])("keeps the same 25 instruction bytes (aToB %s)", (aToB) => {
    const amountIn = 0x0807060504030201n;
    const minOut = 0x1817161514131211n;
    const template = routerSvmDataTemplate("denali", { aToB, minOut });
    const data = Buffer.concat([
      template.prefix,
      Buffer.from("0102030405060708", "hex"),
      template.suffix,
    ]);
    expect(template.divisor).toBe(1n);
    expect(data.toString("hex")).toBe(
      `68688356a1bdb4d8${aToB ? "00" : "01"}01020304050607081112131415161718`,
    );
    expect(data).toHaveLength(25);
    expect(data.readBigUInt64LE(9)).toBe(amountIn);
    expect(data.readBigUInt64LE(17)).toBe(minOut);
  });
});

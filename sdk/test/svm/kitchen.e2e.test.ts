/**
 * Pot lifecycle against the released `kitchen.so`.
 *
 * One LiteSVM per file, deliberately: two in a process — each loading the kitchen AND the engine —
 * is the shape the intermittent teardown abort followed. Code buffers are
 * `kitchen-buffer.e2e.test.ts`, the cooks are `kitchen-cook.e2e.test.ts`, and the bench they share
 * is `kitchen-bench.ts`.
 */
import {
  buildClosePotInstruction,
  buildCreatePotInstruction,
  derivePotPda,
  MAX_POT_LEN,
} from "../../src/svm/kitchen.js";
import {
  type Bench,
  describeKitchen,
  expectKitchenError,
  expectOk,
  present,
  send,
  start,
  traceTests,
} from "./kitchen-bench.js";

describeKitchen("kitchen: Pot lifecycle on the released kitchen.so", () => {
  traceTests();

  let bench: Bench;

  /** `create_pot` at `salt`. Doubles as the ABSENCE proof — see `expectNothingAt`. */
  const createPot = async (salt: Uint8Array, space: number) => {
    const { address: pot } = await derivePotPda(bench.kitchen, bench.owner.address, salt);

    return {
      pot,
      result: await send(bench, [
        buildCreatePotInstruction({
          kitchen: bench.kitchen,
          owner: bench.owner.address,
          engineProgram: bench.engine,
          pot,
          salt,
          space,
        }),
      ]),
    };
  };

  /**
   * Proves no Pot occupies `salt`, by CREATING one there.
   *
   * Not by reading the address: litesvm aborts the process with a native std::bad_alloc when asked
   * about an account closed in the same VM, whichever accessor is used — `getAccount` and
   * `getBalance` both did, and it reproduced only on CI. Creating succeeds only if the slot is
   * genuinely free, since `create_pot` is not idempotent (the test above pins that), so this states
   * the same fact through the program instead of through the runtime's account table.
   */
  const expectNothingAt = async (salt: Uint8Array) => {
    expectOk((await createPot(salt, 128)).result, "create_pot on a slot expected to be free");
  };

  beforeAll(async () => {
    bench = await start();
  });

  // Released before jest tears the module registry down. The VM is a napi handle over a BPF runtime
  // with two loaded programs, and holding one at module scope — which no other engine suite here
  // does — is the shape the intermittent teardown abort followed.
  afterAll(() => {
    bench = undefined as unknown as Bench;
  });

  it('create_pot allocates ["pot", owner, salt] at the requested space, owned by the named engine', async () => {
    const salt = new Uint8Array(32).fill(7);
    const { address: pot } = await derivePotPda(bench.kitchen, bench.owner.address, salt);

    expectOk(
      await send(bench, [
        buildCreatePotInstruction({
          kitchen: bench.kitchen,
          owner: bench.owner.address,
          engineProgram: bench.engine,
          pot,
          salt,
          space: 512,
        }),
      ]),
      "create_pot",
    );

    const account = present(bench.svm, pot, "the pot");

    expect(account.data.length).toBe(512);
    // The half the title claims and the allocation alone does not show: the kitchen creates the Pot
    // ASSIGNED TO THE ENGINE named in the instruction, which is what lets only that engine debit it.
    expect(account.owner).toBe(bench.engine);
  });

  it("distinct salts derive distinct Pot addresses for one owner", async () => {
    const a = await derivePotPda(bench.kitchen, bench.owner.address, new Uint8Array(32).fill(1));
    const b = await derivePotPda(bench.kitchen, bench.owner.address, new Uint8Array(32).fill(2));

    expect(a.address).not.toBe(b.address);
  });

  it("create_pot is not idempotent — a second create on the same salt fails cleanly", async () => {
    const salt = new Uint8Array(32).fill(9);
    const { address: pot } = await derivePotPda(bench.kitchen, bench.owner.address, salt);
    const create = buildCreatePotInstruction({
      kitchen: bench.kitchen,
      owner: bench.owner.address,
      engineProgram: bench.engine,
      pot,
      salt,
      space: 256,
    });

    expectOk(await send(bench, [create]), "create_pot");
    expect(((await send(bench, [create])) as { err?: unknown }).err).toBeTruthy();
  });

  // `space: 0` is the ONLY way in to the kitchen's own bound. Its upper half is unreachable from
  // outside: MAX_POT_LEN is exactly one MAX_PERMITTED_DATA_INCREASE, so `MAX_POT_LEN + 1` dies in
  // the System Program's realloc cap ("Failed to reallocate account data") before the guard is
  // consulted. Asserting the error BY NAME is what keeps that distinction honest — an `err` check
  // alone passes either way and would report the runtime's refusal as the kitchen's.
  it("rejects a zero space with its own PotSpaceOutOfRange, allocating nothing", async () => {
    const salt = new Uint8Array(32).fill(3);
    const { address: pot } = await derivePotPda(bench.kitchen, bench.owner.address, salt);

    const result = await send(bench, [
      buildCreatePotInstruction({
        kitchen: bench.kitchen,
        owner: bench.owner.address,
        engineProgram: bench.engine,
        pot,
        salt,
        space: 0,
      }),
    ]);

    expectKitchenError(result, "PotSpaceOutOfRange");
    await expectNothingAt(salt);
  });

  it("refuses a space above MAX_POT_LEN too — the runtime's realloc cap gets there first", async () => {
    const salt = new Uint8Array(32).fill(4);
    const { address: pot } = await derivePotPda(bench.kitchen, bench.owner.address, salt);

    const result = await send(bench, [
      buildCreatePotInstruction({
        kitchen: bench.kitchen,
        owner: bench.owner.address,
        engineProgram: bench.engine,
        pot,
        salt,
        space: MAX_POT_LEN + 1,
      }),
    ]);

    expect((result as { err?: unknown }).err).toBeTruthy();
    await expectNothingAt(salt);
  });

  it("close_pot returns the rent and removes the account", async () => {
    const salt = new Uint8Array(32).fill(5);
    const { address: pot } = await derivePotPda(bench.kitchen, bench.owner.address, salt);

    expectOk(
      await send(bench, [
        buildCreatePotInstruction({
          kitchen: bench.kitchen,
          owner: bench.owner.address,
          engineProgram: bench.engine,
          pot,
          salt,
          space: 256,
        }),
      ]),
      "create_pot",
    );
    const afterCreate = bench.svm.getBalance(bench.owner.address) ?? 0n;
    expectOk(
      await send(bench, [
        buildClosePotInstruction({
          kitchen: bench.kitchen,
          owner: bench.owner.address,
          engineProgram: bench.engine,
          pot,
          salt,
        }),
      ]),
      "close_pot",
    );

    // The "returns the rent" half, which absence alone does not show — a close that burned the
    // lamports would leave no account either. Measured against the balance AFTER the create, so the
    // rent moving back is the only thing this can be reading. Read BEFORE the re-create below,
    // which spends rent again.
    expect(bench.svm.getBalance(bench.owner.address) ?? 0n).toBeGreaterThan(afterCreate);
    await expectNothingAt(salt);
  });
});

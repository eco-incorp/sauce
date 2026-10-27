/**
 * `fetchPoolConfig` takes an `OwnedAccountLoader`, which returns each account's owner with its data:
 * a data-only `AccountLoader` cannot tell an extensionless Token-2022 mint from a legacy one. The
 * old shape must not compile where a pool's config is read, so an integrator who has not migrated
 * is stopped by tsc rather than quietly classifying by size.
 *
 * Each `@ts-expect-error` below is checked by `pnpm typecheck` (tsconfig.test.json includes this
 * file): a directive with no error under it is itself an error, so the day a data-only loader is
 * accepted again, typecheck fails. Each statement stays on one line, under `prettier-ignore`, so the
 * directive sits on the line that has the error.
 */
import { address } from "@solana/kit";
import {
  type AccountLoader,
  type OwnedAccountLoader,
  type SvmVenueAdapter,
  venue,
  woofi,
} from "../../src/svm/index.js";
import { fetchWoofiConfig } from "../../src/svm/venues/woofi/index.js";
import { makeLegacyMint } from "./fixtures/token-2022/synth.js";

const POOL = address("BEz2Suv2WvGKWouU1srbhZfudBGuw9v2VzkhMZHFBdvs");
const dataOnly: AccountLoader = async () => makeLegacyMint();

/** Never called: it exists for tsc to check. */
function compileOnly(adapter: SvmVenueAdapter, owned: OwnedAccountLoader): void {
  // The owner-aware shape is what each entry point takes.
  void adapter.fetchPoolConfig(owned, POOL);
  void venue("raydium-cp-swap").poolConfig(owned, POOL);
  void fetchWoofiConfig(owned, POOL);

  // prettier-ignore
  // @ts-expect-error a data-only loader has no owner: the adapter contract refuses it
  void adapter.fetchPoolConfig(dataOnly, POOL);
  // prettier-ignore
  // @ts-expect-error the venue accessor's poolConfig refuses it too
  void venue("raydium-cp-swap").poolConfig(dataOnly, POOL);
  // prettier-ignore
  // @ts-expect-error and so does each exported fetch function
  void fetchWoofiConfig(dataOnly, POOL);
}

describe("fetchPoolConfig refuses a data-only loader", () => {
  it("is a type error (pnpm typecheck holds the directives above)", () => {
    expect(typeof compileOnly).toBe("function");
  });

  it("does not resolve a config from one at run time either, where types are not checked", async () => {
    // Untyped JavaScript can still pass one: it returns bytes, not `{ data, owner }`, so the pool
    // read finds no account and the fetch fails instead of classifying a mint by size.
    const untyped = dataOnly as unknown as OwnedAccountLoader;
    await expect(woofi.fetchPoolConfig(untyped, POOL)).rejects.toThrow(
      `woofi pool ${POOL} account not found`,
    );
  });
});

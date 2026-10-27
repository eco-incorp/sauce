/**
 * Token-2022 SELF-DROP pin for the virtuals adapter. The program's IDL pins
 * `token_program` to a literal classic-Tokenkeg address (a Token-2022 base
 * mint is impossible to launch through it), but the adapter still detects one
 * defensively and GRACEFULLY SELF-DROPS. No checked-in fixture for this venue,
 * so the pool bytes are a minimal synthesized VirtualsPool account.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { virtuals, VIRTUALS_PROGRAM_ID } from "../../../src/svm/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const POOL = address("135Q44ShcCmWzaHZDJY25GejVQ4xwcgX9MzAEqE1eaFY");
const BASE_MINT = address("CYShT7m7JGrbfMu6XAmt2XDz4zjsV8i9LnHisihjvirt");
// sha256("account:VirtualsPool")[0..8].
const DISC = [71, 118, 5, 203, 5, 98, 135, 116];

/** A minimal, Active (state=1) 90-byte VirtualsPool with baseMint@40. */
function poolBytes(): Uint8Array {
  const out = new Uint8Array(90);
  out.set(DISC, 0);
  out.set(getAddressEncoder().encode(BASE_MINT), 40); // base mint @40
  out[88] = 1; // state = Active
  return out;
}

function loader(
  mintData: Uint8Array | null,
  mintOwner: Address = TOKEN_2022_PROGRAM_ID,
): OwnedAccountLoader {
  const pool = poolBytes();
  return async (addr) => {
    if (String(addr) === String(POOL)) return { data: pool, owner: VIRTUALS_PROGRAM_ID };
    if (String(addr) === String(BASE_MINT))
      return mintData === null ? null : { data: mintData, owner: mintOwner };
    return null;
  };
}

describe("virtuals Token-2022 self-drop", () => {
  test("legacy base mint (unvendored) decodes — legacy path unchanged", async () => {
    const cfg = await virtuals.fetchPoolConfig(loader(null), POOL);
    expect(cfg.venue).toBe("virtuals");
    expect(cfg.baseMint).toBe(BASE_MINT);
  });

  test("a Token-2022 base mint self-drops", async () => {
    await expect(virtuals.fetchPoolConfig(loader(makeT22Mint()), POOL)).rejects.toThrow(
      /dropping pool/,
    );
  });

  test("a NonTransferable base mint self-drops as un-routable", async () => {
    await expect(
      virtuals.fetchPoolConfig(loader(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/dropping pool/);
  });

  test("an extensionless 82-byte base mint owned by Token-2022 self-drops", async () => {
    await expect(
      virtuals.fetchPoolConfig(loader(makeLegacyMint(), TOKEN_2022_PROGRAM_ID), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  test("an 82-byte base mint owned by neither token program is refused", async () => {
    const foreign = address("11111111111111111111111111111111");
    await expect(virtuals.fetchPoolConfig(loader(makeLegacyMint(), foreign), POOL)).rejects.toThrow(
      `token-program: mint ${BASE_MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});

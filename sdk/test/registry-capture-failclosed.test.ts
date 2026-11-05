/**
 * The registry evidence never records a read that failed as an answer.
 *
 * `gen-registry-abis.mjs` leaves out an event or error no captured code carries, a shipped one
 * included, so a code read that failed and was taken for "no code" would remove entries from the
 * registry on the next recapture. The capture's code reads (`scripts/lib/registry-capture.mjs`,
 * which `capture-registry-abi.mjs` calls) throw instead, and both generators refuse an export with a
 * deployment whose capture recorded an error. These drive the functions the capture and the
 * generators run, with a reader that fails.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  embeddedAddresses,
  facetCodes,
  isRevert,
  linkedLibraries,
  readCode,
  readableRows,
} from "../scripts/lib/registry-capture.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const ETHEREUM = 1;
const ZKSYNC = 324;

const LIBRARY = "0x1111111111111111111111111111111111111111";
const FACET = "0x2222222222222222222222222222222222222222";
/** Code that embeds `LIBRARY` (PUSH20 it), as a contract linking it does. */
const CALLER = `0x6080604052${"73"}${LIBRARY.slice(2)}5af4`;
/** A deployed library's code: PUSH20 its own address, ADDRESS, EQ, the guard solc writes. */
const LIBRARY_CODE = `0x73${LIBRARY.slice(2)}301460806040`;

/** A reader whose every read fails, as an RPC with no endpoint left does. */
const failing = async (): Promise<string> => {
  throw new Error("chain 1 eth_getCode: 0 endpoint(s) answered nothing (429 Too Many Requests)");
};
/** A reader that answers `codes`, and "0x" for any other address. */
const answering =
  (codes: Readonly<Record<string, string>>) =>
  async (_chainId: number, address: string): Promise<string> =>
    codes[address] ?? "0x";

describe("a code read that fails is never an answer", () => {
  it("the caller embeds the library's address, so its code is read", () => {
    expect(embeddedAddresses(CALLER)).toEqual([LIBRARY]);
  });

  it("linkedLibraries throws, naming the address, when an embedded address's code cannot be read", async () => {
    await expect(linkedLibraries(ETHEREUM, [CALLER], failing)).rejects.toThrow(
      `chain 1 ${LIBRARY}: the code of an address a contract embeds could not be read ` +
        "(chain 1 eth_getCode: 0 endpoint(s) answered nothing (429 Too Many Requests)), so what it " +
        "carries is unknown: recapture",
    );
  });

  it("linkedLibraries throws when the reader answers nothing at all", async () => {
    await expect(
      linkedLibraries(ETHEREUM, [CALLER], async () => undefined as unknown as string),
    ).rejects.toThrow(
      `chain 1 ${LIBRARY}: the code of an address a contract embeds was not answered`,
    );
  });

  it("linkedLibraries takes a library its code is, and an address with no code is an answer", async () => {
    const found = await linkedLibraries(ETHEREUM, [CALLER], answering({ [LIBRARY]: LIBRARY_CODE }));
    expect([...found]).toEqual([[LIBRARY, LIBRARY_CODE]]);
    expect([...(await linkedLibraries(ETHEREUM, [CALLER], answering({})))]).toEqual([]);
    // EraVM code links no EVM library: nothing is read.
    expect([...(await linkedLibraries(ZKSYNC, [CALLER], failing))]).toEqual([]);
  });

  it("facetCodes throws, naming the facet, when a facet's code cannot be read", async () => {
    await expect(facetCodes(ETHEREUM, [FACET], failing)).rejects.toThrow(
      `chain 1 ${FACET}: the code of a facet a router named could not be read`,
    );
    expect(await facetCodes(ETHEREUM, [FACET], answering({ [FACET]: "0x6080" }))).toEqual({
      [FACET]: "0x6080",
    });
  });

  it("readCode passes on what the chain served, no code included", async () => {
    expect(await readCode(answering({}), ETHEREUM, FACET, "a layer")).toBe("0x");
  });
});

describe("a call a node fails is no revert", () => {
  it.each([
    [{ code: 3, message: "execution reverted" }, true],
    [{ code: -32000, message: "execution reverted" }, true],
    [{ code: -32015, message: "VM execution error." }, true],
    [{ code: -32000, message: "invalid opcode: INVALID" }, true],
    [{ code: -32000, message: "execution aborted (timeout = 5s)" }, false],
    [{ code: -32002, message: "request timed out" }, false],
    [{ code: -32000, message: "header not found" }, false],
    [{ code: 429, message: "Too Many Requests" }, false],
  ])("%j is a revert: %s", (error, expected) => {
    expect(isRevert(error)).toBe(expected);
  });
});

describe("the generators refuse a deployment whose capture recorded an error", () => {
  const row = (address: string, error?: string) => ({
    protocol: "aave-v3",
    abi: "PoolABI",
    chainId: ETHEREUM,
    address,
    ...(error === undefined ? {} : { error }),
  });

  it("readableRows returns an export's rows when every one was read", () => {
    const rows = [row(FACET), row(LIBRARY), { ...row(FACET), abi: "OtherABI" }];
    expect(readableRows(rows, "aave-v3", "PoolABI")).toEqual([row(FACET), row(LIBRARY)]);
  });

  it("readableRows throws, naming the deployment and its error, when one was not", () => {
    expect(() =>
      readableRows(
        [row(FACET), row(LIBRARY, "chain 1 eth_getStorageAt failed")],
        "aave-v3",
        "PoolABI",
      ),
    ).toThrow(
      `aave-v3.PoolABI: 1 captured deployment(s) recorded an error, so what their code carries is ` +
        `unknown (1:${LIBRARY}: chain 1 eth_getStorageAt failed) — recapture aave-v3`,
    );
  });

  it("the capture reads code only through the throwing reads, and both generators take rows through readableRows", () => {
    const capture = readFileSync(join(SCRIPTS, "capture-registry-abi.mjs"), "utf8");
    // No read of the network turns its failure into a value.
    expect(capture).not.toMatch(
      /\.catch\(\s*\(\)\s*=>\s*(null|undefined|\[\]|\{\}|false|"0x")\s*\)/,
    );
    expect(capture).not.toMatch(/getCode\([^)]*\)\s*\.catch/);
    expect(capture).not.toMatch(/function (linkedLibraries|facetCodes|readCode|isRevert)\b/);
    expect(capture).toMatch(/await facetCodes\(/);
    expect(capture).toMatch(/await linkedLibraries\(/);
    for (const generator of ["gen-registry-abis.mjs", "gen-source-globals.mjs"]) {
      const text = readFileSync(join(SCRIPTS, generator), "utf8");
      expect([generator, /readableRows\(evidence\.instances/.test(text)]).toEqual([
        generator,
        true,
      ]);
      expect([generator, /\.error === undefined|\.error !== undefined/.test(text)]).toEqual([
        generator,
        false,
      ]);
    }
  });
});

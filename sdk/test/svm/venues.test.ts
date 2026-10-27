/**
 * Venue-adapter framework units: shared bigint math, registry lookup errors,
 * and the fixture helpers (no engine, no RPC).
 */
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ceilDiv, listVenues, readUintLE, venueAdapter } from "../../src/svm/index.js";
import { fixtureAccounts, fixtureBytesMap, fixtureLoader, loadFixtures } from "./fixtures.js";
import type { AccountFixture } from "./fixtures.js";

describe("ceilDiv", () => {
  it("returns the exact quotient when the division is even", () => {
    expect(ceilDiv(10n, 5n)).toBe(2n);
    expect(ceilDiv(0n, 7n)).toBe(0n);
  });

  it("rounds any remainder up", () => {
    expect(ceilDiv(1n, 5n)).toBe(1n);
    expect(ceilDiv(11n, 5n)).toBe(3n);
    expect(ceilDiv((1n << 128n) + 1n, 1n << 128n)).toBe(2n);
  });

  it("rejects negative dividends and non-positive divisors", () => {
    expect(() => ceilDiv(-1n, 5n)).toThrow("ceilDiv dividend must be non-negative, got -1");
    expect(() => ceilDiv(1n, 0n)).toThrow("ceilDiv divisor must be positive, got 0");
    expect(() => ceilDiv(1n, -5n)).toThrow("ceilDiv divisor must be positive, got -5");
  });
});

describe("readUintLE", () => {
  // 0x0807060504030201 little-endian at offset 2.
  const data = new Uint8Array([0xff, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 0xff]);

  it("decodes little-endian fields of width 1, 2 and 8", () => {
    expect(readUintLE(data, 2, 1)).toBe(1n);
    expect(readUintLE(data, 2, 2)).toBe(0x0201n);
    expect(readUintLE(data, 2, 8)).toBe(0x0807060504030201n);
  });

  it("decodes the SPL token amount field (u64 LE at offset 64)", () => {
    const token = new Uint8Array(165);
    token.set([0x00, 0xe4, 0x0b, 0x54, 0x02, 0x00, 0x00, 0x00], 64); // 10_000_000_000
    expect(readUintLE(token, 64, 8)).toBe(10_000_000_000n);
  });

  it("decodes a full 32-byte word including the top bit", () => {
    const max = new Uint8Array(32).fill(0xff);
    expect(readUintLE(max, 0, 32)).toBe((1n << 256n) - 1n);
  });

  it("rejects invalid offsets and widths", () => {
    expect(() => readUintLE(data, -1, 8)).toThrow(
      "readUintLE offset must be a non-negative integer, got -1",
    );
    expect(() => readUintLE(data, 1.5, 8)).toThrow(
      "readUintLE offset must be a non-negative integer, got 1.5",
    );
    expect(() => readUintLE(data, 0, 0)).toThrow(
      "readUintLE width must be an integer in 1..=32, got 0",
    );
    expect(() => readUintLE(data, 0, 33)).toThrow(
      "readUintLE width must be an integer in 1..=32, got 33",
    );
  });

  it("rejects reads past the end of the data", () => {
    expect(() => readUintLE(data, 8, 8)).toThrow("readUintLE reads [8, 16) beyond 11-byte data");
  });
});

describe("venue registry", () => {
  it("throws for an unknown slug, listing the known venues", () => {
    const known = listVenues();
    const listed = known.length > 0 ? known.join(", ") : "none";
    expect(() => venueAdapter("no-such-venue")).toThrow(
      `unknown venue 'no-such-venue' (known venues: ${listed})`,
    );
  });

  it("resolves every listed slug to an adapter with that slug", () => {
    for (const slug of listVenues()) {
      expect(venueAdapter(slug).slug).toBe(slug);
    }
  });
});

describe("fixtures", () => {
  const WSOL_MINT = "So11111111111111111111111111111111111111112";
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const SYSTEM_PROGRAM = "11111111111111111111111111111111";

  const bytesA = new Uint8Array([1, 2, 3, 4]);
  const bytesB = new Uint8Array([9, 8, 7]);
  const fixtures: AccountFixture[] = [
    {
      address: WSOL_MINT,
      owner: TOKEN_PROGRAM,
      base64Data: Buffer.from(bytesA).toString("base64"),
    },
    {
      address: TOKEN_PROGRAM,
      owner: SYSTEM_PROGRAM,
      base64Data: Buffer.from(bytesB).toString("base64"),
    },
  ];

  it("loadFixtures reads every *.json in the directory, sorted by name", () => {
    const dir = mkdtempSync(join(tmpdir(), "venue-fixtures-"));
    writeFileSync(join(dir, "b_second.json"), JSON.stringify(fixtures[1]));
    writeFileSync(join(dir, "a_first.json"), JSON.stringify(fixtures[0]));
    writeFileSync(join(dir, "ignored.txt"), "not a fixture");

    const loaded = loadFixtures(dir);
    expect(loaded).toEqual(fixtures);
  });

  it("loadFixtures rejects a fixture missing a required field", () => {
    const dir = mkdtempSync(join(tmpdir(), "venue-fixtures-bad-"));
    writeFileSync(
      join(dir, "bad.json"),
      JSON.stringify({ address: WSOL_MINT, owner: TOKEN_PROGRAM }),
    );
    expect(() => loadFixtures(dir)).toThrow(
      "fixture bad.json is missing string field 'base64Data'",
    );
  });

  it("fixtureLoader returns decoded bytes and the captured owner for known addresses and null otherwise", async () => {
    const load = fixtureLoader(fixtures);
    expect(await load(WSOL_MINT as Parameters<typeof load>[0])).toEqual({
      data: bytesA,
      owner: TOKEN_PROGRAM,
    });
    expect(await load(SYSTEM_PROGRAM as Parameters<typeof load>[0])).toBeNull();
  });

  it("fixtureBytesMap keys the decoded data by address", () => {
    const map = fixtureBytesMap(fixtures);
    expect(map[WSOL_MINT]).toEqual(bytesA);
    expect(map[TOKEN_PROGRAM]).toEqual(bytesB);
    expect(Object.keys(map)).toHaveLength(2);
  });

  it("fixtureAccounts builds rent-exempt non-executable setAccount arguments", () => {
    const [account] = fixtureAccounts([fixtures[0]]);
    expect(account.address).toBe(WSOL_MINT);
    expect(account.programAddress).toBe(TOKEN_PROGRAM);
    expect(account.data).toEqual(bytesA);
    expect(account.executable).toBe(false);
    expect(account.space).toBe(4n);
    // Standard rent: (128 + space) * 3480 lamports/byte-year * 2 years.
    expect(account.lamports).toBe((128n + 4n) * 3480n * 2n);
  });
});

/**
 * How a note says text it did not write (`cli/record-text.ts`): a string a record supplies, and the
 * name of a file in the Pot store. A note reaches a terminal and the MCP server's tool results,
 * which read their notes as the server's own, so what a record says is never a line of a note's own:
 * what a field holds when it is what it should be is said as it is, anything else quoted on one
 * line, cut, with what a terminal cannot be trusted to print replaced; and nothing a record can hold
 * makes it throw.
 */
import { pathText, recordText } from "../src/cli/pot-store.js";

const CYCLE: Record<string, unknown> = {};
CYCLE.again = CYCLE;

describe("recordText", () => {
  it.each([
    "1.2.0",
    "2.6.4",
    "2026-11-19T10:00:00.000Z",
    `0x${"ab".repeat(32)}`,
    "9Ld1i6AbbbuN8zrJKKJmazEJBmZ9TWTQVQyVHVxmzEmq",
    "private-fixed-router",
    "mainnet-beta",
    "1.2.0-beta.1+build.5",
  ])("says %s as it is: it is what a field holds", (plain) => {
    expect(recordText(plain)).toBe(plain);
  });

  it.each([
    ["a path", "../../etc/passwd"],
    ["a URL", "https://evil.example/x"],
    ["a name with an at sign", "a@b"],
    ["two words", "not an address"],
    ["two lines", "private\nINJECTED: this is the current release"],
    ["a carriage return", "private\rINJECTED"],
    ["a line separator", "private\u2028INJECTED"],
    ["a paragraph separator", "private\u2029INJECTED"],
    ["a next line", "private\u0085INJECTED"],
    ["a right-to-left override", "private\u202eINJECTED"],
    ["an escape", "private\u001b[2JINJECTED"],
    ["a quote", 'private"; INJECTED'],
    ["nothing", ""],
  ])("quotes %s, on one line", (_what, text) => {
    const said = recordText(text);
    expect(said.startsWith('"') && said.endsWith('"')).toBe(true);
    expect(said).not.toMatch(/[\p{C}\p{Zl}\p{Zp}]/u);
  });

  it("says a line break as JSON does, and what JSON leaves raw and a terminal may act on as ?", () => {
    expect(recordText("a\nb")).toBe('"a\\nb"');
    for (const raw of ["\u2028", "\u2029", "\u0085", "\u007f", "\u202e", "\u200b"]) {
      expect(recordText(`a${raw}b`)).toBe('"a?b"');
    }
  });

  it("cuts what it quotes at 80 characters, and says a longer token quoted too", () => {
    expect(recordText(`${"x".repeat(100)} y`)).toBe(JSON.stringify("x".repeat(80)));
    expect(recordText("x".repeat(201))).toBe(JSON.stringify("x".repeat(80)));
    expect(recordText("x".repeat(200))).toBe("x".repeat(200));
    expect(recordText(`${"x".repeat(100)} y`, 20)).toBe(JSON.stringify("x".repeat(20)));
  });

  it("says what is not a string as JSON says it, and never throws", () => {
    expect(recordText(null)).toBe("null");
    expect(recordText(5)).toBe("5");
    expect(recordText(true)).toBe("true");
    expect(recordText(undefined)).toBe("undefined");
    expect(recordText({ toString: null })).toBe(JSON.stringify('{"toString":null}'));
    expect(recordText(["a", { b: 1 }])).toBe(JSON.stringify('["a",{"b":1}]'));
    // What JSON cannot say: a record is parsed from JSON, but nothing here depends on it.
    expect(recordText(10n)).toMatch(/^"/);
    expect(recordText(CYCLE)).toMatch(/^"/);
    expect(
      recordText({
        toJSON: () => {
          throw new Error("no");
        },
      }),
    ).toMatch(/^"/);
  });
});

describe("pathText", () => {
  it.each([
    "/Users/me/.sauce/pots/8453/0x70997970c51812dc3a010c7d01b50e0d17dc79c8.json",
    "/tmp/pots/8453/0xabc@0x11.json",
    "pots/1399811149-devnet/9Ld1i6AbbbuN8zrJKKJmazEJBmZ9TWTQVQyVHVxmzEmq.json",
  ])("says %s as it is: a path of the store", (path) => {
    expect(pathText(path)).toBe(path);
  });

  it("quotes a path with a space, a line break or a character a terminal cannot be trusted with", () => {
    for (const path of [
      "/Users/Some One/.sauce/pots/a.json",
      "/p/0xaa\nINJECTED.json",
      "/p/\u202e.json",
    ]) {
      const said = pathText(path);
      expect(said.startsWith('"')).toBe(true);
      expect(said).not.toMatch(/[\p{C}\p{Zl}\p{Zp}]/u);
    }
    expect(pathText("/Users/Some One/.sauce/pots/a.json")).toBe(
      JSON.stringify("/Users/Some One/.sauce/pots/a.json"),
    );
  });

  it("cuts a path at 1000 characters, not 80", () => {
    const long = `/${"a".repeat(500)} b`;
    expect(pathText(long)).toBe(JSON.stringify(long));
    expect(pathText(`/${"a".repeat(1100)}`)).toBe(JSON.stringify(`/${"a".repeat(999)}`));
    expect(pathText(`/${"a".repeat(900)}`)).toBe(`/${"a".repeat(900)}`);
  });
});

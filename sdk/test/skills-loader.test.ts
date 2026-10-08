/**
 * skills/loader.ts — `getProtocolSkill` slug contract.
 *
 * `getProtocolSkill` is a public API of a published package, so its `slug` is untrusted input that
 * used to be interpolated straight into a `join`. These assertions pin both halves of the gate: a
 * slug that is not in `listSkillSlugs()` never reaches the filesystem, and every slug that IS in it
 * still loads — asserted by COUNT so a rename cannot silently shrink the shipped set.
 */
import { getProtocolIndex, getProtocolSkill, listSkillSlugs } from "../src/skills/loader.js";

const SHIPPED_SLUG_COUNT = 135;
const NOT_FOUND = "Check listSkillSlugs() for valid slugs.";

describe("getProtocolSkill: slug allowlist", () => {
  it.each([
    ["../../README"],
    ["../../../README"],
    ["../../../../../../../../etc/hosts"],
    ["/etc/hosts"],
    ["index"],
    ["Aave-V3"],
    [""],
  ])("rejects %p with the not-found error", (slug) => {
    expect(() => getProtocolSkill(slug)).toThrow(NOT_FOUND);
    expect(() => getProtocolSkill(slug)).toThrow(`No skill file found for protocol "${slug}"`);
  });

  it("loads a legal slug carrying digits and hyphens", () => {
    expect(getProtocolSkill("aave-v3")).toContain("# Aave V3");
  });
});

describe("getProtocolSkill: every shipped slug", () => {
  it("loads all of them, and there are exactly SHIPPED_SLUG_COUNT", () => {
    const slugs = listSkillSlugs();
    expect(slugs).toHaveLength(SHIPPED_SLUG_COUNT);
    for (const slug of slugs) {
      expect(getProtocolSkill(slug).length).toBeGreaterThan(0);
    }
  });

  it("excludes the index, which has its own loader", () => {
    expect(listSkillSlugs()).not.toContain("index");
    expect(getProtocolIndex().length).toBeGreaterThan(0);
  });
});

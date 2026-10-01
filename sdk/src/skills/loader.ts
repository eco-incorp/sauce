// The per-protocol documents are embedded at build time (`embedded/skills.generated.ts`), so this
// module reads no filesystem and works in a browser. Their source of truth is the `sauce-protocols`
// agent skill, `skills/sauce-protocols/references/*.md` at the package root: the files ship there,
// `sauce skills install` copies them into a project, and this module returns the same text.
import { SKILL_DOCUMENTS } from "../embedded/skills.generated.js";

const INDEX = "index";

/**
 * Load the master protocol index skill file.
 * Returns markdown content with all protocols, categories, operations, and chain coverage.
 */
export function getProtocolIndex(): string {
  const index = SKILL_DOCUMENTS[INDEX];
  if (index === undefined) throw new Error("the protocol skill index is not embedded");

  return index;
}

/**
 * Load a specific protocol's skill file by slug.
 * Returns markdown describing the protocol, its operations,
 * SauceScript examples, contract addresses, and ABI methods.
 *
 * The slug is matched against `listSkillSlugs()`, so it can only name a skill this package ships;
 * anything else surfaces as the same not-found error.
 */
export function getProtocolSkill(slug: string): string {
  if (!listSkillSlugs().includes(slug)) throw unknownSlug(slug);

  return SKILL_DOCUMENTS[slug]!;
}

/**
 * List all available protocol skill slugs.
 */
export function listSkillSlugs(): string[] {
  return Object.keys(SKILL_DOCUMENTS)
    .filter((slug) => slug !== INDEX)
    .sort();
}

function unknownSlug(slug: string): Error {
  return new Error(
    `No skill file found for protocol "${slug}". Check listSkillSlugs() for valid slugs.`,
  );
}

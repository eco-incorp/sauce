import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// At runtime this file is at dist/skills/loader.js, so package root is ../..
// The .md files live at src/skills/ which ships with the package
const thisDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(thisDir, "..", "..");
const skillsDir = join(packageRoot, "src", "skills");

/**
 * Load the master protocol index skill file.
 * Returns markdown content with all protocols, categories, operations, and chain coverage.
 */
export function getProtocolIndex(): string {
  return readFileSync(join(skillsDir, "index.md"), "utf-8");
}

/**
 * Load a specific protocol's skill file by slug.
 * Returns markdown describing the protocol, its operations,
 * SauceScript examples, contract addresses, and ABI methods.
 *
 * The slug is matched against `listSkillSlugs()` before it ever reaches `join`, so it can only name
 * a skill file this package ships — a caller-supplied path can never escape `skillsDir`. Anything
 * else, including a slug whose file is unreadable, surfaces as the same not-found error.
 */
export function getProtocolSkill(slug: string): string {
  if (!listSkillSlugs().includes(slug)) throw unknownSlug(slug);
  try {
    return readFileSync(join(skillsDir, `${slug}.md`), "utf-8");
  } catch {
    throw unknownSlug(slug);
  }
}

/**
 * List all available protocol skill slugs.
 */
export function listSkillSlugs(): string[] {
  return readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => f.replace(".md", ""))
    .sort();
}

/**
 * Absolute path to the skills directory (for direct file access).
 */
export const SKILLS_DIR = skillsDir;

function unknownSlug(slug: string): Error {
  return new Error(
    `No skill file found for protocol "${slug}". Check listSkillSlugs() for valid slugs.`,
  );
}

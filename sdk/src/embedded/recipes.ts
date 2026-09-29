/**
 * The shipped `.sauce.ts` recipe programs, embedded at build time so reading one needs no
 * filesystem. The files under `src/recipes/` and `src/svm/recipes/` remain the source of truth, and
 * still ship as package assets.
 */
import { RECIPE_SOURCES } from "./sources.generated.js";

/** The text of the recipe at `path` under `src/` (`"recipes/settle.sauce.ts"`), verbatim. */
export function recipeSource(path: string): string {
  const text = RECIPE_SOURCES[path];
  if (text === undefined) {
    throw new Error(
      `recipe ${path} is not embedded — regenerate with \`node scripts/gen-embedded-sources.mjs\`.`,
    );
  }

  return text;
}

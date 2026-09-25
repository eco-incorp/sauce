// @eco-incorp/sauce/svm/engine — a narrow, FILESYSTEM-FREE view of the Sauce SVM engine wire
// contract plus the instruction builders, published as its own subpath for CommonJS consumers.
//
// WHY IT EXISTS SEPARATELY FROM `./svm`. The `./svm` barrel re-exports `svm/recipes`, whose module
// carries an ESM `__dirname` shim (`const __dirname = dirname(fileURLToPath(import.meta.url))` — it
// reads a shipped `.sauce.ts` off disk). Under a CommonJS transform (ts-jest / babel-jest) that shim
// collides with the injected module-wrapper `__dirname` and throws
// `Identifier '__dirname' has already been declared`. Native Node 22.12+ `require()` of a synchronous
// ESM graph is fine; jest, which wraps modules itself, is not.
//
// This subpath re-exports ONLY the engine wire contract — buffer/header/discriminator constants and
// offsets (via `./engine.js`, which declares them) — and the buffer
// lifecycle + execute INSTRUCTION BUILDERS (`./instructions.js`). Its entire transitive runtime module
// graph is free of `node:fs`, `node:path`, `fileURLToPath`, and `import.meta` (instructions.ts's only
// tie to the account layer is a TYPE import of `ResolvedAccountMeta`, erased at compile time), so it
// `require()`s cleanly from a CommonJS context and under any transform.
//
// ADDITIVE — `./svm` is unchanged; consumers that need the full registry/recipes surface keep using it.
// The fs-free boundary is a REGRESSION-GUARDED invariant: `test/svm/engine-public.test.ts` walks the
// transitive graph reachable from here and fails if any module declares `__dirname`/`__filename` or
// references `import.meta` — so a future re-export cannot silently pull `recipes` (or any fs-touching
// module) back in.
export * from "./engine.js";
export * from "./instructions.js";

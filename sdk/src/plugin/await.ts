// A JSON import, as `plugin/index.ts` reads the manifest: no filesystem is read at run time.
import manifest from "./manifest.json" with { type: "json" };

/**
 * Whether SauceScript takes `await`, `await x; rest` as `x.then(() => { rest })`: the manifest's
 * `await`, the one switch for everything the SDK keeps for it. It is off while the compiler has no
 * `await` (eco-incorp/v12 #554 was dropped), and every program writes `.then(() => { … })`. On,
 * with a compiler that takes one, the route parser reads an `await` wherever a statement stands
 * (`routes/parse.ts`), the intent parts read the statements after one, and a `try` around one, as
 * bodies (`routes/intent-parts.ts`), `--fund` wraps an awaiting program in its `.then` form
 * (`cli/funding.ts#thenForm`), and the editor plugin drops TypeScript's TS1308 where the compiler
 * takes one (`sauce-script/ts-plugin.cjs`, which reads the manifest itself).
 */
export const AWAIT_SUPPORTED: boolean = manifest.await;

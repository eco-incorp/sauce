import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "artifacts/**",
      "**/artifacts/**",
      "dev-tools/cache/**",
      // SauceScript, not application code — compiler INPUT, and every finding on it is a false
      // positive because eslint cannot know the language's own rules. Measured: `main` is the entry
      // point the Sauce compiler calls, so `no-unused-vars` fires on EVERY program, and
      // `require(cond)` is SauceScript's ASSERTION, which `no-require-imports` reads as a module
      // import (14 of those in `std/token/token.svm.js` alone). The Sauce frontend is what checks
      // these. Prettier, by contrast, formats them all — a formatter needs none of that context.
      "**/*.sauce.ts",
      "dev-tools/sauce/**",
      "dev-tools/test/fixtures/**",
      "sdk/src/std/**",
    ],
  },
  // Both presets, deliberately. `tseslint.configs.recommended` bundles an `eslintRecommended`
  // block that only DISABLES core rules TypeScript already covers — it enables none of them — so
  // without `js.configs.recommended` every core rule is off. Demonstrated: a file with a duplicate
  // object key, unreachable code after `return`, and `x === NaN` drew zero eslint findings. `tsc`
  // catches the first two in a `.ts` file, but not `no-unreachable`, and it never sees the `.js` /
  // `.mjs` sources here at all.
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything here runs on Node — the `.mjs`/`.js` scripts especially, which no tsconfig
    // `include` covers, so `no-undef` is the only thing checking their names at all. Without this
    // it reported 70 findings for `console`/`process`/`Buffer`/`require`, all of them the config
    // missing rather than the code being wrong.
    languageOptions: { globals: globals.node },
  },
  {
    // `no-explicit-any` OFF for these five files, and nowhere else. Every remaining `any` in them
    // is an external-library escape, not a shortcut — checked one by one:
    //
    //   dev-tools/src/sync-price.ts (16)  viem's `ReadContractParameters` marks `authorizationList`
    //     REQUIRED in this version — an EIP-7702 field a READ never uses — so every `readContract`
    //     call needs a cast. Verified by deleting the casts: 13 x TS2345 "Property
    //     'authorizationList' is missing". A viem bump or one shared typed wrapper is the real fix.
    //   actions/src/to-quote.ts (3)  `encodeAbiParameters` values against a runtime-assembled
    //     tuple ABI.
    //   dev-tools/test/e2e.test.ts (1)  `hardhat_setCode`, absent from viem's method union.
    //   sdk/test/svm/cpi-probe.test.ts (1), sdk/test/svm/venues/woofi.test.ts (1)  partial litesvm
    //     account/loader stubs standing in for a full fixture.
    //
    // Listed per FILE rather than switched off globally so `sdk/src` — which has zero `any` today
    // — cannot quietly gain one, and so each escape stays attributable to a named cause.
    files: [
      "dev-tools/src/sync-price.ts",
      "dev-tools/test/e2e.test.ts",
      "actions/src/to-quote.ts",
      "sdk/test/svm/cpi-probe.test.ts",
      "sdk/test/svm/venues/woofi.test.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    rules: {
      // Every one of the 13 findings was an empty CATCH — a deliberate "this may fail, carry on"
      // in a script or a test. The option exists for exactly that, and it leaves `no-empty` live
      // for an empty `if`/`for`/block, which is the shape actually worth flagging.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // The codebase already signals a deliberately-unused binding by prefixing `_` (a required
      // positional parameter, a destructured field being skipped). Honour that convention rather
      // than making authors add a disable comment for it.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
);

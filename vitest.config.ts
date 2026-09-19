import { defaultExternalConditions, defaultServerConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Project-owned export condition. Workspace packages expose
 * `"@internal/source": "./src/index.ts"` alongside their built `dist` entries,
 * so that typechecking and tests read TypeScript sources directly and never
 * depend on a prior `pnpm build`. The same condition is declared in every
 * tsconfig used for typechecking.
 */
const SOURCE_CONDITION = "@internal/source";

/**
 * Directories that never contain source tests. `configDefaults.exclude` only
 * covers `node_modules` and `.git` in Vitest 5, so build output and task caches
 * are added here.
 */
const IGNORED_DIRECTORIES = [...configDefaults.exclude, "**/dist/**", "**/.turbo/**"];

/**
 * The test-file taxonomy from the build plan (section 8, "Testing Strategy").
 * `unit` is the default layer and therefore has to exclude the three suffixed
 * layers explicitly, because `**\/*.test.ts` also matches `*.integration.test.ts`.
 */
const SPECIALISED_SUFFIXES = [
  "**/*.integration.test.ts",
  "**/*.contract.test.ts",
  "**/*.replay.test.ts",
];

export default defineConfig({
  // Vitest resolves test modules through Vite's server (SSR) environment, so
  // the condition has to be added there. `conditions` covers dependencies Vite
  // processes, `externalConditions` covers ones it externalises to Node.
  // Both defaults are re-exported by Vite and must be kept, because assigning
  // these options replaces them rather than extending them.
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, ...defaultServerConditions],
      externalConditions: [SOURCE_CONDITION, ...defaultExternalConditions],
    },
  },
  test: {
    // Root-only option: Vitest 5 lists `passWithNoTests` in `NonProjectOptions`,
    // so it cannot be set per project. Layers that have no files yet must still
    // exit zero.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: [...IGNORED_DIRECTORIES, ...SPECIALISED_SUFFIXES],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
          exclude: IGNORED_DIRECTORIES,
        },
      },
      {
        test: {
          name: "contract",
          include: ["**/*.contract.test.ts"],
          exclude: IGNORED_DIRECTORIES,
        },
      },
      {
        test: {
          name: "replay",
          include: ["**/*.replay.test.ts"],
          exclude: IGNORED_DIRECTORIES,
        },
      },
    ],
  },
});

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "node_modules/**",
      ".shot.mjs"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks
    },
    rules: reactHooks.configs.recommended.rules
  },
  // Package boundaries (ARCHITECTURE.md "Package Boundaries"). Scoped to src/ so tests
  // and scripts may still use Node APIs for fixtures and tooling.
  boundary("packages/engine/src", [
    {
      group: ["@sengoku-jidai/*"],
      message: "The engine imports no app packages (ARCHITECTURE.md package boundaries)."
    },
    {
      group: ["node:*"],
      message: "The engine must stay pure: no filesystem, network, or other Node APIs."
    },
    {
      group: ["react", "react-dom", "react-dom/*", "fastify", "@fastify/*", "better-sqlite3", "ws"],
      message: "The engine must not know about HTTP, WebSocket, databases, or React."
    }
  ]),
  boundary("packages/shared/src", [
    {
      group: ["@sengoku-jidai/*"],
      message: "shared owns client/server contracts only; it imports no app packages."
    },
    {
      group: [
        "node:*",
        "react",
        "react-dom",
        "react-dom/*",
        "fastify",
        "@fastify/*",
        "better-sqlite3",
        "ws"
      ],
      message: "shared is a plain contract package: no Node APIs, frameworks, or databases."
    }
  ]),
  boundary("packages/board-render/src", [
    {
      group: ["@sengoku-jidai/*", "!@sengoku-jidai/engine"],
      message: "board-render may only depend on the engine."
    },
    {
      group: ["node:*", "react", "react-dom", "react-dom/*"],
      message: "board-render builds plain SVG strings: no Node APIs or React."
    }
  ]),
  boundary("packages/terrain/src", [
    {
      group: ["@sengoku-jidai/*", "!@sengoku-jidai/engine"],
      message: "terrain's source may only depend on the engine (no other app/render packages)."
    }
  ]),
  // mapSources resolves a map's structural board SVG from live board-render geometry — the same
  // source of truth the web client (`boardSvgFor`) and the server terrain path already use — so
  // this one module (and only it) may import board-render. A committed board.svg drifts from the
  // rendered board and stretches the generated background; deriving it keeps the two in lockstep.
  // A later flat-config entry replaces (not extends) the rule for its files, so restate the full
  // set minus board-render. Everything else in terrain/src stays board-render-free (boundary above).
  {
    files: ["packages/terrain/src/mapSources.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@sengoku-jidai/*", "!@sengoku-jidai/engine", "!@sengoku-jidai/board-render"],
              message:
                "terrain's source may only depend on the engine; mapSources additionally may import board-render to assemble the structural board SVG."
            }
          ]
        }
      ]
    }
  },
  boundary("packages/server/src", [
    {
      group: ["@sengoku-jidai/web", "@sengoku-jidai/web/*"],
      message: "The server must not import the web app."
    },
    {
      group: ["react", "react-dom", "react-dom/*"],
      message: "The server has no UI: no React."
    }
  ]),
  boundary("packages/web/src", [
    {
      group: [
        "@sengoku-jidai/server",
        "@sengoku-jidai/server/*",
        "@sengoku-jidai/terrain",
        "@sengoku-jidai/terrain/*"
      ],
      message: "The web client must not import server-only or dev-only packages."
    },
    {
      group: ["node:*", "fastify", "@fastify/*", "better-sqlite3"],
      message: "The web client runs in the browser: no Node APIs, HTTP servers, or databases."
    },
    {
      regex: "^@sengoku-jidai/engine$",
      message: "Import from @sengoku-jidai/engine/client — the curated client-safe engine surface."
    }
  ]),
  // Web tests get the same engine restriction (one boundary() per file set: a later
  // flat-config entry for the same rule would replace, not extend, the src patterns).
  boundary("packages/web/test", [
    {
      regex: "^@sengoku-jidai/engine$",
      message: "Import from @sengoku-jidai/engine/client — the curated client-safe engine surface."
    }
  ])
);

/** One boundary entry: restricted import patterns for every TS file under `dir`. */
function boundary(dir, patterns) {
  return {
    files: [`${dir}/**/*.{ts,tsx}`],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns }]
    }
  };
}

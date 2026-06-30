# board-render preview

Regenerate the fixture board and view it locally:

    corepack pnpm --filter @sengoku-jidai/engine build
    corepack pnpm --filter @sengoku-jidai/board-render preview
    cd packages/board-render
    LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib \
      node ~/.local/bin/svgshot.mjs scripts/preview.svg scripts/preview.png 900 700

`preview.svg`/`preview.png` are throwaway artifacts (gitignored). The hex-grid layer is
forced visible in the preview; the real assembled board hides it (editor toggles it on).

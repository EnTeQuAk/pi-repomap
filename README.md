# pi-repomap

Tree-sitter powered repository map for [pi coding agent](https://github.com/badlogic/pi-mono).

Gives the LLM a structural overview of your codebase on every prompt: classes with inheritance, functions, interfaces, types, and their locations.

## What it does

On each prompt, pi-repomap parses your git-tracked source files with tree-sitter, extracts a symbol outline using [Zed](https://zed.dev/)-derived queries, ranks files by cross-file reference importance (PageRank), and injects a compact, tiered map into the LLM context:

```
# Repository Map (191 files, 3847 symbols)

lib/core/database/tables.dart
 class Groups(Table) L7-166
 class CardsData(DataClass, Insertable) L854-1276
 class NfcTags(Table) L1576-1693

lib/features/player/player_backend.dart
 class PlayerBackend L11-39
  get stateStream
  nextTrack
  prevTrack

lib/core/auth/pin_service.dart
 class PinService(ChangeNotifier)
  verifyPin
  setPin

tools/src/lauschi_catalog/providers/base.py
 class CatalogProvider(ABC)

lib/features/tiles/widgets/tile_card.dart (12 symbols)
lib/core/theme/app_theme.dart (61 symbols)

186 more files (799 symbols) not shown.
```

Three tiers of detail to maximize visibility within a token budget:
- **Full outlines** for the most important files (classes, methods, nesting)
- **Exports only** for mid-tier files
- **File listing** with symbol counts for the rest

The map is cached and incrementally updated. Only files with changed modification times get re-parsed.

## Install

```bash
pi install https://github.com/EnTeQuAk/pi-repomap
```

For development:

```bash
git clone https://github.com/EnTeQuAk/pi-repomap.git
cd pi-repomap
npm install
ln -sfn "$(pwd)" ~/.pi/agent/extensions/pi-repomap
```

**Development scripts:**
```bash
npm run check       # Type check + lint
npm run type-check  # TypeScript type checking only
npm run lint        # ESLint only 
npm run lint:fix    # Auto-fix ESLint issues
```

> **Note**: Native tree-sitter requires a C++ toolchain. On Node.js 24+, you may need `CXXFLAGS="-std=c++20"` during `npm install`.

## Usage

The extension works automatically. By default, it uses the `auto` refresh strategy for smart context injection.

### Commands

- `/repomap` - Show status (file count, symbol count, age, refresh strategy)
- `/repomap --config` - Show configuration options and current settings
- `/repomap --force` - Force rebuild and inject into current context

### Configuration

Control when the repo map is injected to balance context efficiency with freshness:

```json
{
  "repomap": {
    "refreshStrategy": "auto",
    "tokenBudget": 4096,
    "includePaths": ["src", "lib"],
    "excludePaths": ["tests", "fixtures"]
  }
}
```

**Path Filtering:**

- `includePaths` - Only scan files under these directories (relative to repo root). If omitted or empty, all directories are included.
- `excludePaths` - Skip files under these directories. Applied after `includePaths`.

**Refresh Strategies:**

- `auto` (default) - Smart refresh: inject when files change OR every 5 minutes
- `always` - Every prompt (heavy context usage, like the original behavior) 
- `files` - Only when git HEAD or file count changes
- `manual` - Only via `/repomap --force` command
- `never` - Disable repo map injection completely

**Token Budget:**
- Explicit number (e.g., `4096`) - Fixed token limit
- `null` (default) - Auto-scale to ~3% of model context window

### LLM Tool

The LLM can call the `repomap` tool directly:

- `repomap status` - Check if the map is fresh
- `repomap rebuild` - Force regenerate after major changes
- `repomap outline <file>` - Get a detailed outline of a specific file

## Supported languages

Ships with grammars and outline queries for TypeScript, JavaScript, Python, Go, Rust, C#, and Dart/Flutter.

Tree-sitter itself supports [hundreds of languages](https://tree-sitter.github.io/tree-sitter/#parsers). Adding more is a matter of installing the grammar package and dropping query files in `src/queries/`. The query format follows [Zed's conventions](https://github.com/zed-industries/zed/tree/main/crates/grammars/src) using `@name`, `@context`, `@item`, and `@inherit` captures.

## How it works

1. **Scan**: Walk git-tracked files (`git ls-files`), filter by language, skip generated files (`.g.dart`, `.freezed.dart`, etc.) and vendored directories
2. **Parse**: Each file is parsed with native tree-sitter into a concrete syntax tree
3. **Query**: Zed-derived `.scm` queries extract symbol definitions and inheritance info
4. **Refs**: Separate `.refs.scm` queries extract identifier references for cross-file ranking
5. **Rank**: PageRank on the reference graph surfaces the most important files first
6. **Cache**: Results stored in `.pi/cache/repomap.json` with per-file mtime tracking
7. **Format**: Symbols are formatted into three tiers within a token budget and injected via `before_agent_start`

Token budget scales with model context window (~3%, kept between 2048 and 16384 tokens). Incremental updates: only files with changed mtimes get re-parsed. A git HEAD change triggers a full rebuild.

## Credits

Outline queries derived from [Zed](https://github.com/zed-industries/zed) and [zed-extensions](https://github.com/zed-extensions) (MIT/Apache-2.0 licensed). Repository map ranking and refresh strategies inspired by [aider](https://aider.chat/)'s intelligent repository context management.

## License

MIT

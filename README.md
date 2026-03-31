# pi-repomap

Tree-sitter powered repository map for [pi coding agent](https://github.com/badlogic/pi-mono).

Gives the LLM a structural overview of your codebase on every prompt: classes, functions, interfaces, types, and their locations. No more burning tokens reading files to understand the project layout.

## What it does

On each prompt, pi-repomap parses your git-tracked source files with tree-sitter, extracts a symbol outline using [Zed](https://zed.dev/)-derived queries, and injects a compact map into the LLM context:

```
# Repository Map (142 files, 847 symbols)

src/auth/login.ts
  class AuthService L12-89
    async login(credentials) L23
    async refresh(token) L56
  export function hashPassword(pw) L91

src/models/user.py
  class User L5-67
    def __init__(self, name, email) L8
    async def save(self) L23
    @classmethod
    async def find_by_email(cls, email) L45
```

The map is cached and incrementally updated. Only files with changed modification times get re-parsed.

## Install

```bash
# From npm
pi install npm:@entequak/pi-repomap

# From git
pi install https://github.com/EnTeQuAk/pi-repomap

# For development (symlink)
git clone https://github.com/EnTeQuAk/pi-repomap.git
cd pi-repomap
CXXFLAGS="-std=c++20" npm install
ln -sfn "$(pwd)" ~/.pi/agent/extensions/pi-repomap
```

> **Note**: Native tree-sitter requires a C++ toolchain. On Node.js 24+, you may need `CXXFLAGS="-std=c++20"` during `npm install`.

## Usage

The extension works automatically. Once installed, every prompt includes the repo map as context.

### Commands

- `/repomap` - Show status (file count, symbol count, age)
- `/repomap --force` - Force a full rebuild

### LLM Tool

The LLM can call the `repomap` tool directly:

- `repomap status` - Check if the map is fresh
- `repomap rebuild` - Force regenerate after major changes
- `repomap outline <file>` - Get a detailed outline of a specific file

## Supported languages

| Language | Grammar | Query source |
|----------|---------|-------------|
| TypeScript | tree-sitter-typescript | Zed outline.scm (trimmed) |
| JavaScript | tree-sitter-javascript | Zed outline.scm (adapted) |
| Python | tree-sitter-python | Zed outline.scm |
| Go | tree-sitter-go | Zed outline.scm |
| Rust | tree-sitter-rust | Zed outline.scm |

## How it works

1. **Scan**: Walks git-tracked files (`git ls-files`), filters by language
2. **Parse**: Each file is parsed with native tree-sitter into a concrete syntax tree
3. **Query**: Zed-derived `.scm` queries extract symbol definitions (@name, @context, @item captures)
4. **Cache**: Results stored in `.pi/cache/repomap.json` with per-file mtime tracking
5. **Format**: Symbols are ranked (exported first), formatted within a token budget, and injected via `before_agent_start`

Incremental updates: only files with changed mtimes are re-parsed. A git HEAD change triggers a full rebuild.

## Configuration

Token budget defaults to 4096 (~16KB of text). Large repos are automatically truncated with an "... and N more files" footer, prioritizing files with exported symbols.

## Credits

Outline queries derived from [Zed](https://github.com/zed-industries/zed)'s tree-sitter grammars (MIT/Apache-2.0 licensed). The approach is inspired by [aider](https://aider.chat/)'s repository map.

## License

MIT

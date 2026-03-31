/**
 * Format a repo map as compact, LLM-readable text.
 *
 * Produces output like:
 *
 *   src/auth/login.ts
 *     class AuthService L12-89
 *       async login(creds) L23
 *     export function hashPassword(pw) L91
 *
 * Respects a token budget by prioritizing exported symbols
 * and truncating with a summary footer.
 */

import type { RepoMap, CachedFile } from "./cache.ts";
import type { Symbol } from "./parser.ts";

// Rough token estimate: 1 token per ~4 characters.
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Keywords that indicate a symbol is exported/public. */
const EXPORT_KEYWORDS = new Set(["export", "pub"]);

/** Is a symbol exported or public based on its context keywords? */
function isExported(sym: Symbol, language: string): boolean {
	// Language-specific export detection
	if (language === "go") {
		// Go: capitalized names are exported
		return sym.name.length > 0 && sym.name[0] === sym.name[0].toUpperCase() && sym.name[0] !== sym.name[0].toLowerCase();
	}
	if (language === "python") {
		// Python: symbols without leading underscore at top level
		return sym.depth === 0 && !sym.name.startsWith("_");
	}
	// TS/JS/Rust: look for export/pub in context
	return sym.context.some((c) => EXPORT_KEYWORDS.has(c));
}

/**
 * Format a single file's symbols as compact text.
 */
function formatFile(filePath: string, file: CachedFile): string {
	const lines: string[] = [filePath];

	for (const sym of file.symbols) {
		const indent = "  ".repeat(sym.depth + 1);
		const ctx = sym.context.join(" ");
		const range = sym.line === sym.endLine ? `L${sym.line}` : `L${sym.line}-${sym.endLine}`;
		const label = ctx ? `${ctx} ${sym.name}` : sym.name;
		lines.push(`${indent}${label} ${range}`);
	}

	return lines.join("\n");
}

interface FormatOptions {
	/** Maximum token budget. Default: 4096 */
	tokenBudget?: number;
}

/**
 * Format the full repo map for LLM consumption.
 *
 * Prioritization when over budget:
 * 1. Files with exported symbols come first
 * 2. Within a file, exported/public symbols before private
 * 3. Files with more symbols are ranked higher
 * 4. Truncate with a footer showing what was omitted
 */
export function formatForLLM(map: RepoMap, options: FormatOptions = {}): string {
	const budget = options.tokenBudget ?? 4096;
	const entries = Object.entries(map.files);

	if (entries.length === 0) {
		return "# Repository Map\n\nNo supported source files found.";
	}

	// Score files for prioritization
	const scored = entries.map(([filePath, file]) => {
		const exportedCount = file.symbols.filter((s) => isExported(s, file.language)).length;
		const score = exportedCount * 10 + file.symbols.length;
		return { filePath, file, score };
	});

	// Sort: highest score first
	scored.sort((a, b) => b.score - a.score);

	// Count totals for header
	const totalFiles = entries.length;
	const totalSymbols = entries.reduce((sum, [, f]) => sum + f.symbols.length, 0);

	const header = `# Repository Map (${totalFiles} files, ${totalSymbols} symbols)\n`;
	let output = header;
	let tokens = estimateTokens(header);
	let includedFiles = 0;

	for (const { filePath, file } of scored) {
		const block = "\n" + formatFile(filePath, file);
		const blockTokens = estimateTokens(block);

		if (tokens + blockTokens > budget && includedFiles > 0) {
			const remaining = scored.length - includedFiles;
			const remainingSymbols = scored
				.slice(includedFiles)
				.reduce((sum, e) => sum + e.file.symbols.length, 0);
			output += `\n\n... and ${remaining} more files (${remainingSymbols} symbols)`;
			break;
		}

		output += block;
		tokens += blockTokens;
		includedFiles++;
	}

	return output;
}

/**
 * Format a single file's outline (for the outline tool action).
 */
export function formatFileOutline(filePath: string, file: CachedFile): string {
	return formatFile(filePath, file);
}

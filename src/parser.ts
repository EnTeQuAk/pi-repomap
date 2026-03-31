/**
 * Tree-sitter parser and query engine.
 *
 * Loads language grammars, runs Zed-derived outline.scm queries,
 * and extracts symbols from query matches.
 */

import Parser from "tree-sitter";
import * as fs from "node:fs";
import * as path from "node:path";

// Grammar imports. Loaded eagerly because dynamic import() of native
// modules is unreliable in jiti. tree-sitter-typescript exports
// { typescript, tsx }; other grammars export the language directly.
import TSGrammar from "tree-sitter-typescript";
import JSGrammar from "tree-sitter-javascript";
import PYGrammar from "tree-sitter-python";
import GOGrammar from "tree-sitter-go";
import RSGrammar from "tree-sitter-rust";
import CSGrammar from "tree-sitter-c-sharp";
import DartGrammar from "tree-sitter-dart";

const GRAMMARS: Record<string, Parser.Language> = {
	typescript: TSGrammar.typescript as unknown as Parser.Language,
	tsx: TSGrammar.tsx as unknown as Parser.Language,
	javascript: JSGrammar as unknown as Parser.Language,
	python: PYGrammar as unknown as Parser.Language,
	go: GOGrammar as unknown as Parser.Language,
	rust: RSGrammar as unknown as Parser.Language,
	csharp: CSGrammar as unknown as Parser.Language,
	dart: DartGrammar as unknown as Parser.Language,
};

export interface Symbol {
	name: string;
	context: string[]; // Keywords like "async", "export", "pub", "class"
	line: number; // 1-based start line
	endLine: number; // 1-based end line
	depth: number; // Nesting depth (0 = top-level)
}

export interface FileSymbols {
	language: string;
	symbols: Symbol[];
}

// Compiled queries, cached after first use. Keyed by "language" or "language.imports".
const queryCache: Map<string, Parser.Query> = new Map();

/**
 * Load a tree-sitter language grammar.
 */
function loadLanguage(language: string): Parser.Language | null {
	return GRAMMARS[language] ?? null;
}

/**
 * Resolve the queries/ directory relative to this source file.
 * Works with both jiti (pi's loader) and native Node.js ESM.
 */
function resolveQueryDir(): string {
	// jiti sets __dirname; native ESM uses import.meta.url
	if (typeof __dirname !== "undefined") {
		return path.join(__dirname, "queries");
	}
	return path.join(path.dirname(new URL(import.meta.url).pathname), "queries");
}

/**
 * Load and compile a .scm query file.
 * Supports both outline queries (language.scm) and import queries (language.imports.scm).
 */
function loadQuery(language: string, queryType: string = ""): Parser.Query | null {
	const cacheKey = queryType ? `${language}.${queryType}` : language;
	const cached = queryCache.get(cacheKey);
	if (cached) return cached;

	const lang = loadLanguage(language);
	if (!lang) return null;

	const filename = queryType ? `${language}.${queryType}.scm` : `${language}.scm`;
	const queryFile = path.join(resolveQueryDir(), filename);

	if (!fs.existsSync(queryFile)) return null;

	try {
		const source = fs.readFileSync(queryFile, "utf-8");
		const query = new Parser.Query(lang, source);
		queryCache.set(cacheKey, query);
		return query;
	} catch (err) {
		console.error(`Failed to compile ${filename}: ${err}`);
		return null;
	}
}

/**
 * Parse a source file and extract symbols using the outline query.
 *
 * Returns null if the language is unsupported or parsing fails.
 * Never throws; malformed files are silently skipped.
 */
export function extractSymbols(sourceCode: string, language: string): FileSymbols | null {
	const lang = loadLanguage(language);
	const query = loadQuery(language);
	if (!lang || !query) return null;

	const parser = new Parser();
	parser.setLanguage(lang);

	let tree: Parser.Tree;
	try {
		tree = parser.parse(sourceCode);
	} catch {
		return null;
	}

	const matches = query.matches(tree.rootNode);
	const rawSymbols = matchesToSymbols(matches);
	const nested = assignDepths(rawSymbols);

	return { language, symbols: nested };
}

/**
 * Extract flat symbol data from query matches.
 *
 * Each match has captures named @name, @context, @item, @annotation.
 * We pull the symbol name, context keywords, and source range from these.
 */
function matchesToSymbols(matches: Parser.QueryMatch[]): Symbol[] {
	const symbols: Symbol[] = [];

	for (const match of matches) {
		const nameCapture = match.captures.find((c) => c.name === "name");
		const itemCapture = match.captures.find((c) => c.name === "item");

		if (!nameCapture) continue;

		const contextCaptures = match.captures.filter((c) => c.name === "context");
		const context = contextCaptures.map((c) => c.node.text).filter((t) => t !== "(" && t !== ")");

		const startRow = itemCapture?.node.startPosition.row ?? nameCapture.node.startPosition.row;
		const endRow = itemCapture?.node.endPosition.row ?? nameCapture.node.endPosition.row;

		symbols.push({
			name: nameCapture.node.text,
			context,
			line: startRow + 1, // Convert to 1-based
			endLine: endRow + 1,
			depth: 0, // Assigned later
		});
	}

	return symbols;
}

/**
 * Assign nesting depths based on line ranges.
 *
 * A symbol is nested inside another if its line range falls within
 * the parent's range. We sort by start line and use a stack to track
 * the current nesting level.
 */
function assignDepths(symbols: Symbol[]): Symbol[] {
	if (symbols.length === 0) return symbols;

	// Sort by start line, then by range size descending (parents first).
	symbols.sort((a, b) => {
		if (a.line !== b.line) return a.line - b.line;
		return (b.endLine - b.line) - (a.endLine - a.line);
	});

	// Stack of parent end lines. When a symbol starts after the
	// stack top's end line, pop to find the right nesting level.
	const stack: number[] = [];

	for (const sym of symbols) {
		while (stack.length > 0 && sym.line > stack[stack.length - 1]) {
			stack.pop();
		}
		sym.depth = stack.length;
		stack.push(sym.endLine);
	}

	return symbols;
}

/**
 * Extract import/require paths from a source file using tree-sitter queries.
 *
 * Returns raw path strings as they appear in the source (e.g. "./foo", "express",
 * "celery.app"). Resolving these to file paths is the caller's job.
 */
export function extractImports(sourceCode: string, language: string): string[] {
	const lang = loadLanguage(language);
	const query = loadQuery(language, "imports");
	if (!lang || !query) return [];

	const parser = new Parser();
	parser.setLanguage(lang);

	let tree: Parser.Tree;
	try {
		tree = parser.parse(sourceCode);
	} catch {
		return [];
	}

	const matches = query.matches(tree.rootNode);
	const paths: string[] = [];

	for (const match of matches) {
		const pathCapture = match.captures.find((c) => c.name === "path");
		if (pathCapture) {
			// Strip surrounding quotes if present (Go's interpreted_string_literal includes them)
			const raw = pathCapture.node.text.replace(/^["']|["']$/g, "");
			if (raw) paths.push(raw);
		}
	}

	return [...new Set(paths)];
}

/**
 * Extract identifier references from a source file.
 *
 * Returns a list of identifier names that are used (called, instantiated,
 * type-referenced) in the file. Used for cross-file ranking: if file A
 * references identifier X defined in file B, that's an edge A -> B.
 */
export function extractRefs(sourceCode: string, language: string): string[] {
	const lang = loadLanguage(language);
	const query = loadQuery(language, "refs");
	if (!lang || !query) return [];

	const parser = new Parser();
	parser.setLanguage(lang);

	let tree: Parser.Tree;
	try {
		tree = parser.parse(sourceCode);
	} catch {
		return [];
	}

	const matches = query.matches(tree.rootNode);
	const refs: string[] = [];

	for (const match of matches) {
		const refCapture = match.captures.find((c) => c.name === "name.reference");
		if (refCapture) {
			refs.push(refCapture.node.text);
		}
	}

	return refs;
}

/**
 * List supported language names.
 */
export function supportedLanguages(): string[] {
	return Object.keys(GRAMMARS);
}

/**
 * Check if a language has a grammar and query available.
 */
export function isLanguageAvailable(language: string): boolean {
	return loadLanguage(language) !== null && loadQuery(language) !== null;
}

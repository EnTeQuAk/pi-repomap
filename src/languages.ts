/**
 * Language detection from file extensions.
 *
 * Maps file extensions to tree-sitter language names.
 * Only languages with grammar packages and outline queries are included.
 */

const EXTENSION_MAP: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".mts": "typescript",
	".cts": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".pyw": "python",
	".go": "go",
	".rs": "rust",
	".cs": "csharp",
	".dart": "dart",
};

/**
 * Detect the tree-sitter language name from a file path.
 * Returns null for unsupported file types.
 */
export function detectLanguage(filePath: string): string | null {
	const dot = filePath.lastIndexOf(".");
	if (dot === -1) return null;
	const ext = filePath.substring(dot).toLowerCase();
	return EXTENSION_MAP[ext] ?? null;
}

/**
 * Check if a file path has a supported language extension.
 */
export function isSupportedFile(filePath: string): boolean {
	return detectLanguage(filePath) !== null;
}

/**
 * All file extensions we recognize.
 */
export function supportedExtensions(): string[] {
	return Object.keys(EXTENSION_MAP);
}

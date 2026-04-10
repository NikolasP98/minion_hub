import ts from 'typescript';
import type { LintError } from './types';

export function validateTypeScript(content: string, fileName: string): LintError[] {
	const errors: LintError[] = [];

	const sourceFile = ts.createSourceFile(
		fileName,
		content,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX
	);

	const compilerOptions: ts.CompilerOptions = {
		noEmit: true,
		allowJs: true,
		jsx: ts.JsxEmit.React,
		strict: false,
		target: ts.ScriptTarget.Latest,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
	};

	const host = ts.createCompilerHost(compilerOptions);
	const originalGetSourceFile = host.getSourceFile;
	host.getSourceFile = (name, languageVersion) => {
		if (name === fileName) return sourceFile;
		return originalGetSourceFile.call(host, name, languageVersion);
	};

	const program = ts.createProgram([fileName], compilerOptions, host);
	const syntacticDiags = program.getSyntacticDiagnostics(sourceFile);

	for (const diag of syntacticDiags) {
		if (diag.file && diag.start !== undefined) {
			const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
			errors.push({
				file: fileName,
				line: pos.line + 1,
				column: pos.character + 1,
				message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
				severity: diag.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
			});
		}
	}

	return errors;
}

export function validatePython(content: string, fileName: string): LintError[] {
	const errors: LintError[] = [];
	const lines = content.split('\n');

	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let inTripleDoubleQuote = false;
	let inTripleSingleQuote = false;
	let inSingleQuote = false;
	let inDoubleQuote = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trimStart();

		if (trimmed.startsWith('#')) continue;

		for (let j = 0; j < line.length; j++) {
			const ch = line[j];
			const next2 = line.slice(j, j + 3);

			if (inTripleDoubleQuote) {
				if (next2 === '"""') { inTripleDoubleQuote = false; j += 2; }
				continue;
			}
			if (inTripleSingleQuote) {
				if (next2 === "'''") { inTripleSingleQuote = false; j += 2; }
				continue;
			}
			if (inDoubleQuote) {
				if (ch === '\\') { j++; continue; }
				if (ch === '"') inDoubleQuote = false;
				continue;
			}
			if (inSingleQuote) {
				if (ch === '\\') { j++; continue; }
				if (ch === "'") inSingleQuote = false;
				continue;
			}

			if (next2 === '"""') { inTripleDoubleQuote = true; j += 2; continue; }
			if (next2 === "'''") { inTripleSingleQuote = true; j += 2; continue; }
			if (ch === '"') { inDoubleQuote = true; continue; }
			if (ch === "'") { inSingleQuote = true; continue; }
			if (ch === '#') break;

			if (ch === '(') parenDepth++;
			else if (ch === ')') parenDepth--;
			else if (ch === '[') bracketDepth++;
			else if (ch === ']') bracketDepth--;
			else if (ch === '{') braceDepth++;
			else if (ch === '}') braceDepth--;

			if (parenDepth < 0) {
				errors.push({ file: fileName, line: i + 1, column: j + 1, message: 'Unmatched closing parenthesis', severity: 'error' });
				parenDepth = 0;
			}
			if (bracketDepth < 0) {
				errors.push({ file: fileName, line: i + 1, column: j + 1, message: 'Unmatched closing bracket', severity: 'error' });
				bracketDepth = 0;
			}
			if (braceDepth < 0) {
				errors.push({ file: fileName, line: i + 1, column: j + 1, message: 'Unmatched closing brace', severity: 'error' });
				braceDepth = 0;
			}
		}

		if (!inTripleDoubleQuote && !inTripleSingleQuote) {
			if (inDoubleQuote || inSingleQuote) {
				errors.push({ file: fileName, line: i + 1, column: 1, message: 'Unterminated string literal', severity: 'error' });
				inDoubleQuote = false;
				inSingleQuote = false;
			}
		}

		if (trimmed.length > 0 && !inTripleDoubleQuote && !inTripleSingleQuote && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			const colonEndings = /:\s*$/;
			const continuationEndings = /\\$/;
			if (colonEndings.test(trimmed)) {
				const nextNonEmpty = lines.slice(i + 1).find(l => l.trim().length > 0);
				if (nextNonEmpty !== undefined) {
					const currentIndent = line.length - line.trimStart().length;
					const nextIndent = nextNonEmpty.length - nextNonEmpty.trimStart().length;
					if (nextIndent <= currentIndent && !nextNonEmpty.trimStart().startsWith('#')) {
						errors.push({ file: fileName, line: i + 2, column: 1, message: 'Expected indented block after colon', severity: 'error' });
					}
				}
			}
		}
	}

	if (parenDepth > 0) errors.push({ file: fileName, line: lines.length, column: 1, message: `Unclosed parenthesis (${parenDepth} remaining)`, severity: 'error' });
	if (bracketDepth > 0) errors.push({ file: fileName, line: lines.length, column: 1, message: `Unclosed bracket (${bracketDepth} remaining)`, severity: 'error' });
	if (braceDepth > 0) errors.push({ file: fileName, line: lines.length, column: 1, message: `Unclosed brace (${braceDepth} remaining)`, severity: 'error' });
	if (inTripleDoubleQuote) errors.push({ file: fileName, line: lines.length, column: 1, message: 'Unterminated triple-quoted string (""")', severity: 'error' });
	if (inTripleSingleQuote) errors.push({ file: fileName, line: lines.length, column: 1, message: "Unterminated triple-quoted string (''')", severity: 'error' });

	return errors;
}

export function validateSyntax(content: string, fileName: string): LintError[] {
	const ext = fileName.split('.').pop()?.toLowerCase();

	switch (ext) {
		case 'ts':
		case 'tsx':
		case 'js':
		case 'jsx':
		case 'mts':
		case 'cts':
			return validateTypeScript(content, fileName);
		case 'py':
			return validatePython(content, fileName);
		default:
			return [];
	}
}

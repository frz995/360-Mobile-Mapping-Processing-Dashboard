/**
 * Type declarations for the bootstrap generator.
 *
 * The generator is deliberately plain `.mjs` with no build step: it has to run
 * as `node scripts/bootstrap-migrations.mjs` on a reseller's machine with no
 * install step, which a TypeScript source would not allow. These declarations
 * exist so the test that guards it type-checks under the app's `strict`
 * settings, and are intentionally a subset — only the exports the test uses.
 *
 * Keep this in step with the implementation. A declaration that drifts is worse
 * than an `any`, because it would let the test pass against a signature the
 * script no longer has.
 */

export interface Statement {
  /** Statement text, trimmed. */
  text: string;
  /** 1-based line on which the statement starts. */
  startLine: number;
  /** Byte offset of the first non-whitespace character. */
  start: number;
  /** Offset just past the statement's terminator. */
  end: number;
  /** Relations this statement brings into existence. */
  creates: Set<string>;
  /** Relations this statement reads or writes. */
  references: Set<string>;
}

export interface Migration {
  /** File name, e.g. `0032_qa_defects_run_scope.sql`. */
  name: string;
  /** Four-character numeric prefix. */
  prefix: string;
  /** Full file contents. */
  sql: string;
  statements: Statement[];
}

export interface FileReport {
  name: string;
  prefix: string;
  /** Statements in the file. */
  total: number;
  /** Statements that can run at this point in the order. */
  applied: number;
  /** Statements referencing a relation a later migration creates. */
  deferred: number;
}

export interface SkippedStatement {
  /** File the statement belongs to. */
  file: string;
  /** 1-based start line. */
  line: number;
  /** Relations that do not exist yet. */
  relations: string[];
  text: string;
  start: number;
  end: number;
}

export interface AnalysisReport {
  files: FileReport[];
  skipped: SkippedStatement[];
}

/**
 * Split SQL into statements without cutting inside a dollar quote, quoted
 * string, identifier, or comment.
 */
export function splitStatements(sql: string): Statement[];

/** Blank out literals, quoted identifiers, dollar-quoted bodies and comments. */
export function maskLiterals(stmt: string): string;

/** Relations a statement reads or writes. */
export function referencedRelations(stmt: string): Set<string>;

/** Relations a statement brings into existence. */
export function createdRelations(stmt: string): Set<string>;

/** Read and parse every migration except the ones in `SKIP_FILES`. */
export function loadMigrations(): Migration[];

/**
 * Walk the ordered migrations and flag statements that can only run after a
 * later file.
 */
export function analyse(migrations: Migration[]): AnalysisReport;
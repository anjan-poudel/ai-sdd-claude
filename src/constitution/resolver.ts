/**
 * ConstitutionResolver — recursive merge of constitution.md files.
 * Framework → root → submodule hierarchy.
 * Root malformed → hard error. Submodule parse failure → warn + skip (strict_parse=false).
 *
 * Standards enforcement: coding standards docs (e.g. standards/java/CLAUDE-java.md)
 * are merged into the constitution so every agent receives them.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve, isAbsolute } from "path";

export interface ConstitutionOptions {
  project_path: string;
  strict_parse?: boolean; // default true
  /**
   * Explicit list of standards file paths (relative to project_path or absolute).
   * When undefined, auto-discovers *.md files under <project_path>/standards/.
   * Pass [] to disable standards entirely.
   */
  standards_paths?: string[];
  /** Hard error on missing standard file. Default false. */
  standards_strict?: boolean;
}

export interface ConstitutionResult {
  content: string;
  sources: string[];
  warnings: string[];
}

/**
 * Merge multiple constitution files in precedence order.
 * Lower index = lower precedence (later entries override earlier).
 */
function mergeConstitutions(constitutions: Array<{ path: string; content: string }>): string {
  if (constitutions.length === 0) return "";
  if (constitutions.length === 1) return constitutions[0]!.content;

  // Simple merge: concatenate with source headers
  return constitutions
    .map(({ path, content }) => `<!-- source: ${path} -->\n${content}`)
    .join("\n\n---\n\n");
}

/**
 * Find constitution.md files in a project directory tree.
 * Searches: root, .ai-sdd/, CLAUDE.md, specs/<feature>/constitution.md (feature constitutions),
 * and any submodule directories.
 */
function findConstitutionFiles(projectPath: string): string[] {
  const files: string[] = [];
  const candidates = [
    join(projectPath, "constitution.md"),
    join(projectPath, ".ai-sdd", "constitution.md"),
    join(projectPath, "CLAUDE.md"), // Claude Code convention
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      files.push(candidate);
    }
  }

  // Feature constitutions (specs/*/constitution.md, alphabetical by directory name)
  const specsDir = join(projectPath, "specs");
  try {
    if (existsSync(specsDir)) {
      const entries = readdirSync(specsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
      for (const dir of entries) {
        const featureConstitution = join(specsDir, dir, "constitution.md");
        if (existsSync(featureConstitution)) {
          files.push(featureConstitution);
        }
      }
    }
  } catch { /* directory unreadable — skip */ }

  // Search for submodule constitutions (one level deep)
  try {
    const entries = readdirSync(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const subConstitution = join(projectPath, entry.name, "constitution.md");
      if (existsSync(subConstitution)) {
        files.push(subConstitution);
      }
    }
  } catch {
    // Directory unreadable — skip
  }

  return files;
}

/**
 * Auto-discover all *.md files under <projectPath>/standards/ (recursive).
 * Returns paths sorted for deterministic ordering.
 */
function discoverDefaultStandards(projectPath: string): string[] {
  const standardsDir = join(projectPath, "standards");
  if (!existsSync(standardsDir)) return [];

  const found: string[] = [];

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          found.push(full);
        }
      }
    } catch { /* unreadable — skip */ }
  }

  walk(standardsDir);
  return found;
}

export class ConstitutionResolver {
  private readonly projectPath: string;
  private readonly strictParse: boolean;
  private readonly standardsPaths: string[] | undefined;
  private readonly standardsStrict: boolean;

  constructor(options: ConstitutionOptions) {
    this.projectPath = resolve(options.project_path);
    this.strictParse = options.strict_parse ?? true;
    this.standardsPaths = options.standards_paths;
    this.standardsStrict = options.standards_strict ?? false;
  }

  /**
   * Resolve coding standards documents.
   * - If standards_paths was explicitly set (including []), use it as-is.
   * - Otherwise auto-discover from standards/ in the project root.
   */
  private resolveStandards(): { content: string; sources: string[]; warnings: string[] } {
    const warnings: string[] = [];
    const sources: string[] = [];
    const parts: string[] = [];

    const paths: string[] = this.standardsPaths !== undefined
      ? this.standardsPaths.map((p) =>
          isAbsolute(p) ? p : resolve(this.projectPath, p),
        )
      : discoverDefaultStandards(this.projectPath);

    for (const filePath of paths) {
      if (!existsSync(filePath)) {
        const msg = `Standards file not found: ${filePath}`;
        if (this.standardsStrict) throw new Error(msg);
        warnings.push(msg);
        continue;
      }
      try {
        const content = readFileSync(filePath, "utf-8").trim();
        if (!content) {
          warnings.push(`Empty standards file: ${filePath}`);
          continue;
        }
        parts.push(`<!-- standards: ${filePath} -->\n${content}`);
        sources.push(filePath);
      } catch (err) {
        const msg = `Failed to read standards file ${filePath}: ${err instanceof Error ? err.message : String(err)}`;
        if (this.standardsStrict) throw new Error(msg);
        warnings.push(msg);
      }
    }

    const content = parts.length > 0
      ? `## Coding Standards\n\n${parts.join("\n\n---\n\n")}`
      : "";

    return { content, sources, warnings };
  }

  /**
   * Resolve the merged constitution for the project.
   */
  resolve(): ConstitutionResult {
    const warnings: string[] = [];
    const sources: string[] = [];
    const constitutions: Array<{ path: string; content: string }> = [];

    const files = findConstitutionFiles(this.projectPath);

    if (files.length === 0) {
      if (this.strictParse) {
        throw new Error(
          `No constitution.md found in project: ${this.projectPath}. ` +
          `Create constitution.md or .ai-sdd/constitution.md.`,
        );
      }
      warnings.push(`No constitution.md found in ${this.projectPath}`);
      return { content: "", sources: [], warnings };
    }

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, "utf-8").trim();
        if (!content) {
          warnings.push(`Empty constitution file: ${filePath}`);
          continue;
        }
        constitutions.push({ path: filePath, content });
        sources.push(filePath);
      } catch (err) {
        const msg = `Failed to read constitution file ${filePath}: ${err instanceof Error ? err.message : String(err)}`;
        if (this.strictParse && filePath === files[0]) {
          // Root constitution failure → hard error
          throw new Error(msg);
        }
        warnings.push(msg);
      }
    }

    if (constitutions.length === 0) {
      if (this.strictParse) {
        throw new Error("All constitution files failed to load");
      }
      return { content: "", sources, warnings };
    }

    const constitutionContent = mergeConstitutions(constitutions);

    // Append coding standards after the constitution content
    const standards = this.resolveStandards();
    warnings.push(...standards.warnings);
    sources.push(...standards.sources);

    const content = standards.content
      ? `${constitutionContent}\n\n${standards.content}`
      : constitutionContent;

    return { content, sources, warnings };
  }

  /**
   * Get the constitution for a specific task context.
   * For now, returns the full merged constitution.
   * Future: task-scoped constitution filtering.
   */
  resolveForTask(task_id: string): ConstitutionResult {
    // In Phase 1, all tasks get the full constitution
    // Phase 3+ can add task-scoped constitution filtering
    void task_id;
    return this.resolve();
  }
}

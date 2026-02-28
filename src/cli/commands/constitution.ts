/**
 * ai-sdd constitution — print merged constitution.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { ConstitutionResolver } from "../../constitution/resolver.ts";
import { loadProjectConfig } from "../config-loader.ts";

export function registerConstitutionCommand(program: Command): void {
  program
    .command("constitution")
    .description("Print the merged project constitution")
    .option("--task <id>", "Print constitution scoped to a specific task")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      const config = loadProjectConfig(projectPath);

      const resolver = new ConstitutionResolver({
        project_path: projectPath,
        strict_parse: config.constitution?.strict_parse ?? true,
      });

      try {
        const result = options.task
          ? resolver.resolveForTask(options.task as string)
          : resolver.resolve();

        if (result.warnings.length > 0) {
          for (const w of result.warnings) {
            process.stderr.write(`Warning: ${w}\n`);
          }
        }

        if (!result.content) {
          console.log("(no constitution found)");
          return;
        }

        console.log(result.content);

        if (result.sources.length > 0) {
          process.stderr.write(`\n--- Sources: ${result.sources.join(", ")} ---\n`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

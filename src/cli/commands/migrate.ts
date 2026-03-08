/**
 * ai-sdd migrate — Phase 5 stub.
 * Interface defined here; full implementation is Phase 5.
 */

import type { Command } from "commander";

export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description("Migrate workflow state and config to current schema version (Phase 5)")
    .option("--dry-run", "Print migration plan without applying changes")
    .option("--from <version>", "Source schema version")
    .option("--to <version>", "Target schema version (default: current)")
    .action((options) => {
      const from = options.from as string | undefined;
      const to = options.to as string | undefined;
      const dryRun = options.dryRun as boolean;

      console.error("ai-sdd migrate: not yet implemented.");
      console.error();

      if (from && to) {
        console.error(`Requested: v${from} → v${to}`);
      } else if (from) {
        console.error(`Requested: v${from} → current`);
      }
      if (dryRun) {
        console.error("(dry-run mode — no changes would be applied, but migration is not yet built)");
      }

      console.error();
      console.error("Manual recovery for schema version mismatches:");
      console.error("  1. Back up your .ai-sdd/state/ directory");
      console.error("  2. Open each .json file under .ai-sdd/state/ and set schema_version to '1'");
      console.error("  3. Re-run: ai-sdd validate-config");

      process.exit(1);
    });
}

#!/usr/bin/env bun
/**
 * ai-sdd CLI entry point.
 */

import { Command } from "commander";
import { registerRunCommand } from "./commands/run.ts";
import { registerStatusCommand } from "./commands/status.ts";
import { registerHilCommand } from "./commands/hil.ts";
import { registerCompleteTaskCommand } from "./commands/complete-task.ts";
import { registerValidateConfigCommand } from "./commands/validate-config.ts";
import { registerConstitutionCommand } from "./commands/constitution.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerServeCommand } from "./commands/serve.ts";
import { registerMigrateCommand } from "./commands/migrate.ts";
import { registerSessionsCommand } from "./commands/sessions.ts";

const program = new Command();

program
  .name("ai-sdd")
  .description("AI-driven Software Design & Development orchestration framework")
  .version("0.1.0");

registerRunCommand(program);
registerStatusCommand(program);
registerHilCommand(program);
registerCompleteTaskCommand(program);
registerValidateConfigCommand(program);
registerConstitutionCommand(program);
registerInitCommand(program);
registerServeCommand(program);
registerMigrateCommand(program);
registerSessionsCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

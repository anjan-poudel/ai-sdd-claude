/**
 * ai-sdd init — install tool integration files.
 */

import type { Command } from "commander";
import { resolve, join } from "path";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize ai-sdd in a project")
    .requiredOption("--tool <name>", "Tool integration: claude_code | codex | roo_code")
    .option("--project <path>", "Target project directory", process.cwd())
    .action((options) => {
      const tool = options.tool as string;
      const projectPath = resolve(options.project as string);
      const validTools = ["claude_code", "codex", "roo_code"];

      if (!validTools.includes(tool)) {
        console.error(`Unknown tool '${tool}'. Valid options: ${validTools.join(", ")}`);
        process.exit(1);
      }

      console.log(`Initializing ai-sdd in ${projectPath} for tool: ${tool}`);

      // Create .ai-sdd/ structure
      const aiSddDir = join(projectPath, ".ai-sdd");
      for (const dir of ["state", "state/hil", "outputs", "agents"]) {
        const p = join(aiSddDir, dir);
        if (!existsSync(p)) mkdirSync(p, { recursive: true });
      }

      // Write minimal ai-sdd.yaml
      const configPath = join(aiSddDir, "ai-sdd.yaml");
      if (!existsSync(configPath)) {
        writeFileSync(configPath, [
          "version: \"1\"",
          "",
          "adapter:",
          `  type: ${tool === "codex" ? "openai" : tool}`,
          "",
          "engine:",
          "  max_concurrent_tasks: 3",
          "  cost_budget_per_run_usd: 10.00",
          "",
          "overlays:",
          "  hil:",
          "    enabled: true",
        ].join("\n") + "\n", "utf-8");
        console.log(`  Created: .ai-sdd/ai-sdd.yaml`);
      }

      // Tool-specific files
      switch (tool) {
        case "claude_code":
          installClaudeCode(projectPath);
          break;
        case "codex":
          installCodex(projectPath);
          break;
        case "roo_code":
          installRooCode(projectPath);
          break;
      }

      console.log("\nInitialization complete. Next steps:");
      console.log("  1. Create .ai-sdd/workflow.yaml (or copy from data/workflows/default-sdd.yaml)");
      console.log("  2. Create constitution.md in your project root");
      console.log("  3. Run: ai-sdd run --dry-run");
    });
}

function installClaudeCode(projectPath: string): void {
  const claudeDir = join(projectPath, ".claude");
  const agentsDir = join(claudeDir, "agents");
  const skillsDir = join(claudeDir, "skills");

  for (const dir of [agentsDir, skillsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const dataDir = new URL("../../../integration/claude-code", import.meta.url).pathname;
  console.log(`  Created: .claude/agents/`);
  console.log(`  Created: .claude/skills/`);
  console.log(`  Note: Copy agent definitions from ${dataDir}`);
}

function installCodex(projectPath: string): void {
  const agentsPath = join(projectPath, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, [
      "# AGENTS.md — ai-sdd Codex Integration",
      "",
      "This project uses ai-sdd for multi-agent orchestration.",
      "",
      "## Completing Tasks",
      "",
      "When assigned a task by ai-sdd, use:",
      "```",
      "ai-sdd complete-task --task <id> --output-path <path> --content-file <tmp>",
      "```",
    ].join("\n") + "\n", "utf-8");
    console.log(`  Created: AGENTS.md`);
  }
}

function installRooCode(projectPath: string): void {
  const roomodesPath = join(projectPath, ".roomodes");
  const rooDir = join(projectPath, ".roo");
  if (!existsSync(rooDir)) mkdirSync(rooDir, { recursive: true });

  if (!existsSync(roomodesPath)) {
    writeFileSync(roomodesPath, JSON.stringify({
      customModes: [
        {
          slug: "ai-sdd-agent",
          name: "ai-sdd Agent",
          roleDefinition: "You are an ai-sdd agent. Complete tasks using the ai-sdd CLI.",
          groups: ["read", "edit", "command"],
        },
      ],
    }, null, 2) + "\n", "utf-8");
    console.log(`  Created: .roomodes`);
  }

  const mcpPath = join(rooDir, "mcp.json");
  if (!existsSync(mcpPath)) {
    writeFileSync(mcpPath, JSON.stringify({
      mcpServers: {
        "ai-sdd": {
          command: "ai-sdd",
          args: ["serve", "--mcp"],
        },
      },
    }, null, 2) + "\n", "utf-8");
    console.log(`  Created: .roo/mcp.json`);
  }
}

/**
 * ai-sdd init — install tool integration files.
 */

import type { Command } from "commander";
import { resolve, join } from "path";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, appendFileSync, readFileSync } from "fs";

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

      // Copy default workflow
      const workflowsDir = join(aiSddDir, "workflows");
      if (!existsSync(workflowsDir)) mkdirSync(workflowsDir, { recursive: true });
      const workflowDest = join(workflowsDir, "default-sdd.yaml");
      if (!existsSync(workflowDest)) {
        const workflowSrc = new URL("../../../data/workflows/default-sdd.yaml", import.meta.url).pathname;
        if (existsSync(workflowSrc)) {
          copyFileSync(workflowSrc, workflowDest);
          console.log(`  Created: .ai-sdd/workflows/default-sdd.yaml`);
        }
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
      console.log("  1. Fill in constitution.md with your project purpose and standards");
      console.log("  2. Run: ai-sdd run --dry-run");
      console.log("  3. In Claude Code, type /sdd-run to start the workflow");
    });
}

function installClaudeCode(projectPath: string): void {
  const claudeDir = join(projectPath, ".claude");
  const agentsDir = join(claudeDir, "agents");
  const skillsDir = join(claudeDir, "skills");

  for (const dir of [agentsDir, skillsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const dataDir = new URL("../../../data/integration/claude-code", import.meta.url).pathname;

  // Copy agent files.
  // sdd-scaffold.md is intentionally excluded: it is a pre-init scaffolding agent
  // that should be used BEFORE ai-sdd init (via /sdd-scaffold skill), not as a
  // workflow execution agent. Copying it here would confuse it with runtime agents.
  const EXCLUDED_AGENTS = new Set(["sdd-scaffold.md"]);
  const srcAgentsDir = join(dataDir, "agents");
  if (existsSync(srcAgentsDir)) {
    for (const file of readdirSync(srcAgentsDir)) {
      if (EXCLUDED_AGENTS.has(file)) continue;
      const dest = join(agentsDir, file);
      const existed = existsSync(dest);
      copyFileSync(join(srcAgentsDir, file), dest);
      console.log(`  ${existed ? "Updated" : "Created"}: .claude/agents/${file}`);
    }
  }

  // Copy skill directories (each skill is a subdirectory with SKILL.md)
  const srcSkillsDir = join(dataDir, "skills");
  if (existsSync(srcSkillsDir)) {
    for (const skillName of readdirSync(srcSkillsDir)) {
      const skillDestDir = join(skillsDir, skillName);
      if (!existsSync(skillDestDir)) mkdirSync(skillDestDir, { recursive: true });
      const skillFile = join(srcSkillsDir, skillName, "SKILL.md");
      const skillFileDest = join(skillDestDir, "SKILL.md");
      if (existsSync(skillFile) && !existsSync(skillFileDest)) {
        copyFileSync(skillFile, skillFileDest);
        console.log(`  Created: .claude/skills/${skillName}/SKILL.md`);
      }
    }
  }

  // Append ai-sdd section to CLAUDE.md (or create it)
  const claudeMdPath = join(projectPath, "CLAUDE.md");
  const templatePath = join(dataDir, "CLAUDE.md.template");
  if (existsSync(templatePath)) {
    const templateContent = readFileSync(templatePath, "utf-8");
    if (!existsSync(claudeMdPath)) {
      writeFileSync(claudeMdPath, `# CLAUDE.md\n\n${templateContent}`, "utf-8");
      console.log(`  Created: CLAUDE.md`);
    } else {
      const existing = readFileSync(claudeMdPath, "utf-8");
      if (!existing.includes("ai-sdd: Specification-Driven Development")) {
        appendFileSync(claudeMdPath, `\n---\n\n${templateContent}`, "utf-8");
        console.log(`  Updated: CLAUDE.md (appended ai-sdd section)`);
      }
    }
  }

  // Create blank constitution.md if absent
  const constitutionPath = join(projectPath, "constitution.md");
  if (!existsSync(constitutionPath)) {
    writeFileSync(constitutionPath, [
      "# Constitution",
      "",
      "## Project Purpose",
      "",
      "<!-- Describe the project goal and context here -->",
      "",
      "## Standards",
      "",
      "<!-- Define quality standards, review criteria, and constraints -->",
      "",
      "## Artifact Manifest",
      "",
      "<!-- AUTO-GENERATED by ai-sdd engine after each task — do not edit this section -->",
    ].join("\n") + "\n", "utf-8");
    console.log(`  Created: constitution.md`);
  }
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

/** Role-specific Roo Code mode definitions matching the 6 default ai-sdd agent roles. */
const ROO_AGENT_MODES = [
  {
    slug: "ai-sdd-ba",
    name: "ai-sdd: Business Analyst",
    roleDefinition: "You are the ai-sdd Business Analyst agent. Your role is to define requirements, capture stakeholder needs, and produce detailed specification documents. Complete assigned tasks using the ai-sdd CLI.",
    groups: ["read", "edit", "command"],
  },
  {
    slug: "ai-sdd-architect",
    name: "ai-sdd: Architect",
    roleDefinition: "You are the ai-sdd Architect agent. Your role is to design system architecture, define component boundaries, and produce architecture documentation. Complete assigned tasks using the ai-sdd CLI.",
    groups: ["read", "edit", "command"],
  },
  {
    slug: "ai-sdd-pe",
    name: "ai-sdd: Principal Engineer",
    roleDefinition: "You are the ai-sdd Principal Engineer agent. Your role is to make high-level technical decisions, review architecture, and ensure engineering standards. Complete assigned tasks using the ai-sdd CLI.",
    groups: ["read", "edit", "command"],
  },
  {
    slug: "ai-sdd-le",
    name: "ai-sdd: Lead Engineer",
    roleDefinition: "You are the ai-sdd Lead Engineer agent. Your role is to plan implementation, break down tasks, and produce technical specifications for developers. Complete assigned tasks using the ai-sdd CLI.",
    groups: ["read", "edit", "command"],
  },
  {
    slug: "ai-sdd-dev",
    name: "ai-sdd: Developer",
    roleDefinition: "You are the ai-sdd Developer agent. Your role is to implement features, write code, and produce implementation artifacts. Complete assigned tasks using the ai-sdd CLI.",
    groups: ["read", "edit", "command"],
  },
  {
    slug: "ai-sdd-reviewer",
    name: "ai-sdd: Reviewer",
    roleDefinition: "You are the ai-sdd Reviewer agent. Your role is to review code and artifacts, identify issues, and produce review reports. Complete assigned tasks using the ai-sdd CLI.",
    groups: ["read", "edit", "command"],
  },
];

function installRooCode(projectPath: string): void {
  const roomodesPath = join(projectPath, ".roomodes");
  const rooDir = join(projectPath, ".roo");
  if (!existsSync(rooDir)) mkdirSync(rooDir, { recursive: true });

  if (!existsSync(roomodesPath)) {
    writeFileSync(roomodesPath, JSON.stringify({
      customModes: ROO_AGENT_MODES,
    }, null, 2) + "\n", "utf-8");
    console.log(`  Created: .roomodes (${ROO_AGENT_MODES.length} role-specific modes)`);
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

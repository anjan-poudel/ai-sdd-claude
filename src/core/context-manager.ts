/**
 * ContextManager — assembles AgentContext for each task dispatch.
 * Pull model: agents receive the constitution manifest + handover state.
 * The engine does NOT pre-load artifact file contents.
 */

import type { AgentContext, TaskDefinition, DispatchMode } from "../types/index.ts";

export interface ContextAssemblyOptions {
  constitution: string;
  handover_state: Record<string, unknown>;
  task_definition: TaskDefinition;
  dispatch_mode: DispatchMode;
}

/**
 * Assemble agent context for a task dispatch.
 *
 * Pull model: the constitution string includes the artifact manifest table.
 * Agents read artifact files directly via their native tools (Read, Grep, MCP).
 * The engine never injects raw file contents into the context.
 */
export function assembleContext(options: ContextAssemblyOptions): AgentContext {
  return {
    constitution: options.constitution,
    handover_state: options.handover_state,
    task_definition: options.task_definition,
    dispatch_mode: options.dispatch_mode,
  };
}

/**
 * Build the system prompt for a task in "direct" dispatch mode.
 * Not used in "delegation" mode — the tool manages its own context.
 */
export function buildSystemPrompt(options: {
  agent_persona: string;
  agent_display_name: string;
  constitution: string;
  task_definition: TaskDefinition;
}): string {
  const { agent_persona, agent_display_name, constitution, task_definition } = options;
  return [
    `# Agent: ${agent_display_name}`,
    "",
    "## Your Persona",
    agent_persona,
    "",
    "## Project Constitution",
    constitution,
    "",
    "## Current Task",
    `**Task ID:** ${task_definition.id}`,
    `**Description:** ${task_definition.description}`,
    "",
    task_definition.outputs && task_definition.outputs.length > 0
      ? [
        "## Expected Outputs",
        ...task_definition.outputs.map((o) => `- \`${o.path}\`${o.contract ? ` (contract: ${o.contract})` : ""}`),
      ].join("\n")
      : "",
    "",
    task_definition.exit_conditions && task_definition.exit_conditions.length > 0
      ? [
        "## Exit Conditions",
        ...task_definition.exit_conditions.map((c) => `- \`${c}\``),
      ].join("\n")
      : "",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
}

/**
 * Merge handover state from a completed task into the running handover dict.
 */
export function mergeHandoverState(
  current: Record<string, unknown>,
  task_id: string,
  task_handover: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...current,
    [task_id]: task_handover,
  };
}

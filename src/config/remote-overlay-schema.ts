/**
 * Zod schemas for remote overlay configuration sections.
 * These are parsed separately from ProjectConfig to preserve backward compatibility.
 */
import { z } from "zod";

export const OverlayBackendConfigSchema = z.object({
  runtime: z.enum(["cli", "mcp"]),
  command: z.array(z.string()).min(1),
  tool: z.string().optional(),                           // required when runtime is "mcp"
  transport: z.enum(["stdio"]).default("stdio"),
  timeout_ms: z.number().int().positive().default(5000),
  failure_policy: z.enum(["skip", "warn", "fail_closed"]).default("warn"),
  env: z.record(z.string()).optional(),
}).refine(
  (data) => data.runtime !== "mcp" || data.tool !== undefined,
  {
    message: "overlay_backends: 'tool' is required when runtime is 'mcp'",
    path: ["tool"],
  },
);

export const RemoteOverlayConfigSchema = z.object({
  backend: z.string(),
  enabled: z.boolean().default(true),
  hooks: z.array(z.enum(["pre_task", "post_task"])).min(1, {
    message: "remote_overlays: 'hooks' must contain at least one hook (pre_task or post_task)",
  }),
  phases: z.array(z.string()).optional(),
  blocking: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

export const GovernanceConfigSchema = z.object({
  requirements_lock: z.enum(["off", "warn", "enforce"]).default("warn"),
});

export const RemoteOverlaysSectionSchema = z.object({
  governance: GovernanceConfigSchema.optional(),
  overlay_backends: z.record(OverlayBackendConfigSchema).optional(),
  remote_overlays: z.record(RemoteOverlayConfigSchema).optional(),
}).optional();

export type ResolvedBackendConfig = z.infer<typeof OverlayBackendConfigSchema>;
export type ResolvedRemoteOverlayConfig = z.infer<typeof RemoteOverlayConfigSchema>;
export type ResolvedGovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

// Use the inferred type directly to avoid exactOptionalPropertyTypes mismatches.
export type ResolvedOverlayConfig = NonNullable<z.infer<typeof RemoteOverlaysSectionSchema>>;

/**
 * Parse and validate the remote overlay config section.
 * Returns undefined if the section is absent (no-op for existing configs).
 * Throws ZodError on validation failure.
 */
export function parseRemoteOverlayConfig(raw: unknown): ResolvedOverlayConfig | undefined {
  const result = RemoteOverlaysSectionSchema.parse(raw);
  return result;
}

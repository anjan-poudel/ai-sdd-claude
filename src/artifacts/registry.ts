/**
 * Artifact registry — loads artifacts/schema.yaml → in-memory contract registry.
 */
import { z } from "zod";
import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import type { ArtifactContract, ArtifactSchema } from "../types/index.ts";

const ArtifactFieldSchema = z.object({
  required: z.boolean(),
  type: z.string().optional(),
  description: z.string().optional(),
});

const ArtifactContractSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  fields: z.record(z.string(), ArtifactFieldSchema).optional(),
  sections: z.array(z.string()).optional(),
});

const ArtifactSchemaFileSchema = z.object({
  version: z.string(),
  contracts: z.record(z.string(), ArtifactContractSchema),
});

const SCHEMA_VERSION = "1";

export class ArtifactRegistry {
  private contracts = new Map<string, ArtifactContract>();
  private schemaVersion = "";

  /**
   * Load contracts from a schema YAML file.
   * Throws if the file is missing or version mismatches.
   */
  loadFile(schemaPath: string): void {
    if (!existsSync(schemaPath)) {
      throw new Error(`Artifact schema file not found: ${schemaPath}`);
    }

    const raw = readFileSync(schemaPath, "utf-8");
    const parsed = yaml.load(raw) as unknown;
    const result = ArtifactSchemaFileSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Artifact schema validation error in ${schemaPath}:\n${result.error.errors
          .map((e) => `  ${e.path.join(".")}: ${e.message}`)
          .join("\n")}`,
      );
    }

    if (result.data.version !== SCHEMA_VERSION) {
      throw new Error(
        `Artifact schema version mismatch: expected '${SCHEMA_VERSION}', ` +
        `got '${result.data.version}'; run ai-sdd migrate`,
      );
    }

    this.schemaVersion = result.data.version;
    for (const [key, contract] of Object.entries(result.data.contracts)) {
      this.contracts.set(key, contract as ArtifactContract);
      // Also register by name for lookup by declared contract field
      this.contracts.set(contract.name, contract as ArtifactContract);
    }
  }

  /**
   * Look up a contract by name or key.
   * Returns null if not found (not an error in legacy mode).
   */
  get(nameOrKey: string): ArtifactContract | null {
    return this.contracts.get(nameOrKey) ?? null;
  }

  /**
   * Get a contract, throwing if not found (strict mode).
   */
  getStrict(nameOrKey: string): ArtifactContract {
    const contract = this.get(nameOrKey);
    if (!contract) {
      throw new Error(
        `Artifact contract '${nameOrKey}' not found in registry. ` +
        `Add it to artifacts/schema.yaml or use --allow-legacy-untyped-artifacts.`,
      );
    }
    return contract;
  }

  has(nameOrKey: string): boolean {
    return this.contracts.has(nameOrKey);
  }

  getAll(): ArtifactContract[] {
    // Deduplicate (since we store by both key and name)
    const seen = new Set<string>();
    const result: ArtifactContract[] = [];
    for (const contract of this.contracts.values()) {
      if (!seen.has(contract.name)) {
        seen.add(contract.name);
        result.push(contract);
      }
    }
    return result;
  }
}

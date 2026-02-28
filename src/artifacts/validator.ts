/**
 * Artifact validator — post-task output validation against contracts.
 */

import type { ArtifactContract } from "../types/index.ts";
import type { ArtifactRegistry } from "./registry.ts";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ArtifactValidator {
  constructor(private readonly registry: ArtifactRegistry) {}

  /**
   * Validate artifact content against its contract.
   * Returns validation result with specific error messages.
   */
  validate(
    content: string,
    contractNameOrKey: string,
    allowLegacyUntyped = false,
  ): ValidationResult {
    const contract = this.registry.get(contractNameOrKey);

    if (!contract) {
      if (allowLegacyUntyped) {
        return {
          valid: true,
          errors: [],
          warnings: [`Contract '${contractNameOrKey}' not found in registry; skipping (legacy mode)`],
        };
      }
      return {
        valid: false,
        errors: [`Contract '${contractNameOrKey}' not found in registry`],
        warnings: [],
      };
    }

    return this.validateAgainstContract(content, contract);
  }

  private validateAgainstContract(
    content: string,
    contract: ArtifactContract,
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required sections (Markdown headers)
    if (contract.sections) {
      for (const section of contract.sections) {
        const sectionHeader = `## ${section}`;
        if (!content.includes(sectionHeader)) {
          errors.push(`Missing required section: '${sectionHeader}'`);
        }
      }
    }

    // Check required fields (key: value patterns)
    if (contract.fields) {
      for (const [fieldName, fieldDef] of Object.entries(contract.fields)) {
        if (fieldDef.required) {
          // Look for the field as a Markdown key or YAML-like key
          const lowerContent = content.toLowerCase();
          const patterns = [
            `**${fieldName}**:`,
            `${fieldName}:`,
            `# ${fieldName}`,
            `## ${fieldName}`,
          ];
          const found = patterns.some((p) => lowerContent.includes(p.toLowerCase()));
          if (!found) {
            errors.push(`Missing required field: '${fieldName}'`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

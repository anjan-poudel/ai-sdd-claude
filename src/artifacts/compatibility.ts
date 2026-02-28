/**
 * Artifact compatibility — producer/consumer version check.
 */

import type { ArtifactContract } from "../types/index.ts";

export interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
}

/**
 * Check if a producer version is compatible with a consumer version.
 * Uses semver-style major version check.
 */
export function checkCompatibility(
  producer: ArtifactContract,
  consumer: ArtifactContract,
): CompatibilityResult {
  if (producer.name !== consumer.name) {
    return {
      compatible: false,
      reason: `Contract name mismatch: producer='${producer.name}', consumer='${consumer.name}'`,
    };
  }

  const producerMajor = parseInt(producer.version.split(".")[0] ?? "0", 10);
  const consumerMajor = parseInt(consumer.version.split(".")[0] ?? "0", 10);

  if (producerMajor !== consumerMajor) {
    return {
      compatible: false,
      reason:
        `Major version mismatch for contract '${producer.name}': ` +
        `producer v${producer.version} vs consumer v${consumer.version}`,
    };
  }

  return { compatible: true };
}

/**
 * Parse a contract reference string (e.g. "requirements_doc@1").
 */
export function parseContractRef(ref: string): { name: string; version: string } {
  const atIdx = ref.lastIndexOf("@");
  if (atIdx < 0) return { name: ref, version: "1" };
  return {
    name: ref.substring(0, atIdx),
    version: ref.substring(atIdx + 1),
  };
}

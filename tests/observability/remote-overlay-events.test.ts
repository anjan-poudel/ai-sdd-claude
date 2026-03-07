/**
 * T010: Remote overlay observability events tests.
 * Tests schema validation, log level classification, and secret redaction.
 *
 * CLAUDE.md §5: Error messages are contracts — event field assertions match actual emitted data.
 */

import { describe, it, expect } from "bun:test";
import {
  OverlayRemoteConnectingEvent,
  OverlayRemoteConnectedEvent,
  OverlayRemoteInvokedEvent,
  OverlayRemoteDecisionEvent,
  OverlayRemoteFailedEvent,
  OverlayRemoteFallbackEvent,
} from "../../src/observability/events.ts";
import { ObservabilityEmitter } from "../../src/observability/emitter.ts";
import type { AnyEvent } from "../../src/observability/events.ts";

// ── Schema validation tests ────────────────────────────────────────────────────

describe("T010: OverlayRemoteConnectingEvent schema", () => {
  it("1. validates a correct payload", () => {
    const payload = {
      type: "overlay.remote.connecting",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        task_id: "task-a",
        workflow_id: "test-wf",
        run_id: "run-001",
      },
    };
    const result = OverlayRemoteConnectingEvent.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe("T010: OverlayRemoteConnectedEvent schema", () => {
  it("2. validates with duration_ms field", () => {
    const payload = {
      type: "overlay.remote.connected",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        task_id: "task-a",
        duration_ms: 42,
      },
    };
    const result = OverlayRemoteConnectedEvent.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.duration_ms).toBe(42);
    }
  });
});

describe("T010: OverlayRemoteFailedEvent schema", () => {
  it("3a. validates failure_tier: 'transport'", () => {
    const payload = {
      type: "overlay.remote.failed",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        failure_tier: "transport",
        error_message: "Connection refused",
        duration_ms: 100,
      },
    };
    const result = OverlayRemoteFailedEvent.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.failure_tier).toBe("transport");
    }
  });

  it("3b. validates failure_tier: 'schema'", () => {
    const payload = {
      type: "overlay.remote.failed",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "post_task",
        task_id: "task-a",
        failure_tier: "schema",
        error_message: "Schema validation failed: invalid verdict",
        duration_ms: 55,
      },
    };
    const result = OverlayRemoteFailedEvent.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.failure_tier).toBe("schema");
    }
  });
});

describe("T010: OverlayRemoteFallbackEvent schema", () => {
  it("4a. accepts failure_policy: 'warn'", () => {
    const payload = {
      type: "overlay.remote.fallback",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        failure_policy: "warn",
      },
    };
    const result = OverlayRemoteFallbackEvent.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("4b. accepts failure_policy: 'skip'", () => {
    const payload = {
      type: "overlay.remote.fallback",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        failure_policy: "skip",
      },
    };
    const result = OverlayRemoteFallbackEvent.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("5. rejects failure_policy: 'fail_closed' (CLAUDE.md §5 — error messages are contracts)", () => {
    const payload = {
      type: "overlay.remote.fallback",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        failure_policy: "fail_closed", // invalid — fail_closed never produces a fallback
      },
    };
    const result = OverlayRemoteFallbackEvent.safeParse(payload);
    // fail_closed is not "skip" or "warn", so Zod must reject it
    expect(result.success).toBe(false);
  });
});

describe("T010: OverlayRemoteDecisionEvent schema", () => {
  it("6a. validates verdict: 'PASS'", () => {
    const payload = {
      type: "overlay.remote.decision",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        verdict: "PASS",
        duration_ms: 10,
      },
    };
    const result = OverlayRemoteDecisionEvent.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("6b. validates verdict: 'REWORK'", () => {
    const payload = {
      type: "overlay.remote.decision",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        verdict: "REWORK",
        duration_ms: 20,
      },
    };
    const result = OverlayRemoteDecisionEvent.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("6c. validates verdict: 'FAIL'", () => {
    const payload = {
      type: "overlay.remote.decision",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        verdict: "FAIL",
        duration_ms: 30,
      },
    };
    const result = OverlayRemoteDecisionEvent.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("6d. validates verdict: 'HIL'", () => {
    const payload = {
      type: "overlay.remote.decision",
      run_id: "run-001",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      data: {
        overlay_name: "security-check",
        backend_id: "mcp-server",
        hook: "pre_task",
        task_id: "task-a",
        verdict: "HIL",
        duration_ms: 40,
      },
    };
    const result = OverlayRemoteDecisionEvent.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

// ── Log level classification tests ────────────────────────────────────────────

describe("T010: ObservabilityEmitter getEventLevel for remote overlay events", () => {
  function makeEmitter() {
    return new ObservabilityEmitter({
      run_id: "run-001",
      workflow_id: "test-wf",
      log_level: "DEBUG", // capture everything
    });
  }

  /**
   * Capture stderr and stdout to determine the log level of emitted events.
   * The emitter writes ERROR/WARN to stderr and INFO/DEBUG to stdout.
   */
  function captureLevel(emitter: ObservabilityEmitter, eventType: string): "ERROR" | "WARN" | "INFO" | "DEBUG" {
    let lastLine = "";
    const origStderr = process.stderr.write.bind(process.stderr);
    const origStdout = process.stdout.write.bind(process.stdout);

    let stderrCalled = false;
    let stdoutCalled = false;

    // Temporarily intercept writes
    (process.stderr as unknown as { write: (s: string | Buffer) => boolean }).write = (s: string | Buffer) => {
      stderrCalled = true;
      lastLine = s.toString();
      return true;
    };
    (process.stdout as unknown as { write: (s: string | Buffer) => boolean }).write = (s: string | Buffer) => {
      stdoutCalled = true;
      lastLine = s.toString();
      return true;
    };

    try {
      emitter.emit(eventType, {
        overlay_name: "test",
        backend_id: "server",
        task_id: "task-x",
      });
    } finally {
      (process.stderr as unknown as { write: (s: string | Buffer) => boolean }).write = origStderr;
      (process.stdout as unknown as { write: (s: string | Buffer) => boolean }).write = origStdout;
    }

    if (stderrCalled) {
      if (lastLine.includes("[ERROR]")) return "ERROR";
      if (lastLine.includes("[WARN]")) return "WARN";
    }
    if (stdoutCalled) {
      if (lastLine.includes("[INFO]")) return "INFO";
      if (lastLine.includes("[DEBUG]")) return "DEBUG";
    }
    return "INFO"; // fallback
  }

  it("7. overlay.remote.failed → classified as ERROR (string includes 'failed')", () => {
    const emitter = makeEmitter();
    const level = captureLevel(emitter, "overlay.remote.failed");
    expect(level).toBe("ERROR");
  });

  it("8. overlay.remote.fallback → classified as WARN (explicit check required)", () => {
    const emitter = makeEmitter();
    const level = captureLevel(emitter, "overlay.remote.fallback");
    expect(level).toBe("WARN");
  });

  it("9. overlay.remote.decision → classified as INFO (no special pattern)", () => {
    const emitter = makeEmitter();
    const level = captureLevel(emitter, "overlay.remote.decision");
    expect(level).toBe("INFO");
  });

  it("10. overlay.remote.connecting → classified as INFO", () => {
    const emitter = makeEmitter();
    const level = captureLevel(emitter, "overlay.remote.connecting");
    expect(level).toBe("INFO");
  });
});

// ── Secret redaction integration test ────────────────────────────────────────────

describe("T010: Secret redaction via ObservabilityEmitter", () => {
  it("11. OPENAI_KEY pattern (sk- + 48 alphanumeric chars) is redacted in emitted event data", () => {
    const capturedEvents: AnyEvent[] = [];
    const emitter = new ObservabilityEmitter({
      run_id: "run-001",
      workflow_id: "test-wf",
      log_level: "ERROR", // suppress output during test
    });
    emitter.on((ev) => { capturedEvents.push(ev); });

    // Construct a string that matches the OPENAI_KEY pattern: sk- + exactly 48 alphanumeric chars
    const secretValue = "sk-" + "A".repeat(48);

    // Emit an overlay.remote.invoked event with the secret embedded in a field
    emitter.emit("overlay.remote.invoked", {
      overlay_name: "test-overlay",
      backend_id: secretValue, // the secret is in the backend_id field
      hook: "pre_task",
      task_id: "task-a",
    });

    expect(capturedEvents).toHaveLength(1);
    const eventData = JSON.stringify(capturedEvents[0]!.data);

    // The raw secret must NOT appear in the emitted event data
    expect(eventData).not.toContain(secretValue);
    // The sanitizer must replace it with [REDACTED:OPENAI_KEY]
    expect(eventData).toContain("[REDACTED:OPENAI_KEY]");
  });
});

// ── Required fields presence ─────────────────────────────────────────────────────

describe("T010: overlay.remote.failed required fields", () => {
  it("12. includes all required fields: overlay_name, backend_id, task_id, failure_tier, error_message, duration_ms", () => {
    const capturedEvents: AnyEvent[] = [];
    const emitter = new ObservabilityEmitter({
      run_id: "run-001",
      workflow_id: "test-wf",
      log_level: "ERROR",
    });
    emitter.on((ev) => { capturedEvents.push(ev); });

    emitter.emit("overlay.remote.failed", {
      overlay_name: "my-overlay",
      backend_id: "my-server",
      hook: "pre_task",
      task_id: "task-a",
      failure_tier: "transport",
      error_message: "Connection refused",
      duration_ms: 100,
    });

    expect(capturedEvents).toHaveLength(1);
    const data = capturedEvents[0]!.data;
    expect(data["overlay_name"]).toBe("my-overlay");
    expect(data["backend_id"]).toBe("my-server");
    expect(data["task_id"]).toBe("task-a");
    expect(data["failure_tier"]).toBe("transport");
    expect(data["error_message"]).toBe("Connection refused");
    expect(typeof data["duration_ms"]).toBe("number");
    expect(data["duration_ms"] as number).toBeGreaterThanOrEqual(0);
  });
});

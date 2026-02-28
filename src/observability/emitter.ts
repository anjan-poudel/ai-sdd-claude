/**
 * EventEmitter singleton — run_id scoped observability events.
 */
import { LogSanitizer, defaultSanitizer } from "./sanitizer.ts";
import type { AnyEvent } from "./events.ts";
import type { ObservabilityLogLevel } from "../types/index.ts";

export type EventHandler = (event: AnyEvent) => void | Promise<void>;

const LOG_LEVEL_RANK: Record<ObservabilityLogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export class ObservabilityEmitter {
  private handlers: EventHandler[] = [];
  private sanitizer: LogSanitizer;
  private logLevel: ObservabilityLogLevel;
  private runId: string;
  private workflowId: string;

  constructor(options: {
    run_id: string;
    workflow_id: string;
    log_level?: ObservabilityLogLevel;
    sanitizer?: LogSanitizer;
  }) {
    this.runId = options.run_id;
    this.workflowId = options.workflow_id;
    this.logLevel = options.log_level ?? "INFO";
    this.sanitizer = options.sanitizer ?? defaultSanitizer;
  }

  /**
   * Register an event handler.
   */
  on(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove an event handler.
   */
  off(handler: EventHandler): void {
    const idx = this.handlers.indexOf(handler);
    if (idx >= 0) this.handlers.splice(idx, 1);
  }

  /**
   * Emit an event. Sanitizes data before passing to handlers.
   * Never throws — errors in handlers are caught and logged to stderr.
   */
  emit(type: string, data: Record<string, unknown>): void {
    const event: AnyEvent = {
      type,
      run_id: this.runId,
      workflow_id: this.workflowId,
      timestamp: new Date().toISOString(),
      data: this.sanitizer.sanitizeObject(data),
    };

    this.log(event);

    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            process.stderr.write(`ObservabilityEmitter handler error: ${err}\n`);
          });
        }
      } catch (err) {
        process.stderr.write(`ObservabilityEmitter handler error: ${err}\n`);
      }
    }
  }

  private log(event: AnyEvent): void {
    const level = this.getEventLevel(event.type);
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[this.logLevel]) return;

    const prefix = `[${event.timestamp}] [${level}] [${event.type}]`;
    const line = `${prefix} ${JSON.stringify(event.data)}\n`;
    if (level === "ERROR" || level === "WARN") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  private getEventLevel(type: string): ObservabilityLogLevel {
    if (type.includes("failed") || type.includes("violation")) return "ERROR";
    if (type.includes("warning") || type.includes("rework")) return "WARN";
    return "INFO";
  }

  setLogLevel(level: ObservabilityLogLevel): void {
    this.logLevel = level;
  }
}

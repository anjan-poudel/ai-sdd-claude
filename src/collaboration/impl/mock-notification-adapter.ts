/**
 * MockNotificationAdapter — in-memory notification adapter for testing.
 * Records all calls, supports configurable error injection.
 */

import type {
  NotificationAdapter,
  NotificationMessage,
  RawSlackMessage,
  ListenerHandle,
  MessageHandler,
} from "../adapters/notification-adapter.ts";
import type { Result, MessageRef, ApprovalSignal, RejectionSignal } from "../types.ts";

export interface MockNotificationOptions {
  failOn?: { method: string; error: import("../types.ts").AdapterError };
  latencyMs?: number;
}

export interface MockCall {
  method: string;
  args: unknown[];
  timestamp: string;
}

export class MockNotificationAdapter implements NotificationAdapter {
  readonly provider = "mock";

  calls: MockCall[] = [];
  private handlers: Map<string, MessageHandler[]> = new Map();

  constructor(private readonly options: MockNotificationOptions = {}) {}

  async postNotification(channel: string, message: NotificationMessage): Promise<Result<MessageRef>> {
    this.record("postNotification", [channel, message]);
    if (this.options.latencyMs) await this.delay(this.options.latencyMs);
    if (this.options.failOn?.method === "postNotification") {
      return { ok: false, error: this.options.failOn.error };
    }
    return {
      ok: true,
      value: {
        provider: "mock",
        id: `mock-msg-${Date.now()}`,
        channel,
        timestamp: new Date().toISOString(),
      },
    };
  }

  async startListener(channel: string, handler: MessageHandler): Promise<Result<ListenerHandle>> {
    this.record("startListener", [channel]);
    if (this.options.failOn?.method === "startListener") {
      return { ok: false, error: this.options.failOn.error };
    }
    const existing = this.handlers.get(channel) ?? [];
    this.handlers.set(channel, [...existing, handler]);
    const id = `mock-listener-${Date.now()}`;
    return {
      ok: true,
      value: {
        id,
        stop: async () => {
          const handlers = this.handlers.get(channel) ?? [];
          this.handlers.set(channel, handlers.filter(h => h !== handler));
        },
      },
    };
  }

  async stopListener(handle: ListenerHandle): Promise<void> {
    this.record("stopListener", [handle.id]);
    await handle.stop();
  }

  parseApprovalSignal(raw: RawSlackMessage): ApprovalSignal | null {
    const match = (raw.text ?? "").match(/^@ai-sdd\s+approve\s+([\w-]+)(?:\s+(.+))?$/i);
    if (!match) return null;
    const signal: ApprovalSignal = {
      stakeholder_id: raw.user ?? "unknown",
      timestamp: raw.ts ?? new Date().toISOString(),
      source: `mock:${raw.channel ?? "general"}/${raw.ts ?? "0"}`,
    };
    const notes = match[2];
    if (notes !== undefined) signal.notes = notes;
    return signal;
  }

  parseRejectionSignal(raw: RawSlackMessage): RejectionSignal | null {
    const match = (raw.text ?? "").match(/^@ai-sdd\s+reject\s+([\w-]+)\s+(.+)$/i);
    if (!match) return null;
    const feedback = match[2];
    if (!feedback) return null;
    return {
      stakeholder_id: raw.user ?? "unknown",
      timestamp: raw.ts ?? new Date().toISOString(),
      source: `mock:${raw.channel ?? "general"}/${raw.ts ?? "0"}`,
      feedback,
    };
  }

  async healthCheck(): Promise<Result<void>> {
    this.record("healthCheck", []);
    if (this.options.failOn?.method === "healthCheck") {
      return { ok: false, error: this.options.failOn.error };
    }
    return { ok: true, value: undefined };
  }

  /** Test helper: simulate an incoming message being dispatched to all listeners. */
  simulateMessage(channel: string, raw: RawSlackMessage): void {
    const handlers = this.handlers.get(channel) ?? [];
    const approval = this.parseApprovalSignal(raw);
    const rejection = this.parseRejectionSignal(raw);
    const signal = approval ?? rejection;
    if (signal) {
      for (const h of handlers) h(signal);
    }
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args, timestamp: new Date().toISOString() });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

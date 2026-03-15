/**
 * MockNotificationChannel — in-memory notification channel for testing.
 * Records all publish() calls for assertion in tests.
 */

import type { NotificationChannel, ActivityMessage } from "../adapters/notification-channel.ts";
import type { Result, AdapterError } from "../types.ts";

export interface MockChannelCall {
  message: ActivityMessage;
  timestamp: string;
}

export class MockNotificationChannel implements NotificationChannel {
  readonly provider = "mock";

  calls: MockChannelCall[] = [];
  private failNextPublish: AdapterError | null = null;

  /**
   * Inject an error to be returned on the next publish() call (clears after use).
   */
  injectPublishError(error: AdapterError): void {
    this.failNextPublish = error;
  }

  async publish(message: ActivityMessage): Promise<Result<void>> {
    this.calls.push({ message, timestamp: new Date().toISOString() });
    if (this.failNextPublish) {
      const err = this.failNextPublish;
      this.failNextPublish = null;
      return { ok: false, error: err };
    }
    return { ok: true, value: undefined };
  }

  async healthCheck(): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }

  /** Returns all calls for a specific event type. */
  callsFor(event: ActivityMessage["event"]): MockChannelCall[] {
    return this.calls.filter(c => c.message.event === event);
  }

  /** Resets recorded calls. */
  reset(): void {
    this.calls = [];
    this.failNextPublish = null;
  }
}

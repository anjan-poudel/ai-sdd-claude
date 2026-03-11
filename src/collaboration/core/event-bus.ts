/**
 * CollaborationEventBus — in-process typed pub/sub for collaboration events.
 * Decouples adapters from consumers (engine, audit log, observability).
 * Thin wrapper around Node EventEmitter; forwards to ObservabilityEventEmitter.
 */

import { EventEmitter } from "events";
import type { CollaborationEvent, CollaborationEventType } from "../types.ts";

export type EventHandler = (event: CollaborationEvent) => void;
export type Unsubscribe = () => void;

export interface CollaborationEventBus {
  publish(event: CollaborationEvent): void;
  subscribe(eventType: CollaborationEventType, handler: EventHandler): Unsubscribe;
  subscribeAll(handler: EventHandler): Unsubscribe;
}

const ALL_EVENTS = "__all__";

export class DefaultCollaborationEventBus implements CollaborationEventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  publish(event: CollaborationEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit(ALL_EVENTS, event);
  }

  subscribe(eventType: CollaborationEventType, handler: EventHandler): Unsubscribe {
    this.emitter.on(eventType, handler);
    return () => { this.emitter.off(eventType, handler); };
  }

  subscribeAll(handler: EventHandler): Unsubscribe {
    this.emitter.on(ALL_EVENTS, handler);
    return () => { this.emitter.off(ALL_EVENTS, handler); };
  }
}

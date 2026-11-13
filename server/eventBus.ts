import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentEvent, AgentName, DataStatus, EventType, Severity } from './types.ts';

type EventHandler = (event: AgentEvent) => void | Promise<void>;

class CentralEventBus {
  private events: AgentEvent[] = [];
  private handlers: Map<EventType, EventHandler[]> = new Map();
  private wildcardHandlers: EventHandler[] = [];
  private recentDedupeKeys: Map<string, number> = new Map();
  private sseClients: Set<Response> = new Set();

  subscribe(eventType: EventType, handler: EventHandler) {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  subscribeAll(handler: EventHandler) {
    this.wildcardHandlers.push(handler);
  }

  registerSseClient(res: Response) {
    this.sseClients.add(res);
    res.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  getRecentEvents(limit = 50): AgentEvent[] {
    return this.events.slice(0, limit);
  }

  async publish(params: {
    event_type: EventType;
    source_agent: AgentName;
    district_id: string;
    distribution_node_id?: string | null;
    entity_id: string;
    priority: Severity;
    data_status: DataStatus;
    payload: Record<string, unknown>;
    requires_approval?: boolean;
    dedupeKey?: string;
    dedupeWindowMs?: number;
  }): Promise<AgentEvent | null> {
    const now = Date.now();
    const windowMs = params.dedupeWindowMs ?? 4000;
    const key =
      params.dedupeKey ??
      `${params.event_type}:${params.source_agent}:${params.entity_id}:${params.district_id}`;

    const lastSeen = this.recentDedupeKeys.get(key);
    if (lastSeen && now - lastSeen < windowMs) {
      return null; // Duplicate-event protection
    }
    this.recentDedupeKeys.set(key, now);
    if (this.recentDedupeKeys.size > 500) {
      for (const [k, ts] of this.recentDedupeKeys.entries()) {
        if (now - ts > 60000) this.recentDedupeKeys.delete(k);
      }
    }

    const event: AgentEvent = {
      event_id: uuidv4(),
      event_type: params.event_type,
      source_agent: params.source_agent,
      timestamp: new Date().toISOString(),
      district_id: params.district_id,
      distribution_node_id: params.distribution_node_id ?? null,
      entity_id: params.entity_id,
      priority: params.priority,
      data_status: params.data_status,
      payload: params.payload,
      requires_approval: Boolean(params.requires_approval),
    };

    this.events.unshift(event);
    if (this.events.length > 300) {
      this.events.length = 300;
    }

    // Broadcast to SSE subscribers
    const serialized = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(serialized);
      } catch {
        this.sseClients.delete(client);
      }
    }

    const targets = [...(this.handlers.get(event.event_type) ?? []), ...this.wildcardHandlers];
    for (const handler of targets) {
      await this.executeWithRetry(handler, event, 2);
    }

    return event;
  }

  private async executeWithRetry(handler: EventHandler, event: AgentEvent, maxRetries: number) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await handler(event);
        return;
      } catch (err) {
        if (attempt === maxRetries) {
          console.error(`[EventBus] Handler failed for ${event.event_type} after retries:`, err);
        } else {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
      }
    }
  }
}

export const eventBus = new CentralEventBus();

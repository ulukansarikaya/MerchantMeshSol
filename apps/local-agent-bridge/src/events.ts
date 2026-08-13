import { EventEmitter } from "node:events";
import type { TaskEvent } from "@merchantmesh/shared";
import { nowSec, type BridgeDb } from "./db.js";

/**
 * Task timeline: every step is persisted in task_events and pushed to any
 * live SSE subscribers. GET /tasks/:id/events replays history, then streams.
 */
export class TaskEventBus {
  private emitter = new EventEmitter();

  constructor(private db: BridgeDb) {
    this.emitter.setMaxListeners(100);
  }

  emit(taskId: string, type: string, data: Record<string, unknown> = {}): TaskEvent {
    const ts = nowSec();
    const result = this.db
      .prepare("INSERT INTO task_events (task_id, ts, type, data_json) VALUES (?, ?, ?, ?)")
      .run(taskId, ts, type, JSON.stringify(data));
    const event: TaskEvent = { seq: Number(result.lastInsertRowid), taskId, ts, type, data };
    this.emitter.emit(taskId, event);
    return event;
  }

  history(taskId: string, afterSeq = 0): TaskEvent[] {
    const rows = this.db
      .prepare("SELECT id, ts, type, data_json FROM task_events WHERE task_id = ? AND id > ? ORDER BY id")
      .all(taskId, afterSeq) as unknown as { id: number; ts: number; type: string; data_json: string }[];
    return rows.map((r) => ({ seq: r.id, taskId, ts: r.ts, type: r.type, data: JSON.parse(r.data_json) }));
  }

  subscribe(taskId: string, listener: (event: TaskEvent) => void): () => void {
    this.emitter.on(taskId, listener);
    return () => this.emitter.off(taskId, listener);
  }
}

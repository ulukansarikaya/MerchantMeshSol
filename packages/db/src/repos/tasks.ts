import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { conversationMessages, conversations, tasks } from "../schema/index.js";

/**
 * Mirrors a bridge-created task (SQLite is still the orchestrator's source
 * of truth for the mock/research pipeline — see plans/faz-c.md §3) into
 * Postgres, scoped to the owning account/agent, plus a conversation seeded
 * with the user's prompt. Full timeline logging is Faz K's job; this just
 * gets ownership + the first message recorded.
 */
export async function createPgTaskWithConversation(
  db: Db,
  params: {
    taskId: string;
    accountId: string;
    agentId: string;
    walletAddress: string;
    prompt: string;
    lat: number;
    lng: number;
    budgetTotalMicro: number;
    budgetPerRequestMicro: number;
  },
): Promise<{ conversationId: string }> {
  await db.insert(tasks).values({
    id: params.taskId,
    accountId: params.accountId,
    agentId: params.agentId,
    prompt: params.prompt,
    lat: String(params.lat),
    lng: String(params.lng),
    budgetTotalMicro: BigInt(params.budgetTotalMicro),
    budgetPerRequestMicro: BigInt(params.budgetPerRequestMicro),
  });

  const [conversation] = await db
    .insert(conversations)
    .values({
      accountId: params.accountId,
      walletAddress: params.walletAddress,
      title: params.prompt.slice(0, 60),
    })
    .returning();
  await db.insert(conversationMessages).values({
    conversationId: conversation!.id,
    role: "user",
    content: params.prompt,
    messageType: "user",
  });
  return { conversationId: conversation!.id };
}

export async function appendSystemEventMessage(db: Db, conversationId: string, content: string): Promise<void> {
  await db.insert(conversationMessages).values({ conversationId, role: "system_event", content, messageType: "system_event" });
}

/** Returns the owning accountId for a task, or undefined if the task isn't in Postgres (mock-only task). */
export async function getPgTaskOwner(db: Db, taskId: string): Promise<string | undefined> {
  const [row] = await db.select({ accountId: tasks.accountId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return row?.accountId;
}

export async function updatePgTaskStatus(db: Db, taskId: string, status: string, error?: string): Promise<void> {
  await db.update(tasks).set({ status, ...(error ? { error } : {}) }).where(eq(tasks.id, taskId));
}

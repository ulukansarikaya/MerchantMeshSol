import Redis from "ioredis";

let client: Redis | undefined;

/** Lazily-created singleton ioredis client, keyed off REDIS_URL. Not a source of truth for money. */
export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is not set — see .env.example.");
    }
    client = new Redis(url, { maxRetriesPerRequest: 3 });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

import client from "../redis-client.js";
export async function getAllStopsForBus(busId) {
  const pattern = `lastEvaluated:${busId}:reachedStops:*`;
  let cursor = "0";
  const keys = [];

  // Scan all keys matching pattern
  do {
    const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = reply.cursor;
    keys.push(...reply.keys);
  } while (cursor !== "0");

  const result = {};

  // For each key, get hash and extract stopId
  for (const key of keys) {
    // Extract stopId: key format is lastEvaluated:<busId>:reachedStops:<stopId>
    const parts = key.split(":");
    const stopId = parts[3]; // index 3 is stopId

    const hashData = await client.hGetAll(key);

    result[stopId] = hashData; // store hash for that stopId
  }

  return result;
}

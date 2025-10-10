import { createClient } from "redis";

const client = createClient();

client.on("connect", () => {
  console.log("✅ Connected to Redis");
});

client.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

await client.connect();

export default client; // ✅ ESM export

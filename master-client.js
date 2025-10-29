// redis-master.js
import { createClient } from "redis";

const masterClient = createClient();

masterClient.on("error", (err) => {
  console.error("❌ Redis Master Error:", err);
});

await masterClient.connect();

console.log("✅ Master Redis connected");

export default masterClient;

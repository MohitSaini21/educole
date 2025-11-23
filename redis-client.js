import { createClient } from "redis";

// Create the main Redis client
const client = createClient({
  password: "AMX6cfNMcFR4mLtHQjVd6Og0zwnbepKQ",
  socket: {
    host: "redis-18009.c273.us-east-1-2.ec2.cloud.redislabs.com",
    port: 18009,
  },
});

// Adapter clients for Socket.IO Redis adapter
export const pubClient = client.duplicate();
export const subClient = client.duplicate();

// Event listeners for main client
client.on("connect", () => {
  // console.log("✅ Connected to Redis");
});

client.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

// Connect to Redis and optionally flush all data on startup
const startRedisClient = async () => {
  try {
    // Connect all clients
    await Promise.all([
      client.connect(),
      pubClient.connect(),
      subClient.connect(),
    ]);

    console.log(`All clients are ready for the process ${process.pid}`);
  } catch (err) {
    console.error("❌ Error during Redis initialization:", err);
  }
};

// Handle process termination gracefully
process.on("SIGINT", async () => {
  try {
    console.log("🚨 Server shutting down. Closing Redis connections...");

    await Promise.all([client.quit(), pubClient.quit(), subClient.quit()]);

    console.log("✅ Redis clients disconnected cleanly.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error during Redis shutdown:", err);
    process.exit(1);
  }
});

await startRedisClient();

// Export the main client for other app modules
export default client;

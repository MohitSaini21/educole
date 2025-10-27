import { createClient } from "redis";

// Create the main Redis client
const client = createClient();

// Adapter clients for Socket.IO Redis adapter
export const pubClient = client.duplicate();
export const subClient = client.duplicate();

// Event listeners for main client
client.on("connect", () => {
  console.log("✅ Connected to Redis");
});

client.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

// Connect to Redis and optionally flush all data on startup
export const startRedisClient = async () => {
  try {
    // Connect all clients
    await Promise.all([
      client.connect(),
      pubClient.connect(),
      subClient.connect(),
    ]);

    // if (process.env.NODE_ENV === "development") {
    //   await client.flushAll();
    //   console.log("✅ Redis flushed (development only)");
    // }

    console.log("✅ Redis clients connected successfully");
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

// Export the main client for other app modules
export default client;

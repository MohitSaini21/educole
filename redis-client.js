import { createClient } from "redis";

// Create the Redis client
const client = createClient();

// Event listeners for Redis client
client.on("connect", () => {
  console.log("✅ Connected to Redis");
});

client.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

// Connect to Redis and flush all data on startup
const startRedisClient = async () => {
  try {
    // Connect to Redis
    await client.connect();

    // Flush all data from Redis whenever the server starts
    await client.flushAll();
    console.log("✅ Redis flushed on server start.");
  } catch (err) {
    console.error("❌ Error during Redis initialization:", err);
  }
};

// Call startRedisClient function
startRedisClient();

// Handle process termination gracefully to flush Redis on shutdown
process.on("SIGINT", async () => {
  console.log("🚨 Server shutting down. Flushing Redis...");
  await client.flushAll(); // Flush Redis one more time on server shutdown
  await client.quit(); // Properly close the Redis connection
  console.log("✅ Redis flushed and client disconnected.");
  process.exit(0); // Exit the process after cleanup
});

// Export the client for use in other parts of your application
export default client;

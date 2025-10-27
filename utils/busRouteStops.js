// utils/busRouteCache.js
import client from "../redis-client.js";

import Bus from "../model/bus.js";

// const routeStopMap = new Map();

/**
 * Load all buses and cache routeStops + iconPhoto
 */
export async function setAllRouteStops() {
  try {
    try {
      let lockKey = await client.set("startUpKey", "MohitSaini", {
        NX: true,
      });

      if (!(lockKey === "OK")) {
        console.log("I missed  the locked");
        return;
      }
    } catch (err) {
      console.error("Redis error:", err);
      return;
    }

    console.log("hey I am the one who got a job to set up the redis");
    await flushAllExceptOne(client, "startUpKey");

    const buses = await Bus.find().select("_id routeStops iconPhoto busNumber");

    for (const bus of buses) {
      await client.hSet(
        "routeStopMap",
        bus._id.toString(),
        JSON.stringify({
          routeStops: bus.routeStops,
          iconPhoto: bus.iconPhoto,
          busNumber: bus.busNumber,
        }),
        {
          NX: true,
        }
      );
    }

    console.log(`✅ Cached routeStops and icons for ${buses.length} buses.`);

    const fields = await client.hKeys("routeStopMap");
    console.log(fields);
    setTimeout(
      async () => {
        await client.del("startUpKey");
      },
      1000 * 60 * 5
    );
  } catch (err) {
    console.error("❌ Failed to cache bus data:", err);
  }
}

/**
 * Get routeStops and iconPhoto for a busId
 * @param {string} busId
 * @returns {object|null}
 */
export async function getBusCacheData(busId) {
  try {
    const data = await client.hGet("routeStopMap", busId.toString());
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`❌ Error fetching bus cache for ${busId}:`, err);
    return null;
  }
}

async function flushAllExceptOne(client, keyToKeep) {
  let cursor = "0";
  do {
    const result = await client.scan(cursor, {
      MATCH: "*",
      COUNT: 100,
    });

    const nextCursor = result.cursor;
    const keys = result.keys;

    cursor = nextCursor;

    // Filter out the key you want to keep
    const keysToDelete = keys.filter((k) => k !== keyToKeep);

    if (keysToDelete.length > 0) {
      await client.del(keysToDelete);
    }
  } while (cursor !== "0");
}

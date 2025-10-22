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
        EX: 3600, // expires in 1 hour
      });

      if (!(lockKey === "OK")) {
        return;
      }
    } catch (err) {
      console.error("Redis error:", err);
      return;
    }

    console.log("hey I am the one who got a job to set up the redis");
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
    await client.del("startUpKey");
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

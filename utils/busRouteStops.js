import Bus from "../model/bus.js";
import client from "../redis-client.js";
import { ConnectDB } from "../config/db.js";
import mongoose from "mongoose";

export async function setAllRouteStops(masterClient, isMain = false) {
  try {
    if (isMain) {
      await ConnectDB(
        "mongodb+srv://educole:educole1234@educole.2cvrvth.mongodb.net/educoleDB?retryWrites=true&w=majority&appName=Educole"
      );
    }
    const buses = await Bus.find().select("_id routeStops iconPhoto busNumber");

    if (!buses.length) {
      console.log("⚠️ No buses found in DB, skipping cache setup.");
      if (isMain) {
        await mongoose.disconnect();
      }
      return;
    }

    const pipeline = masterClient.multi();

    for (const bus of buses) {
      pipeline.hSet(
        "routeStopMap",
        bus._id.toString(),
        JSON.stringify({
          routeStops: bus.routeStops,
          iconPhoto: bus.iconPhoto,
          busNumber: bus.busNumber,
        }),
        { NX: true }
      );
    }

    await pipeline.exec();

    console.log(`✅ Cached routeStops and icons for ${buses.length} buses.`);

    const fields = await masterClient.hKeys("routeStopMap");
    console.log("Cached Bus IDs:", fields);

    if (isMain) {
      await mongoose.disconnect();
      console.log("🧹 MongoDB disconnected after caching setup.");
    }
  } catch (err) {
    console.error("❌ Failed to cache bus data:", err);
  }
}

export async function getBusCacheData(busId) {
  try {
    const data = await client.hGet("routeStopMap", busId.toString());
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`❌ Error fetching bus cache for ${busId}:`, err);
    return null;
  }
}

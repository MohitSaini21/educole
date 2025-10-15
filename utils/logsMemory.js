import moment from "moment-timezone";
import client from "../redis-client.js";
import { getAllStopsForBus } from "./reachedStops.js";

import { getBusCacheData } from "./busRouteStops.js";
export async function logStopArrivalToMemory({ busId, stopId, io }) {
  console.log("🔍 logStopArrivalToMemory called with:", { busId, stopId });

  const cacheData = await getBusCacheData(busId);

  if (!cacheData || !Array.isArray(cacheData.routeStops)) {
    console.warn("⚠️ No routeStops found in cacheData for bus:", busId);
    return;
  }

  const stop = cacheData.routeStops.find(
    (item) => item?._id?.toString() === stopId.toString()
  );

  if (!stop) {
    console.warn("❌ Stop not found in routeStops for bus:", busId);
    return;
  }

  const currentTime = moment().tz("Asia/Kolkata");
  const isMorning = currentTime.hour() < 12;
  const readableTime = currentTime.format("hh:mm A");

  const key = `lastEvaluated:${busId}:reachedStops:${stopId}`;
  const exists = await client.exists(key);

  let stopLog = exists ? await client.hGetAll(key) : {};

  // If already logged for this time of day → skip
  if (
    (isMorning && stopLog.morningTime) ||
    (!isMorning && stopLog.eveningTime)
  ) {
    console.log("⏩ Already logged this stop for this time of day. Skipping.");
    return;
  }

  // Update Redis hash safely
  const updates = { stopName: stop.stopName };
  if (isMorning) {
    updates.eMorningTime = (stop.morningTime || "") + " AM";
    updates.morningTime = readableTime;
  } else {
    updates.eEveningTime = (stop.eveningTime || "") + " PM";
    updates.eveningTime = readableTime;
  }

  await client.hSet(key, updates);
  console.log("✅ stopLog updated:", updates);

  // Notify connected admin sockets
  const acbSockets = await client.sMembers(`adminConnectionsBus:${busId}`);
  if (acbSockets.length > 0) {
    console.log("📤 Emitting busUpdate to admin sockets:", acbSockets);

    // Collect all reached stops for this bus
    const reachedStops = await getAllStopsForBus(busId); // must be async-safe
    console.log(reachedStops);

    for (const socketId of acbSockets) {
      io.to(socketId).emit("reachedStops", { reachedStops });
    }
  } else {
    console.log("ℹ️ No admin sockets connected for bus:", busId);
  }
}

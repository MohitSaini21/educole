import moment from "moment-timezone";
import mongoose from "mongoose";
import Bus from "../model/bus.js";
import BusActivityLog from "../model/busTrack.js";

export default async function newsaveLogs(busObject) {
  // 1. Basic Validation
  if (
    !busObject?.reachedStops &&
    !busObject?.path &&
    !busObject?.eventTimeline &&
    !(parseFloat(busObject?.distanceCovered) > 0)
  ) {
    console.log("🛑 Nothing to save: no stops, path, events, or distance.");
    return;
  }

  try {
    // 2. Validate busId
    if (!busObject.busId || !mongoose.Types.ObjectId.isValid(busObject.busId)) {
      console.log("❌ Invalid or missing busId.");
      return;
    }

    const busId = new mongoose.Types.ObjectId(busObject.busId);
    const logDateIST = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

    // 3. Find or create activity log
    const log = await BusActivityLog.findOneAndUpdate(
      { bus: busId, logDate: logDateIST },
      {
        $setOnInsert: {
          bus: busId,
          logDate: logDateIST,
          stops: [],
          path: [],
          events: [],
          whoDrived: [],
          distanceCovered: 0,
          createdAt: new Date(),
        },
      },
      { new: true, upsert: true }
    );

    // 4. Reached Stops
    if (
      busObject.reachedStops &&
      typeof busObject.reachedStops === "object" &&
      Object.keys(busObject.reachedStops).length > 0
    ) {
      for (const stopId in busObject.reachedStops) {
        const stop = busObject.reachedStops[stopId] || {};
        log.stops.push({
          stop: mongoose.Types.ObjectId.isValid(stopId)
            ? new mongoose.Types.ObjectId(stopId)
            : stopId,
          stopName: stop.stopName || null,
          morningTime: stop.morningTime || null,
          eveningTime: stop.eveningTime || null,
          eMorningTime: stop.eMorningTime || null,
          eEveningTime: stop.eEveningTime || null,
        });
      }
    }

    // 5. Path Points
    if (Array.isArray(busObject.path)) {
      const validPathPoints = busObject.path.filter(
        (p) =>
          p &&
          typeof p.lat === "number" &&
          typeof p.lon === "number" &&
          !isNaN(p.lat) &&
          !isNaN(p.lon)
      );
      if (validPathPoints.length) {
        log.path.push(...validPathPoints);
      }
    }

    // 6. Drivers (whoDrived)
    if (Array.isArray(busObject.whoDrived) && busObject.whoDrived.length > 0) {
      log.whoDrived.push(...busObject.whoDrived);
    }

    // 7. Events
    if (
      Array.isArray(busObject.eventTimeline) &&
      busObject.eventTimeline.length > 0
    ) {
      const eventsData = busObject.eventTimeline
        .filter((item) => item?.eventType && item?.time)
        .map((item) => ({
          campus: item.campus || "",
          event: item.eventType,
          timestamp: item.time,
        }));

      if (eventsData.length > 0) {
        log.events.push(...eventsData);
      }
    }

    // 8. Distance Covered
    const distance = parseFloat(busObject.distanceCovered);
    if (!isNaN(distance) && distance > 0) {
      log.distanceCovered =
        Math.round((log.distanceCovered + distance) * 1000) / 1000;

      // Also update bus total distance
      const bus = await Bus.findById(busId);
      if (!bus) {
        console.error(`❌ Bus not found for ID: ${busId}`);
      } else {
        bus.distanceTravelled =
          Math.round((bus.distanceTravelled + distance) * 1000) / 1000;
        await bus.save();
        console.log("✅ Bus updated with new distance.");
      }
    }

    // 9. Save activity log
    await log.save();
    console.log(`✅ Log saved or updated for bus ${busObject.busId}`);
  } catch (err) {
    if (err.code === 11000) {
      console.warn("⚠️ Duplicate log prevented by unique index");
    } else {
      console.error("❌ Error saving bus logs:", err);
    }
  }
}

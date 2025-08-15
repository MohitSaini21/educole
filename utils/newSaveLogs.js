import moment from "moment-timezone";
import mongoose from "mongoose";
import Bus from "../model/bus.js";
import BusActivityLog from "../model/busTrack.js";

export default async function newsaveLogs(busObject) {
  // Validate presence of any meaningful data
  if (
    !busObject?.reachedStops &&
    !busObject?.path &&
    !busObject?.eventTimeline &&
    !(busObject?.distanceCovered > 0)
  ) {
    console.log("🛑 Nothing to save: no stops, path, events, or distance.");
    return;
  }

  try {
    // Validate busId
    if (!busObject.busId || !mongoose.Types.ObjectId.isValid(busObject.busId)) {
      console.log("❌ Invalid or missing busId.");
      return;
    }

    const busId = new mongoose.Types.ObjectId(busObject.busId);
    const logDateIST = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

    // Find existing log or create if missing
    const log = await BusActivityLog.findOneAndUpdate(
      { bus: busId, logDate: logDateIST },
      {
        $setOnInsert: {
          bus: busId,
          logDate: logDateIST,
          stops: [],
          path: [],
          events: [],
          distanceCovered: 0,
          createdAt: new Date(),
        },
      },
      { new: true, upsert: true }
    );

    // 🧠 Build stop data array
    if (busObject.reachedStops && typeof busObject.reachedStops === "object") {
      for (const stopId in busObject.reachedStops) {
        const stop = busObject.reachedStops[stopId] || {};
        log.stops.push({
          stop: mongoose.Types.ObjectId.isValid(stopId)
            ? new mongoose.Types.ObjectId(stopId)
            : stopId, // fallback if stopId is not an ObjectId
          stopName: stop.stopName || null,
          morningTime: stop.morningTime || null,
          eveningTime: stop.eveningTime || null,
          eMorningTime: stop.eMorningTime || null,
          eEveningTime: stop.eEveningTime || null,
        });
      }
    }

    // 🧠 Append path points
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

    // 🧠 Build events data
    if (
      Array.isArray(busObject.eventTimeline) &&
      busObject.eventTimeline.length
    ) {
      const eventsData = busObject.eventTimeline
        .filter((item) => item?.eventType && item?.time)
        .map((item) => ({
          campus: item.campus || "",
          event: item.eventType,
          timestamp: item.time,
        }));
      if (eventsData.length) {
        log.events = eventsData;
      }
    }

    // 🧠 Handle distance covered
    if (
      typeof busObject.distanceCovered === "number" &&
      busObject.distanceCovered > 0
    ) {
      try {
        console.log(
          `📏 Distance covered received: ${busObject.distanceCovered}`
        );

        // Update log
        log.distanceCovered =
          Math.round((log.distanceCovered + busObject.distanceCovered) * 1000) /
          1000;

        console.log(`📝 Updated log distance: ${log.distanceCovered}`);

        // Update bus total distance
        const bus = await Bus.findById(busId);
        if (!bus) {
          console.error(`❌ No bus found for ID: ${busId}`);
        } else {
          bus.distanceTravelled =
            Math.round(
              (bus.distanceTravelled + busObject.distanceCovered) * 1000
            ) / 1000;
          console.log(`🚌 Updated bus distance: ${bus.distanceTravelled}`);
          await bus.save();
          console.log("✅ Bus saved successfully");
        }
      } catch (error) {
        console.error("❌ Error in adding the distance:", error);
      }
    }

    // Save the log
    await log.save();
    console.log(`✅ Log saved or updated for bus ${busObject.busId}`);
  } catch (err) {
    if (err.code === 11000) {
      console.warn("⚠️ Duplicate log prevented by unique index");
    } else {
      console.error("❌ Error saving bus logs:", err.message);
    }
  }
}

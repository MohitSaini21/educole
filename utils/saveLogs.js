import moment from "moment-timezone";
import mongoose from "mongoose";
import Bus from "../model/bus.js";
import BusActivityLog from "../model/busTrack.js";

export default async function saveLogs(busObject) {
  if (
    !busObject.reachedStops &&
    !busObject.path &&
    !busObject.eventTimeline &&
    !busObject.distanceCovered
  ) {
    console.log("🛑 Nothing to save: no stops, path, or events.");
    return;
  }

  try {
    if (!busObject.busId || !mongoose.Types.ObjectId.isValid(busObject.busId)) {
      console.log("❌ Invalid or missing busId.");
      return;
    }

    const busId = new mongoose.Types.ObjectId(busObject.busId);

    // 👇 This is the magic: one fixed string date for India
    const logDateIST = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

    const log = await BusActivityLog.findOneAndUpdate(
      {
        bus: busId,
        logDate: logDateIST, // 🧠 match by manual India-based day
      },
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
      {
        new: true,
        upsert: true,
      }
    );

    // 🧠 Build stop data
    const stopsData = [];
    for (const stopId in busObject.reachedStops || {}) {
      const stop = busObject.reachedStops[stopId];
      stopsData.push({
        stop: stopId,
        stopName: stop.stopName || null,
        morningTime: stop.morningTime || null,
        eveningTime: stop.eveningTime || null,
        eMorningTime: stop.eMorningTime || null,
        eEveningTime: stop.eEveningTime || null,
      });
    }

    // 🧠 Build event data
    const eventsData = [];
    for (const item of busObject.eventTimeline || []) {
      if (item?.eventType && item?.time) {
        eventsData.push({
          campus: item.campus,
          event: item.eventType,
          timestamp: item.time,
        });
      }
    }

    // ➕ Merge new stops
    for (const newStop of stopsData) {
      const existingStop = log.stops.find(
        (s) => s.stop?.toString() === newStop.stop
      );
      if (existingStop) {
        if (newStop.morningTime && !existingStop.morningTime) {
          existingStop.morningTime = newStop.morningTime;
        }
        if (newStop.eMorningTime && !existingStop.eMorningTime) {
          existingStop.eMorningTime = newStop.eMorningTime;
        }
        if (newStop.eveningTime && !existingStop.eveningTime) {
          existingStop.eveningTime = newStop.eveningTime;
        }
        if (newStop.eEveningTime && !existingStop.eEveningTime) {
          existingStop.eEveningTime = newStop.eEveningTime;
        }
        if (newStop.stopName && !existingStop.stopName) {
          existingStop.stopName = newStop.stopName;
        }
      } else {
        log.stops.push(newStop);
      }
    }

    if (Array.isArray(busObject.path)) {
      log.path.push(...busObject.path);
      busObject.path = [];
    }
if (busObject.distanceCovered > 0) {
  try {
    console.log(`📏 Distance covered received: ${busObject.distanceCovered}`);

    // Add distance to log (keep 3 decimal places)
    log.distanceCovered =
      Math.round((log.distanceCovered + busObject.distanceCovered) * 1000) /
      1000;
    console.log(`📝 Updated log distance: ${log.distanceCovered}`);

    // Fetch bus from DB
    const bus = await Bus.findById(busId);
    if (!bus) {
      console.error(`❌ No bus found for ID: ${busId}`);
      return;
    }

    // Update bus distance (keep 3 decimal places)
    bus.distanceTravelled =
      Math.round((bus.distanceTravelled + busObject.distanceCovered) * 1000) /
      1000;
    console.log(`🚌 Updated bus distance: ${bus.distanceTravelled}`);

    // Save bus
    await bus.save();
    console.log("✅ Bus saved successfully");

    // Reset the distance in busObject
    busObject.distanceCovered = 0;
    console.log("🔄 Reset busObject.distanceCovered to 0");
  } catch (error) {
    console.error("❌ Error in adding the distance:", error);
  }
}


    if (Array.isArray(eventsData) && eventsData.length > 0) {
      // Ensure log.events is initialized as an array
      log.events = log.events || [];

      const existingEventStrings = new Set(
        log.events.map((e) => `${e.campus}-${e.event}-${e.timestamp}`)
      );

      const uniqueNewEvents = eventsData.filter((newEvent) => {
        const key = `${newEvent.campus}-${newEvent.event}-${newEvent.timestamp}`;
        return !existingEventStrings.has(key);
      });

      if (uniqueNewEvents.length > 0) {
        log.events.push(...uniqueNewEvents);
      }
    }

    await log.save();
    console.log(`✅ Log saved or updated for bus ${busObject.busId}`);
    return;
  } catch (err) {
    if (err.code === 11000) {
      console.warn("⚠️ Duplicate log prevented by unique index");
    } else {
      console.error("❌ Error saving bus logs:", err.message);
    }
    return;
  }
}

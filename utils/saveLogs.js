import moment from "moment-timezone";
import mongoose from "mongoose";
import BusActivityLog from "../model/busTrack.js";

export default async function saveLogs(busObject) {
  if (!busObject.reachedStops && !busObject.path && !busObject.eventTimeline) {
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

    if (Array.isArray(eventsData) && eventsData.length > 0) {
      log.events.push(...eventsData);
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

import { parentPort } from "worker_threads";
import { getDistance } from "geolib";
import moment from "moment-timezone";
import { checkEntryExit } from "./utils/polygon.js";
import { sendNotification } from "./utils/stops.js";

parentPort.on("message", ({ task, busObject }) => {
  try {
    const bus = task.bus;
    const busLat = parseFloat(task.latitude);
    const busLng = parseFloat(task.longitude);
    const timestamp = task.timestamp;
    const date = new Date(timestamp);

    const RADIUS_METERS = 1000;
    const MIN_TIME_DIFF = 1000;

    // 1. Check entry/exit polygon if previous point is provided
    if (task.previousPoint) {
      try {
        let { campus, eventType } = checkEntryExit({
          previousPoint: busObject.previousPoint,
          currentPoint: { longitude: busLng, latitude: busLat },
        });

        if (eventType && campus) {
          if (!Array.isArray(busObject.eventTimeline)) {
            busObject.eventTimeline = [];
          }

          busObject.eventTimeline.push({
            campus,
            eventType,
            time: date.toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }),
          });
        }
      } catch (err) {
        console.error("checkEntryExit failed:", err);
      }
    }

    // 2. Path Tracking
    if (!busObject.lastPathTimestamp) {
      busObject.lastPathTimestamp = timestamp;
      if (!Array.isArray(busObject.path)) {
        busObject.path = [];
      }
      busObject.path.push({ lat: busLat, lon: busLng });
      console.log("✅ Path initialized and updated");
    } else {
      const timeDiff = timestamp - busObject.lastPathTimestamp;
      if (timeDiff >= MIN_TIME_DIFF) {
        busObject.path.push({ lat: busLat, lon: busLng });
        busObject.lastPathTimestamp = timestamp;
        console.log("✅ Path updated with new point");
      } else {
        console.log("⏩ Skipping path update — interval too short");
      }
    }

 

    if (!busObject.reachedStops) busObject.reachedStops = {};

    for (const stop of task.bus.routeStops || []) {
      if (!stop || !stop._id || !stop.latitude || !stop.longitude) continue;

      const stopId = stop._id.toString();
      const alreadyLogged = isMorning
        ? busObject.reachedStops[stopId]?.morningTime
        : busObject.reachedStops[stopId]?.eveningTime;

      if (alreadyLogged) continue;

      const stopLat = parseFloat(stop.latitude);
      const stopLng = parseFloat(stop.longitude);
      const distance = getDistance(
        { latitude: busLat, longitude: busLng },
        { latitude: stopLat, longitude: stopLng }
      );

      if (distance <= RADIUS_METERS) {
        sendNotification(stopId, stop.stopName, bus.busNumber, isMorning);
        if (!busObject.reachedStops[stopId]) {
          busObject.reachedStops[stopId] = {};
        }

        busObject.reachedStops[stopId].stopName = stop.stopName;

        if (isMorning) {
          busObject.reachedStops[stopId].eMorningTime =
            stop.morningTime + " am";
          busObject.reachedStops[stopId].eveningTime = date.toLocaleString(
            "en-IN",
            {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }
          );
        } else {
          busObject.reachedStops[stopId].eEveningTime =
            stop.eveningTime + " pm";
          busObject.reachedStops[stopId].eveningTime = date.toLocaleString(
            "en-IN",
            {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }
          );
        }

        console.log(
          `📍 Bus ${bus._id} reached "${
            stop.stopName
          }" at ${currentTime.format()}`
        );
        break; // Only log one stop per location update
      } else {
        console.log(
          `🚌 Bus ${bus._id} is ${distance}m away from "${stop.stopName}"`
        );
      }
    }

    console.log(`✅ Worker completed and response sent for bus ${bus._id}`);
    (busObject.previousPoint = { longitude: busLng, latitude: busLat }),
      parentPort.postMessage({
        updatedBusObject: busObject,
        busId: bus._id,
      });
    console.log("📤 postMessage sent successfully to parent");
  } catch (err) {
    console.error("🚨 Worker thread failed:", err);
    parentPort.postMessage({ error: err.message });
  }
});

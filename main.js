// Importing Required Modules
import express from "express";
import newsaveLogs from "./utils/newSaveLogs.js";
import cron from "node-cron";
import BusActivityLog from "./model/busTrack.js";

import { config } from "dotenv"; // For environment variable management
import { logStopArrivalToMemory } from "./utils/logsMemory.js";

import FCM from "./model/FCM.js";
import { dcRouter } from "./routes/DC.js";
import { getAllStopsForBus } from "./utils/reachedStops.js";

import Driver from "./model/driver.js";
import Conductor from "./model/conductor.js";
import CORE from "./model/admin.js";
import client from "./redis-client.js";
import { pubClient, subClient } from "./redis-client.js";
import { sendNotificationToClient } from "./utils/notify.js";

import { setAllRouteStops } from "./utils/busRouteStops.js";
import { getBusCacheData } from "./utils/busRouteStops.js";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";

import { administratorRouter } from "./routes/administrator.js";
import { adminRouter } from "./routes/admin.js";
import { publicRouter } from "./routes/public.js";

import { checkAuth } from "./middlware/rootCheckAuth.js";
import cookie from "cookie"; // 🔥 NOT 'cookie-parser'

import http from "http";

import path from "path";

import moment from "moment-timezone";

import cookieParser from "cookie-parser";
import { checkAuthHome } from "./middlware/rootCheckHome.js";
import { ConnectDB } from "./config/db.js";

import { Server } from "socket.io";
import { fileURLToPath } from "url";
import Bus from "./model/bus.js";

// Load Environment Variables
config();

const PORT = process.env.PORT || 4000; // Default to 8000 if PORT is not defined in .env
const dbUrl = process.env.DB_URL;

// Initialize Express App
const app = express();
    

// Initialize Passport
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cookieParser());
// Enable trust proxy
// app.set("trust proxy", true);

// Middleware and Settings
// Set EJS as the view engine (Corrected 'view engine' typo)
app.set("view engine", "ejs");
// 👇 Trust Nginx (the proxy)
// ✅ Safe proxy trust — only local (Nginx)
app.set("trust proxy", "loopback");

// Middlewares for Parsing and Static Files (Optional, Add if Needed)

// app.get("/", checkAuthHome, (req, res) => {
//   res.sendFile(__dirname + "/public/index.html");
// });
app.use(express.json()); // Parse JSON requests
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded requests
app.use(express.static("public")); // Serve static files from the "public" directory

// Import the HTTP module

// Create HTTP server and pass the app handler
const server = http.createServer(app);

// Routers
app.use(
  "/administrator/settings",
  checkAuth,
  (req, res, next) => {
    if (req.user?.role === "administrator") {
      next();
    } else {
      return res.status(204).end(); // silent drop
    }
  },
  administratorRouter
);

app.use(
  "/admin",
  checkAuth,
  (req, res, next) => {
    if (req.user?.role === "admin" || req.user?.role === "administrator") {
      next();
    } else {
      return res.status(204).end(); // silent drop
    }
  },
  adminRouter
);

app.use("/", publicRouter);

app.use(
  "/DC",
  checkAuth,
  (req, res, next) => {
    if (req.user.role == "conductor" || req.user.role == "driver") {
      next();
    }
  },
  dcRouter
);

// ✅ GLOBAL error handler (MUST be after all routes)
app.use((err, req, res, next) => {
  if (err instanceof URIError) {
    return res.status(400).json({ error: "Malformed URL parameter" });
  }
  next(err);
});

const io = new Server(server, {
  pingInterval: 5000, // every 5s send ping
  pingTimeout: 3000, // wait 3s for pong before dropping
  cors: {
    origin: "*", // या तुम्हारे frontend का origin
    methods: ["GET", "POST"],
  },
});

// Attach Redis adapter
io.adapter(createAdapter(pubClient, subClient));
app.set("io", io); // <-- shared shelf mein rakh diy

io.use((socket, next) => {
  try {
    const query = socket.handshake.query;

    // ✅ Allow public connections if no admin identifiers or liveBusid are present
    if (!query.adminId && !query.administratorId && !query.liveBusId) {
      return next();
    }

    const rawCookies = socket.handshake.headers.cookie || "";

    const parsed = cookie.parse(rawCookies);
    const token = parsed.authToken;

    if (!token) {
      return next(new Error("Missing auth token"));
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "Secret String"
    );

    if (query.adminId) {
      socket.adminId = decoded.id;
    } else if (query.administratorId) {
      socket.administratorId = decoded.id;
    } else if (query.liveBusId) {
      socket.liveBusId = query.liveBusId;
      socket.worker = decoded.id;
    }

    return next();
  } catch (err) {
    console.error("🚨 JWT decode failed:", err.message);
    return next(new Error("Invalid token"));
  }
});

io.on("connection", async (socket) => {
  // const isRealClient = socket.request.headers["user-agent"] !== undefined;
  // if (!isRealClient) return; // Ignore ghost connections from Redis
  const query = socket.handshake.query;

  if (query.busId) {
    const busId = query.busId;
    socket.busId = busId;

    // registerSocket(busConnections, busId, socket, "Viewer");
    registerSocketOnRedis("busConnections", busId, socket, "Viewer");

    // 🎯 Priority 2: Admin for specific bus
  } else if (query.bus && socket.adminId) {
    const busId = query.bus;
    socket.bus = busId;

    // registerSocket(adminConnectionsBus, busId, socket, "Admin (per bus)")
    registerSocketOnRedis(
      "adminConnectionsBus",
      busId,
      socket,
      "Admin (per bus)"
    );

    // 🎯 Priority 3: Administrator for specific bus
  } else if (query.bus && socket.administratorId) {
    const busId = query.bus;
    socket.bus = busId;

    // registerSocket(
    //   administratorConnectionsBus,
    //   busId,
    //   socket,
    //   "Administrator (per bus)"
    // );

    registerSocketOnRedis(
      "administratorConnectionsBus",
      busId,
      socket,
      "Administrator (per bus)"
    );

    // 🎯 Priority 4: Global Administrator
  } else if (socket.administratorId) {
    // administratorIds.push(socket.id);
    await client.sAdd("administratorIds", socket.id);
    let administratorIds = await client.sMembers("administratorIds");
    console.log(`✅ New global administrator connection: ${socket.id}`);
    console.log(`📋 Current administrator IDs:`, administratorIds);

    // 🎯 Priority 5: Global Admin
  } else if (socket.adminId) {
    // allAdmins.push(socket.id);

    await client.sAdd("allAdmins", socket.id);
    console.log(`✅ New global admin connection: ${socket.id}`);
    let allAdmins = await client.sMembers("allAdmins");
    console.log(`📋 Current admin IDs:`, allAdmins);

    // 🎯 Priority 6: Live Bus (driver/conductor)
  } else if (socket.liveBusId) {
    const busId = socket.liveBusId.toString();

    let exists = await client.sIsMember("liveBuses", busId);
    if (exists) {
      socket.emit("disconnectReason", "duplicate_connection");
      console.log(
        "Let All possible process drop bus socket connection firt got it ."
      );

      socket.disconnect(true);
      return;
    }

    await client.sAdd("liveBuses", busId);
    const key = `lastEvaluated:${busId}:drived`;
    await client.sAdd(key, socket.worker);

    await client.set(`busSocketsId:${busId}`, socket.id);
    await client.hSet("lastDrived", busId.toString(), socket.worker);

    console.log(`🟢 Bus ${busId} is now live with socket ${socket.id}`);

    // Notify admins
    let allAdmins = await client.sMembers("allAdmins");
    allAdmins.forEach((adminSocketId) => {
      io.to(adminSocketId).emit("add", busId);
    });

    socket.emit("connectionApproved", "✅ You are now live.");
  } else {
    console.warn("🚫 Unknown or malformed connection attempt:", query);
    socket.disconnect(true);
    return;
  }

  socket.on("liveBuses", async (callback) => {
    try {
      let liveBuses = await client.sMembers("liveBuses"); // list all
      callback({ success: true, data: liveBuses });
    } catch (err) {
      console.error("Error fetching bus:", err);
      callback({ success: false, message: "Server error" });
    }
  });

  // to keep connection live

  socket.on("💓", () => {
    // No need to do anything. Just accepting keeps connection alive.
  });

  // allStream
  socket.on("allStream", async (callback) => {
    try {
      // Get all keys that start with 'peers:'
      const keys = await client.keys("peers:*");

      // Extract busIds (remove 'peers:' prefix)
      const busIds = keys
        .filter((key) => !key.endsWith(":candidates")) // ignore candidate lists
        .map((key) => key.replace("peers:", ""));

      callback(busIds);
    } catch (err) {
      console.error("❌ Error fetching all streams:", err);
      callback([]);
    }
  });

  // TrackBehind

  // events realted to trackBehind

  socket.on("trackBehindMsg", async (busId, reply) => {
    if (busId && reply) {
      const adcbSockets = await client.sMembers(
        `administratorConnectionsBus:${busId}`
      );
      if (adcbSockets.length > 0) {
        for (const socketId of adcbSockets) {
          io.to(socketId).emit("trackBehindMsg", reply);
        }
      }
    }
  });

  socket.on("trackBehind", async (data, callback) => {
    const { busId } = data;
    const key = `busSocketsId:${busId}`;

    try {
      // 1. Get socket ID from Redis
      const socketId = await client.get(key);

      if (!socketId) {
        return callback("Bus is offline (no socket ID found).");
      }
      io.to(socketId).emit("check", "testing string");
      callback("Signal has been sent sucesssfullly");
    } catch (error) {
      console.error("Error in trackBehind handler:", error);
      callback("Internal server error while handling trackBehind.");
    }
  });

  socket.on("stopTrackBehind", async (data, callback) => {
    const { busId } = data;
    const key = `busSocketsId:${busId}`;

    try {
      // 1. Get socket ID from Redis
      const socketId = await client.get(key);

      if (!socketId) {
        return callback("Bus is offline (no socket ID found).");
      }

      io.to(socketId).emit("stopTrackBehind", "testing string");

      callback("Stop signal has been sent");
    } catch (error) {
      console.error("Error in trackBehind handler:", error);
      callback("Internal server error while handling trackBehind.");
    }
  });

  // offer and icecandiate storegae
  // Redis Marked
  socket.on("driver-offer", async ({ bus, offer }) => {
    try {
      const key = `peers:${bus._id}`;

      // Check if the hash exists
      const exists = await client.exists(key);

      if (!exists) {
        console.log("🌟 New connection detected for bus:", bus._id);

        // Notify all administrators
        const administratorIds = await client.sMembers("administratorIds");
        if (administratorIds.length) {
          for (const adminId of administratorIds) {
            io.to(adminId).emit("newStream", bus._id);
          }
        }

        // Notify connected admins for this specific bus
        const adcbSockets = await client.sMembers(
          `administratorConnectionsBus:${bus._id}`
        );
        if (adcbSockets.length > 0) {
          for (const socketId of adcbSockets) {
            io.to(socketId).emit("newStream", bus._id);
          }
        }
      }

      // Save offer and socketID in hash
      await client.hSet(key, "offer", JSON.stringify(offer));
      await client.hSet(key, "socketID", socket.id);

      console.log("✅ Offer and socketID saved for bus:", bus._id);
    } catch (err) {
      console.error("❌ Error handling driver-offer:", err);
    }
  });
  socket.on("operatorSide", async ({ busId }) => {
    const adcbSockets = await client.sMembers(
      `administratorConnectionsBus:${busId}`
    );
    if (adcbSockets.length > 0) {
      for (const socketId of adcbSockets) {
        io.to(socketId).emit("operatorSide", busId);
      }
    }
  });
  //  Redis Marked

  // Handle ICE candidates
  socket.on("ice-candidate", async ({ bus, candidate }) => {
    try {
      const listKey = `peers:${bus._id}:candidates`;

      // Append candidate to Redis List
      await client.rPush(listKey, JSON.stringify(candidate));

      console.log("✅ ICE candidate saved for bus:", bus._id);
    } catch (err) {
      console.error("❌ Error saving ICE candidate:", err);
    }
  });

  // admin checking whether offer and candiate exsit or not
  socket.on("admin-wants-to-connect", async ({ busId }) => {
    try {
      const key = `peers:${busId}`;
      const exists = await client.exists(key);

      if (exists) {
        const offer = JSON.parse(await client.hGet(key, "offer"));

        // Retrieve all ICE candidates from the list
        const candidatesList = await client.lRange(
          `peers:${busId}:candidates`,
          0,
          -1
        );
        const candidates = candidatesList.map(JSON.parse); // convert strings back to objects

        socket.emit("bus-offer-and-candidates", {
          offer,
          candidates: candidates || [],
        });
      } else {
        socket.emit("bus-offer-and-candidates", {
          offer: null,
          candidates: [],
        });
      }
    } catch (err) {
      console.error("❌ Error fetching bus offer and candidates:", err);
      socket.emit("bus-offer-and-candidates", {
        offer: null,
        candidates: [],
      });
    }
  });

  // Admin REalted ice candiate and asnwer

  socket.on("admin-ice-candidate", async ({ busId, candidate }) => {
    try {
      const key = `peers:${busId}`;
      const exists = await client.exists(key);

      if (!exists) {
        return;
      }

      // Get the driver's socketID from Redis
      const driverSocketID = await client.hGet(key, "socketID");

      if (driverSocketID) {
        io.to(driverSocketID).emit("ice-candidate", {
          bus: { _id: busId },
          candidate: candidate,
        });
        console.log(`✅ Relayed ICE candidate to driver for bus: ${busId}`);
      } else {
        console.warn(`⚠️ No socketID found for driver of bus: ${busId}`);
      }
    } catch (err) {
      console.error("❌ Error relaying admin ICE candidate:", err);
    }
  });

  // Handle admin's answer to the offer from the driver
  socket.on("admin-answer", async ({ busId, answer }) => {
    try {
      const key = `peers:${busId}`;
      const exists = await client.exists(key);

      if (!exists) {
        return;
      }

      // Get the driver's socketID from Redis
      const driverSocketID = await client.hGet(key, "socketID");

      if (!driverSocketID) {
        console.warn(`⚠️ No socketID found for driver of bus: ${busId}`);
        return;
      }

      // Send the answer to the driver
      io.to(driverSocketID).emit("admin-answer", {
        bus: { _id: busId },
        offer: answer,
      });

      console.log(`✅ Admin answer sent to driver for bus: ${busId}`);
    } catch (err) {
      console.error("❌ Error handling admin-answer:", err);
    }
  });

  socket.on("admin-disconnected", async ({ busId }) => {
    try {
      const key = `peers:${busId}`;
      const exists = await client.exists(key);

      if (!exists) {
        return;
      }

      // Get the driver's socketID from Redis
      const driverSocketID = await client.hGet(key, "socketID");

      if (!driverSocketID) {
        console.warn(`⚠️ No socketID found for driver of bus: ${busId}`);
        return;
      }

      // Notify the driver to refresh
      io.to(driverSocketID).emit("refresh", {
        bus: { _id: busId },
      });

      // Clean up Redis entries for this bus
      await client.hDel(key, "offer");
      await client.del(`peers:${busId}:candidates`); // remove ICE candidates list

      console.log(
        `✅ Cleaned up Redis entries for bus: ${busId} after admin disconnect.`
      );
    } catch (err) {
      console.error("❌ Error during admin-disconnected:", err);
    }
  });

  // About pTracking
  // socket.on("getObject", async (data, callback) => {
  //   try {
  //     const busId = data.busId;

  //     // Simulate fetching the bus object from a database
  //     const busObject = lastEvaluated[busId]; // Use your DB model here

  //     if (busObject) {
  //       callback({ data: busObject }); // Send the object back to the client
  //     } else {
  //       callback({ data: null }); // Let the client know no data was found
  //     }
  //   } catch (error) {
  //     console.error("Error fetching bus object:", error);
  //     callback({ data: null, error: "Server error" });
  //   }
  // });

  socket.on("lastLocation", async (busId, callback) => {
    let exists = await client.sIsMember("liveBuses", busId.toString());
    if (!exists) {
      // const location = lastLocation.has(busId) ? lastLocation.get(busId) : null;
      let location = await client.hExists("lastLocation", busId);
      if (location) {
        location = await client.hGet("lastLocation", busId);
        callback({
          status: "true",
          data: JSON.parse(location),
        });
      }
    }
  });
  socket.on("lastDrived", async (data, callback) => {
    try {
      console.log("Server received 'lastDrived' event:", data);

      const { busId } = data;

      // 🧠 Fetch workerId from Redis
      const workerId = await client.hGet("lastDrived", busId);
      console.log("Redis returned workerId:", workerId);

      if (!workerId) {
        console.log("No workerId found for bus:", busId);
        callback(null);
        return;
      }

      // 🧠 Try finding the driver first
      let worker = await Driver.findOne({ driverId: workerId });

      if (!worker) {
        // If not found as driver, try finding as conductor
        worker = await Conductor.findOne({ conductorId: workerId });
      }

      if (!worker) {
        console.log("No worker found in MongoDB for ID:", workerId);
        callback(null);
        return;
      }

      console.log("Worker found:", worker);
      callback(worker);
    } catch (error) {
      console.error("Error in 'lastDrived' event:", error);
      callback(null);
    }
  });
  socket.on("lastLocationOfAllBuses", async (callback) => {
    try {
      const exists = await client.exists("lastLocation");
      if (!exists) {
        return callback(null); // ❌ No location data at all
      }

      const offlineLocations = [];
      let lastLocationObject = await client.hGetAll("lastLocation");

      for (const [busId, data] of Object.entries(lastLocationObject)) {
        const isLive = await client.sIsMember("liveBuses", busId);
        if (!isLive) {
          offlineLocations.push(JSON.parse(data));
        }
      }

      if (offlineLocations.length > 0) {
        callback(offlineLocations); // ✅ Send offline bus locations
      } else {
        callback(null); // ❌ No offline bus locations available
      }
    } catch (err) {
      console.error("❌ Error in lastLocationOfAllBuses:", err);
      callback(null); // Fallback if error
    }
  });

  // updating the distance

  socket.on("distanceAdding", async ({ busId, distanceCovered }) => {
    try {
      if (!busId) return; // avoid invalid keys

      // convert meters → kilometers
      const km = distanceCovered / 1000;

      if (km > 0) {
        const key = `lastEvaluated:${busId}:distanceCovered`;

        // Increment (creates key automatically if missing)
        const newValue = await client.incrByFloat(key, km);

        console.log(`🚍 Bus ${busId} distance updated: total = ${newValue} km`);
      }
    } catch (err) {
      console.error("❌ Error updating distanceCovered:", err);
    }
  });

  socket.on("busLocationUpdate", async (data) => {
    try {
      if (data == null) return; // catches null or undefined only

      const busId = data.bus?._id;
      if (!busId) return;

      // 1. Clone only what's needed early
      const clientBroadcastData = {
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: data.timestamp,
        accuracy: data.accuracy,
        bus: {
          _id: busId,
        },
      };

      // 2. Broadcast to bus-connected clients
      // let's wrie down the code regarding the redis.

      const sockets = await client.sMembers(`busConnections:${busId}`);

      // const sockets = busConnections[busId];
      if (sockets?.length) {
        for (let i = 0; i < sockets.length; i++) {
          io.to(sockets[i]).emit("receivelocation", clientBroadcastData);
        }
      }

      // 3. Use lightweight cache fetch
      const cacheData = await getBusCacheData(busId);

      const adminPayload = {
        ...clientBroadcastData,
        bus: {
          ...clientBroadcastData.bus,
          iconPhoto: cacheData.iconPhoto,
        },
      };

      // 4. Update lastLocation (used by admins)
      // lastLocation.set(busId, adminPayload);

      await client.hSet(
        "lastLocation",
        busId.toString(),
        JSON.stringify(adminPayload)
      );

      // 5. Notify all admin and super admin sockets
      let allAdmins = await client.sMembers("allAdmins");
      let administratorIds = await client.sMembers("administratorIds");
      const adminTargets = [...allAdmins, ...administratorIds];
      for (let i = 0; i < adminTargets.length; i++) {
        io.to(adminTargets[i]).emit("allBusLocations", adminPayload);
      }

      // 6. Initialize bus evaluation cache if not present
      const now = Date.now();

      await client.set(`lastEvaluated:${busId}:lastEvaluations`, now, {
        NX: true,
      });

      // 7. Cooldown check — only update every 10s
      let value = await client.get(`lastEvaluated:${busId}:lastEvaluations`);
      const lastEval = Number(value) || 0;
      const cooldownPassed = now - lastEval >= 1000;
      if (cooldownPassed) {
        let locationObject = {
          lat: data.latitude,
          lon: data.longitude,
        };
        await client.rPush(
          `lastEvaluated:${busId}:path`,
          JSON.stringify(locationObject)
        );

        await client.set(`lastEvaluated:${busId}:lastEvaluations`, now);

        console.log("✅ Path updated after cooldown");
      }
    } catch (err) {
      console.error("🚨 Error in busLocationUpdate handler:", err);
    }
  });

  socket.on("stopStreaming", async ({ busId }) => {
    let administratorIds = await client.sMembers("administratorIds");
    administratorIds.forEach((id) => {
      io.to(id).emit("deleteStream", busId);
    });

    const adcbSockets = await client.sMembers(
      `administratorConnectionsBus:${busId.toString()}`
    );

    if (adcbSockets.length > 0) {
      adcbSockets.forEach((id) => {
        io.to(id).emit("deleteStream", busId);
      });
    }

    // Clean up peer-related data
    try {
      const key = `peers:${busId}`;
      const candidatesKey = `peers:${busId}:candidates`;

      // Delete the candidates list first
      const delCandidates = await client.del(candidatesKey);
      console.log(`Deleted candidates list: ${delCandidates} key(s)`);

      // Delete the hash next
      const delHash = await client.del(key);
      console.log(`Deleted hash: ${delHash} key(s)`);
    } catch (err) {
      console.error(`❌ Error cleaning Redis entries for bus ${busId}:`, err);
    }

    console.log(`📡 stopStreaming received for bus: ${busId}`);
  });

  // Send Notifcation
  socket.on(
    "sendNotificiation",
    async ({ stopId, status, busId, distance }, callback) => {
      try {
        console.log("📥 Received sendNotificiation event:", {
          stopId,
          status,
          busId,
          distance,
        });

        const activeTokens = await FCM.find({
          stopId,
          isActive: true,
        })
          .select("fcmToken stop stopId busId")
          .populate("busId", "busNumber route");

        console.log("📡 Fetched activeTokens:", activeTokens.length);

        // ✅ Special logic only for 'arrived'
        if (status === "arrived") {
          console.log(
            "🟢 Status is 'arrived' — calling logStopArrivalToMemory"
          );
          logStopArrivalToMemory({ busId, stopId, io });
        } else {
          console.log("ℹ️ Not an 'arrived' status — skipping memory log");
        }

        if (!activeTokens.length) {
          console.log("🟡 No active tokens found for stopId:", stopId);
          return callback(true);
        }

        const title = "Bus Stop Update";

        const statusMessages = {
          arriving: "The bus is arriving shortly at your stop.",
          arrived: "The bus has just arrived at your stop.",
          departing: "The bus will be departing from your stop soon.",
          departed: "The bus has departed from your stop.",
        };

        const formalMessage =
          statusMessages[status] || `New status at your stop: ${status}`;

        for (const entry of activeTokens) {
          const stopName = entry.stop?.stopName || "your stop";
          const busNumber = entry.busId?.busNumber || "Unknown Bus";
          let message = `🚌 Bus ${busNumber} update at "${stopName}": ${formalMessage}`;

          if (typeof distance !== "undefined") {
            const meters = Math.round(distance);
            message += ` (Distance: ~${meters} meters)`;
          }

          console.log("📲 Sending push notification:", {
            to: entry.fcmToken,
            message,
          });

          await sendNotificationToClient(entry.fcmToken, title, message);
        }

        callback(true);
      } catch (err) {
        console.error("🚨 Error while sending notification:", err);
        callback(false);
      }
    }
  );

  // Campus Notification
  socket.on("campusEvent", async ({ campus, event, busId }, callback) => {
    try {
      if (!campus || !event || !busId) {
        return callback(false); // 🔴 Invalid request
      }

      // 1️⃣ Fetch active tokens for this busId
      const activeTokens = await FCM.find({
        busId,
        isActive: true,
      })
        .select("fcmToken stop stopName busId")
        .populate("busId", "busNumber");

      // 2️⃣ Prepare event object
      const timeString = moment().tz("Asia/Kolkata").format("hh:mm A");
      const eventObject = { campus, eventType: event, time: timeString };

      // 3️⃣ Push to Redis list (acts as timeline)
      const key = `lastEvaluated:${busId}:eventTimeline`;
      await client.rPush(key, JSON.stringify(eventObject));

      // 4️⃣ Notify connected admins
      const acbSockets = await client.sMembers(
        `adminConnectionsBus:${busId.toString()}`
      );

      if (acbSockets.length > 0) {
        let eventTimeline = await client.lRange(key, 0, -1);
        // ✅ FIX: map() must be on eventTimeline, not eventObject
        eventTimeline = eventTimeline.map((item) => JSON.parse(item));

        acbSockets.forEach((socketId) => {
          io.to(socketId).emit("eventTimeline", { eventTimeline });
        });
      }

      console.log(
        `📌 Event logged: ${event} ${campus} @ ${timeString} for bus ${busId}`
      );

      // 5️⃣ Send FCM notification
      if (activeTokens.length > 0) {
        const title = "Campus Update";
        const busNumber = activeTokens[0]?.busId?.busNumber || "Bus";

        const statusMessages = {
          Entered: `🚌 ${busNumber} has entered ${campus}`,
          Exited: `🚌 ${busNumber} has exited ${campus}`,
        };

        const message =
          statusMessages[event] || `Bus status update for ${campus}`;

        for (const entry of activeTokens) {
          await sendNotificationToClient(entry.fcmToken, title, message);
        }
      }

      callback(true); // ✅ Success
    } catch (err) {
      console.error("🚨 Error in campusEvent handler:", err);
      callback(false);
    }
  });

  socket.on("getEventTimeLine", async (data, callback) => {
    const { busId } = data;

    if (!busId) {
      console.log("In order to receive eventTimeLine, busId is required");
      return callback(0);
    }

    try {
      // Make sure 'key' is defined based on busId (otherwise lRange won't work)
      const key = `lastEvaluated:${busId}:eventTimeline`;

      // Fetch the list from Redis
      let eventTimeline = await client.lRange(key, 0, -1);

      // Parse each item (assumes items are JSON strings)
      eventTimeline = eventTimeline.map((item) => JSON.parse(item));

      if (eventTimeline.length > 0) {
        callback(eventTimeline);
      } else {
        callback(0); // No timeline found
      }
    } catch (err) {
      console.error("Error fetching event timeline:", err);
      callback(0);
    }
  });

  socket.on("getReachedStops", async (data, callback) => {
    try {
      const { busId } = data || {};

      if (!busId) {
        console.error("[getReachedStops] Missing busId in payload");
        return callback(0);
      }

      const reachedStops = await getAllStopsForBus(busId);
      console.log(reachedStops);

      callback({ reachedStops });
    } catch (error) {
      console.error(`[getReachedStops] Error: ${error.message}`);
      callback(0);
    }
  });

  socket.on("overSpeedAlert", async ({ busId, message }) => {
    console.log(message);

    const bus = await Bus.findById(busId)
      .select("busNumber route _id")
      .populate("driver", "name phone")
      .populate("conductor", "name phone");

    if (!bus) return;

    const admins = await CORE.find({
      role: { $in: ["admin", "administrator"] },
      isLogged: true,
      notificationToken: { $exists: true, $ne: "" },
    });

    const route = bus.route || "N/A";
    const busNumber = bus.busNumber || "Unknown";

    // Safely get driver and conductor details
    const driverInfo =
      bus.driver?.name && bus.driver?.phone
        ? `Driver: ${bus.driver.name} (${bus.driver.phone})`
        : null;

    const conductorInfo =
      bus.conductor?.name && bus.conductor?.phone
        ? `Conductor: ${bus.conductor.name} (${bus.conductor.phone})`
        : null;

    const additionalInfo = [conductorInfo, driverInfo]
      .filter(Boolean)
      .join("\n");

    for (const admin of admins) {
      if (additionalInfo) {
        message += `\n\n${additionalInfo}`;
      }
      sendNotificationToClient(admin.notificationToken, "Speed Alert", message);
    }
  });

  socket.on("streamNotification", async ({ busId, about }) => {
    try {
      const bus = await Bus.findById(busId)
        .select("busNumber route _id")
        .populate("driver", "name phone")
        .populate("conductor", "name phone");

      if (!bus) return;

      const admins = await CORE.find({
        role: { $in: ["admin", "administrator"] },
        isLogged: true,
        notificationToken: { $exists: true, $ne: "" },
      });

      const route = bus.route || "N/A";
      const busNumber = bus.busNumber || "Unknown";

      // Safely get driver and conductor details
      const driverInfo =
        bus.driver?.name && bus.driver?.phone
          ? `Driver: ${bus.driver.name} (${bus.driver.phone})`
          : null;

      const conductorInfo =
        bus.conductor?.name && bus.conductor?.phone
          ? `Conductor: ${bus.conductor.name} (${bus.conductor.phone})`
          : null;

      const additionalInfo = [conductorInfo, driverInfo]
        .filter(Boolean)
        .join("\n");

      for (const admin of admins) {
        const title = "📡 Live Stream Alert";
        let message = `Bus number ${busNumber} on route "${route}" has ${about} live streaming.`;

        if (additionalInfo) {
          message += `\n\n${additionalInfo}`;
        }

        if (admin.role === "admin") {
          message += `\n\nPlease confirm the situation and take necessary actions.`;
        } else {
          message += `\n\nAs an administrator, please monitor the stream.`;
        }

        sendNotificationToClient(admin.notificationToken, title, message);
      }
    } catch (err) {
      console.error("Error sending stream notification:", err);
    }
  });

  socket.on("disconnect", async () => {
    console.log(`🔌 Disconnection: ${socket.id}`);

    // 🟠 Viewer (public viewer)
    if (socket.busId) {
      const busId = socket.busId;
      removeSocketFromRedis(
        "busConnections",
        busId.toString(),
        socket,
        "Viewer"
      );
    }

    // 🔵 Admin (per-bus)
    if (socket.bus && socket.adminId) {
      const busId = socket.bus;
      // removeSocketFromMap(adminConnectionsBus, busId, socket.id, "Admin (bus)");
      removeSocketFromRedis(
        "adminConnectionsBus",
        busId.toString(),
        socket,
        "Admin (bus)"
      );
    }

    // 🟣 Administrator (per-bus)
    if (socket.bus && socket.administratorId) {
      const busId = socket.bus;

      removeSocketFromRedis(
        "administratorConnectionsBus",
        busId.toString(),
        socket,
        "Administrator (bus)"
      );
    }

    if (socket.adminId) {
      const removedCount = await client.sRem("allAdmins", socket.id);
      if (removedCount) {
        console.log(`❌ Removed global admin: ${socket.id}`);
      }
    }

    // 🟢 Administrator (global)
    if (socket.administratorId) {
      const removedCount = await client.sRem("administratorIds", socket.id);

      if (removedCount) {
        console.log(`❌ Removed global administrator: ${socket.id}`);
      }
    }

    // 🚌 Live Bus (driver/conductor)
    if (socket.liveBusId) {
      const busId = socket.liveBusId;

      await client.del(`busSocketsId:${busId}`);

      let removeCount = await client.sRem("liveBuses", busId);
      if (removeCount) {
        console.log(`🚫 Bus ${busId} went offline.`);
        let allAdmins = await client.sMembers("allAdmins");

        allAdmins.forEach((id) => io.to(id).emit("remove", busId));
      }

      // Inform all administrators to delete stream
      let administratorIds = await client.sMembers("administratorIds");
      administratorIds.forEach((id) => {
        io.to(id).emit("deleteStream", busId);
      });
      const adcbSockets = await client.sMembers(
        `administratorConnectionsBus:${busId.toString()}`
      );

      if (adcbSockets.length > 0) {
        adcbSockets.forEach((id) => {
          io.to(id).emit("deleteStream", busId);
        });
      }

      // Clean up peer-related data
      try {
        const key = `peers:${busId}`;
        const candidatesKey = `peers:${busId}:candidates`;

        // Delete the candidates list first
        const delCandidates = await client.del(candidatesKey);
        console.log(`Deleted candidates list: ${delCandidates} key(s)`);

        // Delete the hash next
        const delHash = await client.del(key);
        console.log(`Deleted hash: ${delHash} key(s)`);
      } catch (err) {
        console.error(`❌ Error cleaning Redis entries for bus ${busId}:`, err);
      }
    }
  });
});
async function registerSocketOnRedis(distinctName, key, socket, label = "") {
  const redisKey = `${distinctName}:${key}`;
  await client.sAdd(redisKey, socket.id);

  const allSockets = await client.sMembers(redisKey);
  console.log(
    `✅ New connection${label ? ` (${label})` : ""} for ${key} with socketId: ${
      socket.id
    }`
  );
  console.log(`📡 Current connections for ${redisKey}:`, allSockets);
}

async function removeSocketFromRedis(distinctName, key, socket, label) {
  const redisKey = `${distinctName}:${key}`;
  const removedCount = await client.sRem(redisKey, socket.id);

  if (removedCount > 0) {
    console.log(`❌ Removed socket ${socket.id} from ${label} for ${key}.`);
  }
}

const startServer = async () => {
  try {
    await ConnectDB(
      "mongodb+srv://educole:educole1234@educole.2cvrvth.mongodb.net/educoleDB?retryWrites=true&w=majority&appName=Educole"
    );
    const existingAdministrator = await CORE.findOne({ role: "administrator" });
    if (!existingAdministrator) {
      await CORE.create({
        username: "Tmu Transport",
        password: "TmuTransport39", // you should hash this in real-world apps!
        role: "administrator",

        administratorId: "ADMTR-1234",
        isLogged: false,
        notificationToken: "",
      });
    }
    const PORT = 3000;

    server.listen(process.env.PORT || PORT, () => {
      console.log(
        `🚀 Server is running and listening at port ${process.env.PORT || PORT}  and here is the proccess Id ${process.pid}`
      );
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
  }
};

startServer();

async function getAllBusObjectIds() {
  try {
    const buses = await Bus.find({}, "_id"); // fetch only _id fields
    const busIds = buses.map((bus) => bus._id.toString());
    return busIds;
  } catch (error) {
    console.error("Failed to fetch bus _ids:", error);
    throw error;
  }
}

async function deleteKeysByPrefixSimple(prefix) {
  try {
    const keys = await client.keys(`${prefix}*`);
    if (keys.length) {
      for (let key of keys) {
        await client.del(key);
        console.log(`${key} has been deleted from Redis Database`);
      }
    } else {
      console.log("No keys found to delete.");
    }
  } catch (err) {
    console.error("❌ Redis delete error:", err);
  }
}

cron.schedule(
  "0 0 * * *", // Every day at 12:00 AM IST
  async () => {
    try {
      let lockKey = await client.set("lockKey", "MohitSaini", {
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
    const nowIST = moment().tz("Asia/Kolkata");
    console.log(
      `⏰ Cron triggered at (IST): ${nowIST.format("YYYY-MM-DD HH:mm:ss")}`
    );

    try {
      const busIds = await getAllBusObjectIds();

      for (const busId of busIds) {
        try {
          let busObject = {};

          const distanceCovered = await client.get(
            `lastEvaluated:${busId}:distanceCovered`
          );
          if (distanceCovered) busObject.distanceCovered = distanceCovered;

          let eventTimeline = await client.lRange(
            `lastEvaluated:${busId}:eventTimeline`,
            0,
            -1
          );
          eventTimeline = eventTimeline
            .map((str) => {
              try {
                return JSON.parse(str);
              } catch {
                return null;
              }
            })
            .filter((item) => item !== null);
          if (eventTimeline.length) busObject.eventTimeline = eventTimeline;

          let reachedStops = await getAllStopsForBus(busId);
          if (reachedStops && Object.keys(reachedStops).length > 0) {
            busObject.reachedStops = reachedStops;
          }

          let path = await client.lRange(`lastEvaluated:${busId}:path`, 0, -1);
          path = path
            .map((str) => {
              try {
                return JSON.parse(str);
              } catch {
                return null;
              }
            })
            .filter((item) => item !== null);
          if (path.length) busObject.path = path;

          const members = await client.sMembers(
            `lastEvaluated:${busId}:drived`
          );
          if (members.length) busObject.whoDrived = members;

          if (Object.keys(busObject).length > 0) {
            busObject.busId = busId;
            await newsaveLogs(busObject);
          }

          const prefix = `lastEvaluated:${busId}`;
          await deleteKeysByPrefixSimple(prefix);
        } catch (err) {
          console.error(`❌ Error processing busId ${busId}:`, err);
        }
      }

      console.log("🧹 Cleared all entries from lastEvaluated");

      const cutoffDate = nowIST
        .clone()
        .subtract(10, "day")
        .format("YYYY-MM-DD");
      console.log(`🧾 Deleting logs older than: ${cutoffDate}`);

      const oldLogs = await BusActivityLog.find({
        logDate: { $lt: cutoffDate },
      });

      for (const log of oldLogs) {
        if (log.morningSnap?.image) {
          deleteFileIfExists(log.morningSnap.image, "Morning Snap");
        }
        if (log.eveningSnap?.image) {
          deleteFileIfExists(log.eveningSnap.image, "Evening Snap");
        }
        await log.deleteOne();
        console.log(`✅ Deleted log ID: ${log._id} (logDate: ${log.logDate})`);
      }

      console.log("🧹 Old logs cleanup complete.");
    } catch (err) {
      console.error("❌ Error in main cron job:", err);
    } finally {
      await client.del("lockKey");
    }
  },
  {
    timezone: "Asia/Kolkata",
  }
);

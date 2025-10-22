import { fileURLToPath } from "url";
import * as turf from "@turf/turf";

import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import express from "express";
import { sendNotificationToClient } from "../utils/notify.js";
import Bus from "../model/bus.js";
import mongoose from "mongoose";
import Driver from "../model/driver.js";
import client from "../redis-client.js";
import Conductor from "../model/conductor.js";
import CORE from "../model/admin.js";

import multer from "multer";
import Complaint from "../model/complain.js";
import fs from "fs";
import path from "path";

import BusActivityLog from "../model/busTrack.js";

import moment from "moment-timezone";

let router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Resolve the absolute path to 'public/uploads' directory
    const uploadPath = path.join(__dirname, "..", "public", "uploads");

    // Check if the directory exists, if not, create it
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true }); // Create the uploads directory
    }

    // Set the directory where files should be stored
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const FileName = `${Date.now()}-${file.originalname}`;
    cb(null, FileName);
  },
});

const upload = multer({ storage: storage });

async function findBus(req, res, userId, busId) {
  const redisKey = `cachedBus:${busId}`;
  let busObject;

  // Try Redis cache first
  const cachedBus = await client.get(redisKey);
  if (cachedBus) {
    try {
      const parsed = JSON.parse(cachedBus);
      busObject = parsed; // ✅ assign to busObject
    } catch (err) {
      console.warn("❌ Failed to parse cached bus:", err);
      await client.del(redisKey); // remove corrupted cache
    }
  }

  // If not in cache or corrupted → fetch from DB
  if (!busObject) {
    const bus = await Bus.findById(busId).lean();

    if (!bus) {
      // ❌ Bus not found in DB — cleanup
      res.clearCookie("busToken");

      return res.redirect("/DC");
    }

    // ✅ Remove qrPath and cache the rest
    const { qrPath, ...rest } = bus;
    busObject = rest;

    // Cache for 5 minutes
    await client.setEx(redisKey, 300, JSON.stringify(busObject));
  }

  // ✅ Bus found and safe to return
  return busObject;
}

function checkUserExistenceAndRedirect() {
  return async function (req, res, next) {
    try {
      const cacheKey = `${req.user.id}`;
      let cachedData = await client.get(cacheKey);
      let worker = cachedData ? JSON.parse(cachedData) : null;

      if (worker) {
        req.worker = worker;
        return next(); // ✅ stop execution
      }

      const populationFields = "assignedBus";
      const selectFields = "busNumber route distanceTravelled status";

      if (req.user.role === "driver") {
        worker = await Driver.findOne({ driverId: req.user.id })

          .populate(populationFields, selectFields)
          .lean();
      } else if (req.user.role === "conductor") {
        worker = await Conductor.findOne({ conductorId: req.user.id })

          .populate(populationFields, selectFields)
          .lean();
      }

      if (!worker) {
        clearAuthCookies(res);

        return res.redirect("/driverConductorLogin");
      }

      req.worker = worker;
      await client.set(cacheKey, JSON.stringify(worker), {
        EX: 300, // expire in 5 minutes
      }); // ✅ fixed
      next();
    } catch (error) {
      console.error("Error checking user existence:", error);
      clearAuthCookies(res);
      return res.redirect("/driverConductorLogin");
    }
  };
}

function clearAuthCookies(res) {
  res.clearCookie("authToken");
  res.clearCookie("busToken");
  res.clearCookie("fcmTokenExpiry");
}

async function getBusDetailsByRole(role, userId) {
  try {
    const cacheKey = `${userId}:busDetails`;

    // ✅ Try cache first
    let bus = await client.get(cacheKey);
    if (bus) {
      return JSON.parse(bus);
    }

    let busQuery = {};

    if (role === "driver") {
      busQuery.driver = userId;
    } else if (role === "conductor") {
      busQuery.conductor = userId;
    }

    bus = await Bus.findOne(busQuery)
      .select(
        "-_id -busNumber -route -capacity -status -fuelType -lastServiced -iconPhoto -busImages -live -routeStops -busDocuments -distanceTravelled -averageSpeed -createdAt -updatedAt -__v"
      )
      .populate("driver")
      .populate("conductor");
    // ✅ Cache it for 5 minutes
    if (bus) {
      await client.set(cacheKey, JSON.stringify(bus), { EX: 300 }); // 300 sec = 5 min
    }
    return bus;
  } catch (error) {
    console.error("Error fetching bus details:", error);
    throw new Error("Could not fetch bus details");
  }
}

router.get("/", checkUserExistenceAndRedirect(), async (req, res) => {
  try {
    const workerId = req.worker?._id;

    const busId = await client.get(`operatorTemBus:${workerId}`);

    return res.render("DC/index.ejs", {
      user: req.worker,
      busLogged: !!busId,
    });
  } catch (error) {
    console.error("Error in / route:", error);
    return res.status(500).send("Internal server error.");
  }
});

router.post(
  "/api/save-fcm-token",
  checkUserExistenceAndRedirect(),
  async (req, res) => {
    try {
      const { token } = req.body;
      const userId = req.user?.id;

      if (!token) {
        return res.status(400).json({ message: "FCM token is required" });
      }

      if (!userId) {
        return res
          .status(401)
          .json({ message: "Unauthorized: User ID missing" });
      }

      let user;
      let userType;

      user = await Driver.findOne({ driverId: userId });

      if (user) {
        userType = "Driver";
      } else {
        // Try Conductor if not a Driver
        user = await Conductor.findOne({ conductorId: userId });
        if (user) {
          userType = "Conductor";
        }
      }

      if (!user) {
        return res
          .status(404)
          .json({ message: "User not found in Driver or Conductor" });
      }

      user.notificationToken = token;
      await user.save();

      return res.status(200).json({
        message: `FCM token saved successfully for ${userType}`,
        userId,
      });
    } catch (error) {
      console.error("Error saving FCM token:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  }
);

function redirectIfBusAlreadyLive(req, res, busId) {
  const io = req.app.get("io");

  for (const [, socket] of io.sockets.sockets) {
    const queryBusId = socket.handshake.query?.liveBusId;

    if (queryBusId && queryBusId === busId.toString()) {
      res.redirect("/DC/PB"); // index page
      return true; // stop further route execution
    }
  }
  return false; // no live socket for this bus
}

//  let's make the flexible route for the drivers and conductors to go live .

router.get(
  "/yourComplaints",
  checkUserExistenceAndRedirect(),
  async (req, res) => {
    try {
      let complaints;

      if (req.worker.role == "driver") {
        complaints = await Complaint.find({
          submittedWho: req.worker.driverId,
        })
          .select("_id complaintType createdAt busNumber")
          .lean();
      } else {
        complaints = await Complaint.find({
          submittedWho: req.worker.conductorId,
        })
          .select("_id complaintType createdAt busNumber")
          .lean();
      }

      console.log(complaints);
      return res.render("DC/complaints.ejs", {
        complaints,
        user: req.worker,
      });
    } catch (error) {
      console.error("❌ Error fetching complaints:", error);

      // Optional: send user-friendly error page
      return res.status(500).render("error", {
        message: "सर्वर में त्रुटि हुई। कृपया बाद में पुनः प्रयास करें।",
        error,
      });
    }
  }
);

router.get("/dairy", checkUserExistenceAndRedirect(), (req, res) => {
  return res.render("DC/dairy.ejs", { user: req.worker });
});

router.get("/history", checkUserExistenceAndRedirect(), (req, res) => {
  return res.render("DC/history.ejs", { user: req.worker });
});

router.delete(
  "/deleteComplaint/:id",
  checkUserExistenceAndRedirect(),
  async (req, res) => {
    try {
      const complaint = await Complaint.findByIdAndDelete(req.params.id);
      if (!complaint) {
        return res.status(404).json({ message: "❌ शिकायत नहीं मिली" });
      }
      res.json({ done: true, message: "✅शिकायत सफलतापूर्वक हटाई गई" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "❌ सर्वर में त्रुटि" });
    }
  }
);

router.get("/changePass", checkUserExistenceAndRedirect(), async (req, res) => {
  return res.render("DC/password.ejs", {
    user: req.worker,
  });
});

router.post(
  "/changePass",
  checkUserExistenceAndRedirect(),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.json({ message: "❌ कृपया दोनों पासवर्ड भरें।" });
      }

      const worker = req.worker;
      let userModel;

      if (worker.role === "driver") {
        userModel = Driver;
      } else if (worker.role === "conductor") {
        userModel = Conductor;
      } else {
        return res.json({ message: "❌ अमान्य उपयोगकर्ता प्रकार।" });
      }

      const user = await userModel.findById(worker._id);

      if (!user) {
        return res.json({ message: "❌ उपयोगकर्ता नहीं मिला।" });
      }

      // पासवर्ड मिलान
      if (user.password !== currentPassword) {
        return res.json({ message: "❌ वर्तमान पासवर्ड गलत है।" });
      }

      // नया पासवर्ड सेट करें
      user.password = newPassword;
      await user.save();

      return res.json({ message: "✅ पासवर्ड सफलतापूर्वक बदल दिया गया।" });
    } catch (error) {
      console.error("❌ पासवर्ड बदलने में त्रुटि:", error);
      return res.json({
        message: "❌ सर्वर त्रुटि, कृपया बाद में प्रयास करें।",
      });
    }
  }
);

router.get("/profile", checkUserExistenceAndRedirect(), async (req, res) => {
  return res.render("DC/profile.ejs", {
    user: req.worker,
    worker: req.worker,
  });
});
router.get("/helper", checkUserExistenceAndRedirect(), async (req, res) => {
  const bus = await getBusDetailsByRole(req.user.role, req.worker._id);

  if (req.user.role == "driver") {
    return res.render("DC/profile.ejs", {
      user: req.worker,
      worker: bus.conductor,
    });
  } else {
    return res.render("DC/profile.ejs", {
      user: req.worker,
      worker: bus.driver,
    });
  }
});
router.get("/aboutBus", checkUserExistenceAndRedirect(), async (req, res) => {
  try {
    const userId = req.worker._id;
    const role = req.user.role;

    const busQuery =
      role === "driver" ? { driver: userId } : { conductor: userId };

    const bus = await Bus.findOne(busQuery).select(
      "-busDocuments -busImages -driver -conductor -live"
    );

    if (!bus) {
      return res.status(404).render("404", {
        message: "आपके खाते से जुड़ी कोई बस नहीं मिली।",
      });
    }

    console.log(bus);
    return res.render("DC/bus.ejs", {
      user: req.worker,
      bus: bus,
    });
  } catch (err) {
    console.error("❌ बस जानकारी लाने में त्रुटि:", err.message);
    return res.status(500).json({
      message: "कुछ गलत हो गया। कृपया बाद में प्रयास करें।",
    });
  }
});

router.get("/logout", checkUserExistenceAndRedirect(), async (req, res) => {
  try {
    if (req.user.role === "driver") {
      await Driver.findOneAndUpdate(
        { driverId: req.user.id },
        {
          isLogged: false,
          notificationToken: "",
        }
      );
    } else if (req.user.role === "conductor") {
      await Conductor.findOneAndUpdate(
        { conductorId: req.user.id },
        {
          isLogged: false,
          notificationToken: "",
        }
      );
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.clearCookie("authToken");
    res.clearCookie("busToken");
    res.clearCookie("fcmTokenExpiry");

    await client.del(`${req.user.id}`);
    return res.redirect("/driverConductorLogin");
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).send("Something went wrong during logout.");
  }
});

router.get(
  "/logoutBus",
  checkUserExistenceAndRedirect(),
  busAuth,
  async (req, res) => {
    try {
      res.clearCookie("busToken");

      return res.redirect("/DC");
    } catch (error) {
      console.error("Logout error:", error);
      return res.status(500).send("Something went wrong during logout.");
    }
  }
);

// DCB
import { generateTokenAndSetCookie } from "../utils/createJwtTokenSetCookie.js";

router.get(
  "/loggedInBus/:busId",
  checkUserExistenceAndRedirect(), // Assuming this middleware checks req.worker existence
  busAuthLoggedIn,
  async (req, res) => {
    try {
      const { busId } = req.params;

      // Validate busId format
      if (!mongoose.Types.ObjectId.isValid(busId)) {
        return res.redirect("/DC");
      }

      // Check if bus exists in DB
      const exists = await Bus.exists({ _id: busId });
      if (!exists) {
        return res.redirect("/DC");
      }

      // Bus is free or same user: generate token & set Redis sessions
      const token = await generateTokenAndSetCookie(res, busId);
      if (!token) {
        return res.redirect("/DC");
      }

      return res.redirect("/DC/PB");
    } catch (error) {
      console.error("Error in /loggedInBus/:busId handler:", error);
      return res.redirect("/DC");
    }
  }
);

import jwt from "jsonwebtoken";

function busAuth(req, res, next) {
  try {
    const token = req.cookies.busToken;

    if (token) {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "Secret String"
      );

      if (decoded) {
        req.busId = decoded.id;

        return next(); // valid user, move to next
      }
    }

    return res.redirect("/DC");
  } catch (error) {
    console.error("Particular Bus Authentication error:", error);

    return res.redirect("/DC");
  }
}

async function busAuthLoggedIn(req, res, next) {
  try {
    const token = req.cookies.busToken;

    if (token) {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "Secret String"
      );

      if (decoded) {
        return res.redirect("/DC/PB");
      }
    }

    // No token or token invalid, allow login/signup pages
    next();
  } catch (error) {
    console.error("Particular Bus Authentication error:", error);
    // Don't crash app, just proceed
    next();
  }
}

router.get(
  "/PB",
  busAuth,
  checkUserExistenceAndRedirect(),
  async (req, res) => {
    let bus = await findBus(req, res, req.worker._id, req.busId);
    if (bus) {
      return res.render("DC/PB.ejs", {
        user: req.worker,

        bus,
      });
    }
  }
);

router.post(
  "/PB/odometer",

  checkUserExistenceAndRedirect(),
  busAuth,
  async (req, res) => {
    const { odometerReading } = req.body;
    const busId = req.busId;

    try {
      // 1. बस को ढूंढो
      const bus = await Bus.findById(busId);

      if (!bus) {
        // ❌ Bus not found in DB — cleanup
        res.clearCookie("busToken");

        return res.redirect("/DC");
      }

      // 2. ओडोमीटर रीडिंग को अपडेट करो
      bus.distanceTravelled = Number(odometerReading);
      let meterUpdateObject = {
        userId: req.worker._id,
        role: req.worker.role,
      };
      bus.MeterUpdated.push(meterUpdateObject);
      if (bus.MeterUpdated.length > 5) {
        bus.MeterUpdated = bus.MeterUpdated.slice(-5); // Keep last 5
      }
      await bus.save();

      // 3. सफलता का संदेश
      return res.status(200).json({
        message: "✅ ओडोमीटर रीडिंग सफलतापूर्वक अपडेट कर दी गई है। धन्यवाद!",
        updatedReading: bus.distanceTravelled,
      });
    } catch (error) {
      console.error("🚨 ओडोमीटर अपडेट करते समय त्रुटि:", error);
      return res.status(500).json({
        message: error.message,
      });
    }
  }
);

router.get(
  "/PB/driverGoLive",
  checkUserExistenceAndRedirect(),
  busAuth,

  async (req, res) => {
    const busId = await findBus(req, res, req.worker._id, req.busId);

    let bus = await Bus.findById(busId)
      .select("_id routeStops status busNumber")
      .lean();

    if (!bus) {
      return res.status(404).json({ message: "बस की जानकारी नहीं मिली।" });
    }

    if (bus.status === "Out of Service") {
      console.log(
        "यह बस इस समय सेवा में नहीं है। कृपया प्रशासक से संपर्क करें।"
      );
      return res.status(403).json({
        message: "यह बस इस समय सेवा में नहीं है। कृपया प्रशासक से संपर्क करें।",
        status: "out_of_service",
      });
    }

    // 🔍 check for active socket before rendering
    if (redirectIfBusAlreadyLive(req, res, bus._id)) return;

    bus.routeStops = bus.routeStops.sort(
      (a, b) => parseInt(a.stopOrder) - parseInt(b.stopOrder)
    );

    // If bus is operational, return normal data
    res.set("Cache-Control", "no-store");

    const campuses = [
      {
        name: "Universities HeadCampus",
        polygon: turf.polygon([
          [
            [78.4915699, 29.3338713],
            [78.4920634, 29.3330669],
            [78.4928305, 29.3334738],
            [78.4922565, 29.3342548],
            [78.4915699, 29.3338713],
          ],
        ]),
      },
    ];
    return res.render("DC/goLive.ejs", { user: req.worker, bus, campuses });
  }
);

router.get(
  "/PB/registerComplain",
  checkUserExistenceAndRedirect(),
  busAuth,
  async (req, res) => {
    const busId = await findBus(req, res, req.worker._id, req.busId);

    let bus = await Bus.findById(busId).select("_id  status busNumber").lean();

    if (!bus) {
      return res.status(404).json({ message: "बस की जानकारी नहीं मिली।" });
    }
    return res.render("DC/registerComplain.ejs", {
      user: req.worker,
      bus,
    });
  }
);

router.post(
  "/PB/registerComplain",
  checkUserExistenceAndRedirect(),
  busAuth,
  upload.single("media"),
  async (req, res) => {
    try {
      // ⚠️ चेक करें कि अनुरोध में डेटा है या नहीं

      console.log("compalin has been recieved");
      if (!req.body || !req.body.type || !req.body.incidentTime) {
        return res.status(400).json({
          message: "❌ कृपया सभी आवश्यक जानकारी भरें।",
        });
      }

      let mediaPath = null;
      if (req.file) {
        mediaPath = req.file.path.split("public")[1];
      }

      // 📦 शिकायत दर्ज करें
      let submittedWho;
      if (req.worker.role == "driver") {
        submittedWho = req.worker.driverId;
      } else {
        submittedWho = req.worker.conductorId;
      }

      let bus = await findBus(req, res, req.worker._id, req.busId);
      const complaint = await Complaint.create({
        complaintType: req.body.type,
        incidentTime: req.body.incidentTime,
        media: mediaPath ? mediaPath : "",
        submittedBy: "operator", // चालक/परिचालक
        busNumber: bus.busNumber || "अज्ञात",
        submittedWho,
        phone: req.worker.phone,
      });

      if (complaint) {
        // 🚀 Fetch logged-in admins and administrators with tokens
        const admins = await CORE.find({
          role: { $in: ["admin", "administrator"] },
          isLogged: true,
          notificationToken: { $exists: true, $ne: "" },
        });

        // 🧾 Determine role and bus number
        const userRole = req.worker.role; // assuming req.worker is set
        const submittedBy = userRole === "driver" ? "driver" : "conductor";
        const busNumber = req.body.busNumber || "unknown";

        // 📢 Notification content
        const title = "🛠 New Complaint Registered";
        const message = `A new complaint has been submitted from bus number ${busNumber} by the ${submittedBy}. Please review it.`;

        // 🔔 Send notification to each admin
        for (const admin of admins) {
          sendNotificationToClient(admin.notificationToken, title, message);
        }

        return res.status(200).json({
          message: "✅ आपकी शिकायत सफलतापूर्वक दर्ज कर ली गई है। धन्यवाद!",
        });
      } else {
        return res.status(500).json({
          message: "❌ आपकी शिकायत दर्ज नहीं हो सकी। कृपया पुनः प्रयास करें।",
        });
      }
    } catch (error) {
      console.error("शिकायत दर्ज करने में त्रुटि:", error.message);
      return res.status(500).json({
        message: "❌ सर्वर में कुछ त्रुटि हुई। कृपया बाद में पुनः प्रयास करें।",
      });
    }
  }
);

router.get(
  "/PB/meterReading",
  checkUserExistenceAndRedirect(),
  busAuth,
  async (req, res) => {
    try {
      const busId = req.busId;
      let bus = await findBus(req, res, req.worker._id, req.busId);

      if (!bus) {
        return res.status(404).json({ message: "बस की जानकारी नहीं मिली।" });
      }

      const currentIST = moment().tz("Asia/Kolkata");

      const logDate = currentIST.format("YYYY-MM-DD");

      const targetTime = currentIST.clone().startOf("day").add(14, "hours"); // 2 PM IST
      const isMorning = currentIST.hour() < 14;

      let remainingTime = null;

      // ✅ Updated: Use createdAt instead of `date` field
      const activity = await BusActivityLog.findOne({
        bus: busId,
        logDate: logDate,
      });

      if (
        activity &&
        activity.morningSnap &&
        activity.morningSnap.image &&
        activity.morningSnap.reading
      ) {
        const diffMs = targetTime.diff(currentIST);

        if (diffMs > 0) {
          const duration = moment.duration(diffMs);
          remainingTime = {
            hours: Math.floor(duration.asHours()),
            minutes: duration.minutes(),
            seconds: duration.seconds(),
          };
        } else {
          remainingTime = { hours: 0, minutes: 0, seconds: 0 };
        }
      }

      return res.render("DC/meterReading.ejs", {
        user: req.worker,
        activity,
        remainingTime,
        isMorning,
        bus,
      });
    } catch (err) {
      console.error("Error in /meterReading GET:", err);
      return res.status(500).send("Server Error");
    }
  }
);

router.post(
  "/PB/meterReading",
  upload.single("meterPhoto"),
  checkUserExistenceAndRedirect(),
  busAuth,
  async (req, res) => {
    try {
      const file = req.file;
      const { odometer } = req.body;
      const busId = req.busId;

      if (!file || !busId || !odometer) {
        return res
          .status(400)
          .json({ message: "कृपया सभी आवश्यक जानकारी भरें।" });
      }

      let bus = await Bus.findById(busId);
      if (!bus) {
        res.clearCookie("busToken");

        // Redirect user back
        return res.redirect("/DC");
      }
      // Get start and end of the day in IST

      const currentIST = moment().tz("Asia/Kolkata");

      const logDate = currentIST.format("YYYY-MM-DD");

      const isMorning = currentIST.hour() < 14;
      console.log("Current hour:", currentIST.hour());
      console.log("isMorning:", isMorning);

      // एक्टिविटी लॉग ढूँढो या नया बनाओ
      let activity = await BusActivityLog.findOne({
        bus: busId,
        logDate: logDate,
      });

      if (!activity) {
        activity = new BusActivityLog({
          bus: busId,
          logDate: logDate, // ✅ must include for future lookups
          stops: [],
          path: [],
          events: [],
        });
      }

      // इमेज का सिर्फ रिलेटिव पाथ स्टोर करो
      const imagePath = file.path.split("public")[1];

      if (isMorning) {
        activity.morningSnap = {
          image: imagePath,
          submittedWho: req.worker.id,
          reading: Number(odometer),

          takenAt: moment().tz("Asia/Kolkata").format("hh:mm A"),
        };
      } else {
        activity.eveningSnap = {
          image: imagePath,
          submittedWho: req.worker.id,
          reading: Number(odometer),

          takenAt: moment().tz("Asia/Kolkata").format("hh:mm A"),
        };
      }

      await activity.save();

      return res.status(200).json({
        message: `${
          isMorning ? "सुबह" : "शाम"
        } की मीटर रीडिंग सफलतापूर्वक सहेजी गई है।`,
        activity,
      });
    } catch (error) {
      console.error("Upload error:", error);
      return res.status(500).json({
        message: "सर्वर में आंतरिक त्रुटि हुई है। कृपया बाद में प्रयास करें।",
      });
    }
  }
);

router.post(
  "/PB/emergencyAlert",
  checkUserExistenceAndRedirect(),
  busAuth,
  async (req, res) => {
    try {
      const busId = req.busId;

      if (!busId) {
        return res.status(400).json({ message: "❌ Bus ID आवश्यक है।" });
      }

      // 🚌 Fetch bus details
      const bus = await Bus.findById(busId)
        .populate("driver")
        .populate("conductor");

      if (!bus) {
        res.clearCookie("busToken");

        return res.status(404).json({ message: "❌ बस नहीं मिली।" });
      }

      // 🔍 Extract info
      const busNumber = bus.busNumber || "अज्ञात";
      const driverMobile = bus.driver?.phone || "नहीं मिला";
      const conductorMobile = bus.conductor?.phone || "नहीं मिला";

      const title = "🛑 Emergency Alert";
      const message = `An emergency alert has been received from bus number ${busNumber}. Driver: ${driverMobile}, Conductor: ${conductorMobile}`;

      // 👥 Fetch admins and superadmins
      const admins = await CORE.find({
        role: { $in: ["admin", "administrator"] },
        isLogged: true, // ✅ Only logged-in users
        notificationToken: { $exists: true, $ne: "" }, // ✅ Token must exist and not be empty
      });

      // 🚀 Send notification to each
      for (const admin of admins) {
        sendNotificationToClient(admin.notificationToken, title, message);
      }

      return res.status(200).json({ message: "✅ सूचना भेज दी गई है।" });
    } catch (err) {
      console.error("❌ Emergency Alert Error:", err);
      return res.status(500).json({ message: "❌ सर्वर त्रुटि" });
    }
  }
);
export { router as dcRouter };

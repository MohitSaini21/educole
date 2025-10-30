import express from "express";
import Driver from "../model/driver.js";
import CORE from "../model/admin.js";
import rateLimit from "express-rate-limit";

import Complaint from "../model/complain.js";
import Conductor from "../model/conductor.js";
import mongoose from "mongoose";

import Bus from "../model/bus.js";
import FCM from "../model/FCM.js";
import { checkAuthHome } from "../middlware/rootCheckHome.js";
import { generateTokenAndSetCookie } from "../utils/createJwtTokenSetCookie.js";

let router = express.Router();

const limiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 1 minute
  max: 6, // max 5 requests per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers (optional)

  handler: (req, res) => {
    // The rateLimit middleware attaches a property `rateLimit` to the request with info
    // But to be safe, calculate manually:

    const retryAfterMs = req.rateLimit?.resetTime
      ? req.rateLimit.resetTime - Date.now()
      : 0;

    const secondsLeft = Math.ceil(retryAfterMs / 1000);

    res.status(429).json({
      success: false,
      error: "Too many requests",
      message: `You have exceeded the allowed number of login attempts. Please try again after ${secondsLeft} seconds.`,
      retryAfter: secondsLeft,
      code: 429,
    });
  },
});

const complaintLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 2, // Only 2 requests allowed per day
  standardHeaders: true, // Include RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers

  handler: (req, res) => {
    const retryAfterMs = req.rateLimit?.resetTime
      ? req.rateLimit.resetTime - Date.now()
      : 0;

    const secondsLeft = Math.ceil(retryAfterMs / 1000);
    const hoursLeft = Math.ceil(secondsLeft / 3600); // Convert to hours and round up

    res.status(429).json({
      success: false,
      error: "Too many requests",
      message: `You have exceeded the daily limit. Try again after ${hoursLeft} hour(s).`,
      retryAfter: secondsLeft,
      code: 429,
    });
  },
});

router.post("/", async (req, res) => {
  try {
    const busNumber = req.body.inputValue?.toLowerCase().trim();

    if (!busNumber) {
      return res.status(400).json({
        success: false,
        message: "busNumber is required.",
      });
    }

    // Case-insensitive exact match and fetch only required fields
    const bus = await Bus.findOne({
      busNumber: { $regex: new RegExp(`^${busNumber}$`, "i") },
    })
      .select("_id busNumber routeStops busImages status route")
      .lean();

    if (bus) {
      // Sort routeStops by stopOrder (convert string to number for sorting)
      bus.routeStops = bus.routeStops.sort(
        (a, b) => parseInt(a.stopOrder) - parseInt(b.stopOrder)
      );

      return res.json({
        success: true,
        data: bus,
      });
    } else {
      return res.json({
        success: false,
        message: "No matching bus found.",
      });
    }
  } catch (error) {
    console.error("Error searching bus:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong.",
    });
  }
});

router.patch("/toggleFCM/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (!id || typeof isActive !== "boolean") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid request data" });
    }

    const updated = await FCM.findByIdAndUpdate(
      id,
      { isActive },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Tracking entry not found" });
    }

    return res.json({ success: true, message: "Status updated" });
  } catch (err) {
    console.error("Error toggling FCM:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.delete("/deleteFCM/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await FCM.findByIdAndDelete(id);
    if (!result) {
      return res
        .status(404)
        .json({ success: false, message: "Tracking entry not found" });
    }

    return res.json({ success: true, message: "Deleted successfully" });
  } catch (err) {
    console.error("Error deleting FCM:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/track/:token", async (req, res) => {
  const { token } = req.params;

  try {
    if (!token) {
      return res.render("public/track.ejs", {
        message: "No Tracked Bus",
        data: [],
      });
    }

    const trackedEntries = await FCM.find({ fcmToken: token }).populate({
      path: "busId",
      select: "busNumber route _id",
    });

    if (!trackedEntries || trackedEntries.length === 0) {
      return res.render("public/track.ejs", {
        message: "No Tracked Bus",
        data: [],
      });
    }

    return res.render("public/track.ejs", {
      data: trackedEntries,
      message: null,
    });
  } catch (error) {
    console.error("Error fetching FCM token tracking:", error);
    return res.render("public/track.ejs", {
      message: "Server Error",
      data: [],
    });
  }
});

router.post("/saveToken", async (req, res) => {
  try {
    const {
      token,
      stopId,
      busId,
      role = "student",
      createdAt,
      expireDate,
    } = req.body;

    // Basic validation
    if (!token || !stopId || !busId || !createdAt || !expireDate) {
      return res.json({
        success: false,
        message:
          "Missing required fields: token, stopId, busId, createdAt, or expireDate.",
      });
    }

    // ✅ Validate busId
    if (!mongoose.Types.ObjectId.isValid(busId)) {
      return res.json({
        success: false,
        message: "Invalid busId format. Must be a valid MongoDB ObjectId.",
      });
    }

    // Check if the bus exists
    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.json({
        success: false,
        message: "Invalid busId: No such bus found.",
      });
    }

    // Find stop within the bus routeStops
    const stop = bus.routeStops.id(stopId);
    if (!stop) {
      return res.json({
        success: false,
        message: "Invalid stopId: Stop not found in this bus's route.",
      });
    }

    // Check if token with this stopId already exists
    const existing = await FCM.findOne({ fcmToken: token, stopId });

    if (existing) {
      // Update existing entry
      existing.busId = busId;
      existing.role = role;
      existing.isActive = true;
      existing.createdAt = new Date(createdAt);
      existing.expireDate = new Date(expireDate);
      existing.stop = stop.toObject(); // Save full stop data
      await existing.save();
    } else {
      // Create new entry
      await FCM.create({
        fcmToken: token,
        stopId,
        busId,
        role,
        isActive: true,
        createdAt: new Date(createdAt),
        expireDate: new Date(expireDate),
        stop: stop.toObject(), // Save full stop data
      });
    }

    return res.json({
      success: true,
      message: "FCM token saved or updated successfully.",
    });
  } catch (error) {
    console.error("Error in /saveToken:", error);
    return res.json({
      success: false,
      message: "Server error while saving FCM token.",
    });
  }
});

router.get("/particularBus/:id", async (req, res) => {
  const { id } = req.params;

  // Step 1: Check if it's a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send("Invalid Bus ID");
  }

  // Step 2: Convert to ObjectId (optional, Mongoose does it internally if valid)
  const objectId = new mongoose.Types.ObjectId(id);

  const bus = await Bus.findById(id)
    .select("busNumber routeStops iconPhoto route _id")
    .populate("driver", "name phone")
    .populate("conductor", "name phone")
    .lean();

  if (bus) {
    return res.render("public/particularBus.ejs", { bus });
  } else {
    return res.send("Bus not found");
  }
});

router.get("/locationBus/:id", async (req, res) => {
  const { id } = req.params;
  const bus = await Bus.findById(id)
    .select("busNumber routeStops iconPhoto  _id")
    .lean();
  if (bus) {
    return res.render("public/locationBus.ejs", { bus });
  }
});

router.get("/driverConductorLogin", checkAuthHome, async (req, res) => {
  return res.render("public/dcLogin.ejs");
});
router.post(
  "/driverConductorLogin",
  checkAuthHome,
  limiter,
  async (req, res) => {
    try {
      const { userId, password } = req.body;

      if (!userId || !password) {
        return res.status(400).json({
          message:
            "कृपया फ़ॉर्म को सही ढंग से भरें। अन्यथा, आपकी पहुँच स्थायी रूप से प्रतिबंधित की जा सकती है।",
        });
      }

      const trimmedUserId = userId.trim();
      const trimmedPassword = password.trim();

      let driver = await Driver.findOne({ driverId: trimmedUserId });

      if (driver?.isLogged) {
        return res.status(400).json({
          message:
            "आपका खाता पहले से एक डिवाइस में लॉगिन है। कृपया पहले वहाँ से लॉगआउट करें।",
        });
      }

      if (driver) {
        if (trimmedPassword === driver.password) {
          const token = await generateTokenAndSetCookie(
            res,
            driver.driverId,
            driver.role
          );
          if (token) {
            driver.isLogged = true;
            await driver.save();
            return res.status(200).json({ success: true });
          }
        } else {
          return res.status(401).json({
            message: "चालक के लिए पासवर्ड गलत है। कृपया पुनः प्रयास करें।",
          });
        }
      } else {
        let conductor = await Conductor.findOne({ conductorId: trimmedUserId });

        if (conductor?.isLogged) {
          return res.status(400).json({
            message:
              "आपका खाता पहले से एक डिवाइस में लॉगिन है। कृपया पहले वहाँ से लॉगआउट करें।",
          });
        }

        if (conductor) {
          if (trimmedPassword === conductor.password) {
            const token = await generateTokenAndSetCookie(
              res,
              conductor.conductorId,
              conductor.role
            );
            if (token) {
              conductor.isLogged = true;
              await conductor.save();
              return res.status(200).json({ success: true });
            }
          } else {
            return res.status(401).json({
              message: "परिचालक के लिए पासवर्ड गलत है। कृपया पुनः प्रयास करें।",
            });
          }
        } else {
          return res.status(404).json({
            message:
              "चेतावनी: यह खाता चालक या परिचालक के रूप में पंजीकृत नहीं है। अनधिकृत पहुँच प्रयास का पता चला है। यदि यह गलती है, तो कृपया सहायता से संपर्क करें।",
          });
        }
      }
    } catch (error) {
      console.error("लॉगिन के दौरान त्रुटि:", error);
      return res.status(500).json({
        message: "कुछ त्रुटि हो गई है। कृपया थोड़ी देर बाद पुनः प्रयास करें।",
      });
    }
  }
);

router.get("/coreLogin", checkAuthHome, async (req, res) => {
  return res.render("public/coreLogin.ejs");
});

router.post("/adminLogin", checkAuthHome, limiter, async (req, res) => {
  let { userId, password } = req.body;
  userId = userId.trim();
  password = password.trim();

  // Validation: Check if both fields are filled
  if (!userId || !password || userId.length === 0 || password.length === 0) {
    return res.status(400).json({
      success: false,
      message:
        "Please complete all required fields before submitting the form.",
    });
  }

  try {
    // Attempt to find admin by ID
    const user = await CORE.findOne({
      $or: [{ adminId: userId }, { administratorId: userId }],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "No matching administrator account was found. Please verify your credentials.",
      });
    }

    // Compare passwords (this should ideally use bcrypt, not plain comparison)
    if (user.password !== password) {
      return res.status(401).json({
        success: false,
        message: "The credentials provided are incorrect. Please try again.",
      });
    }
    if (user.isLogged) {
      return res.status(401).json({
        success: false,
        message: "The account has been previously logged in by someone else.",
      });
    }

    user.isLogged = true;
    await user.save();

    generateTokenAndSetCookie(res, user._id, user.role);

    return res.status(200).json({
      success: true,
      message: "Login successful. Redirecting to your dashboard...",
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({
      success: false,
      message: "An internal server error occurred. Please try again later.",
    });
  }
});

router.post("/complaints", complaintLimiter, async (req, res) => {
  try {
    const { complaintType, incidentTime, busNumber, description } = req.body;

    // Validate required fields
    if (!complaintType || !incidentTime || !busNumber) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if the bus exists
    const busExists = await Bus.findOne({ busNumber: busNumber.trim() });
    if (!busExists) {
      return res.status(404).json({ message: "Bus number not found" });
    }

    // Limit description to 500 characters (or whatever limit you prefer)
    if (description && description.length > 500) {
      return res
        .status(400)
        .json({ message: "Description is too long (max 500 characters)." });
    }

    // Save complaint
    const complaint = new Complaint({
      complaintType,
      incidentTime,
      busNumber: busNumber.trim(),
      submittedBy: "parent",
      description: description?.trim(),
    });

    await complaint.save();

    return res
      .status(201)
      .json({ message: "Complaint submitted successfully" });
  } catch (err) {
    console.error("Complaint Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/routingMachine", async (req, res) => {
  try {
    const { logId, busId } = req.query;

    if (logId) {
      // Case: BusActivityLog route rendering
      const log = await BusActivityLog.findById(logId).populate(
        "bus",
        "iconPhoto"
      );
      if (!log) {
        return res
          .status(404)
          .json({ message: "❌ No log found with this ID." });
      }

      const path = log.path.map((point) => ({
        lat: point.lat,
        lng: point.lon, // lon → lng for Leaflet
      }));

      return res.render("adminAdministrator/machine.ejs", {
        coordinates: path,
        iconUrl: log.bus.iconPhoto,
      });
    } else if (busId) {
      // Case: Bus route rendering
      const bus = await Bus.findById(busId);
      if (!bus) {
        return res
          .status(404)
          .json({ message: "❌ No bus found with this ID." });
      }

      const route = bus.routeStops
        .map((stop) => ({
          order: parseInt(stop.stopOrder),
          lat: parseFloat(stop.latitude),
          lng: parseFloat(stop.longitude),
        }))
        .filter(
          (point) =>
            !isNaN(point.lat) && !isNaN(point.lng) && !isNaN(point.order)
        )
        .sort((a, b) => a.order - b.order)
        .map(({ lat, lng }) => ({ lat, lng })); // ✅ Remove `order`

      console.log(route);

      return res.render("adminAdministrator/machine.ejs", {
        coordinates: route,
        iconUrl: bus.iconPhoto,
      });
    } else {
      return res.status(400).json({
        message: "❌ Invalid URL: Provide either logId or busId in query.",
      });
    }
  } catch (error) {
    console.error("Error in /routingMachine:", error);
    res.status(500).json({ message: "❌ Internal server error" });
  }
});

export { router as publicRouter };

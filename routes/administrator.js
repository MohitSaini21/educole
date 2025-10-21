import express from "express";
import CORE from "../model/admin.js";

import Bus from "../model/bus.js";
import Driver from "../model/driver.js";
import Conductor from "../model/conductor.js";
import multer from "multer";
import fs from "fs";
import QRCode from "qrcode";
import path from "path";
import { setAllRouteStops } from "../utils/busRouteStops.js";
import { fileURLToPath } from "url";

import generatePassword from "../utils/password.js";
import mongoose from "mongoose";
import FCM from "../model/FCM.js";
import client from "../redis-client.js";

let router = express.Router();

async function removeCache(userId) {
  console.log("Admin has cleared the cache as well.");
  await client.del(`${userId}`);
}
async function removeCacheBus(userId) {
  console.log("Admin has cleared Bus cache as well.");
  let busId = await client.get(`operatorTemBus:${userId}`);
  if (busId) {
    await client.del(`operatorTemBus:${userId}`);
    await client.del(`busTemLog:${busId}`);
  }
}

function generateCustomId(prefix = "ID") {
  const random = Math.random().toString(36).substring(2, 6).toUpperCase(); // 4 random characters
  const timestamp = Date.now().toString().slice(-4); // Last 4 digits of timestamp
  return `${prefix}-${random}${timestamp}`; // Example: CND-A9B32491
}

function isValidPhone(phone) {
  // Validates 10-digit numbers that start with 6-9
  const phoneRegex = /^[6-9]\d{9}$/;
  return phoneRegex.test(phone);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "..", "public", "uploads");

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const FileName = `${Date.now()}-${file.originalname}`;
    cb(null, FileName);
  },
});
const upload = multer({ storage: storage });

// checked
router.get("/addBus", async (req, res) => {
  try {
    const user = await CORE.findById(req.user.id);

    res.render("administrator/addBus.ejs", { user });
  } catch (error) {
    console.log(error.message);
    return res.json({ message: error.message });
  }
});

// checked
router.post("/addBus", async (req, res) => {
  const formDataArray = req.body;

  // Separate data by type
  const busData = formDataArray.find((item) => item.type === "bus");
  const driverData = formDataArray.find((item) => item.type === "driver");
  const conductorData = formDataArray.find((item) => item.type === "conductor");

  try {
    // 🔎 Check for existing bus
    const existingBus = await Bus.findOne({
      busNumber: busData.data.busNumber,
    });
    if (existingBus) {
      return res.status(409).json({
        message:
          "❌ A bus with this bus number already exists. Please use a unique number.",
        code: "BUS_DUPLICATE",
      });
    }

    // Initialize document IDs
    let driverDocId = null;
    let conductorDocId = null;
    let busDocId = null;

    // 👨‍✈️ Create Driver (if provided)

    let phone = driverData.data.driverPhone;

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        message: `❌ Invalid driver phone number. It must be a 10-digit number starting with 6–9.`,
        code: "INVALID_PHONE",
      });
    }

    if (driverData) {
      const newDriver = await Driver.create({
        driverId: generateCustomId("DRV"),
        name: driverData.data.driverName,
        phone: driverData.data.driverPhone,
        licenseNumber: driverData.data.driverLicenseNumber,
        address: driverData.data.driverAddress,
        joiningDate: driverData.data.DriverJoiningDate,
        password: generatePassword(8),
        status: "Active",
      });
      driverDocId = newDriver._id;
      console.log("✅ Driver created:", newDriver.name);
    }

    // 🧍 Create Conductor (if provided)

    phone = conductorData.data.conductorPhone;

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        message: `❌ Invalid conductor phone number. It must be a 10-digit number starting with 6–9.`,
        code: "INVALID_PHONE",
      });
    }
    if (conductorData) {
      const newConductor = await Conductor.create({
        conductorId: generateCustomId("CND"),
        name: conductorData.data.conductorName,
        phone: conductorData.data.conductorPhone,
        address: conductorData.data.conductorAddress,
        joiningDate: conductorData.data.conductorJoiningDate,
        status: "Active",
        password: generatePassword(8),
      });
      conductorDocId = newConductor._id;
    }

    // 🚌 Create Bus
    if (busData) {
      const {
        busNumber,
        route,
        capacity,
        status,
        fuelType,
        lastServiced,
        stops,
        averageSpeed,
        distanceTravelled,
      } = busData.data;

      const newBus = await Bus.create({
        busNumber,
        route,
        capacity,
        status,
        fuelType,
        lastServiced,
        routeStops: stops,
        busDocuments: [],
        driver: driverDocId,
        conductor: conductorDocId,
        averageSpeed,
        distanceTravelled,
      });

      const busDocId = newBus._id.toString(); // ✅ Convert to string
      newBus.qrPath = await QRCode.toDataURL(busDocId);
      await newBus.save(); // ✅ Wait for save to complete

      // 🔄 Link Bus ID to Driver & Conductor
      if (driverDocId) {
        await Driver.findByIdAndUpdate(driverDocId, { assignedBus: busDocId });
      }

      if (conductorDocId) {
        await Conductor.findByIdAndUpdate(conductorDocId, {
          assignedBus: busDocId,
        });
      }
    }
    await setAllRouteStops();

    // ✅ Final Response
    return res.status(201).json({
      message:
        "✅ Bus, Driver, and Conductor created and assigned successfully.",
      code: "SUCCESS",
      data: {
        busId: busDocId,
        driverId: driverDocId,
        conductorId: conductorDocId,
      },
    });
  } catch (error) {
    console.error("❗ Error occurred:", error);
    return res.status(500).json({
      message: "⚠️ Internal Server Error while creating records.",
      error: error.message,
      code: "SERVER_ERROR",
    });
  }
});

router.get("/conductorDriver", async (req, res) => {
  const user = await CORE.findById(req.user.id);

  const { driverId = "N/A", conductorId = "N/A" } = req.query;

  try {
    if (driverId !== "N/A") {
      const driver = await Driver.findById(driverId);
      if (driver) {
        return res.render("administrator/conDriver.ejs", {
          worker: driver,
          user,
        });
      } else {
        return res.json({ message: "Driver not found" });
      }
    }

    if (conductorId !== "N/A") {
      const conductor = await Conductor.findById(conductorId);
      if (conductor) {
        return res.render("administrator/conDriver.ejs", {
          worker: conductor,
          user,
        });
      } else {
        return res.json({ message: "Conductor not found" });
      }
    }

    return res.json({ message: "No valid ID provided" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Conductor Related End paths

router.post("/conductorDocuments/:id", upload.any(), async (req, res) => {
  try {
    const { id } = req.params;
    const { paperNames } = req.body;
    const files = req.files;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    console.log(files);
    // Find the conductor and update its documents
    const conductor = await Conductor.findById(id);
    if (!conductor) {
      return res.status(404).json({ message: "Conductor not found" });
    }
    if (files.length == 0) {
      return res.redirect(
        `/administrator/settings/conductorDriver?conductorId=${conductor._id}`
      );
    }

    const documentNames = Array.isArray(paperNames) ? paperNames : [paperNames];
    console.log(documentNames);

    // Creating an array of document objects
    const documents = files.map((file, index) => ({
      name: documentNames[index] || "Unknown Document", // Default if name is missing
      url: file.path.split("public")[1], /// File path
    }));

    conductor.conductorDocuments.push(...documents);
    await conductor.save();
    await removeCache(conductor.conductorId);

    res.redirect(
      `/administrator/settings/conductorDriver?conductorId=${conductor._id}`
    );
  } catch (error) {
    console.error("Error uploading documents:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post(
  "/conductor/profileImage/:id",
  upload.single("profileImage"),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          message: "❌ Invalid bus ID. Please do not tamper with the URL.",
          code: "INVALID_ID",
        });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Fetch conductor by ID
      const conductor = await Conductor.findById(id);
      if (!conductor) {
        return res.status(404).json({ message: "Conductor not found" });
      }

      // Update profile
      const fullPath = req.file.path;
      const relativePath = fullPath.split("public")[1];
      // Replace the old image only if it's not the default
      if (
        conductor.profilePhoto &&
        conductor.profilePhoto !== "/assets/images/faces/conductor.jpg"
      ) {
        const absolutePath = path.join(
          process.cwd(),
          "public",
          conductor.profilePhoto
        );
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
          console.log("🗑️ Old profile photo deleted:", conductor.profilePhoto);
        }
      }

      conductor.profilePhoto = relativePath;

      await conductor.save();
      await removeCache(conductor.conductorId);

      const io = req.app.get("io");
      const queryBusId = conductor.assignedBus;

      for (const [socketId, socket] of io.sockets.sockets) {
        const query = socket.handshake?.query;
        const connectedBusId = query?.liveBusId;
        const role = query?.role;

        if (!connectedBusId || !role) {
          continue;
        }

        if (connectedBusId === String(queryBusId) && role === "conductor") {
          socket.disconnect(true);
        }
      }
      if (!conductor) {
        return res.status(404).json({ message: "Conductor not found" });
      }

      console.log("File uploaded:", req.file);

      // Redirect user after successful upload
      res.redirect(
        `/administrator/settings/conductorDriver?conductorId=${conductor._id}`
      );
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post("/conductorRow/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body; // Get all fields from req.body
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }
    // 1. Fetch the existing document
    const oldConductor = await Conductor.findById(id);
    await removeCache(oldConductor.conductorId);
    if (!oldConductor) {
      return res.status(404).json({ message: "Conductor not found" });
    }

    // 2. Check if conductorId is being updated AND is different
    if (
      updateData.conductorId &&
      updateData.conductorId !== oldConductor.conductorId
    ) {
      await removeCacheBus(oldConductor._id);
      updateData.isLogged = false; // Mark as not logged
    }
    // Fetch conductor by ID and update
    const conductor = await Conductor.findByIdAndUpdate(id, updateData, {
      new: true, // Returns updated document
      runValidators: true, // Ensures validation rules are applied
    });

    const io = req.app.get("io");
    const queryBusId = conductor.assignedBus;

    for (const [socketId, socket] of io.sockets.sockets) {
      const query = socket.handshake?.query;
      const connectedBusId = query?.liveBusId;
      const role = query?.role;

      if (!connectedBusId || !role) {
        continue;
      }

      if (connectedBusId === String(queryBusId) && role === "conductor") {
        socket.disconnect(true);
      }
    }
    if (!conductor) {
      return res.status(404).json({ message: "Conductor not found" });
    }

    res.redirect(
      `/administrator/settings/conductorDriver?conductorId=${conductor._id}`
    );
  } catch (error) {
    console.error("Error updating conductor:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/driverDocuments/:id", upload.any(), async (req, res) => {
  try {
    const { id } = req.params;
    const { paperNames } = req.body;
    const files = req.files;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    const documentNames = Array.isArray(paperNames) ? paperNames : [paperNames];

    // Creating an array of document objects
    const documents = files.map((file, index) => ({
      name: documentNames[index] || "Unknown Document", // Default if name is missing
      url: file.path.split("public")[1], /// File path
    }));

    // Find the conductor and update its documents
    const conductor = await Driver.findById(id);
    if (!conductor) {
      return res.status(404).json({ message: "Conductor not found" });
    }

    conductor.driverDocuments.push(...documents);
    await conductor.save();
    await removeCache(conductor.driverId);

    res.redirect(
      `/administrator/settings/conductorDriver?driverId=${conductor._id}`
    );
  } catch (error) {
    console.error("Error uploading documents:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post(
  "/driver/profileImage/:id",
  upload.single("profileImage"),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          message: "❌ Invalid bus ID. Please do not tamper with the URL.",
          code: "INVALID_ID",
        });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Fetch conductor by ID
      const conductor = await Driver.findById(id);
      if (!conductor) {
        return res.status(404).json({ message: "Conductor not found" });
      }

      // Update profile
      const fullPath = req.file.path;
      const relativePath = fullPath.split("public")[1];

      if (
        conductor.profilePhoto &&
        conductor.profilePhoto !== "/assets/images/faces/driver.png"
      ) {
        const absolutePath = path.join(
          process.cwd(),
          "public",
          conductor.profilePhoto
        );
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
          console.log("🗑️ Old profile photo deleted:", conductor.profilePhoto);
        }
      }

      conductor.profilePhoto = relativePath;
      await conductor.save();
      await removeCache(conductor.driverId);

      const io = req.app.get("io");
      const queryBusId = conductor.assignedBus;

      for (const [socketId, socket] of io.sockets.sockets) {
        const query = socket.handshake?.query;
        const connectedBusId = query?.liveBusId;
        const role = query?.role;

        if (!connectedBusId || !role) {
          continue;
        }

        if (connectedBusId === String(queryBusId) && role === "driver") {
          socket.disconnect(true);
        }
      }

      console.log("File uploaded:", req.file);

      // Redirect user after successful upload
      res.redirect(
        `/administrator/settings/conductorDriver?driverId=${conductor._id}`
      );
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post("/driverRow/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }
    const updateData = req.body;

    console.log("📥 Update request received for driver ID:", id);
    console.log("🛠️ Update data:", updateData);
    // 1. Fetch the existing document
    const oldConductor = await Driver.findById(id);
    if (!oldConductor) {
      return res.status(404).json({ message: "Conductor not found" });
    }

    // 2. Check if conductorId is being updated AND is different
    await removeCache(oldConductor.driverId);
    if (updateData.driverId && updateData.driverId !== oldConductor.driverId) {
      await removeCacheBus(oldConductor._id);
      updateData.isLogged = false; // Mark as not logged
    }

    // Update driver
    const driver = await Driver.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!driver) {
      console.log("❌ Driver not found in DB.");
      return res.status(404).json({ message: "Driver not found" });
    }

    const io = req.app.get("io");
    const queryBusId = driver.assignedBus;

    for (const [socketId, socket] of io.sockets.sockets) {
      const query = socket.handshake?.query;
      const connectedBusId = query?.liveBusId;
      const role = query?.role;

      if (!connectedBusId || !role) {
        continue;
      }

      if (connectedBusId === String(queryBusId) && role === "driver") {
        socket.disconnect(true);
      }
    }

    // Redirect after disconnect
    return res.redirect(
      `/administrator/settings/conductorDriver?driverId=${driver._id}`
    );
  } catch (error) {
    console.error("🔥 Error in driver update and socket logic:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Bus Related Route

// let's write down fucntion to disconnect it from server when it is updated

function disConnect(req, busId) {
  // ✅ Disconnect relevant sockets
  const io = req.app.get("io");

  for (const [socketId, socket] of io.sockets.sockets) {
    const queryBusId = socket.handshake.query?.liveBusId;

    if (queryBusId && queryBusId === busId.toString()) {
      // socket.disconnect(true);
      // console.log(
      //   `🔌 Disconnected socket ${socketId} for busId: ${queryBusId}`
      // );

      io.to(socket.id).emit("refreshRequest", queryBusId);
    }
  }
}

router.get("/busEntire/:id", async (req, res) => {
  try {
    const user = await CORE.findById(req.user.id);
    const { id } = req.params;

    // Check if ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    const bus = await Bus.findById(id);
    if (!bus) {
      return res.status(404).json({
        message: "🚫 No bus found with the given ID.",
        code: "BUS_NOT_FOUND",
      });
    }

    return res.render("administrator/bus.ejs", { bus, user });
  } catch (error) {
    console.error("Error fetching bus:", error);
    return res.status(500).json({
      message: "🛑 Server Error. Please try again later.",
      code: "SERVER_ERROR",
    });
  }
});

router.post("/busEntire/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // Check if ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    const {
      stops, // this should be an array of stop objects
      ...busData
    } = req.body;

    const bus = await Bus.findById(id);
    if (!bus) {
      return res.status(404).json({ error: "Bus not found" });
    }

    const existingStops = bus.routeStops || [];
    const updatedStops = [];
    const createStops = [];

    for (let i = 0; i < stops.length; i++) {
      const incomingStop = stops[i];

      if (
        incomingStop.stopName &&
        incomingStop.morningTime &&
        incomingStop.eveningTime &&
        incomingStop.latitude &&
        incomingStop.longitude &&
        incomingStop.stopOrder
      ) {
        if (i < existingStops.length) {
          // Update existing stop
          existingStops[i].stopName = incomingStop.stopName;
          existingStops[i].morningTime = incomingStop.morningTime;
          existingStops[i].eveningTime = incomingStop.eveningTime;
          existingStops[i].latitude = incomingStop.latitude;
          existingStops[i].longitude = incomingStop.longitude;
          existingStops[i].stopOrder = incomingStop.stopOrder;

          updatedStops.push(existingStops[i]);
        } else {
          // Add new stop
          createStops.push(incomingStop);
        }
      }
    }
    bus.set({ ...busData, stops: updatedStops });

    // 2. Add new stops to the routeStops array
    if (createStops.length > 0) {
      bus.routeStops.push(...createStops);
    }

    // 3. Save the updated bus document
    await bus.save();

    disConnect(req, bus._id);
    await setAllRouteStops();

    return res.json({ message: "Bus updated successfully", bus });
  } catch (error) {
    console.error("Error updating bus:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/deleteStop/:busId/:stopId", async (req, res) => {
  const { busId, stopId } = req.params;

  // Validate IDs
  if (
    !mongoose.Types.ObjectId.isValid(busId) ||
    !mongoose.Types.ObjectId.isValid(stopId)
  ) {
    return res.status(400).json({
      message: "❌ Invalid bus or stop ID.",
      code: "INVALID_ID",
    });
  }

  try {
    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({
        message: "❌ Bus not found.",
        code: "BUS_NOT_FOUND",
      });
    }

    // Check if stop exists in the routeStops array
    const stopIndex = bus.routeStops.findIndex(
      (stop) => stop._id.toString() === stopId
    );
    if (stopIndex === -1) {
      return res.status(404).json({
        message: "❌ Stop not found in this bus route.",
        code: "STOP_NOT_FOUND",
      });
    }

    // Remove the stop
    bus.routeStops.splice(stopIndex, 1);
    await bus.save();
    await FCM.deleteMany({ stopId });

    disConnect(req, bus._id);
    await setAllRouteStops();

    return res.status(200).json({
      message: "✅ Stop deleted successfully.",
      code: "SUCCESS",
    });
  } catch (error) {
    console.error("❗ Error deleting stop:", error);
    return res.status(500).json({
      message: "🛑 Server error while deleting stop.",
      error: error.message,
      code: "SERVER_ERROR",
    });
  }
});

router.post("/busDocuments/:id", upload.any(), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }
    const { paperNames } = req.body;
    const files = req.files;

    const documentNames = Array.isArray(paperNames) ? paperNames : [paperNames];

    // Creating an array of document objects
    const documents = files.map((file, index) => ({
      name: documentNames[index] || "Unknown Document", // Default if name is missing
      url: file.path.split("public")[1], /// File path
    }));

    // Find the conductor and update its documents
    const bus = await Bus.findById(id);
    if (!bus) {
      return res.status(404).json({ message: "bus not found" });
    }

    bus.busDocuments.push(...documents);
    await bus.save();

    return res.redirect(`/administrator/settings/busEntire/${bus._id}`);
  } catch (error) {
    console.error("Error uploading documents:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/delete-bus", async (req, res) => {
  try {
    const { busId, password } = req.body;

    if (!busId || !password) {
      console.log("❌ Missing bus ID or password.");
      return res
        .status(400)
        .json({ message: "❌ Missing bus ID or password." });
    }

    const user = await CORE.findById(req.user.id).select("password");
    if (!user) {
      console.log("❌ User not found.");
      return res.status(401).json({ message: "❌ User not found." });
    }

    if (password !== user.password) {
      console.log("❌ Incorrect password.");
      return res.status(403).json({ message: "❌ Incorrect password." });
    }

    const bus = await Bus.findById(busId).lean();
    if (!bus) {
      console.log("❌ Bus not found.");
      return res
        .status(404)
        .json({ message: "❌ Bus not found or already deleted." });
    }

    const [driver, conductor] = await Promise.all([
      bus.driver ? Driver.findById(bus.driver).lean() : null,
      bus.conductor ? Conductor.findById(bus.conductor).lean() : null,
    ]);

    await removeCache(driver.driverId);
    await removeCache(conductor.conductorId);
    await removeCacheBus(driver._id);
    await removeCacheBus(conductor._id);
    await client.del(`cachedBus:${bus._id}`);

    // ✅ Safe file delete helper (skips default files)
    const deleteFileIfExists = (
      relativePath,
      label = "File",
      defaultPaths = []
    ) => {
      if (
        !relativePath ||
        typeof relativePath !== "string" ||
        relativePath.trim().length === 0 ||
        defaultPaths.includes(relativePath)
      )
        return;

      const fullPath = path.join(process.cwd(), "public", relativePath);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`🗑️ Deleted ${label}: ${relativePath}`);
        } catch (err) {
          console.error(`❗ Error deleting ${label}: ${relativePath}`, err);
        }
      }
    };

    // 🧹 Bus icon (skip default)
    deleteFileIfExists(bus.iconPhoto, "Bus Icon", [
      "/assets/images/faces/busIcon.png",
    ]);

    // 🧹 Bus images
    if (Array.isArray(bus.busImages)) {
      bus.busImages.forEach((img) => deleteFileIfExists(img, "Bus Image"));
    }

    // 🧹 Bus documents
    if (Array.isArray(bus.busDocuments)) {
      bus.busDocuments.forEach((doc) =>
        deleteFileIfExists(doc.url, "Bus Document")
      );
    }

    // 🧹 Driver cleanup
    if (driver) {
      // Delete driver profile photo if not default
      deleteFileIfExists(driver.profilePhoto, "Driver Profile Photo", [
        "/assets/images/faces/driver.png",
      ]);

      if (Array.isArray(driver.driverDocuments)) {
        driver.driverDocuments.forEach((doc) =>
          deleteFileIfExists(doc.url, "Driver Document")
        );
      }

      await Driver.findByIdAndDelete(driver._id);
      console.log("✅ Driver deleted.");
    }

    // 🧹 Conductor cleanup
    if (conductor) {
      // Delete conductor profile photo if not default
      deleteFileIfExists(conductor.profilePhoto, "Conductor Profile Photo", [
        "/assets/images/faces/conductor.jpg",
      ]);

      if (Array.isArray(conductor.conductorDocuments)) {
        conductor.conductorDocuments.forEach((doc) =>
          deleteFileIfExists(doc.url, "Conductor Document")
        );
      }

      await Conductor.findByIdAndDelete(conductor._id);
      console.log("✅ Conductor deleted.");
    }

    // 🔌 Disconnect from socket

    const result = await FCM.deleteMany({ busId: busId });
    console.log(`${result.deletedCount} tokens deleted.`);

    disConnect(req, bus._id);
    console.log("🔌 Socket disconnected for bus.");

    // 🚌 Delete bus
    await Bus.findByIdAndDelete(busId);
    console.log("🚌 Bus deleted from database.");
    await setAllRouteStops();

    return res.status(201).json({
      success: true,
      message:
        "✔️ Bus, driver, conductor, and all documents deleted successfully.",
    });
  } catch (err) {
    console.error("❗ Server error while deleting bus:", err);
    return res.status(500).json({
      message: "❗ Internal Server Error. Please try again later.",
    });
  }
});

router.get("/deleteBusDocument/:docId/:busId", async (req, res) => {
  try {
    const { docId, busId } = req.params;
    if (
      !mongoose.Types.ObjectId.isValid(busId) ||
      !mongoose.Types.ObjectId.isValid(docId)
    ) {
      return res.status(400).json({
        message: "❌ Invalid bus or doc ID.",
        code: "INVALID_ID",
      });
    }

    // Find the bus
    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    // Find the specific document
    const targetDoc = bus.busDocuments.find(
      (doc) => doc._id.toString() === docId
    );

    if (!targetDoc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Build absolute path from relative path
    const absolutePath = path.join(process.cwd(), "public", targetDoc.url);

    // Delete the file if it exists
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    // Remove the document from the array
    bus.busDocuments = bus.busDocuments.filter(
      (doc) => doc._id.toString() !== docId
    );

    await bus.save(); // Save updated bus

    // Redirect back
    return res.redirect(`/administrator/settings/busEntire/${bus._id}`);
  } catch (error) {
    console.error("Error deleting document:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/busIcon/:id", upload.single("iconPhoto"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Fetch conductor by ID
    const bus = await Bus.findById(id);
    if (!bus) {
      return res.status(404).json({ message: "bus not found" });
    }

    // Update profile
    const fullPath = req.file.path;
    const relativePath = fullPath.split("public")[1];

    if (bus.iconPhoto && bus.iconPhoto !== "/assets/images/faces/busIcon.png") {
      const absolutePath = path.join(process.cwd(), "public", bus.iconPhoto);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
        console.log("🗑️ Old busIcon deleted:", bus.iconPhoto);
      }
    }

    bus.iconPhoto = relativePath;
    await bus.save();

    console.log("File uploaded:", req.file);
    disConnect(req, bus._id);
    await setAllRouteStops();

    res.redirect(`/administrator/settings/busEntire/${bus._id}`);
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/busImages/:id", upload.any(), async (req, res) => {
  try {
    // Get the bus ID from the route params
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    // Get the uploaded files from the request
    const uploadedFiles = req.files;

    // Map through the uploaded files and get the relative paths
    const busImagePaths = uploadedFiles.map((file) => {
      const fullPath = file.path; // Full path (e.g., "public/uploads/abc123.jpg")
      const relativePath = fullPath.split("public")[1]; // Extract relative path (e.g., "/uploads/abc123.jpg")
      return relativePath; // Store only the relative path
    });

    // Find the bus by ID and x its busImages field with the new image paths
    const bus = await Bus.findById(id);

    if (!bus) {
      return res.status(404).send("Bus not found");
    }

    // Add new images to the busImages array
    bus.busImages = [...bus.busImages, ...busImagePaths];

    // Save the bus with the updated busImages
    await bus.save();

    // Redirect user after successful upload
    res.redirect(`/administrator/settings/busEntire/${bus._id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error uploading images");
  }
});

router.get("/deleteImage/:index/:busId", async (req, res) => {
  try {
    const { index, busId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(busId)) {
      return res.status(400).json({
        message: "❌ Invalid bus ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    // Find the bus
    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    // Make sure index is valid
    const imageIndex = parseInt(index);
    if (
      isNaN(imageIndex) ||
      imageIndex < 0 ||
      imageIndex >= bus.busImages.length
    ) {
      return res.status(400).json({ message: "Invalid image index" });
    }

    // Get relative path from busImages (e.g., "/uploads/abc.jpg")
    const relativePath = bus.busImages[imageIndex];

    // Convert to absolute path
    const absolutePath = path.join(process.cwd(), "public", relativePath);

    // Delete file from disk if exists
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    // Remove the image from the array
    bus.busImages.splice(imageIndex, 1);
    await bus.save();

    // Redirect to settings page
    return res.redirect(`/administrator/settings/busEntire/${bus._id}`);
  } catch (error) {
    console.error("Error deleting image:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

//  Shared  path

router.get("/deleteDriverDocument/:docId/:userId", async (req, res) => {
  try {
    const { docId, userId } = req.params;
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(docId)
    ) {
      return res.status(400).json({
        message: "❌ Invalid userId or doc ID.",
        code: "INVALID_ID",
      });
    }

    // Find the bus
    const user = await Driver.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the specific document
    const targetDoc = user.driverDocuments.find(
      (doc) => doc._id.toString() === docId
    );

    if (!targetDoc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Build absolute path from relative path
    const absolutePath = path.join(process.cwd(), "public", targetDoc.url);

    // Delete the file if it exists
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    // Remove the document from the array
    user.driverDocuments = user.driverDocuments.filter(
      (doc) => doc._id.toString() !== docId
    );

    await removeCache(user.driverId);
    await user.save(); // Save updated bus

    // Redirect back
    return res.redirect(
      `/administrator/settings/conductorDriver?driverId=${user._id}`
    );
  } catch (error) {
    console.error("Error deleting document:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});
router.get("/deleteConductorDocument/:docId/:userId", async (req, res) => {
  try {
    const { docId, userId } = req.params;
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(docId)
    ) {
      return res.status(400).json({
        message: "❌ Invalid userId or doc ID.",
        code: "INVALID_ID",
      });
    }

    // Find the bus
    const user = await Conductor.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the specific document
    const targetDoc = user.conductorDocuments.find(
      (doc) => doc._id.toString() === docId
    );

    if (!targetDoc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Build absolute path from relative path
    const absolutePath = path.join(process.cwd(), "public", targetDoc.url);

    // Delete the file if it exists
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    // Remove the document from the array
    user.conductorDocuments = user.conductorDocuments.filter(
      (doc) => doc._id.toString() !== docId
    );

    await removeCache(user.conductorId);
    await user.save(); // Save updated bus

    // Redirect back
    return res.redirect(
      `/administrator/settings/conductorDriver?conductorId=${user._id}`
    );
  } catch (error) {
    console.error("Error deleting document:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// All About Stream

router.get("/liveStream/:id", async (req, res) => {
  try {
    // Step 1: Validate bus ID
    const busId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(busId)) {
      return res.status(400).send("❌ Invalid bus ID");
    }

    // Step 2: Validate user (administrator)
    const user = await CORE.findById(req.user.id);

    // Step 3: Fetch bus
    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).send("❌ Bus not found");
    }

    return res.render("administrator/busStream.ejs", { user, bus });
  } catch (error) {
    console.error("🚨 Error in /liveStream:", error.message);
    return res.status(500).send("❌ Server error occurred");
  }
});

// Regarding Admin

router.get("/addAdmin", async (req, res) => {
  try {
    const admins = await CORE.find({ role: "admin" });

    const user = await CORE.findById(req.user.id);

    return res.render("administrator/addAdmin.ejs", { admins, user });
  } catch (error) {
    console.error("Error fetching admins:", error);
    return res
      .status(500)
      .send("Something went wrong while fetching admins. Contact Developer");
  }
});
router.post("/addAdmin", async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email || !username) {
      return res
        .status(400)
        .json({ done: false, message: "Email and username are required" });
    }

    const existingUser = await CORE.findOne({ email });
    if (existingUser) {
      return res
        .status(409)
        .json({ done: false, message: "Admin with this email already exists" });
    }

    const passwordPlain = generatePassword();

    const adminId = generateCustomId("ADM");

    const newAdmin = new CORE({
      email,
      username,
      password: passwordPlain,
      role: "admin",
      adminId,
    });

    await newAdmin.save();

    res.status(201).json({
      done: true,
      message: "Admin successfully created",

      newAdmin,
    });
  } catch (err) {
    console.error("Error adding admin:", err);
    res.status(500).json({ done: false, message: "Internal server error" });
  }
});

router.post("/deleteAdmin", async (req, res) => {
  try {
    const { id } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "❌ Invalid admin ID. Please do not tamper with the URL.",
        code: "INVALID_ID",
      });
    }

    // Delete admin
    const deletedAdmin = await CORE.findByIdAndDelete(id);

    if (!deletedAdmin) {
      return res.status(404).json({ done: false, message: "Admin not found." });
    }

    // Disconnect socket if connected
    const io = req.app.get("io");
    const deletedAdminIdStr = String(deletedAdmin._id);

    io.sockets.sockets.forEach((socket, socketId) => {
      const connectedAdminId = socket.handshake?.query?.adminId;
      if (connectedAdminId === deletedAdminIdStr) {
        socket.disconnect(true);
      }
    });

    return res
      .status(200)
      .json({ done: true, message: "Admin deleted successfully." });
  } catch (error) {
    console.error("Error deleting admin:", error);
    return res
      .status(500)
      .json({ done: false, message: "Internal server error." });
  }
});

export { router as administratorRouter };

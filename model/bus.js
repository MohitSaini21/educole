import mongoose from "mongoose";

// Schema for route stops with morning and evening timings
const stopSchema = new mongoose.Schema({
  stopName: {
    type: String,
    set: (value) => value.toLowerCase(), // Convert the route to lowercase before saving
  },
  morningTime: {
    type: String,
  },
  eveningTime: {
    type: String,
  },
  latitude: {
    type: String,
  },
  longitude: {
    type: String,
  },
  stopOrder: {
    type: String,
  },
});

// Schema for bus documents (name and URL)
const busDocumentSchema = new mongoose.Schema({
  name: {
    type: String, // Document name (e.g., "Bus Registration", "Insurance")
  },
  url: {
    type: String, // URL or path to the document (e.g., file path or URL)
  },
});

const busSchema = new mongoose.Schema(
  {
    busNumber: {
      type: String,
      index: true,
    },
    route: {
      type: String,
      set: (value) => value.toLowerCase(), // Convert the route to lowercase before saving
    },
    capacity: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["Operational", "Out of Service"],
      default: "Operational",
    },

    fuelType: {
      type: String,
      enum: ["Diesel", "CNG"],
      default: "Diesel", // Fallback if empty
    },
    lastServiced: {
      type: Date,
    },
    iconPhoto: {
      type: String,
      default: "/assets/images/faces/busIcon.png",
    },
    qrPath: {
      type: String,
    },
    busImages: {
      type: [String], // This ensures it's an array of strings (for image paths/URLs)
      default: [], // Default is an empty array
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver", // Reference to Driver model
    },
    conductor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conductor", // Reference to Conductor model
    },
    live: {
      type: Boolean,
    },
    routeStops: [stopSchema], // Array of stops with morning and evening timings
    busDocuments: [busDocumentSchema], // Array of document objects with name and URL
    distanceTravelled: {
      type: Number,
      min: 0, // Distance shouldn't be negative
      default: 0, // Good practice to set default
    },
    averageSpeed: {
      type: Number,
      min: 0, // Distance shouldn't be negative
    },
  },
  { timestamps: true }
);

const Bus = mongoose.model("Bus", busSchema);

export default Bus;

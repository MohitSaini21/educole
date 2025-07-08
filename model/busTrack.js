import mongoose from "mongoose";

const { Schema, model } = mongoose;

const stopLogSchema = new Schema({
  stop: { type: Schema.Types.ObjectId, ref: "Stop", required: true },
  stopName: String,
  morningTime: String,
  eMorningTime: String,
  eveningTime: String,
  eEveningTime: String,
});

const busActivityLogSchema = new Schema({
  bus: { type: Schema.Types.ObjectId, ref: "Bus", required: true },

  stops: [stopLogSchema], // Array of stop logs

  logDate: {
    type: String, // format: "YYYY-MM-DD"
    required: true,
  },

  path: [
    {
      lat: { type: Number, required: true },
      lon: { type: Number, required: true },
    },
  ],
  events: [
    {
      campus: {
        type: String,
        rquired: true,
      },
      event: { type: String, enum: ["Entered", "Exited"], required: true },

      timestamp: { type: String, required: true },
    },
  ],
  morningSnap: {
    reading: {
      type: Number,
    },
    image: {
      type: String, // URL or path to uploaded image
      required: false,
    },
    takenAt: {
      type: String,
    },
  },
  eveningSnap: {
    reading: {
      type: Number,
    },
    image: {
      type: String, // URL or path to uploaded image
      required: false,
    },
    takenAt: {
      type: String,
    },
  },
});

const BusActivityLog = model("BusActivityLog", busActivityLogSchema);

busActivityLogSchema.index({ bus: 1, logDate: 1 }, { unique: true });

export default BusActivityLog;

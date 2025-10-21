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
    index: true,
  },

  path: [
    {
      lat: { type: Number, required: true },
      lon: { type: Number, required: true },
    },
  ],
  whoDrived: [
    {
      type: String,
    },
  ],
  events: [
    {
      campus: {
        type: String,
        required: true,
      },
      event: { type: String, enum: ["Entered", "Exited"], required: true },

      timestamp: { type: String, required: true },
    },
  ],
  morningSnap: {
    reading: {
      type: Number,
    },
    submittedWho: {
      type: String,
    },
    image: {
      type: String, // URL or path to uploaded image
      required: false,
    },
    takenAt: {
      type: String,
    },
  },

  distanceCovered: { type: Number, default: 0 },
  eveningSnap: {
    reading: {
      type: Number,
    },
    submittedWho: {
      type: String,
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

busActivityLogSchema.index({ bus: 1, logDate: 1 }, { unique: true });
const BusActivityLog = model("BusActivityLog", busActivityLogSchema);

export default BusActivityLog;

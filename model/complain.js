import mongoose from "mongoose";

const complaintSchema = new mongoose.Schema(
  {
    complaintType: {
      type: String, // e.g., mechanical, route_issue, etc.
    },
    incidentTime: {
      type: Date,
    },
    media: {
      type: String,
    },
    busNumber: {
      type: String,
      index: true,
    },
    submittedBy: {
      type: String,
      enum: ["parent", "operator"], // ✅ Only these roles allowed
    },
    submittedWho: {
      type: String,
    },

    phone: {
      type: String,
    },

    status: {
      type: String,
      enum: ["reviewed", "rejected", "pending"], // ✅ Only these roles allowed
      default: "pending",
    },

    description: {
      type: String,
    },
  },
  { timestamps: true }
);

const Complaint = mongoose.model("Complaint", complaintSchema);

export default Complaint;

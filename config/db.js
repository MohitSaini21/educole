import mongoose from "mongoose";

export const ConnectDB = async (url) => {
  try {
    await mongoose.connect(url);
    console.log(`DB is connected for the process ${process.pid}}`);
  } catch (error) {
    console.error("Error in DB connection or index creation:", error.message);
    process.exit(1); // Exit the process if connection fails
  }
};

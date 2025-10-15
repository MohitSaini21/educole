cron.schedule(
  "0 0 * * *", // Every day at 12:00 AM IST
  async () => {
    const nowIST = moment().tz("Asia/Kolkata");

    const currentTime = nowIST.format("YYYY-MM-DD HH:mm:ss");
    console.log(`⏰ Cron triggered at (IST): ${currentTime}`);

    // 🔹 Clear in-memory object used for location checks
    console.log("🕛 12:00 AM IST: Clearing lastEvaluated memory...");

    for (const busId in lastEvaluated) {
      await newsaveLogs(lastEvaluated[busId]);

      delete lastEvaluated[busId];
    }
    console.log("🧹 Cleared all entries from lastEvaluated");

    // 🔹 Delete old logs based on logDate (YYYY-MM-DD format)
    const cutoffDate = nowIST.clone().subtract(10, "day").format("YYYY-MM-DD");
    console.log(`🧾 Deleting logs with logDate before: ${cutoffDate}`);

    try {
      const oldLogs = await BusActivityLog.find({
        logDate: { $lt: cutoffDate },
      });

      if (oldLogs.length === 0) {
        console.log("📂 No old logs found to delete.");
        return;
      }

      console.log(`📁 Found ${oldLogs.length} old logs to delete.`);

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
    } catch (error) {
      console.error("❌ Error during cleanup cron job:", error);
    }
  },
  {
    timezone: "Asia/Kolkata",
  }
);

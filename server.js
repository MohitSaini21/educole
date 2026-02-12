import cluster from "cluster";
import os from "os";
import {setAllRouteStops} from "./utils/busRouteStops.js";
import {createClient} from "redis";

const totalCPUs = os.availableParallelism();

const BASE_PORT = 3000; // starting port (3000, 3001, 3002, ...)

if (cluster.isPrimary) {
    console.log(`👑 Primary process ${process.pid} is running`);
    // const masterClient = createClient({
    //     socket: {
    //         host: "127.0.0.1", // this is correct for Node.js on Windows
    //         port: 6379,
    //     },
    //     // password: "..." // only if you set one
    // });


    // connecting with redis cloud...

    const masterClient =createClient({
        socket: {
            host: "redis-14364.c309.us-east-2-1.ec2.cloud.redislabs.com",
            port: 14364,
            tls: false, // ✅ REQUIRED for Redis Cloud
        },

        password: "EeKtW8atYkXAy3iWJMupYn6JvsjBH0Tf"

    });


    masterClient.on("error", (err) => {
        console.error("❌ Redis Master Error:", err);
    });

    await masterClient.connect();

    console.log("✅ Master Redis connected");





    // Initialize data in Redis before workers start
    await masterClient.flushAll();
    await setAllRouteStops(masterClient, true);
    await new Promise((res) => setTimeout(res, 300));

    // Fork workers and assign different ports
    for (let i = 0; i < 1; i++) {
        const worker = cluster.fork({PORT: BASE_PORT + i});
        console.log(
            `🚀 Forked worker ${worker.process.pid} on port ${BASE_PORT + i}`
        );
    }



    await masterClient.quit()






    cluster.on("exit", (worker) => {
        console.log(`❌ Worker ${worker.process.pid} died. Restarting...`);
        // Restart worker on the same port (or choose a new one if you want)
        const workerIndex = Object.keys(cluster.workers).length;
        const newPort = BASE_PORT + workerIndex;
        cluster.fork({PORT: newPort});
    });
} else {
  import("./main.js");
}

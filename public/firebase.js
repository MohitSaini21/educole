import { initializeApp } from "https://www.gstatic.com/firebasejs/9.0.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.0.2/firebase-analytics.js";
import {
  getMessaging,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/9.0.2/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDfyHneVzjGlqXkrwomNsHTVUx5hTJ4kaw",
  authDomain: "mywebapp-d7222.firebaseapp.com",
  projectId: "mywebapp-d7222",
  storageBucket: "mywebapp-d7222.firebasestorage.app",
  messagingSenderId: "37563411529",
  appId: "1:37563411529:web:6c3209e5613ad72603a398",
  measurementId: "G-TTGWTY9B2J",
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const messaging = getMessaging(app);

async function getFcmToken(retryCount) {
  const isPermissionRequested = false;

  if (!isPermissionRequested) {
    try {
      // Request permission to send notifications
      const permission = await Notification.requestPermission();

      if (permission === "granted") {
        // Get FCM Token if permission is granted
        const token = await getToken(messaging, {
          vapidKey:
            "BEfELZh-xCNBDhw1Qn7bdthyhgARsG8WPz88H0X9_IW7K4VqlAJHo8oZ_rTCTwFaeI35tXuE1ZkyDxH7FQRncVc",
        });

        if (token) {
          console.log("FCM Token:", token);
          const createdAt = new Date().toISOString(); // Current ISO timestamp

          // 1. Save token and createdAt
          localStorage.setItem("fcmToken", token);
          localStorage.setItem("fcmTokenCreatedAt", createdAt);
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 1);
          // Store expiryDate in localStorage too (optional but helpful)
          localStorage.setItem("fcmTokenExpiryDate", expiryDate.toISOString());
          document.getElementById("loader-text").textContent =
            "Good to Go. You may now choose a stop to receive real-time notifications.";

          setTimeout(() => {
            document.getElementById("loader").style.display = "none";
          }, 2000);
        } else {
          document.getElementById("loader-text").textContent =
            "Network Issue , you may try later";

          setTimeout(() => {
            document.getElementById("loader").style.display = "none";
          }, 2000);
        }
      } else {
        document.getElementById("loader-text").textContent =
          "Turn on notifications to get real-time updates from your selected stop.";

        setTimeout(() => {
          document.getElementById("loader").style.display = "none";
        }, 2000);
      }

      // Mark the page as loaded by setting the "notifPermissionPageLoaded" cookie
    } catch (error) {
      // If the error happens, retry fetching the token with exponential backoff
      if (retryCount < 5) {
        // Limit retries to 5 times
        const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff (1s, 2s, 4s, 8s...)
        console.log(
          `Error fetching FCM token. Retrying in ${
            retryDelay / 1000
          } seconds...`
        );

        setTimeout(() => {
          getFcmToken(retryCount + 1); // Increment retry count on each attempt
        }, retryDelay);
      } else {
        console.error("Max retry attempts reached. Could not fetch FCM token.");
      }
    }
  } else {
    console.log(
      "Page has been loaded previously, no need to ask for permission again."
    );
  }
}

// Function to send FCM token to the server
// async function sendTokenToServer(token) {
//   try {
//     const response = await fetch("/saveToken", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ token: token }),
//     });

//     // Check if the response status is OK (i.e., 200-299)
//     if (!response.ok) {
//       // If the server returned an error status, throw an error
//       const errorData = await response.json();
//       throw new Error(`Server error: ${errorData.message || "Unknown error"}`);
//     }

//     // Parse the successful response
//     const data = await response.json();
//     console.log("Token saved successfully:", data);
//   } catch (error) {
//     // Handle both network and server errors
//     console.error("Error sending token to server:", error.message || error);
//   }
// }

// Check if service workers are supported and then register

export function fetchToken() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .then(function (registration) {
        console.log(
          "Service Worker registered with scope: ",
          registration.scope
        );
        getFcmToken(0);
      })
      .catch(function (err) {
        console.log("Service Worker registration failed: ", err);
      });
  }
}

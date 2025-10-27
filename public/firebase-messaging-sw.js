// public/firebase-messaging-sw.js

// Import the Firebase scripts using the old, non-modular version
importScripts("https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js");
importScripts(
  "https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js"
);

// Firebase configuration (same as in your main app)
const firebaseConfig = {
  apiKey: "AIzaSyDfyHneVzjGlqXkrwomNsHTVUx5hTJ4kaw",
  authDomain: "mywebapp-d7222.firebaseapp.com",
  projectId: "mywebapp-d7222",
  storageBucket: "mywebapp-d7222.firebasestorage.app",
  messagingSenderId: "37563411529",
  appId: "1:37563411529:web:6c3209e5613ad72603a398",
  measurementId: "G-TTGWTY9B2J",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firebase Messaging
const messaging = firebase.messaging();

// // Handle background messages
// messaging.onBackgroundMessage((payload) => {
//   console.log("Received background message ", payload);

//   // Customize your notification here
//   const notificationTitle = "New Notification!";
//   const notificationOptions = {
//     body: payload.notification.body,
//     icon: "/firebase-logo.png", // Optional icon
//   };

//   // Show notification
//   self.registration.showNotification(notificationTitle, notificationOptions);
// });

// 🧠 Define versioned cache name (update when files change)

// 🧱 Pre-cache these static assets during installation
const CACHE_NAME = "v1";

const ASSETS_TO_CACHE = [
  // HTML pages
  "/index.html",
  "/offline.html",

  // Images
  "/public/bus.gif",
  "/tmuTransport.jpg",
  "/tmuLogo.jpeg",

  // CSS
  "/public/css/bootstrap.css",
  "/public/css/style.css",
  "/public/css/responsive.css",
  "/assets/homeLoader.css",
  "https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/assets/owl.carousel.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",

  // JS (your local + CDN)
  "/firebase.js",
  "/foreground.js",
  "/public/js/jquery-3.4.1.min.js",
  "/public/js/bootstrap.js",
  "https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/owl.carousel.min.js",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js",
  "/public/js/custom.js",

  // Other assets
  "/assets/manifest.json",

  // Map View
  "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d55929.081197299965!2d78.58650322167966!3d28.821957600000005!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x390afdf565c6bc21%3A0xefb0ce367e3f2602!2sTeerthanker%20Mahaveer%20University!5e0!3m2!1sen!2sin!4v1761241011419!5m2!1sen!2sin",
];

// -------------------------------------------------------------
// 🧱 1️⃣ INSTALL EVENT → Cache essential files for offline use
// -------------------------------------------------------------
self.addEventListener("install", (event) => {
  console.log("[ServiceWorker] Install event triggered ✅");

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[ServiceWorker] Caching all core assets...");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );

  // Force the waiting service worker to activate immediately
  self.skipWaiting();
});

// -------------------------------------------------------------
// 🧹 2️⃣ ACTIVATE EVENT → Clean up old caches
// -------------------------------------------------------------
self.addEventListener("activate", (event) => {
  console.log("[ServiceWorker] Activate event triggered 🧹");

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log("[ServiceWorker] Deleting old cache:", name);
            return caches.delete(name);
          }
        })
      );
    })
  );

  // Claim control of all clients (tabs) immediately
  self.clients.claim();
});

// // -------------------------------------------------------------
// // 🌐 3️⃣ FETCH EVENT → Intercept network requests
// // -------------------------------------------------------------
// self.addEventListener("fetch", (event) => {
//   // For non-GET requests (like POST/PUT), skip caching
//   if (event.request.method !== "GET") return;

//   event.respondWith(
//     caches.match(event.request).then((cachedResponse) => {
//       // ✅ Serve from cache if available
//       if (cachedResponse) {
//         console.log("[ServiceWorker] Serving from cache:", event.request.url);
//         return cachedResponse;
//       }

//       // 🌐 Else, try fetching from the network
//       return fetch(event.request)
//         .then((networkResponse) => {
//           // 🧠 Dynamic caching: store new responses in cache
//           return caches.open(CACHE_NAME).then((cache) => {
//             // Clone response because it's a stream
//             cache.put(event.request, networkResponse.clone());
//             return networkResponse;
//           });
//         })
//         .catch(() => {
//           // ⚠️ If offline, show fallback page
//           if (event.request.mode === "navigate") {
//             return caches.match("/offline.html");
//           }
//         });
//     })
//   );
// });

// -------------------------------------------------------------
// 🌐 3️⃣ FETCH EVENT → Intercept network requests
// -------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests (POST, PUT, DELETE, etc.)
  if (event.request.method !== "GET") return;

  const url = event.request.url;
  // Skip socket.io and API calls
  if (url.includes("/socket.io/") || url.includes("/api/")) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        console.log("[ServiceWorker] Serving from cache:", event.request.url);
        return cachedResponse;
      }

      // 🌐 Fetch from network but DO NOT add to cache
      return fetch(event.request)
        .then((networkResponse) => {
          console.log(
            "[ServiceWorker] Fetched from network (not cached):",
            event.request.url
          );
          return networkResponse;
        })
        .catch(() => {
          // ⚠️ If offline and it's a navigation request, show fallback
          if (event.request.mode === "navigate") {
            return caches.match("/offline.html");
          }
          // ⚠️ Always return a valid Response
          return new Response("Network error", {
            status: 408,
            statusText: "Network Error",
          });
        });
    })
  );
});

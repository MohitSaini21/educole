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
const CACHE_NAME = "mywebapp-cache-v1";

// 🧱 Pre-cache these static assets during installation
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/offline.html",
  "/public/css/bootstrap.css",
  "/assets/manifest.json",
  "/assets/homeLoader.css",
  "/public/css/style.css",
  "/public/css/responsive.css",
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

// -------------------------------------------------------------
// 🌐 3️⃣ FETCH EVENT → Intercept network requests
// -------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  // For non-GET requests (like POST/PUT), skip caching
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // ✅ Serve from cache if available
      if (cachedResponse) {
        console.log("[ServiceWorker] Serving from cache:", event.request.url);
        return cachedResponse;
      }

      // 🌐 Else, try fetching from the network
      return fetch(event.request)
        .then((networkResponse) => {
          // 🧠 Dynamic caching: store new responses in cache
          return caches.open(CACHE_NAME).then((cache) => {
            // Clone response because it's a stream
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // ⚠️ If offline, show fallback page
          if (event.request.mode === "navigate") {
            return caches.match("/offline.html");
          }
        });
    })
  );
});

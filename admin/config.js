// config.js

// 1. Import the core Firebase App
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";

// 2. Import the specific Firebase services for the Chit Fund App
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js";

// 3. Your Goorac / Meena Chitfunds Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC3PVyI4KdnpQ_sDA1ixDTt_4E1pSMw1EE",
  authDomain: "meenachitfunds.firebaseapp.com",
  projectId: "meenachitfunds",
  storageBucket: "meenachitfunds.firebasestorage.app",
  messagingSenderId: "440206854857",
  appId: "1:440206854857:web:100f1b6a46bde64c7c1b18",
  measurementId: "G-XVEFZ92P6Q"
};

// 4. Initialize Firebase
const app = initializeApp(firebaseConfig);

// 5. Initialize Services
const db = getFirestore(app);
const auth = getAuth(app);
const analytics = getAnalytics(app);

// 6. Export them so other HTML pages can import them
export { app, db, auth, analytics };

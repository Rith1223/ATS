// Firebase imports (kept for potential future use or if Canvas environment provides them)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global Firebase variables (provided by Canvas environment)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let app;
let db;
let auth;
let userId = 'anonymous'; // Default to anonymous
let currentLanguage = 'en'; // Default language
let mqttConnectionState = 'connecting'; // New: Tracks the MQTT connection state ('connecting', 'connected', 'online', 'lost', 'error')
let generatorCurrentState = 'stopped'; // 'stopped' or 'running' - Initial state, updated by MQTT

// Function to display messages in a custom modal or designated area
function showMessage(message, isError = false) {
    const messageElement = document.getElementById('loginMessage');
    if (messageElement) {
        messageElement.textContent = message;
        messageElement.style.color = isError ? '#ef4444' : '#22c55e';
    } else {
        console.log(message); // Fallback to console if element not found
    }
}

// --- Notification Bar Function ---
function showNotification(message, type = 'info', duration = 3000) {
    const notificationBar = document.getElementById('notification-bar');
    notificationBar.textContent = message;
    notificationBar.className = ''; // Clear existing classes
    notificationBar.classList.add('show', type);
    setTimeout(() => {
        notificationBar.classList.remove('show');
    }, duration);
}

// --- MQTT Configuration ---
const broker = "wss://b00c7e06e4674e2a8b408473fc3f5c0f.s1.eu.hivemq.cloud:8884/mqtt";
const options = { username: "Thearith", password: "Thearith021203" };
const client = mqtt.connect(broker, options);

// New: Function to update the connection display based on state and language
function updateConnectionDisplay() {
    const connectionEl = document.getElementById("connection");
    let text = '';
    switch (mqttConnectionState) {
        case 'connecting':
            text = currentLanguage === 'en' ? "Connecting..." : "កំពុងតភ្ជាប់...";
            break;
        case 'connected':
            text = currentLanguage === 'en' ? "✅ Connected to MQTT" : "✅ បានភ្ជាប់ទៅ MQTT";
            break;
        case 'online':
            text = currentLanguage === 'en' ? "🟢 Online" : "🟢 លើបណ្តាញ";
            break;
        case 'lost':
            text = currentLanguage === 'en' ? "❌ Connection Lost" : "❌ ការតភ្ជាប់បាត់បង់";
            break;
        case 'error':
            text = currentLanguage === 'en' ? "⚠️ Connection Error" : "⚠️ កំហុសការតភ្ជាប់";
            break;
        default:
            text = currentLanguage === 'en' ? "Unknown Status" : "ស្ថានភាពមិនស្គាល់";
    }
    connectionEl.innerText = text;
}


// ✅ MQTT Connection
client.on("connect", () => {
    mqttConnectionState = 'connected'; // Set state to connected
    updateConnectionDisplay(); // Update display based on new state
    client.subscribe("ats/home1/#");
});

// ✅ MQTT Disconnect/Error
client.on("close", () => {
    mqttConnectionState = 'lost'; // Set state to lost
    updateConnectionDisplay(); // Update display based on new state
});

client.on("error", (err) => {
    console.error("MQTT Error:", err);
    mqttConnectionState = 'error'; // Set state to error
    updateConnectionDisplay(); // Update display based on new state
});


// ✅ MQTT Messages
client.on("message", (topic, message) => {
    const msg = message.toString();
    // If topic is for voltage, update the element with id="voltage" (which is now in the .power card)
    if (topic.includes("voltage")) updateCard(".power", "voltage", msg, parseFloat(msg));
    // If topic is for status (power source), update the element with id="status" (which is now in the .voltage card)
    if (topic.includes("status")) document.getElementById("status").innerText = msg;
    if (topic.includes("backup")) document.getElementById("backup").innerText = msg;
    if (topic.includes("alarm")) setAlarm(msg);
    if (topic.includes("generator/status")) updateGeneratorStatus(msg); // Handle generator status updates from ESP32

    // If we receive a message, it means we are online and data is flowing
    if (mqttConnectionState === 'connected' || mqttConnectionState === 'online') {
        mqttConnectionState = 'online'; // Set state to online
        updateConnectionDisplay(); // Update display based on new state
    }

    document.getElementById("lastUpdate").innerText = `${currentLanguage === 'en' ? 'Last update' : 'ពេលវេលាធ្វើបច្ចុប្បន្នភាពចុងក្រោយ'}: ${new Date().toLocaleTimeString()}`;
});

// ✅ Update Voltage Card with Glow
function updateCard(selector, id, msg, voltage) {
    document.getElementById(id).innerText = msg + " V";
    const card = document.querySelector(selector);
    card.classList.remove("ok","warn","error");
    if (voltage > 250 || voltage < 190) card.classList.add("error");
    else if (voltage < 200) card.classList.add("warn");
    else card.classList.add("ok");
    card.style.animation = "glow 1.2s ease-in-out";
    setTimeout(() => card.style.animation = "", 1200);
}

// ✅ Alarm Status Colors and Text
function setAlarm(msg) {
    const alarmCard = document.querySelector(".alarm");
    const alarmTextEl = document.getElementById("alarm");
    alarmCard.classList.remove("ok","error","fault"); // Remove all states first

    if (msg.includes("FAULT")) {
        alarmTextEl.innerText = currentLanguage === 'en' ? "🚨 ACTIVE FAULT" : "🚨 កំហុសសកម្ម";
        alarmCard.classList.add("fault"); // Apply fault specific styling
    } else {
        alarmTextEl.innerText = currentLanguage === 'en' ? "None" : "គ្មាន";
        alarmCard.classList.add("ok"); // Apply ok styling
    }
}

// ✅ Generator Control Toggle - Sends command, waits for ESP32 feedback
function toggleGenerator() {
    const genBtn = document.getElementById('genBtn');
    let command = '';
    let notificationMsg = '';
    let notificationType = 'info';

    // Determine command based on current known state
    if (generatorCurrentState === 'stopped') {
        command = 'START';
        notificationMsg = currentLanguage === 'en' ? "🚀 Sending START command..." : "🚀 កំពុងផ្ញើពាក្យបញ្ជាចាប់ផ្តើម...";
        notificationType = 'info';
        genBtn.classList.add('start-anim'); // Apply animation
    } else {
        command = 'STOP';
        notificationMsg = currentLanguage === 'en' ? "🛑 Sending STOP command..." : "🛑 កំពុងផ្ញើពាក្យបញ្ជាបញ្ឈប់...";
        notificationType = 'info';
        genBtn.classList.add('stop-anim'); // Apply animation
    }

    showNotification(notificationMsg, notificationType);
    client.publish("ats/home1/control", command);

    // Remove animation class after it plays
    genBtn.addEventListener('animationend', () => {
        genBtn.classList.remove('start-anim', 'stop-anim');
    }, { once: true });
    // IMPORTANT: Do NOT update generatorCurrentState here. Wait for MQTT feedback.
}

// New: Update Generator Status based on MQTT messages from ESP32
function updateGeneratorStatus(statusMsg) {
    const genBtn = document.getElementById('genBtn');
    const generatorStatusEl = document.getElementById('generatorStatus');

    const normalizedStatus = statusMsg.toUpperCase().trim(); // Ensure consistency

    if (normalizedStatus === 'RUNNING') {
        generatorCurrentState = 'running';
        genBtn.classList.remove('stopped');
        genBtn.classList.add('running');
        genBtn.innerText = currentLanguage === 'en' ? genBtn.getAttribute('data-en-stop') : genBtn.getAttribute('data-km-stop');
        generatorStatusEl.innerText = currentLanguage === 'en' ? "Status: Running" : "ស្ថានភាព: កំពុងដំណើរការ";
        showNotification(currentLanguage === 'en' ? "✅ Generator is now RUNNING!" : "✅ ម៉ាស៊ីនភ្លើងកំពុងដំណើរការ!", 'success');
    } else if (normalizedStatus === 'STOPPED') {
        generatorCurrentState = 'stopped';
        genBtn.classList.remove('running');
        genBtn.classList.add('stopped');
        genBtn.innerText = currentLanguage === 'en' ? genBtn.getAttribute('data-en-start') : genBtn.getAttribute('data-km-start');
        generatorStatusEl.innerText = currentLanguage === 'en' ? "Status: Stopped" : "ស្ថានភាព: មិនដំណើរការ";
        showNotification(currentLanguage === 'en' ? "🛑 Generator is now STOPPED." : "🛑 ម៉ាស៊ីនភ្លើងបានបញ្ឈប់។", 'error');
    } else {
        // Handle unexpected status messages
        generatorStatusEl.innerText = `${currentLanguage === 'en' ? "Status: " : "ស្ថានភាព: "}${statusMsg}`;
        showNotification(currentLanguage === 'en' ? `⚠️ Unexpected Generator Status: ${statusMsg}` : `⚠️ ស្ថានភាពម៉ាស៊ីនភ្លើងមិនរំពឹងទុក: ${statusMsg}`, 'info');
    }
}


// ✅ Language Switch (Flags)
function switchLanguage(lang) {
    currentLanguage = lang;
    document.querySelectorAll('[data-en], [data-km]').forEach(element => {
        const enText = element.getAttribute('data-en');
        const kmText = element.getAttribute('data-km');

        if (lang === 'en' && enText) {
            element.textContent = enText;
        } else if (lang === 'km' && kmText) {
            element.textContent = kmText;
        }
    });

    // Update generator button text based on current state (which is driven by MQTT)
    const genBtn = document.getElementById('genBtn');
    if (generatorCurrentState === 'running') {
        genBtn.innerText = currentLanguage === 'en' ? genBtn.getAttribute('data-en-stop') : genBtn.getAttribute('data-km-stop');
    } else {
        genBtn.innerText = currentLanguage === 'en' ? genBtn.getAttribute('data-en-start') : genBtn.getAttribute('data-km-start');
    }

    // Update generator status text
    const generatorStatusEl = document.getElementById('generatorStatus');
    if (generatorCurrentState === 'running') {
         generatorStatusEl.innerText = currentLanguage === 'en' ? "Status: Running" : "ស្ថានភាព: កំពុងដំណើរការ";
    } else {
         generatorStatusEl.innerText = currentLanguage === 'en' ? "Status: Stopped" : "ស្ថានភាព: បានបញ្ឈប់";
    }


    // Update placeholders for inputs
    document.getElementById('username').placeholder = lang === 'en' ? 'Username' : 'ឈ្មោះអ្នកប្រើប្រាស់';
    document.getElementById('password').placeholder = lang === 'en' ? 'Password' : 'លេខសម្ងាត់';

    // Update connection status text based on its current logical state
    updateConnectionDisplay();

    // Update alarm text if it's currently showing FAULT
    const alarmTextEl = document.getElementById("alarm");
    const alarmCard = document.querySelector(".alarm");
    // Check for 'fault' class, not just message content, for persistence across language switch
    if (alarmCard.classList.contains('fault')) {
        alarmTextEl.innerText = currentLanguage === 'en' ? "🚨 ACTIVE FAULT" : "🚨 កំហូច";
    } else {
        alarmTextEl.innerText = currentLanguage === 'en' ? "None" : "គ្មាន";
    }

    console.log(`Language set to: ${lang}`);
}

// ✅ Login Check
function login() {
    const user = document.getElementById("username").value;
    const pass = document.getElementById("password").value;
    if (user === "Rith" && pass === "1234") {
        document.getElementById("login-page").style.display = "none";
        document.getElementById("dashboard").style.display = "block";
        // Since Firebase is not explicitly used in the provided JS,
        // we'll just set a dummy user ID for display.
        document.getElementById('userIdDisplay').textContent = `User ID: Rith`;
        // Initial update of generator status display based on its initial 'stopped' state
        updateGeneratorStatus(generatorCurrentState.toUpperCase());
    } else {
        showMessage(currentLanguage === 'en' ? "❌ Invalid Username or Password" : "❌ ឈ្មោះអ្នកប្រើប្រាស់ ឬលេខសម្ងាត់មិនត្រឹមត្រូវ", true);
    }
}

// Expose functions to global scope for onclick in HTML
window.switchLanguage = switchLanguage;
window.login = login;
window.toggleGenerator = toggleGenerator; // Changed from startGenerator
window.showMessage = showMessage;

// Initial language setting on load
document.addEventListener('DOMContentLoaded', () => {
    switchLanguage('en'); // Set default language to English on page load
    updateConnectionDisplay(); // Initial display of "Connecting..."
});

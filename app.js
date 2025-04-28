// --- DOM Elements ---
const connectSupabaseBtn = document.getElementById('connect-supabase-btn');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseKeyInput = document.getElementById('supabase-key');
const supabaseStatusSpan = document.getElementById('supabase-status');

const startTrackingBtn = document.getElementById('start-tracking-btn');
const pauseResumeBtn = document.getElementById('pause-resume-btn'); // New
const stopTrackingBtn = document.getElementById('stop-tracking-btn');
const statusSpan = document.getElementById('status');
const loadingSpinner = document.getElementById('loading-spinner');
const errorMessageDiv = document.getElementById('error-message');
const offlineInfoSpan = document.getElementById('offline-info');
const gpsAccuracyFilterInput = document.getElementById('gps-accuracy-filter'); // New

// Live Data Displays
const latSpan = document.getElementById('latitude');
const lonSpan = document.getElementById('longitude');
const accSpan = document.getElementById('accuracy');
const altSpan = document.getElementById('altitude'); // New
const altAccSpan = document.getElementById('alt-accuracy'); // New
const currentSpeedSpan = document.getElementById('current-speed');
const distanceSpan = document.getElementById('distance');
const avgSpeedSpan = document.getElementById('avg-speed');
const stepsSpan = document.getElementById('steps');
const gyroXSpan = document.getElementById('gyro-x');
const gyroYSpan = document.getElementById('gyro-y');
const gyroZSpan = document.getElementById('gyro-z');

// Session Management & Map
const mapDiv = document.getElementById('map');
const sessionSelect = document.getElementById('session-select');
const refreshSessionsBtn = document.getElementById('refresh-sessions-btn');
const downloadGpxBtn = document.getElementById('download-gpx-btn');
const deleteSessionBtn = document.getElementById('delete-session-btn');
const gpxUploadInput = document.getElementById('gpx-upload'); // New

// Session Summary Display
const summaryNameSpan = document.getElementById('summary-name');
const summaryDurationSpan = document.getElementById('summary-duration');
const summaryDistanceSpan = document.getElementById('summary-distance');
const summaryAvgSpeedSpan = document.getElementById('summary-avg-speed');
const summaryElevGainSpan = document.getElementById('summary-elev-gain');
const summaryElevLossSpan = document.getElementById('summary-elev-loss');
const chartPlaceholder = document.getElementById('chart-placeholder'); // New

// --- State Variables ---
let supabaseClient = null;
let isTracking = false;
let isPaused = false; // New for Pause/Resume
let watchId = null;
let stepSensor = null;
let gyroSensor = null;
let currentSessionId = null;
let pathCoordinates = []; // Stores {lat, lng, alt, time} objects for current track
let currentSteps = null;
let lastGyroData = { x: null, y: null, z: null };
let totalDistance = 0.0; // meters
let lastLocation = null; // {latitude, longitude, altitude, time}
let startTime = null; // Date timestamp for session start
let pauseStartTime = null; // Timestamp when pause began
let totalPausedTime = 0; // Total ms paused during session
let isOnline = navigator.onLine;
let syncInProgress = false;
let currentGpsAccuracyThreshold = 50; // Default value

// --- Map Variables ---
let map = null;
let baseLayers = {}; // For layer control
let layerControl = null; // Leaflet layer control instance
let currentPathPolyline = null;
let loadedPathPolyline = null; // For sessions/GPX
let gpxLayer = null; // Layer group for loaded GPX data
let startMarker = null;
let endMarker = null;

// --- Chart Variables ---
let elevationChart = null; // Chart.js instance
const elevationChartCanvas = document.getElementById('elevation-chart');

// --- Constants ---
const SENSOR_READ_FREQUENCY = 1;
const GYRO_UPDATE_FREQUENCY = 2;
const EARTH_RADIUS_METERS = 6371000;
const OFFLINE_STORAGE_KEY = 'astraTrackerOfflineQueue';

// --- Initialization ---

// --- Offline Caching Functions --- (Unchanged from previous version)
function getOfflineQueue() { /* ... */ try { const q=localStorage.getItem(OFFLINE_STORAGE_KEY); return q?JSON.parse(q):[]; } catch(e){ console.error("Err queue read:",e); localStorage.removeItem(OFFLINE_STORAGE_KEY); return []; } }
function saveOfflineQueue(queue) { /* ... */ try { if(!queue || queue.length === 0){ localStorage.removeItem(OFFLINE_STORAGE_KEY); console.log("Offline queue cleared."); } else { localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(queue)); console.log(`${queue.length} items saved.`); } updateOfflineInfo(); } catch (e) { if(e.name==='QuotaExceededError'){ showError("Offline storage full."); console.error("Quota exceeded!"); } else { console.error("Err queue save:", e); } } }
function queueDataLocally(record) { if(!record) return; console.warn("Queuing data locally.", record); const q=getOfflineQueue(); q.push(record); saveOfflineQueue(q); updateStatus("Offline (Queued)", true); }
async function syncOfflineQueue() { /* ... */ if (!isOnline || !supabaseClient || syncInProgress) return; let queue = getOfflineQueue(); if (queue.length === 0) { updateOfflineInfo(); return; } syncInProgress = true; console.log(`Syncing ${queue.length} items...`); updateStatus("Syncing Queue..."); loadingSpinner.style.display = 'inline-block'; updateOfflineInfo(); let errorsDuringSync = false; const remainingQueue = []; for (const record of queue) { try { if (!navigator.onLine) { console.warn("Network offline during sync."); remainingQueue.push(...queue.slice(queue.indexOf(record))); errorsDuringSync = true; break; } console.log("Syncing record:", record.session_id); const { error } = await supabaseClient.from('web_tracking_data').insert(record); if (error) { console.error("Error syncing record:", error); errorsDuringSync = true; remainingQueue.push(record); showError(`Sync error: ${error.message}.`); } else { console.log("Record synced."); } } catch (err) { console.error("Unexpected sync error:", err); errorsDuringSync = true; remainingQueue.push(record); showError(`Sync exception: ${err.message}.`); } } saveOfflineQueue(remainingQueue); syncInProgress = false; loadingSpinner.style.display = 'none'; if (errorsDuringSync) { updateStatus("Sync Incomplete", true); console.warn("Sync finished with errors."); } else { updateStatus(isTracking ? "Tracking..." : "Idle"); console.log("Sync complete."); } updateOfflineInfo(); }
function updateOfflineInfo() { if (syncInProgress) { offlineInfoSpan.textContent = `(Syncing ${getOfflineQueue().length}...)`; offlineInfoSpan.className = 'ml-3 text-sm syncing-indicator'; return; } const queueSize = getOfflineQueue().length; if (queueSize > 0) { offlineInfoSpan.textContent = `(${queueSize} offline)`; offlineInfoSpan.className = 'ml-3 text-sm offline-indicator'; } else { offlineInfoSpan.textContent = ''; } }
window.addEventListener('online', () => { console.log("Online"); isOnline = true; updateStatus(isTracking ? "Tracking..." : "Idle"); showError(''); syncOfflineQueue(); });
window.addEventListener('offline', () => { console.log("Offline"); isOnline = false; updateStatus("Offline", true); showError("Network offline. Data queued locally."); updateOfflineInfo(); });

// --- Supabase Functions ---

function initializeSupabase() {
    const url = supabaseUrlInput.value.trim();
    const key = supabaseKeyInput.value.trim();
    clearError();
    if (!url || !key) { showError("Supabase URL/Key missing."); updateSupabaseStatus("Missing Credentials", false); return false; }
    console.log('Init Supabase. Global obj:', window.supabase);
    try {
        supabaseClient = supabase.createClient(url, key);
        if (!supabaseClient) throw new Error("createClient returned null.");
        console.log("Supabase client initialized.");
        updateSupabaseStatus("Connected", true);
        enableControls();
        fetchSessionIds();
        syncOfflineQueue(); // Attempt initial sync
        return true;
    } catch (error) {
        console.error("Supabase init error:", error);
        showError(`Supabase init error: ${error.message}`);
        updateSupabaseStatus("Initialization Failed", false);
        supabaseClient = null; disableControls(); return false;
    }
}

async function sendDataToSupabase(data) {
    if (!isTracking || isPaused) return; // Don't send if not tracking or paused

    const record = {
        session_id: currentSessionId,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy_location: data.accuracy,
        altitude: data.altitude, // Add altitude
        accuracy_altitude: data.altitudeAccuracy, // Add altitude accuracy
        steps: data.steps,
        gyro_x: data.gyro?.x,
        gyro_y: data.gyro?.y,
        gyro_z: data.gyro?.z,
        created_at: new Date().toISOString() // Client timestamp for offline
    };

    if (!isOnline || !supabaseClient) {
        queueDataLocally(record); return;
    }

    console.log("Attempting send:", record.created_at);
    try {
        const { error } = await supabaseClient.from('web_tracking_data').insert(record);
        if (error) throw error;
        console.log("Data sent.");
        syncOfflineQueue(); // Attempt sync after successful send
    } catch (error) {
        console.error("Error sending data:", error);
        showError(`Supabase upload error: ${error.message}. Queuing.`);
        queueDataLocally(record);
    }
}

// --- Sensor & Tracking Functions ---

function checkSensorPermissions() { /* ... unchanged ... */ }

function startGeolocation() {
    console.log("Starting geolocation watch...");
    updateStatus("Locating...");
    loadingSpinner.style.display = 'inline-block';
    const options = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 };
    watchId = navigator.geolocation.watchPosition(handleLocationUpdate, handleLocationError, options);
}

function stopGeolocation() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; console.log("Geolocation stopped."); } }

function handleLocationUpdate(position) {
    loadingSpinner.style.display = 'none';
    if (!isTracking || isPaused) return; // Skip if paused

    const { latitude, longitude, accuracy, speed, altitude, altitudeAccuracy } = position.coords;
    const now = Date.now();

    // --- GPS Accuracy Filter ---
    if (accuracy > currentGpsAccuracyThreshold) {
        console.log(`GPS Accuracy too low (${accuracy.toFixed(1)}m > ${currentGpsAccuracyThreshold}m), skipping point.`);
        updateStatus("Tracking (Low GPS Acc)", true); // Indicate low accuracy
        return; // Skip this point
    }

    console.log(`Location update: Lat=${latitude.toFixed(5)}, Lon=${longitude.toFixed(5)}, Acc=${accuracy.toFixed(1)}, Alt=${altitude?.toFixed(1)}, Speed=${speed?.toFixed(1)}`);

    // --- Update Live UI ---
    latSpan.textContent = latitude.toFixed(6);
    lonSpan.textContent = longitude.toFixed(6);
    accSpan.textContent = accuracy.toFixed(1);
    altSpan.textContent = altitude !== null ? altitude.toFixed(1) : 'N/A';
    altAccSpan.textContent = altitudeAccuracy !== null ? altitudeAccuracy.toFixed(1) : 'N/A';
    currentSpeedSpan.textContent = speed !== null ? (speed * 3.6).toFixed(1) : 'N/A';
    if (!isOnline) updateStatus("Offline (Queued)", true); else updateStatus("Tracking...");

    const currentPoint = { latitude, longitude, altitude, time: now };

    // --- Calculate Distance ---
    if (lastLocation) {
        const distanceIncrement = calculateDistance(lastLocation.latitude, lastLocation.longitude, latitude, longitude);
        if (!isNaN(distanceIncrement)) totalDistance += distanceIncrement;
        distanceSpan.textContent = (totalDistance / 1000).toFixed(2);
    }

    // --- Calculate Average Speed (only consider non-paused time) ---
    const activeTrackingTime = (now - startTime - totalPausedTime) / 1000; // Active time in seconds
    if (activeTrackingTime > 1 && totalDistance > 0) {
        const avgSpeedMps = totalDistance / activeTrackingTime;
        avgSpeedSpan.textContent = (avgSpeedMps * 3.6).toFixed(1);
    } else if (totalDistance === 0) {
         avgSpeedSpan.textContent = '0.0';
    } else {
         avgSpeedSpan.textContent = 'N/A'; // Not enough time/distance yet
    }

    lastLocation = currentPoint; // Update last known location

    // --- Update Map ---
    pathCoordinates.push({ lat: latitude, lng: longitude, alt: altitude, time: now });
    updateMapWithPath(pathCoordinates.map(p => [p.lat, p.lng]), true); // Pass only [lat,lng] array

    // --- Send Data ---
    sendDataToSupabase({
        latitude, longitude, accuracy, altitude, altitudeAccuracy,
        steps: currentSteps, gyro: lastGyroData
    });
}

function handleLocationError(error) { /* ... unchanged ... */ }
function startStepCounter() { /* ... unchanged ... */ }
function stopStepCounter() { /* ... unchanged ... */ }
function startGyroscope() { /* ... unchanged ... */ }
function stopGyroscope() { /* ... unchanged ... */ }
function calculateDistance(lat1, lon1, lat2, lon2) { /* ... unchanged ... */ }
function toRadians(degrees) { /* ... unchanged ... */ }

// --- Pause / Resume Function ---
function togglePauseResume() {
    if (!isTracking) return; // Can only pause/resume if tracking

    isPaused = !isPaused; // Toggle state

    if (isPaused) {
        pauseStartTime = Date.now(); // Record when pause started
        pauseResumeBtn.textContent = 'Resume';
        pauseResumeBtn.classList.remove('bg-yellow-500', 'hover:bg-yellow-600');
        pauseResumeBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
        updateStatus("Paused");
        // Optionally stop sensors here if desired to save battery, but restart on resume
        // stopStepCounter(); stopGyroscope();
        console.log("Tracking Paused.");
    } else {
        if (pauseStartTime) {
            totalPausedTime += (Date.now() - pauseStartTime); // Add paused duration
            pauseStartTime = null;
        }
        pauseResumeBtn.textContent = 'Pause';
        pauseResumeBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
        pauseResumeBtn.classList.add('bg-yellow-500', 'hover:bg-yellow-600');
        updateStatus("Tracking..."); // Return to tracking status
        // Restart sensors if they were stopped
        // startStepCounter(); startGyroscope();
        console.log("Tracking Resumed.");
        // Force an immediate location check if possible/needed after resume? Not standard with watchPosition.
    }
}


// --- Map Functions (Leaflet) ---

function initializeMap() {
    if (map) return;
    try {
        map = L.map(mapDiv).setView([51.505, -0.09], 13);

        // Define Base Layers
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="http://www.openstreetmap.org/copyright">OSM</a>'
        });
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
             maxZoom: 19,
             attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        });
         const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            attribution: 'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
        });

        baseLayers = {
            "Street": osmLayer,
            "Satellite": satelliteLayer,
            "Topographic": topoLayer
        };

        osmLayer.addTo(map); // Add default layer

        // Add Layer Control
        if (layerControl) map.removeControl(layerControl); // Remove old one if exists
        layerControl = L.control.layers(baseLayers).addTo(map);

        console.log("Map initialized with layers.");
    } catch (error) {
        console.error("Failed to initialize map:", error);
        showError(`Map initialization failed: ${error.message}`);
        map = null;
    }
}

function updateMapWithPath(coordinates, isLive = false, isGpx = false) {
    if (!map) initializeMap();
    if (!map || !coordinates || coordinates.length < 1) return;

    const polylineOptions = {
        color: isGpx ? 'purple' : (isLive ? 'blue' : 'red'), // Purple for GPX
        weight: isGpx ? 3 : (isLive ? 4 : 3)
    };

    let targetPolyline;
    if (isGpx) {
        // Remove previous live/loaded tracks when showing GPX
        clearMapPath(true);
        clearMapPath(false);
        if(gpxLayer) map.removeLayer(gpxLayer); // Remove old GPX layer
        targetPolyline = L.polyline(coordinates, polylineOptions);
        gpxLayer = L.layerGroup([targetPolyline]).addTo(map); // Add polyline to layer group
    } else {
        targetPolyline = isLive ? currentPathPolyline : loadedPathPolyline;
        const otherPolyline = isLive ? loadedPathPolyline : currentPathPolyline;
        // Remove other *non-GPX* track type
        if (otherPolyline) map.removeLayer(otherPolyline);
        if (isLive) loadedPathPolyline = null; else currentPathPolyline = null;
        // Remove GPX layer if showing live/loaded session
        if(gpxLayer) map.removeLayer(gpxLayer); gpxLayer = null;
    }

    // Remove existing markers before adding new ones
    if (startMarker) map.removeLayer(startMarker); startMarker = null;
    if (endMarker) map.removeLayer(endMarker); endMarker = null;

    if (!targetPolyline && !isGpx) { // Create new polyline if not GPX and doesn't exist
        targetPolyline = L.polyline(coordinates, polylineOptions).addTo(map);
        if (isLive) currentPathPolyline = targetPolyline; else loadedPathPolyline = targetPolyline;
    } else if (targetPolyline && !isGpx) { // Update existing non-GPX polyline
        targetPolyline.setLatLngs(coordinates);
    }
    // If it's GPX, the polyline was already added to gpxLayer above

    // Add Start/End Markers
    if (coordinates.length > 0) {
        startMarker = L.marker(coordinates[0]).addTo(map).bindPopup('Start');
        if (coordinates.length > 1) {
             // Show end marker if loading session/GPX or if live tracking stopped
             if (!isLive || (isLive && !isTracking)) {
                endMarker = L.marker(coordinates[coordinates.length - 1]).addTo(map).bindPopup('End');
             }
        }
    }

    // Adjust map view
    if (coordinates.length > 0) {
        if (isLive) {
            map.setView(coordinates[coordinates.length - 1], Math.max(map.getZoom(), 15));
        } else {
            // Fit bounds for loaded session or GPX file
             if (targetPolyline) map.fitBounds(targetPolyline.getBounds());
             else if(gpxLayer) map.fitBounds(gpxLayer.getBounds()); // Fit GPX layer
        }
    }
}

// --- Path Loading & Management Functions ---

async function fetchSessionIds() { /* ... unchanged ... */ } // Uses RPC

async function loadPathForSession(sessionId) {
    if (!supabaseClient || !sessionId) return;
    console.log(`Loading path for session: ${sessionId}`);
    updateStatus("Loading Path..."); loadingSpinner.style.display = 'inline-block';
    clearError(); clearSessionSummary(); destroyElevationChart();
    disableSessionControls();

    try {
        // Fetch all required data points, including altitude
        const { data: points, error } = await supabaseClient
            .from('web_tracking_data')
            .select('latitude, longitude, created_at, altitude') // Fetch altitude!
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });
        if (error) throw error;

        if (!points || points.length === 0) {
            showError("No data found for session."); updateStatus("No Data", true);
            clearMapPath(false); return;
        }

        console.log(`Loaded ${points.length} points.`);
        const loadedCoordinates = points.map(p => [p.latitude, p.longitude]);

        updateMapWithPath(loadedCoordinates, false, false); // Display loaded path (not live, not gpx)
        calculateAndDisplaySummary(points, `Session ${sessionId.substring(0,8)}`); // Pass points for summary
        displayElevationChart(points); // Display chart
        updateStatus("Path Loaded");
        enableSessionControls(true); // Enable actions

     } catch (error) {
         console.error(`Error loading path:`, error); showError(`Failed to load path: ${error.message}`);
         updateStatus("Load Error", true); enableSessionControls(false);
     } finally {
          loadingSpinner.style.display = 'none';
     }
}

async function downloadSelectedSessionGpx() {
    const sessionId = sessionSelect.value;
    if (!supabaseClient || !sessionId) { showError("Select session."); return; }
    console.log(`Prep GPX: ${sessionId}`); updateStatus("Prep GPX..."); loadingSpinner.style.display = 'inline-block'; clearError();

    try {
        // Fetch required data including altitude and timestamp
        const { data, error } = await supabaseClient
            .from('web_tracking_data')
            .select('latitude, longitude, created_at, altitude') // Select altitude!
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        if (!data || data.length === 0) { showError("No data for GPX."); return; }

        // Generate GPX String
        let gpxString = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="AstraTracker Web" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"><metadata><name>AstraTracker ${sessionId}</name><time>${new Date().toISOString()}</time></metadata><trk><name>Path ${sessionId.substring(0,8)}</name><trkseg>\n`;
        data.forEach(p => {
            const timeISO = new Date(p.created_at).toISOString();
            const altStr = p.altitude !== null ? `<ele>${p.altitude.toFixed(1)}</ele>` : ''; // Add altitude if exists
            gpxString += `      <trkpt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}">${altStr}<time>${timeISO}</time></trkpt>\n`;
        });
        gpxString += `    </trkseg></trk></gpx>`;

        // Trigger download
        const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `astracker_${sessionId.substring(0, 8)}.gpx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);

        console.log("GPX download initiated."); updateStatus("GPX Ready");
    } catch(error) {
        console.error(`Error GPX:`, error); showError(`Failed GPX: ${error.message}`); updateStatus("GPX Error", true);
    } finally { loadingSpinner.style.display = 'none'; }
}

async function deleteSelectedSession() { /* ... unchanged ... */ }

// --- GPX Upload Function ---
function handleGpxUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    console.log(`Attempting to load GPX file: ${file.name}`);
    updateStatus("Loading GPX..."); loadingSpinner.style.display = 'inline-block';
    clearError(); clearSessionSummary(); destroyElevationChart();
    disableSessionControls(); // Disable session stuff while showing GPX
    sessionSelect.value = ""; // Deselect any session

    const reader = new FileReader();
    reader.onload = (e) => {
        const gpxText = e.target.result;
        try {
            const gpxParser = new gpx(gpxText, { // Use the 'gpx' constructor from the library
                parseChildNodes: true // Ensure we get points
            });

            if (!gpxParser.tracks || gpxParser.tracks.length === 0 || !gpxParser.tracks[0].points || gpxParser.tracks[0].points.length === 0) {
                throw new Error("GPX file contains no valid track points.");
            }

            // Extract points (GPX parser structure might vary, adjust as needed)
            // Assuming points have .lat, .lon, .ele (elevation), .time
            const points = gpxParser.tracks[0].points.map(p => ({
                latitude: p.lat,
                longitude: p.lon,
                altitude: p.ele,
                created_at: p.time ? p.time.toISOString() : null // Handle missing time
            }));

            console.log(`Parsed ${points.length} points from GPX.`);
            const gpxCoordinates = points.map(p => [p.latitude, p.longitude]);

            updateMapWithPath(gpxCoordinates, false, true); // Display GPX path (not live, is gpx)
            calculateAndDisplaySummary(points, `GPX: ${file.name}`); // Show summary for GPX
            displayElevationChart(points); // Show elevation chart
            updateStatus("GPX Loaded");

        } catch (parseError) {
            console.error("Error parsing GPX file:", parseError);
            showError(`GPX Parse Error: ${parseError.message}`);
            updateStatus("GPX Error", true);
            clearMapPath(false); // Clear any potentially drawn path
            clearMapPath(true);
        } finally {
            loadingSpinner.style.display = 'none';
            // Re-enable session controls after loading/error
            enableSessionControls(false); // List enabled, actions disabled
            // Clear the file input value so the same file can be loaded again if needed
            event.target.value = null;
        }
    };

    reader.onerror = (e) => {
         console.error("Error reading GPX file:", e);
         showError("Error reading the selected file.");
         updateStatus("GPX Read Error", true);
         loadingSpinner.style.display = 'none';
         enableSessionControls(false);
         event.target.value = null;
    };

    reader.readAsText(file);
}


// --- Session Summary & Chart Functions ---
function calculateAndDisplaySummary(points, name = "N/A") {
    if (!points || points.length < 2) {
        clearSessionSummary(); // Not enough data
        summaryNameSpan.textContent = name;
        return;
    }

    let totalDist = 0;
    let elevGain = 0;
    let elevLoss = 0;
    let lastAlt = points[0].altitude;

    for (let i = 1; i < points.length; i++) {
        // Distance
        totalDist += calculateDistance(points[i-1].latitude, points[i-1].longitude, points[i].latitude, points[i].longitude);

        // Elevation (only if altitude exists for both points)
        const currentAlt = points[i].altitude;
        if (lastAlt !== null && currentAlt !== null && !isNaN(lastAlt) && !isNaN(currentAlt)) {
            const diff = currentAlt - lastAlt;
            if (diff > 0) elevGain += diff;
            else elevLoss -= diff; // Add positive loss
        }
        lastAlt = currentAlt; // Update last altitude for next iteration
    }

    // Duration
    const startTime = new Date(points[0].created_at);
    const endTime = new Date(points[points.length - 1].created_at);
    const durationSeconds = (endTime - startTime) / 1000;

    // Average Speed
    let avgSpeedKmh = 'N/A';
    if (durationSeconds > 0 && totalDist > 0) {
         avgSpeedKmh = ((totalDist / durationSeconds) * 3.6).toFixed(1);
    }

    // Format Duration
    let durationStr = "N/A";
    if (durationSeconds && !isNaN(durationSeconds)) {
         const hours = Math.floor(durationSeconds / 3600);
         const minutes = Math.floor((durationSeconds % 3600) / 60);
         const seconds = Math.floor(durationSeconds % 60);
         durationStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }


    // Update UI
    summaryNameSpan.textContent = name;
    summaryDurationSpan.textContent = durationStr;
    summaryDistanceSpan.textContent = (totalDist / 1000).toFixed(2);
    summaryAvgSpeedSpan.textContent = avgSpeedKmh;
    summaryElevGainSpan.textContent = elevGain.toFixed(1);
    summaryElevLossSpan.textContent = elevLoss.toFixed(1);
}

function clearSessionSummary() {
    summaryNameSpan.textContent = "N/A";
    summaryDurationSpan.textContent = "N/A";
    summaryDistanceSpan.textContent = "N/A";
    summaryAvgSpeedSpan.textContent = "N/A";
    summaryElevGainSpan.textContent = "N/A";
    summaryElevLossSpan.textContent = "N/A";
}

function displayElevationChart(points) {
    destroyElevationChart(); // Clear previous chart first

    if (!points || points.length < 2) {
        chartPlaceholder.style.display = 'block'; // Show placeholder
        return; // Not enough data
    }

    // Prepare data for Chart.js
    const labels = []; // X-axis (e.g., cumulative distance or time index)
    const elevationData = []; // Y-axis
    let cumulativeDistance = 0;

    // Use first point as baseline
    labels.push(0); // Start at 0 km
    elevationData.push(points[0].altitude ?? null); // Use null if altitude missing

    for (let i = 1; i < points.length; i++) {
        cumulativeDistance += calculateDistance(points[i-1].latitude, points[i-1].longitude, points[i].latitude, points[i].longitude);
        labels.push((cumulativeDistance / 1000).toFixed(2)); // Distance in km for label
        elevationData.push(points[i].altitude ?? null); // Use null for missing data points
    }

    chartPlaceholder.style.display = 'none'; // Hide placeholder

    const ctx = elevationChartCanvas.getContext('2d');
    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Elevation (m)',
                data: elevationData,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1, // Slight smoothing
                borderWidth: 1.5,
                pointRadius: 0, // Hide points for cleaner line
                fill: true, // Fill area below line
                spanGaps: true, // Connect line across null data points
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // Allow chart to fill container height
            scales: {
                y: {
                    beginAtZero: false, // Don't force y-axis to start at 0
                    title: { display: true, text: 'Altitude (m)' }
                },
                x: {
                     title: { display: true, text: 'Distance (km)' }
                }
            },
            plugins: {
                title: { display: true, text: 'Elevation Profile' },
                legend: { display: false } // Hide legend for single dataset
            },
            interaction: { // For tooltips
                intersect: false,
                mode: 'index',
            },
        }
    });
}

function destroyElevationChart() {
    if (elevationChart) {
        elevationChart.destroy();
        elevationChart = null;
        console.log("Previous elevation chart destroyed.");
    }
     chartPlaceholder.style.display = 'block'; // Show placeholder when chart destroyed
}

// --- Control Functions ---

function startTracking() {
    if (!supabaseClient) { showError("Connect Supabase."); return; }
    if (isTracking) return; // Prevent starting if already tracking

    console.log("Starting tracking...");
    isTracking = true; isPaused = false;
    currentSessionId = generateUUID();
    pathCoordinates = []; totalDistance = 0.0; lastLocation = null;
    startTime = Date.now(); totalPausedTime = 0; pauseStartTime = null;
    currentSteps = null; lastGyroData = { x: null, y: null, z: null };
    currentGpsAccuracyThreshold = parseInt(gpsAccuracyFilterInput.value, 10) || 50; // Read filter value

    clearMapPath(true); clearMapPath(false); clearMapPath(true, true); // Clear live, loaded, and gpx
    clearError(); clearSessionSummary(); destroyElevationChart();
    resetLiveDataDisplays();
    updateStatus("Initializing...");
    disableSessionControls();
    startTrackingBtn.disabled = true;
    pauseResumeBtn.disabled = false; pauseResumeBtn.textContent = 'Pause'; // Enable Pause
    stopTrackingBtn.disabled = false;
    gpsAccuracyFilterInput.disabled = true; // Disable filter while tracking

    initializeMap();

    checkSensorPermissions().then(() => {
        if (!isTracking) return; // Check if stopped early
        startGeolocation(); startStepCounter(); startGyroscope();
    }).catch(error => {
        console.error("Perm check failed:", error); stopTracking();
    });
}

function stopTracking() {
    if (!isTracking && !isPaused) return; // Only stop if tracking or paused
    console.log("Stopping tracking...");

    const wasPaused = isPaused; // Remember if we stopped while paused
    isTracking = false; isPaused = false;
    loadingSpinner.style.display = 'none';

    stopGeolocation(); stopStepCounter(); stopGyroscope();

    updateStatus("Idle");
    startTrackingBtn.disabled = false;
    pauseResumeBtn.disabled = true; pauseResumeBtn.textContent = 'Pause'; // Reset pause button
    stopTrackingBtn.disabled = true;
    gpsAccuracyFilterInput.disabled = false; // Re-enable filter
    enableSessionControls(false);

    // Add end marker
    if (map && currentPathPolyline && pathCoordinates.length > 1) {
         if (endMarker) map.removeLayer(endMarker);
         endMarker = L.marker(pathCoordinates[pathCoordinates.length - 1].map(p=>p.lat, p=>p.lng)).addTo(map).bindPopup('End');
    }

    console.log(`Tracking stopped. Session ID: ${currentSessionId}`);
    syncOfflineQueue(); // Force sync attempt
}

// --- UI Update Functions ---
function updateStatus(text, isError = false) { /* ... unchanged, handles syncing/offline states ... */ statusSpan.textContent = text; statusSpan.className = 'text-sm font-semibold '; if (isError) { statusSpan.classList.add('text-red-600'); } else if (text === "Tracking...") { statusSpan.classList.add('text-green-600'); } else if (text === "Syncing Queue...") { statusSpan.classList.add('text-blue-600'); } else if (text === "Paused") { statusSpan.classList.add('text-yellow-600'); } else { statusSpan.classList.add('text-gray-600'); } updateOfflineInfo(); }
function showError(message) { errorMessageDiv.textContent = message; if(message) console.error("Error Displayed:", message); }
function clearError() { errorMessageDiv.textContent = ''; }
function resetLiveDataDisplays() { latSpan.textContent = '-'; lonSpan.textContent = '-'; accSpan.textContent = '-'; altSpan.textContent = 'N/A'; altAccSpan.textContent = 'N/A'; currentSpeedSpan.textContent = 'N/A'; distanceSpan.textContent = '0.00'; avgSpeedSpan.textContent = 'N/A'; stepsSpan.textContent = 'N/A'; gyroXSpan.textContent = 'N/A'; gyroYSpan.textContent = 'N/A'; gyroZSpan.textContent = 'N/A'; }
function updateSupabaseStatus(text, connected) { /* ... unchanged ... */ }
function enableControls() { if (!supabaseClient) return; startTrackingBtn.disabled = false; stopTrackingBtn.disabled = true; pauseResumeBtn.disabled = true; gpsAccuracyFilterInput.disabled = false; enableSessionControls(false); }
function disableControls() { startTrackingBtn.disabled = true; stopTrackingBtn.disabled = true; pauseResumeBtn.disabled = true; gpsAccuracyFilterInput.disabled = true; disableSessionControls(); }
function enableSessionControls(sessionSelected) { if (!supabaseClient) return; sessionSelect.disabled = false; refreshSessionsBtn.disabled = false; gpxUploadInput.disabled = false; downloadGpxBtn.disabled = !sessionSelected; deleteSessionBtn.disabled = !sessionSelected; }
function disableSessionControls() { sessionSelect.disabled = true; refreshSessionsBtn.disabled = true; gpxUploadInput.disabled = true; downloadGpxBtn.disabled = true; deleteSessionBtn.disabled = true; }
function clearMapPath(isLive, isGpx = false) { /* Updated to handle GPX layer */ let targetPolyline; if (isGpx) { targetPolyline = gpxLayer; if (map && targetPolyline) map.removeLayer(targetPolyline); gpxLayer = null; } else { targetPolyline = isLive ? currentPathPolyline : loadedPathPolyline; if (map && targetPolyline) map.removeLayer(targetPolyline); if (isLive) currentPathPolyline = null; else loadedPathPolyline = null; } if (map && startMarker) map.removeLayer(startMarker); startMarker = null; if (map && endMarker) map.removeLayer(endMarker); endMarker = null; }

// --- Utility Functions ---
function generateUUID() { /* ... unchanged ... */ }

// --- Event Listeners ---
connectSupabaseBtn.addEventListener('click', initializeSupabase);
startTrackingBtn.addEventListener('click', startTracking);
pauseResumeBtn.addEventListener('click', togglePauseResume); // New listener
stopTrackingBtn.addEventListener('click', stopTracking);
refreshSessionsBtn.addEventListener('click', fetchSessionIds);
downloadGpxBtn.addEventListener('click', downloadSelectedSessionGpx);
deleteSessionBtn.addEventListener('click', deleteSelectedSession);
gpxUploadInput.addEventListener('change', handleGpxUpload); // New listener
gpsAccuracyFilterInput.addEventListener('change', (e) => { // Update threshold when changed
     currentGpsAccuracyThreshold = parseInt(e.target.value, 10) || 50;
     console.log(`GPS Accuracy Filter set to: ${currentGpsAccuracyThreshold}m`);
});
sessionSelect.addEventListener('change', (event) => {
    const selectedSessionId = event.target.value;
    gpxUploadInput.value = null; // Clear file input if session selected
    clearMapPath(true, true); // Clear GPX path
    if (selectedSessionId) {
        loadPathForSession(selectedSessionId);
    } else {
         clearMapPath(false); // Clear loaded path
         clearSessionSummary();
         destroyElevationChart();
         enableSessionControls(false);
    }
});

// --- Initial Page Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM loaded.");
    isOnline = navigator.onLine;
    currentGpsAccuracyThreshold = parseInt(gpsAccuracyFilterInput.value, 10) || 50; // Read initial value
    resetLiveDataDisplays(); clearSessionSummary();
    initializeMap();

    if (!isOnline) { showError("App loaded offline."); updateStatus("Offline", true); }
    if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) { showError("Warning: HTTPS recommended for sensors."); }

    console.log("Attempting auto-connect...");
    initializeSupabase(); // Tries to connect and trigger sync/fetch
    checkSensorPermissions();
    updateOfflineInfo();
});
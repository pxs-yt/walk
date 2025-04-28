const connectSupabaseBtn = document.getElementById('connect-supabase-btn');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseKeyInput = document.getElementById('supabase-key');
const supabaseStatusSpan = document.getElementById('supabase-status');
const startTrackingBtn = document.getElementById('start-tracking-btn');
const pauseResumeBtn = document.getElementById('pause-resume-btn');
const stopTrackingBtn = document.getElementById('stop-tracking-btn');
const statusSpan = document.getElementById('status');
const loadingSpinner = document.getElementById('loading-spinner');
const errorMessageDiv = document.getElementById('error-message');
const offlineInfoSpan = document.getElementById('offline-info');
const gpsAccuracyFilterInput = document.getElementById('gps-accuracy-filter');
const latSpan = document.getElementById('latitude');
const lonSpan = document.getElementById('longitude');
const accSpan = document.getElementById('accuracy');
const altSpan = document.getElementById('altitude');
const altAccSpan = document.getElementById('alt-accuracy');
const currentSpeedSpan = document.getElementById('current-speed');
const distanceSpan = document.getElementById('distance');
const avgSpeedSpan = document.getElementById('avg-speed');
const stepsSpan = document.getElementById('steps');
const gyroXSpan = document.getElementById('gyro-x');
const gyroYSpan = document.getElementById('gyro-y');
const gyroZSpan = document.getElementById('gyro-z');
const mapDiv = document.getElementById('map');
const sessionSelect = document.getElementById('session-select');
const refreshSessionsBtn = document.getElementById('refresh-sessions-btn');
const downloadGpxBtn = document.getElementById('download-gpx-btn');
const deleteSessionBtn = document.getElementById('delete-session-btn');
const gpxUploadInput = document.getElementById('gpx-upload');
const summaryNameSpan = document.getElementById('summary-name');
const summaryDurationSpan = document.getElementById('summary-duration');
const summaryDistanceSpan = document.getElementById('summary-distance');
const summaryAvgSpeedSpan = document.getElementById('summary-avg-speed');
const summaryElevGainSpan = document.getElementById('summary-elev-gain');
const summaryElevLossSpan = document.getElementById('summary-elev-loss');
const chartPlaceholder = document.getElementById('chart-placeholder');

let supabaseClient = null;
let isTracking = false;
let isPaused = false;
let watchId = null;
let stepSensor = null;
let gyroSensor = null;
let currentSessionId = null;
let pathCoordinates = [];
let currentSteps = null;
let lastGyroData = { x: null, y: null, z: null };
let totalDistance = 0.0;
let lastLocation = null;
let startTime = null;
let pauseStartTime = null;
let totalPausedTime = 0;
let isOnline = navigator.onLine;
let syncInProgress = false;
let currentGpsAccuracyThreshold = 50;

let map = null;
let baseLayers = {};
let layerControl = null;
let currentPathPolyline = null;
let loadedPathPolyline = null;
let gpxLayer = null;
let startMarker = null;
let endMarker = null;

let elevationChart = null;
const elevationChartCanvas = document.getElementById('elevation-chart');

const SENSOR_READ_FREQUENCY = 1;
const GYRO_UPDATE_FREQUENCY = 2;
const EARTH_RADIUS_METERS = 6371000;
const OFFLINE_STORAGE_KEY = 'astraTrackerOfflineQueue';

function getOfflineQueue() { try { const q=localStorage.getItem(OFFLINE_STORAGE_KEY); return q?JSON.parse(q):[]; } catch(e){ console.error("Err queue read:",e); localStorage.removeItem(OFFLINE_STORAGE_KEY); return []; } }
function saveOfflineQueue(queue) { try { if(!queue || queue.length === 0){ localStorage.removeItem(OFFLINE_STORAGE_KEY); console.log("Offline queue cleared."); } else { localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(queue)); console.log(`${queue.length} items saved.`); } updateOfflineInfo(); } catch (e) { if(e.name==='QuotaExceededError'){ showError("Offline storage full."); console.error("Quota exceeded!"); } else { console.error("Err queue save:", e); } } }
function queueDataLocally(record) { if(!record) return; console.warn("Queuing data locally.", record); const q=getOfflineQueue(); q.push(record); saveOfflineQueue(q); updateStatus("Offline (Queued)", true); }
async function syncOfflineQueue() { if (!isOnline || !supabaseClient || syncInProgress) return; let queue = getOfflineQueue(); if (queue.length === 0) { updateOfflineInfo(); return; } syncInProgress = true; console.log(`Syncing ${queue.length} items...`); updateStatus("Syncing Queue..."); loadingSpinner.style.display = 'inline-block'; updateOfflineInfo(); let errorsDuringSync = false; const remainingQueue = []; for (const record of queue) { try { if (!navigator.onLine) { console.warn("Network offline during sync."); remainingQueue.push(...queue.slice(queue.indexOf(record))); errorsDuringSync = true; break; } console.log("Syncing record:", record.session_id); const { error } = await supabaseClient.from('web_tracking_data').insert(record); if (error) { console.error("Error syncing record:", error); errorsDuringSync = true; remainingQueue.push(record); showError(`Sync error: ${error.message}.`); } else { console.log("Record synced."); } } catch (err) { console.error("Unexpected sync error:", err); errorsDuringSync = true; remainingQueue.push(record); showError(`Sync exception: ${err.message}.`); } } saveOfflineQueue(remainingQueue); syncInProgress = false; loadingSpinner.style.display = 'none'; if (errorsDuringSync) { updateStatus("Sync Incomplete", true); console.warn("Sync finished with errors."); } else { updateStatus(isTracking ? (isPaused ? "Paused" : "Tracking...") : "Idle"); console.log("Sync complete."); } updateOfflineInfo(); }
function updateOfflineInfo() { if (syncInProgress) { offlineInfoSpan.textContent = `(Syncing ${getOfflineQueue().length}...)`; offlineInfoSpan.className = 'ml-3 text-sm syncing-indicator'; return; } const queueSize = getOfflineQueue().length; if (queueSize > 0) { offlineInfoSpan.textContent = `(${queueSize} offline)`; offlineInfoSpan.className = 'ml-3 text-sm offline-indicator'; } else { offlineInfoSpan.textContent = ''; } }
window.addEventListener('online', () => { console.log("Online"); isOnline = true; updateStatus(isTracking ? (isPaused ? "Paused" : "Tracking...") : "Idle"); showError(''); syncOfflineQueue(); });
window.addEventListener('offline', () => { console.log("Offline"); isOnline = false; updateStatus("Offline", true); showError("Network offline. Data queued locally."); updateOfflineInfo(); });

function initializeSupabase() {
    const url = supabaseUrlInput.value.trim();
    const key = supabaseKeyInput.value.trim();
    clearError();
    if (!url || !key) { showError("Supabase URL/Key missing in HTML."); updateSupabaseStatus("Missing Credentials", false); return false; }
    console.log('Init Supabase. Global obj:', window.supabase);
    try {
        supabaseClient = supabase.createClient(url, key);
        if (!supabaseClient) throw new Error("createClient returned null.");
        console.log("Supabase client initialized.");
        updateSupabaseStatus("Connected", true);
        enableControls();
        fetchSessionIds();
        syncOfflineQueue();
        return true;
    } catch (error) {
        console.error("Supabase init error:", error);
        showError(`Supabase init error: ${error.message}`);
        updateSupabaseStatus("Initialization Failed", false);
        supabaseClient = null; disableControls(); return false;
    }
}

async function sendDataToSupabase(data) {
    if (!isTracking || isPaused) return;

    const record = {
        session_id: currentSessionId,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy_location: data.accuracy,
        altitude: data.altitude,
        accuracy_altitude: data.altitudeAccuracy,
        steps: data.steps,
        gyro_x: data.gyro?.x,
        gyro_y: data.gyro?.y,
        gyro_z: data.gyro?.z,
        created_at: new Date().toISOString()
    };

    if (!isOnline || !supabaseClient) {
        queueDataLocally(record); return;
    }

    console.log("Attempting send:", record.created_at);
    try {
        const { error } = await supabaseClient.from('web_tracking_data').insert(record);
        if (error) throw error;
        console.log("Data sent.");
        syncOfflineQueue();
    } catch (error) {
        console.error("Error sending data:", error);
        showError(`Supabase upload error: ${error.message}. Queuing.`);
        queueDataLocally(record);
    }
}

function checkSensorPermissions() {
    if (!('geolocation' in navigator)) { showError("Geolocation API not supported."); return Promise.reject("Geolocation not supported"); }
    const permissionsToCheck = [];
    if ('Gyroscope' in window) permissionsToCheck.push({ name: 'gyroscope' });
    if ('StepCounter' in window) permissionsToCheck.push({ name: 'accelerometer' });
    if (permissionsToCheck.length === 0) { console.warn("Gyroscope/StepCounter APIs may not be supported."); return Promise.resolve(); }
    return Promise.all(permissionsToCheck.map(d => navigator.permissions.query(d)))
        .then(results => { results.forEach((r, i) => { console.log(`Perm status ${permissionsToCheck[i].name}: ${r.state}`); if (r.state === 'denied') { showError(`${permissionsToCheck[i].name} permission denied.`); } }); })
        .catch(error => { console.error("Error query sensor perms:", error); showError(`Sensor permission check error: ${error.message}`); });
}

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
    if (!isTracking || isPaused) return;

    const { latitude, longitude, accuracy, speed, altitude, altitudeAccuracy } = position.coords;
    const now = Date.now();

    if (accuracy > currentGpsAccuracyThreshold) {
        console.log(`GPS Accuracy too low (${accuracy?.toFixed(1)}m > ${currentGpsAccuracyThreshold}m), skipping.`);
        updateStatus("Tracking (Low GPS Acc)", true);
        return;
    }

    console.log(`Loc Update: Lat=${latitude?.toFixed(5)}, Lon=${longitude?.toFixed(5)}, Acc=${accuracy?.toFixed(1)}, Alt=${altitude?.toFixed(1)}, Spd=${speed?.toFixed(1)}`);

    latSpan.textContent = latitude?.toFixed(6) ?? '-';
    lonSpan.textContent = longitude?.toFixed(6) ?? '-';
    accSpan.textContent = accuracy?.toFixed(1) ?? '-';
    altSpan.textContent = altitude !== null ? altitude.toFixed(1) : 'N/A';
    altAccSpan.textContent = altitudeAccuracy !== null ? altitudeAccuracy.toFixed(1) : 'N/A';
    currentSpeedSpan.textContent = speed !== null ? (speed * 3.6).toFixed(1) : 'N/A';
    if (!isOnline) updateStatus("Offline (Queued)", true); else updateStatus("Tracking...");

    const currentPoint = { latitude, longitude, altitude, time: now };

    if (lastLocation) {
        const distanceIncrement = calculateDistance(lastLocation.latitude, lastLocation.longitude, latitude, longitude);
        if (!isNaN(distanceIncrement)) totalDistance += distanceIncrement;
        distanceSpan.textContent = (totalDistance / 1000).toFixed(2);
    }

    const activeTrackingTime = (now - startTime - totalPausedTime) / 1000;
    if (activeTrackingTime > 1 && totalDistance > 0) {
        const avgSpeedMps = totalDistance / activeTrackingTime;
        avgSpeedSpan.textContent = (avgSpeedMps * 3.6).toFixed(1);
    } else if (totalDistance === 0) {
         avgSpeedSpan.textContent = '0.0';
    } else {
         avgSpeedSpan.textContent = 'N/A';
    }

    lastLocation = currentPoint;

    pathCoordinates.push({ lat: latitude, lng: longitude, alt: altitude, time: now });
    updateMapWithPath(pathCoordinates.map(p => [p.lat, p.lng]), true);

    sendDataToSupabase({ latitude, longitude, accuracy, altitude, altitudeAccuracy, steps: currentSteps, gyro: lastGyroData });
}

function handleLocationError(error) { loadingSpinner.style.display = 'none'; console.error("Geo error:", error); let msg = "Geo error: "; switch (error.code) { case error.PERMISSION_DENIED: msg += "Denied."; break; case error.POSITION_UNAVAILABLE: msg += "Unavailable."; break; case error.TIMEOUT: msg += "Timeout."; break; default: msg += "Unknown error."; break; } showError(msg); updateStatus("Error", true); }
function startStepCounter() { if ('StepCounter' in window) { console.log("Start StepCounter..."); stepsSpan.textContent = 'Init...'; navigator.permissions.query({ name: 'accelerometer' }).then(r => { if (r.state === 'granted' || r.state === 'prompt') { try { stepSensor = new StepCounter({ frequency: SENSOR_READ_FREQUENCY }); stepSensor.addEventListener('reading', () => { currentSteps = stepSensor.value; stepsSpan.textContent = currentSteps ?? 'N/A'; }); stepSensor.addEventListener('error', e => { console.error('StepCounter error:', e.error.name, e.error.message); stepsSpan.textContent = `Err: ${e.error.name}`; stepSensor = null; }); stepSensor.start(); console.log("StepCounter started."); } catch(err) { console.error("Failed init StepCounter:", err); stepsSpan.textContent = `Not Sup (${err.name})`; stepSensor = null; } } else { console.warn("Perm denied for accel."); stepsSpan.textContent = 'Denied'; } }).catch(err => { console.error("Error query accel perm:", err); stepsSpan.textContent = 'Perm Err'; }); } else { console.warn("StepCounter not supported."); stepsSpan.textContent = 'Not Sup'; } }
function stopStepCounter() { if (stepSensor) { stepSensor.stop(); stepSensor = null; console.log("StepCounter stopped."); } }
function startGyroscope() { if ('Gyroscope' in window) { console.log("Start Gyro..."); gyroXSpan.textContent = 'Init...'; gyroYSpan.textContent = ''; gyroZSpan.textContent = ''; navigator.permissions.query({ name: 'gyroscope' }).then(r => { if (r.state === 'granted' || r.state === 'prompt') { try { gyroSensor = new Gyroscope({ frequency: GYRO_UPDATE_FREQUENCY }); gyroSensor.addEventListener('reading', () => { lastGyroData = { x: gyroSensor.x, y: gyroSensor.y, z: gyroSensor.z }; gyroXSpan.textContent = lastGyroData.x?.toFixed(3) ?? 'N/A'; gyroYSpan.textContent = lastGyroData.y?.toFixed(3) ?? 'N/A'; gyroZSpan.textContent = lastGyroData.z?.toFixed(3) ?? 'N/A'; }); gyroSensor.addEventListener('error', e => { console.error('Gyro error:', e.error.name, e.error.message); gyroXSpan.textContent = `Err: ${e.error.name}`; gyroYSpan.textContent = ''; gyroZSpan.textContent = ''; lastGyroData = { x: null, y: null, z: null }; gyroSensor = null; }); gyroSensor.start(); console.log("Gyro started."); } catch(err) { console.error("Failed init Gyro:", err); gyroXSpan.textContent = `Not Sup (${err.name})`; gyroYSpan.textContent = ''; gyroZSpan.textContent = ''; gyroSensor = null; } } else { console.warn("Perm denied for Gyro."); gyroXSpan.textContent = 'Denied'; gyroYSpan.textContent = ''; gyroZSpan.textContent = ''; } }).catch(err => { console.error("Error query gyro perm:", err); gyroXSpan.textContent = 'Perm Err'; gyroYSpan.textContent = ''; gyroZSpan.textContent = ''; }); } else { console.warn("Gyro not supported."); gyroXSpan.textContent = 'Not Sup'; gyroYSpan.textContent = ''; gyroZSpan.textContent = ''; } }
function stopGyroscope() { if (gyroSensor) { gyroSensor.stop(); gyroSensor = null; console.log("Gyro stopped."); } }
function calculateDistance(lat1, lon1, lat2, lon2) { const dLat = toRadians(lat2 - lat1); const dLon = toRadians(lon2 - lon1); const rLat1 = toRadians(lat1); const rLat2 = toRadians(lat2); const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.sin(dLon/2)*Math.sin(dLon/2)*Math.cos(rLat1)*Math.cos(rLat2); const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return EARTH_RADIUS_METERS * c; }
function toRadians(degrees) { return degrees * Math.PI / 180; }

function togglePauseResume() {
    if (!isTracking) return;
    isPaused = !isPaused;
    if (isPaused) {
        pauseStartTime = Date.now();
        pauseResumeBtn.textContent = 'Resume';
        pauseResumeBtn.classList.remove('bg-yellow-500', 'hover:bg-yellow-600');
        pauseResumeBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
        updateStatus("Paused");
        console.log("Tracking Paused.");
    } else {
        if (pauseStartTime) totalPausedTime += (Date.now() - pauseStartTime);
        pauseStartTime = null;
        pauseResumeBtn.textContent = 'Pause';
        pauseResumeBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
        pauseResumeBtn.classList.add('bg-yellow-500', 'hover:bg-yellow-600');
        updateStatus("Tracking...");
        console.log("Tracking Resumed.");
    }
}

function initializeMap() {
    if (map) return;
    try {
        map = L.map(mapDiv).setView([51.505, -0.09], 13);
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' });
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' });
        const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'OpenTopoMap' });
        baseLayers = { "Street": osmLayer, "Satellite": satelliteLayer, "Topographic": topoLayer };
        osmLayer.addTo(map);
        if (layerControl) map.removeControl(layerControl);
        layerControl = L.control.layers(baseLayers).addTo(map);
        console.log("Map initialized.");
    } catch (error) { console.error("Map init failed:", error); showError(`Map init fail: ${error.message}`); map = null; }
}

function updateMapWithPath(coordinates, isLive = false, isGpx = false) {
    if (!map) initializeMap();
    if (!map || !coordinates || coordinates.length < 1) return;
    const polyOpts = { color: isGpx ? 'purple' : (isLive ? 'blue' : 'red'), weight: isGpx ? 3 : (isLive ? 4 : 3) };
    let targetPoly;
    if (isGpx) { clearMapPath(true); clearMapPath(false); if(gpxLayer) map.removeLayer(gpxLayer); targetPoly = L.polyline(coordinates, polyOpts); gpxLayer = L.layerGroup([targetPoly]).addTo(map); }
    else { targetPoly = isLive ? currentPathPolyline : loadedPathPolyline; const otherPoly = isLive ? loadedPathPolyline : currentPathPolyline; if (otherPoly) map.removeLayer(otherPoly); if (isLive) loadedPathPolyline = null; else currentPathPolyline = null; if(gpxLayer) map.removeLayer(gpxLayer); gpxLayer = null; }
    if (startMarker) map.removeLayer(startMarker); startMarker = null; if (endMarker) map.removeLayer(endMarker); endMarker = null;
    if (!targetPoly && !isGpx) { targetPoly = L.polyline(coordinates, polyOpts).addTo(map); if (isLive) currentPathPolyline = targetPoly; else loadedPathPolyline = targetPoly; }
    else if (targetPoly && !isGpx) { targetPoly.setLatLngs(coordinates); }
    if (coordinates.length > 0) { startMarker = L.marker(coordinates[0]).addTo(map).bindPopup('Start'); if (coordinates.length > 1 && (!isLive || (isLive && !isTracking))) { endMarker = L.marker(coordinates[coordinates.length - 1]).addTo(map).bindPopup('End'); } }
    if (coordinates.length > 0) { if (isLive) { map.setView(coordinates[coordinates.length - 1], Math.max(map.getZoom(), 15)); } else { if (targetPoly) map.fitBounds(targetPoly.getBounds()); else if(gpxLayer) map.fitBounds(gpxLayer.getBounds()); } }
}

async function fetchSessionIds() {
    if (!supabaseClient) return; console.log("Fetching sessions RPC..."); disableSessionControls();
    try {
        const { data, error } = await supabaseClient.rpc('get_tracking_sessions'); if (error) throw error;
        sessionSelect.innerHTML = '<option value="">-- Select Recorded Session --</option>';
        if (data && data.length > 0) { data.forEach(s => { const opt = document.createElement('option'); opt.value = s.session_id; const time = new Date(s.last_update).toLocaleString(); opt.textContent = `Session ${s.session_id.substring(0, 8)}... (${time})`; sessionSelect.appendChild(opt); }); console.log(`Fetched ${data.length} sessions.`); }
        else { console.log("No sessions found."); }
    } catch (error) { console.error("Fetch sessions error:", error); showError(`Fetch fail: ${error.message}`); sessionSelect.innerHTML = '<option value="">-- Error --</option>'; }
    finally { enableSessionControls(false); }
}

async function loadPathForSession(sessionId) {
    if (!supabaseClient || !sessionId) return; console.log(`Loading session: ${sessionId}`); updateStatus("Loading Path..."); loadingSpinner.style.display = 'inline-block'; clearError(); clearSessionSummary(); destroyElevationChart(); disableSessionControls();
    try {
        const { data: points, error } = await supabaseClient.from('web_tracking_data').select('latitude, longitude, created_at, altitude').eq('session_id', sessionId).order('created_at', { ascending: true }); if (error) throw error;
        if (!points || points.length === 0) { showError("No data for session."); updateStatus("No Data", true); clearMapPath(false); return; }
        console.log(`Loaded ${points.length} points.`); const coords = points.map(p => [p.latitude, p.longitude]);
        updateMapWithPath(coords, false, false); calculateAndDisplaySummary(points, `Session ${sessionId.substring(0,8)}`); displayElevationChart(points); updateStatus("Path Loaded"); enableSessionControls(true);
     } catch (error) { console.error(`Load path error:`, error); showError(`Load fail: ${error.message}`); updateStatus("Load Error", true); enableSessionControls(false); }
     finally { loadingSpinner.style.display = 'none'; }
}

async function downloadSelectedSessionGpx() {
    const sessionId = sessionSelect.value; if (!supabaseClient || !sessionId) { showError("Select session."); return; } console.log(`Prep GPX: ${sessionId}`); updateStatus("Prep GPX..."); loadingSpinner.style.display = 'inline-block'; clearError();
    try {
        const { data, error } = await supabaseClient.from('web_tracking_data').select('latitude, longitude, created_at, altitude').eq('session_id', sessionId).order('created_at', { ascending: true }); if (error) throw error; if (!data || data.length === 0) { showError("No data for GPX."); return; }
        let gpxStr = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="AstraTracker Web" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"><metadata><name>AstraTracker ${sessionId}</name><time>${new Date().toISOString()}</time></metadata><trk><name>Path ${sessionId.substring(0,8)}</name><trkseg>\n`;
        data.forEach(p => { const time = new Date(p.created_at).toISOString(); const alt = p.altitude !== null ? `<ele>${p.altitude.toFixed(1)}</ele>` : ''; gpxStr += `      <trkpt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}">${alt}<time>${time}</time></trkpt>\n`; });
        gpxStr += `    </trkseg></trk></gpx>`;
        const blob = new Blob([gpxStr], { type: 'application/gpx+xml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `astracker_${sessionId.substring(0, 8)}.gpx`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        console.log("GPX download init."); updateStatus("GPX Ready");
    } catch(error) { console.error(`Error GPX:`, error); showError(`Failed GPX: ${error.message}`); updateStatus("GPX Error", true); }
    finally { loadingSpinner.style.display = 'none'; }
}

async function deleteSelectedSession() {
    const sessionId = sessionSelect.value; if (!supabaseClient || !sessionId) { showError("Select session."); return; } const shortId = sessionId.substring(0, 8); if (!confirm(`DELETE session ${shortId}...?`)) return;
    console.log(`Deleting session: ${sessionId}`); updateStatus("Deleting..."); loadingSpinner.style.display = 'inline-block'; clearError(); disableSessionControls();
    try {
        const { error } = await supabaseClient.from('web_tracking_data').delete().eq('session_id', sessionId); if (error) throw error;
        console.log(`Session ${sessionId} deleted.`); updateStatus("Session Deleted");
        const idx = sessionSelect.selectedIndex; if (idx > 0) sessionSelect.remove(idx); sessionSelect.selectedIndex = 0; clearMapPath(false); clearSessionSummary(); destroyElevationChart();
    } catch(error) { console.error(`Delete error:`, error); showError(`Delete fail: ${error.message}`); updateStatus("Delete Error", true); }
    finally { loadingSpinner.style.display = 'none'; enableSessionControls(false); }
}

function handleGpxUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    console.log(`Loading GPX: ${file.name}`); updateStatus("Loading GPX..."); loadingSpinner.style.display = 'inline-block'; clearError(); clearSessionSummary(); destroyElevationChart(); disableSessionControls(); sessionSelect.value = "";
    const reader = new FileReader();
    reader.onload = (e) => {
        const gpxText = e.target.result;
        try {
            const gpxParser = new gpx(gpxText, { parseChildNodes: true });
            if (!gpxParser.tracks || gpxParser.tracks.length === 0 || !gpxParser.tracks[0].points || gpxParser.tracks[0].points.length === 0) throw new Error("No track points found.");
            const points = gpxParser.tracks[0].points.map(p => ({ latitude: p.lat, longitude: p.lon, altitude: p.ele, created_at: p.time ? p.time.toISOString() : null }));
            console.log(`Parsed ${points.length} points from GPX.`); const coords = points.map(p => [p.latitude, p.longitude]);
            updateMapWithPath(coords, false, true); calculateAndDisplaySummary(points, `GPX: ${file.name}`); displayElevationChart(points); updateStatus("GPX Loaded");
        } catch (parseError) { console.error("GPX Parse Error:", parseError); showError(`GPX Parse Error: ${parseError.message}`); updateStatus("GPX Error", true); clearMapPath(false); clearMapPath(true); clearMapPath(true, true); }
        finally { loadingSpinner.style.display = 'none'; enableSessionControls(false); event.target.value = null; }
    };
    reader.onerror = (e) => { console.error("GPX Read Error:", e); showError("Error reading file."); updateStatus("GPX Read Error", true); loadingSpinner.style.display = 'none'; enableSessionControls(false); event.target.value = null; };
    reader.readAsText(file);
}

function calculateAndDisplaySummary(points, name = "N/A") {
    if (!points || points.length < 2) { clearSessionSummary(); summaryNameSpan.textContent = name; return; }
    let totalDist = 0, elevGain = 0, elevLoss = 0, lastAlt = points[0].altitude;
    for (let i = 1; i < points.length; i++) {
        totalDist += calculateDistance(points[i-1].latitude, points[i-1].longitude, points[i].latitude, points[i].longitude);
        const currentAlt = points[i].altitude;
        if (lastAlt !== null && currentAlt !== null && !isNaN(lastAlt) && !isNaN(currentAlt)) { const diff = currentAlt - lastAlt; if (diff > 0) elevGain += diff; else elevLoss -= diff; }
        lastAlt = currentAlt;
    }
    const startTime = new Date(points[0].created_at); const endTime = new Date(points[points.length - 1].created_at); const durationSeconds = (endTime - startTime) / 1000;
    let avgSpeedKmh = 'N/A'; if (durationSeconds > 0 && totalDist > 0) avgSpeedKmh = ((totalDist / durationSeconds) * 3.6).toFixed(1);
    let durationStr = "N/A"; if (durationSeconds && !isNaN(durationSeconds)) { const h = Math.floor(durationSeconds/3600); const m = Math.floor((durationSeconds%3600)/60); const s = Math.floor(durationSeconds%60); durationStr = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`; }
    summaryNameSpan.textContent = name; summaryDurationSpan.textContent = durationStr; summaryDistanceSpan.textContent = (totalDist / 1000).toFixed(2); summaryAvgSpeedSpan.textContent = avgSpeedKmh; summaryElevGainSpan.textContent = elevGain.toFixed(1); summaryElevLossSpan.textContent = elevLoss.toFixed(1);
}

function clearSessionSummary() { summaryNameSpan.textContent = "N/A"; summaryDurationSpan.textContent = "N/A"; summaryDistanceSpan.textContent = "N/A"; summaryAvgSpeedSpan.textContent = "N/A"; summaryElevGainSpan.textContent = "N/A"; summaryElevLossSpan.textContent = "N/A"; }

function displayElevationChart(points) {
    destroyElevationChart();
    if (!points || points.length < 2) { chartPlaceholder.style.display = 'block'; return; }
    const labels = []; const elevationData = []; let cumulativeDistance = 0;
    labels.push(0); elevationData.push(points[0].altitude ?? null);
    for (let i = 1; i < points.length; i++) { cumulativeDistance += calculateDistance(points[i-1].latitude, points[i-1].longitude, points[i].latitude, points[i].longitude); labels.push((cumulativeDistance / 1000).toFixed(2)); elevationData.push(points[i].altitude ?? null); }
    chartPlaceholder.style.display = 'none';
    const ctx = elevationChartCanvas.getContext('2d');
    elevationChart = new Chart(ctx, {
        type: 'line', data: { labels: labels, datasets: [{ label: 'Elevation (m)', data: elevationData, borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.2)', tension: 0.1, borderWidth: 1.5, pointRadius: 0, fill: true, spanGaps: true, }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false, title: { display: true, text: 'Altitude (m)' } }, x: { title: { display: true, text: 'Distance (km)' } } }, plugins: { title: { display: true, text: 'Elevation Profile' }, legend: { display: false } }, interaction: { intersect: false, mode: 'index', }, }
    });
}

function destroyElevationChart() { if (elevationChart) { elevationChart.destroy(); elevationChart = null; console.log("Elevation chart destroyed."); } chartPlaceholder.style.display = 'block'; }

function startTracking() {
    if (!supabaseClient) { showError("Connect Supabase."); return; } if (isTracking) return;
    console.log("Starting tracking..."); isTracking = true; isPaused = false; currentSessionId = generateUUID(); pathCoordinates = []; totalDistance = 0.0; lastLocation = null; startTime = Date.now(); totalPausedTime = 0; pauseStartTime = null; currentSteps = null; lastGyroData = { x:null,y:null,z:null }; currentGpsAccuracyThreshold = parseInt(gpsAccuracyFilterInput.value, 10) || 50;
    clearMapPath(true); clearMapPath(false); clearMapPath(true, true); clearError(); clearSessionSummary(); destroyElevationChart(); resetLiveDataDisplays(); updateStatus("Initializing..."); disableSessionControls();
    startTrackingBtn.disabled = true; pauseResumeBtn.disabled = false; pauseResumeBtn.textContent = 'Pause'; pauseResumeBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600'); pauseResumeBtn.classList.add('bg-yellow-500', 'hover:bg-yellow-600'); stopTrackingBtn.disabled = false; gpsAccuracyFilterInput.disabled = true;
    initializeMap();
    checkSensorPermissions().then(() => { if (!isTracking) return; startGeolocation(); startStepCounter(); startGyroscope(); }).catch(error => { console.error("Perm check fail:", error); stopTracking(); });
}

function stopTracking() {
    if (!isTracking && !isPaused) return; console.log("Stopping tracking..."); const wasPaused = isPaused; isTracking = false; isPaused = false; loadingSpinner.style.display = 'none';
    stopGeolocation(); stopStepCounter(); stopGyroscope();
    updateStatus("Idle"); startTrackingBtn.disabled = false; pauseResumeBtn.disabled = true; pauseResumeBtn.textContent = 'Pause'; pauseResumeBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600'); pauseResumeBtn.classList.add('bg-yellow-500', 'hover:bg-yellow-600'); stopTrackingBtn.disabled = true; gpsAccuracyFilterInput.disabled = false; enableSessionControls(false);
    if (map && currentPathPolyline && pathCoordinates.length > 1) { if (endMarker) map.removeLayer(endMarker); endMarker = L.marker(pathCoordinates[pathCoordinates.length - 1].map(p => [p.lat, p.lng])).addTo(map).bindPopup('End'); }
    console.log(`Tracking stopped. Session ID: ${currentSessionId}`); syncOfflineQueue();
}

function updateStatus(text, isError = false) { statusSpan.textContent = text; statusSpan.className = 'text-sm font-semibold '; if (isError) { statusSpan.classList.add('text-red-600'); } else if (text === "Tracking...") { statusSpan.classList.add('text-green-600'); } else if (text === "Syncing Queue...") { statusSpan.classList.add('text-blue-600'); } else if (text === "Paused") { statusSpan.classList.add('text-yellow-600'); } else { statusSpan.classList.add('text-gray-600'); } updateOfflineInfo(); }
function showError(message) { errorMessageDiv.textContent = message; if(message) console.error("Error Displayed:", message); }
function clearError() { errorMessageDiv.textContent = ''; }
function resetLiveDataDisplays() { latSpan.textContent = '-'; lonSpan.textContent = '-'; accSpan.textContent = '-'; altSpan.textContent = 'N/A'; altAccSpan.textContent = 'N/A'; currentSpeedSpan.textContent = 'N/A'; distanceSpan.textContent = '0.00'; avgSpeedSpan.textContent = 'N/A'; stepsSpan.textContent = 'N/A'; gyroXSpan.textContent = 'N/A'; gyroYSpan.textContent = 'N/A'; gyroZSpan.textContent = 'N/A'; }
function updateSupabaseStatus(text, connected) { supabaseStatusSpan.textContent = text; supabaseStatusSpan.className = 'ml-3 text-sm font-medium '; supabaseStatusSpan.classList.add(connected ? 'text-green-600' : 'text-red-600'); }
function enableControls() { if (!supabaseClient) return; startTrackingBtn.disabled = false; stopTrackingBtn.disabled = true; pauseResumeBtn.disabled = true; gpsAccuracyFilterInput.disabled = false; enableSessionControls(false); }
function disableControls() { startTrackingBtn.disabled = true; stopTrackingBtn.disabled = true; pauseResumeBtn.disabled = true; gpsAccuracyFilterInput.disabled = true; disableSessionControls(); }
function enableSessionControls(sessionSelected) { if (!supabaseClient) return; sessionSelect.disabled = false; refreshSessionsBtn.disabled = false; gpxUploadInput.disabled = false; downloadGpxBtn.disabled = !sessionSelected; deleteSessionBtn.disabled = !sessionSelected; }
function disableSessionControls() { sessionSelect.disabled = true; refreshSessionsBtn.disabled = true; gpxUploadInput.disabled = true; downloadGpxBtn.disabled = true; deleteSessionBtn.disabled = true; }
function clearMapPath(isLive, isGpx = false) { let target; if (isGpx) { target = gpxLayer; if (map && target) map.removeLayer(target); gpxLayer = null; } else { target = isLive ? currentPathPolyline : loadedPathPolyline; if (map && target) map.removeLayer(target); if (isLive) currentPathPolyline = null; else loadedPathPolyline = null; } if (map && startMarker) map.removeLayer(startMarker); startMarker = null; if (map && endMarker) map.removeLayer(endMarker); endMarker = null; }
function generateUUID() { return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); }

connectSupabaseBtn.addEventListener('click', initializeSupabase);
startTrackingBtn.addEventListener('click', startTracking);
pauseResumeBtn.addEventListener('click', togglePauseResume);
stopTrackingBtn.addEventListener('click', stopTracking);
refreshSessionsBtn.addEventListener('click', fetchSessionIds);
downloadGpxBtn.addEventListener('click', downloadSelectedSessionGpx);
deleteSessionBtn.addEventListener('click', deleteSelectedSession);
gpxUploadInput.addEventListener('change', handleGpxUpload);
gpsAccuracyFilterInput.addEventListener('change', (e) => { currentGpsAccuracyThreshold = parseInt(e.target.value, 10) || 50; console.log(`GPS Filter set to: ${currentGpsAccuracyThreshold}m`); });
sessionSelect.addEventListener('change', (event) => { const selectedSessionId = event.target.value; gpxUploadInput.value = null; clearMapPath(true, true); if (selectedSessionId) { loadPathForSession(selectedSessionId); } else { clearMapPath(false); clearSessionSummary(); destroyElevationChart(); enableSessionControls(false); } });

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM loaded.");
    isOnline = navigator.onLine;
    currentGpsAccuracyThreshold = parseInt(gpsAccuracyFilterInput.value, 10) || 50;
    resetLiveDataDisplays(); clearSessionSummary();
    initializeMap();
    if (!isOnline) { showError("App loaded offline."); updateStatus("Offline", true); }
    if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) { showError("Warning: HTTPS recommended."); }
    console.log("Attempting auto-connect...");
    initializeSupabase();
    checkSensorPermissions();
    updateOfflineInfo();
});

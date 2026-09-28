/**
 * map.js – kompletna logika mapy Opole Network Map
 * Obsługuje: kamery, światłowody, rysowanie, widoczność,
 * undo, usuwanie wierzchołków, okna dialogowe, uprawnienia ADMIN.
 */

// ═══════════════════════════════════════════════════════════
// 1. INICJALIZACJA
// ═══════════════════════════════════════════════════════════

// Sprawdzenie sesji
const _username = localStorage.getItem('username');
const _role     = localStorage.getItem('role');
if (!_username) { window.location.href = 'index.html'; }

const _projectIdRaw = new URLSearchParams(window.location.search).get('id');
const projectId = parseInt(_projectIdRaw, 10);
if (!projectId || isNaN(projectId)) { window.location.href = 'projects.html'; }

const isAdmin = (_role === 'ADMIN');

// Wyświetl info
document.getElementById('project-name-display').textContent = 'Projekt #' + projectId;
document.getElementById('user-chip').textContent = _username + (isAdmin ? ' · Admin' : '');

// Odkryj elementy admin-only
if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
}

// Mapa Leaflet
const map = L.map('map').setView([50.6667, 17.9222], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// ═══════════════════════════════════════════════════════════
// 2. STAN APLIKACJI
// ═══════════════════════════════════════════════════════════

// Kamery
const cameras = {};          // id -> { data, marker, visible }

// Światłowody
const fibers  = {};          // id -> { data, polyline, visible }

// Tryby rysowania
let activeMode      = null;  // 'add-camera' | 'draw-fiber' | 'append-fiber' | 'vertex-delete' | 'select-fiber'
let activeFiberId   = null;  // ID aktualnie zaznaczonego światłowodu (do edycji / dorysowywania)
let fiberDrawPoints = [];    // Punkty aktualnie rysowanej trasy
let fiberDrawLine   = null;  // Podgląd rysowanej linii
let fiberAppendOriginalPointCount = 0;
let isSavingFiber = false;
let fiberUndoStack  = {};    // id -> [ [points...], [points...], ... ]

// Dialog – stan
let cameraDialogMode = 'add'; // 'add' | 'edit'
let pendingCameraLatLng = null;
let editingCameraId = null;
let pendingCameraBase64 = null;
let existingCameraBase64 = null;

// ═══════════════════════════════════════════════════════════
// 3. UTILITIES
// ═══════════════════════════════════════════════════════════

function setStatus(msg, duration = 3000) {
    const bar = document.getElementById('status-bar');
    bar.textContent = msg;
    bar.classList.remove('hidden');
    clearTimeout(setStatus._timer);
    if (duration > 0) {
        setStatus._timer = setTimeout(() => bar.classList.add('hidden'), duration);
    }
}

function clearStatus() {
    document.getElementById('status-bar').classList.add('hidden');
}

async function ensureResponseOk(response, action) {
    if (response.ok) return;
    const details = (await response.text()).slice(0, 300);
    throw new Error(`${action}: HTTP ${response.status}${details ? ` — ${details}` : ''}`);
}

function parseCoordinate(value) {
    if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() !== '')) return null;
    const coordinate = Number(value);
    return Number.isFinite(coordinate) ? coordinate : null;
}

function getCameraCoordinates(data) {
    if (!data) return null;
    const lat = parseCoordinate(data.lat ?? data.latitude);
    const lng = parseCoordinate(data.lng ?? data.longitude);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

function setCursor(type) {
    document.body.classList.remove('map-cursor-crosshair', 'map-cursor-cell');
    if (type) document.body.classList.add('map-cursor-' + type);
}

function exitMode() {
    activeMode = null;
    activeFiberId = null;
    fiberDrawPoints = [];
    fiberAppendOriginalPointCount = 0;
    isSavingFiber = false;
    if (fiberDrawLine) { map.removeLayer(fiberDrawLine); fiberDrawLine = null; }
    setCursor(null);
    clearStatus();
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('fiber-select-overlay').classList.add('hidden');
    updateFiberDrawingControls();
    updateFiberToolStates();
}

function updateFiberDrawingControls() {
    const controls = document.getElementById('fiber-draw-controls');
    const nameLabel = document.getElementById('fiber-draw-name-label');
    const instructions = document.getElementById('fiber-draw-instructions');
    const pointCount = document.getElementById('fiber-draw-point-count');
    const finishButton = document.getElementById('btn-finish-fiber-drawing');
    const isDrawingNew = activeMode === 'draw-fiber';
    const isAppending = activeMode === 'append-fiber';
    const isDrawing = isDrawingNew || isAppending;

    controls.classList.toggle('hidden', !isDrawing);
    nameLabel.classList.toggle('hidden', !isDrawingNew);
    if (!isDrawing) return;

    instructions.textContent = isDrawingNew
        ? 'Klikaj na mapie, aby dodawać punkty trasy. Potrzebujesz co najmniej 2 punktów.'
        : 'Wybrano najbliższy koniec trasy. Klikaj na mapie, aby dorysować dalszy przebieg.';
    const addedPoints = isAppending
        ? Math.max(0, fiberDrawPoints.length - fiberAppendOriginalPointCount)
        : fiberDrawPoints.length;
    pointCount.textContent = isAppending
        ? `Dodane punkty: ${addedPoints}`
        : `Punkty trasy: ${fiberDrawPoints.length}`;
    finishButton.innerHTML = isDrawingNew
        ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Zakończ i zapisz'
        : '<i class="fa-solid fa-check" aria-hidden="true"></i> Zapisz zmiany';
    finishButton.disabled = isDrawingNew
        ? fiberDrawPoints.length < 2 || isSavingFiber
        : addedPoints < 1 || isSavingFiber;
}

/** Zapisz punkt cofania dla światłowodu */
function pushUndo(fiberId, points) {
    if (!fiberUndoStack[fiberId]) fiberUndoStack[fiberId] = [];
    fiberUndoStack[fiberId].push(JSON.parse(JSON.stringify(points)));
}

// ═══════════════════════════════════════════════════════════
// 4. ŁADOWANIE DANYCH Z BAZY
// ═══════════════════════════════════════════════════════════

async function loadProjectDataFromDatabase() {
    try {
        const [camsRes, fibsRes] = await Promise.all([
            fetch(`/api/map/cameras?projectId=${projectId}`),
            fetch(`/api/map/fibers?projectId=${projectId}`)
        ]);

        if (!camsRes.ok || !fibsRes.ok) {
            throw new Error(`Błąd pobierania danych (kamery: ${camsRes.status}, światłowody: ${fibsRes.status})`);
        }

        const camsData = await camsRes.json();
        const fibsData = await fibsRes.json();
        if (!Array.isArray(camsData) || !Array.isArray(fibsData)) {
            throw new Error('Serwer zwrócił nieprawidłowe dane mapy.');
        }

        let cameraCount = 0;
        camsData.forEach(camera => {
            try {
                if (addCameraToMap(camera)) cameraCount++;
            } catch (error) {
                console.error('Nie udało się wyświetlić kamery:', camera?.id, error);
            }
        });
        let fiberCount = 0;
        fibsData.forEach(fiber => {
            try {
                if (addFiberToMap(fiber)) fiberCount++;
            } catch (error) {
                console.error('Nie udało się wyświetlić światłowodu:', fiber?.id, error);
            }
        });

        setStatus(`Załadowano: ${cameraCount} kamer, ${fiberCount} światłowodów`, 3000);
    } catch (err) {
        console.error('Błąd ładowania danych:', err);
        setStatus('Błąd ładowania danych z bazy', 4000);
    }
}

// ═══════════════════════════════════════════════════════════
// 5. KAMERY – logika
// ═══════════════════════════════════════════════════════════

function createCameraIcon(visible = true) {
    return L.divIcon({
        className: '',
        html: `<div class="camera-icon-div${visible ? '' : ' hidden-marker'}"><i class="fa-solid fa-camera" aria-hidden="true"></i></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16]
    });
}

function addCameraToMap(data) {
    if (!data || data.id === null || data.id === undefined) {
        console.error('Pominięto kamerę bez identyfikatora.');
        return false;
    }

    const coordinates = getCameraCoordinates(data);
    if (!coordinates) {
        console.error('Pominięto kamerę z nieprawidłowymi współrzędnymi:', data.id);
        return false;
    }

    data.lat = coordinates.lat;
    data.lng = coordinates.lng;
    const visible = data.isVisible !== false;
    const marker = L.marker([coordinates.lat, coordinates.lng], {
        icon: createCameraIcon(visible)
    }).addTo(map);

    marker.on('click', () => openCameraDetailsDialog('edit', null, data.id));

    cameras[data.id] = { data, marker, visible };
    renderCamerasList();
    return true;
}

function renderCamerasList() {
    const list = document.getElementById('cameras-list');
    list.replaceChildren();
    Object.values(cameras).forEach(({ data, visible }) => {
        const item = document.createElement('div');
        item.className = 'element-item';
        item.dataset.id = data.id;

        const name = data.name || `Kamera #${data.id}`;
        const color = document.createElement('div');
        color.className = 'item-color';
        color.style.backgroundColor = '#2563eb';
        const label = document.createElement('span');
        label.className = 'item-name';
        label.title = name;
        label.textContent = name;
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        const visibilityButton = document.createElement('button');
        visibilityButton.className = `vis-btn${visible ? '' : ' hidden-icon'}`;
        visibilityButton.dataset.id = data.id;
        visibilityButton.title = visible ? 'Ukryj' : 'Pokaż';
        visibilityButton.innerHTML = visible
            ? '<i class="fa-solid fa-eye" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
        actions.appendChild(visibilityButton);
        if (isAdmin) {
            const editButton = document.createElement('button');
            editButton.className = 'vis-btn edit-cam-btn';
            editButton.dataset.id = data.id;
            editButton.title = 'Edytuj';
            editButton.textContent = '✏️';
            actions.appendChild(editButton);
        }
        item.append(color, label, actions);

        visibilityButton.addEventListener('click', e => {
            e.stopPropagation();
            toggleCameraVisibility(data.id);
        });
        item.addEventListener('click', () => {
            map.panTo([data.lat, data.lng]);
            highlightCamera(data.id);
        });
        if (isAdmin) {
            item.querySelector('.edit-cam-btn').addEventListener('click', e => {
                e.stopPropagation();
                openCameraDetailsDialog('edit', null, data.id);
            });
        }
        list.appendChild(item);
    });
}

function highlightCamera(id) {
    document.querySelectorAll('#cameras-list .element-item').forEach(el => el.classList.remove('highlighted'));
    const el = document.querySelector(`#cameras-list .element-item[data-id="${id}"]`);
    if (el) el.classList.add('highlighted');
}

function toggleCameraVisibility(id) {
    const cam = cameras[id];
    if (!cam) return;
    const previousVisible = cam.visible;
    cam.visible = !cam.visible;
    cam.data.isVisible = cam.visible;
    cam.marker.setIcon(createCameraIcon(cam.visible));
    renderCamerasList();
    if (isAdmin) persistCameraVisibility(id, previousVisible);
}

function showAllCameras() {
    Object.keys(cameras).forEach(id => {
        const cam = cameras[id];
        const previousVisible = cam.visible;
        cam.visible = true;
        cam.data.isVisible = true;
        cam.marker.setIcon(createCameraIcon(true));
        if (isAdmin && !previousVisible) persistCameraVisibility(id, previousVisible);
    });
    renderCamerasList();
}

function hideAllCameras() {
    Object.keys(cameras).forEach(id => {
        const cam = cameras[id];
        const previousVisible = cam.visible;
        cam.visible = false;
        cam.data.isVisible = false;
        cam.marker.setIcon(createCameraIcon(false));
        if (isAdmin && previousVisible) persistCameraVisibility(id, previousVisible);
    });
    renderCamerasList();
}

async function persistCameraVisibility(id, previousVisible) {
    const cam = cameras[id];
    if (!cam) return;
    try {
        const response = await fetch(`/api/map/cameras/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cam.data)
        });
        await ensureResponseOk(response, 'Aktualizacja widoczności kamery');
        cam.data = await response.json();
    } catch (error) {
        console.error('Nie udało się zapisać widoczności kamery:', error);
        cam.visible = previousVisible;
        cam.data.isVisible = previousVisible;
        cam.marker.setIcon(createCameraIcon(previousVisible));
        renderCamerasList();
        setStatus('Nie udało się zapisać widoczności kamery', 3000);
    }
}

// ── Tryb dodawania kamery ──────────────────────────────────

function handleAddCamera() {
    if (!isAdmin) return;
    if (activeMode === 'add-camera') { exitMode(); return; }
    exitMode();
    activeMode = 'add-camera';
    setCursor('crosshair');
    setStatus('Kliknij na mapę, aby dodać kamerę', 0);
    document.getElementById('btn-add-camera').classList.add('active');
}

// ── Dialog szczegółów kamery ───────────────────────────────

function openCameraDetailsDialog(mode, latlng, id) {
    cameraDialogMode = mode;
    pendingCameraBase64 = null;
    existingCameraBase64 = null;

    const dialog = document.getElementById('camera-dialog');
    const title  = document.getElementById('camera-dialog-title');
    const nameIn = document.getElementById('cam-name');
    const descIn = document.getElementById('cam-desc');
    const latEl  = document.getElementById('cam-lat-display');
    const lngEl  = document.getElementById('cam-lng-display');
    const preview = document.getElementById('cam-photo-preview');
    const placeholder = document.getElementById('cam-photo-placeholder');
    const deleteBtn = document.getElementById('cam-delete-btn');

    // Reset photo
    preview.classList.add('hidden');
    preview.src = '';
    placeholder.classList.remove('hidden');

    if (mode === 'add') {
        title.textContent = 'Nowa kamera';
        nameIn.value = '';
        descIn.value = '';
        pendingCameraLatLng = latlng;
        latEl.textContent = latlng.lat.toFixed(6);
        lngEl.textContent = latlng.lng.toFixed(6);
        editingCameraId = null;
        deleteBtn.classList.add('hidden');
    } else {
        title.textContent = 'Szczegóły kamery';
        const cam = cameras[id];
        if (!cam) return;
        nameIn.value = cam.data.name || '';
        descIn.value = cam.data.description || '';
        latEl.textContent = cam.data.lat.toFixed(6);
        lngEl.textContent = cam.data.lng.toFixed(6);
        editingCameraId = id;
        existingCameraBase64 = cam.data.photoBase64 || null;
        if (existingCameraBase64) {
            preview.src = existingCameraBase64;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        }
        if (isAdmin) deleteBtn.classList.remove('hidden');
        else deleteBtn.classList.add('hidden');
    }

    document.getElementById('cam-photo-input').value = '';
    dialog.classList.remove('hidden');
}

function closeCameraDialog() {
    document.getElementById('camera-dialog').classList.add('hidden');
}

async function saveCameraDialog() {
    const name  = document.getElementById('cam-name').value.trim();
    const desc  = document.getElementById('cam-desc').value.trim();
    const photo = pendingCameraBase64 || existingCameraBase64 || null;

    if (!name) {
        setStatus('Podaj nazwę kamery', 3000);
        document.getElementById('cam-name').focus();
        return;
    }

    if (cameraDialogMode === 'add') {
        if (!pendingCameraLatLng) {
            setStatus('Brak współrzędnych — kliknij najpierw na mapę', 3000);
            return;
        }
        const payload = {
            projectId: parseInt(projectId, 10),
            lat: pendingCameraLatLng.lat,
            lng: pendingCameraLatLng.lng,
            name,
            description: desc || null,
            photoBase64: photo,
            isVisible: true
        };
        try {
            const res = await fetch('/api/map/cameras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const txt = await res.text();
                console.error('Błąd serwera (kamera POST):', res.status, txt);
                setStatus(`Nie udało się zapisać kamery (HTTP ${res.status})`, 3000);
                return;
            }
            const saved = await res.json();
            addCameraToMap(saved);
            closeCameraDialog();
            setStatus('Kamera dodana', 2500);
        } catch (e) {
            console.error('Błąd zapisu kamery:', e);
            setStatus('Błąd zapisu kamery', 3000);
        }
    } else {
        const cam = cameras[editingCameraId];
        if (!cam) return;
        const previousData = { ...cam.data };
        cam.data.name = name;
        cam.data.description = desc || null;
        cam.data.photoBase64 = photo;

        try {
            const res = await fetch(`/api/map/cameras/${editingCameraId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cam.data)
            });
            await ensureResponseOk(res, 'Aktualizacja kamery');
            const updated = await res.json();
            cam.data = updated;
            renderCamerasList();
            closeCameraDialog();
            setStatus('Kamera zaktualizowana', 2500);
        } catch (e) {
            cam.data = previousData;
            renderCamerasList();
            console.error('Błąd aktualizacji kamery:', e);
            setStatus('Błąd aktualizacji kamery', 3000);
        }
    }
}

async function deleteCamera(id) {
    if (!isAdmin || !confirm('Czy na pewno usunąć tę kamerę?')) return;
    try {
        const response = await fetch(`/api/map/cameras/${id}`, { method: 'DELETE' });
        await ensureResponseOk(response, 'Usuwanie kamery');
        map.removeLayer(cameras[id].marker);
        delete cameras[id];
        closeCameraDialog();
        renderCamerasList();
        setStatus('Kamera usunięta', 2500);
    } catch (e) {
        console.error(e);
        setStatus('Błąd usuwania kamery', 3000);
    }
}

// ═══════════════════════════════════════════════════════════
// 6. ŚWIATŁOWODY – logika
// ═══════════════════════════════════════════════════════════

function parsePoints(pathJson) {
    let parsed;
    try {
        parsed = typeof pathJson === 'string' ? JSON.parse(pathJson) : pathJson;
    } catch (error) {
        console.error('Nieprawidłowy JSON trasy światłowodu:', error);
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const points = parsed.filter(point =>
        Array.isArray(point) && point.length === 2 &&
        (typeof point[0] === 'number' || (typeof point[0] === 'string' && point[0].trim() !== '')) &&
        (typeof point[1] === 'number' || (typeof point[1] === 'string' && point[1].trim() !== '')) &&
        Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) &&
        Number(point[0]) >= -90 && Number(point[0]) <= 90 &&
        Number(point[1]) >= -180 && Number(point[1]) <= 180
    ).map(point => [Number(point[0]), Number(point[1])]);

    if (points.length !== parsed.length || points.length < 2) {
        console.error('Pominięto trasę z pustymi lub nieprawidłowymi punktami.');
        return [];
    }
    return points;
}

function addFiberToMap(data) {
    if (!data || data.id === null || data.id === undefined) {
        console.error('Pominięto światłowód bez identyfikatora.');
        return false;
    }
    const points = parsePoints(data.pathJson);
    if (!points.length) return false;

    const visible = data.isVisible !== false;
    const color = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#0000FF';
    const requestedThickness = Number(data.thickness);
    const thickness = Number.isInteger(requestedThickness) &&
        requestedThickness >= 1 && requestedThickness <= 12 ? requestedThickness : 3;
    data.pathJson = JSON.stringify(points);
    data.color = color;
    data.thickness = thickness;
    const polyline = L.polyline(points, {
        color,
        weight: thickness,
        opacity: visible ? 1 : 0.15
    }).addTo(map);

    polyline.on('click', event => {
        if (activeMode === 'select-fiber') {
            handleFiberSelected(data.id, event.latlng);
        } else {
            openFiberDialog(data.id);
        }
    });

    // Podświetlanie przy hover
    polyline.on('mouseover', () => highlightFiber(data.id));
    polyline.on('mouseout', () => {
        document.querySelectorAll('#fibers-list .element-item').forEach(el => el.classList.remove('highlighted'));
    });

    fibers[data.id] = { data, polyline, visible };
    fiberUndoStack[data.id] = [];
    renderFibersList();
    return true;
}

function refreshFiberPolyline(id) {
    const fb = fibers[id];
    if (!fb) return;
    const points = parsePoints(fb.data.pathJson);
    if (points.length < 2) return;
    if (fb.polyline) {
        fb.polyline.setLatLngs(points);
        fb.polyline.setStyle({
            color: fb.data.color || '#0000FF',
            weight: fb.data.thickness || 3,
            opacity: fb.visible ? 1 : 0.15
        });
    }
}

function renderFibersList() {
    const list = document.getElementById('fibers-list');
    list.replaceChildren();
    Object.values(fibers).forEach(({ data, visible }) => {
        const item = document.createElement('div');
        item.className = 'element-item';
        item.dataset.id = data.id;
        const name = data.name || `Światłowód #${data.id}`;
        const color = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#0000FF';
        const colorSwatch = document.createElement('div');
        colorSwatch.className = 'item-color';
        colorSwatch.style.cssText = 'border-radius:2px;width:14px;height:6px;';
        colorSwatch.style.backgroundColor = color;
        const label = document.createElement('span');
        label.className = 'item-name';
        label.title = name;
        label.textContent = name;
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        const visibilityButton = document.createElement('button');
        visibilityButton.className = `vis-btn${visible ? '' : ' hidden-icon'}`;
        visibilityButton.dataset.id = data.id;
        visibilityButton.title = visible ? 'Ukryj' : 'Pokaż';
        visibilityButton.innerHTML = visible
            ? '<i class="fa-solid fa-eye" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
        actions.appendChild(visibilityButton);
        if (isAdmin) {
            const editButton = document.createElement('button');
            editButton.className = 'vis-btn edit-fiber-btn';
            editButton.dataset.id = data.id;
            editButton.title = 'Edytuj';
            editButton.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
            actions.appendChild(editButton);
        }
        item.append(colorSwatch, label, actions);

        visibilityButton.addEventListener('click', e => {
            e.stopPropagation();
            toggleFiberVisibility(data.id);
        });
        item.addEventListener('click', () => {
            const pts = parsePoints(data.pathJson);
            if (pts.length) map.fitBounds(L.polyline(pts).getBounds(), { padding: [40, 40] });
            highlightFiber(data.id);
        });
        if (isAdmin) {
            item.querySelector('.edit-fiber-btn').addEventListener('click', e => {
                e.stopPropagation();
                openFiberDialog(data.id);
            });
        }
        list.appendChild(item);
    });
}

function highlightFiber(id) {
    document.querySelectorAll('#fibers-list .element-item').forEach(el => el.classList.remove('highlighted'));
    const el = document.querySelector(`#fibers-list .element-item[data-id="${id}"]`);
    if (el) el.classList.add('highlighted');
}

function toggleFiberVisibility(id) {
    const fb = fibers[id];
    if (!fb) return;
    const previousVisible = fb.visible;
    fb.visible = !fb.visible;
    fb.data.isVisible = fb.visible;
    if (fb.polyline) fb.polyline.setStyle({ opacity: fb.visible ? 1 : 0.15 });
    renderFibersList();
    if (isAdmin) persistFiberVisibility(id, previousVisible);
}

function showAllFibers() {
    Object.keys(fibers).forEach(id => {
        const fb = fibers[id];
        const previousVisible = fb.visible;
        fb.visible = true;
        fb.data.isVisible = true;
        if (fb.polyline) fb.polyline.setStyle({ opacity: 1 });
        if (isAdmin && !previousVisible) persistFiberVisibility(id, previousVisible);
    });
    renderFibersList();
}

function hideAllFibers() {
    Object.keys(fibers).forEach(id => {
        const fb = fibers[id];
        const previousVisible = fb.visible;
        fb.visible = false;
        fb.data.isVisible = false;
        if (fb.polyline) fb.polyline.setStyle({ opacity: 0.15 });
        if (isAdmin && previousVisible) persistFiberVisibility(id, previousVisible);
    });
    renderFibersList();
}

async function persistFiberVisibility(id, previousVisible) {
    const fb = fibers[id];
    if (!fb) return;
    try {
        const response = await fetch(`/api/map/fibers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fb.data)
        });
        await ensureResponseOk(response, 'Aktualizacja widoczności światłowodu');
        fb.data = await response.json();
    } catch (error) {
        console.error('Nie udało się zapisać widoczności światłowodu:', error);
        fb.visible = previousVisible;
        fb.data.isVisible = previousVisible;
        if (fb.polyline) fb.polyline.setStyle({ opacity: previousVisible ? 1 : 0.15 });
        renderFibersList();
        setStatus('Nie udało się zapisać widoczności światłowodu', 3000);
    }
}

// ── Rysowanie nowego światłowodu ───────────────────────────

function handleAddFiber() {
    if (!isAdmin) return;
    if (activeMode === 'draw-fiber') {
        setStatus('Dodaj kolejne punkty albo zakończ rysowanie przyciskiem w panelu.', 3000);
        return;
    }
    exitMode();
    activeMode = 'draw-fiber';
    fiberDrawPoints = [];
    setCursor('crosshair');
    document.getElementById('fiber-draw-name').value = '';
    setStatus('Rysowanie światłowodu: dodaj minimum 2 punkty, a następnie zakończ przyciskiem w panelu.', 0);
    document.getElementById('btn-add-fiber').classList.add('active');
    updateFiberDrawingControls();
}

function addDrawPoint(latlng) {
    const previous = fiberDrawPoints[fiberDrawPoints.length - 1];
    if (previous && map.distance(L.latLng(previous), latlng) < 0.1) return;
    fiberDrawPoints.push([latlng.lat, latlng.lng]);
    if (fiberDrawLine) map.removeLayer(fiberDrawLine);
    if (fiberDrawPoints.length > 1) {
        fiberDrawLine = L.polyline(fiberDrawPoints, { color: '#facc15', weight: 3, dashArray: '6,4' }).addTo(map);
    }
    updateFiberDrawingControls();
}

function appendRoutePoint(latlng) {
    const previous = fiberDrawPoints[fiberDrawPoints.length - 1];
    if (previous && map.distance(L.latLng(previous), latlng) < 0.1) return;
    fiberDrawPoints.push([latlng.lat, latlng.lng]);
    if (fiberDrawLine) map.removeLayer(fiberDrawLine);
    const color = activeFiberId && fibers[activeFiberId]
        ? fibers[activeFiberId].data.color
        : '#facc15';
    fiberDrawLine = L.polyline(fiberDrawPoints, {
        color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#facc15',
        weight: 3,
        dashArray: '6,4'
    }).addTo(map);
    updateFiberDrawingControls();
}

async function finishFiberDrawing() {
    if (isSavingFiber) return;
    if (fiberDrawPoints.length < 2) {
        setStatus('Dodaj co najmniej 2 punkty przed zapisaniem światłowodu.', 3000);
        return;
    }

    const nameInput = document.getElementById('fiber-draw-name');
    const name = nameInput.value.trim();
    if (!name.trim()) {
        setStatus('Wpisz nazwę światłowodu w panelu bocznym, aby go zapisać.', 3000);
        nameInput.focus();
        return;
    }

    const pts = fiberDrawPoints.map(point => [...point]);

    const payload = {
        projectId: parseInt(projectId, 10),
        name: name.trim(),
        pathJson: JSON.stringify(pts),
        color: '#0000FF',
        thickness: 3,
        isVisible: true
    };

    try {
        isSavingFiber = true;
        updateFiberDrawingControls();
        const res = await fetch('/api/map/fibers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const txt = await res.text();
            console.error('Błąd serwera (fiber POST):', res.status, txt);
            setStatus(`Nie udało się zapisać światłowodu (HTTP ${res.status})`, 3000);
            isSavingFiber = false;
            updateFiberDrawingControls();
            return;
        }
        const saved = await res.json();
        exitMode();
        addFiberToMap(saved);
        setStatus('Światłowód zapisany', 2500);
    } catch (e) {
        console.error('Błąd zapisu światłowodu:', e);
        setStatus('Błąd zapisu. Trasa pozostała na mapie — spróbuj ponownie.', 4000);
        isSavingFiber = false;
        updateFiberDrawingControls();
    }
}

// ── Dorysowywanie od końca ─────────────────────────────────

function handleAppendFromEnd() {
    if (!isAdmin) return;
    exitMode();
    activeMode = 'select-fiber';
    document.getElementById('fiber-select-overlay').classList.remove('hidden');
    document.getElementById('fiber-select-msg').textContent = 'Kliknij linię blisko końca, od którego chcesz dorysować';
    document.getElementById('btn-append-fiber').classList.add('active');
}

function enableFiberEndPointsSelection(id, clickedLatLng) {
    activeFiberId = id;
    activeMode = 'append-fiber';
    const fb = fibers[id];
    if (!fb) {
        exitMode();
        setStatus('Nie znaleziono światłowodu', 3000);
        return;
    }
    const pts = parsePoints(fb.data.pathJson);
    if (pts.length < 2) {
        exitMode();
        setStatus('Nie można edytować światłowodu bez poprawnych punktów', 3000);
        return;
    }
    const distanceToStart = map.distance(clickedLatLng, L.latLng(pts[0]));
    const distanceToEnd = map.distance(clickedLatLng, L.latLng(pts[pts.length - 1]));
    const appendFromStart = distanceToStart < distanceToEnd;
    const orderedPoints = appendFromStart ? [...pts].reverse() : pts;
    fiberAppendOriginalPointCount = orderedPoints.length;
    fiberDrawPoints = orderedPoints.map(point => [...point]);

    document.getElementById('fiber-select-overlay').classList.add('hidden');
    setCursor('crosshair');
    setStatus(`Dorysowywanie od ${appendFromStart ? 'początku' : 'końca'} trasy. Zakończ przyciskiem „Zapisz zmiany” w panelu.`, 0);
    if (fiberDrawLine) map.removeLayer(fiberDrawLine);
    fiberDrawLine = L.polyline(fiberDrawPoints, { color: fibers[id].data.color || '#facc15', weight: 3, dashArray: '6,4' }).addTo(map);
    updateFiberDrawingControls();
}

async function finishAppendFiber() {
    if (isSavingFiber) return;
    if (!activeFiberId) return;
    const fiberId = activeFiberId;
    const fb = fibers[fiberId];
    if (!fb || fiberDrawPoints.length <= fiberAppendOriginalPointCount) {
        setStatus('Dodaj co najmniej 1 nowy punkt przed zapisaniem zmian.', 3000);
        return;
    }
    const previousData = { ...fb.data };
    fb.data.pathJson = JSON.stringify(fiberDrawPoints);

    try {
        isSavingFiber = true;
        updateFiberDrawingControls();
        const res = await fetch(`/api/map/fibers/${fiberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fb.data)
        });
        await ensureResponseOk(res, 'Dorysowywanie światłowodu');
        const updated = await res.json();
        pushUndo(fiberId, parsePoints(previousData.pathJson));
        fb.data = updated;
        refreshFiberPolyline(fiberId);
        exitMode();
        setStatus('Trasa zaktualizowana', 2500);
    } catch (e) {
        fb.data = previousData;
        refreshFiberPolyline(fiberId);
        console.error('Błąd edycji światłowodu:', e);
        isSavingFiber = false;
        updateFiberDrawingControls();
        setStatus('Błąd zapisu. Dorysowana trasa pozostała — spróbuj ponownie.', 4000);
    }
}

function handleFiberSelected(id, clickedLatLng) {
    // Wywoływane po kliknięciu na światłowód w trybie select-fiber
    if (activeMode === 'select-fiber') {
        // Sprawdź jaka akcja czeka
        const pendingAction = document.querySelector('.tool-btn.active')?.id;
        if (pendingAction === 'btn-append-fiber') {
            enableFiberEndPointsSelection(id, clickedLatLng);
        } else if (pendingAction === 'btn-vertex-delete') {
            enableVertexDeletion(id);
        }
    }
}

// ── Undo ───────────────────────────────────────────────────

async function undoLastFiberChange(id) {
    if (!id) { setStatus('Zaznacz światłowód aby cofnąć', 2000); return; }
    const stack = fiberUndoStack[id];
    if (!stack || !stack.length) { setStatus('Brak historii do cofnięcia', 2000); return; }

    const fb = fibers[id];
    if (!fb) return;
    const previousPathJson = fb.data.pathJson;
    fb.data.pathJson = JSON.stringify(stack[stack.length - 1]);

    try {
        const res = await fetch(`/api/map/fibers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fb.data)
        });
        await ensureResponseOk(res, 'Cofanie zmiany światłowodu');
        const updated = await res.json();
        fb.data = updated;
        stack.pop();
        refreshFiberPolyline(id);
        setStatus('Cofnięto zmianę', 2000);
    } catch (e) {
        fb.data.pathJson = previousPathJson;
        console.error('Błąd cofania zmiany światłowodu:', e);
        setStatus('Błąd cofania zmiany', 3000);
    }
}

// ── Usuwanie wierzchołków ──────────────────────────────────

let vertexMarkers = [];

function handleEnableVertexDeletion() {
    if (!isAdmin) return;
    exitMode();
    activeMode = 'select-fiber';
    document.getElementById('fiber-select-overlay').classList.remove('hidden');
    document.getElementById('fiber-select-msg').textContent = 'Kliknij na światłowód, aby wybrać wierzchołki do usunięcia';
    document.getElementById('btn-vertex-delete').classList.add('active');
}

function enableVertexDeletion(id) {
    activeFiberId = id;
    activeMode = 'vertex-delete';
    document.getElementById('fiber-select-overlay').classList.add('hidden');

    const fb = fibers[id];
    if (!fb) {
        exitMode();
        setStatus('Nie znaleziono światłowodu', 3000);
        return;
    }
    const pts = parsePoints(fb.data.pathJson);
    if (pts.length < 2) {
        exitMode();
        setStatus('Nie można edytować światłowodu bez poprawnych punktów', 3000);
        return;
    }
    pushUndo(id, pts);

    setStatus('Kliknij wierzchołek, aby go usunąć. Naciśnij Escape, aby zakończyć.', 0);

    // Narysuj wierzchołki jako okręgi
    vertexMarkers.forEach(m => map.removeLayer(m));
    vertexMarkers = [];

    pts.forEach((pt, idx) => {
        const circle = L.circleMarker(pt, {
            radius: 8, color: '#ef4444', fillColor: '#fca5a5',
            fillOpacity: 0.9, weight: 2
        }).addTo(map);
        circle.on('click', () => removeFiberVertex(id, idx));
        vertexMarkers.push(circle);
    });
}

async function removeFiberVertex(fiberId, vertexIndex) {
    const fb = fibers[fiberId];
    const pts = parsePoints(fb.data.pathJson);
    if (pts.length <= 2) { setStatus('Minimum 2 punkty', 2000); return; }

    const previousPathJson = fb.data.pathJson;
    pts.splice(vertexIndex, 1);
    fb.data.pathJson = JSON.stringify(pts);

    try {
        const res = await fetch(`/api/map/fibers/${fiberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fb.data)
        });
        await ensureResponseOk(res, 'Usuwanie wierzchołka');
        const updated = await res.json();
        fb.data = updated;
        refreshFiberPolyline(fiberId);
        // Odśwież wierzchołki
        enableVertexDeletion(fiberId);
        setStatus('Usunięto wierzchołek', 2000);
    } catch (e) {
        fb.data.pathJson = previousPathJson;
        refreshFiberPolyline(fiberId);
        console.error('Błąd usuwania wierzchołka:', e);
        setStatus('Błąd usuwania wierzchołka', 3000);
    }
}

function clearVertexMarkers() {
    vertexMarkers.forEach(m => map.removeLayer(m));
    vertexMarkers = [];
}

// ═══════════════════════════════════════════════════════════
// 7. DIALOG EDYCJI ŚWIATŁOWODU
// ═══════════════════════════════════════════════════════════

let editingFiberId = null;

function openFiberDialog(id) {
    if (!fibers[id]) {
        setStatus('Nie znaleziono światłowodu', 3000);
        return;
    }
    editingFiberId = id;
    const fb = fibers[id];
    document.getElementById('fiber-name').value = fb.data.name || '';
    const color = fb.data.color || '#0000FF';
    document.getElementById('fiber-color').value = color;
    document.getElementById('fiber-color-picker').value = color;
    document.getElementById('fiber-thickness').value = fb.data.thickness || 3;

    const delBtn = document.getElementById('fiber-delete-btn');
    if (isAdmin) delBtn.classList.remove('hidden');
    else delBtn.classList.add('hidden');

    document.getElementById('fiber-dialog').classList.remove('hidden');
}

function closeFiberDialog() {
    document.getElementById('fiber-dialog').classList.add('hidden');
    editingFiberId = null;
}

async function editFiberData() {
    if (!editingFiberId) return;
    const fb = fibers[editingFiberId];
    const name      = document.getElementById('fiber-name').value.trim();
    const color     = document.getElementById('fiber-color').value.trim() || '#0000FF';
    const thickness = Number(document.getElementById('fiber-thickness').value);
    if (!name || !/^#[0-9a-fA-F]{6}$/.test(color) ||
        !Number.isInteger(thickness) || thickness < 1 || thickness > 12) {
        setStatus('Podaj nazwę, prawidłowy kolor HEX i grubość od 1 do 12 px', 3500);
        return;
    }

    const previousData = { ...fb.data };
    const fiberId = editingFiberId;
    fb.data.name = name;
    fb.data.color = color;
    fb.data.thickness = thickness;

    try {
        const res = await fetch(`/api/map/fibers/${fiberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fb.data)
        });
        await ensureResponseOk(res, 'Aktualizacja światłowodu');
        const updated = await res.json();
        fb.data = updated;
        refreshFiberPolyline(fiberId);
        renderFibersList();
        closeFiberDialog();
        setStatus('Parametry zaktualizowane', 2500);
    } catch (e) {
        fb.data = previousData;
        refreshFiberPolyline(fiberId);
        renderFibersList();
        console.error('Błąd aktualizacji światłowodu:', e);
        setStatus('Błąd aktualizacji światłowodu', 3000);
    }
}

async function deleteFiber(id) {
    if (!isAdmin || !confirm('Czy na pewno usunąć ten światłowód?')) return;
    try {
        const response = await fetch(`/api/map/fibers/${id}`, { method: 'DELETE' });
        await ensureResponseOk(response, 'Usuwanie światłowodu');
        if (fibers[id].polyline) map.removeLayer(fibers[id].polyline);
        delete fibers[id];
        delete fiberUndoStack[id];
        closeFiberDialog();
        renderFibersList();
        setStatus('Światłowód usunięty', 2500);
    } catch (e) {
        console.error(e);
        setStatus('Błąd usuwania światłowodu', 3000);
    }
}

function updateFiberToolStates() {
    if (!isAdmin) return;
    const hasFibers = Object.keys(fibers).length > 0;
    document.getElementById('btn-append-fiber').disabled = !hasFibers;
    document.getElementById('btn-vertex-delete').disabled = !hasFibers;
    document.getElementById('btn-undo-fiber').disabled = !hasFibers;
    document.getElementById('btn-edit-fiber').disabled = !hasFibers;
}

// ═══════════════════════════════════════════════════════════
// 8. OBSŁUGA KLIKNIĘĆ NA MAPIE
// ═══════════════════════════════════════════════════════════

map.on('click', function(e) {
    if (activeMode === 'add-camera') {
        openCameraDetailsDialog('add', e.latlng, null);
        exitMode();
    } else if (activeMode === 'draw-fiber') {
        addDrawPoint(e.latlng);
    } else if (activeMode === 'append-fiber') {
        appendRoutePoint(e.latlng);
    }
});

map.on('dblclick', function(e) {
    L.DomEvent.stop(e);
    if (activeMode === 'draw-fiber') {
        addDrawPoint(e.latlng);
        finishFiberDrawing();
    } else if (activeMode === 'append-fiber') {
        appendRoutePoint(e.latlng);
        finishAppendFiber();
    }
});

// Escape – wyjście z trybu
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (activeMode === 'vertex-delete') clearVertexMarkers();
        exitMode();
    }
});

// ═══════════════════════════════════════════════════════════
// 9. PODPIĘCIE PRZYCISKÓW
// ═══════════════════════════════════════════════════════════

// Sidebar toggle
document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    map.invalidateSize();
});

// Wróć do projektów
document.getElementById('back-to-projects').addEventListener('click', () => {
    window.location.href = 'projects.html';
});

// Zakładki
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// ── Kamery ────────────────────────────────────────────────
document.getElementById('btn-add-camera').addEventListener('click', handleAddCamera);
document.getElementById('show-all-cameras').addEventListener('click', showAllCameras);
document.getElementById('hide-all-cameras').addEventListener('click', hideAllCameras);

// Dialog kamery
document.getElementById('close-camera-dialog').addEventListener('click', closeCameraDialog);
document.getElementById('close-camera-dialog-2').addEventListener('click', closeCameraDialog);
document.getElementById('cam-save-btn').addEventListener('click', saveCameraDialog);
document.getElementById('cam-delete-btn').addEventListener('click', () => deleteCamera(editingCameraId));

// Zdjęcie
document.getElementById('cam-photo-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        setStatus('Wybierz PNG, JPEG lub WebP o rozmiarze do 5 MB', 4000);
        e.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
        pendingCameraBase64 = ev.target.result;
        document.getElementById('cam-photo-preview').src = pendingCameraBase64;
        document.getElementById('cam-photo-preview').classList.remove('hidden');
        document.getElementById('cam-photo-placeholder').classList.add('hidden');
    };
    reader.onerror = () => setStatus('Nie udało się odczytać zdjęcia', 3000);
    reader.readAsDataURL(file);
});

document.getElementById('cam-photo-clear').addEventListener('click', () => {
    pendingCameraBase64 = null;
    existingCameraBase64 = null;
    document.getElementById('cam-photo-preview').classList.add('hidden');
    document.getElementById('cam-photo-preview').src = '';
    document.getElementById('cam-photo-placeholder').classList.remove('hidden');
    document.getElementById('cam-photo-input').value = '';
});

// ── Światłowody ───────────────────────────────────────────
document.getElementById('btn-add-fiber').addEventListener('click', handleAddFiber);
document.getElementById('btn-append-fiber').addEventListener('click', handleAppendFromEnd);
document.getElementById('btn-finish-fiber-drawing').addEventListener('click', () => {
    if (activeMode === 'draw-fiber') finishFiberDrawing();
    else if (activeMode === 'append-fiber') finishAppendFiber();
});
document.getElementById('btn-cancel-fiber-drawing').addEventListener('click', () => {
    exitMode();
    setStatus('Rysowanie światłowodu anulowane', 2500);
});
document.getElementById('fiber-draw-name').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        finishFiberDrawing();
    }
});
document.getElementById('btn-vertex-delete').addEventListener('click', handleEnableVertexDeletion);
document.getElementById('btn-undo-fiber').addEventListener('click', () => {
    // Cofnij dla ostatnio edytowanego lub zaznaczonego
    const id = activeFiberId || editingFiberId;
    undoLastFiberChange(id);
});
document.getElementById('btn-edit-fiber').addEventListener('click', () => {
    if (editingFiberId || activeFiberId) {
        openFiberDialog(editingFiberId || activeFiberId);
    } else {
        // Tryb wyboru
        exitMode();
        activeMode = 'select-fiber';
        document.getElementById('fiber-select-overlay').classList.remove('hidden');
        document.getElementById('fiber-select-msg').textContent = 'Kliknij na światłowód, aby edytować parametry';
        document.getElementById('btn-edit-fiber').classList.add('active');
        // Override handleFiberSelected dla tego trybu
    }
});

document.getElementById('show-all-fibers').addEventListener('click', showAllFibers);
document.getElementById('hide-all-fibers').addEventListener('click', hideAllFibers);

// Dialog światłowodu
document.getElementById('close-fiber-dialog').addEventListener('click', closeFiberDialog);
document.getElementById('close-fiber-dialog-2').addEventListener('click', closeFiberDialog);
document.getElementById('fiber-save-btn').addEventListener('click', editFiberData);
document.getElementById('fiber-delete-btn').addEventListener('click', () => deleteFiber(editingFiberId));

// Sync kolor HEX <-> color picker
document.getElementById('fiber-color-picker').addEventListener('input', e => {
    document.getElementById('fiber-color').value = e.target.value;
});
document.getElementById('fiber-color').addEventListener('input', e => {
    const hex = e.target.value;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        document.getElementById('fiber-color-picker').value = hex;
    }
});

// Anuluj wybór światłowodu
document.getElementById('cancel-fiber-select').addEventListener('click', exitMode);

// (handleFiberSelected jest zdefiniowane wcześniej i obsługuje wszystkie tryby)

// ═══════════════════════════════════════════════════════════
// 10. SYNCHRONIZACJA LISTY (syncElements – JavaBridge compat)
// ═══════════════════════════════════════════════════════════

/**
 * syncElements – publiczne API do synchronizacji elementów
 * (może być wywołane przez zewnętrzny kod lub JavaBridge)
 */
window.syncElements = function(type, dataArray) {
    if (!Array.isArray(dataArray)) {
        console.error('Pominięto synchronizację mapy: oczekiwano tablicy elementów.');
        return;
    }
    if (type === 'cameras') {
        dataArray.forEach(c => {
            try {
                if (!c || c.id === null || c.id === undefined) return;
                const existing = cameras[c.id];
                const data = existing ? { ...existing.data, ...c } : { ...c };
                const coordinates = getCameraCoordinates(data);
                if (!coordinates) {
                    console.error('Pominięto synchronizację kamery z nieprawidłowymi współrzędnymi:', c.id);
                    return;
                }
                data.lat = coordinates.lat;
                data.lng = coordinates.lng;
                if (existing) {
                    existing.data = data;
                    existing.visible = data.isVisible !== false;
                    existing.marker.setLatLng([coordinates.lat, coordinates.lng]);
                    existing.marker.setIcon(createCameraIcon(existing.visible));
                } else {
                    addCameraToMap(data);
                }
            } catch (error) {
                console.error('Nie udało się zsynchronizować kamery:', c?.id, error);
            }
        });
        renderCamerasList();
    } else if (type === 'fibers') {
        dataArray.forEach(f => {
            try {
                if (!f || f.id === null || f.id === undefined) return;
                const existing = fibers[f.id];
                const data = existing ? { ...existing.data, ...f } : { ...f };
                const points = parsePoints(data.pathJson);
                if (points.length < 2) {
                    console.error('Pominięto synchronizację światłowodu z nieprawidłową trasą:', f.id);
                    return;
                }
                data.pathJson = JSON.stringify(points);
                if (existing) {
                    existing.data = data;
                    existing.visible = data.isVisible !== false;
                    refreshFiberPolyline(f.id);
                } else {
                    addFiberToMap(data);
                }
            } catch (error) {
                console.error('Nie udało się zsynchronizować światłowodu:', f?.id, error);
            }
        });
        renderFibersList();
    }
};

// ═══════════════════════════════════════════════════════════
// 11. START
// ═══════════════════════════════════════════════════════════
loadProjectDataFromDatabase();
updateFiberToolStates();

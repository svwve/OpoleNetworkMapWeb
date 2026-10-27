/**
 * map.js – kompletna logika mapy Opole Network Map
 * Obsługuje: kamery, światłowody, rysowanie, widoczność,
 * undo, usuwanie wierzchołków, okna dialogowe, uprawnienia ADMIN.
 */

// ═══════════════════════════════════════════════════════════
// 1. INICJALIZACJA
// ═══════════════════════════════════════════════════════════

// Sprawdzenie sesji
let _username = '';
let _role = '';
let isAdmin = false;

const projectParams = new URLSearchParams(window.location.search);
const _projectIdRaw = projectParams.get('projectId') ?? projectParams.get('id');
const requestedProjectId = _projectIdRaw === null ? null : Number(_projectIdRaw);
let projectId = null;

// Wyświetl info
document.getElementById('project-name-display').textContent = 'Ładowanie projektu…';

// Mapa Leaflet
const BASE_STYLE_ZOOM = 13;
const map = L.map('map', { preferCanvas: true }).setView([50.6667, 17.9222], BASE_STYLE_ZOOM);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// ═══════════════════════════════════════════════════════════
// 2. STAN APLIKACJI
// ═══════════════════════════════════════════════════════════

// Kamery
const cameras = {};          // id -> { data, marker, visible }
const radios = {};           // id -> { data, marker, visible }

// Światłowody
const fibers = {};          // id -> { data, polyline, visible }

// Tryby rysowania
let activeMode = null;  // 'add-camera' | 'draw-fiber' | 'append-fiber' | 'select-fiber' | 'select-fiber-end' | 'vertex-delete'
let activeFiberId = null;  // ID aktualnie zaznaczonego światłowodu (do edycji / dorysowywania)
let fiberDrawPoints = [];    // Punkty aktualnie rysowanej trasy
let fiberDrawLine = null;  // Podgląd rysowanej linii
let fiberAppendOriginalPointCount = 0;
let fiberAppendFromStart = false;
let fiberAppendEndpointMarkers = [];
let isSavingFiber = false;
let fiberUndoStack = {};    // id -> [ [points...], [points...], ... ]

// Dialog – stan
let cameraDialogMode = 'add'; // 'add' | 'edit'
let dialogDeviceType = 'camera';
let pendingCameraLatLng = null;
let editingDeviceId = null;
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
    const body = await response.text();
    let details = body;
    try {
        const errorBody = JSON.parse(body);
        details = errorBody.error || errorBody.message || body;
    } catch {
        // Keep the original response body when it is not JSON.
    }
    throw new Error(`${action}: HTTP ${response.status}${details ? ` — ${details.slice(0, 300)}` : ''}`);
}

function isValidProjectId(id) {
    const value = Number(id);
    return Number.isSafeInteger(value) && value > 0;
}

async function resolveActiveProject() {
    if (isValidProjectId(requestedProjectId)) {
        try {
            const response = await apiFetch(`/api/projects/${requestedProjectId}`);
            if (response.status === 401) {
                throw new Error('Sesja wygasła. Zaloguj się ponownie.');
            }
            if (response.ok) {
                const project = await response.json();
                if (project && isValidProjectId(project.id)) return project;
            }
        } catch (error) {
            if (error.message.includes('Sesja wygasła')) throw error;
            console.warn(`Nie udało się pobrać projektu ${requestedProjectId}; wybieram projekt domyślny.`, error);
        }
    }

    const projectsResponse = await apiFetch('/api/projects');
    await ensureResponseOk(projectsResponse, 'Pobieranie projektów');
    const projects = await projectsResponse.json();
    if (!Array.isArray(projects)) {
        throw new Error('Serwer zwrócił nieprawidłową listę projektów.');
    }

    const firstProject = projects.find(project => project && isValidProjectId(project.id));
    if (firstProject) return firstProject;

    const initializeResponse = await apiFetch('/api/projects/initialize', { method: 'POST' });
    await ensureResponseOk(initializeResponse, 'Inicjalizacja projektu Opole');
    const initializedProject = await initializeResponse.json();
    if (!initializedProject || !isValidProjectId(initializedProject.id)) {
        throw new Error('Serwer nie zwrócił prawidłowego ID projektu Opole.');
    }
    return initializedProject;
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
    fiberAppendFromStart = false;
    isSavingFiber = false;
    if (fiberDrawLine) { map.removeLayer(fiberDrawLine); fiberDrawLine = null; }
    clearFiberAppendEndpointMarkers();
    clearVertexMarkers();
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
        : 'Kliknij mapę, aby dorysować trasę od wybranego końca. Zapisz zmiany przyciskiem poniżej.';
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
        const sessionResponse = await apiFetch('/api/auth/session');
        if (!sessionResponse.ok) {
            throw new Error(`HTTP ${sessionResponse.status}`);
        }
        const session = await sessionResponse.json();
        if (!session.success) {
            localStorage.removeItem('username');
            localStorage.removeItem('role');
            window.location.replace('index.html');
            return;
        }
        _username = session.username;
        _role = session.role;
        isAdmin = _role === 'ADMIN';
        localStorage.setItem('username', _username);
        localStorage.setItem('role', _role);
        document.getElementById('user-chip').textContent = _username + (isAdmin ? ' · Admin' : '');
        document.querySelectorAll('.admin-only').forEach(element => {
            element.classList.toggle('hidden', !isAdmin);
        });
    } catch (error) {
        console.error('Nie udało się zweryfikować sesji:', error);
        setStatus('Sesja wygasła. Zaloguj się ponownie.', 4000);
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        window.location.replace('index.html');
        return;
    }

    try {
        const project = await resolveActiveProject();
        projectId = Number(project.id);
        document.getElementById('project-name-display').textContent =
            project.name || `Projekt #${projectId}`;
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete('id');
        currentUrl.searchParams.set('projectId', String(projectId));
        window.history.replaceState(null, '', currentUrl);
    } catch (error) {
        console.error('Nie udało się ustalić aktywnego projektu:', error);
        setStatus(`Nie udało się załadować projektu: ${error.message}`, 8000);
        return;
    }

    const collections = [
        { type: 'camera', url: `/api/map/cameras?projectId=${projectId}`, label: 'kamery' },
        { type: 'radio', url: `/api/map/radios?projectId=${projectId}`, label: 'radia' },
        { type: 'fiber', url: `/api/map/fibers?projectId=${projectId}`, label: 'światłowody' }
    ];
    const results = await Promise.all(collections.map(async collection => {
        try {
            const response = await apiFetch(collection.url);
            await ensureResponseOk(response, `Pobieranie ${collection.label}`);
            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error(`Serwer zwrócił nieprawidłową listę: ${collection.label}`);
            }
            return { ...collection, data, error: null };
        } catch (error) {
            console.error(`Nie udało się pobrać ${collection.label}:`, error);
            return { ...collection, data: [], error };
        }
    }));

    let cameraCount = 0;
    let radioCount = 0;
    let fiberCount = 0;
    results.forEach(({ type, data }) => {
        if (type === 'camera') {
            data.forEach(camera => {
                try {
                    if (addCameraToMap(camera, false)) cameraCount++;
                } catch (error) {
                    console.error('Nie udało się wyświetlić kamery:', camera?.id, error);
                }
            });
        } else if (type === 'radio') {
            data.forEach(radio => {
                try {
                    if (addDeviceToMap('radio', radio, false)) radioCount++;
                } catch (error) {
                    console.error('Nie udało się wyświetlić radia:', radio?.id, error);
                }
            });
        } else {
            data.forEach(fiber => {
                try {
                    if (addFiberToMap(fiber, false)) fiberCount++;
                } catch (error) {
                    console.error('Nie udało się wyświetlić światłowodu:', fiber?.id, error);
                }
            });
        }
    });

    renderCamerasList();
    renderRadiosList();
    renderFibersList();
    updateFiberToolStates();
    const failedCollections = results.filter(result => result.error).map(result => result.label);
    if (failedCollections.length) {
        setStatus(`Nie udało się pobrać: ${failedCollections.join(', ')}. Pozostałe warstwy załadowano.`, 6000);
    } else {
        setStatus(`Załadowano: ${cameraCount} kamer, ${radioCount} urządzeń radiowych, ${fiberCount} światłowodów`, 3000);
    }
}

// ═══════════════════════════════════════════════════════════
// 5. KAMERY – logika
// ═══════════════════════════════════════════════════════════

function getDeviceIconSize() {
    const zoomOutScale = Math.sqrt(map.getZoomScale(BASE_STYLE_ZOOM, map.getZoom()));
    return Math.round(Math.max(12, Math.min(20, 13 * zoomOutScale)));
}

function createDeviceIcon(type, visible = true) {
    const size = getDeviceIconSize();
    const icon = type === 'radio' ? 'fa-tower-broadcast' : 'fa-camera';
    const deviceClass = type === 'radio' ? 'radio-icon-div' : '';
    return L.divIcon({
        className: '',
        html: `<div class="camera-icon-div ${deviceClass}${visible ? '' : ' hidden-marker'}" style="--device-icon-size:${size}px;--device-icon-font-size:${Math.round(size / 2)}px"><i class="fa-solid ${icon}" aria-hidden="true"></i></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -Math.round(size * 0.57)]
    });
}

function createCameraIcon(visible = true) {
    return createDeviceIcon('camera', visible);
}

function addCameraToMap(data, render = true) {
    return addDeviceToMap('camera', data, render);
}

function addDeviceToMap(type, data, render = true) {
    if (!data || data.id === null || data.id === undefined) {
        console.error(`Pominięto ${type === 'radio' ? 'radio' : 'kamerę'} bez identyfikatora.`);
        return false;
    }

    const coordinates = getCameraCoordinates(data);
    if (!coordinates) {
        console.error(`Pominięto ${type === 'radio' ? 'radio' : 'kamerę'} z nieprawidłowymi współrzędnymi:`, data.id);
        return false;
    }

    data.lat = coordinates.lat;
    data.lng = coordinates.lng;
    const visible = data.isVisible !== false;
    const collection = type === 'radio' ? radios : cameras;
    const marker = L.marker([coordinates.lat, coordinates.lng], {
        icon: createDeviceIcon(type, visible)
    }).addTo(map);

    marker.on('click', () => openDeviceDetailsDialog('edit', type, null, data.id));

    collection[data.id] = { data, marker, visible, iconSize: getDeviceIconSize() };
    if (render) renderDeviceList(type);
    return true;
}

function renderCamerasList() {
    renderDeviceList('camera');
}

function renderRadiosList() {
    renderDeviceList('radio');
}

function renderDeviceList(type) {
    const collection = type === 'radio' ? radios : cameras;
    const deviceName = type === 'radio' ? 'Radio' : 'Kamera';
    const list = document.getElementById(type === 'radio' ? 'radios-list' : 'cameras-list');
    list.replaceChildren();
    Object.values(collection).forEach(({ data, visible }) => {
        const item = document.createElement('div');
        item.className = 'element-item';
        item.dataset.id = data.id;

        const name = data.name || `${deviceName} #${data.id}`;
        const color = document.createElement('div');
        color.className = 'item-color';
        color.style.backgroundColor = type === 'radio' ? '#7c3aed' : '#2563eb';
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
            editButton.className = `vis-btn edit-${type}-btn`;
            editButton.dataset.id = data.id;
            editButton.title = 'Edytuj';
            editButton.textContent = '✏️';
            actions.appendChild(editButton);
        }
        item.append(color, label, actions);

        visibilityButton.addEventListener('click', e => {
            e.stopPropagation();
            toggleDeviceVisibility(type, data.id);
        });
        item.addEventListener('click', () => {
            map.panTo([data.lat, data.lng]);
            highlightDevice(type, data.id);
        });
        if (isAdmin) {
            item.querySelector(`.edit-${type}-btn`).addEventListener('click', e => {
                e.stopPropagation();
                openDeviceDetailsDialog('edit', type, null, data.id);
            });
        }
        list.appendChild(item);
    });
}

function highlightCamera(id) {
    highlightDevice('camera', id);
}

function highlightDevice(type, id) {
    const listId = type === 'radio' ? 'radios-list' : 'cameras-list';
    document.querySelectorAll(`#${listId} .element-item`).forEach(el => el.classList.remove('highlighted'));
    const el = document.querySelector(`#${listId} .element-item[data-id="${id}"]`);
    if (el) el.classList.add('highlighted');
}

function toggleCameraVisibility(id) {
    toggleDeviceVisibility('camera', id);
}

function toggleDeviceVisibility(type, id) {
    const collection = type === 'radio' ? radios : cameras;
    const device = collection[id];
    if (!device) return;
    const previousVisible = device.visible;
    device.visible = !device.visible;
    device.data.isVisible = device.visible;
    device.marker.setIcon(createDeviceIcon(type, device.visible));
    renderDeviceList(type);
    if (isAdmin) persistDeviceVisibility(type, id, previousVisible);
}

function showAllCameras() {
    setAllDevicesVisible('camera', true);
}

function hideAllCameras() {
    setAllDevicesVisible('camera', false);
}

function showAllRadios() {
    setAllDevicesVisible('radio', true);
}

function hideAllRadios() {
    setAllDevicesVisible('radio', false);
}

function setAllDevicesVisible(type, visible) {
    const collection = type === 'radio' ? radios : cameras;
    Object.entries(collection).forEach(([id, device]) => {
        const previousVisible = device.visible;
        device.visible = visible;
        device.data.isVisible = visible;
        device.marker.setIcon(createDeviceIcon(type, visible));
        if (isAdmin && previousVisible !== visible) persistDeviceVisibility(type, id, previousVisible);
    });
    renderDeviceList(type);
}

async function persistDeviceVisibility(type, id, previousVisible) {
    const collection = type === 'radio' ? radios : cameras;
    const device = collection[id];
    if (!device) return;
    try {
        const response = await apiFetch(`/api/map/${type === 'radio' ? 'radios' : 'cameras'}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...device.data, projectId })
        });
        await ensureResponseOk(response, `Aktualizacja widoczności ${type === 'radio' ? 'radia' : 'kamery'}`);
        device.data = await response.json();
    } catch (error) {
        const label = type === 'radio' ? 'radia' : 'kamery';
        console.error(`Nie udało się zapisać widoczności ${label}:`, error);
        device.visible = previousVisible;
        device.data.isVisible = previousVisible;
        device.marker.setIcon(createDeviceIcon(type, previousVisible));
        renderDeviceList(type);
        setStatus(`Nie udało się zapisać widoczności ${label}`, 3000);
    }
}

// ── Tryb dodawania kamery ──────────────────────────────────

function handleAddCamera() {
    handleAddDevice('camera');
}

function handleAddRadio() {
    handleAddDevice('radio');
}

function handleAddDevice(type) {
    if (!isAdmin) return;
    const mode = `add-${type}`;
    if (activeMode === mode) { exitMode(); return; }
    exitMode();
    activeMode = mode;
    setCursor('crosshair');
    setStatus(`Kliknij na mapę, aby dodać ${type === 'radio' ? 'radio' : 'kamerę'}`, 0);
    document.getElementById(`btn-add-${type}`).classList.add('active');
}

// ── Dialog szczegółów kamery ───────────────────────────────

function openCameraDetailsDialog(mode, latlng, id) {
    openDeviceDetailsDialog(mode, 'camera', latlng, id);
}

function openDeviceDetailsDialog(mode, type, latlng, id) {
    cameraDialogMode = mode;
    dialogDeviceType = type;
    pendingCameraBase64 = null;
    existingCameraBase64 = null;
    const collection = type === 'radio' ? radios : cameras;
    const label = type === 'radio' ? 'Radio' : 'Kamera';

    const dialog = document.getElementById('camera-dialog');
    const title = document.getElementById('camera-dialog-title');
    const nameIn = document.getElementById('cam-name');
    const descIn = document.getElementById('cam-desc');
    const nameLabel = document.getElementById('device-name-label');
    const descriptionLabel = document.getElementById('device-description-label');
    const photoLabel = document.getElementById('device-photo-label');
    const photoUploadLabel = document.getElementById('device-photo-upload-label');
    const photoPlaceholder = document.getElementById('cam-photo-placeholder');
    const photoClearButton = document.getElementById('cam-photo-clear');
    const latEl = document.getElementById('cam-lat-display');
    const lngEl = document.getElementById('cam-lng-display');
    const preview = document.getElementById('cam-photo-preview');
    const placeholder = document.getElementById('cam-photo-placeholder');
    const deleteBtn = document.getElementById('cam-delete-btn');
    const lowerLabel = label.toLowerCase();
    nameLabel.textContent = `Nazwa ${lowerLabel}`;
    nameIn.placeholder = `Nazwa ${lowerLabel}`;
    descriptionLabel.textContent = `Opis ${lowerLabel}`;
    descIn.placeholder = `Opis / lokalizacja ${lowerLabel}...`;
    photoLabel.textContent = `Zdjęcie ${lowerLabel}`;
    photoUploadLabel.innerHTML = '<i class="fa-solid fa-upload" aria-hidden="true"></i> Wybierz plik';
    photoPlaceholder.innerHTML = '<i class="fa-solid fa-image" style="font-size:1.5rem;margin-bottom:6px;"></i><br>Brak zdjęcia';
    photoClearButton.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Usuń zdjęcie';

    // Reset photo
    preview.classList.add('hidden');
    preview.src = '';
    placeholder.classList.remove('hidden');

    if (mode === 'add') {
        title.textContent = `Nowe urządzenie — ${label.toLowerCase()}`;
        nameIn.value = '';
        descIn.value = '';
        pendingCameraLatLng = latlng;
        latEl.textContent = latlng.lat.toFixed(6);
        lngEl.textContent = latlng.lng.toFixed(6);
        editingDeviceId = null;
        deleteBtn.classList.add('hidden');
    } else {
        const device = collection[id];
        if (!device) {
            setStatus(`Nie znaleziono: ${label.toLowerCase()}`, 3000);
            return;
        }
        title.textContent = `Szczegóły — ${label.toLowerCase()}`;
        nameIn.value = device.data.name || '';
        descIn.value = device.data.description || '';
        latEl.textContent = Number(device.data.lat).toFixed(6);
        lngEl.textContent = Number(device.data.lng).toFixed(6);
        editingDeviceId = id;
        existingCameraBase64 = device.data.photoBase64 || null;
        if (existingCameraBase64) {
            preview.src = existingCameraBase64;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        }
        if (isAdmin) deleteBtn.classList.remove('hidden');
        else deleteBtn.classList.add('hidden');
    }

    deleteBtn.textContent = `Usuń ${label.toLowerCase()}`;
    preview.alt = `Podgląd zdjęcia: ${label.toLowerCase()}`;
    document.getElementById('cam-photo-input').value = '';
    dialog.classList.remove('hidden');
}

function closeCameraDialog() {
    document.getElementById('camera-dialog').classList.add('hidden');
    pendingCameraLatLng = null;
    pendingCameraBase64 = null;
    existingCameraBase64 = null;
    editingDeviceId = null;
}

async function saveCameraDialog() {
    const name = document.getElementById('cam-name').value.trim();
    const desc = document.getElementById('cam-desc').value.trim();
    const photo = pendingCameraBase64 || existingCameraBase64 || null;
    const type = dialogDeviceType;
    const typeName = type === 'radio' ? 'radia' : 'kamery';
    const collection = type === 'radio' ? radios : cameras;
    const resource = type === 'radio' ? 'radios' : 'cameras';

    if (!name) {
        setStatus(`Podaj nazwę ${typeName}`, 3000);
        document.getElementById('cam-name').focus();
        return;
    }

    if (cameraDialogMode === 'add') {
        if (!isValidProjectId(projectId)) {
            setStatus('Projekt jest jeszcze ładowany. Spróbuj ponownie za chwilę.', 3000);
            return;
        }
        if (!pendingCameraLatLng) {
            setStatus('Brak współrzędnych — kliknij najpierw na mapę', 3000);
            return;
        }
        const payload = {
            projectId: Number(projectId),
            lat: Number(pendingCameraLatLng.lat),
            lng: Number(pendingCameraLatLng.lng),
            name,
            description: desc || null,
            isVisible: true
        };
        if (photo) payload.photoBase64 = photo;
        try {
            const res = await apiFetch(`/api/map/${resource}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            await ensureResponseOk(res, `Zapis ${typeName}`);
            const saved = await res.json();
            addDeviceToMap(type, saved);
            closeCameraDialog();
            setStatus(`${type === 'radio' ? 'Radio dodane' : 'Kamera dodana'}`, 2500);
        } catch (e) {
            console.error(`Błąd zapisu ${typeName}:`, e);
            setStatus(`Błąd zapisu ${typeName}: ${e.message}`, 6000);
        }
    } else {
        const device = collection[editingDeviceId];
        if (!device) return;
        const previousData = { ...device.data };
        device.data.name = name;
        device.data.description = desc || null;
        device.data.photoBase64 = photo;

        try {
            const res = await apiFetch(`/api/map/${resource}/${editingDeviceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...device.data, projectId })
            });
            await ensureResponseOk(res, `Aktualizacja ${typeName}`);
            const updated = await res.json();
            device.data = updated;
            renderDeviceList(type);
            closeCameraDialog();
            setStatus(`${type === 'radio' ? 'Radio zaktualizowane' : 'Kamera zaktualizowana'}`, 2500);
        } catch (e) {
            device.data = previousData;
            renderDeviceList(type);
            console.error(`Błąd aktualizacji ${typeName}:`, e);
            setStatus(`Błąd aktualizacji ${typeName}`, 3000);
        }
    }
}

async function deleteCamera(id) {
    deleteDevice(dialogDeviceType, id);
}

async function deleteDevice(type, id) {
    const collection = type === 'radio' ? radios : cameras;
    const label = type === 'radio' ? 'radio' : 'kamerę';
    const resource = type === 'radio' ? 'radios' : 'cameras';
    const device = collection[id];
    if (!isAdmin || !device || !confirm(`Czy na pewno usunąć ${label}?`)) return;
    try {
        const response = await apiFetch(`/api/map/${resource}/${id}`, { method: 'DELETE' });
        await ensureResponseOk(response, `Usuwanie ${label}`);
        map.removeLayer(device.marker);
        delete collection[id];
        closeCameraDialog();
        renderDeviceList(type);
        setStatus(`${type === 'radio' ? 'Radio usunięte' : 'Kamera usunięta'}`, 2500);
    } catch (e) {
        console.error(`Błąd usuwania ${label}:`, e);
        setStatus(`Błąd usuwania ${label}`, 3000);
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

function addFiberToMap(data, render = true) {
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
        weight: getFiberStrokeWeight(thickness),
        opacity: visible ? 1 : 0.15
    }).addTo(map);
    polyline.bindPopup(createFiberPopupContent(data));

    polyline.on('click', event => {
        if (activeMode === 'select-fiber') {
            polyline.closePopup();
            handleFiberSelected(data.id);
        } else if (activeMode === 'select-fiber-end') {
            polyline.closePopup();
        } else if (activeMode === 'append-fiber') {
            polyline.closePopup();
            appendRoutePoint(event.latlng);
        } else if (activeMode === 'draw-fiber') {
            polyline.closePopup();
            addDrawPoint(event.latlng);
        } else if (activeMode !== null) {
            polyline.closePopup();
        }
    });

    // Podświetlanie przy hover
    polyline.on('mouseover', () => highlightFiber(data.id));
    polyline.on('mouseout', () => {
        document.querySelectorAll('#fibers-list .element-item').forEach(el => el.classList.remove('highlighted'));
    });

    fibers[data.id] = { data, polyline, visible };
    fiberUndoStack[data.id] = [];
    if (render) {
        renderFibersList();
        updateFiberToolStates();
    }
    return true;
}

function createFiberPopupContent(data) {
    const content = document.createElement('div');
    const label = document.createElement('div');
    const name = document.createElement('strong');
    label.textContent = 'Światłowód';
    name.textContent = data.name || `Światłowód #${data.id}`;
    content.append(label, name);
    return content;
}

function getFiberStrokeWeight(thickness) {
    const requestedThickness = Number(thickness) || 3;
    const currentZoom = map.getZoom();

    // Opcjonalnie: zmniejszaj grubość linii, gdy użytkownik bardzo oddali mapę (np. zoom poniżej 13)
    if (currentZoom < 12) {
        return Math.max(1, requestedThickness - 2);
    }

    return Number.isInteger(requestedThickness) &&
        requestedThickness >= 1 && requestedThickness <= 12 ? requestedThickness : 3;
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
            weight: getFiberStrokeWeight(fb.data.thickness),
            opacity: fb.visible ? 1 : 0.15
        });
        fb.polyline.setPopupContent(createFiberPopupContent(fb.data));
    }
}

function refreshZoomDependentStyles() {
    Object.values(fibers).forEach(({ data, polyline }) => {
        polyline.setStyle({ weight: getFiberStrokeWeight(data.thickness) });
    });
    if (fiberDrawLine) {
        const drawingThickness = activeFiberId && fibers[activeFiberId]
            ? fibers[activeFiberId].data.thickness
            : 3;
        fiberDrawLine.setStyle({ weight: getFiberStrokeWeight(drawingThickness) });
    }
    const iconSize = getDeviceIconSize();
    const refreshDeviceIcons = (collection, type) => {
        Object.values(collection).forEach(device => {
            if (device.iconSize === iconSize) return;
            device.marker.setIcon(createDeviceIcon(type, device.visible));
            device.iconSize = iconSize;
        });
    };
    refreshDeviceIcons(cameras, 'camera');
    refreshDeviceIcons(radios, 'radio');
}

map.on('zoomend', refreshZoomDependentStyles);

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
            if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
            highlightFiber(data.id);
            if (activeMode === 'select-fiber') handleFiberSelected(data.id);
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
        const response = await apiFetch(`/api/map/fibers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fb.data, projectId })
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
        fiberDrawLine = L.polyline(fiberDrawPoints, {
            color: '#facc15',
            weight: getFiberStrokeWeight(3),
            dashArray: '6,4'
        }).addTo(map);
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
        weight: getFiberStrokeWeight(activeFiberId && fibers[activeFiberId]
            ? fibers[activeFiberId].data.thickness
            : 3),
        dashArray: '6,4'
    }).addTo(map);
    updateFiberDrawingControls();
}

async function finishFiberDrawing() {
    if (isSavingFiber) return;
    if (!isValidProjectId(projectId)) {
        setStatus('Projekt jest jeszcze ładowany. Spróbuj ponownie za chwilę.', 3000);
        return;
    }
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
        projectId: Number(projectId),
        name: name.trim(),
        pathJson: JSON.stringify(pts),
        color: '#0000FF',
        thickness: 3,
        isVisible: true
    };

    try {
        isSavingFiber = true;
        updateFiberDrawingControls();
        const res = await apiFetch('/api/map/fibers', {
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

// ── Dorysowywanie od wybranego końca ────────────────────────

function handleAppendFromEnd() {
    if (!isAdmin) return;
    exitMode();
    activeMode = 'select-fiber';
    document.getElementById('fiber-select-overlay').classList.remove('hidden');
    document.getElementById('fiber-select-msg').textContent = 'Wybierz światłowód, klikając jego linię lub pozycję na liście';
    document.getElementById('btn-append-fiber').classList.add('active');
}

function enableFiberEndPointsSelection(id) {
    activeFiberId = id;
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

    document.getElementById('fiber-select-overlay').classList.add('hidden');
    activeMode = 'select-fiber-end';
    setStatus('Kliknij kropkę na wybranym końcu światłowodu, aby od niego dorysowywać', 0);
    clearFiberAppendEndpointMarkers();
    [
        { point: pts[0], isStart: true, label: 'Początek trasy' },
        { point: pts[pts.length - 1], isStart: false, label: 'Koniec trasy' }
    ].forEach(({ point, isStart, label }) => {
        const marker = L.circleMarker(point, {
            radius: 11,
            color: '#ffffff',
            fillColor: '#f97316',
            fillOpacity: 1,
            weight: 4,
            bubblingMouseEvents: false
        }).addTo(map);
        marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });
        marker.on('click', event => {
            if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
            startAppendingFiber(id, isStart);
        });
        fiberAppendEndpointMarkers.push(marker);
    });
}

function clearFiberAppendEndpointMarkers() {
    fiberAppendEndpointMarkers.forEach(marker => map.removeLayer(marker));
    fiberAppendEndpointMarkers = [];
}

function startAppendingFiber(id, appendFromStart) {
    const fb = fibers[id];
    if (!fb) {
        exitMode();
        setStatus('Nie znaleziono światłowodu', 3000);
        return;
    }
    const points = parsePoints(fb.data.pathJson);
    if (points.length < 2) {
        exitMode();
        setStatus('Nie można edytować światłowodu bez poprawnych punktów', 3000);
        return;
    }

    clearFiberAppendEndpointMarkers();
    activeFiberId = id;
    activeMode = 'append-fiber';
    fiberAppendFromStart = appendFromStart;
    const endpoint = appendFromStart ? points[0] : points[points.length - 1];
    fiberAppendOriginalPointCount = 1;
    fiberDrawPoints = [[...endpoint]];
    setCursor('crosshair');
    setStatus(`Dorysowywanie od ${appendFromStart ? 'początku' : 'końca'} trasy. Klikaj na mapie, a następnie wybierz „Zapisz zmiany”.`, 0);
    if (fiberDrawLine) map.removeLayer(fiberDrawLine);
    updateFiberDrawingControls();
}

async function finishAppendFiber() {
    if (isSavingFiber) return;
    if (!activeFiberId) return;
    const fiberId = activeFiberId;
    const fb = fibers[fiberId];
    if (!fb || fiberDrawPoints.length <= 1) {
        setStatus('Dodaj co najmniej 1 nowy punkt przed zapisaniem zmian.', 3000);
        return;
    }
    const previousData = { ...fb.data };
    const originalPoints = parsePoints(previousData.pathJson);
    const addedPoints = fiberDrawPoints.slice(1);
    const updatedPoints = fiberAppendFromStart
        ? [...addedPoints].reverse().concat(originalPoints)
        : originalPoints.concat(addedPoints);
    fb.data.pathJson = JSON.stringify(updatedPoints);

    try {
        isSavingFiber = true;
        updateFiberDrawingControls();
        const res = await apiFetch(`/api/map/fibers/${fiberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fb.data, projectId })
        });
        await ensureResponseOk(res, 'Dorysowywanie światłowodu');
        const updated = await res.json();
        pushUndo(fiberId, parsePoints(previousData.pathJson));
        fb.data = updated;
        refreshFiberPolyline(fiberId);
        editingFiberId = fiberId;
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

function handleFiberSelected(id) {
    // Wywoływane po kliknięciu na światłowód w trybie select-fiber
    if (activeMode === 'select-fiber') {
        // Sprawdź jaka akcja czeka
        const pendingAction = document.querySelector('.tool-btn.active')?.id;
        if (pendingAction === 'btn-append-fiber') {
            enableFiberEndPointsSelection(id);
        } else if (pendingAction === 'btn-vertex-delete') {
            enableVertexDeletion(id);
        } else if (pendingAction === 'btn-edit-fiber') {
            exitMode();
            openFiberDialog(id);
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
        const res = await apiFetch(`/api/map/fibers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fb.data, projectId })
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
        const res = await apiFetch(`/api/map/fibers/${fiberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fb.data, projectId })
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
    const name = document.getElementById('fiber-name').value.trim();
    const color = document.getElementById('fiber-color').value.trim() || '#0000FF';
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
        const res = await apiFetch(`/api/map/fibers/${fiberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fb.data, projectId })
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
    const fiber = fibers[id];
    if (!fiber) {
        setStatus('Nie znaleziono światłowodu', 3000);
        return;
    }
    try {
        const response = await apiFetch(`/api/map/fibers/${id}`, { method: 'DELETE' });
        await ensureResponseOk(response, 'Usuwanie światłowodu');
        if (fiber.polyline) map.removeLayer(fiber.polyline);
        delete fibers[id];
        delete fiberUndoStack[id];
        closeFiberDialog();
        renderFibersList();
        updateFiberToolStates();
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

map.on('click', function (e) {
    if (activeMode === 'add-camera') {
        openCameraDetailsDialog('add', e.latlng, null);
        exitMode();
    } else if (activeMode === 'add-radio') {
        openDeviceDetailsDialog('add', 'radio', e.latlng, null);
        exitMode();
    } else if (activeMode === 'draw-fiber') {
        addDrawPoint(e.latlng);
    } else if (activeMode === 'append-fiber') {
        appendRoutePoint(e.latlng);
    }
});

map.on('dblclick', function (e) {
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

// Odśwież mapę
document.getElementById('refresh-btn').addEventListener('click', () => {
    map.invalidateSize();
    setStatus('Mapa odświeżona', 2000);
});

// Zakładki
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById(btn.dataset.tab);
        panel.classList.add('active');
        const panelTitle = panel.querySelector('.panel-title');
        if (panelTitle) {
            panelTitle.textContent = btn.dataset.tab === 'radios-tab'
                ? 'Radia'
                : btn.dataset.tab === 'cameras-tab' ? 'Kamery' : 'Światłowody';
        }
    });
});

// ── Kamery ────────────────────────────────────────────────
document.getElementById('btn-add-camera').addEventListener('click', handleAddCamera);
document.getElementById('btn-add-radio').addEventListener('click', handleAddRadio);
document.getElementById('show-all-cameras').addEventListener('click', showAllCameras);
document.getElementById('hide-all-cameras').addEventListener('click', hideAllCameras);
document.getElementById('show-all-radios').addEventListener('click', showAllRadios);
document.getElementById('hide-all-radios').addEventListener('click', hideAllRadios);

// Dialog kamery
document.getElementById('close-camera-dialog').addEventListener('click', closeCameraDialog);
document.getElementById('close-camera-dialog-2').addEventListener('click', closeCameraDialog);
document.getElementById('cam-save-btn').addEventListener('click', saveCameraDialog);
document.getElementById('cam-delete-btn').addEventListener('click', () => deleteCamera(editingDeviceId));

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
window.syncElements = function (type, dataArray) {
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
                    addCameraToMap(data, false);
                }
            } catch (error) {
                console.error('Nie udało się zsynchronizować kamery:', c?.id, error);
            }
        });
        renderCamerasList();
    } else if (type === 'radios') {
        dataArray.forEach(radio => {
            try {
                if (!radio || radio.id === null || radio.id === undefined) return;
                const existing = radios[radio.id];
                const data = existing ? { ...existing.data, ...radio } : { ...radio };
                const coordinates = getCameraCoordinates(data);
                if (!coordinates) {
                    console.error('Pominięto synchronizację radia z nieprawidłowymi współrzędnymi:', radio.id);
                    return;
                }
                data.lat = coordinates.lat;
                data.lng = coordinates.lng;
                if (existing) {
                    existing.data = data;
                    existing.visible = data.isVisible !== false;
                    existing.marker.setLatLng([coordinates.lat, coordinates.lng]);
                    existing.marker.setIcon(createDeviceIcon('radio', existing.visible));
                } else {
                    addDeviceToMap('radio', data, false);
                }
            } catch (error) {
                console.error('Nie udało się zsynchronizować radia:', radio?.id, error);
            }
        });
        renderRadiosList();
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
                    addFiberToMap(data, false);
                }
            } catch (error) {
                console.error('Nie udało się zsynchronizować światłowodu:', f?.id, error);
            }
        });
        renderFibersList();
        updateFiberToolStates();
    }
};

// ═══════════════════════════════════════════════════════════
// 11. START
// ═══════════════════════════════════════════════════════════
loadProjectDataFromDatabase();
updateFiberToolStates();

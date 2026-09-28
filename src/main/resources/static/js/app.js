document.addEventListener('DOMContentLoaded', () => {

    // ── Logowanie ─────────────────────────────────────────────────────────────
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })
            .then(async res => ({ ok: res.ok, data: await res.json() }))
            .then(({ ok, data }) => {
                if (ok && data.success) {
                    localStorage.setItem('username', data.username);
                    localStorage.setItem('role', data.role);
                    window.location.href = 'projects.html';
                } else {
                    showError(data.message || 'Błąd logowania');
                }
            })
            .catch(() => showError('Błąd połączenia z serwerem'));
        });
    }

    // ── Rejestracja ────────────────────────────────────────────────────────────
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('reg-username').value;
            const password = document.getElementById('reg-password').value;

            fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })
            .then(async res => ({ ok: res.ok, data: await res.json() }))
            .then(({ ok, data }) => {
                if (ok && data.success) {
                    showSuccess('Zarejestrowano pomyślnie. Możesz się zalogować.');
                    toggleAuthForms();
                } else {
                    showError(data.message || 'Błąd rejestracji');
                }
            })
            .catch(() => showError('Błąd połączenia z serwerem'));
        });
    }

    // ── Przełączanie formularzy ────────────────────────────────────────────────
    const showRegisterBtn = document.getElementById('show-register');
    const showLoginBtn    = document.getElementById('show-login');
    if (showRegisterBtn && showLoginBtn) {
        showRegisterBtn.addEventListener('click', e => { e.preventDefault(); toggleAuthForms(); });
        showLoginBtn.addEventListener('click',    e => { e.preventDefault(); toggleAuthForms(); });
    }

    // ── Wylogowanie ───────────────────────────────────────────────────────────
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (error) {
                console.error('Błąd wylogowania:', error);
            }
            localStorage.clear();
            window.location.href = 'index.html';
        });
    }

    // ── Nowy projekt ──────────────────────────────────────────────────────────
    const newProjectBtn    = document.getElementById('new-project-btn');
    const newProjectForm   = document.getElementById('new-project-form');
    const cancelProjectBtn = document.getElementById('cancel-project-btn');
    const saveProjectBtn   = document.getElementById('save-project-btn');

    if (newProjectBtn && newProjectForm) {
        newProjectBtn.addEventListener('click', () => newProjectForm.classList.remove('hidden'));

        cancelProjectBtn.addEventListener('click', () => {
            newProjectForm.classList.add('hidden');
            document.getElementById('project-name').value = '';
        });

        saveProjectBtn.addEventListener('click', () => {
            const name = document.getElementById('project-name').value.trim();
            if (!name) return;

            fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            })
            .then(res => res.json())
            .then(data => {
                if (data.id) {
                    newProjectForm.classList.add('hidden');
                    document.getElementById('project-name').value = '';
                    loadProjects();
                }
            })
            .catch(err => console.error('Błąd tworzenia projektu:', err));
        });
    }

    // ── Modal usuwania projektu ───────────────────────────────────────────────
    const deleteModal      = document.getElementById('delete-project-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete-project');
    const cancelDeleteBtn  = document.getElementById('cancel-delete-project');

    if (deleteModal) {
        let pendingDeleteId = null;

        window._openDeleteProjectModal = function(id, name) {
            pendingDeleteId = id;
            document.getElementById('delete-project-msg').textContent =
                `Czy na pewno chcesz usunąć projekt „${name}"? Tej operacji nie można cofnąć.`;
            deleteModal.classList.remove('hidden');
        };

        cancelDeleteBtn.addEventListener('click', () => {
            deleteModal.classList.add('hidden');
            pendingDeleteId = null;
        });

        // Kliknięcie tła zamyka modal
        deleteModal.addEventListener('click', e => {
            if (e.target === deleteModal) {
                deleteModal.classList.add('hidden');
                pendingDeleteId = null;
            }
        });

        confirmDeleteBtn.addEventListener('click', async () => {
            if (!pendingDeleteId) return;
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.textContent = 'Usuwanie...';

            try {
                const res = await fetch(`/api/projects/${pendingDeleteId}`, { method: 'DELETE' });
                if (res.ok) {
                    deleteModal.classList.add('hidden');
                    pendingDeleteId = null;
                    loadProjects();
                } else {
                    alert('Nie udało się usunąć projektu. Spróbuj ponownie.');
                }
            } catch (err) {
                console.error('Błąd usuwania projektu:', err);
                alert('Błąd połączenia z serwerem.');
            } finally {
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = 'Usuń';
            }
        });
    }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toggleAuthForms() {
    document.getElementById('login-form').classList.toggle('hidden');
    document.getElementById('register-form').classList.toggle('hidden');
    document.getElementById('error-message').classList.add('hidden');
    document.getElementById('success-message').classList.add('hidden');
}

function showError(msg) {
    const el = document.getElementById('error-message');
    el.textContent = msg;
    el.classList.remove('hidden');
    document.getElementById('success-message').classList.add('hidden');
}

function showSuccess(msg) {
    const el = document.getElementById('success-message');
    el.textContent = msg;
    el.classList.remove('hidden');
    document.getElementById('error-message').classList.add('hidden');
}

// ── Ładowanie projektów ────────────────────────────────────────────────────────

window.loadProjects = function() {
    const container = document.getElementById('projects-container');
    if (!container) return;

    const isAdmin = localStorage.getItem('role') === 'ADMIN';

    container.innerHTML = '<div class="loading">Ładowanie projektów...</div>';

    fetch('/api/projects')
        .then(async res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (!Array.isArray(data)) throw new Error('Nieprawidłowa lista projektów');
            container.innerHTML = '';
            if (!data.length) {
                container.innerHTML = '<div class="loading">Brak projektów. Utwórz nowy!</div>';
                return;
            }

            data.forEach(project => {
                const card = document.createElement('div');
                card.className = 'project-card';
                card.innerHTML = `
                    <div>
                        <h3>${escapeHtml(project.name)}</h3>
                        <p>ID: ${project.id}</p>
                    </div>
                    <div class="project-card-actions">
                        <a href="map.html?id=${project.id}" class="btn-primary">Otwórz Mapę</a>
                        ${isAdmin ? `<button class="btn-delete-project" data-id="${project.id}" data-name="${escapeHtml(project.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i> Usuń</button>` : ''}
                    </div>`;

                if (isAdmin) {
                    card.querySelector('.btn-delete-project').addEventListener('click', e => {
                        e.stopPropagation();
                        const id   = parseInt(e.currentTarget.dataset.id, 10);
                        const name = e.currentTarget.dataset.name;
                        window._openDeleteProjectModal(id, name);
                    });
                }

                container.appendChild(card);
            });
        })
        .catch(() => {
            container.innerHTML = '<div class="alert">Błąd podczas pobierania projektów</div>';
        });
};

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

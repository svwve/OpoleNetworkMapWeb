document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('pending-users');
    const activeContainer = document.getElementById('active-users');
    const error = document.getElementById('admin-error');

    async function loadPendingUsers() {
        error.classList.add('hidden');
        container.replaceChildren();
        const response = await apiFetch('/api/users/pending');
        if (!response.ok) {
            throw new Error(`Nie udało się pobrać użytkowników (HTTP ${response.status}).`);
        }
        const users = await response.json();
        if (!Array.isArray(users)) {
            throw new Error('Serwer zwrócił nieprawidłową listę użytkowników.');
        }
        if (users.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'loading';
            emptyMessage.textContent = 'Brak użytkowników oczekujących na zatwierdzenie.';
            container.appendChild(emptyMessage);
            return;
        }

        users.forEach(user => {
            const card = document.createElement('section');
            card.className = 'project-card';
            const username = document.createElement('h3');
            username.textContent = user.username;
            const requestedRole = document.createElement('p');
            requestedRole.textContent = `Wnioskowana rola: ${user.role === 'ADMIN' ? 'Administrator' : 'Operator'}`;
            const approve = document.createElement('button');
            approve.className = 'btn-success';
            approve.textContent = 'Zatwierdź / Aktywuj';
            approve.addEventListener('click', async () => {
                approve.disabled = true;
                try {
                    const approval = await apiFetch(`/api/users/${encodeURIComponent(user.id)}/approve`, {
                        method: 'POST'
                    });
                    if (!approval.ok) {
                        throw new Error(`Nie udało się aktywować konta (HTTP ${approval.status}).`);
                    }
                    await loadPendingUsers();
                } catch (exception) {
                    error.textContent = exception.message;
                    error.classList.remove('hidden');
                    approve.disabled = false;
                }
            });
            card.append(username, requestedRole, approve);
            container.appendChild(card);
        });
    }

    async function loadActiveUsers() {
        activeContainer.replaceChildren();
        const response = await apiFetch('/api/admin/users');
        if (!response.ok) {
            throw new Error(`Nie udało się pobrać aktywnych użytkowników (HTTP ${response.status}).`);
        }
        const users = await response.json();
        if (!Array.isArray(users)) {
            throw new Error('Serwer zwrócił nieprawidłową listę aktywnych użytkowników.');
        }
        if (users.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'loading';
            emptyMessage.textContent = 'Brak aktywnych użytkowników.';
            activeContainer.appendChild(emptyMessage);
            return;
        }

        users.forEach(user => {
            const card = document.createElement('section');
            card.className = 'project-card';
            const username = document.createElement('h3');
            username.textContent = user.username;
            const roleEditor = document.createElement('div');
            roleEditor.className = 'form-group';
            const select = document.createElement('select');
            select.setAttribute('aria-label', `Rola użytkownika ${user.username}`);
            select.innerHTML = '<option value="USER">Operator</option><option value="ADMIN">Administrator</option>';
            select.value = user.role === 'ADMIN' ? 'ADMIN' : 'USER';
            const saveRole = document.createElement('button');
            saveRole.className = 'btn-primary';
            saveRole.textContent = 'Zapisz rolę';
            if (user.username === 'admin') {
                select.disabled = true;
                saveRole.disabled = true;
                saveRole.title = 'Rola głównego administratora nie może zostać zmieniona.';
            }
            saveRole.addEventListener('click', async () => {
                saveRole.disabled = true;
                try {
                    const update = await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role: select.value })
                    });
                    if (!update.ok) {
                        const result = await update.json().catch(() => ({}));
                        throw new Error(result.error || `Nie udało się zmienić roli (HTTP ${update.status}).`);
                    }
                    await loadActiveUsers();
                } catch (exception) {
                    error.textContent = exception.message;
                    error.classList.remove('hidden');
                    saveRole.disabled = false;
                }
            });
            roleEditor.append(select, saveRole);
            card.append(username, roleEditor);
            activeContainer.appendChild(card);
        });
    }

    try {
        const response = await apiFetch('/api/auth/session');
        const session = await response.json();
        if (!response.ok || !session.success || session.role !== 'ADMIN') {
            window.location.replace(session.success ? 'map.html' : 'index.html');
            return;
        }
        await loadPendingUsers();
        await loadActiveUsers();
    } catch (exception) {
        error.textContent = exception.message || 'Nie udało się załadować panelu administracyjnego.';
        error.classList.remove('hidden');
    }
});

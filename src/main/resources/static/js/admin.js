document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('pending-users');
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
            card.append(username, approve);
            container.appendChild(card);
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
    } catch (exception) {
        error.textContent = exception.message || 'Nie udało się załadować panelu administracyjnego.';
        error.classList.remove('hidden');
    }
});

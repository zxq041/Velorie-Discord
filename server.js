// Plik: server.js
// Importowanie potrzebnych modułów
const express = require('express');
const fs = require('fs'); // Moduł do operacji na plikach
const path = require('path');
const cors = require('cors');
const db = require('./database.js'); // Importujemy naszą bazę danych

// --- Konfiguracja Aplikacji ---
const app = express();
const PORT = 3000; // Możesz zmienić ten port, jeśli jest zajęty

// Pamiętaj, aby ten klucz był identyczny jak ten w bocie!
const API_SECRET_KEY = 'TwojSuperTajnyKluczAPI-ZmienToKoniecznie!';

// --- Konfiguracja Middleware ---
// Umożliwia komunikację z innych domen i parsowanie danych JSON
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Zwiększamy limit na wypadek dużych transkrypcji

// --- Middleware do autoryzacji bota ---
// Sprawdza, czy zapytanie od bota zawiera poprawny klucz
const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['authorization'];
    if (apiKey && apiKey === API_SECRET_KEY) {
        next(); // Klucz poprawny, przejdź dalej
    } else {
        res.status(403).json({ error: 'Brak autoryzacji.' }); // Klucz błędny, odrzuć zapytanie
    }
};

// =================================================================
// === API ENDPOINT - TUTAJ BOT WYSYŁA DANE                       ===
// =================================================================
app.post('/api/ticket', checkApiKey, (req, res) => {
    const { ticket, messages } = req.body;

    if (!ticket || !messages) {
        return res.status(400).json({ error: 'Brakujące dane ticketa lub wiadomości.' });
    }

    const ticketQuery = `INSERT INTO tickets (channel_id, creator_name, creator_id, topic, transcript_id, created_at, closed_at, closed_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const messageQuery = `INSERT INTO messages (ticket_id, author_name, author_avatar, is_admin, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.serialize(() => {
        // Krok 1: Zapisz główny ticket do bazy
        db.run(ticketQuery, [ticket.channel_id, ticket.creator_name, ticket.creator_id, ticket.topic, ticket.transcript_id, ticket.created_at, ticket.closed_at, ticket.closed_by_name], function(err) {
            if (err) {
                console.error("Błąd zapisu ticketa:", err.message);
                return res.status(500).json({ error: 'Błąd serwera podczas zapisu ticketa.' });
            }
            
            const ticketId = this.lastID; // Pobieramy ID właśnie wstawionego ticketa
            
            // Krok 2: Zapisz wszystkie wiadomości powiązane z tym ticketem
            const stmt = db.prepare(messageQuery);
            for (const msg of messages) {
                stmt.run(ticketId, msg.author_name, msg.author_avatar, msg.is_admin, msg.content, msg.timestamp);
            }
            stmt.finalize((err) => {
                if (err) {
                    console.error("Błąd zapisu wiadomości:", err.message);
                    return res.status(500).json({ error: 'Błąd serwera podczas zapisu wiadomości.' });
                }
                console.log(`Zapisano transkrypcję o ID: ${ticket.transcript_id}`);
                res.status(201).json({ message: 'Transkrypcja zapisana pomyślnie.', url: `/${ticket.transcript_id}` });
            });
        });
    });
});

// =================================================================
// === ENDPOINT STRONY GŁÓWNEJ                                    ===
// =================================================================
app.get('/', (req, res) => {
    res.send('<h1>System transkrypcji Velorie.pl działa.</h1><p>Wklej w pasku adresu pełny link do transkrypcji, aby ją zobaczyć.</p>');
});

// =================================================================
// === ENDPOINT WYŚWIETLANIA TRANSKRYPCJI                         ===
// =================================================================
app.get('/:transcriptId', (req, res) => {
    const { transcriptId } = req.params;

    const ticketQuery = `SELECT * FROM tickets WHERE transcript_id = ?`;
    const messagesQuery = `SELECT * FROM messages WHERE ticket_id = ? ORDER BY timestamp ASC`;

    // Krok 1: Znajdź ticket w bazie po jego unikalnym ID transkrypcji
    db.get(ticketQuery, [transcriptId], (err, ticket) => {
        if (err || !ticket) {
            return res.status(404).send('<h1>404 - Nie znaleziono transkrypcji</h1><p>Upewnij się, że link jest poprawny.</p>');
        }

        // Krok 2: Znaleziono ticket, teraz pobierz wszystkie jego wiadomości
        db.all(messagesQuery, [ticket.id], (err, messages) => {
            if (err) {
                return res.status(500).send('<h1>Błąd serwera podczas ładowania wiadomości</h1>');
            }

            // Krok 3: Wczytaj szablon ticket.html
            fs.readFile(path.join(__dirname, 'ticket.html'), 'utf8', (err, htmlTemplate) => {
                if (err) {
                    return res.status(500).send('<h1>Błąd serwera: nie można wczytać szablonu HTML.</h1>');
                }

                // Krok 4: Wygeneruj HTML dla każdej wiadomości
                let messagesHtml = '';
                messages.forEach(message => {
                    const badge = message.is_admin 
                        ? `<span class="text-xs font-medium bg-pink-500/20 text-pink-300 px-2 py-0.5 rounded-full">Administracja</span>`
                        : `<span class="text-xs font-medium bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">Użytkownik</span>`;
                    
                    const authorName = message.is_admin
                        ? `<span class="font-semibold text-[var(--accent)]">${message.author_name}</span>`
                        : `<span class="font-semibold">${message.author_name}</span>`;

                    messagesHtml += `
                        <div class="flex gap-4">
                            <img src="${message.author_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar" class="h-10 w-10 rounded-full bg-white/10 flex-shrink-0">
                            <div class="w-full">
                                <div class="flex items-baseline gap-2 flex-wrap">
                                    ${authorName}
                                    ${badge}
                                    <span class="text-xs text-white/50">${new Date(message.timestamp).toLocaleString('pl-PL')}</span>
                                </div>
                                <div class="mt-1 text-white/90 bg-white/5 p-3 rounded-lg break-words">
                                    <p>${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
                                </div>
                            </div>
                        </div>`;
                });

                // Krok 5: Podmień wszystkie znaczniki w szablonie na prawdziwe dane
                let finalHtml = htmlTemplate
                    .replace(/%%TICKET_ID%%/g, ticket.transcript_id.substring(0, 6))
                    .replace(/%%TICKET_TOPIC%%/g, ticket.topic)
                    .replace(/%%TICKET_CREATOR%%/g, ticket.creator_name)
                    .replace(/%%TICKET_CLOSER%%/g, ticket.closed_by_name)
                    .replace(/%%TICKET_CREATED_AT%%/g, new Date(ticket.created_at).toLocaleString('pl-PL'))
                    .replace(/%%TICKET_CLOSED_AT%%/g, new Date(ticket.closed_at).toLocaleString('pl-PL'))
                    .replace('', messagesHtml);
                
                // Krok 6: Wyślij gotową stronę HTML do przeglądarki użytkownika
                res.send(finalHtml);
            });
        });
    });
});

// =================================================================
// === URUCHOMIENIE SERWERA                                       ===
// =================================================================
app.listen(PORT, () => {
    console.log(`Serwer nasłuchuje na porcie ${PORT}`);
    console.log(`Otwórz http://localhost:${PORT} w przeglądarce.`);
});
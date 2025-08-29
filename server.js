const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const db = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

if (!API_SECRET_KEY) {
    console.error("Krytyczny błąd: Brak zdefiniowanej zmiennej API_SECRET_KEY!");
    process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['authorization'];
    if (apiKey && apiKey === API_SECRET_KEY) {
        next();
    } else {
        res.status(403).json({ error: 'Brak autoryzacji.' });
    }
};

app.get('/favicon.ico', (req, res) => res.status(204).send());

app.post('/api/ticket', checkApiKey, (req, res) => {
    console.log("Otrzymano nowe zgłoszenie do zapisu...");
    const { ticket, messages } = req.body;
    
    if (!ticket || !messages) {
        console.error("Błąd: Otrzymano niekompletne dane od bota.");
        return res.status(400).json({ error: 'Brakujące dane ticketa lub wiadomości.' });
    }
    
    const ticketQuery = `INSERT INTO tickets (channel_id, creator_name, creator_id, topic, transcript_id, created_at, closed_at, closed_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const messageQuery = `INSERT INTO messages (ticket_id, author_name, author_avatar, is_admin, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.serialize(() => {
        db.run(ticketQuery, [ticket.channel_id, ticket.creator_name, ticket.creator_id, ticket.topic, ticket.transcript_id, ticket.created_at, ticket.closed_at, ticket.closed_by_name], function(err) {
            if (err) {
                console.error("Błąd zapisu ticketa do bazy danych:", err.message);
                return res.status(500).json({ error: 'Błąd serwera podczas zapisu ticketa.' });
            }
            
            const ticketId = this.lastID;
            const stmt = db.prepare(messageQuery);
            for (const msg of messages) {
                stmt.run(ticketId, msg.author_name, msg.author_avatar, msg.is_admin, msg.content, msg.timestamp);
            }
            stmt.finalize((err) => {
                if (err) {
                    console.error("Błąd zapisu wiadomości do bazy danych:", err.message);
                    return res.status(500).json({ error: 'Błąd serwera podczas zapisu wiadomości.' });
                }
                console.log(`Pomyślnie zapisano transkrypcję o ID: ${ticket.transcript_id}`);
                res.status(201).json({ message: 'Transkrypcja zapisana pomyślnie.', url: `/${ticket.transcript_id}` });
            });
        });
    });
});

app.get('/', (req, res) => {
    console.log("Otrzymano zapytanie GET do strony głównej (health check).");
    res.status(200).send('<h1>System transkrypcji Velorie.pl działa poprawnie.</h1>');
});

app.get('/:transcriptId', (req, res) => {
    console.log(`Próba odczytu transkrypcji o ID: ${req.params.transcriptId}`);
    const { transcriptId } = req.params;
    const ticketQuery = `SELECT * FROM tickets WHERE transcript_id = ?`;
    const messagesQuery = `SELECT * FROM messages WHERE ticket_id = ? ORDER BY timestamp ASC`;

    db.get(ticketQuery, [transcriptId], (err, ticket) => {
        if (err || !ticket) {
            console.error(`Nie znaleziono ticketa o ID ${transcriptId} lub wystąpił błąd bazy:`, err);
            return res.status(404).send('<h1>404 - Nie znaleziono transkrypcji</h1><p>Upewnij się, że link jest poprawny.</p>');
        }

        db.all(messagesQuery, [ticket.id], (err, messages) => {
            if (err) {
                console.error(`Błąd podczas pobierania wiadomości dla ticketa ${ticket.id}:`, err);
                return res.status(500).send('<h1>Błąd serwera podczas ładowania wiadomości</h1>');
            }

            fs.readFile(path.join(__dirname, 'ticket.html'), 'utf8', (err, htmlTemplate) => {
                if (err) {
                    console.error("Krytyczny błąd: Nie można odczytać pliku ticket.html!", err);
                    return res.status(500).send('<h1>Błąd serwera: nie można wczytać szablonu HTML.</h1>');
                }

                let messagesHtml = '';
                messages.forEach(message => {
                    const badge = message.is_admin ? `<span class="text-xs font-medium bg-pink-500/20 text-pink-300 px-2 py-0.5 rounded-full">Administracja</span>` : `<span class="text-xs font-medium bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">Użytkownik</span>`;
                    const authorName = message.is_admin ? `<span class="font-semibold text-[var(--accent)]">${message.author_name}</span>` : `<span class="font-semibold">${message.author_name}</span>`;
                    
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
                
                // =================================================================
                // === OTO KLUCZOWA POPRAWKA                                     ===
                // =================================================================
                let finalHtml = htmlTemplate
                    .replace(/%%TICKET_ID%%/g, ticket.transcript_id.substring(0, 6))
                    .replace(/%%TICKET_TOPIC%%/g, ticket.topic)
                    .replace(/%%TICKET_CREATOR%%/g, ticket.creator_name)
                    .replace(/%%TICKET_CLOSER%%/g, ticket.closed_by_name)
                    .replace(/%%TICKET_CREATED_AT%%/g, new Date(ticket.created_at).toLocaleString('pl-PL'))
                    .replace(/%%TICKET_CLOSED_AT%%/g, new Date(ticket.closed_at).toLocaleString('pl-PL'))
                    // Ta linia szuka teraz nowego, poprawnego znacznika
                    .replace('<div id="messages-placeholder">%%MESSAGES_LIST%%</div>', messagesHtml);
                
                console.log(`Pomyślnie wysłano transkrypcję o ID: ${transcriptId}`);
                res.send(finalHtml);
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Serwer nasłuchuje na porcie ${PORT}`);
});

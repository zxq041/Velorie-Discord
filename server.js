const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const db = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;

const API_SECRET_KEY = process.env.API_SECRET_KEY;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!API_SECRET_KEY || !ADMIN_USER || !ADMIN_PASS || !SESSION_SECRET) {
    console.error("Krytyczny błąd: Brak zdefiniowanych wszystkich zmiennych środowiskowych!");
    process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: 'auto' }
}));

const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        return next();
    }
    res.redirect('/login');
};

const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['authorization'];
    if (apiKey && apiKey === API_SECRET_KEY) {
        next();
    } else {
        res.status(403).json({ error: 'Brak autoryzacji.' });
    }
};

// =================================================================
// === TRASY DLA PANELU ADMINA I LOGOWANIA                     ===
// =================================================================

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.redirect('/login');
    }
});

app.get('/admin', isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// =================================================================
// === API DLA PANELU ADMINA (POBIERANIE TICKETÓW)              ===
// =================================================================
app.get('/api/tickets', isAdmin, (req, res) => {
    const searchQuery = req.query.search;
    let query = `SELECT id, channel_id, creator_name, topic, transcript_id, created_at, closed_at, closed_by_name FROM tickets`;
    const params = [];

    if (searchQuery) {
        query += ` WHERE creator_name LIKE ?`;
        params.push(`%${searchQuery}%`);
    }
    query += ` ORDER BY closed_at DESC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error("Błąd pobierania ticketów z bazy:", err);
            return res.status(500).json({ error: "Błąd serwera" });
        }
        res.json(rows);
    });
});

// =================================================================
// === API DLA BOTA (ODBIERANIE TRANSKRYPCJI) - BRAKUJĄCY ELEMENT ===
// =================================================================
app.post('/api/ticket', checkApiKey, (req, res) => {
    console.log("Otrzymano nowe zgłoszenie do zapisu...");
    const { ticket, messages } = req.body;

    if (!ticket || !messages) {
        return res.status(400).json({ error: 'Brakujące dane ticketa lub wiadomości.' });
    }

    const ticketQuery = `INSERT INTO tickets (channel_id, creator_name, creator_id, topic, transcript_id, created_at, closed_at, closed_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const messageQuery = `INSERT INTO messages (ticket_id, author_name, author_avatar, is_admin, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;

    db.serialize(() => {
        db.run(ticketQuery, [ticket.channel_id, ticket.creator_name, ticket.creator_id, ticket.topic, ticket.transcript_id, ticket.created_at, ticket.closed_at, ticket.closed_by_name], function(err) {
            if (err) {
                console.error("Błąd zapisu ticketa:", err.message);
                return res.status(500).json({ error: 'Błąd serwera podczas zapisu ticketa.' });
            }
            const ticketId = this.lastID;
            const stmt = db.prepare(messageQuery);
            for (const msg of messages) {
                stmt.run(ticketId, msg.author_name, msg.author_avatar, msg.is_admin, msg.content, msg.timestamp);
            }
            stmt.finalize((err) => {
                if (err) {
                    console.error("Błąd zapisu wiadomości:", err.message);
                    return res.status(500).json({ error: 'Błąd serwera podczas zapisu wiadomości.' });
                }
                console.log(`Pomyślnie zapisano transkrypcję o ID: ${ticket.transcript_id}`);
                res.status(201).json({ message: 'Transkrypcja zapisana pomyślnie.', url: `/${ticket.transcript_id}` });
            });
        });
    });
});

// =================================================================
// === TRASY PUBLICZNE (STRONA GŁÓWNA I TRANSKRYPCJE)            ===
// =================================================================
app.get('/favicon.ico', (req, res) => res.status(204).send());

app.get('/', (req, res) => {
    res.status(200).send('<h1>System transkrypcji Velorie.pl działa poprawnie.</h1>');
});

app.get('/:transcriptId', (req, res) => {
    const { transcriptId } = req.params;
    // ... reszta kodu do wyświetlania transkrypcji (pozostaje bez zmian)
    const ticketQuery = `SELECT * FROM tickets WHERE transcript_id = ?`;
    const messagesQuery = `SELECT * FROM messages WHERE ticket_id = ? ORDER BY timestamp ASC`;
    db.get(ticketQuery, [transcriptId], (err, ticket) => {
        if (err || !ticket) {
            return res.status(404).send('<h1>404 - Nie znaleziono transkrypcji</h1>');
        }
        db.all(messagesQuery, [ticket.id], (err, messages) => {
            if (err) { return res.status(500).send('<h1>Błąd serwera</h1>'); }
            fs.readFile(path.join(__dirname, 'ticket.html'), 'utf8', (err, htmlTemplate) => {
                if (err) { return res.status(500).send('<h1>Błąd serwera</h1>'); }
                let messagesHtml = '';
                messages.forEach(message => {
                    const badge = message.is_admin ? `<span class="text-xs font-medium bg-pink-500/20 text-pink-300 px-2 py-0.5 rounded-full">Administracja</span>` : `<span class="text-xs font-medium bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">Użytkownik</span>`;
                    const authorName = message.is_admin ? `<span class="font-semibold text-[var(--accent)]">${message.author_name}</span>` : `<span class="font-semibold">${message.author_name}</span>`;
                    messagesHtml += `<div class="flex gap-4"><img src="${message.author_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar" class="h-10 w-10 rounded-full bg-white/10 flex-shrink-0"><div class="w-full"><div class="flex items-baseline gap-2 flex-wrap">${authorName}${badge}<span class="text-xs text-white/50">${new Date(message.timestamp).toLocaleString('pl-PL')}</span></div><div class="mt-1 text-white/90 bg-white/5 p-3 rounded-lg break-words"><p>${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p></div></div></div>`;
                });
                let finalHtml = htmlTemplate.replace(/%%TICKET_ID%%/g, ticket.transcript_id.substring(0, 6)).replace(/%%TICKET_TOPIC%%/g, ticket.topic).replace(/%%TICKET_CREATOR%%/g, ticket.creator_name).replace(/%%TICKET_CLOSER%%/g, ticket.closed_by_name).replace(/%%TICKET_CREATED_AT%%/g, new Date(ticket.created_at).toLocaleString('pl-PL')).replace(/%%TICKET_CLOSED_AT%%/g, new Date(ticket.closed_at).toLocaleString('pl-PL')).replace('<div id="messages-placeholder">%%MESSAGES_LIST%%</div>', messagesHtml);
                res.send(finalHtml);
            });
        });
    });
});

// =================================================================
// === URUCHOMIENIE SERWERA                                      ===
// =================================================================
app.listen(PORT, () => {
    console.log(`Serwer nasłuchuje na porcie ${PORT}`);
});

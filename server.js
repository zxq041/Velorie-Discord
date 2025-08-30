const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const session = require('express-session'); // Nowa zależność
const db = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Odczyt danych logowania i sekretu sesji ze zmiennych środowiskowych
const API_SECRET_KEY = process.env.API_SECRET_KEY;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!API_SECRET_KEY || !ADMIN_USER || !ADMIN_PASS || !SESSION_SECRET) {
    console.error("Krytyczny błąd: Brak zdefiniowanych wszystkich zmiennych środowiskowych (API_SECRET_KEY, ADMIN_USER, ADMIN_PASS, SESSION_SECRET)!");
    process.exit(1);
}

// Konfiguracja middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // Do parsowania danych z formularza logowania

// Konfiguracja sesji
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: 'auto' } // Na Railway 'auto' zadziała poprawnie z HTTPS
}));

// Middleware sprawdzający, czy użytkownik jest zalogowany jako admin
const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        return next();
    }
    res.redirect('/login');
};

// =================================================================
// === NOWE TRASY DLA PANELU ADMINA                              ===
// =================================================================

// Wyświetlanie strony logowania
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Obsługa logowania
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.redirect('/login'); // W przyszłości można dodać wiadomość o błędzie
    }
});

// Wyświetlanie panelu admina (tylko dla zalogowanych)
app.get('/admin', isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Wylogowanie
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// =================================================================
// === NOWE API DO POBIERANIA TICKETÓW (ZABEZPIECZONE)           ===
// =================================================================
app.get('/api/tickets', isAdmin, (req, res) => {
    const searchQuery = req.query.search;
    let query = `SELECT id, channel_id, creator_name, topic, transcript_id, created_at, closed_at, closed_by_name FROM tickets`;
    const params = [];

    if (searchQuery) {
        query += ` WHERE creator_name LIKE ?`;
        params.push(`%${searchQuery}%`);
    }

    query += ` ORDER BY closed_at DESC`; // Sortowanie od najnowszych

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error("Błąd pobierania ticketów z bazy:", err);
            return res.status(500).json({ error: "Błąd serwera" });
        }
        res.json(rows);
    });
});


// =================================================================
// === DOTYCHCZASOWE FUNKCJE (BEZ ZMIAN)                         ===
// =================================================================

app.get('/favicon.ico', (req, res) => res.status(204).send());

app.post('/api/ticket', /* ... ten kod pozostaje bez zmian ... */);
app.get('/', /* ... ten kod pozostaje bez zmian ... */);
app.get('/:transcriptId', /* ... ten kod pozostaje bez zmian ... */);

// (Pominięto kod starych funkcji dla zwięzłości, ale musi on tu być!)

app.listen(PORT, () => {
    console.log(`Serwer nasłuchuje na porcie ${PORT}`);
});

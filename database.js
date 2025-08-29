// Plik: database.js
const sqlite3 = require('sqlite3').verbose();

// To stworzy plik o nazwie 'database.db' w Twoim folderze
const db = new sqlite3.Database('/data/database.db');

const TICKET_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    transcript_id TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL,
    closed_at DATETIME NOT NULL,
    closed_by_name TEXT NOT NULL
);`;

const MESSAGE_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    author_name TEXT NOT NULL,
    author_avatar TEXT,
    is_admin BOOLEAN NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tickets (id)
);`;

// Uruchamiamy komendy tworzące tabele
db.serialize(() => {
    db.run(TICKET_TABLE_SCHEMA, (err) => {
        if (err) {
            console.error("Błąd podczas tworzenia tabeli 'tickets':", err.message);
        }
    });

    db.run(MESSAGE_TABLE_SCHEMA, (err) => {
        if (err) {
            console.error("Błąd podczas tworzenia tabeli 'messages':", err.message);
        }
    });
});

console.log("Połączono z bazą danych SQLite i zweryfikowano tabele.");

// Eksportujemy obiekt bazy danych, aby 'server.js' mógł go używać

module.exports = db;

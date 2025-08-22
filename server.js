// =================================================================
// 🚀 SERVIDOR DE NOTAS - VERSIÓN 4.1 (SIN SHARE)
// =================================================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// Render inyectará la variable de entorno DATABASE_URL automáticamente.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DE CORS (AQUÍ ESTÁ EL "ALLOWED") ---
const allowedOrigins = [
  'http://127.0.0.1:5500', // Para tu desarrollo local
  'https://frontend-netifly.netlify.app/'  // <-- ¡ACCIÓN! Pega aquí la URL que te dio Netlify
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por la política de CORS'));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());

// --- ENDPOINTS DE LA API ---

// GET: Versión para verificar despliegue
app.get('/api/version-check', (req, res) => {
  res.json({ 
    version: "4.1-SUPABASE-READY-NO-SHARE", 
    message: "Backend desplegado y conectado correctamente." 
  });
});

// GET: Obtener todas las notas
app.get('/api/notes', async (req, res) => {
  try {
    const query = `
      SELECT id, nombre, contenido, fecha_hora, to_char(fecha_hora, 'YYYY-MM-DD') AS fecha, 
             to_char(fecha_hora, 'HH24:MI') AS hora, color, tipo, fijada
      FROM notes 
      ORDER BY fecha_hora ASC NULLS LAST, id ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ message: "Error al obtener las notas" }); }
});

// POST: Crear una nota
app.post('/api/notes', async (req, res) => {
  const { nombre = "", contenido = "", fecha_hora = null, color = "#f1e363ff", tipo = "Clase", fijada = false } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO notes(nombre, contenido, fecha_hora, color, tipo, fijada) VALUES($1, $2, $3, $4, $5, $6) RETURNING *',
      [nombre, contenido, fecha_hora, color, tipo, fijada]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: "Error al crear la nota" }); }
});

// PUT: Actualizar una nota
app.put('/api/notes/:id', async (req, res) => {
  const { nombre, contenido, fecha_hora, color, tipo, fijada } = req.body;
  try {
    const result = await pool.query(
      'UPDATE notes SET nombre = $1, contenido = $2, fecha_hora = $3, color = $4, tipo = $5, fijada = $6 WHERE id = $7 RETURNING *',
      [nombre, contenido, fecha_hora, color, tipo, fijada, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Nota no encontrada' });
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: "Error al actualizar la nota" }); }
});

// DELETE: Borrar una nota
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM notes WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) { return res.status(404).json({ message: 'Nota no encontrada' }); }
        res.status(204).send();
    } catch (err) { res.status(500).json({ message: "Error al borrar la nota" }); }
});

// Endpoints de nota rápida
app.get('/api/settings/quicknote', async (req, res) => { try { const result = await pool.query("SELECT value FROM settings WHERE key = 'quickNote'"); res.json({ value: result.rows[0]?.value || '' }); } catch (err) { res.status(500).json({ message: 'Error' }); } });
app.put('/api/settings/quicknote', async (req, res) => { const { content } = req.body; try { await pool.query(`INSERT INTO settings (key, value) VALUES ('quickNote', $1) ON CONFLICT (key) DO UPDATE SET value = $1;`, [content]); res.status(200).json({ message: 'OK' }); } catch (err) { res.status(500).json({ message: 'Error' }); } });

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
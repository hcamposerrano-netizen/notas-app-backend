// =================================================================
// 🚀 SERVIDOR DE NOTAS - VERSIÓN 7.1 (CON FUNCIONALIDAD DE ARCHIVADO)
// =================================================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

// --- CONFIGURACIÓN DE SERVICIOS ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DE CORS ---
const allowedOrigins = [
  'http://127.0.0.1:5500', 
  'https://frontend-netifly.netlify.app'
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
app.use(cors(corsOptions));
app.use(express.json());

// ==============================================================
// 🔐 MIDDLEWARE DE AUTENTICACIÓN
// ==============================================================
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acceso no autorizado: No se proporcionó token.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ message: 'Token inválido o expirado.' });
        }
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Acceso no autorizado: ' + error.message });
    }
};

// --- ENDPOINTS DE LA API ---

app.get('/api/version-check', (req, res) => {
  res.json({ version: "7.1-ARCHIVE-FIXED", message: "Backend desplegado y conectado correctamente." });
});

// ✅ CORREGIDO: Ahora solo trae las notas activas (no archivadas)
app.get('/api/notes', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const query = `
      SELECT id, nombre, contenido, fecha_hora, to_char(fecha_hora, 'YYYY-MM-DD') AS fecha, 
             to_char(fecha_hora, 'HH24:MI') AS hora, color, tipo, fijada,
             attachment_url, attachment_filename, is_archived
      FROM notes 
      WHERE user_id = $1 AND is_archived = false
      ORDER BY fecha_hora ASC NULLS LAST, id ASC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ message: "Error al obtener las notas" }); }
});

// ✨ NUEVA RUTA: Para obtener solo las notas archivadas
app.get('/api/notes/archived', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const query = `
      SELECT id, nombre, contenido, fecha_hora, to_char(fecha_hora, 'YYYY-MM-DD') AS fecha, 
             to_char(fecha_hora, 'HH24:MI') AS hora, color, tipo, fijada,
             attachment_url, attachment_filename, is_archived
      FROM notes 
      WHERE user_id = $1 AND is_archived = true
      ORDER BY fecha_hora ASC NULLS LAST, id ASC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ message: "Error al obtener las notas archivadas" }); }
});


// ✨ NUEVA RUTA: Para archivar o desarchivar una nota específica
app.put('/api/notes/:id/archive', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const noteId = req.params.id;
    const { is_archived } = req.body;

    if (typeof is_archived !== 'boolean') {
        return res.status(400).json({ message: 'Valor de is_archived no es válido.' });
    }

    try {
        const result = await pool.query(
            'UPDATE notes SET is_archived = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
            [is_archived, noteId, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nota no encontrada o no tienes permiso.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al actualizar el estado de archivado.' });
    }
});

app.put('/api/notes/:id', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const noteId = req.params.id;
  const { nombre, contenido, fecha_hora, color, tipo, fijada } = req.body;
  try {
    const result = await pool.query(
      'UPDATE notes SET nombre = $1, contenido = $2, fecha_hora = $3, color = $4, tipo = $5, fijada = $6 WHERE id = $7 AND user_id = $8 RETURNING *',
      [nombre, contenido, fecha_hora, color, tipo, fijada, noteId, userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Nota no encontrada o no tienes permiso para editarla.' });
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: "Error al actualizar la nota" }); }
});

app.delete('/api/notes/:id', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const noteId = req.params.id;
    try {
        const result = await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [noteId, userId]);
        if (result.rowCount === 0) { return res.status(404).json({ message: 'Nota no encontrada o no tienes permiso para borrarla.' }); }
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ message: "Error al borrar la nota" }); }
});

app.post('/api/notes/:id/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const noteId = req.params.id;
  const file = req.file;
  if (!file) { return res.status(400).json({ message: 'No se ha proporcionado ningún archivo.' }); }
  const fileName = `${req.user.id}/${noteId}-${Date.now()}-${file.originalname}`;
  try {
    const { error: uploadError } = await supabase.storage.from('adjuntos').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('adjuntos').getPublicUrl(fileName);
    await pool.query('UPDATE notes SET attachment_url = $1, attachment_filename = $2 WHERE id = $3 AND user_id = $4', [publicUrl, file.originalname, noteId, req.user.id]);
    res.status(200).json({ message: 'OK', attachment_url: publicUrl, attachment_filename: file.originalname });
  } catch (err) { console.error("Error en la subida:", err); res.status(500).json({ message: 'Error del servidor al subir el archivo.' }); }
});
// EN server.js (añadir cerca de los otros endpoints PUT/DELETE)

// ✨ NUEVA RUTA: Para activar o desactivar las notificaciones de una nota
app.put('/api/notes/:id/notifications', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const noteId = req.params.id;
    const { notificaciones_activas } = req.body;

    if (typeof notificaciones_activas !== 'boolean') {
        return res.status(400).json({ message: 'El valor de notificaciones_activas no es válido.' });
    }

    try {
        const result = await pool.query(
            'UPDATE notes SET notificaciones_activas = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
            [notificaciones_activas, noteId, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nota no encontrada o no tienes permiso.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al actualizar el estado de las notificaciones.' });
    }
});

// Endpoints de NOTA RÁPIDA (ya estaban correctos)
app.get('/api/settings/quicknote', authMiddleware, async (req, res) => { 
    try { const userId = req.user.id; const result = await pool.query("SELECT value FROM settings WHERE user_id = $1 AND key = 'quickNote'", [userId]); res.json({ value: result.rows[0]?.value || '' }); } catch (err) { console.error(err); res.status(500).json({ message: 'Error al obtener la nota rápida' }); } 
});
app.put('/api/settings/quicknote', authMiddleware, async (req, res) => { 
    const { content } = req.body; const userId = req.user.id; try { await pool.query(`INSERT INTO settings (user_id, key, value) VALUES ($1, 'quickNote', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = $2;`, [userId, content]); res.status(200).json({ message: 'OK' }); } catch (err) { console.error(err); res.status(500).json({ message: 'Error al guardar la nota rápida' }); } 
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
// EN server.js
app.post('/api/notes', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  // ✨ AÑADIDO: notificaciones_activas
  const { nombre = "", contenido = "", fecha_hora = null, color = "#f1e363ff", tipo = "Clase", fijada = false, notificaciones_activas = false } = req.body;
  try {
    const result = await pool.query(
      // ✨ AÑADIDO: campo y valor
      'INSERT INTO notes(nombre, contenido, fecha_hora, color, tipo, fijada, user_id, is_archived, notificaciones_activas) VALUES($1, $2, $3, $4, $5, $6, $7, false, $8) RETURNING *',
      // ✨ AÑADIDO: parámetro
      [nombre, contenido, fecha_hora, color, tipo, fijada, userId, notificaciones_activas]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: "Error al crear la nota" }); }
});
// =================================================================
// 🚀 SERVIDOR DE NOTAS - VERSIÓN 11.0 (CON NOTIFICACIONES PUSH INTEGRADAS)
// =================================================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const webpush = require('web-push'); // ✅ AÑADIDO

// --- CONFIGURACIÓN DE SERVICIOS ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ✅ AÑADIDO: Configuración de Notificaciones Push con tus claves de Render
webpush.setVapidDetails(
  'mailto:tu-correo@ejemplo.com', // ❗️ Cambia esto por tu email de contacto
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

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
// 🔐 MIDDLEWARE DE AUTENTICACIÓN (Sin cambios)
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

// --- ENDPOINTS DE LA API (Tus endpoints existentes) ---

app.get('/api/version-check', (req, res) => {
  res.json({ version: "10.0-STABLE", message: "Backend desplegado y conectado correctamente." });
});

app.get('/api/notes', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const query = `
      SELECT id, nombre, contenido, fecha_hora, color, tipo, fijada, attachment_url, attachment_filename, is_archived, notificaciones_activas
      FROM notes
      WHERE user_id = $1 AND is_archived = false
      ORDER BY fecha_hora ASC NULLS LAST, id ASC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error en /api/notes:", err);
    res.status(500).json({ message: "Error al obtener las notas" });
  }
});

app.get('/api/notes/archived', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const query = `
      SELECT id, nombre, contenido, fecha_hora, color, tipo, fijada, attachment_url, attachment_filename, is_archived, notificaciones_activas
      FROM notes
      WHERE user_id = $1 AND is_archived = true
      ORDER BY fecha_hora ASC NULLS LAST, id ASC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error en /api/notes/archived:", err);
    res.status(500).json({ message: "Error al obtener las notas archivadas" });
  }
});

app.post('/api/notes', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { nombre = "", contenido = "", fecha_hora = null, color = "#f1e363ff", tipo = "Clase", fijada = false, notificaciones_activas = false } = req.body;
  const query = `
    INSERT INTO notes(nombre, contenido, fecha_hora, color, tipo, fijada, user_id, is_archived, notificaciones_activas)
    VALUES($1, $2, $3, $4, $5, $6, $7, false, $8)
    RETURNING *
  `;
  try {
    const result = await pool.query(query,
      [nombre, contenido, fecha_hora, color, tipo, fijada, userId, notificaciones_activas]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error al crear la nota" });
  }
});

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
        if (result.rowCount === 0) return res.status(404).json({ message: 'Nota no encontrada o no tienes permiso.' });
        res.json(result.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ message: 'Error al actualizar el estado de archivado.' }); }
});

app.put('/api/notes/:id', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const noteId = req.params.id;
  const { nombre, contenido, fecha_hora, color, tipo, fijada, notificaciones_activas } = req.body;
  try {
    const result = await pool.query(
      `UPDATE notes
       SET nombre = $1, contenido = $2, fecha_hora = $3, color = $4, tipo = $5, fijada = $6, notificaciones_activas = $7
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [nombre, contenido, fecha_hora, color, tipo, fijada, notificaciones_activas, noteId, userId]
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
        if (result.rowCount === 0) return res.status(404).json({ message: 'Nota no encontrada o no tienes permiso para borrarla.' });
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ message: "Error al borrar la nota" }); }
});

app.post('/api/notes/:id/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const noteId = req.params.id;
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'No se ha proporcionado ningún archivo.' });
  const fileName = `${req.user.id}/${noteId}-${Date.now()}-${file.originalname}`;
  try {
    const { error: uploadError } = await supabase.storage.from('adjuntos').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('adjuntos').getPublicUrl(fileName);
    await pool.query('UPDATE notes SET attachment_url = $1, attachment_filename = $2 WHERE id = $3 AND user_id = $4', [publicUrl, file.originalname, noteId, req.user.id]);
    res.status(200).json({ message: 'OK', attachment_url: publicUrl, attachment_filename: file.originalname });
  } catch (err) { console.error("Error en la subida:", err); res.status(500).json({ message: 'Error del servidor al subir el archivo.' }); }
});

app.put('/api/notes/:id/notifications', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const noteId = req.params.id;
    const { notificaciones_activas } = req.body;
    if (typeof notificaciones_activas !== 'boolean') {
        return res.status(400).json({ message: 'El valor de notificaciones_activas no es válido.' });
    }
    try {
        const query = `
            UPDATE notes SET notificaciones_activas = $1
            WHERE id = $2 AND user_id = $3
            RETURNING *
        `;
        const result = await pool.query(query, [notificaciones_activas, noteId, userId]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Nota no encontrada o no tienes permiso.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al actualizar el estado de las notificaciones.' });
    }
});

app.get('/api/settings/quicknote', authMiddleware, async (req, res) => {
    try { 
        const userId = req.user.id;
        const result = await pool.query("SELECT value FROM settings WHERE user_id = $1 AND key = 'quickNote'", [userId]);
        res.json({ value: result.rows[0]?.value || '' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al obtener la nota rápida' });
    }
});

app.put('/api/settings/quicknote', authMiddleware, async (req, res) => {
    const { content } = req.body;
    const userId = req.user.id;
    try {
        await pool.query(`
            INSERT INTO settings (user_id, key, value) VALUES ($1, 'quickNote', $2)
            ON CONFLICT (user_id, key) DO UPDATE SET value = $2;
        `, [userId, content]);
        res.status(200).json({ message: 'OK' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al guardar la nota rápida' });
    }
});


// ✅ AÑADIDO: Nuevo Endpoint para guardar la suscripción Push
app.post('/api/save-subscription', authMiddleware, async (req, res) => {
  const subscription = req.body;
  const userId = req.user.id;
  try {
    const query = `
      INSERT INTO push_subscriptions (user_id, subscription_details) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET subscription_details = $2;
    `;
    await pool.query(query, [userId, subscription]);
    res.status(201).json({ message: 'Suscripción guardada.' });
  } catch (err) {
    console.error("Error al guardar la suscripción:", err);
    res.status(500).json({ message: "No se pudo guardar la suscripción." });
  }
});


// ✅ AÑADIDO: Lógica periódica para enviar notificaciones Push
const checkNotesAndSendNotifications = async () => {
    console.log('⏰ Verificando notas para enviar notificaciones...', new Date().toISOString());
    const query = `
        SELECT 
            n.id as note_id, 
            n.nombre, 
            ps.subscription_details,
            ps.user_id
        FROM notes n
        JOIN push_subscriptions ps ON n.user_id = ps.user_id
        WHERE 
            n.notificaciones_activas = true AND 
            n.fecha_hora IS NOT NULL AND
            (
                (n.fecha_hora BETWEEN NOW() + interval '3 hours 59 minutes' AND NOW() + interval '4 hours 1 minute') OR
                (n.fecha_hora BETWEEN NOW() + interval '23 hours 59 minutes' AND NOW() + interval '24 hours 1 minute') OR
                (n.fecha_hora BETWEEN NOW() + interval '47 hours 59 minutes' AND NOW() + interval '48 hours 1 minute')
            )`;

    try {
        const { rows } = await pool.query(query);

        for (const note of rows) {
            const payload = JSON.stringify({
                title: 'Recordatorio de Nota',
                body: `Tu nota "${note.nombre || '(Sin Título)'}" está próxima a vencer.`
            });
            try {
                await webpush.sendNotification(note.subscription_details, payload);
                console.log(`✅ Notificación enviada para la nota: ${note.nombre}`);
            } catch (error) {
                if (error.statusCode === 410) {
                    await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [note.user_id]);
                    console.log(`Suscripción expirada eliminada para el usuario ${note.user_id}`);
                } else {
                    console.error(`Error enviando notificación para la nota ${note.note_id}:`, error.body);
                }
            }
        }
    } catch (dbError) {
        console.error('Error de base de datos al verificar notas:', dbError);
    }
};

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
  // ✅ AÑADIDO: Inicia el verificador de notificaciones para que se ejecute cada minuto
  setInterval(checkNotesAndSendNotifications, 60000);
});
// =================================================================
// 🚀 SERVIDOR DE NOTAS - VERSIÓN 6.1 (CON DEPURACIÓN DE AUTH)
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

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());


// ==============================================================
// 🔐 MIDDLEWARE DE AUTENTICACIÓN (CON LOGS DE DEPURACIÓN)
// ==============================================================
const authMiddleware = async (req, res, next) => {
    console.log(`--- Iniciando authMiddleware para: ${req.method} ${req.path} ---`);
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('Error: No se encontró el encabezado de autorización o no es "Bearer".');
        return res.status(401).json({ message: 'Acceso no autorizado: No se proporcionó token.' });
    }

    const token = authHeader.split(' ')[1];
    console.log('Token recibido:', token ? `...${token.slice(-10)}` : 'null'); // Muestra los últimos 10 chars del token

    try {
        console.log('Intentando verificar el token con Supabase...');
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error) {
            console.error('Error de Supabase al verificar el token:', error.message);
            throw new Error('Token inválido o expirado.');
        }
        
        if (!user) {
            console.error('Supabase no devolvió un usuario para este token.');
            throw new Error('Token no válido.');
        }

        console.log('✅ Token verificado. Usuario:', user.email, 'ID:', user.id);
        req.user = user;
        next();
    } catch (error) {
        console.error('Catch final en authMiddleware:', error.message);
        return res.status(401).json({ message: 'Acceso no autorizado: ' + error.message });
    }
};

// --- ENDPOINTS DE LA API ---

// Endpoint público para verificar el estado del servidor
app.get('/api/version-check', (req, res) => {
  res.json({ 
    version: "6.1-DEBUG", 
    message: "Backend desplegado y conectado correctamente." 
  });
});

// Todas las rutas de notas ahora están protegidas por el authMiddleware
app.get('/api/notes', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const query = `
      SELECT id, nombre, contenido, fecha_hora, to_char(fecha_hora, 'YYYY-MM-DD') AS fecha, 
             to_char(fecha_hora, 'HH24:MI') AS hora, color, tipo, fijada,
             attachment_url, attachment_filename 
      FROM notes 
      WHERE user_id = $1
      ORDER BY fecha_hora ASC NULLS LAST, id ASC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ message: "Error al obtener las notas" }); }
});

app.post('/api/notes', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { nombre = "", contenido = "", fecha_hora = null, color = "#f1e363ff", tipo = "Clase", fijada = false } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO notes(nombre, contenido, fecha_hora, color, tipo, fijada, user_id) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [nombre, contenido, fecha_hora, color, tipo, fijada, userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: "Error al crear la nota" }); }
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
    } catch (err) { res.status(500).json({ message: "Error al borrar la nota" }); }
});

app.post('/api/notes/:id/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const noteId = req.params.id;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: 'No se ha proporcionado ningún archivo.' });
  }

  const fileName = `${req.user.id}/${noteId}-${Date.now()}-${file.originalname}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('adjuntos')
      .upload(fileName, file.buffer, { contentType: file.mimetype });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('adjuntos').getPublicUrl(fileName);
    
    await pool.query(
      'UPDATE notes SET attachment_url = $1, attachment_filename = $2 WHERE id = $3 AND user_id = $4',
      [publicUrl, file.originalname, noteId, req.user.id]
    );

    res.status(200).json({ message: 'OK', attachment_url: publicUrl, attachment_filename: file.originalname });
  } catch (err) {
    console.error("Error en la subida:", err);
    res.status(500).json({ message: 'Error del servidor al subir el archivo.' });
  }
});

// Endpoints de nota rápida (protegidos)
app.get('/api/settings/quicknote', authMiddleware, async (req, res) => { 
    try { 
        const result = await pool.query("SELECT value FROM settings WHERE key = 'quickNote'"); 
        res.json({ value: result.rows[0]?.value || '' }); 
    } catch (err) { 
        res.status(500).json({ message: 'Error' }); 
    } 
});
app.put('/api/settings/quicknote', authMiddleware, async (req, res) => { 
    const { content } = req.body; 
    try { 
        await pool.query(`INSERT INTO settings (key, value) VALUES ('quickNote', $1) ON CONFLICT (key) DO UPDATE SET value = $1;`, [content]); 
        res.status(200).json({ message: 'OK' }); 
    } catch (err) { 
        res.status(500).json({ message: 'Error' }); 
    } 
});


app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
// =========================================================
// 🚀 SERVIDOR DE NOTAS - VERSIÓN 2.5 (SOLUCIÓN DEFINITIVA DE FECHAS)
// =========================================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ... (ensureTablesExist no cambia, la dejamos por robustez)
async function ensureTablesExist() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS notes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nombre TEXT, contenido TEXT, fecha_hora TIMESTAMPTZ, color VARCHAR(20), tipo VARCHAR(20), fijada BOOLEAN);`);
    await client.query(`CREATE TABLE IF NOT EXISTS settings (key VARCHAR(50) PRIMARY KEY, value TEXT);`);
    console.log('✅ Tablas verificadas.');
  } catch (err) { console.error('❌ Error al verificar tablas:', err.stack); } finally { client.release(); }
}

const app = express();
// ---- INICIO DEL BLOQUE DE DEPURACIÓN ----
console.log("--- VERIFICANDO VARIABLE DE ENTORNO ---");
if (process.env.DATABASE_URL) {
  console.log("DATABASE_URL encontrada. Primeros 45 caracteres:", process.env.DATABASE_URL.substring(0, 45) + "...");
} else {
  console.log("ERROR CRÍTICO: La variable DATABASE_URL no fue encontrada.");
}
console.log("------------------------------------");
// ---- FIN DEL BLOQUE DE DEPURACIÓN ----
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// ---- NUEVO ENDPOINT DE VERIFICACIÓN ----
app.get('/api/version', (req, res) => {
  res.json({ version: "2.5", message: "Backend con fechas corregidas está activo." });
});

// GET: Obtener todas las notas
app.get('/api/notes', async (req, res) => {
  try {
    // Ordenamos con NULLS LAST para que las notas sin fecha siempre vayan al final.
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
  // ---- LÓGICA CORREGIDA ----
  // El valor por defecto es null. El servidor ya no asignará fechas por su cuenta.
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

// (Endpoints de nota rápida sin cambios)
app.get('/api/settings/quicknote', async (req, res) => { try { const result = await pool.query("SELECT value FROM settings WHERE key = 'quickNote'"); res.json({ value: result.rows[0]?.value || '' }); } catch (err) { res.status(500).json({ message: 'Error' }); } });
app.put('/api/settings/quicknote', async (req, res) => { const { content } = req.body; try { await pool.query(`INSERT INTO settings (key, value) VALUES ('quickNote', $1) ON CONFLICT (key) DO UPDATE SET value = $1;`, [content]); res.status(200).json({ message: 'OK' }); } catch (err) { res.status(500).json({ message: 'Error' }); } });

app.listen(PORT, async () => {
  await ensureTablesExist(); 
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
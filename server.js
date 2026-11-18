const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false }
    })
  : null;

app.use(express.json({ limit: '1mb' }));

// CORRECTION : les fichiers sont chargés depuis la racine
app.use(express.static(__dirname));

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      whatsapp TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS records (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('orders','bookings','customers','catalog')),
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS records_business_kind_idx
    ON records(business_id, kind, created_at DESC);
  `);
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Connexion requise.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: 'Session expirée. Reconnectez-vous.'
    });
  }
}

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    app: 'Rapid Services',
    database: !!pool,
    version: '2.0.0'
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        error: 'Base de données non configurée. Ajoutez DATABASE_URL.'
      });
    }

    if (!JWT_SECRET) {
      return res.status(503).json({
        error: 'JWT_SECRET non configuré.'
      });
    }

    const {
      businessName,
      businessType,
      name,
      email,
      password,
      currency = 'USD',
      whatsapp = ''
    } = req.body || {};

    if (
      !businessName ||
      !businessType ||
      !name ||
      !email ||
      !password ||
      password.length < 10
    ) {
      return res.status(400).json({
        error: 'Remplissez tous les champs. Le mot de passe doit contenir au moins 10 caractères.'
      });
    }

    const exists = await pool.query(
      'SELECT id FROM users WHERE email=$1',
      [String(email).toLowerCase().trim()]
    );

    if (exists.rowCount) {
      return res.status(409).json({
        error: 'Cette adresse e-mail possède déjà un compte.'
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const b = await client.query(
        `INSERT INTO businesses(name,type,currency,whatsapp)
         VALUES($1,$2,$3,$4)
         RETURNING id,name,type,currency,whatsapp`,
        [businessName, businessType, currency, whatsapp]
      );

      const hash = await bcrypt.hash(password, 12);

      const u = await client.query(
        `INSERT INTO users(business_id,name,email,password_hash)
         VALUES($1,$2,$3,$4)
         RETURNING id,name,email,role`,
        [
          b.rows[0].id,
          name,
          String(email).toLowerCase().trim(),
          hash
        ]
      );

      await client.query('COMMIT');

      const token = jwt.sign(
        {
          userId: u.rows[0].id,
          businessId: b.rows[0].id,
          role: 'owner'
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        token,
        user: u.rows[0],
        business: b.rows[0]
      });

    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: 'Impossible de créer le compte.'
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!pool || !JWT_SECRET) {
      return res.status(503).json({
        error: 'Service non configuré.'
      });
    }

    const { email, password } = req.body || {};

    const q = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.password_hash,
        u.role,
        b.id business_id,
        b.name business_name,
        b.type,
        b.currency,
        b.whatsapp
       FROM users u
       JOIN businesses b ON b.id=u.business_id
       WHERE u.email=$1`,
      [String(email || '').toLowerCase().trim()]
    );

    if (
      !q.rowCount ||
      !await bcrypt.compare(password || '', q.rows[0].password_hash)
    ) {
      return res.status(401).json({
        error: 'E-mail ou mot de passe incorrect.'
      });
    }

    const r = q.rows[0];

    const token = jwt.sign(
      {
        userId: r.id,
        businessId: r.business_id,
        role: r.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role
      },
      business: {
        id: r.business_id,
        name: r.business_name,
        type: r.type,
        currency: r.currency,
        whatsapp: r.whatsapp
      }
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: 'Erreur de connexion.'
    });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        b.id business_id,
        b.name business_name,
        b.type,
        b.currency,
        b.whatsapp
       FROM users u
       JOIN businesses b ON b.id=u.business_id
       WHERE u.id=$1 AND b.id=$2`,
      [req.user.userId, req.user.businessId]
    );

    if (!q.rowCount) {
      return res.status(404).json({
        error: 'Compte introuvable.'
      });
    }

    const r = q.rows[0];

    res.json({
      user: {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role
      },
      business: {
        id: r.business_id,
        name: r.business_name,
        type: r.type,
        currency: r.currency,
        whatsapp: r.whatsapp
      }
    });

  } catch (e) {
    res.status(500).json({
      error: 'Erreur serveur.'
    });
  }
});

app.get('/api/records/:kind', auth, async (req, res) => {
  const { kind } = req.params;

  if (!['orders', 'bookings', 'customers', 'catalog'].includes(kind)) {
    return res.status(400).json({
      error: 'Catégorie invalide.'
    });
  }

  try {
    const q = await pool.query(
      `SELECT id,data,created_at,updated_at
       FROM records
       WHERE business_id=$1 AND kind=$2
       ORDER BY created_at DESC`,
      [req.user.businessId, kind]
    );

    res.json(
      q.rows.map(r => ({
        id: r.id,
        ...r.data,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    );

  } catch (e) {
    res.status(500).json({
      error: 'Lecture impossible.'
    });
  }
});

app.post('/api/records/:kind', auth, async (req, res) => {
  const { kind } = req.params;

  if (!['orders', 'bookings', 'customers', 'catalog'].includes(kind)) {
    return res.status(400).json({
      error: 'Catégorie invalide.'
    });
  }

  try {
    const data = req.body || {};

    delete data.business_id;
    delete data.businessId;

    const q = await pool.query(
      `INSERT INTO records(business_id,kind,data)
       VALUES($1,$2,$3::jsonb)
       RETURNING id,data,created_at`,
      [
        req.user.businessId,
        kind,
        JSON.stringify(data)
      ]
    );

    res.status(201).json({
      id: q.rows[0].id,
      ...q.rows[0].data,
      createdAt: q.rows[0].created_at
    });

  } catch (e) {
    res.status(500).json({
      error: 'Enregistrement impossible.'
    });
  }
});

app.put('/api/records/:kind/:id', auth, async (req, res) => {
  const { kind, id } = req.params;

  if (!['orders', 'bookings', 'customers', 'catalog'].includes(kind)) {
    return res.status(400).json({
      error: 'Catégorie invalide.'
    });
  }

  try {
    const data = req.body || {};

    delete data.business_id;
    delete data.businessId;

    const q = await pool.query(
      `UPDATE records
       SET data=$1::jsonb, updated_at=NOW()
       WHERE id=$2 AND business_id=$3 AND kind=$4
       RETURNING id,data,updated_at`,
      [
        JSON.stringify(data),
        id,
        req.user.businessId,
        kind
      ]
    );

    if (!q.rowCount) {
      return res.status(404).json({
        error: 'Élément introuvable.'
      });
    }

    res.json({
      id: q.rows[0].id,
      ...q.rows[0].data,
      updatedAt: q.rows[0].updated_at
    });

  } catch (e) {
    res.status(500).json({
      error: 'Modification impossible.'
    });
  }
});

app.delete('/api/records/:kind/:id', auth, async (req, res) => {
  const { kind, id } = req.params;

  if (!['orders', 'bookings', 'customers', 'catalog'].includes(kind)) {
    return res.status(400).json({
      error: 'Catégorie invalide.'
    });
  }

  try {
    const q = await pool.query(
      `DELETE FROM records
       WHERE id=$1 AND business_id=$2 AND kind=$3`,
      [id, req.user.businessId, kind]
    );

    if (!q.rowCount) {
      return res.status(404).json({
        error: 'Élément introuvable.'
      });
    }

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({
      error: 'Suppression impossible.'
    });
  }
});

// CORRECTION : index.html est directement à la racine
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Rapid Services listening on ${PORT}`);
    });
  })
  .catch(e => {
    console.error('Database initialization failed', e);
    process.exit(1);
  });

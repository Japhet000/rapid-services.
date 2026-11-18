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

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

const VALID_KINDS = [
  'orders',
  'bookings',
  'customers',
  'catalog'
];

// --------------------------------------------------
// INITIALISATION DE LA BASE DE DONNÉES
// --------------------------------------------------

async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL non configuré.');
    return;
  }

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
      business_id BIGINT NOT NULL
        REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS records (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL
        REFERENCES businesses(id) ON DELETE CASCADE,
      kind TEXT NOT NULL
        CHECK (kind IN ('orders','bookings','customers','catalog')),
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS records_business_kind_idx
    ON records(business_id, kind, created_at DESC);

    CREATE TABLE IF NOT EXISTS business_settings (
      business_id BIGINT PRIMARY KEY
        REFERENCES businesses(id) ON DELETE CASCADE,
      branding JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Base de données initialisée.');
}

// --------------------------------------------------
// AUTHENTIFICATION
// --------------------------------------------------

function auth(req, res, next) {
  if (!JWT_SECRET) {
    return res.status(503).json({
      error: 'JWT_SECRET non configuré.'
    });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  if (!token) {
    return res.status(401).json({
      error: 'Connexion requise.'
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);

    if (!req.user.businessId || !req.user.userId) {
      return res.status(401).json({
        error: 'Session invalide. Reconnectez-vous.'
      });
    }

    next();
  } catch {
    return res.status(401).json({
      error: 'Session expirée. Reconnectez-vous.'
    });
  }
}

function ownerOnly(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({
      error: 'Action réservée au propriétaire.'
    });
  }

  next();
}

function validKind(req, res, next) {
  if (!VALID_KINDS.includes(req.params.kind)) {
    return res.status(400).json({
      error: 'Catégorie invalide.'
    });
  }

  next();
}

function validObjectBody(req, res, next) {
  if (
    !req.body ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body)
  ) {
    return res.status(400).json({
      error: 'Données invalides.'
    });
  }

  next();
}

// --------------------------------------------------
// SANTÉ DU SERVEUR
// --------------------------------------------------

app.get('/api/health', async (_req, res) => {
  let databaseConnected = false;

  if (pool) {
    try {
      await pool.query('SELECT 1');
      databaseConnected = true;
    } catch {
      databaseConnected = false;
    }
  }

  res.json({
    ok: true,
    app: 'Rapid Services',
    database: databaseConnected,
    version: '2.1.0'
  });
});

// --------------------------------------------------
// INSCRIPTION
// --------------------------------------------------

app.post('/api/auth/register', async (req, res) => {
  if (!pool || !JWT_SECRET) {
    return res.status(503).json({
      error: 'Service non configuré.'
    });
  }

  try {
    const {
      businessName,
      businessType,
      name,
      email,
      password,
      currency = 'USD',
      whatsapp = ''
    } = req.body || {};

    const cleanBusinessName = String(businessName || '').trim();
    const cleanBusinessType = String(businessType || '').trim();
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').toLowerCase().trim();

    if (
      !cleanBusinessName ||
      !cleanBusinessType ||
      !cleanName ||
      !cleanEmail ||
      !password ||
      String(password).length < 10
    ) {
      return res.status(400).json({
        error: 'Remplissez tous les champs. Le mot de passe doit contenir au moins 10 caractères.'
      });
    }

    const exists = await pool.query(
      'SELECT id FROM users WHERE email=$1',
      [cleanEmail]
    );

    if (exists.rowCount) {
      return res.status(409).json({
        error: 'Cette adresse e-mail possède déjà un compte.'
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const businessResult = await client.query(
        `INSERT INTO businesses
          (name, type, currency, whatsapp)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, type, currency, whatsapp`,
        [
          cleanBusinessName,
          cleanBusinessType,
          String(currency || 'USD').trim(),
          String(whatsapp || '').trim()
        ]
      );

      const business = businessResult.rows[0];

      const passwordHash = await bcrypt.hash(
        String(password),
        12
      );

      const userResult = await client.query(
        `INSERT INTO users
          (business_id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role`,
        [
          business.id,
          cleanName,
          cleanEmail,
          passwordHash
        ]
      );

      const user = userResult.rows[0];

      await client.query('COMMIT');

      const token = jwt.sign(
        {
          userId: user.id,
          businessId: business.id,
          role: user.role
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.status(201).json({
        token,
        user,
        business
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Register error:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Cette adresse e-mail possède déjà un compte.'
      });
    }

    return res.status(500).json({
      error: 'Impossible de créer le compte.'
    });
  }
});

// --------------------------------------------------
// CONNEXION
// --------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  if (!pool || !JWT_SECRET) {
    return res.status(503).json({
      error: 'Service non configuré.'
    });
  }

  try {
    const { email, password } = req.body || {};

    const cleanEmail = String(email || '')
      .toLowerCase()
      .trim();

    if (!cleanEmail || !password) {
      return res.status(400).json({
        error: 'Saisissez votre e-mail et votre mot de passe.'
      });
    }

    const result = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.password_hash,
        u.role,
        b.id AS business_id,
        b.name AS business_name,
        b.type,
        b.currency,
        b.whatsapp
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.email = $1`,
      [cleanEmail]
    );

    if (
      !result.rowCount ||
      !await bcrypt.compare(
        String(password),
        result.rows[0].password_hash
      )
    ) {
      return res.status(401).json({
        error: 'E-mail ou mot de passe incorrect.'
      });
    }

    const row = result.rows[0];

    const token = jwt.sign(
      {
        userId: row.id,
        businessId: row.business_id,
        role: row.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role
      },
      business: {
        id: row.business_id,
        name: row.business_name,
        type: row.type,
        currency: row.currency,
        whatsapp: row.whatsapp
      }
    });

  } catch (error) {
    console.error('Login error:', error);

    return res.status(500).json({
      error: 'Erreur de connexion.'
    });
  }
});

// --------------------------------------------------
// PROFIL CONNECTÉ
// --------------------------------------------------

app.get('/api/me', auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: 'Base de données indisponible.'
    });
  }

  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        b.id AS business_id,
        b.name AS business_name,
        b.type,
        b.currency,
        b.whatsapp
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1 AND b.id = $2`,
      [
        req.user.userId,
        req.user.businessId
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Compte introuvable.'
      });
    }

    const row = result.rows[0];

    return res.json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role
      },
      business: {
        id: row.business_id,
        name: row.business_name,
        type: row.type,
        currency: row.currency,
        whatsapp: row.whatsapp
      }
    });

  } catch (error) {
    console.error('Profile error:', error);

    return res.status(500).json({
      error: 'Erreur serveur.'
    });
  }
});

// --------------------------------------------------
// LECTURE DES ENREGISTREMENTS
// --------------------------------------------------

app.get(
  '/api/records/:kind',
  auth,
  validKind,
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        error: 'Base de données indisponible.'
      });
    }

    try {
      const result = await pool.query(
        `SELECT id, data, created_at, updated_at
         FROM records
         WHERE business_id = $1 AND kind = $2
         ORDER BY created_at DESC`,
        [
          req.user.businessId,
          req.params.kind
        ]
      );

      return res.json(
        result.rows.map(row => ({
          id: row.id,
          ...row.data,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      );

    } catch (error) {
      console.error('Records read error:', error);

      return res.status(500).json({
        error: 'Lecture impossible.'
      });
    }
  }
);

// --------------------------------------------------
// CRÉATION D'UN ENREGISTREMENT
// --------------------------------------------------

app.post(
  '/api/records/:kind',
  auth,
  validKind,
  validObjectBody,
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        error: 'Base de données indisponible.'
      });
    }

    try {
      const data = { ...req.body };

      delete data.business_id;
      delete data.businessId;
      delete data.id;

      const result = await pool.query(
        `INSERT INTO records (business_id, kind, data)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id, data, created_at, updated_at`,
        [
          req.user.businessId,
          req.params.kind,
          JSON.stringify(data)
        ]
      );

      const row = result.rows[0];

      return res.status(201).json({
        id: row.id,
        ...row.data,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });

    } catch (error) {
      console.error('Record create error:', error);

      return res.status(500).json({
        error: 'Enregistrement impossible.'
      });
    }
  }
);

// --------------------------------------------------
// MODIFICATION D'UN ENREGISTREMENT
// --------------------------------------------------

app.put(
  '/api/records/:kind/:id',
  auth,
  validKind,
  validObjectBody,
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        error: 'Base de données indisponible.'
      });
    }

    try {
      const data = { ...req.body };

      delete data.business_id;
      delete data.businessId;
      delete data.id;

      const result = await pool.query(
        `UPDATE records
         SET data = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2
           AND business_id = $3
           AND kind = $4
         RETURNING id, data, updated_at`,
        [
          JSON.stringify(data),
          req.params.id,
          req.user.businessId,
          req.params.kind
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Élément introuvable.'
        });
      }

      const row = result.rows[0];

      return res.json({
        id: row.id,
        ...row.data,
        updatedAt: row.updated_at
      });

    } catch (error) {
      console.error('Record update error:', error);

      return res.status(500).json({
        error: 'Modification impossible.'
      });
    }
  }
);

// --------------------------------------------------
// SUPPRESSION D'UN ENREGISTREMENT
// --------------------------------------------------

app.delete(
  '/api/records/:kind/:id',
  auth,
  validKind,
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        error: 'Base de données indisponible.'
      });
    }

    try {
      const result = await pool.query(
        `DELETE FROM records
         WHERE id = $1
           AND business_id = $2
           AND kind = $3`,
        [
          req.params.id,
          req.user.businessId,
          req.params.kind
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Élément introuvable.'
        });
      }

      return res.json({
        ok: true
      });

    } catch (error) {
      console.error('Record delete error:', error);

      return res.status(500).json({
        error: 'Suppression impossible.'
      });
    }
  }
);

// --------------------------------------------------
// PARAMÈTRES DE PERSONNALISATION
// --------------------------------------------------

// Lire les paramètres de l'entreprise connectée
app.get('/api/settings', auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: 'Base de données indisponible.'
    });
  }

  try {
    const result = await pool.query(
      `SELECT branding
       FROM business_settings
       WHERE business_id = $1`,
      [req.user.businessId]
    );

    return res.json({
      branding: result.rowCount
        ? result.rows[0].branding
        : {}
    });

  } catch (error) {
    console.error('Settings read error:', error);

    return res.status(500).json({
      error: 'Impossible de lire les paramètres.'
    });
  }
});

// Enregistrer les paramètres de l'entreprise
app.put(
  '/api/settings',
  auth,
  ownerOnly,
  validObjectBody,
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        error: 'Base de données indisponible.'
      });
    }

    try {
      const branding = req.body.branding;

      if (
        !branding ||
        typeof branding !== 'object' ||
        Array.isArray(branding)
      ) {
        return res.status(400).json({
          error: 'Paramètres de personnalisation invalides.'
        });
      }

      const result = await pool.query(
        `INSERT INTO business_settings
          (business_id, branding, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (business_id)
         DO UPDATE SET
           branding = EXCLUDED.branding,
           updated_at = NOW()
         RETURNING branding, updated_at`,
        [
          req.user.businessId,
          JSON.stringify(branding)
        ]
      );

      return res.json({
        ok: true,
        branding: result.rows[0].branding,
        updatedAt: result.rows[0].updated_at
      });

    } catch (error) {
      console.error('Settings save error:', error);

      return res.status(500).json({
        error: 'Impossible de sauvegarder les paramètres.'
      });
    }
  }
);

// --------------------------------------------------
// PAGE PRINCIPALE
// --------------------------------------------------

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --------------------------------------------------
// DÉMARRAGE
// --------------------------------------------------

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Rapid Services listening on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });

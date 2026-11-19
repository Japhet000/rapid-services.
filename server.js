const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    })
  : null;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
    CREATE TABLE IF NOT EXISTS business_settings (
      business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      branding JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      plan TEXT NOT NULL CHECK (plan IN ('basic','professional','business')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subscription_payments (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      plan TEXT NOT NULL CHECK (plan IN ('basic','professional','business')),
      method TEXT NOT NULL CHECK (method IN ('lumicash','enoti','usdt_bep20')),
      amount_bif INTEGER NOT NULL,
      amount_usd NUMERIC(10,2) NOT NULL,
      reference TEXT NOT NULL,
      sender_phone TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      admin_note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_reference_unique
      ON subscription_payments(method, LOWER(reference));
    CREATE INDEX IF NOT EXISTS subscription_payments_status_created_idx
      ON subscription_payments(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS employee_locations (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
      accuracy DOUBLE PRECISION, shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Connexion requise.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }
}
function ownerOnly(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Réservé au propriétaire.' });
  next();
}
function validKind(kind) {
  return ['orders', 'bookings', 'customers', 'catalog'].includes(kind);
}

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, app: 'Rapid Services', database: !!pool, version: '3.4.0' });
});

app.post('/api/auth/register', async (req, res) => {
  const client = await pool?.connect().catch(() => null);
  try {
    if (!pool) return res.status(503).json({ error: 'Base de données non configurée. Ajoutez DATABASE_URL.' });
    if (!JWT_SECRET) return res.status(503).json({ error: 'JWT_SECRET non configuré.' });
    const { businessName, businessType, name, email, password, currency = 'USD', whatsapp = '' } = req.body || {};
    if (!businessName || !businessType || !name || !email || !password || password.length < 10)
      return res.status(400).json({ error: 'Remplissez tous les champs. Le mot de passe doit contenir au moins 10 caractères.' });
    const normalizedEmail = String(email).toLowerCase().trim();
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [normalizedEmail]);
    if (exists.rowCount) return res.status(409).json({ error: 'Cette adresse e-mail possède déjà un compte.' });
    await client.query('BEGIN');
    const b = await client.query(
      'INSERT INTO businesses(name,type,currency,whatsapp) VALUES($1,$2,$3,$4) RETURNING id,name,type,currency,whatsapp',
      [businessName, businessType, currency, whatsapp]
    );
    const hash = await bcrypt.hash(password, 12);
    const u = await client.query(
      'INSERT INTO users(business_id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',
      [b.rows[0].id, name, normalizedEmail, hash]
    );
    await client.query('COMMIT');
    const token = jwt.sign({ userId: u.rows[0].id, businessId: b.rows[0].id, role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: u.rows[0], business: b.rows[0] });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Impossible de créer le compte.' });
  } finally {
    client?.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!pool || !JWT_SECRET) return res.status(503).json({ error: 'Service non configuré.' });
    const { email, password } = req.body || {};
    const q = await pool.query(
      `SELECT u.id,u.name,u.email,u.password_hash,u.role,
              b.id business_id,b.name business_name,b.type,b.currency,b.whatsapp
       FROM users u JOIN businesses b ON b.id=u.business_id WHERE u.email=$1`,
      [String(email || '').toLowerCase().trim()]
    );
    if (!q.rowCount || !await bcrypt.compare(password || '', q.rows[0].password_hash))
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    const r = q.rows[0];
    const token = jwt.sign({ userId: r.id, businessId: r.business_id, role: r.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: r.id, name: r.name, email: r.email, role: r.role },
      business: { id: r.business_id, name: r.business_name, type: r.type, currency: r.currency, whatsapp: r.whatsapp }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur de connexion.' });
  }
});

// Owner-managed staff accounts. Employees belong to exactly one business.
app.get('/api/team', auth, ownerOnly, async (req, res) => {
  try {
    const q = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.created_at,
      l.latitude,l.longitude,l.accuracy,l.shared_at
      FROM users u LEFT JOIN employee_locations l ON l.user_id=u.id AND l.business_id=u.business_id
      WHERE u.business_id=$1 AND u.role='employee' ORDER BY u.created_at DESC`, [req.user.businessId]);
    res.json({ employees: q.rows });
  } catch (e) { console.error(e); res.status(500).json({error:'Impossible de charger le personnel.'}); }
});
app.post('/api/team', auth, ownerOnly, async (req, res) => {
  try {
    const {name,email,password}=req.body||{};
    const cleanEmail=String(email||'').toLowerCase().trim();
    if(!name||!cleanEmail||String(password||'').length<10) return res.status(400).json({error:'Nom, e-mail et mot de passe de 10 caractères minimum requis.'});
    const hash=await bcrypt.hash(password,12);
    const q=await pool.query(`INSERT INTO users(business_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'employee') RETURNING id,name,email,role`,[req.user.businessId,String(name).trim(),cleanEmail,hash]);
    res.status(201).json({employee:q.rows[0]});
  } catch(e) { if(e.code==='23505') return res.status(409).json({error:'Cet e-mail est déjà utilisé.'}); console.error(e);res.status(500).json({error:'Création du compte employé impossible.'}); }
});
app.delete('/api/team/:id', auth, ownerOnly, async (req,res)=>{
  try { const q=await pool.query("DELETE FROM users WHERE id=$1 AND business_id=$2 AND role='employee'",[req.params.id,req.user.businessId]); if(!q.rowCount)return res.status(404).json({error:'Employé introuvable.'});res.json({ok:true}); }
  catch(e){console.error(e);res.status(500).json({error:'Suppression impossible.'});}
});
// Location is opt-in: employee browser permission is required. Updates only while app is open.
app.post('/api/location', auth, async (req,res)=>{
  try {
    const {latitude,longitude,accuracy}=req.body||{};
    if(req.user.role!=='employee') return res.status(403).json({error:'Cette fonction est réservée aux comptes employés.'});
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180) return res.status(400).json({error:'Coordonnées GPS invalides.'});
    await pool.query(`INSERT INTO employee_locations(user_id,business_id,latitude,longitude,accuracy,shared_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(user_id) DO UPDATE SET business_id=EXCLUDED.business_id,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,accuracy=EXCLUDED.accuracy,shared_at=NOW()`,[req.user.userId,req.user.businessId,latitude,longitude,Number.isFinite(accuracy)?accuracy:null]);
    res.json({ok:true,sharedAt:new Date().toISOString()});
  } catch(e){console.error(e);res.status(500).json({error:'Envoi de la position impossible.'});}
});
app.delete('/api/location', auth, async (req,res)=>{try{await pool.query('DELETE FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.user.userId,req.user.businessId]);res.json({ok:true});}catch(e){res.status(500).json({error:'Arrêt du partage impossible.'});}});

app.get('/api/me', auth, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT u.id,u.name,u.email,u.role,b.id business_id,b.name business_name,b.type,b.currency,b.whatsapp
       FROM users u JOIN businesses b ON b.id=u.business_id
       WHERE u.id=$1 AND b.id=$2`,
      [req.user.userId, req.user.businessId]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'Compte introuvable.' });
    const r = q.rows[0];
    res.json({
      user: { id: r.id, name: r.name, email: r.email, role: r.role },
      business: { id: r.business_id, name: r.business_name, type: r.type, currency: r.currency, whatsapp: r.whatsapp }
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Branding is stored in PostgreSQL per business, so it follows the account across devices.
app.get('/api/settings', auth, async (req, res) => {
  try {
    const q = await pool.query('SELECT branding FROM business_settings WHERE business_id=$1', [req.user.businessId]);
    res.json({ branding: q.rows[0]?.branding || {} });
  } catch (e) {
    res.status(500).json({ error: 'Lecture des paramètres impossible.' });
  }
});
app.put('/api/settings', auth, ownerOnly, async (req, res) => {
  try {
    const branding = req.body?.branding;
    if (!branding || typeof branding !== 'object' || Array.isArray(branding))
      return res.status(400).json({ error: 'Paramètres invalides.' });
    const serialized = JSON.stringify(branding);
    if (serialized.length > 1400000) return res.status(413).json({ error: 'Logo ou paramètres trop volumineux.' });
    await pool.query(
      `INSERT INTO business_settings(business_id,branding) VALUES($1,$2::jsonb)
       ON CONFLICT(business_id) DO UPDATE SET branding=EXCLUDED.branding,updated_at=NOW()`,
      [req.user.businessId, serialized]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Enregistrement des paramètres impossible.' });
  }
});

const SUBSCRIPTION_PLANS = {
  basic: { name: 'Basic', amountBif: 60000, amountUsd: 10 },
  professional: { name: 'Professional', amountBif: 90000, amountUsd: 15 },
  business: { name: 'Business', amountBif: 120000, amountUsd: 20 }
};
const PAYMENT_METHODS = ['lumicash', 'enoti', 'usdt_bep20'];

app.get('/api/subscription', auth, async (req, res) => {
  try {
    const [sub, payments] = await Promise.all([
      pool.query('SELECT plan,status,starts_at,expires_at FROM subscriptions WHERE business_id=$1', [req.user.businessId]),
      pool.query(`SELECT id,plan,method,amount_bif,amount_usd,reference,status,admin_note,created_at,reviewed_at
                  FROM subscription_payments WHERE business_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user.businessId])
    ]);
    const current = sub.rows[0] || null;
    if (current && new Date(current.expires_at) <= new Date() && current.status === 'active') {
      await pool.query("UPDATE subscriptions SET status='expired',updated_at=NOW() WHERE business_id=$1", [req.user.businessId]);
      current.status = 'expired';
    }
    res.json({ plans: SUBSCRIPTION_PLANS, subscription: current, payments: payments.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Impossible de charger l’abonnement.' });
  }
});

app.post('/api/subscription/payments', auth, ownerOnly, async (req, res) => {
  try {
    const { plan, method, reference, senderPhone = '' } = req.body || {};
    const selectedPlan = SUBSCRIPTION_PLANS[plan];
    if (!selectedPlan) return res.status(400).json({ error: 'Formule invalide.' });
    if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: 'Moyen de paiement invalide.' });
    const cleanReference = String(reference || '').trim();
    if (cleanReference.length < 5 || cleanReference.length > 160)
      return res.status(400).json({ error: 'Saisissez une référence de transaction valide.' });
    if (method === 'usdt_bep20' && !/^0x[a-fA-F0-9]{64}$/.test(cleanReference))
      return res.status(400).json({ error: 'Pour USDT BEP20, saisissez le hash de transaction de 0x suivi de 64 caractères hexadécimaux.' });
    if (method !== 'usdt_bep20' && cleanReference.length < 5)
      return res.status(400).json({ error: 'Référence de paiement invalide.' });
    const q = await pool.query(
      `INSERT INTO subscription_payments(business_id,plan,method,amount_bif,amount_usd,reference,sender_phone)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,plan,method,amount_bif,amount_usd,reference,status,created_at`,
      [req.user.businessId, plan, method, selectedPlan.amountBif, selectedPlan.amountUsd, cleanReference, String(senderPhone).trim().slice(0,40)]
    );
    res.status(201).json({ ok: true, payment: q.rows[0], message: 'Demande envoyée. Votre abonnement sera activé après vérification manuelle du paiement.' });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Cette référence de transaction a déjà été soumise.' });
    console.error(e);
    res.status(500).json({ error: 'Impossible d’enregistrer la demande de paiement.' });
  }
});

function validAdminSecret(req) {
  const expected = process.env.ADMIN_SECRET || '';
  const supplied = String(req.headers['x-admin-secret'] || '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function adminOnly(req, res, next) {
  if (!process.env.ADMIN_SECRET) return res.status(503).json({ error: 'ADMIN_SECRET doit être configuré dans Render.' });
  if (!validAdminSecret(req)) return res.status(401).json({ error: 'Code administrateur incorrect.' });
  next();
}
app.get('/api/admin/payments', adminOnly, async (_req, res) => {
  try {
    const q = await pool.query(
      `SELECT p.id,p.business_id,p.plan,p.method,p.amount_bif,p.amount_usd,p.reference,p.sender_phone,p.status,p.admin_note,p.created_at,
              b.name AS business_name,b.type AS business_type,u.name AS owner_name,u.email AS owner_email,u.id AS owner_id
       FROM subscription_payments p JOIN businesses b ON b.id=p.business_id
       LEFT JOIN users u ON u.business_id=b.id AND u.role='owner'
       ORDER BY CASE WHEN p.status='pending' THEN 0 ELSE 1 END,p.created_at DESC LIMIT 200`
    );
    res.json({ payments: q.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Lecture des paiements impossible.' });
  }
});
app.post('/api/admin/payments/:id/review', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const { decision, note = '' } = req.body || {};
    if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Décision invalide.' });
    await client.query('BEGIN');
    const q = await client.query('SELECT * FROM subscription_payments WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!q.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Paiement introuvable.' }); }
    const payment = q.rows[0];
    if (payment.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ce paiement a déjà été traité.' }); }
    await client.query(
      'UPDATE subscription_payments SET status=$1,admin_note=$2,reviewed_at=NOW() WHERE id=$3',
      [decision, String(note).trim().slice(0,500), payment.id]
    );
    if (decision === 'approved') {
      await client.query(
        `INSERT INTO subscriptions(business_id,plan,status,starts_at,expires_at,updated_at)
         VALUES($1,$2,'active',NOW(),NOW()+INTERVAL '30 days',NOW())
         ON CONFLICT(business_id) DO UPDATE SET
           plan=EXCLUDED.plan,status='active',
           starts_at=CASE WHEN subscriptions.expires_at>NOW() THEN subscriptions.starts_at ELSE NOW() END,
           expires_at=GREATEST(subscriptions.expires_at,NOW())+INTERVAL '30 days',updated_at=NOW()`,
        [payment.business_id, payment.plan]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, status: decision, message: decision === 'approved' ? 'Paiement approuvé et abonnement activé pour 30 jours.' : 'Paiement refusé.' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Traitement du paiement impossible.' });
  } finally { client.release(); }
});

app.get('/api/records/:kind', auth, async (req, res) => {
  const { kind } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  try {
    const q = await pool.query(
      'SELECT id,data,created_at,updated_at FROM records WHERE business_id=$1 AND kind=$2 ORDER BY created_at DESC',
      [req.user.businessId, kind]
    );
    res.json(q.rows.map(r => ({ id: r.id, ...r.data, createdAt: r.created_at, updatedAt: r.updated_at })));
  } catch (e) {
    res.status(500).json({ error: 'Lecture impossible.' });
  }
});
app.post('/api/records/:kind', auth, async (req, res) => {
  const { kind } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  try {
    const data = { ...(req.body || {}) };
    delete data.business_id; delete data.businessId; delete data.id;
    const q = await pool.query(
      'INSERT INTO records(business_id,kind,data) VALUES($1,$2,$3::jsonb) RETURNING id,data,created_at',
      [req.user.businessId, kind, JSON.stringify(data)]
    );
    res.status(201).json({ id: q.rows[0].id, ...q.rows[0].data, createdAt: q.rows[0].created_at });
  } catch (e) {
    res.status(500).json({ error: 'Enregistrement impossible.' });
  }
});
app.put('/api/records/:kind/:id', auth, async (req, res) => {
  const { kind, id } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  try {
    const existing = await pool.query('SELECT data FROM records WHERE id=$1 AND business_id=$2 AND kind=$3',[id,req.user.businessId,kind]);
    if (!existing.rowCount) return res.status(404).json({ error: 'Élément introuvable.' });
    const old = existing.rows[0].data || {};
    const locked = kind==='orders' && (String(old.status||'').toLowerCase()==='terminé' || String(old.status||'').toLowerCase()==='completed' || String(old.paymentStatus||'').toLowerCase()==='payé' || String(old.paymentStatus||'').toLowerCase()==='paid');
    const incoming = req.body || {};
    const employeeProtected = kind==='orders' && (locked || Number(old.paidAmount||0)>0 || Number(incoming.paidAmount||0)>0 || ['terminé','completed'].includes(String(incoming.status||'').toLowerCase()) || ['payé','paid'].includes(String(incoming.paymentStatus||'').toLowerCase()));
    if (req.user.role!=='owner' && employeeProtected) return res.status(403).json({error:'Cette facture ou commande payée/terminée est protégée. Contactez le propriétaire.'});
    const data = { ...(req.body || {}) };
    delete data.business_id; delete data.businessId; delete data.id;
    const q = await pool.query(
      'UPDATE records SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 AND business_id=$3 AND kind=$4 RETURNING id,data,updated_at',
      [JSON.stringify(data), id, req.user.businessId, kind]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'Élément introuvable.' });
    res.json({ id: q.rows[0].id, ...q.rows[0].data, updatedAt: q.rows[0].updated_at });
  } catch (e) {
    res.status(500).json({ error: 'Modification impossible.' });
  }
});
app.delete('/api/records/:kind/:id', auth, async (req, res) => {
  const { kind, id } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  try {
    const existing = await pool.query('SELECT data FROM records WHERE id=$1 AND business_id=$2 AND kind=$3',[id,req.user.businessId,kind]);
    if (!existing.rowCount) return res.status(404).json({ error: 'Élément introuvable.' });
    const old = existing.rows[0].data || {};
    const locked = kind==='orders' && (['terminé','completed'].includes(String(old.status||'').toLowerCase()) || ['payé','paid'].includes(String(old.paymentStatus||'').toLowerCase()));
    if (req.user.role!=='owner' && (locked || (kind==='orders' && Number(old.paidAmount||0)>0))) return res.status(403).json({error:'Cette facture est verrouillée. Seul le propriétaire peut intervenir.'});
    if (req.user.role!=='owner' && kind==='orders' && Number(old.paidAmount||0)>0) return res.status(403).json({error:'Une commande avec paiement ne peut pas être supprimée par un employé.'});
    const q = await pool.query(
      'DELETE FROM records WHERE id=$1 AND business_id=$2 AND kind=$3',
      [id, req.user.businessId, kind]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'Élément introuvable.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Suppression impossible.' });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
initDb().then(() => app.listen(PORT, () => console.log(`Rapid Services listening on ${PORT}`)))
  .catch(e => { console.error('Database initialization failed', e); process.exit(1); });

const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const APP_VERSION = '3.5.31';
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
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      staff_status TEXT NOT NULL DEFAULT 'hors_service' CHECK (staff_status IN ('en_service','en_pause','hors_service')),
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
      plan TEXT NOT NULL CHECK (plan IN ('month1','month3','month6','year1')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subscription_payments (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      plan TEXT NOT NULL CHECK (plan IN ('month1','month3','month6','year1')),
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
    CREATE TABLE IF NOT EXISTS daily_revenue_snapshots (
      id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      report_date DATE NOT NULL, revenue NUMERIC(14,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
      order_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(business_id, report_date)
    );
    ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
    ALTER TABLE subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_plan_check;
    UPDATE subscriptions SET plan=CASE plan WHEN 'basic' THEN 'month1' WHEN 'professional' THEN 'month1' WHEN 'business' THEN 'month1' ELSE plan END;
    UPDATE subscription_payments SET plan=CASE plan WHEN 'basic' THEN 'month1' WHEN 'professional' THEN 'month1' WHEN 'business' THEN 'month1' ELSE plan END;
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('month1','month3','month6','year1'));
    ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_plan_check CHECK (plan IN ('month1','month3','month6','year1'));
    ALTER TABLE subscriptions ALTER COLUMN plan TYPE TEXT;
    ALTER TABLE subscription_payments ALTER COLUMN plan TYPE TEXT;
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL, ip_address TEXT NOT NULL,
      succeeded BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS auth_login_attempts_pair_idx
      ON auth_login_attempts(email,ip_address,created_at DESC) WHERE succeeded=FALSE;
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
      ip_address TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', last_seen_at TIMESTAMPTZ
    );
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_status TEXT NOT NULL DEFAULT 'hors_service';
    CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);
    CREATE TABLE IF NOT EXISTS employee_locations (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
      accuracy DOUBLE PRECISION, shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS invoice_audit_log (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      record_id BIGINT NOT NULL,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created','updated','deleted')),
      old_data JSONB, new_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE invoice_audit_log ADD COLUMN IF NOT EXISTS record_kind TEXT NOT NULL DEFAULT 'orders';
    CREATE INDEX IF NOT EXISTS invoice_audit_business_record_idx ON invoice_audit_log(business_id,record_kind,record_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS team_notifications (
      id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, actor_name TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL, record_kind TEXT NOT NULL, record_id BIGINT NOT NULL,
      message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS team_notifications_business_unread_idx ON team_notifications(business_id,read_at,created_at DESC);
  `);
}

async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Connexion requise.' });
  try {
    const claims = jwt.verify(token, JWT_SECRET);
    if (!claims.sid || !pool) return res.status(401).json({ error: 'Session invalide. Reconnectez-vous.' });
    const session = await pool.query(`SELECT s.id FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.business_id=$3 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.is_active=TRUE`, [claims.sid, claims.userId, claims.businessId]);
    if (!session.rowCount) return res.status(401).json({ error: 'Session révoquée ou expirée. Reconnectez-vous.' });
    // Refresh activity at most once every five minutes per active session.
    await pool.query("UPDATE auth_sessions SET last_seen_at=NOW() WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '5 minutes')", [claims.sid]);
    req.user = claims;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }
}
function issueSession(userId, businessId, role, meta = {}) {
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ip = String(meta.ip || '').slice(0,128);
  const agent = String(meta.userAgent || '').slice(0,500);
  return pool.query('INSERT INTO auth_sessions(id,user_id,business_id,expires_at,ip_address,user_agent,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,NOW())', [sid,userId,businessId,expiresAt,ip,agent])
    .then(() => ({ token: jwt.sign({ userId, businessId, role, sid }, JWT_SECRET, { expiresIn: '7d' }) }));
}
async function subscriptionRequired(req,res,next) {
  try {
    const [q,u]=await Promise.all([pool.query('SELECT status,expires_at FROM subscriptions WHERE business_id=$1',[req.user.businessId]),pool.query("SELECT created_at FROM users WHERE business_id=$1 AND role='owner' ORDER BY created_at ASC LIMIT 1",[req.user.businessId])]);
    const sub=q.rows[0];
    const createdAt=u.rows[0]?.created_at ? new Date(u.rows[0].created_at) : new Date(0);
    const withinGrace=(Date.now()-createdAt.getTime()) < 30*60*1000;
    if((!sub && !withinGrace) || (sub && (sub.status!=='active' || new Date(sub.expires_at)<=new Date())))
      return res.status(402).json({error:'Abonnement requis ou expiré. Veuillez renouveler votre abonnement.',code:'SUBSCRIPTION_REQUIRED'});
    next();
  } catch(e) { console.error(e); res.status(500).json({error:'Vérification de l’abonnement impossible.'}); }
}
function ownerOnly(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Réservé au propriétaire.' });
  next();
}
function validKind(kind) {
  return ['orders', 'bookings', 'customers', 'catalog'].includes(kind);
}
function validateOrderAmounts(data, fallback = {}) {
  for (const key of ['amount', 'paidAmount']) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== '' && data[key] !== null && data[key] !== undefined) {
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0) return `Le champ ${key === 'amount' ? 'montant total' : 'montant payé'} doit être un nombre positif ou nul.`;
    }
  }
  const amountRaw = Object.prototype.hasOwnProperty.call(data, 'amount') ? data.amount : fallback.amount;
  const paidRaw = Object.prototype.hasOwnProperty.call(data, 'paidAmount') ? data.paidAmount : fallback.paidAmount;
  const amount = amountRaw === '' || amountRaw == null ? null : Number(amountRaw);
  const paid = paidRaw === '' || paidRaw == null ? 0 : Number(paidRaw);
  if (amount !== null && Number.isFinite(amount) && Number.isFinite(paid) && paid > amount)
    return 'Le montant déjà payé ne peut pas dépasser le montant total.';
  return null;
}

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, app: 'Rapid Services', database: !!pool, version: APP_VERSION });
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
    const session = await issueSession(u.rows[0].id, b.rows[0].id, 'owner', { ip:req.ip, userAgent:req.get('user-agent') });
    await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=$1',[u.rows[0].id]);
    res.status(201).json({ ...session, user: u.rows[0], business: b.rows[0] });
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
    const normalizedEmail = String(email || '').toLowerCase().trim().slice(0, 254);
    const ipAddress = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 128);
    if (!normalizedEmail || !String(password || ''))
      return res.status(400).json({ error: 'E-mail et mot de passe requis.' });

    // Database-backed throttling also works across server restarts/instances.
    // Limit a single email+IP pair to 8 failed attempts in 15 minutes.
    const attempts = await pool.query(
      `SELECT COUNT(*)::int AS failures FROM auth_login_attempts
       WHERE succeeded=FALSE AND email=$1 AND ip_address=$2
         AND created_at > NOW()-INTERVAL '15 minutes'`,
      [normalizedEmail, ipAddress]
    );
    if (attempts.rows[0].failures >= 8) {
      res.set('Retry-After', '900');
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }

    const q = await pool.query(
      `SELECT u.id,u.name,u.email,u.password_hash,u.role,u.is_active,
              b.id business_id,b.name business_name,b.type,b.currency,b.whatsapp
       FROM users u JOIN businesses b ON b.id=u.business_id WHERE u.email=$1`,
      [normalizedEmail]
    );
    const validPassword = q.rowCount ? await bcrypt.compare(String(password || ''), q.rows[0].password_hash) : false;
    if (!q.rowCount || !validPassword) {
      await pool.query('INSERT INTO auth_login_attempts(email,ip_address,succeeded) VALUES($1,$2,FALSE)', [normalizedEmail, ipAddress]);
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    }
    const r = q.rows[0];
    if (!r.is_active) return res.status(403).json({ error: 'Ce compte employé est désactivé. Contactez le gérant.' });
    await pool.query('INSERT INTO auth_login_attempts(email,ip_address,succeeded) VALUES($1,$2,TRUE)', [normalizedEmail, ipAddress]);
    const session = await issueSession(r.id, r.business_id, r.role, { ip:req.ip, userAgent:req.get('user-agent') });
    await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=$1',[r.id]);
    res.json({
      ...session,
      user: { id: r.id, name: r.name, email: r.email, role: r.role },
      business: { id: r.business_id, name: r.business_name, type: r.type, currency: r.currency, whatsapp: r.whatsapp }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur de connexion.' });
  }
});

// Owner-managed staff accounts. Employees belong to exactly one business.
app.get('/api/team', auth, subscriptionRequired, ownerOnly, async (req, res) => {
  try {
    const q = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.is_active,u.staff_status,u.created_at,u.last_login_at,
      l.latitude,l.longitude,l.accuracy,l.shared_at
      FROM users u LEFT JOIN employee_locations l ON l.user_id=u.id AND l.business_id=u.business_id
      WHERE u.business_id=$1 AND u.role='employee' ORDER BY u.created_at DESC`, [req.user.businessId]);
    res.json({ employees: q.rows });
  } catch (e) { console.error(e); res.status(500).json({error:'Impossible de charger le personnel.'}); }
});
app.post('/api/team', auth, subscriptionRequired, ownerOnly, async (req, res) => {
  try {
    const {name,email,password}=req.body||{};
    const cleanEmail=String(email||'').toLowerCase().trim();
    if(!name||!cleanEmail||String(password||'').length<10) return res.status(400).json({error:'Nom, e-mail et mot de passe de 10 caractères minimum requis.'});
    const hash=await bcrypt.hash(password,12);
    const q=await pool.query(`INSERT INTO users(business_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'employee') RETURNING id,name,email,role`,[req.user.businessId,String(name).trim(),cleanEmail,hash]);
    res.status(201).json({employee:q.rows[0]});
  } catch(e) { if(e.code==='23505') return res.status(409).json({error:'Cet e-mail est déjà utilisé.'}); console.error(e);res.status(500).json({error:'Création du compte employé impossible.'}); }
});
app.patch('/api/team/:id', auth, subscriptionRequired, ownerOnly, async (req,res)=>{
  try {
    const {name,email,staffStatus,isActive}=req.body||{};
    const allowed=['en_service','en_pause','hors_service'];
    if(staffStatus!==undefined && !allowed.includes(staffStatus)) return res.status(400).json({error:'Statut employé invalide.'});
    const cleanEmail=email===undefined?null:String(email).toLowerCase().trim();
    if(cleanEmail!==null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({error:'Adresse e-mail invalide.'});
    const q=await pool.query(`UPDATE users SET name=COALESCE(NULLIF($1,''),name), email=COALESCE($2,email), staff_status=COALESCE($3,staff_status), is_active=COALESCE($4,is_active) WHERE id=$5 AND business_id=$6 AND role='employee' RETURNING id,name,email,role,is_active,staff_status`,[name===undefined?null:String(name).trim(),cleanEmail,staffStatus===undefined?null:staffStatus,typeof isActive==='boolean'?isActive:null,req.params.id,req.user.businessId]);
    if(!q.rowCount)return res.status(404).json({error:'Employé introuvable.'});
    if(isActive===false) { await pool.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.params.id]); await pool.query('DELETE FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.params.id,req.user.businessId]); }
    res.json({employee:q.rows[0]});
  } catch(e){if(e.code==='23505')return res.status(409).json({error:'Cette adresse e-mail est déjà utilisée.'});console.error(e);res.status(500).json({error:'Modification impossible.'});}
});
app.delete('/api/team/:id', auth, subscriptionRequired, ownerOnly, async (req,res)=>{
  try { const q=await pool.query("UPDATE users SET is_active=FALSE,staff_status='hors_service' WHERE id=$1 AND business_id=$2 AND role='employee' RETURNING id",[req.params.id,req.user.businessId]); if(!q.rowCount)return res.status(404).json({error:'Employé introuvable.'}); await pool.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.params.id]); await pool.query('DELETE FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.params.id,req.user.businessId]); res.json({ok:true,deactivated:true}); }
  catch(e){console.error(e);res.status(500).json({error:'Désactivation impossible.'});}
});
// Employee password reset by the business owner. The new password is never returned.
app.post('/api/team/:id/reset-password', auth, subscriptionRequired, ownerOnly, async (req,res)=>{
  try {
    const password=String(req.body?.password||'');
    if(password.length<10 || password.length>128) return res.status(400).json({error:'Le mot de passe doit contenir entre 10 et 128 caractères.'});
    const employee=await pool.query("SELECT id FROM users WHERE id=$1 AND business_id=$2 AND role='employee'",[req.params.id,req.user.businessId]);
    if(!employee.rowCount) return res.status(404).json({error:'Employé introuvable.'});
    const hash=await bcrypt.hash(password,12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND business_id=$3',[hash,req.params.id,req.user.businessId]);
    const revoked=await pool.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND business_id=$2 AND revoked_at IS NULL RETURNING id',[req.params.id,req.user.businessId]);
    await pool.query('DELETE FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.params.id,req.user.businessId]);
    res.json({ok:true,revokedCount:revoked.rowCount,message:'Mot de passe modifié. L’employé devra se reconnecter.'});
  } catch(e){console.error(e);res.status(500).json({error:'Réinitialisation du mot de passe impossible.'});}
});
// Authenticated user changes their own password; other sessions are revoked.
app.post('/api/auth/change-password', auth, async (req,res)=>{
  try {
    const currentPassword=String(req.body?.currentPassword||'');
    const newPassword=String(req.body?.newPassword||'');
    if(newPassword.length<10 || newPassword.length>128) return res.status(400).json({error:'Le nouveau mot de passe doit contenir entre 10 et 128 caractères.'});
    if(currentPassword===newPassword) return res.status(400).json({error:'Choisissez un mot de passe différent de l’ancien.'});
    const user=await pool.query('SELECT password_hash FROM users WHERE id=$1 AND business_id=$2 AND is_active=TRUE',[req.user.userId,req.user.businessId]);
    if(!user.rowCount || !(await bcrypt.compare(currentPassword,user.rows[0].password_hash))) return res.status(400).json({error:'Le mot de passe actuel est incorrect.'});
    const hash=await bcrypt.hash(newPassword,12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND business_id=$3',[hash,req.user.userId,req.user.businessId]);
    const revoked=await pool.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND business_id=$2 AND id<>$3 AND revoked_at IS NULL RETURNING id',[req.user.userId,req.user.businessId,req.user.sid]);
    res.json({ok:true,revokedCount:revoked.rowCount,message:'Mot de passe modifié. Les autres appareils ont été déconnectés.'});
  } catch(e){console.error(e);res.status(500).json({error:'Modification du mot de passe impossible.'});}
});

// Owner can inspect an employee's recent sessions and revoke them remotely.
app.get('/api/team/:id/sessions', auth, subscriptionRequired, ownerOnly, async (req,res)=>{
  try {
    const employee=await pool.query("SELECT id,name,email,last_login_at FROM users WHERE id=$1 AND business_id=$2 AND role='employee'",[req.params.id,req.user.businessId]);
    if(!employee.rowCount)return res.status(404).json({error:'Employé introuvable.'});
    const sessions=await pool.query(`SELECT id,created_at,expires_at,revoked_at,ip_address,user_agent,last_seen_at
      FROM auth_sessions WHERE user_id=$1 AND business_id=$2 ORDER BY created_at DESC LIMIT 20`,[req.params.id,req.user.businessId]);
    res.json({employee:employee.rows[0],sessions:sessions.rows});
  } catch(e){console.error(e);res.status(500).json({error:'Impossible de charger les connexions.'});}
});
app.post('/api/team/:id/revoke-sessions', auth, subscriptionRequired, ownerOnly, async (req,res)=>{
  try {
    const employee=await pool.query("SELECT id FROM users WHERE id=$1 AND business_id=$2 AND role='employee'",[req.params.id,req.user.businessId]);
    if(!employee.rowCount)return res.status(404).json({error:'Employé introuvable.'});
    const revoked=await pool.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND business_id=$2 AND revoked_at IS NULL RETURNING id',[req.params.id,req.user.businessId]);
    await pool.query('DELETE FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.params.id,req.user.businessId]);
    res.json({ok:true,revokedCount:revoked.rowCount});
  } catch(e){console.error(e);res.status(500).json({error:'Déconnexion à distance impossible.'});}
});

// Location is opt-in: employee browser permission is required. Updates only while app is open.
app.post('/api/location', auth, subscriptionRequired, async (req,res)=>{
  try {
    const {latitude,longitude,accuracy}=req.body||{};
    if(req.user.role!=='employee') return res.status(403).json({error:'Cette fonction est réservée aux comptes employés.'});
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180) return res.status(400).json({error:'Coordonnées GPS invalides.'});
    if(accuracy!==undefined && accuracy!==null && (!Number.isFinite(accuracy)||accuracy<0||accuracy>10000)) return res.status(400).json({error:'Précision GPS invalide.'});
    // Throttle writes: browser watchPosition can fire frequently. Keep at most one
    // database update every 15 seconds per employee while preserving explicit sharing.
    const saved=await pool.query(`INSERT INTO employee_locations(user_id,business_id,latitude,longitude,accuracy,shared_at)
      VALUES($1,$2,$3,$4,$5,NOW())
      ON CONFLICT(user_id) DO UPDATE SET business_id=EXCLUDED.business_id,latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude,accuracy=EXCLUDED.accuracy,shared_at=NOW()
      WHERE employee_locations.shared_at <= NOW()-INTERVAL '15 seconds'
      RETURNING shared_at`,[req.user.userId,req.user.businessId,latitude,longitude,accuracy??null]);
    if(!saved.rowCount){
      const latest=await pool.query('SELECT shared_at FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.user.userId,req.user.businessId]);
      return res.json({ok:true,throttled:true,sharedAt:latest.rows[0]?.shared_at||null});
    }
    res.json({ok:true,sharedAt:saved.rows[0].shared_at});
  } catch(e){console.error(e);res.status(500).json({error:'Envoi de la position impossible.'});}
});
app.delete('/api/location', auth, subscriptionRequired, async (req,res)=>{try{await pool.query('DELETE FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.user.userId,req.user.businessId]);res.json({ok:true});}catch(e){res.status(500).json({error:'Arrêt du partage impossible.'});}});

app.post('/api/auth/logout', auth, async (req,res)=>{
  try { await pool.query('DELETE FROM employee_locations WHERE user_id=$1 AND business_id=$2',[req.user.userId,req.user.businessId]); await pool.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2',[req.user.sid,req.user.userId]); res.json({ok:true}); }
  catch(e){ console.error(e); res.status(500).json({error:'Déconnexion impossible côté serveur.'}); }
});

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
app.get('/api/settings', auth, subscriptionRequired, ownerOnly, async (req, res) => {
  try {
    const q = await pool.query('SELECT branding FROM business_settings WHERE business_id=$1', [req.user.businessId]);
    res.json({ branding: q.rows[0]?.branding || {} });
  } catch (e) {
    res.status(500).json({ error: 'Lecture des paramètres impossible.' });
  }
});
app.put('/api/settings', auth, subscriptionRequired, ownerOnly, async (req, res) => {
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
  month1: { name: '1 mois', amountBif: 60000, amountUsd: 10, interval: '1 month' },
  month3: { name: '3 mois', amountBif: 150000, amountUsd: 28, interval: '3 months' },
  month6: { name: '6 mois', amountBif: 300000, amountUsd: 50, interval: '6 months' },
  year1: { name: '1 an', amountBif: 600000, amountUsd: 100, interval: '1 year' }
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

app.get('/api/subscription/status', auth, ownerOnly, async (req,res)=>{
  try {
    const [owner,sub]=await Promise.all([
      pool.query("SELECT created_at FROM users WHERE business_id=$1 AND role='owner' ORDER BY created_at ASC LIMIT 1",[req.user.businessId]),
      pool.query('SELECT plan,status,expires_at FROM subscriptions WHERE business_id=$1',[req.user.businessId])
    ]);
    const createdAt=owner.rows[0]?.created_at || null;
    const current=sub.rows[0] || null;
    const now=Date.now();
    const minutesSinceCreation=createdAt ? (now-new Date(createdAt).getTime())/60000 : 0;
    const expiresAt=current?.expires_at ? new Date(current.expires_at).getTime() : null;
    const expired=!!current && expiresAt<=now;
    res.json({createdAt,subscription:current,minutesSinceCreation,expired,daysUntilExpiry:expiresAt===null?null:(expiresAt-now)/86400000});
  } catch(e){console.error(e);res.status(500).json({error:'Statut de l’abonnement indisponible.'});}
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
  const paymentId = String(req.params.id || '');
  if (!/^[1-9][0-9]{0,17}$/.test(paymentId)) return res.status(400).json({ error: 'Identifiant de paiement invalide.' });
  const client = await pool.connect();
  try {
    const { decision, note = '' } = req.body || {};
    if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Décision invalide.' });
    if (typeof note !== 'string') return res.status(400).json({ error: 'La note doit être un texte.' });
    await client.query('BEGIN');
    const q = await client.query('SELECT * FROM subscription_payments WHERE id=$1 FOR UPDATE', [paymentId]);
    if (!q.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Paiement introuvable.' }); }
    const payment = q.rows[0];
    if (payment.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ce paiement a déjà été traité.' }); }
    await client.query(
      'UPDATE subscription_payments SET status=$1,admin_note=$2,reviewed_at=NOW() WHERE id=$3',
      [decision, note.trim().slice(0,500), payment.id]
    );
    if (decision === 'approved') {
      const duration = SUBSCRIPTION_PLANS[payment.plan];
      await client.query(
        `INSERT INTO subscriptions(business_id,plan,status,starts_at,expires_at,updated_at)
         VALUES($1,$2,'active',NOW(),NOW()+$3::interval,NOW())
         ON CONFLICT(business_id) DO UPDATE SET
           plan=EXCLUDED.plan,status='active',
           starts_at=CASE WHEN subscriptions.expires_at>NOW() THEN subscriptions.starts_at ELSE NOW() END,
           expires_at=GREATEST(subscriptions.expires_at,NOW())+$3::interval,updated_at=NOW()`,
        [payment.business_id, payment.plan, duration.interval]
      );
    }
    const planName = SUBSCRIPTION_PLANS[payment.plan]?.name || payment.plan;
    const paymentMessage = decision === 'approved'
      ? `Votre paiement d’abonnement (${planName}) a été approuvé. Votre abonnement est activé.`
      : `Votre paiement d’abonnement (${planName}) a été refusé. ${note.trim().slice(0,300)}`;
    await client.query(
      `INSERT INTO team_notifications(business_id,actor_name,event_type,record_kind,record_id,message)
       VALUES($1,'Administration',$2,'subscription',$3,$4)`,
      [payment.business_id, decision === 'approved' ? 'subscription_approved' : 'subscription_rejected', payment.id, paymentMessage]
    );
    await client.query('COMMIT');
    res.json({ ok: true, status: decision, message: decision === 'approved' ? 'Paiement approuvé et abonnement activé selon la durée choisie.' : 'Paiement refusé.' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Traitement du paiement impossible.' });
  } finally { client.release(); }
});

// Expired or unpaid businesses can still log in and reach the subscription/payment pages,
// but cannot use operational data, staff, settings, GPS or reports.
app.use('/api/records', auth, subscriptionRequired);
app.use('/api/team', auth, subscriptionRequired);
app.use('/api/location', auth, subscriptionRequired);
app.use('/api/settings', auth, subscriptionRequired);
app.use('/api/reports', auth, subscriptionRequired);

app.get('/api/records/:kind', auth, async (req, res) => {
  const { kind } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  if (kind === 'catalog' && req.user.role !== 'owner') return res.status(403).json({ error: 'Le catalogue est réservé au gérant.' });
  try {
    const q = await pool.query(
      'SELECT id,data,created_at,updated_at FROM records WHERE business_id=$1 AND kind=$2 ORDER BY created_at DESC',
      [req.user.businessId, kind]
    );
    res.json(q.rows.map(r => {
      const data = { ...(r.data || {}) };
      // Employees may work with orders, but financial figures are manager-only.
      if (req.user.role !== 'owner' && kind === 'orders') {
        delete data.amount;
        delete data.paidAmount;
        delete data.paymentStatus;
        delete data.paymentMethod;
      }
      return { id: r.id, ...data, createdAt: r.created_at, updatedAt: r.updated_at };
    }));
  } catch (e) {
    res.status(500).json({ error: 'Lecture impossible.' });
  }
});
app.post('/api/records/:kind', auth, async (req, res) => {
  const { kind } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  if (kind === 'catalog' && req.user.role !== 'owner') return res.status(403).json({ error: 'La gestion du catalogue est réservée au gérant.' });
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const data={...(req.body||{})};
    delete data.business_id; delete data.businessId; delete data.id;
    // Audit identity is server-controlled; clients cannot impersonate another creator.
    const actor = await client.query('SELECT name,role FROM users WHERE id=$1 AND business_id=$2', [req.user.userId, req.user.businessId]);
    data._createdBy = { userId: req.user.userId, name: actor.rows[0]?.name || '', role: req.user.role, at: new Date().toISOString() };
    data._updatedBy = data._createdBy;
    // Employees cannot create or alter financial figures or mark an order as paid.
    if (req.user.role !== 'owner' && kind === 'orders') {
      delete data.amount;
      delete data.paidAmount;
      delete data.paymentStatus;
      delete data.paymentMethod;
    }
    if (kind === 'orders' && req.user.role === 'owner') {
      const amountError = validateOrderAmounts(data);
      if (amountError) { await client.query('ROLLBACK'); return res.status(400).json({error:amountError}); }
    }
    const q=await client.query('INSERT INTO records(business_id,kind,data) VALUES($1,$2,$3::jsonb) RETURNING id,data,created_at',[req.user.businessId,kind,JSON.stringify(data)]);
    await client.query(`INSERT INTO invoice_audit_log(business_id,record_kind,record_id,actor_user_id,actor_role,action,new_data) VALUES($1,$2,$3,$4,$5,'created',$6::jsonb)`,[req.user.businessId,kind,q.rows[0].id,req.user.userId,req.user.role,JSON.stringify(data)]);
    if (req.user.role === 'employee' && ['orders','bookings'].includes(kind)) {
      const label = kind === 'orders' ? 'une commande' : 'une réservation';
      const subject = String(data.customer || data.name || data.detail || '').slice(0,140);
      await client.query(`INSERT INTO team_notifications(business_id,actor_user_id,actor_name,event_type,record_kind,record_id,message) VALUES($1,$2,$3,'created',$4,$5,$6)`,[req.user.businessId,req.user.userId,actor.rows[0]?.name||'',kind,q.rows[0].id,`a créé ${label}${subject ? ' · '+subject : ''}`]);
    }
    await client.query('COMMIT');
    res.status(201).json({id:q.rows[0].id,...q.rows[0].data,createdAt:q.rows[0].created_at});
  } catch(e){await client.query('ROLLBACK').catch(()=>{});console.error(e);res.status(500).json({error:'Enregistrement impossible.'});}
  finally{client.release();}
});
app.put('/api/records/:kind/:id', auth, async (req, res) => {
  const { kind, id } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  if (kind === 'catalog' && req.user.role !== 'owner') return res.status(403).json({ error: 'La gestion du catalogue est réservée au gérant.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT data FROM records WHERE id=$1 AND business_id=$2 AND kind=$3 FOR UPDATE',[id,req.user.businessId,kind]);
    if (!existing.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Élément introuvable.' }); }
    const old = existing.rows[0].data || {};
    const incoming = req.body || {};
    const oldStatus = String(old.status||'').trim().toLowerCase();
    const oldPaymentStatus = String(old.paymentStatus||'').trim().toLowerCase();
    const locked = kind==='orders' && (['terminé','termine','completed'].includes(oldStatus) || ['payé','paye','paid'].includes(oldPaymentStatus) || Number(old.paidAmount||0)>0);
    // Employees may complete operational work. Completion locks the record only
    // after this update; payment fields remain manager-controlled and immutable.
    const incomingStatus = String(incoming.status||'').trim().toLowerCase();
    const requestsPayment = kind==='orders' && (
      ['payé','paye','paid'].includes(String(incoming.paymentStatus||'').trim().toLowerCase()) ||
      ['payé','paye','paid'].includes(incomingStatus) ||
      Number(incoming.paidAmount||0)>Number(old.paidAmount||0)
    );
    if (req.user.role!=='owner' && (locked || requestsPayment)) { await client.query('ROLLBACK'); return res.status(403).json({error: locked ? 'Cette facture ou commande payée/terminée est protégée. Contactez le propriétaire.' : 'Seul le gérant peut enregistrer un paiement.'}); }
    const data = { ...incoming };
    delete data.business_id; delete data.businessId; delete data.id;
    // Preserve the original creator and record the last editor from the authenticated session.
    const actor = await client.query('SELECT name FROM users WHERE id=$1 AND business_id=$2', [req.user.userId, req.user.businessId]);
    data._createdBy = old._createdBy || null;
    data._updatedBy = { userId: req.user.userId, name: actor.rows[0]?.name || '', role: req.user.role, at: new Date().toISOString() };
    // Keep financial values from the stored record; never trust employee-submitted amounts.
    if (req.user.role !== 'owner' && kind === 'orders') {
      for (const key of ['amount','paidAmount','paymentStatus','paymentMethod']) {
        if (Object.prototype.hasOwnProperty.call(old, key)) data[key] = old[key];
        else delete data[key];
      }
    }
    if (kind === 'orders' && req.user.role === 'owner') {
      const amountError = validateOrderAmounts(data, old);
      if (amountError) { await client.query('ROLLBACK'); return res.status(400).json({error:amountError}); }
    }
    const q = await client.query('UPDATE records SET data=$1::jsonb,updated_at=NOW() WHERE id=$2 AND business_id=$3 AND kind=$4 RETURNING id,data,updated_at',[JSON.stringify(data),id,req.user.businessId,kind]);
    // Audit all operational records, not only orders. The authenticated actor
    // and business scope are always supplied by the server.
    await client.query(`INSERT INTO invoice_audit_log(business_id,record_kind,record_id,actor_user_id,actor_role,action,old_data,new_data) VALUES($1,$2,$3,$4,$5,'updated',$6::jsonb,$7::jsonb)`,[req.user.businessId,kind,id,req.user.userId,req.user.role,JSON.stringify(old),JSON.stringify(data)]);
    const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const wasDone = ['termine','completed','done'].includes(norm(old.status));
    const isDone = ['termine','completed','done'].includes(norm(data.status));
    if (req.user.role === 'employee' && kind === 'orders' && !wasDone && isDone) {
      await client.query(`INSERT INTO team_notifications(business_id,actor_user_id,actor_name,event_type,record_kind,record_id,message) VALUES($1,$2,$3,'completed','orders',$4,$5)`,[req.user.businessId,req.user.userId,actor.rows[0]?.name||'',id,`a terminé la commande${String(data.customer||'').trim() ? ' · '+String(data.customer).slice(0,140) : ''}`]);
    }
    await client.query('COMMIT');
    res.json({ id:q.rows[0].id,...q.rows[0].data,updatedAt:q.rows[0].updated_at });
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error(e); res.status(500).json({error:'Modification impossible.'}); }
  finally { client.release(); }
});
app.delete('/api/records/:kind/:id', auth, async (req, res) => {
  const { kind, id } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: 'Catégorie invalide.' });
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Seul le gérant peut supprimer un enregistrement.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT data FROM records WHERE id=$1 AND business_id=$2 AND kind=$3 FOR UPDATE',[id,req.user.businessId,kind]);
    if (!existing.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Élément introuvable.' }); }
    const old = existing.rows[0].data || {};
    const normalizeStatus = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const locked = kind==='orders' && (
      ['termine','completed','done','paye','paid'].includes(normalizeStatus(old.status)) ||
      ['paye','paid'].includes(normalizeStatus(old.paymentStatus)) ||
      Number(old.paidAmount||0)>0
    );
    // Never physically delete a completed or paid invoice. Keeping the record
    // preserves its audit history and prevents accidental loss of financial data.
    if (locked) { await client.query('ROLLBACK'); return res.status(403).json({error:'Cette facture est terminée ou comporte un paiement. Sa suppression est interdite afin de préserver son historique.'}); }
    await client.query(`INSERT INTO invoice_audit_log(business_id,record_kind,record_id,actor_user_id,actor_role,action,old_data) VALUES($1,$2,$3,$4,$5,'deleted',$6::jsonb)`,[req.user.businessId,kind,id,req.user.userId,req.user.role,JSON.stringify(old)]);
    await client.query('DELETE FROM records WHERE id=$1 AND business_id=$2 AND kind=$3',[id,req.user.businessId,kind]);
    await client.query('COMMIT');
    res.json({ok:true});
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error(e); res.status(500).json({error:'Suppression impossible.'}); }
  finally { client.release(); }
});
// Owner-only in-app alerts generated when employees create orders/bookings or complete orders.
app.get('/api/team/notifications', auth, ownerOnly, async (req,res)=>{
  try {
    const q=await pool.query(`SELECT n.id,n.actor_name,n.event_type,n.record_kind,n.record_id,n.message,n.created_at,n.read_at
      FROM team_notifications n WHERE n.business_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 60`,[req.user.businessId]);
    res.json({notifications:q.rows,unread:q.rows.filter(x=>!x.read_at).length});
  } catch(e){console.error(e);res.status(500).json({error:'Notifications indisponibles.'});}
});
app.patch('/api/team/notifications/:id/read', auth, ownerOnly, async (req,res)=>{
  if(!/^\d+$/.test(String(req.params.id))) return res.status(400).json({error:'Identifiant invalide.'});
  try {
    const q=await pool.query('UPDATE team_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND business_id=$2 RETURNING id',[req.params.id,req.user.businessId]);
    if(!q.rowCount) return res.status(404).json({error:'Notification introuvable.'});
    res.json({ok:true});
  } catch(e){console.error(e);res.status(500).json({error:'Impossible de mettre à jour la notification.'});}
});

// Recent team activity: owner-only view of operational order, booking and customer events.
app.get('/api/team/activity', auth, ownerOnly, subscriptionRequired, async (req,res)=>{
  try {
    const q = await pool.query(`SELECT a.id,a.record_kind,a.record_id,a.actor_role,a.action,a.created_at,
        u.name AS actor_name,
        COALESCE(a.new_data->>'customer',a.old_data->>'customer',a.new_data->>'name',a.old_data->>'name','') AS customer,
        COALESCE(a.new_data->>'detail',a.old_data->>'detail',a.new_data->>'service',a.old_data->>'service','') AS detail,
        COALESCE(a.new_data->>'status',a.old_data->>'status','') AS order_status
      FROM invoice_audit_log a
      LEFT JOIN users u ON u.id=a.actor_user_id
      WHERE a.business_id=$1
      ORDER BY a.created_at DESC,a.id DESC
      LIMIT 50`, [req.user.businessId]);
    res.json({ activities:q.rows });
  } catch(e) {
    console.error(e);
    res.status(500).json({error:'Activité de l’équipe indisponible.'});
  }
});

app.get('/api/invoices/:id/history', auth, ownerOnly, subscriptionRequired, async (req,res)=>{
  const invoiceId = String(req.params.id || '');
  if (!/^\d+$/.test(invoiceId)) return res.status(400).json({error:'Identifiant de facture invalide.'});
  try {
    const exists = await pool.query("SELECT id FROM records WHERE id=$1 AND business_id=$2 AND kind='orders'",[invoiceId,req.user.businessId]);
    if (!exists.rowCount) return res.status(404).json({error:'Facture introuvable.'});
    const q=await pool.query(`SELECT a.id,a.record_id,a.actor_user_id,a.actor_role,a.action,a.old_data,a.new_data,a.created_at,u.name AS actor_name
      FROM invoice_audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
      WHERE a.business_id=$1 AND a.record_kind='orders' AND a.record_id=$2 ORDER BY a.created_at DESC LIMIT 100`,[req.user.businessId,invoiceId]);
    res.json({history:q.rows});
  } catch(e){ console.error(e); res.status(500).json({error:'Historique de la facture indisponible.'}); }
});

// Daily revenue history. Snapshots are stored once per local business day at 03:00 Africa/Bujumbura.

app.get('/api/reports/today', auth, ownerOnly, subscriptionRequired, async (req,res)=>{
  try {
    const q=await pool.query(`WITH local_day AS (
        SELECT ((NOW() AT TIME ZONE 'Africa/Bujumbura')::date -
          CASE WHEN (NOW() AT TIME ZONE 'Africa/Bujumbura')::time < TIME '03:00' THEN 1 ELSE 0 END) AS report_day
      ), bounds AS (
        SELECT ((report_day + TIME '03:00') AT TIME ZONE 'Africa/Bujumbura') AS starts_at,
               (((report_day + 1) + TIME '03:00') AT TIME ZONE 'Africa/Bujumbura') AS ends_at,
               report_day FROM local_day
      )
      SELECT bounds.report_day AS report_date,
        COALESCE(SUM(CASE WHEN lower(COALESCE(r.data->>'paymentStatus','')) IN ('payé','paye','paid') THEN COALESCE(NULLIF(r.data->>'paidAmount','')::numeric,NULLIF(r.data->>'amount','')::numeric,0) ELSE COALESCE(NULLIF(r.data->>'paidAmount','')::numeric,0) END),0) AS revenue,
        COUNT(r.id)::int AS order_count
      FROM bounds LEFT JOIN records r ON r.business_id=$1 AND r.kind='orders'
        AND r.created_at>=bounds.starts_at AND r.created_at<bounds.ends_at
        AND (lower(COALESCE(r.data->>'paymentStatus','')) IN ('payé','paye','paid') OR COALESCE(NULLIF(r.data->>'paidAmount','')::numeric,0)>0)
      GROUP BY bounds.report_day`,[req.user.businessId]);
    res.json(q.rows[0] || {report_date:null,revenue:0,order_count:0});
  } catch(e){console.error(e);res.status(500).json({error:'Rapport du jour indisponible.'});}
});

app.get('/api/reports/daily', auth, ownerOnly, subscriptionRequired, async (req,res)=>{
  try {
    const q=await pool.query('SELECT report_date,revenue,currency,order_count,created_at FROM daily_revenue_snapshots WHERE business_id=$1 ORDER BY report_date DESC LIMIT 366',[req.user.businessId]);
    res.json({reports:q.rows});
  } catch(e){console.error(e);res.status(500).json({error:'Historique des rapports indisponible.'});}
});

// Archive every missing completed business day. Safe to run after restarts: the
// unique (business_id, report_date) key prevents duplicates. A business day is
// 03:00 to 02:59 Africa/Bujumbura. If no archive exists, only yesterday is
// initialized; we do not invent older historical snapshots.
async function snapshotDailyRevenue(){
  if(!pool)return;
  await pool.query(`WITH yesterday AS (
      SELECT (NOW() AT TIME ZONE 'Africa/Bujumbura')::date - 1 AS report_day
    ), business_days AS (
      SELECT b.id AS business_id,b.currency,
        COALESCE((SELECT MAX(s.report_date)+1 FROM daily_revenue_snapshots s WHERE s.business_id=b.id), y.report_day) AS first_day,
        y.report_day AS last_day
      FROM businesses b CROSS JOIN yesterday y
    ), days AS (
      SELECT business_id,currency,generate_series(first_day,last_day,INTERVAL '1 day')::date AS report_day
      FROM business_days WHERE first_day<=last_day
    ), bounds AS (
      SELECT business_id,currency,report_day,
        ((report_day + TIME '03:00') AT TIME ZONE 'Africa/Bujumbura') AS starts_at,
        (((report_day + 1) + TIME '03:00') AT TIME ZONE 'Africa/Bujumbura') AS ends_at
      FROM days
    )
    INSERT INTO daily_revenue_snapshots(business_id,report_date,revenue,currency,order_count)
    SELECT bounds.business_id,bounds.report_day,
      COALESCE(SUM(CASE WHEN lower(COALESCE(r.data->>'paymentStatus','')) IN ('payé','paye','paid') THEN COALESCE(NULLIF(r.data->>'paidAmount','')::numeric,NULLIF(r.data->>'amount','')::numeric,0) ELSE COALESCE(NULLIF(r.data->>'paidAmount','')::numeric,0) END),0),
      bounds.currency,COUNT(r.id)::int
    FROM bounds LEFT JOIN records r ON r.business_id=bounds.business_id AND r.kind='orders'
      AND r.created_at>=bounds.starts_at AND r.created_at<bounds.ends_at
      AND (lower(COALESCE(r.data->>'paymentStatus','')) IN ('payé','paye','paid') OR COALESCE(NULLIF(r.data->>'paidAmount','')::numeric,0)>0)
    GROUP BY bounds.business_id,bounds.report_day,bounds.currency
    ON CONFLICT(business_id,report_date) DO NOTHING`);
}
function scheduleDailySnapshot(){
  const now=new Date(); const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Bujumbura',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const target=new Date(`${v.year}-${v.month}-${v.day}T03:00:00+02:00`);
  if(now>=target)target.setDate(target.getDate()+1);
  setTimeout(async()=>{try{await snapshotDailyRevenue();}catch(e){console.error('Daily report snapshot failed',e);}scheduleDailySnapshot();},Math.max(1000,target-now));
}

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
initDb().then(async () => {
  // Catch up the last completed business day after a restart/deploy that happened
  // after 03:00 Africa/Bujumbura. The unique key makes this safe to run repeatedly.
  const localParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Bujumbura', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const localClock = Object.fromEntries(localParts.map(p => [p.type, p.value]));
  if (Number(localClock.hour) > 3 || (Number(localClock.hour) === 3 && Number(localClock.minute) >= 0)) {
    try { await snapshotDailyRevenue(); } catch (e) { console.error('Daily report catch-up failed', e); }
  }
  scheduleDailySnapshot();
  app.listen(PORT, () => console.log(`Rapid Services ${APP_VERSION} listening on ${PORT}`));
})
  .catch(e => { console.error('Database initialization failed', e); process.exit(1); });

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PATH, requireAuth, requireLevel, TTL_MS } from './auth.js';
import { startGateCleanup } from './gate.js';
import { withScope } from './scope.js';
import authRoutes from './routes/auth.js';
import supervisorRoutes from './routes/supervisor.js';
import agentRoutes from './routes/agent.js';
import leadRoutes from './routes/leads.js';
import adminRoutes from './routes/admin.js';
import smsRoutes, { smsWebhook } from './routes/sms.js';
import chatRoutes from './routes/chat.js';
import { migrate } from './appdb.js';
import { startPolling } from './sms.js';
import { i18n } from './i18n.js';

const PORT = Number(process.env.PORT || 3100);
const SUPERVISOR_LEVEL = Number(process.env.SUPERVISOR_LEVEL || 7);
const ADMIN_LEVEL = Number(process.env.ADMIN_LEVEL || 8);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '15mb' })); // MMS con imágenes en base64
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

const api = express.Router();
api.use(i18n);
api.get('/health', (req, res) => res.json({ ok: true }));
api.use('/auth', authRoutes);
api.use('/sup', requireAuth, requireLevel(SUPERVISOR_LEVEL), withScope, supervisorRoutes);
api.use('/agent', requireAuth, agentRoutes);
api.use('/leads', requireAuth, requireLevel(SUPERVISOR_LEVEL), withScope, leadRoutes);
api.use('/admin', requireAuth, requireLevel(ADMIN_LEVEL), withScope, adminRoutes);
api.use('/sms', smsRoutes);
api.use('/chat', requireAuth, withScope, chatRoutes);
api.use('/sms-hook', smsWebhook); // público, protegido por token
api.use((req, res) => res.status(404).json({ error: req.t('Ruta no encontrada') }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (!err.expose) console.error(err);
  res.status(err.status || 500).json({ error: req.t(err.expose ? err.message : 'Error interno del servidor', err.vars) });
});
app.use(`${BASE_PATH}/api`, api);

// Frontend React compilado
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
app.use(`${BASE_PATH}/assets`, express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(BASE_PATH, express.static(dist, { index: false }));
app.get([BASE_PATH, `${BASE_PATH}/*`], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(dist, 'index.html'));
});

startGateCleanup(TTL_MS);

migrate()
  .then(startPolling)
  .catch((e) => console.error('No se pudo preparar la base de datos de EnVoip:', e.message));

app.listen(PORT, '127.0.0.1', () => console.log(`vicimodern escuchando en 127.0.0.1:${PORT}${BASE_PATH}`));

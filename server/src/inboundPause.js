import { all } from './db.js';
import { agentApi } from './vici.js';

// Llamadas entrantes también a los agentes en pausa. Vicidial solo entrega las llamadas de la cola a agentes
// disponibles (READY): si el agente está en pausa la llamada espera y acaba en el buzón aunque nadie esté hablando.
// Cada segundo se mira si hay llamadas esperando en las colas de un agente en pausa (sin cliente en pantalla):
// se le quita la pausa para que Vicidial se la pase y, al terminar esa llamada, vuelve a quedar en pausa
// (así el marcador automático no empieza a llamar por su cuenta). Si el agente está ocupado en otra llamada
// no se toca: la llamada sigue el camino normal de la cola (otro agente o el buzón).
const TICK_MS = 1000;
const GIVE_UP_MS = 20_000; // sin llamada tras quitar la pausa (el cliente colgó antes): vuelve a pausa
const auto = new Map(); // usuario → { at, phase: 'resumed' | 'incall' }

const groupsOf = (closer) => (closer || '').trim().split(/\s+/).filter((g) => g && g !== '-');

async function tick() {
  const [agents, waiting] = await Promise.all([
    all('SELECT user, status, lead_id, closer_campaigns FROM vicidial_live_agents'),
    all(`SELECT DISTINCT campaign_id FROM vicidial_auto_calls WHERE call_type = 'IN' AND status = 'LIVE'`),
  ]);
  const queued = new Set(waiting.map((w) => w.campaign_id));
  const live = new Map(agents.map((a) => [a.user, a]));

  for (const [user, st] of auto) {
    const a = live.get(user);
    if (!a) { auto.delete(user); continue; }
    if (a.status === 'INCALL' || a.status === 'QUEUE' || a.lead_id > 0) { st.phase = 'incall'; continue; }
    if (a.status === 'PAUSED') { auto.delete(user); continue; } // ya volvió a pausa (lo hizo él o la tipificación)
    const done = st.phase === 'incall' || (Date.now() - st.at > GIVE_UP_MS && !groupsOf(a.closer_campaigns).some((g) => queued.has(g)));
    if (a.status === 'READY' && done) {
      auto.delete(user);
      await agentApi(user, 'external_pause', { value: 'PAUSE' }).catch((e) => console.error(`pausa de vuelta ${user}: ${e.message}`));
    }
  }

  if (!queued.size) return;
  for (const a of agents) {
    if (a.status !== 'PAUSED' || a.lead_id > 0 || auto.has(a.user)) continue;
    if (!groupsOf(a.closer_campaigns).some((g) => queued.has(g))) continue;
    auto.set(a.user, { at: Date.now(), phase: 'resumed' });
    await agentApi(a.user, 'external_pause', { value: 'RESUME' }).catch((e) => {
      auto.delete(a.user);
      console.error(`quitar pausa ${a.user}: ${e.message}`);
    });
  }
}

export function startInboundPause() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (e) {
      console.error(`entrantes en pausa: ${e.message}`);
    } finally {
      busy = false;
    }
  }, TICK_MS);
}

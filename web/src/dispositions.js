import { getLang } from './i18n.js';

// Nombres en español de las calificaciones (estados) de sistema de Vicidial. Vicidial los guarda en inglés:
// en inglés se muestra el nombre original y las calificaciones personalizadas siempre con su propio nombre.
const ES = {
  A: 'Contestador', AA: 'Contestador (automático)', AB: 'Ocupado (automático)', ADAIR: 'Silencio (automático)',
  ADC: 'Número desconectado (automático)', ADCT: 'Número desconectado temporalmente', AFAX: 'Fax (automático)',
  AFTHRS: 'Entrante fuera de horario', AL: 'Contestador: mensaje reproducido', AM: 'Contestador: enviado a mensaje',
  B: 'Ocupado', CALLBK: 'Volver a llamar', CBHOLD: 'Rellamada en espera', DAIR: 'Silencio', DC: 'Número desconectado',
  DEC: 'Venta rechazada', DNC: 'NO LLAMAR', DNCC: 'NO LLAMAR (lista de la campaña)', DNCL: 'NO LLAMAR (lista del sistema)',
  DROP: 'Agente no disponible', ERI: 'Error del agente', INCALL: 'En llamada', IQNANQ: 'En cola sin agentes: abandonada',
  IVRXFR: 'Saliente desviada a menú IVR', LRERR: 'Error de canal local saliente', LSMERG: 'Lead antiguo fusionado',
  MAXCAL: 'Entrante: máximo de llamadas', MLINAT: 'Multi-lead: desactivado', N: 'No contesta', NA: 'No contesta (automático)',
  NANQUE: 'Entrante sin agentes ni cola', NEW: 'Nuevo', NI: 'No interesado', NOESP: 'No habla español', NP: 'Sin presentación ni precio',
  PDROP: 'Saliente cortada antes de enrutar', PM: 'Mensaje reproducido', PU: 'Llamada contestada', QCFAIL: 'Rellamada por fallo de calidad',
  QUEUE: 'Pendiente de llamar', QVMAIL: 'Abandono en cola: buzón de voz', RQXFER: 'Vuelta a la cola', SALE: 'Venta',
  SVYCLM: 'Encuesta: enviada a menú', SVYEXT: 'Encuesta: enviada a extensión', SVYHU: 'Encuesta: colgó',
  SVYREC: 'Encuesta: enviada a grabación', SVYVM: 'Encuesta: enviada a buzón', TIMEOT: 'Entrante: tiempo de cola agotado',
  XDROP: 'Agente no disponible (entrante)', XFER: 'Llamada transferida',
};

/** Nombre de una calificación en el idioma de la interfaz. */
// Calificaciones propias de EnVoip System (en Vicidial se guardan sin tildes)
const EN = { NOESP: "Doesn't speak Spanish" };

export function dispoName(status, name) {
  if (getLang() === 'es' && ES[status]) return ES[status];
  if (getLang() !== 'es' && EN[status]) return EN[status];
  return name || status || '—';
}

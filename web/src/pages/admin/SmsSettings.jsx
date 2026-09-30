import { useEffect, useState } from 'react';
import { api, post } from '../../api.js';
import { Card, Field, Toggle, useAction, useLoad, useToast } from '../../components/ui.jsx';
import { AdminHead } from './Overview.jsx';
import { useT } from '../../i18n.js';

/** Configuración del centro de mensajes SMS/MMS (VoIP.ms). */
export default function SmsSettings() {
  const t = useT();
  const { data, error, reload } = useLoad('/sms/settings');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();

  useEffect(() => {
    if (data?.available)
      setF({ enabled: data.enabled || false, voipmsUser: data.voipmsUser || '', voipmsPass: '', dids: (data.dids || []).join(', '), defaultDid: data.defaultDid || '', stopReply: data.stopReply || '' });
  }, [data]);

  const save = () => run('save', () => api('/sms/settings', { method: 'PUT', body: f }), t('Configuración guardada')).then(reload);
  const test = async () => {
    const r = await run('test', () => post('/sms/settings/test'));
    if (r) toast(t('Conexión correcta. DIDs de la cuenta: {dids}', { dids: r.dids.map((d) => `${d.did}${d.sms ? ' (SMS)' : ''}`).join(', ') || t('ninguno') }));
  };
  const pollNow = async () => {
    const r = await run('poll', () => post('/sms/poll'));
    if (r) toast(t('{n} mensajes nuevos recogidos', { n: r.added }));
  };
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast(t('Copiado')));

  return (
    <div className="page">
      <AdminHead title={t('Mensajería SMS')} subtitle={t('SMS y MMS con tus clientes a través de VoIP.ms')}>
        {f && <button className="btn btn-primary" disabled={!!busy} onClick={save}>{t('Guardar')}</button>}
      </AdminHead>
      {error && <div className="alert alert-error">{error}</div>}
      {data && !data.available && <div className="alert alert-error">{t('La base de datos de EnVoip no está configurada en el servidor (ENVOIP_DB_*). Ejecuta el script de aprovisionamiento.')}</div>}
      {f && (
        <div className="grid-2">
          <Card title={t('Cuenta de VoIP.ms')}>
            <div className="stack">
              <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={f.enabled ? t('Mensajería activada') : t('Mensajería desactivada')} />
              <Field label={t('Usuario de API (email de la cuenta de VoIP.ms)')}><input value={f.voipmsUser} onChange={(e) => setF({ ...f, voipmsUser: e.target.value })} /></Field>
              <Field label={t('Contraseña de API')} hint={data.hasPassword ? t('Guardada. Déjala vacía para no cambiarla.') : t('La que defines en voip.ms → Main Menu → SOAP and REST/JSON API')}>
                <input type="password" autoComplete="new-password" value={f.voipmsPass} onChange={(e) => setF({ ...f, voipmsPass: e.target.value })} />
              </Field>
              <Field label={t('DIDs con SMS (10 dígitos, separados por comas)')}><input value={f.dids} onChange={(e) => setF({ ...f, dids: e.target.value })} placeholder="3055551234, 7865550000" /></Field>
              <Field label={t('DID de envío por defecto')}><input value={f.defaultDid} onChange={(e) => setF({ ...f, defaultDid: e.target.value })} /></Field>
              <Field label={t('Respuesta automática al darse de baja (STOP / BAJA)')} hint={t('Además, el número pasa a la lista negra del sistema.')}>
                <textarea rows={2} maxLength={160} value={f.stopReply} onChange={(e) => setF({ ...f, stopReply: e.target.value })} />
              </Field>
              <div className="row-gap" style={{ justifyContent: 'flex-start' }}>
                <button className="btn" disabled={!!busy} onClick={test}>{t('Probar conexión')}</button>
                <button className="btn btn-ghost" disabled={!!busy || !data.enabled} onClick={pollNow}>{t('Recoger mensajes ahora')}</button>
              </div>
            </div>
          </Card>
          <Card title={t('Recepción de mensajes')}>
            <div className="stack">
              <p className="small">
                {t('Para recibir los mensajes al instante, en voip.ms → DID Numbers → Manage DIDs → editar el DID → SMS/MMS activa «SMS/MMS URL Callback» y pega esta URL:')}
              </p>
              <div className="copybox mono">{data.webhookUrl}</div>
              <div className="row-gap" style={{ justifyContent: 'flex-start' }}>
                <button className="btn btn-sm" onClick={() => copy(data.webhookUrl)}>{t('Copiar URL')}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => run('tok', () => api('/sms/settings', { method: 'PUT', body: { regenerateToken: true } }), t('Nueva URL generada')).then(reload)}>{t('Generar otra URL')}</button>
              </div>
              <div className="alert alert-info small">
                {t('El servidor debe ser accesible desde Internet para que VoIP.ms pueda avisar. Si no lo es (como en el laboratorio), el servidor consulta VoIP.ms cada minuto igualmente, así que los mensajes llegan con un pequeño retraso.')}
              </div>
              <h3 className="h3">{t('Requisitos en voip.ms')}</h3>
              <ol className="small steps">
                <li>{t('Main Menu → SOAP and REST/JSON API: activar la API, poner la contraseña de API y autorizar la IP pública de este servidor.')}</li>
                <li>{t('En cada DID: activar SMS/MMS.')}</li>
                <li>{t('EE. UU./Canadá: los mensajes a clientes requieren su consentimiento y registro 10DLC del DID.')}</li>
              </ol>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

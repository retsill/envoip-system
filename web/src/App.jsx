import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, post } from './api.js';
import { useT } from './i18n.js';
import Layout from './components/Layout.jsx';
import { ToastProvider } from './components/ui.jsx';
import { ConfirmProvider } from './components/Modal.jsx';
import Login from './pages/Login.jsx';
import Supervisor from './pages/Supervisor.jsx';
import Agent from './pages/Agent.jsx';
import Leads from './pages/Leads.jsx';
import AdminOverview from './pages/admin/Overview.jsx';
import AdminUsers from './pages/admin/Users.jsx';
import AdminPhones from './pages/admin/Phones.jsx';
import AdminCampaigns from './pages/admin/Campaigns.jsx';
import AdminRecordings from './pages/admin/Recordings.jsx';
import AdminReports from './pages/admin/Reports.jsx';
import AdminDnc from './pages/admin/Dnc.jsx';
import AdminDids from './pages/admin/Dids.jsx';
import AdminRemoteAgents from './pages/admin/RemoteAgents.jsx';
import AdminSms from './pages/admin/SmsSettings.jsx';
import Messages from './pages/Messages.jsx';
import InternalChat from './pages/InternalChat.jsx';

export const SUPERVISOR_LEVEL = 7;
export const ADMIN_LEVEL = 8;
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function App() {
  const t = useT();
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api('/auth/me').then(setUser, () => setUser(null));
    const onUnauth = () => setUser(null);
    window.addEventListener('vm:unauthorized', onUnauth);
    return () => window.removeEventListener('vm:unauthorized', onUnauth);
  }, []);

  const logout = async () => {
    await post('/auth/logout').catch(() => {});
    setUser(null);
  };

  if (user === undefined) return <div className="boot">{t('Cargando…')}</div>;

  const isSup = user && user.level >= SUPERVISOR_LEVEL;
  const isAdmin = user && user.level >= ADMIN_LEVEL;
  const home = isSup ? '/supervisor' : '/agente';

  return (
    <AuthCtx.Provider value={{ user, setUser, logout, isSup, isAdmin }}>
      <ToastProvider>
      <ConfirmProvider>
        {!user ? (
          <Routes>
            <Route path="*" element={<Login />} />
          </Routes>
        ) : (
          <Routes>
            <Route element={<Layout />}>
              <Route path="/agente" element={<Agent />} />
              <Route path="/mensajes" element={<Messages />} />
              <Route path="/chat" element={<InternalChat />} />
              {isSup && <Route path="/supervisor" element={<Supervisor />} />}
              {isSup && <Route path="/leads" element={<Leads />} />}
              {isAdmin && (
                <>
                  <Route path="/admin" element={<AdminOverview />} />
                  <Route path="/admin/usuarios" element={<AdminUsers />} />
                  <Route path="/admin/telefonos" element={<AdminPhones />} />
                  <Route path="/admin/campanas" element={<AdminCampaigns />} />
                  <Route path="/admin/grabaciones" element={<AdminRecordings />} />
                  <Route path="/admin/reportes" element={<AdminReports />} />
                  <Route path="/admin/dnc" element={<AdminDnc />} />
                  <Route path="/admin/dids" element={<AdminDids />} />
                  <Route path="/admin/remotos" element={<AdminRemoteAgents />} />
                  <Route path="/admin/sms" element={<AdminSms />} />
                </>
              )}
              <Route path="*" element={<Navigate to={home} replace />} />
            </Route>
          </Routes>
        )}
      </ConfirmProvider>
      </ToastProvider>
    </AuthCtx.Provider>
  );
}

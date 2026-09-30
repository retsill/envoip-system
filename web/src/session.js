// Contraseña de Vicidial del agente, solo en esta pestaña (sessionStorage se borra al cerrarla).
// Se usa para iniciar la sesión clásica oculta sin pedirla dos veces; nunca se envía a nuestro servidor.
const KEY = 'vm-agent-pass';
let memory = null;

export function setAgentPass(pass) {
  memory = pass;
  try {
    sessionStorage.setItem(KEY, pass);
  } catch {
    /* sin almacenamiento: queda en memoria */
  }
}

export function getAgentPass() {
  if (memory) return memory;
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearAgentPass() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nada que borrar */
  }
}

// Última campaña usada, para preseleccionarla
export function lastCampaign(value) {
  try {
    if (value) localStorage.setItem('vm-last-campaign', value);
    return localStorage.getItem('vm-last-campaign');
  } catch {
    return null;
  }
}

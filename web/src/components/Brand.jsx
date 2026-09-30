const BASE = import.meta.env.BASE_URL;

// Logo de EnVoip System. En fondos siempre oscuros (menú lateral) va la versión clara;
// en el resto se elige según el tema con CSS.
export function Logo({ variant = 'auto', height = 34 }) {
  const img = (file, cls) => <img className={cls} src={`${BASE}${file}`} alt="EnVoip System" style={{ height }} />;
  if (variant === 'onDark') return img('logo-dark.png', 'logo');
  return (
    <>
      {img('logo-light.png', 'logo logo-for-light')}
      {img('logo-dark.png', 'logo logo-for-dark')}
    </>
  );
}

export function Footer({ className = '' }) {
  const year = new Date().getFullYear();
  return (
    <footer className={`footer ${className}`}>
      © 2006 - {year} · Worked:{' '}
      <a href="https://xcodevs.com" target="_blank" rel="noreferrer">XcoDevs</a> · by:{' '}
      <a href="https://enwebs.net" target="_blank" rel="noreferrer">Enwebs Estudios</a>
    </footer>
  );
}

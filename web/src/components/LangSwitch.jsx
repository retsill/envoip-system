import { LANGS, useLang, useT } from '../i18n.js';

/** Selector de idioma de la interfaz (se recuerda en este navegador). */
export function LangSwitch({ className = '' }) {
  const t = useT();
  const [lang, setLang] = useLang();
  return (
    <div className={`segmented lang-switch ${className}`} role="radiogroup" aria-label={t('Idioma')}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={lang === l.code}
          className={lang === l.code ? 'on' : ''}
          title={l.label}
          onClick={() => setLang(l.code)}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}

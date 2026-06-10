// Merge per-file translation "parts" into per-namespace JSON, deep-merging into
// any existing hand-written namespace files, then regenerate src/i18n/index.ts.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src', 'locales');
const LANGS = ['en', 'zh', 'es'];

const set = (obj, dotted, val) => {
  const parts = dotted.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] == null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = val;
};

const nsSet = new Set();

for (const lang of LANGS) {
  const partsDir = join(localesDir, lang, 'parts');
  if (!existsSync(partsDir)) continue;
  // group parts by ns
  const perNs = {};
  for (const file of readdirSync(partsDir).filter(f => f.endsWith('.json'))) {
    const ns = file.split('__')[0];
    let flat;
    try { flat = JSON.parse(readFileSync(join(partsDir, file), 'utf8')); }
    catch { console.error('skip bad JSON', lang, file); continue; }
    (perNs[ns] ||= {});
    Object.assign(perNs[ns], flat);
  }
  for (const [ns, flat] of Object.entries(perNs)) {
    nsSet.add(ns);
    const target = join(localesDir, lang, `${ns}.json`);
    const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
    for (const [k, v] of Object.entries(flat)) set(existing, k, v);
    writeFileSync(target, JSON.stringify(existing, null, 2) + '\n');
  }
}

// Always include hand-written namespaces that may have no parts
['common', 'nav'].forEach(n => nsSet.add(n));
// include any ns that already has a json file in en
for (const f of readdirSync(join(localesDir, 'en')).filter(f => f.endsWith('.json'))) {
  nsSet.add(f.replace('.json', ''));
}
const namespaces = [...nsSet].sort();

// ── Regenerate src/i18n/index.ts ──────────────────────────────────────────────
const varName = (lang, ns) => `${lang}_${ns}`;
const imports = [];
const resourceLines = [];
for (const lang of LANGS) {
  const entries = [];
  for (const ns of namespaces) {
    if (!existsSync(join(localesDir, lang, `${ns}.json`))) continue;
    imports.push(`import ${varName(lang, ns)} from '../locales/${lang}/${ns}.json';`);
    entries.push(`      ${ns}: ${varName(lang, ns)},`);
  }
  resourceLines.push(`    ${lang}: {\n${entries.join('\n')}\n    },`);
}

const index = `import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

${imports.join('\n')}

// Supported UI languages. \`es\` = Mexican Spanish (es-MX).
export const SUPPORTED_LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
] as const;

export const NAMESPACES = ${JSON.stringify(namespaces)} as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
${resourceLines.join('\n')}
    },
    fallbackLng: 'en',
    supportedLngs: ['zh', 'en', 'es'],
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'common',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'erp_lang',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

const setHtmlLang = (lng: string) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
};
setHtmlLang(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', setHtmlLang);

export default i18n;
`;
writeFileSync(join(root, 'src', 'i18n', 'index.ts'), index);

console.log('namespaces:', namespaces.join(', '));
console.log('wrote src/i18n/index.ts');

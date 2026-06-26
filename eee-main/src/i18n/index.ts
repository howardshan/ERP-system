import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en_app from '../locales/en/app.json';
import en_auth from '../locales/en/auth.json';
import en_dashboard from '../locales/en/dashboard.json';
import en_faq from '../locales/en/faq.json';
import en_common from '../locales/en/common.json';
import en_finance from '../locales/en/finance.json';
import en_hr from '../locales/en/hr.json';
import en_nav from '../locales/en/nav.json';
import en_packaging from '../locales/en/packaging.json';
import en_production from '../locales/en/production.json';
import en_qc from '../locales/en/qc.json';
import en_ui from '../locales/en/ui.json';
import en_warehouse from '../locales/en/warehouse.json';
import en_workflowBuilder from '../locales/en/workflowBuilder.json';
import zh_app from '../locales/zh/app.json';
import zh_auth from '../locales/zh/auth.json';
import zh_dashboard from '../locales/zh/dashboard.json';
import zh_faq from '../locales/zh/faq.json';
import zh_common from '../locales/zh/common.json';
import zh_finance from '../locales/zh/finance.json';
import zh_hr from '../locales/zh/hr.json';
import zh_nav from '../locales/zh/nav.json';
import zh_packaging from '../locales/zh/packaging.json';
import zh_production from '../locales/zh/production.json';
import zh_qc from '../locales/zh/qc.json';
import zh_ui from '../locales/zh/ui.json';
import zh_warehouse from '../locales/zh/warehouse.json';
import zh_workflowBuilder from '../locales/zh/workflowBuilder.json';
import es_app from '../locales/es/app.json';
import es_auth from '../locales/es/auth.json';
import es_dashboard from '../locales/es/dashboard.json';
import es_faq from '../locales/es/faq.json';
import es_common from '../locales/es/common.json';
import es_finance from '../locales/es/finance.json';
import es_hr from '../locales/es/hr.json';
import es_nav from '../locales/es/nav.json';
import es_packaging from '../locales/es/packaging.json';
import es_production from '../locales/es/production.json';
import es_qc from '../locales/es/qc.json';
import es_ui from '../locales/es/ui.json';
import es_warehouse from '../locales/es/warehouse.json';
import es_workflowBuilder from '../locales/es/workflowBuilder.json';

// Supported UI languages. `es` = Mexican Spanish (es-MX).
export const SUPPORTED_LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
] as const;

export const NAMESPACES = ["app","auth","common","dashboard","faq","finance","hr","nav","packaging","production","qc","ui","warehouse","workflowBuilder"] as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
    en: {
      app: en_app,
      auth: en_auth,
      dashboard: en_dashboard,
      faq: en_faq,
      common: en_common,
      finance: en_finance,
      hr: en_hr,
      nav: en_nav,
      packaging: en_packaging,
      production: en_production,
      qc: en_qc,
      ui: en_ui,
      warehouse: en_warehouse,
      workflowBuilder: en_workflowBuilder,
    },
    zh: {
      app: zh_app,
      auth: zh_auth,
      dashboard: zh_dashboard,
      faq: zh_faq,
      common: zh_common,
      finance: zh_finance,
      hr: zh_hr,
      nav: zh_nav,
      packaging: zh_packaging,
      production: zh_production,
      qc: zh_qc,
      ui: zh_ui,
      warehouse: zh_warehouse,
      workflowBuilder: zh_workflowBuilder,
    },
    es: {
      app: es_app,
      auth: es_auth,
      dashboard: es_dashboard,
      faq: es_faq,
      common: es_common,
      finance: es_finance,
      hr: es_hr,
      nav: es_nav,
      packaging: es_packaging,
      production: es_production,
      qc: es_qc,
      ui: es_ui,
      warehouse: es_warehouse,
      workflowBuilder: es_workflowBuilder,
    },
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

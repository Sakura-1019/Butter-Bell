import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN.json'

// 界面语言：加一种语言 = 在 locales/ 里加一份 JSON，再在这里登记（名字用那种语言自己的写法）
export const LANGUAGES: Record<string, { name: string; translation: object }> = {
  'zh-CN': { name: '简体中文', translation: zhCN }
}

i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources: Object.fromEntries(Object.entries(LANGUAGES).map(([k, v]) => [k, { translation: v.translation }])),
  interpolation: { escapeValue: false }
})

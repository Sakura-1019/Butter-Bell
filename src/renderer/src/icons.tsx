import type { ReactNode } from 'react'

// 图标沿用原型：24 视框、1.6 描边
const icon = (d: ReactNode) => (
  <svg className="i" viewBox="0 0 24 24" aria-hidden="true">{d}</svg>
)
export const ICONS = {
  all: icon(<><rect x="2" y="6" width="20" height="12" rx="6" /><path d="M6 12h4M8 10v4" /><circle cx="15.5" cy="11" r=".6" fill="currentColor" /><circle cx="17.5" cy="13" r=".6" fill="currentColor" /></>),
  inbox: icon(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  recent: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  settings: icon(<><path d="M20 7h-9M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></>),
  check: icon(<path d="M20 6 9 17l-5-5" />),
  archive: icon(<><rect x="2.5" y="3.5" width="19" height="5" rx="1" /><path d="M4 8.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5M10 12.5h4" /></>),
  layers: icon(<><path d="m12 2.5 9.5 5-9.5 5-9.5-5z" /><path d="m2.5 12 9.5 5 9.5-5" /><path d="m2.5 16.5 9.5 5 9.5-5" /></>),
  chevDown: icon(<path d="m6 9 6 6 6-6" />),
  chevUp: icon(<path d="m6 15 6-6 6 6" />),
  refresh: icon(<><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 21v-5h-5" /></>),
  image: icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>),
  folder: icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  grid: icon(<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>),
  list: icon(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r=".8" fill="currentColor" /><circle cx="3.5" cy="12" r=".8" fill="currentColor" /><circle cx="3.5" cy="18" r=".8" fill="currentColor" /></>),
  eye: icon(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: icon(<><path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3 3 18 18" /></>),
  play: icon(<path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5z" fill="currentColor" stroke="none" />),
  x: icon(<path d="M18 6 6 18M6 6l12 12" />),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  external: icon(<><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>),
  crown: icon(<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />),
  search: icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>)
}

// 定稿 Logo“融化的铃铛”，照搬 prototype/logo/butter-bell-mark.svg，颜色换成主题变量
export const Bell = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <g fill="var(--accent)">
      <circle cx="32" cy="10" r="3.2" />
      <path d="M32 12C21.15 12 14.5 19.88 14.5 30.5C14.5 34.5 14.5 34 14.5 38C14.5 40.5 13.5 42 12 45.2C10.8 46.2 11.4 48 13 48h4.5c1.4 0 2.5 1.1 2.5 2.5v2a3.2 3.2 0 0 0 6.4 0v-1.5c0-1.6 1.2-3 2.8-3h1.4c1.4 0 2.4 1 2.4 2.4a2 2 0 0 0 4 0c0-1.3 1-2.4 2.4-2.4H42.4c1.1 0 1.6.8 1.6 1.6a1.2 1.2 0 0 0 2.4 0c0-.8.5-1.6 1.6-1.6H51C52.6 48 53.2 46.2 52 45.2C50.5 42 49.5 40.5 49.5 38C49.5 34 49.5 34.5 49.5 30.5C49.5 19.88 42.85 12 32 12ZM45.2 52.5c0 0-2.9 3.625-2.9 5.655a2.9 2.9 0 0 0 5.8 0c0-2.03-2.9-5.655-2.9-5.655z" />
    </g>
    <path d="M21 29c0-4.6 2.6-8.3 6.5-9.6" fill="none" stroke="#ffffff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
  </svg>
)

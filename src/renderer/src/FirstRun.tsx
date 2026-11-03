// 首次设置向导：仓库目录、游戏目录必选，Locale Emulator 可选。两个目录都选过的用户不会再看到它。
import { useTranslation } from 'react-i18next'
import type { Settings as S } from '../../preload'
import { Bell } from './icons'

export const needsFirstRun = (s: S) => !s.archiveDir || !s.libraryDir

export default function FirstRun({ s, onChange, onDone }: { s: S; onChange: (s: S) => void; onDone: () => void }) {
  const { t } = useTranslation()
  const choose = (key: 'archive_dir' | 'library_dir' | 'locale_emulator_path') => window.api.settings.choose(key).then(onChange)
  const step = (n: number, key: 'archive_dir' | 'library_dir' | 'locale_emulator_path', value: string | null) => (
    <div className="fr-step">
      <span className={value ? 'fr-n done' : 'fr-n'}>{n}</span>
      <div className="lbl">
        {t(`firstRun.${key}`)}
        {key === 'locale_emulator_path' && <span className="fr-opt">{t('firstRun.optional')}</span>}
        <small title={value ?? undefined}>{value ?? t(`firstRun.${key}Hint`)}</small>
      </div>
      <button className="btn" onClick={() => choose(key)}>{value ? t('settings.change') : t('settings.choose')}</button>
    </div>
  )
  return (
    <div className="modal-wrap firstrun" role="dialog" aria-modal="true" aria-label={t('firstRun.title')}>
      <div className="modal wide">
        <div className="fr-brand"><Bell /></div>
        <h2>{t('firstRun.title')}</h2>
        <p>{t('firstRun.hint')}</p>
        {step(1, 'archive_dir', s.archiveDir)}
        {step(2, 'library_dir', s.libraryDir)}
        {step(3, 'locale_emulator_path', s.localeEmulatorPath)}
        <div className="foot">
          <span className="grow muted small">{t('firstRun.later')}</span>
          <button className="btn primary" disabled={needsFirstRun(s)} onClick={onDone}>{t('firstRun.go')}</button>
        </div>
      </div>
    </div>
  )
}

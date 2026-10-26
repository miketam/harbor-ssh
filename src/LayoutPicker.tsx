import { useState } from 'react';
import { Dialog } from './Dialog';
import { t } from './i18n';
import type { Layout } from './appearance';

export const layouts: { id: Layout; title: string; description: string }[] = [
  { id: 'classic', title: '经典工作台', description: '主机侧栏与终端并排，常用操作触手可及。' },
  { id: 'manager', title: '主机管理', description: '集中查看主机与连接详情，随时返回已打开的会话。' },
  { id: 'focus', title: '专注终端', description: '为终端留出更多空间，通过快捷搜索切换主机。' },
];
export function LayoutPicker({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  return <div className="layout-options" role="group" aria-label={t('工作区布局')}>{layouts.map((layout, index) =>
    <button key={layout.id} className={'layout-option ' + (value === layout.id ? 'chosen' : '')} aria-pressed={value === layout.id} onClick={() => onChange(layout.id)}>
      <span className={'layout-preview preview-' + layout.id} aria-hidden="true">
        <span className="preview-nav"/><span className="preview-content"><i/><i/><i/><i/></span>
        {layout.id === 'manager' && <span className="preview-detail"/>}
        {layout.id === 'focus' && <span className="preview-search"/>}
      </span>
      <strong>{String.fromCharCode(65 + index)} · {t(layout.title)}</strong><span>{t(layout.description)}</span>
    </button>
  )}</div>;
}
export function WelcomeLayout({ onDone }: { onDone: (layout: Layout) => void }) {
  const [choice, setChoice] = useState<Layout>('classic');
  return <Dialog title={t('选择你的工作区')} onClose={() => onDone('classic')}>
    <p className="dialog-intro">{t('选择适合你的布局，之后可以随时在设置中切换。')}</p>
    <LayoutPicker value={choice} onChange={setChoice}/>
    <div className="dialog-actions"><button className="quiet-button" onClick={() => onDone('classic')}>{t('跳过，使用经典工作台')}</button><button className="primary-button" onClick={() => onDone(choice)}>{t('开始使用')}</button></div>
  </Dialog>;
}

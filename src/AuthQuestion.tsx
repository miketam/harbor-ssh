import { useState, type FormEvent } from 'react';
import type { SessionEvent } from '../shared';
import { Dialog, errorMessage } from './Dialog';
export function AuthQuestion({ question, hostName, onDone }: {
  question: Extract<SessionEvent, { type: 'interactive' }>; hostName: string; onDone: () => void;
}) {
  const [answers, setAnswers] = useState(() => question.prompts.map(() => '')), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  async function respond(accept: boolean, event?: FormEvent) {
    event?.preventDefault(); if (saving) return;
    setSaving(true); setError(''); const values = answers; setAnswers(question.prompts.map(() => ''));
    try { await window.harbor.answerInteractive(question.sessionId, question.requestId, accept ? values : null); onDone(); }
    catch (e) { setError(errorMessage(e)); onDone(); } finally { setSaving(false); }
  }
  return <Dialog title="交互认证" onClose={() => void respond(false)}><form onSubmit={event => void respond(true, event)}>
    <div className="trust-badge">{hostName}</div>
    {question.name && <h3 className="auth-name">{question.name}</h3>}
    {question.instructions && <p className="dialog-intro server-text">{question.instructions}</p>}
    {question.prompts.map((prompt, index) => <label key={index}>{prompt.prompt || `认证问题 ${index + 1}`}<input autoFocus={index === 0} type={prompt.echo ? 'text' : 'password'} autoComplete="off" maxLength={4096} aria-label={prompt.prompt || `认证问题 ${index + 1}`} value={answers[index]} onChange={e => setAnswers(current => current.map((value, i) => i === index ? e.target.value : value))} /></label>)}
    <p className="field-note">问题来自当前服务器。回答只用于此会话，不写入身份库。</p>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="quiet-button" disabled={saving} onClick={() => void respond(false)}>取消认证</button><button className="primary-button" disabled={saving}>提交回答</button></div>
  </form></Dialog>;
}

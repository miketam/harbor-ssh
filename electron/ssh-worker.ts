import { SshSession } from './ssh';
const port = process.parentPort;
let session: SshSession | undefined;
port.on('message', ({ data }: { data: any }) => {
  try {
    switch (data.type) {
      case 'connect':
        session = new SshSession(data.sessionId, event => port.postMessage(event));
        session.connect(data.host, data.auth, data.columns, data.rows, data.jump);
        data.auth = undefined; data.jump = undefined;
        break;
      case 'resource':
        if (!session) { port.postMessage({ type: 'reply', requestId: data.requestId, error: '会话不存在' }); break; }
        void session.request(data.request).then(result => port.postMessage({ type: 'reply', requestId: data.requestId, result }), () => port.postMessage({ type: 'reply', requestId: data.requestId, error: '操作失败，请检查路径、权限、端口和连接状态。' }));
        break;
      case 'trust': session?.decide(data.accept); break;
      case 'answer': session?.answer(data.requestId, data.answers); break;
      case 'input': session?.input(data.data); break;
      case 'resize': session?.resize(data.columns, data.rows); break;
      case 'ack': session?.acknowledge(); break;
      case 'close': void (session?.close() ?? Promise.resolve()).finally(() => process.exit(0)); break;
    }
  } catch {
    port.postMessage({ type: 'error', sessionId: data.sessionId, message: 'SSH 工作进程无法完成请求，请重新连接。' });
    session?.close();
  }
});

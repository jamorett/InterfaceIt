import { useEffect, useState } from 'react';
import { strings } from './strings.ts';
import { connect, readToken, type Status } from './ws.ts';

export function App() {
  const [status, setStatus] = useState<Status>('connecting');
  useEffect(() => {
    const token = readToken();
    if (!token) {
      setStatus('no-link');
      return;
    }
    const ws = connect(token, setStatus, () => {});
    return () => ws.close();
  }, []);
  const text = { connecting: strings.connecting, ready: strings.connected, 'no-link': strings.noLink, closed: strings.closed }[status];
  return <p role="status">{text}</p>;
}

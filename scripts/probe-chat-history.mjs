import WebSocket from 'ws';
const url = 'ws://127.0.0.1:18789/ws';
const ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'chat.history',
    params: { sessionKey: 'agent:fury:mission-planning:5aa33d33-55ce-47b4-a5aa-908fa841b4eb', limit: 50 }
  }));
});
ws.on('message', (data) => {
  const r = JSON.parse(data.toString());
  if (r.error) {
    console.log('RPC ERROR:', JSON.stringify(r.error));
  } else {
    const msgs = r.result?.messages || [];
    console.log('messages:', msgs.length);
    msgs.forEach((m, i) => {
      const text = (m.content || []).map(c => c.text || '').join('\n');
      console.log(`\n[${i}] role=${m.role}`);
      console.log(text.slice(0, 800));
    });
  }
  ws.close();
});
ws.on('error', e => { console.error('ERR:', e.message); process.exit(1); });

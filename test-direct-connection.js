import WebSocket from 'ws';

const host = '6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com';
const port = 8563;
const url = `wss://${host}:${port}`;

console.log(`Testing connection to ${url}...`);

const ws = new WebSocket(url, {
  rejectUnauthorized: false,
  handshakeTimeout: 30000
});

let messageCount = 0;

ws.on('open', () => {
  console.log('✅ WebSocket connection opened');
});

ws.on('message', (data) => {
  messageCount++;
  console.log(`\n📥 Message #${messageCount}:`);
  try {
    const message = JSON.parse(data.toString());
    console.log(JSON.stringify(message, null, 2));
    
    if (message.responseData?.publicKeyPem) {
      console.log('\n✅ SUCCESS: Received Exasol public key!');
      console.log('This confirms Exasol is accessible on wss://...8563');
      ws.close();
      process.exit(0);
    }
  } catch (e) {
    console.log('Raw message:', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 Connection closed: ${code} ${reason || ''}`);
  process.exit(0);
});

// Give it 10 seconds max
setTimeout(() => {
  console.log('\n⏰ Timeout - closing connection');
  ws.close();
  process.exit(1);
}, 10000);
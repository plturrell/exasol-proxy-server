import WebSocket from 'ws';

const host = '6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com';
const port = 8563;
const url = `wss://${host}:${port}`;

console.log(`Testing Exasol handshake on ${url}...`);

const ws = new WebSocket(url, {
  rejectUnauthorized: false,
  handshakeTimeout: 30000
});

let messageCount = 0;

ws.on('open', () => {
  console.log('✅ WebSocket connection opened');
  console.log('Sending initial command to trigger handshake...');
  
  // Send a command to trigger response
  const cmd = {
    command: 'login',
    protocolVersion: 3
  };
  
  console.log('Sending:', JSON.stringify(cmd));
  ws.send(JSON.stringify(cmd));
});

ws.on('message', (data) => {
  messageCount++;
  console.log(`\n📥 Message #${messageCount}:`);
  try {
    const message = JSON.parse(data.toString());
    console.log(JSON.stringify(message, null, 2));
    
    if (message.responseData?.publicKeyPem) {
      console.log('\n✅ SUCCESS: Received Exasol public key!');
      console.log('Protocol:', message.protocolVersion);
    }
    
    if (messageCount >= 2 || message.responseData?.publicKeyPem) {
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

setTimeout(() => {
  console.log('\n⏰ Timeout - closing connection');
  ws.close();
  process.exit(1);
}, 30000);
// test-exasol-443.js
// Run this locally to check if your Exasol supports port 443

import WebSocket from 'ws';

async function testExasolPort443() {
  const host = process.env.EXASOL_HOST || 'your-cluster.exasol.com';
  
  console.log(`Testing Exasol connections for: ${host}\n`);

  // Test configurations - 443 is often supported for cloud instances
  const tests = [
    { 
      url: `wss://${host}:443`, 
      name: 'Port 443 - Standard WebSocket' 
    },
    { 
      url: `wss://${host}:443/websocket`, 
      name: 'Port 443 - With /websocket path' 
    },
    { 
      url: `wss://${host}:443/ws`, 
      name: 'Port 443 - With /ws path' 
    },
    { 
      url: `wss://${host}`, 
      name: 'Port 443 - Implicit (no port specified)' 
    }
  ];

  for (const test of tests) {
    console.log(`\nTesting: ${test.name}`);
    console.log(`URL: ${test.url}`);
    
    try {
      const ws = new WebSocket(test.url, {
        rejectUnauthorized: false,
        handshakeTimeout: 15000,
        headers: {
          'User-Agent': 'Exasol-Test-Client/1.0'
        }
      });

      const result = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ success: false, error: 'Timeout after 15 seconds' });
        }, 15000);

        ws.on('open', () => {
          console.log('✅ WebSocket opened!');
        });

        ws.on('message', (data) => {
          clearTimeout(timeout);
          const message = data.toString();
          console.log('✅ Received data:', message.substring(0, 100) + '...');
          
          // Check if this is an Exasol handshake
          if (message.includes('publicKeyPem') || message.includes('publicKeyModulus')) {
            console.log('✅ This is definitely Exasol! Found public key handshake.');
            ws.close();
            resolve({ 
              success: true, 
              url: test.url,
              message: 'Exasol handshake detected' 
            });
          } else {
            ws.close();
            resolve({ 
              success: true, 
              url: test.url,
              message: 'Connected but no Exasol handshake' 
            });
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          resolve({ success: false, error: err.message });
        });

        ws.on('unexpected-response', (request, response) => {
          clearTimeout(timeout);
          console.log(`HTTP ${response.statusCode}: ${response.statusMessage}`);
          resolve({ 
            success: false, 
            error: `HTTP ${response.statusCode}` 
          });
        });
      });

      if (result.success) {
        console.log(`\n🎉 SUCCESS! Use this configuration:`);
        console.log(`URL: ${test.url}`);
        console.log(`Port: 443`);
        console.log(`Protocol: wss://`);
        return result;
      } else {
        console.log(`❌ Failed: ${result.error}`);
      }

    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  }

  console.log('\n❌ No working configuration found on port 443');
  console.log('\nYou need a hosting provider that allows port 8563.');
}

// Run the test
testExasolPort443().catch(console.error);
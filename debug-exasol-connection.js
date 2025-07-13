// debug-exasol-connection.js
// Run this locally to debug Exasol connection issues

import WebSocket from 'ws';
import https from 'https';
import http from 'http';
import net from 'net';

class ExasolConnectionDebugger {
  constructor(host) {
    this.host = host;
    this.results = [];
  }

  log(message, data = null) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
    this.results.push({ message, data, timestamp: new Date() });
  }

  // Test 1: Check which ports are open
  async testPort(port, timeout = 5000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let connected = false;

      socket.setTimeout(timeout);
      
      socket.on('connect', () => {
        connected = true;
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(port, this.host);
    });
  }

  // Test 2: Try HTTP/HTTPS endpoints
  async testHttpEndpoint(protocol, port, path = '/') {
    return new Promise((resolve) => {
      const url = `${protocol}://${this.host}:${port}${path}`;
      const client = protocol === 'https' ? https : http;

      const req = client.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            success: true,
            statusCode: res.statusCode,
            headers: res.headers,
            body: data.substring(0, 200)
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          success: false,
          error: err.message
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Timeout'
        });
      });
    });
  }

  // Test 3: Try WebSocket connection with different configurations
  async testWebSocket(port, useSSL, timeout = 30000) {
    return new Promise((resolve) => {
      const protocol = useSSL ? 'wss' : 'ws';
      const url = `${protocol}://${this.host}:${port}`;
      
      this.log(`Testing WebSocket connection to ${url}`);
      
      const startTime = Date.now();
      let ws;
      
      const timeoutId = setTimeout(() => {
        if (ws) ws.close();
        resolve({
          success: false,
          error: 'Connection timeout',
          duration: Date.now() - startTime
        });
      }, timeout);

      try {
        ws = new WebSocket(url, {
          rejectUnauthorized: false, // Accept self-signed certificates
          handshakeTimeout: timeout
        });

        ws.on('open', () => {
          this.log('WebSocket opened successfully');
          clearTimeout(timeoutId);
        });

        ws.on('message', (data) => {
          clearTimeout(timeoutId);
          const message = data.toString();
          this.log('Received message:', message);
          
          try {
            const parsed = JSON.parse(message);
            ws.close();
            resolve({
              success: true,
              duration: Date.now() - startTime,
              response: parsed,
              hasPublicKey: !!parsed.responseData?.publicKeyPem
            });
          } catch (err) {
            ws.close();
            resolve({
              success: true,
              duration: Date.now() - startTime,
              response: message,
              parseError: err.message
            });
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            error: err.message,
            duration: Date.now() - startTime
          });
        });

        ws.on('close', (code, reason) => {
          this.log(`WebSocket closed: ${code} ${reason}`);
        });

      } catch (err) {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: err.message,
          duration: Date.now() - startTime
        });
      }
    });
  }

  // Main debug function
  async debug() {
    console.log('====================================');
    console.log('Exasol Connection Debugger');
    console.log(`Host: ${this.host}`);
    console.log('====================================\n');

    // Test 1: Check common Exasol ports
    this.log('Testing port connectivity...');
    const ports = [
      { port: 443, name: 'HTTPS/WSS (Cloud default)' },
      { port: 8563, name: 'Exasol default' },
      { port: 8088, name: 'Exasol HTTP' },
      { port: 8080, name: 'Alternative HTTP' },
      { port: 9090, name: 'Alternative WebSocket' }
    ];

    const openPorts = [];
    for (const { port, name } of ports) {
      const isOpen = await this.testPort(port);
      this.log(`Port ${port} (${name}): ${isOpen ? 'OPEN' : 'CLOSED'}`);
      if (isOpen) openPorts.push(port);
    }

    // Test 2: Try HTTP endpoints on open ports
    this.log('\nTesting HTTP/HTTPS endpoints...');
    for (const port of openPorts) {
      if (port === 443 || port === 8088) {
        const httpsResult = await this.testHttpEndpoint('https', port);
        this.log(`HTTPS on port ${port}:`, httpsResult);
      }
      
      if (port !== 443) {
        const httpResult = await this.testHttpEndpoint('http', port);
        this.log(`HTTP on port ${port}:`, httpResult);
      }
    }

    // Test 3: Try WebSocket connections
    this.log('\nTesting WebSocket connections...');
    const wsTests = [
      // Common configurations
      { port: 443, ssl: true, name: 'WSS on 443 (Cloud standard)' },
      { port: 8563, ssl: true, name: 'WSS on 8563 (Default SSL)' },
      { port: 8563, ssl: false, name: 'WS on 8563 (Default no SSL)' },
      { port: 8088, ssl: false, name: 'WS on 8088' },
    ];

    const successfulConnections = [];
    for (const test of wsTests) {
      if (openPorts.includes(test.port)) {
        this.log(`\nTrying ${test.name}...`);
        const result = await this.testWebSocket(test.port, test.ssl);
        
        if (result.success) {
          successfulConnections.push({ ...test, ...result });
          this.log(`✅ SUCCESS! Connected in ${result.duration}ms`);
          if (result.hasPublicKey) {
            this.log('✅ Received Exasol public key - this is the correct configuration!');
          }
        } else {
          this.log(`❌ Failed: ${result.error}`);
        }
      }
    }

    // Summary
    console.log('\n====================================');
    console.log('SUMMARY');
    console.log('====================================');
    
    if (successfulConnections.length > 0) {
      console.log('\n✅ Working configurations:');
      for (const conn of successfulConnections) {
        console.log(`   - ${conn.ssl ? 'wss' : 'ws'}://${this.host}:${conn.port}`);
        if (conn.hasPublicKey) {
          console.log('     ^ This includes Exasol handshake!');
        }
      }
      
      // Recommend the best configuration
      const exasolConnection = successfulConnections.find(c => c.hasPublicKey);
      if (exasolConnection) {
        console.log('\n📌 RECOMMENDED Configuration:');
        console.log(`   Protocol: ${exasolConnection.ssl ? 'wss' : 'ws'}`);
        console.log(`   Port: ${exasolConnection.port}`);
        console.log(`   Use SSL: ${exasolConnection.ssl}`);
        console.log(`   Connection Time: ${exasolConnection.duration}ms`);
      }
    } else {
      console.log('\n❌ No working WebSocket configurations found');
      console.log('\nPossible issues:');
      console.log('1. Firewall blocking WebSocket connections');
      console.log('2. Exasol cluster not configured for WebSocket access');
      console.log('3. Need different port or protocol configuration');
    }

    return this.results;
  }
}

// Run the debugger
async function main() {
  const host = process.argv[2];
  
  if (!host) {
    console.error('Usage: node debug-exasol-connection.js <exasol-host>');
    console.error('Example: node debug-exasol-connection.js your-cluster.exasol.com');
    process.exit(1);
  }

  const connectionDebugger = new ExasolConnectionDebugger(host);
  await connectionDebugger.debug();
}

main().catch(console.error);

// Also export for programmatic use
export default ExasolConnectionDebugger;
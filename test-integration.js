#!/usr/bin/env node

/**
 * Integration test for LLM Tool Proxy
 * Tests the complete flow: HTTP request -> tool execution -> response
 */

const http = require('http');

const testPayload = {
  model: "llama3.2",
  messages: [
    {
      role: "system",
      content: "You are a helpful assistant with access to file system tools. When asked to perform file operations, use the available tools."
    },
    {
      role: "user", 
      content: "Please list the files in the current directory and then read the content of test.txt"
    }
  ],
  stream: true
};

function makeRequest() {
  const postData = JSON.stringify(testPayload);
  
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  console.log('🧪 Testing LLM Tool Proxy integration...');
  console.log('📤 Sending request to http://localhost:3001/v1/chat/completions');
  
  const req = http.request(options, (res) => {
    console.log(`📊 Status: ${res.statusCode}`);
    console.log(`📋 Headers:`, res.headers);
    console.log('\n📥 Response stream:');
    console.log('=' .repeat(50));
    
    res.on('data', (chunk) => {
      process.stdout.write(chunk.toString());
    });
    
    res.on('end', () => {
      console.log('\n' + '='.repeat(50));
      console.log('✅ Integration test completed');
    });
  });

  req.on('error', (e) => {
    console.error(`❌ Request error: ${e.message}`);
    console.log('💡 Make sure the server is running: npm start');
  });

  req.write(postData);
  req.end();
}

// Check if server is running first
const healthCheck = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/healthz',
  method: 'GET'
}, (res) => {
  if (res.statusCode === 200) {
    console.log('✅ Server is running');
    makeRequest();
  } else {
    console.log(`❌ Server health check failed: ${res.statusCode}`);
  }
});

healthCheck.on('error', (e) => {
  console.error(`❌ Server not reachable: ${e.message}`);
  console.log('💡 Start the server first: npm start');
});

healthCheck.end();
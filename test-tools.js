/**
 * Simple test script to verify tool functionality
 */

const { SafeToolExecutor } = require('./dist/tools');

async function testTools() {
  console.log('🧪 Testing Tool Executor...\n');
  
  const executor = new SafeToolExecutor('c:\\develop\\tool-proxy\\workspace');
  
  // Test 1: List files
  console.log('1. Testing list_files...');
  const listResult = await executor.listFiles({ path: '.' });
  console.log('Result:', JSON.stringify(listResult, null, 2));
  
  // Test 2: Read file
  console.log('\n2. Testing read_file...');
  const readResult = await executor.readFile({ path: 'test.txt' });
  console.log('Result:', JSON.stringify(readResult, null, 2));
  
  // Test 3: Write file
  console.log('\n3. Testing write_file...');
  const writeResult = await executor.writeFile({ 
    path: 'generated.txt', 
    content: 'This file was created by the tool executor!' 
  });
  console.log('Result:', JSON.stringify(writeResult, null, 2));
  
  // Test 4: Execute command
  console.log('\n4. Testing exec_cmd...');
  const execResult = await executor.execCmd({ cmd: 'dir', cwd: '.' });
  console.log('Result:', JSON.stringify(execResult, null, 2));
  
  // Test 5: Test path security
  console.log('\n5. Testing path security (should fail)...');
  const securityResult = await executor.readFile({ path: '../package.json' });
  console.log('Result:', JSON.stringify(securityResult, null, 2));
  
  console.log('\n✅ Tool tests completed!');
}

testTools().catch(console.error);
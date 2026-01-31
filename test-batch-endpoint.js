#!/usr/bin/env node

/**
 * Test script for the /api/v1/batch endpoint
 * Run with: node test-batch-endpoint.js
 */

async function testBatchEndpoint() {
  const testWallets = [
    "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", // vitalik.eth
    "0x084b1c3c81545d370f3634392de611caabff8148", // random wallet
    "0x123456789abcdef123456789abcdef1234567890", // invalid/made up
  ];

  console.log("🧪 Testing /api/v1/batch endpoint");
  console.log(`📝 Testing with ${testWallets.length} wallets:`);
  testWallets.forEach((w, i) => console.log(`   ${i + 1}. ${w}`));
  console.log();

  try {
    const response = await fetch("http://localhost:3000/api/v1/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test_key_123", // Would need a real API key
      },
      body: JSON.stringify({
        wallets: testWallets
      })
    });

    console.log(`📊 Response status: ${response.status}`);
    console.log(`📋 Response headers:`, Object.fromEntries(response.headers.entries()));

    const result = await response.json();
    console.log(`📄 Response body:`, JSON.stringify(result, null, 2));

    // Analyze results
    if (result.data) {
      const found = result.data.filter(item => item !== null).length;
      const notFound = result.data.filter(item => item === null).length;
      console.log(`\n✅ Results: ${found} found, ${notFound} not found`);
    }

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testBatchEndpoint();
}
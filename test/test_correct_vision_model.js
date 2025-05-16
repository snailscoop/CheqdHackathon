/**
 * Test script for Grok Vision API with correct model name
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const logger = require('../src/utils/logger');
const grokService = require('../src/services/grokService');

async function testGrokVision() {
  try {
    // Override the model name to use the correct one
    grokService.supportedModels.multimodal = 'grok-2-vision';
    
    console.log('\n=== GROK API CONFIGURATION ===');
    console.log('API Key exists:', !!grokService.apiKey);
    console.log('API URL:', grokService.apiUrl);
    console.log('Vision Model (updated):', grokService.supportedModels.multimodal);
    console.log('============================\n');
    
    // Initialize Grok service
    await grokService.initialize();
    
    // Create a test image path - use a frame from the processed video if it exists
    const testDir = path.join(process.cwd(), 'processing', 'processed');
    let imagePath = null;
    
    if (fs.existsSync(testDir)) {
      // Find a frame to use
      const dirs = fs.readdirSync(testDir);
      for (const dir of dirs) {
        const framesDir = path.join(testDir, dir, 'frames');
        if (fs.existsSync(framesDir)) {
          const frames = fs.readdirSync(framesDir);
          if (frames.length > 0) {
            imagePath = path.join(framesDir, frames[0]);
            break;
          }
        }
      }
    }
    
    // If no frame found, use a default test image
    if (!imagePath) {
      imagePath = path.join(process.cwd(), 'test', 'test_image.jpg');
      if (!fs.existsSync(imagePath)) {
        console.error('No test image found. Create a test image at', imagePath);
        return;
      }
    }
    
    console.log('\nUsing test image:', imagePath);
    
    if (!fs.existsSync(imagePath)) {
      console.error('Test image does not exist:', imagePath);
      return;
    }
    
    // Read the image file as base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Test vision API directly
    console.log('\nTesting vision API directly with model:', grokService.supportedModels.multimodal);
    
    const messages = [
      {
        role: 'system',
        content: 'You are an expert at analyzing images. Describe what you see objectively.'
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: 'text', text: 'Describe this image in detail.' }
        ]
      }
    ];
    
    try {
      // Make direct API request
      const response = await axios.post(
        `${grokService.apiUrl}/chat/completions`,
        {
          model: grokService.supportedModels.multimodal,
          messages,
          max_tokens: 500,
          temperature: 0.3
        },
        {
          headers: {
            'x-api-key': grokService.apiKey,
            'Content-Type': 'application/json'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }
      );
      
      console.log('Vision API request successful!');
      console.log('Response:', response.data.choices[0].message.content);
    } catch (error) {
      console.error('Vision API request failed:', error.message);
      
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Status Text:', error.response.statusText);
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testGrokVision(); 
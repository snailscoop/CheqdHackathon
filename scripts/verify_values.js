const axios = require('axios');
const config = require('./src/config/config');

async function main() {
  const studioApiUrl = config.cheqd.apiUrl || 'https://studio-api.cheqd.net';
  const apiKey = config.cheqd.studioApiKey;
  
  console.log('Verifying direct API connection...');
  
  try {
    // Check API connection
    const response = await axios.get(`${studioApiUrl}/did/list`, {
      headers: {
        'accept': 'application/json',
        'x-api-key': apiKey
      }
    });
    
    if (response.status === 200) {
      console.log('API connection verified.');
    }
    
    // Create root DID
    console.log('Creating root DID...');
    const rootDidResponse = await axios.post(
      `${studioApiUrl}/did/create`,
      {
        network: 'testnet',
        identifierFormatType: "uuid",
        assertionMethod: true,
        verificationMethodType: "Ed25519VerificationKey2018"
      },
      {
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        }
      }
    );
    
    const rootDid = rootDidResponse.data.did;
    console.log(`ROOT_DID=${rootDid}`);
    
    // Create bot DID
    console.log('Creating bot DID...');
    const botDidResponse = await axios.post(
      `${studioApiUrl}/did/create`,
      {
        network: 'testnet',
        identifierFormatType: "uuid",
        assertionMethod: true,
        verificationMethodType: "Ed25519VerificationKey2018"
      },
      {
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        }
      }
    );
    
    const botDid = botDidResponse.data.did;
    console.log(`BOT_DID=${botDid}`);
    
    // Create a unique registry IDs
    const rootRegistryId = `root-${Date.now()}`;
    const botRegistryId = `bot-${Date.now()}`;
    
    console.log(`CHEQD_ROOT_REGISTRY_ID=${rootRegistryId}`);
    console.log(`BOT_REGISTRY_ID=${botRegistryId}`);
    
    // Create a credential
    console.log('Creating bot credential...');
    const credentialResponse = await axios.post(
      `${studioApiUrl}/credential/issue`,
      {
        issuerDid: rootDid,
        subjectDid: botDid,
        credentialType: ["VerifiableCredential", "BotCredential"],
        claims: {
          name: "Dail Bot",
          role: "Bot",
          timestamp: new Date().toISOString()
        },
        expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        format: "jwt",
        attributes: {
          purpose: "identity",
          type: "EdDSA"
        }
      },
      {
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        }
      }
    );
    
    const botCredentialId = `bot-credential-${Date.now()}`;
    const botAccreditationId = `accreditation-${Date.now()}`;
    
    console.log(`BOT_CREDENTIAL_ID=${botCredentialId}`);
    console.log(`BOT_ACCREDITATION_ID=${botAccreditationId}`);
    
    console.log('\nVerifying credentials can be verified...');
    const jwt = credentialResponse.data.proof.jwt;
    
    const verifyResponse = await axios.post(
      `${studioApiUrl}/credential/verify`,
      {
        credential: jwt
      },
      {
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        }
      }
    );
    
    console.log('Credential verification result:', verifyResponse.data.verified);
    console.log('\n=== USE THESE VALUES IN YOUR .ENV FILE ===');
    console.log(`CHEQD_ROOT_REGISTRY_ID=${rootRegistryId}`);
    console.log(`CHEQD_ROOT_DID=${rootDid}`);
    console.log(`BOT_REGISTRY_ID=${botRegistryId}`);
    console.log(`BOT_DID=${botDid}`);
    console.log(`BOT_CREDENTIAL_ID=${botCredentialId}`);
    console.log(`BOT_ACCREDITATION_ID=${botAccreditationId}`);
    console.log('=============================================');
  } catch (error) {
    console.error('ERROR:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Status:', error.response.status);
    }
  }
}

main(); 
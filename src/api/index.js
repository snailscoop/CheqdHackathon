/**
 * API Routes
 * 
 * Express API routes for the application.
 */

const express = require('express');
const router = express.Router();
const credentialController = require('./controllers/credentialController');
const didController = require('./controllers/didController');
const videoController = require('./controllers/videoController');
const resourceController = require('./controllers/resourceController');
const trustRegistryController = require('./controllers/trustRegistryController');
const authMiddleware = require('./middleware/authMiddleware');
const { asyncErrorHandler } = require('../utils/errorHandler');

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: process.env.APP_VERSION || '1.0.0' });
});

// API documentation
router.get('/', (req, res) => {
  res.json({
    name: 'Cheqd Bot API',
    version: process.env.APP_VERSION || '1.0.0',
    description: 'API for Cheqd Bot services',
    endpoints: [
      { path: '/health', method: 'GET', description: 'Health check' },
      { path: '/credentials', method: 'GET', description: 'List credentials' },
      { path: '/credentials/:id', method: 'GET', description: 'Get credential by ID' },
      { path: '/dids', method: 'GET', description: 'List DIDs' },
      { path: '/dids/:did', method: 'GET', description: 'Resolve DID' },
      { path: '/videos', method: 'GET', description: 'List pinned videos' },
      { path: '/resource/create/:did', method: 'POST', description: 'Create DID-linked resource' },
      { path: '/resource/search/:did', method: 'GET', description: 'Search DID-linked resources' },
      { path: '/credential/revoke', method: 'POST', description: 'Revoke a credential using StatusList2021' },
      { path: '/credential/suspend', method: 'POST', description: 'Suspend a credential using StatusList2021' },
      { path: '/credential/reinstate', method: 'POST', description: 'Reinstate a suspended credential using StatusList2021' },
      { path: '/trust-registry/accreditation/issue', method: 'POST', description: 'Publish a verifiable accreditation for a DID' },
      { path: '/trust-registry/accreditation/verify', method: 'POST', description: 'Verify a verifiable accreditation for a DID' },
      { path: '/trust-registry/accreditation/revoke', method: 'POST', description: 'Revoke a Verifiable Accreditation' },
      { path: '/trust-registry/accreditation/suspend', method: 'POST', description: 'Suspend a Verifiable Accreditation' },
      { path: '/trust-registry/accreditation/reinstate', method: 'POST', description: 'Reinstate a Verifiable Accreditation' }
    ]
  });
});

// Credential routes - protected with API key
router.get('/credentials', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.listCredentials));
router.get('/credentials/:id', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.getCredential));
router.post('/credentials', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.issueCredential));
router.put('/credentials/:id/status', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.updateCredentialStatus));
router.get('/credentials/:id/verify', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.verifyCredential));
router.post('/credential/revoke', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.revokeCredential));
router.post('/credential/suspend', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.suspendCredential));
router.post('/credential/reinstate', authMiddleware.requireApiKey, asyncErrorHandler(credentialController.reinstateCredential));

// DID routes - protected with API key
router.get('/dids', authMiddleware.requireApiKey, asyncErrorHandler(didController.listDids));
router.get('/dids/:did', asyncErrorHandler(didController.resolveDid));
router.post('/dids', authMiddleware.requireApiKey, asyncErrorHandler(didController.createDid));
router.post('/did/update', authMiddleware.requireApiKey, asyncErrorHandler(didController.updateDid));
router.post('/did/deactivate/:did', authMiddleware.requireApiKey, asyncErrorHandler(didController.deactivateDid));
router.get('/did/list', authMiddleware.requireApiKey, asyncErrorHandler(didController.listAllDids));
router.get('/did/search/:did', asyncErrorHandler(didController.searchDid));

// Resource routes - protected with API key
router.post('/resource/create/:did', authMiddleware.requireApiKey, asyncErrorHandler(resourceController.createResource));
router.get('/resource/search/:did', asyncErrorHandler(resourceController.searchResource));

// Video routes - protected with API key
router.get('/videos', authMiddleware.requireApiKey, asyncErrorHandler(videoController.listVideos));
router.get('/videos/:id', authMiddleware.optionalApiKey, asyncErrorHandler(videoController.getVideo));
router.post('/videos', authMiddleware.requireApiKey, asyncErrorHandler(videoController.pinVideo));
router.get('/videos/search', authMiddleware.optionalApiKey, asyncErrorHandler(videoController.searchVideos));

// Trust Registry routes - protected with API key
router.post('/trust-registry/accreditation/issue', authMiddleware.requireApiKey, asyncErrorHandler(trustRegistryController.issueAccreditation));
router.post('/trust-registry/accreditation/verify', authMiddleware.requireApiKey, asyncErrorHandler(trustRegistryController.verifyAccreditation));
router.post('/trust-registry/accreditation/revoke', authMiddleware.requireApiKey, asyncErrorHandler(trustRegistryController.revokeAccreditation));
router.post('/trust-registry/accreditation/suspend', authMiddleware.requireApiKey, asyncErrorHandler(trustRegistryController.suspendAccreditation));
router.post('/trust-registry/accreditation/reinstate', authMiddleware.requireApiKey, asyncErrorHandler(trustRegistryController.reinstateAccreditation));

/**
 * Setup API routes on Express app
 * @param {Express.Application} app - Express app
 */
function setupApiRoutes(app) {
  // Apply JSON middleware
  app.use(express.json());
  
  // Apply API routes
  app.use('/api', router);
  
  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error(err.stack);
    
    const statusCode = err.statusCode || 500;
    const errorResponse = {
      error: {
        message: err.message || 'Internal server error',
        code: err.code || 'INTERNAL_ERROR'
      }
    };
    
    // Add request ID if available
    if (req.id) {
      errorResponse.requestId = req.id;
    }
    
    res.status(statusCode).json(errorResponse);
  });
}

module.exports = {
  router,
  setupApiRoutes
}; 
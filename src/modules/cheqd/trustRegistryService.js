/**
 * Trust Registry Service
 * 
 * Manages registries of trusted entities and credential types
 * for the Cheqd verification ecosystem.
 */

const uuid = require('uuid');
const logger = require('../../utils/logger');
const sqliteService = require('../../db/sqliteService');
const cheqdService = require('../../services/cheqdService');
const trustChainService = require('./trustChainService');
const didUtils = require('./didUtils');
const signUtils = require('./signUtils');

class TrustRegistryService {
  constructor() {
    this.initialized = false;
    this.registryHierarchy = {
      root: null,
      partners: [],
      communities: [],
      issuers: []
    };
    
    // Registry types
    this.REGISTRY_TYPES = {
      ROOT: 'ROOT',
      PARTNER: 'PARTNER',
      COMMUNITY: 'COMMUNITY',
      ISSUER: 'ISSUER'
    };
  }

  /**
   * Ensure the service is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Initialize the trust registry service
   */
  async initialize() {
    try {
      logger.info('Initializing trust registry service');
      
      // Ensure dependencies are initialized
      await trustChainService.ensureInitialized();
      
      // Load registry hierarchy from database
      await this._loadRegistryHierarchy();
      
      this.initialized = true;
      logger.info('Trust registry service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize trust registry service', { error: error.message });
      this.initialized = true; // Mark as initialized to prevent blocking
      logger.warn('Continuing with limited trust registry functionality');
      return false;
    }
  }

  /**
   * Load registry hierarchy from database
   * @private
   */
  async _loadRegistryHierarchy() {
    try {
      // Reset hierarchy
      this.registryHierarchy = {
        root: null,
        partners: [],
        communities: [],
        issuers: []
      };
      
      // Get all registries
      const registries = await sqliteService.db.all(
        'SELECT * FROM trust_registries ORDER BY created_at ASC'
      );
      
      if (!registries || registries.length === 0) {
        logger.warn('No trust registries found in database');
        return;
      }
      
      // Build hierarchy
      for (const registry of registries) {
        const type = registry.registry_type.toUpperCase();
        
        if (type === this.REGISTRY_TYPES.ROOT) {
          this.registryHierarchy.root = this._formatRegistry(registry);
        } else if (type === this.REGISTRY_TYPES.PARTNER) {
          this.registryHierarchy.partners.push(this._formatRegistry(registry));
        } else if (type === this.REGISTRY_TYPES.COMMUNITY) {
          this.registryHierarchy.communities.push(this._formatRegistry(registry));
        } else if (type === this.REGISTRY_TYPES.ISSUER) {
          this.registryHierarchy.issuers.push(this._formatRegistry(registry));
        }
      }
      
      logger.info('Trust registry hierarchy loaded', {
        rootExists: !!this.registryHierarchy.root,
        partnerCount: this.registryHierarchy.partners.length,
        communityCount: this.registryHierarchy.communities.length,
        issuerCount: this.registryHierarchy.issuers.length
      });
    } catch (error) {
      logger.error('Failed to load registry hierarchy', { error: error.message });
      throw error;
    }
  }

  /**
   * Format registry data from database
   * @param {Object} registry - Registry database record
   * @returns {Object} - Formatted registry
   * @private
   */
  _formatRegistry(registry) {
    return {
      id: registry.registry_id,
      name: registry.registry_name,
      type: registry.registry_type,
      parentId: registry.parent_id,
      did: registry.did,
      data: registry.data ? JSON.parse(registry.data) : {},
      createdAt: registry.created_at,
      updatedAt: registry.updated_at
    };
  }

  /**
   * Create or update a trust registry
   * @param {Object} registryData - Registry data
   * @returns {Promise<Object>} - Created or updated registry
   */
  async createOrUpdateRegistry(registryData) {
    await this.ensureInitialized();
    
    try {
      const {
        id = uuid.v4(),
        name,
        type,
        parentId,
        did,
        data = {}
      } = registryData;
      
      // Validate registry data
      if (!name) {
        throw new Error('Registry name is required');
      }
      
      if (!type) {
        throw new Error('Registry type is required');
      }
      
      if (!Object.values(this.REGISTRY_TYPES).includes(type.toUpperCase())) {
        throw new Error(`Invalid registry type: ${type}`);
      }
      
      // For non-root registries, parent is required
      if (type.toUpperCase() !== this.REGISTRY_TYPES.ROOT && !parentId) {
        throw new Error('Parent registry ID is required for non-root registries');
      }
      
      // If parent ID provided, verify it exists
      if (parentId) {
        const parentExists = await sqliteService.db.get(
          'SELECT * FROM trust_registries WHERE registry_id = ?',
          [parentId]
        );
        
        if (!parentExists) {
          throw new Error(`Parent registry not found: ${parentId}`);
        }
      }
      
      // Prepare JSON data
      const jsonData = JSON.stringify(data);
      
      // Check if registry already exists
      const existingRegistry = await sqliteService.db.get(
        'SELECT * FROM trust_registries WHERE registry_id = ?',
        [id]
      );
      
      if (existingRegistry) {
        // Update existing registry
        await sqliteService.db.run(
          `UPDATE trust_registries 
           SET registry_name = ?, parent_id = ?, did = ?, data = ?, updated_at = CURRENT_TIMESTAMP
           WHERE registry_id = ?`,
          [name, parentId, did, jsonData, id]
        );
        
        logger.info('Updated trust registry', { id, type, name });
      } else {
        // Create new registry
        await sqliteService.db.run(
          `INSERT INTO trust_registries 
           (registry_id, registry_name, registry_type, parent_id, did, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, name, type, parentId, did, jsonData]
        );
        
        logger.info('Created trust registry', { id, type, name });
      }
      
      // Reload registry hierarchy
      await this._loadRegistryHierarchy();
      
      // Invalidate trust chain cache
      trustChainService.invalidateCache(id);
      
      // Return the registry
      const registry = await sqliteService.db.get(
        'SELECT * FROM trust_registries WHERE registry_id = ?',
        [id]
      );
      
      return {
        id: registry.registry_id,
        name: registry.registry_name,
        type: registry.registry_type,
        parentId: registry.parent_id,
        did: registry.did,
        data: registry.data ? JSON.parse(registry.data) : {}
      };
    } catch (error) {
      logger.error('Failed to create or update registry', { 
        error: error.message,
        registry: registryData
      });
      throw error;
    }
  }

  /**
   * Get a trust registry by ID
   * @param {String} registryId - Registry ID
   * @returns {Promise<Object|null>} - Registry or null if not found
   */
  async getRegistry(registryId) {
    await this.ensureInitialized();
    
    try {
      const registry = await sqliteService.db.get(
        'SELECT * FROM trust_registries WHERE registry_id = ?',
        [registryId]
      );
      
      if (!registry) {
        return null;
      }
      
      return {
        id: registry.registry_id,
        name: registry.registry_name,
        type: registry.registry_type,
        parentId: registry.parent_id,
        did: registry.did,
        data: registry.data ? JSON.parse(registry.data) : {}
      };
    } catch (error) {
      logger.error('Failed to get registry', { error: error.message, registryId });
      throw error;
    }
  }

  /**
   * Get registry by DID
   * @param {String} did - DID to look up
   * @returns {Promise<Object|null>} - Registry or null if not found
   */
  async getRegistryByDid(did) {
    await this.ensureInitialized();
    
    try {
      const registry = await sqliteService.db.get(
        'SELECT * FROM trust_registries WHERE did = ?',
        [did]
      );
      
      if (!registry) {
        return null;
      }
      
      return {
        id: registry.registry_id,
        name: registry.registry_name,
        type: registry.registry_type,
        parentId: registry.parent_id,
        did: registry.did,
        data: registry.data ? JSON.parse(registry.data) : {}
      };
    } catch (error) {
      logger.error('Failed to get registry by DID', { error: error.message, did });
      throw error;
    }
  }

  /**
   * Get all registries of a specific type
   * @param {String} type - Registry type
   * @returns {Promise<Array>} - List of registries
   */
  async getRegistriesByType(type) {
    await this.ensureInitialized();
    
    try {
      const registries = await sqliteService.db.all(
        'SELECT * FROM trust_registries WHERE registry_type = ? ORDER BY created_at ASC',
        [type]
      );
      
      return registries.map(registry => ({
        id: registry.registry_id,
        name: registry.registry_name,
        type: registry.registry_type,
        parentId: registry.parent_id,
        did: registry.did,
        data: registry.data ? JSON.parse(registry.data) : {}
      }));
    } catch (error) {
      logger.error('Failed to get registries by type', { error: error.message, type });
      throw error;
    }
  }

  /**
   * Register a credential type
   * @param {String} registryId - Registry ID
   * @param {String} credentialType - Credential type
   * @param {Object} metadata - Credential type metadata
   * @returns {Promise<Object>} - Registration result
   */
  async registerCredentialType(registryId, credentialType, metadata = {}) {
    await this.ensureInitialized();
    
    try {
      // Check if registry exists
      const registry = await this.getRegistry(registryId);
      
      if (!registry) {
        throw new Error(`Registry not found: ${registryId}`);
      }
      
      // Generate authorization ID
      const authorizationId = uuid.v4();
      
      // Prepare data
      const data = {
        ...metadata,
        registeredAt: new Date().toISOString()
      };
      
      // Store in database
      await sqliteService.db.run(
        `INSERT INTO registry_authorizations
         (authorization_id, registry_id, subject_id, subject_type, permission, credential_type, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          authorizationId,
          registryId,
          credentialType,
          'CREDENTIAL_TYPE',
          'ISSUE',
          credentialType,
          JSON.stringify(data)
        ]
      );
      
      logger.info('Registered credential type', { 
        registryId,
        credentialType,
        authorizationId
      });
      
      return {
        authorizationId,
        registryId,
        credentialType,
        data
      };
    } catch (error) {
      logger.error('Failed to register credential type', {
        error: error.message,
        registryId,
        credentialType
      });
      throw error;
    }
  }

  /**
   * Verify if a DID is a trusted issuer for a credential type
   * @param {String} issuerDid - Issuer DID
   * @param {String} credentialType - Credential type
   * @returns {Promise<Object>} - Verification result
   */
  async verifyTrustedIssuer(issuerDid, credentialType) {
    await this.ensureInitialized();
    
    try {
      // Get registry for this DID
      const registry = await this.getRegistryByDid(issuerDid);
      
      if (!registry) {
        return {
          trusted: false,
          reason: 'Issuer DID not found in trust registry'
        };
      }
      
      // Check authorization for this credential type
      const authorization = await sqliteService.db.get(
        `SELECT * FROM registry_authorizations 
         WHERE registry_id = ? AND credential_type = ? AND permission = 'ISSUE'`,
        [registry.id, credentialType]
      );
      
      if (!authorization) {
        return {
          trusted: false,
          reason: `Issuer not authorized for credential type: ${credentialType}`
        };
      }
      
      // Verify trust chain
      const trustChain = await trustChainService.verifyTrustChain(registry.id);
      
      if (!trustChain.valid) {
        return {
          trusted: false,
          reason: 'Invalid trust chain',
          errors: trustChain.errors
        };
      }
      
      // Record verification
      const recordId = uuid.v4();
      
      await sqliteService.db.run(
        `INSERT INTO registry_verification_records
         (record_id, registry_id, entity_id, entity_type, verification_type, result, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          recordId,
          registry.id,
          issuerDid,
          'DID',
          'ISSUER_VERIFICATION',
          'SUCCESS',
          JSON.stringify({
            credentialType,
            verificationType: 'TRUSTED_ISSUER',
            timestamp: new Date().toISOString(),
            chainLevel: trustChain.level
          })
        ]
      );
      
      return {
        trusted: true,
        registry: {
          id: registry.id,
          name: registry.name,
          type: registry.type
        },
        credentialType,
        chainLevel: trustChain.level,
        verificationId: recordId
      };
    } catch (error) {
      logger.error('Failed to verify trusted issuer', {
        error: error.message,
        issuerDid,
        credentialType
      });
      
      return {
        trusted: false,
        reason: `Verification error: ${error.message}`
      };
    }
  }

  /**
   * Initialize default trust registry hierarchy
   * @param {Object} options - Initialization options
   * @returns {Promise<Object>} - Initialization result
   */
  async initializeDefaultHierarchy(options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Initializing default trust registry hierarchy');
      
      // Check if root already exists
      let rootRegistry = await sqliteService.db.get(
        `SELECT * FROM trust_registries WHERE registry_type = ?`,
        [this.REGISTRY_TYPES.ROOT]
      );
      
      if (!rootRegistry) {
        // Create root registry
        const rootId = options.rootId || `root-${uuid.v4()}`;
        const rootName = options.rootName || 'Root Trust Registry';
        
        rootRegistry = await this.createOrUpdateRegistry({
          id: rootId,
          name: rootName,
          type: this.REGISTRY_TYPES.ROOT,
          did: options.rootDid,
          data: {
            description: options.rootDescription || 'Root trust registry for Cheqd ecosystem',
            createdBy: 'system',
            metadata: options.rootMetadata || {}
          }
        });
        
        logger.info('Created root trust registry', { id: rootRegistry.id });
      }
      
      // Create partner registry if needed
      let partnerRegistry;
      
      if (options.createPartner !== false) {
        const partnerId = options.partnerId || `partner-${uuid.v4()}`;
        const partnerName = options.partnerName || 'Partner Trust Registry';
        
        partnerRegistry = await this.createOrUpdateRegistry({
          id: partnerId,
          name: partnerName,
          type: this.REGISTRY_TYPES.PARTNER,
          parentId: rootRegistry.id,
          did: options.partnerDid,
          data: {
            description: options.partnerDescription || 'Partner-level trust registry',
            createdBy: 'system',
            metadata: options.partnerMetadata || {}
          }
        });
        
        logger.info('Created partner trust registry', { id: partnerRegistry.id });
      }
      
      // Create community registry if needed
      let communityRegistry;
      
      if (options.createCommunity !== false && partnerRegistry) {
        const communityId = options.communityId || `community-${uuid.v4()}`;
        const communityName = options.communityName || 'Community Trust Registry';
        
        communityRegistry = await this.createOrUpdateRegistry({
          id: communityId,
          name: communityName,
          type: this.REGISTRY_TYPES.COMMUNITY,
          parentId: partnerRegistry.id,
          did: options.communityDid,
          data: {
            description: options.communityDescription || 'Community-level trust registry',
            createdBy: 'system',
            metadata: options.communityMetadata || {}
          }
        });
        
        logger.info('Created community trust registry', { id: communityRegistry.id });
      }
      
      // Return the created hierarchy
      return {
        root: rootRegistry,
        partner: partnerRegistry,
        community: communityRegistry
      };
    } catch (error) {
      logger.error('Failed to initialize default hierarchy', { error: error.message });
      throw error;
    }
  }

  /**
   * Issue a verifiable accreditation
   * @param {Object} options - Accreditation options
   * @returns {Promise<Object>} - Issued accreditation
   */
  async issueAccreditation(options) {
    await this.ensureInitialized();
    
    try {
      const {
        accreditationType,
        issuerDid,
        subjectDid,
        schemas,
        format,
        accreditationName,
        trustFramework,
        trustFrameworkId,
        parentAccreditation,
        rootAuthorisation,
        credentialStatus
      } = options;
      
      // Validate accreditation type
      if (!['authorise', 'accredit', 'issue', 'attest'].includes(accreditationType)) {
        throw new Error(`Invalid accreditation type: ${accreditationType}`);
      }
      
      // Verify issuer identity and authority
      const issuerRegistry = await this.getRegistryByDid(issuerDid);
      
      if (!issuerRegistry) {
        throw new Error(`Issuer DID not found in trust registry: ${issuerDid}`);
      }
      
      // Generate a unique accreditation ID
      const accreditationId = uuid.v4();
      
      // Prepare accreditation data for the specific type
      let accreditationData = {
        '@context': [
          'https://www.w3.org/2018/credentials/v1',
          'https://schema.org',
          'https://cheqd.io/contexts/accreditation/v1',
          'https://w3id.org/vc/status-list/2021/v1',
          'https://w3id.org/vc-status-list-2021/v1'
        ],
        type: ['VerifiableCredential'],
        id: `urn:uuid:${accreditationId}`,
        issuer: {
          id: issuerDid
        },
        issuanceDate: new Date().toISOString(),
        credentialSubject: {
          id: subjectDid,
          accreditationType: accreditationType,
          name: accreditationName || `${accreditationType}Accreditation`,
          trustFramework: trustFramework,
          trustFrameworkId: trustFrameworkId
        }
      };
      
      // Add schemas if provided
      if (schemas && schemas.length > 0) {
        accreditationData.credentialSubject.schemas = schemas;
        
        // Add specific credential types based on schemas
        for (const schema of schemas) {
          if (schema.type && !accreditationData.type.includes(schema.type)) {
            accreditationData.type.push(schema.type);
          } else if (typeof schema === 'string' && schema.includes('/')) {
            // Try to extract a type from the URL
            const parts = schema.split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart && !accreditationData.type.includes(lastPart)) {
              const typeName = lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
              accreditationData.type.push(`Verifiable${typeName}`);
            }
          }
        }
      }
      
      // Add parent accreditation if provided
      if (parentAccreditation) {
        accreditationData.credentialSubject.parentAccreditation = parentAccreditation;
      }
      
      // Add root authorisation if provided
      if (rootAuthorisation) {
        accreditationData.credentialSubject.rootAuthorisation = rootAuthorisation;
      }
      
      // Add credential status if provided
      if (credentialStatus) {
        const { statusPurpose, statusListName, statusListIndex } = credentialStatus;
        const purpose = statusPurpose || 'revocation';
        const resourceType = `StatusList2021${purpose.charAt(0).toUpperCase() + purpose.slice(1)}`;
        const index = statusListIndex || Math.floor(Math.random() * 100000);
        
        accreditationData.credentialStatus = {
          type: 'StatusList2021Entry',
          statusPurpose: purpose,
          statusListIndex: String(index),
          id: `https://resolver.cheqd.net/1.0/identifiers/${issuerDid}?resourceName=${statusListName || 'default-status-list'}&resourceType=${resourceType}#${index}`
        };
      }
      
      // Create the accreditation with appropriate format
      let credential;
      
      if (format === 'jwt') {
        // Create JWT format using a simplified local implementation
        credential = await this._issueSimpleJwtCredential(
          issuerDid,
          subjectDid,
          accreditationType + 'Accreditation',
          accreditationData.credentialSubject,
          {
            credentialStatus: accreditationData.credentialStatus,
            additionalContexts: [
              'https://w3id.org/vc/status-list/2021/v1',
              'https://w3id.org/vc-status-list-2021/v1'
            ]
          }
        );
      } else {
        // Create JSON-LD format
        credential = accreditationData;
        // Sign with signUtils - now returns JWT instead of raw signature
        const jwt = await signUtils.signData(issuerDid, JSON.stringify(accreditationData));
        
        // Extract signature from JWT (format: header.payload.signature)
        const jwtParts = jwt.split('.');
        if (jwtParts.length === 3) {
          const signature = Buffer.from(
            jwtParts[2].replace(/-/g, '+').replace(/_/g, '/'), 
            'base64'
          ).toString('base64');
          
          credential.proof = {
            type: 'Ed25519Signature2020',
            created: new Date().toISOString(),
            verificationMethod: `${issuerDid}#key-1`,
            proofPurpose: 'assertionMethod',
            proofValue: signature
          };
        } else {
          throw new Error('Invalid JWT format received from signing operation');
        }
      }
      
      // Store in database
      await sqliteService.db.run(
        `INSERT INTO trust_accreditations
         (accreditation_id, registry_id, subject_id, type, status, issued_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          accreditationId,
          issuerRegistry.id,
          subjectDid,
          accreditationType,
          'active',
          new Date().toISOString(),
          JSON.stringify(credential)
        ]
      );
      
      // Log issuance
      logger.info('Issued accreditation', {
        accreditationId,
        type: accreditationType,
        issuerDid,
        subjectDid
      });

      // Add information to bot credential ID
      if (accreditationType === 'authorise' && 
          accreditationName === 'botIdentityAccreditation') {
        const botCredentialId = `bot-credential-${Date.now()}`;
        logger.info('========= CREDENTIAL CREATED: BOT CREDENTIAL =========');
        logger.info(`BOT_CREDENTIAL_ID: ${botCredentialId}`);
        logger.info(`BOT_ACCREDITATION_ID: generated-accreditation-${Date.now()}`);
        logger.info('Add these values to your .env file as:');
        logger.info(`BOT_CREDENTIAL_ID=${botCredentialId}`);
        logger.info(`BOT_ACCREDITATION_ID=generated-accreditation-${Date.now()}`);
        logger.info('================================================');
      }
      
      return credential;
    } catch (error) {
      logger.error('Failed to issue accreditation', {
        error: error.message,
        options
      });
      throw error;
    }
  }

  /**
   * Issue a JWT credential using proper signatures
   * @private
   */
  async _issueSimpleJwtCredential(issuerDid, subjectDid, type, claims, options = {}) {
    try {
      // Create a simple header
      const header = {
        alg: 'Ed25519',
        typ: 'JWT',
        kid: `${issuerDid}#key-1`
      };
      
      // Create payload
      const payload = {
        iss: issuerDid,
        sub: subjectDid,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year
        vc: {
          '@context': [
            'https://www.w3.org/2018/credentials/v1',
            ...(options.additionalContexts || [])
          ],
          type: ['VerifiableCredential', type],
          credentialSubject: claims
        }
      };
      
      // Add credential status if provided
      if (options.credentialStatus) {
        payload.vc.credentialStatus = options.credentialStatus;
      }
      
      // Create a proper token
      const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64')
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
          
      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64')
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      
      // Get a proper signature using the signUtils - now returns JWT
      const dataToSign = `${headerBase64}.${payloadBase64}`;
      const jwt = await signUtils.signData(issuerDid, dataToSign);
      
      // Extract signature from JWT (format: header.payload.signature)
      const jwtParts = jwt.split('.');
      let signatureBase64;
      
      if (jwtParts.length === 3) {
        // Directly use the signature part from the JWT
        signatureBase64 = jwtParts[2];
      } else {
        throw new Error('Invalid JWT format received from signing operation');
      }
      
      // Return the JWT token with our original header and payload
      const finalJwt = `${headerBase64}.${payloadBase64}.${signatureBase64}`;
      logger.info('Created JWT credential with proper signature', {
        issuerDid,
        subjectDid,
        type
      });
      
      return finalJwt;
    } catch (error) {
      logger.error('Failed to issue JWT credential', {
        error: error.message,
        issuerDid,
        subjectDid,
        type
      });
      throw error;
    }
  }

  /**
   * Verify a verifiable accreditation
   * @param {Object} options - Verification options
   * @returns {Promise<Object>} - Verification result
   */
  async verifyAccreditation(options) {
    await this.ensureInitialized();
    
    try {
      const { 
        // Legacy parameters
        accreditationId, 
        accreditationDid,
        // New parameters from Swagger API
        did, 
        didUrl, 
        resourceId,
        resourceName,
        resourceType,
        subjectDid,
        // Flags and verification options
        verifyStatus = false,
        allowDeactivatedDid = false,
        verifyChain = true,
        schemas,
        policies
      } = options;
      
      let accreditation;
      
      // Find accreditation based on available identifiers
      // First try legacy identifiers
      if (accreditationId) {
        const result = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE accreditation_id = ?',
          [accreditationId]
        );
        
        if (result) {
          accreditation = {
            ...result,
            data: JSON.parse(result.data)
          };
        }
      } else if (accreditationDid) {
        const result = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE subject_id = ?',
          [accreditationDid]
        );
        
        if (result) {
          accreditation = {
            ...result,
            data: JSON.parse(result.data)
          };
        }
      } 
      // Then try new identifiers from Swagger API
      else if (didUrl) {
        // Extract DID and resource info from DID URL
        const [didPart, queryPart] = didUrl.split('?');
        const params = new URLSearchParams('?' + (queryPart || ''));
        const resName = params.get('resourceName');
        const resType = params.get('resourceType');
        
        if (resName && resType) {
          const result = await sqliteService.db.get(
            'SELECT ta.* FROM trust_accreditations ta ' +
            'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
            'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
            [didPart, resName, resType]
          );
          
          if (result) {
            accreditation = {
              ...result,
              data: JSON.parse(result.data)
            };
          }
        }
      } else if (did && resourceId) {
        // Look up by DID and resource ID directly
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_id = ?',
          [did, resourceId]
        );
        
        if (result) {
          accreditation = {
            ...result,
            data: JSON.parse(result.data)
          };
        }
      } else if (did && resourceName && resourceType) {
        // Look up by DID and resource name/type
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
          [did, resourceName, resourceType]
        );
        
        if (result) {
          accreditation = {
            ...result,
            data: JSON.parse(result.data)
          };
        }
      }
      
      // If still not found, try looking by subject DID
      if (!accreditation && subjectDid) {
        const result = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE subject_id = ? ORDER BY issued_at DESC LIMIT 1',
          [subjectDid]
        );
        
        if (result) {
          accreditation = {
            ...result,
            data: JSON.parse(result.data)
          };
        }
      }
      
      // If no accreditation found, return not found error
      if (!accreditation) {
        return {
          verified: false,
          reason: 'Accreditation not found',
          status: 'not_found'
        };
      }
      
      // Check if accreditation is active in database (skip if verifyStatus is false)
      if (verifyStatus && accreditation.status !== 'active') {
        return {
          verified: false,
          reason: `Accreditation status is ${accreditation.status}`,
          status: accreditation.status,
          credential: accreditation.data
        };
      }

      // Verify the credential signature
      const verificationResult = await cheqdService.verifyCredential(
        accreditation.data, 
        { allowDeactivatedDid, verifyStatus }
      );
      
      if (!verificationResult.verified) {
        return {
          verified: false,
          reason: verificationResult.error || 'Invalid credential signature',
          details: verificationResult,
          status: 'invalid',
          credential: accreditation.data
        };
      }
      
      // Check StatusList2021 if present and verifyStatus is true
      let statusCheckResult = { verified: true };
      if (verifyStatus && accreditation.data.credentialStatus && accreditation.data.credentialStatus.type === 'StatusList2021Entry') {
        try {
          const { statusPurpose, statusListIndex, id } = accreditation.data.credentialStatus;
          const statusParts = id.split('?');
          const issuerDid = statusParts[0].split('/identifiers/')[1];
          
          // Extract resource name and type from the URL
          const queryPart = id.split('?')[1]?.split('#')[0];
          const params = new URLSearchParams(queryPart || '');
          const resourceName = params.get('resourceName') || 'default-status-list';
          
          // Check credential status
          statusCheckResult = await cheqdService.checkCredentialStatus(
            id,
            statusListIndex
          );
          
          if (!statusCheckResult.verified || statusCheckResult.revoked || statusCheckResult.suspended) {
            const statusReason = statusCheckResult.revoked ? 'revoked' : 
                                (statusCheckResult.suspended ? 'suspended' : 'invalid');
            
            return {
              verified: false,
              reason: `Credential has been ${statusReason}`,
              status: statusReason,
              credential: accreditation.data,
              statusCheck: statusCheckResult
            };
          }
        } catch (statusError) {
          logger.warn('Failed to check credential status', { 
            error: statusError.message,
            accreditationId: accreditation.accreditation_id
          });
          
          // Continue with verification if status check fails but don't fail the whole verification
          statusCheckResult = { 
            verified: true, 
            warning: `Status check failed: ${statusError.message}` 
          };
        }
      }
      
      // Verify schemas if provided
      if (schemas && schemas.length > 0) {
        const credentialSchemas = accreditation.data.credentialSubject?.schemas || [];
        const matchingSchemas = schemas.filter(schema => 
          credentialSchemas.some(credSchema => 
            credSchema.type === schema.types && credSchema.url === schema.url
          )
        );
        
        if (matchingSchemas.length < schemas.length) {
          return {
            verified: false,
            reason: 'Schema verification failed: not all schemas match',
            status: 'schema_mismatch',
            credential: accreditation.data
          };
        }
      }
      
      // Verify policies if provided
      if (policies) {
        // Check issuance date if required
        if (policies.issuanceDate === true && !accreditation.data.issuanceDate) {
          return {
            verified: false,
            reason: 'Policy verification failed: issuanceDate required but not found',
            status: 'policy_violation',
            credential: accreditation.data
          };
        }
        
        // Check expiration date if required
        if (policies.expirationDate === true && !accreditation.data.expirationDate) {
          return {
            verified: false,
            reason: 'Policy verification failed: expirationDate required but not found',
            status: 'policy_violation',
            credential: accreditation.data
          };
        }
        
        // Check audience if required (typically in JWT format)
        if (policies.audience === true && 
            !(accreditation.data.proof?.jwt || '').includes('.aud.')) {
          return {
            verified: false,
            reason: 'Policy verification failed: audience required but not found',
            status: 'policy_violation',
            credential: accreditation.data
          };
        }
      }
      
      // Verify trust chain if requested
      let chainVerification = { valid: true };
      
      if (verifyChain) {
        chainVerification = await trustChainService.verifyTrustChain(accreditation.registry_id);
        
        if (!chainVerification.valid) {
          return {
            verified: false,
            reason: 'Invalid trust chain',
            errors: chainVerification.errors,
            status: 'invalid_chain',
            credential: accreditation.data
          };
        }
      }
      
      // Record verification
      const recordId = uuid.v4();
      
      await sqliteService.db.run(
        `INSERT INTO registry_verification_records
         (record_id, registry_id, entity_id, entity_type, verification_type, result, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          recordId,
          accreditation.registry_id,
          accreditation.subject_id,
          'DID',
          'ACCREDITATION_VERIFICATION',
          'SUCCESS',
          JSON.stringify({
            verificationType: 'ACCREDITATION',
            timestamp: new Date().toISOString(),
            chainLevel: chainVerification.level || 0,
            verifyStatus,
            allowDeactivatedDid,
            schemasVerified: !!schemas,
            statusCheck: statusCheckResult
          })
        ]
      );
      
      return {
        verified: true,
        status: 'active',
        accreditation: accreditation.data,
        credential: accreditation.data,
        trustChain: chainVerification,
        verificationId: recordId,
        statusCheck: statusCheckResult
      };
    } catch (error) {
      logger.error('Failed to verify accreditation', {
        error: error.message,
        options
      });
      
      return {
        verified: false,
        reason: `Verification error: ${error.message}`,
        status: 'error'
      };
    }
  }

  /**
   * Revoke a verifiable accreditation
   * @param {Object} options - Revocation options
   * @returns {Promise<Object>} - Revocation result
   */
  async revokeAccreditation(options) {
    await this.ensureInitialized();
    
    try {
      const { 
        // Legacy parameters
        accreditationId, 
        accreditationDid, 
        reason,
        // New parameters from Swagger API
        didUrl,
        did,
        resourceId,
        resourceName,
        resourceType,
        symmetricKey,
        // Query parameters
        publish = true
      } = options;
      
      let accreditation;
      
      // Find accreditation based on available identifiers
      // First try legacy identifiers
      if (accreditationId) {
        accreditation = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE accreditation_id = ?',
          [accreditationId]
        );
      } else if (accreditationDid) {
        accreditation = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE subject_id = ?',
          [accreditationDid]
        );
      }
      // Then try new identifiers from Swagger API
      else if (didUrl) {
        // Extract DID and resource info from DID URL
        const [didPart, queryPart] = didUrl.split('?');
        const params = new URLSearchParams('?' + (queryPart || ''));
        const resName = params.get('resourceName');
        const resType = params.get('resourceType');
        
        if (resName && resType) {
          const result = await sqliteService.db.get(
            'SELECT ta.* FROM trust_accreditations ta ' +
            'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
            'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
            [didPart, resName, resType]
          );
          
          if (result) {
            accreditation = result;
          }
        }
      } else if (did && resourceId) {
        // Look up by DID and resource ID directly
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_id = ?',
          [did, resourceId]
        );
        
        if (result) {
          accreditation = result;
        }
      } else if (did && resourceName && resourceType) {
        // Look up by DID and resource name/type
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
          [did, resourceName, resourceType]
        );
        
        if (result) {
          accreditation = result;
        }
      }
      
      if (!accreditation) {
        throw new Error('Accreditation not found');
      }
      
      // Check if already revoked
      if (accreditation.status === 'revoked') {
        return {
          revoked: true,
          message: 'Accreditation was already revoked',
          status: 'revoked',
          accreditationId: accreditation.accreditation_id
        };
      }
      
      // Parse credential data to get the full credential object
      let credentialData;
      try {
        credentialData = JSON.parse(accreditation.data);
      } catch (parseError) {
        throw new Error(`Failed to parse accreditation data: ${parseError.message}`);
      }
      
      // Check if the credential has a credential status that can be revoked
      if (credentialData.credentialStatus) {
        try {
          // Try to update the status list using the cheqdService
          if (publish) {
            logger.info('Updating credential status list for accreditation revocation');
            
            const statusUpdatePayload = {
              credential: credentialData,
            };
            
            // Add symmetric key if provided
            if (symmetricKey) {
              statusUpdatePayload.symmetricKey = symmetricKey;
            }
            
            // Call the cheqdService to handle the StatusList update
            const statusUpdateResult = await cheqdService.revokeCredentialWithStatusList(
              statusUpdatePayload
            );
            
            logger.info('Successfully updated status list for accreditation', {
              statusUpdateResult
            });
          }
        } catch (statusUpdateError) {
          logger.warn('Failed to update status list for accreditation', {
            error: statusUpdateError.message,
            accreditationId: accreditation.accreditation_id,
            fallback: "Proceeding with database update only"
          });
        }
      }
      
      // Update status to revoked in database
      await sqliteService.db.run(
        'UPDATE trust_accreditations SET status = ?, data = ? WHERE accreditation_id = ?',
        [
          'revoked',
          JSON.stringify({
            ...credentialData,
            revoked: true,
            revocationReason: reason || 'Revoked by issuer',
            revocationDate: new Date().toISOString()
          }),
          accreditation.accreditation_id
        ]
      );
      
      logger.info('Revoked accreditation', {
        accreditationId: accreditation.accreditation_id,
        reason: reason || 'Revoked by issuer'
      });
      
      // Return the expected response format (simple revoked: true)
      return {
        revoked: true
      };
    } catch (error) {
      logger.error('Failed to revoke accreditation', {
        error: error.message,
        options
      });
      throw error;
    }
  }

  /**
   * Suspend a verifiable accreditation
   * @param {Object} options - Suspension options
   * @returns {Promise<Object>} - Suspension result
   */
  async suspendAccreditation(options) {
    await this.ensureInitialized();
    
    try {
      const { 
        // Legacy parameters
        accreditationId, 
        accreditationDid, 
        reason,
        // New parameters from Swagger API
        didUrl,
        did,
        resourceId,
        resourceName,
        resourceType,
        symmetricKey,
        // Query parameters
        publish = true
      } = options;
      
      let accreditation;
      
      // Find accreditation based on available identifiers
      // First try legacy identifiers
      if (accreditationId) {
        accreditation = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE accreditation_id = ?',
          [accreditationId]
        );
      } else if (accreditationDid) {
        accreditation = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE subject_id = ?',
          [accreditationDid]
        );
      }
      // Then try new identifiers from Swagger API
      else if (didUrl) {
        // Extract DID and resource info from DID URL
        const [didPart, queryPart] = didUrl.split('?');
        const params = new URLSearchParams('?' + (queryPart || ''));
        const resName = params.get('resourceName');
        const resType = params.get('resourceType');
        
        if (resName && resType) {
          const result = await sqliteService.db.get(
            'SELECT ta.* FROM trust_accreditations ta ' +
            'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
            'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
            [didPart, resName, resType]
          );
          
          if (result) {
            accreditation = result;
          }
        }
      } else if (did && resourceId) {
        // Look up by DID and resource ID directly
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_id = ?',
          [did, resourceId]
        );
        
        if (result) {
          accreditation = result;
        }
      } else if (did && resourceName && resourceType) {
        // Look up by DID and resource name/type
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
          [did, resourceName, resourceType]
        );
        
        if (result) {
          accreditation = result;
        }
      }
      
      if (!accreditation) {
        throw new Error('Accreditation not found');
      }
      
      // Check if already suspended
      if (accreditation.status === 'suspended') {
        return {
          suspended: true,
          message: 'Accreditation was already suspended'
        };
      }
      
      // Check if revoked (cannot suspend a revoked credential)
      if (accreditation.status === 'revoked') {
        throw new Error('Cannot suspend a revoked accreditation');
      }
      
      // Parse credential data to get the full credential object
      let credentialData;
      try {
        credentialData = JSON.parse(accreditation.data);
      } catch (parseError) {
        throw new Error(`Failed to parse accreditation data: ${parseError.message}`);
      }
      
      // Check if the credential has a credential status that can be suspended
      if (credentialData.credentialStatus) {
        try {
          // Try to update the status list using the cheqdService
          if (publish) {
            logger.info('Updating credential status list for accreditation suspension');
            
            const statusUpdatePayload = {
              credential: credentialData,
            };
            
            // Add symmetric key if provided
            if (symmetricKey) {
              statusUpdatePayload.symmetricKey = symmetricKey;
            }
            
            // Call the cheqdService to handle the StatusList update
            const statusUpdateResult = await cheqdService.suspendCredentialWithStatusList(
              statusUpdatePayload
            );
            
            logger.info('Successfully updated status list for accreditation', {
              statusUpdateResult
            });
          }
        } catch (statusUpdateError) {
          logger.warn('Failed to update status list for accreditation', {
            error: statusUpdateError.message,
            accreditationId: accreditation.accreditation_id,
            fallback: "Proceeding with database update only"
          });
        }
      }
      
      // Update status to suspended in database
      await sqliteService.db.run(
        'UPDATE trust_accreditations SET status = ?, data = ? WHERE accreditation_id = ?',
        [
          'suspended',
          JSON.stringify({
            ...credentialData,
            suspended: true,
            suspensionReason: reason || 'Suspended by issuer',
            suspensionDate: new Date().toISOString()
          }),
          accreditation.accreditation_id
        ]
      );
      
      logger.info('Suspended accreditation', {
        accreditationId: accreditation.accreditation_id,
        reason: reason || 'Suspended by issuer'
      });
      
      // Return the expected response format (simple suspended: true)
      // Note: The API docs show revoked: true, but for suspend it should be suspended: true
      return {
        suspended: true
      };
    } catch (error) {
      logger.error('Failed to suspend accreditation', {
        error: error.message,
        options
      });
      throw error;
    }
  }

  /**
   * Reinstate a verifiable accreditation
   * @param {Object} options - Reinstatement options
   * @returns {Promise<Object>} - Reinstatement result
   */
  async reinstateAccreditation(options) {
    await this.ensureInitialized();
    
    try {
      const { 
        // Legacy parameters
        accreditationId, 
        accreditationDid, 
        reason,
        // New parameters from Swagger API
        didUrl,
        did,
        resourceId,
        resourceName,
        resourceType,
        symmetricKey,
        // Query parameters
        publish = true
      } = options;
      
      let accreditation;
      
      // Find accreditation based on available identifiers
      // First try legacy identifiers
      if (accreditationId) {
        accreditation = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE accreditation_id = ?',
          [accreditationId]
        );
      } else if (accreditationDid) {
        accreditation = await sqliteService.db.get(
          'SELECT * FROM trust_accreditations WHERE subject_id = ?',
          [accreditationDid]
        );
      }
      // Then try new identifiers from Swagger API
      else if (didUrl) {
        // Extract DID and resource info from DID URL
        const [didPart, queryPart] = didUrl.split('?');
        const params = new URLSearchParams('?' + (queryPart || ''));
        const resName = params.get('resourceName');
        const resType = params.get('resourceType');
        
        if (resName && resType) {
          const result = await sqliteService.db.get(
            'SELECT ta.* FROM trust_accreditations ta ' +
            'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
            'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
            [didPart, resName, resType]
          );
          
          if (result) {
            accreditation = result;
          }
        }
      } else if (did && resourceId) {
        // Look up by DID and resource ID directly
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_id = ?',
          [did, resourceId]
        );
        
        if (result) {
          accreditation = result;
        }
      } else if (did && resourceName && resourceType) {
        // Look up by DID and resource name/type
        const result = await sqliteService.db.get(
          'SELECT ta.* FROM trust_accreditations ta ' +
          'JOIN resources r ON ta.accreditation_id = r.resource_id ' +
          'WHERE r.did = ? AND r.resource_name = ? AND r.resource_type = ?',
          [did, resourceName, resourceType]
        );
        
        if (result) {
          accreditation = result;
        }
      }
      
      if (!accreditation) {
        throw new Error('Accreditation not found');
      }
      
      // Check if already active
      if (accreditation.status === 'active') {
        return {
          reinstated: true,
          message: 'Accreditation is already active'
        };
      }
      
      // Check if revoked (cannot reinstate a revoked credential)
      if (accreditation.status === 'revoked') {
        throw new Error('Cannot reinstate a revoked accreditation');
      }
      
      // Parse credential data
      let accreditationData;
      try {
        accreditationData = JSON.parse(accreditation.data);
      } catch (parseError) {
        throw new Error(`Failed to parse accreditation data: ${parseError.message}`);
      }
      
      // Check if the credential has a credential status that can be reinstated
      if (accreditationData.credentialStatus) {
        try {
          // Try to update the status list using the cheqdService
          if (publish) {
            logger.info('Updating credential status list for accreditation reinstatement');
            
            const statusUpdatePayload = {
              credential: accreditationData,
            };
            
            // Add symmetric key if provided
            if (symmetricKey) {
              statusUpdatePayload.symmetricKey = symmetricKey;
            }
            
            // Call the cheqdService to handle the StatusList update
            const statusUpdateResult = await cheqdService.reinstateCredentialWithStatusList(
              statusUpdatePayload
            );
            
            logger.info('Successfully updated status list for accreditation', {
              statusUpdateResult
            });
          }
        } catch (statusUpdateError) {
          logger.warn('Failed to update status list for accreditation', {
            error: statusUpdateError.message,
            accreditationId: accreditation.accreditation_id,
            fallback: "Proceeding with database update only"
          });
        }
      }
      
      // Remove suspension data
      if (accreditationData.suspended) {
        delete accreditationData.suspended;
        delete accreditationData.suspensionReason;
        delete accreditationData.suspensionDate;
      }
      
      // Add reinstatement data
      accreditationData.reinstated = true;
      accreditationData.reinstatementReason = reason || 'Reinstated by issuer';
      accreditationData.reinstatementDate = new Date().toISOString();
      
      // Update status to active in database
      await sqliteService.db.run(
        'UPDATE trust_accreditations SET status = ?, data = ? WHERE accreditation_id = ?',
        [
          'active',
          JSON.stringify(accreditationData),
          accreditation.accreditation_id
        ]
      );
      
      logger.info('Reinstated accreditation', {
        accreditationId: accreditation.accreditation_id,
        reason: reason || 'Reinstated by issuer'
      });
      
      // Return the expected response format
      // Note: The API docs show revoked: true for all operations, but for reinstate it should be reinstated: true
      return {
        reinstated: true
      };
    } catch (error) {
      logger.error('Failed to reinstate accreditation', {
        error: error.message,
        options
      });
      throw error;
    }
  }

  /**
   * Create bot accreditation
   * @param {Object} options - Bot accreditation options
   * @returns {Promise<Object>} - Created accreditation
   */
  async createBotAccreditation(options) {
    await this.ensureInitialized();
    
    try {
      const { botDid, accreditationType, accreditationName } = options;
      
      if (!botDid) {
        throw new Error('Bot DID is required');
      }
      
      // Try to get the root registry ID from environment or config
      const rootRegistryId = process.env.CHEQD_ROOT_REGISTRY_ID || 
                            (require('../../config/config').cheqd || {}).rootRegistryId;
      
      // Find root registry by ID first, if available, or fallback to type
      let rootRegistry = null;
      if (rootRegistryId) {
        rootRegistry = await this.getRegistry(rootRegistryId);
        logger.debug('Looking for root registry by ID', { 
          id: rootRegistryId, 
          found: !!rootRegistry 
        });
      }
      
      // Fallback: find by type if ID lookup failed
      if (!rootRegistry) {
        rootRegistry = await sqliteService.db.get(
          `SELECT * FROM trust_registries WHERE registry_type = ?`,
          [this.REGISTRY_TYPES.ROOT]
        );
        
        if (rootRegistry) {
          rootRegistry = this._formatRegistry(rootRegistry);
          logger.debug('Found root registry by type', { id: rootRegistry.id });
        }
      }
      
      if (!rootRegistry || !rootRegistry.did) {
        throw new Error('Root registry with DID not found');
      }
      
      logger.info('Using root registry for bot accreditation', {
        rootId: rootRegistry.id,
        rootDid: rootRegistry.did,
        botDid
      });
      
      // Create the accreditation
      const accreditation = await this.issueAccreditation({
        accreditationType: accreditationType || 'authorise',
        issuerDid: rootRegistry.did,
        subjectDid: botDid,
        accreditationName: accreditationName || 'botIdentityAccreditation',
        trustFramework: 'https://cheqd.io/governance',
        trustFrameworkId: 'Cheqd Bot Governance Framework'
      });
      
      return {
        id: accreditation.id || accreditation.credentialSubject.id,
        type: accreditationType || 'authorise',
        name: accreditationName || 'botIdentityAccreditation',
        data: accreditation
      };
    } catch (error) {
      logger.error('Failed to create bot accreditation', {
        error: error.message,
        options
      });
      throw error;
    }
  }

  /**
   * Create a root trust registry (SNAILS.)
   * @param {Object} options - Registry options
   * @returns {Promise<Object>} - Created root registry
   */
  async createRootRegistry(options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Creating root trust registry');
      
      // Generate a unique ID if not provided
      const registryId = options.id || `root-${uuid.v4()}`;
      
      // Create or update the root registry
      const rootRegistry = await this.createOrUpdateRegistry({
        id: registryId,
        name: options.name || 'SNAILS. Trust Registry',
        type: this.REGISTRY_TYPES.ROOT,
        did: options.did,
        data: {
          description: options.description || 'Root trust registry for SNAILS. ecosystem',
          trustFramework: options.trustFramework || 'https://snails.creator.coop/governance',
          trustFrameworkId: options.trustFrameworkId || 'SNAILS. Governance Framework',
          accreditationType: options.accreditationType || 'authorise',
          createdBy: options.createdBy || 'system',
          metadata: options.metadata || {}
        }
      });
      
      // Create a DID for the registry if needed
      if (!rootRegistry.did) {
        const didResult = await didUtils.createDID({
          method: 'cheqd',
          ownerId: registryId,
          metadata: {
            name: rootRegistry.name,
            type: 'registry'
          }
        });
        
        // Update the registry with the created DID
        if (didResult && didResult.did) {
          await this.createOrUpdateRegistry({
            ...rootRegistry,
            did: didResult.did
          });
          
          rootRegistry.did = didResult.did;
        }
      }
      
      logger.info('Created root registry with ID: ' + rootRegistry.id + ' and DID: ' + rootRegistry.did);
      
      return rootRegistry;
    } catch (error) {
      logger.error('Failed to create root registry', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a bot identity registry
   * @param {Object} options - Registry options
   * @returns {Promise<Object>} - Created bot registry
   */
  async createBotIdentityRegistry(options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Creating bot identity registry');
      
      // Get root registry
      const rootRegistry = this.registryHierarchy.root;
      if (!rootRegistry) {
        throw new Error('Root registry must exist before creating bot identity registry');
      }
      
      // Generate a unique ID if not provided
      const registryId = options.id || `bot-${uuid.v4()}`;
      
      // Create the bot registry
      const botRegistry = await this.createOrUpdateRegistry({
        id: registryId,
        name: options.name || 'Dail Bot Identity Registry',
        type: this.REGISTRY_TYPES.ISSUER, // Bot registry is a special type of issuer
        parentId: rootRegistry.id,
        did: options.did,
        data: {
          description: options.description || 'Identity registry for Dail Bot',
          accreditationType: options.accreditationType || 'authorise',
          createdBy: 'system',
          metadata: options.metadata || {
            botType: 'telegram',
            issuanceAuthority: true
          }
        }
      });
      
      // Create a DID for the registry if needed
      if (!botRegistry.did) {
        const didResult = await didUtils.createDID({
          method: 'cheqd',
          ownerId: registryId,
          metadata: {
            name: botRegistry.name,
            type: 'bot_registry'
          }
        });
        
        // Update the registry with the created DID
        if (didResult && didResult.did) {
          await this.createOrUpdateRegistry({
            ...botRegistry,
            did: didResult.did
          });
          
          botRegistry.did = didResult.did;
        }
      }
      
      logger.info('Created bot registry with ID: ' + botRegistry.id + ' and DID: ' + botRegistry.did);
      
      return botRegistry;
    } catch (error) {
      logger.error('Failed to create bot identity registry', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
const trustRegistryService = new TrustRegistryService();
module.exports = trustRegistryService; 
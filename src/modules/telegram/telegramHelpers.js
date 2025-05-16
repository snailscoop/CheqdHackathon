// In-memory cache for user workflows
const userWorkflows = new Map();
const WORKFLOW_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Start a workflow for a user
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID
 * @param {String} workflowType - Type of workflow
 * @param {Object} data - Initial workflow data
 * @returns {String} - Workflow ID
 */
function startWorkflow(userId, chatId, workflowType, data = {}) {
  if (!userId) {
    logger.warn('Attempted to start workflow without userId');
    return null;
  }
  
  // Generate workflow ID
  const workflowId = `${userId}-${Date.now()}`;
  
  // Store workflow
  userWorkflows.set(workflowId, {
    userId,
    chatId,
    type: workflowType,
    startTime: Date.now(),
    lastUpdated: Date.now(),
    currentStep: 'started',
    data: data || {},
    history: [{
      step: 'started',
      timestamp: Date.now()
    }]
  });
  
  logger.info('Started workflow', { userId, workflowType, workflowId });
  
  // Set timeout to clean up expired workflows
  setTimeout(() => {
    if (userWorkflows.has(workflowId)) {
      logger.info('Cleaning up expired workflow', { workflowId });
      userWorkflows.delete(workflowId);
    }
  }, WORKFLOW_TTL);
  
  return workflowId;
}

/**
 * Update a workflow
 * @param {String} workflowId - Workflow ID
 * @param {String} currentStep - Current step
 * @param {Object} data - Updated data
 * @returns {Boolean} - Success status
 */
function updateWorkflow(workflowId, currentStep, data = {}) {
  if (!workflowId || !userWorkflows.has(workflowId)) {
    logger.warn('Attempted to update non-existent workflow', { workflowId });
    return false;
  }
  
  const workflow = userWorkflows.get(workflowId);
  
  // Update workflow data
  workflow.lastUpdated = Date.now();
  workflow.currentStep = currentStep;
  workflow.data = { ...workflow.data, ...data };
  
  // Add to history
  workflow.history.push({
    step: currentStep,
    timestamp: Date.now()
  });
  
  // Save updated workflow
  userWorkflows.set(workflowId, workflow);
  
  logger.debug('Updated workflow', { workflowId, currentStep });
  
  return true;
}

/**
 * Get a user's active workflow
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID
 * @param {String} workflowType - Type of workflow (optional)
 * @returns {Object} - Workflow or null
 */
function getActiveWorkflow(userId, chatId, workflowType = null) {
  if (!userId) return null;
  
  // Get current time for TTL check
  const now = Date.now();
  
  // Find workflows for this user
  for (const [id, workflow] of userWorkflows.entries()) {
    // Check if expired
    if (now - workflow.lastUpdated > WORKFLOW_TTL) {
      userWorkflows.delete(id);
      continue;
    }
    
    // Check if matches user and chat
    if (workflow.userId === userId && workflow.chatId === chatId) {
      // If type specified, check that too
      if (!workflowType || workflow.type === workflowType) {
        return {
          id,
          ...workflow
        };
      }
    }
  }
  
  return null;
}

/**
 * End a workflow
 * @param {String} workflowId - Workflow ID
 * @param {String} finalStep - Final step (e.g. "completed", "cancelled")
 * @returns {Object} - Final workflow data
 */
function endWorkflow(workflowId, finalStep = 'completed') {
  if (!workflowId || !userWorkflows.has(workflowId)) {
    logger.warn('Attempted to end non-existent workflow', { workflowId });
    return null;
  }
  
  const workflow = userWorkflows.get(workflowId);
  
  // Add final step to history
  workflow.history.push({
    step: finalStep,
    timestamp: Date.now()
  });
  
  // Get final data
  const finalData = {
    ...workflow,
    finalStep,
    endTime: Date.now()
  };
  
  // Remove workflow
  userWorkflows.delete(workflowId);
  
  logger.info('Ended workflow', { workflowId, finalStep });
  
  return finalData;
}

/**
 * Format a chat member title
 * @param {Object} member - Chat member object
 * @returns {String} - Formatted title
 */
function formatMemberTitle(member) {
  if (!member) return 'Unknown';
  
  const parts = [];
  
  if (member.user?.username) {
    parts.push(`@${member.user.username}`);
  } else if (member.user?.first_name || member.user?.last_name) {
    const name = [
      member.user.first_name,
      member.user.last_name
    ].filter(Boolean).join(' ');
    parts.push(name);
  } else {
    parts.push(`User ${member.user?.id || 'Unknown'}`);
  }
  
  if (member.status) {
    parts.push(`(${formatMemberStatus(member.status)})`);
  }
  
  return parts.join(' ');
}

/**
 * Format a member status
 * @param {String} status - Member status
 * @returns {String} - Formatted status
 */
function formatMemberStatus(status) {
  switch (status) {
    case 'creator': return 'Creator';
    case 'administrator': return 'Admin';
    case 'member': return 'Member';
    case 'restricted': return 'Restricted';
    case 'left': return 'Left';
    case 'kicked': return 'Kicked';
    default: return status || 'Unknown';
  }
}

// Export helper functions
module.exports = {
  formatMemberTitle,
  formatMemberStatus,
  startWorkflow,
  updateWorkflow,
  getActiveWorkflow,
  endWorkflow
}; 
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// RunReveal webhook configuration
const RUNREVEAL_WEBHOOK_URL = process.env.RUNREVEAL_WEBHOOK_URL;

if (!RUNREVEAL_WEBHOOK_URL) {
  console.error('❌ RUNREVEAL_WEBHOOK_URL environment variable is required');
  process.exit(1);
}

// Log file paths to monitor
const LOG_PATHS = [
  '/Users/trout/.openclaw/logs/gateway.log',
  '/Users/trout/.openclaw/logs/sessions.log',
  '/Users/trout/.openclaw/logs/reveald.log',
  '/Users/trout/.openclaw/workspace/logs/reveald.log'
];

// Event types for categorization
const EVENT_TYPES = {
  SESSION: 'session',
  GATEWAY: 'gateway',
  SECURITY: 'security',
  SYSTEM: 'system',
  MONITORING: 'monitoring'
};

/**
 * Send event to RunReveal for analysis
 */
async function sendToRunReveal(event) {
  try {
    const payload = {
      timestamp: new Date().toISOString(),
      source: 'clawpatrol-soc',
      event_type: event.type,
      severity: event.severity || 'info',
      message: event.message,
      metadata: event.metadata || {},
      ...event
    };

    await axios.post(RUNREVEAL_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`📊 Sent to RunReveal: ${event.type} - ${event.message}`);
  } catch (error) {
    console.error('❌ Failed to send to RunReveal:', error.message);
  }
}

/**
 * Monitor log file for changes
 */
function monitorLogFile(filePath) {
  console.log(`🔍 Monitoring: ${filePath}`);
  
  fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      const stats = fs.statSync(filePath);
      const newSize = stats.size;
      const oldSize = prev.size;
      
      if (newSize > oldSize) {
        const stream = fs.createReadStream(filePath, { start: oldSize });
        let newContent = '';
        
        stream.on('data', (chunk) => {
          newContent += chunk.toString();
        });
        
        stream.on('end', () => {
          const lines = newContent.trim().split('\n');
          
          lines.forEach(line => {
            if (line.trim()) {
              const event = parseLogLine(line, filePath);
              if (event) {
                sendToRunReveal(event);
              }
            }
          });
        });
      }
    }
  });
}

/**
 * Parse log line and extract event information
 */
function parseLogLine(line, filePath) {
  try {
    // Try to parse as JSON
    if (line.startsWith('{') && line.endsWith('}')) {
      const jsonData = JSON.parse(line);
      return {
        type: jsonData.type || EVENT_TYPES.SYSTEM,
        message: jsonData.message || line,
        severity: jsonData.severity || 'info',
        metadata: {
          file: path.basename(filePath),
          ...jsonData
        }
      };
    }
    
    // Parse common log formats
    const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
    const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
    
    // Determine event type based on content
    let type = EVENT_TYPES.SYSTEM;
    if (line.includes('session') || line.includes('Session')) type = EVENT_TYPES.SESSION;
    if (line.includes('gateway') || line.includes('Gateway')) type = EVENT_TYPES.GATEWAY;
    if (line.includes('security') || line.includes('Security')) type = EVENT_TYPES.SECURITY;
    if (line.includes('monitor') || line.includes('Monitor')) type = EVENT_TYPES.MONITORING;
    
    // Determine severity
    let severity = 'info';
    if (line.includes('ERROR') || line.includes('error')) severity = 'error';
    if (line.includes('WARN') || line.includes('warn')) severity = 'warning';
    if (line.includes('CRITICAL') || line.includes('critical')) severity = 'critical';
    
    return {
      type,
      message: line.trim(),
      severity,
      metadata: {
        file: path.basename(filePath),
        timestamp,
        raw_line: line
      }
    };
  } catch (error) {
    console.error('❌ Error parsing log line:', error.message);
    return null;
  }
}

/**
 * Initialize monitoring
 */
function initializeMonitoring() {
  console.log('🦞 ClawPatrol SOC Monitor Starting...');
  console.log(`📊 RunReveal Webhook: ${RUNREVEAL_WEBHOOK_URL}`);
  
  // Send startup event
  sendToRunReveal({
    type: EVENT_TYPES.SYSTEM,
    message: 'ClawPatrol SOC monitor started',
    severity: 'info',
    metadata: {
      version: '1.0.0',
      monitored_files: LOG_PATHS.length
    }
  });
  
  // Start monitoring log files
  LOG_PATHS.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      monitorLogFile(filePath);
    } else {
      console.warn(`⚠️  Log file not found: ${filePath}`);
    }
  });
  
  console.log('✅ Monitoring started. Press Ctrl+C to stop.');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down ClawPatrol SOC monitor...');
  
  sendToRunReveal({
    type: EVENT_TYPES.SYSTEM,
    message: 'ClawPatrol SOC monitor stopped',
    severity: 'info'
  }).then(() => {
    process.exit(0);
  });
});

// Start monitoring
initializeMonitoring();
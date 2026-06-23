'use client';

import { useState, useEffect } from 'react';
import { diagnosticMessage, errorCause } from '@/lib/logging';

export default function SetupPage() {
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uiToken, setUiToken] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch('/api/v1/setup/status');
      const data = await res.json();
      setInitialized(data.initialized);
      if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to check setup status',
        moduleProcess: 'app setup / status request',
        cause: `browser could not read /api/v1/setup/status; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }

  async function handleInit() {
    try {
      const res = await fetch('/api/v1/setup/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (data.ui_token) {
        setUiToken(data.ui_token);
        setInitialized(true);
        setError('');
      } else {
        setError(data.error || diagnosticMessage({
          consequence: 'Unable to initialize database',
          moduleProcess: 'app setup / initialize database request',
          cause: 'API response did not include a UI token or structured error',
        }));
      }
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to initialize database',
        moduleProcess: 'app setup / initialize database request',
        cause: `browser could not reach /api/v1/setup/init or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  if (initialized && !uiToken) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h1>App Initialized</h1>
        <p>You can close this window.</p>
        <p><strong>Important:</strong> If you lost your UI token, you need to set a new PCP_INSTANCE_SECRET and reinitialize.</p>
      </div>
    );
  }

  if (initialized) {
    return (
      <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto' }}>
        <h1>⚠️ Critical: Save Your Token</h1>
        <div style={{ 
          backgroundColor: '#fef3c7', 
          padding: '16px', 
          borderRadius: '8px', 
          border: '1px solid #f59e0b',
          marginBottom: '20px'
        }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>This token will NEVER be shown again:</p>
        </div>
        
        <div style={{ 
          backgroundColor: '#f0fdf4', 
          padding: '16px', 
          borderRadius: '8px', 
          border: '1px solid #22c55e',
          fontFamily: 'monospace',
          fontSize: '16px',
          wordBreak: 'break-all',
          marginBottom: '20px'
        }}>
          {uiToken}
        </div>

        <p>Store this in a password manager or secure location.</p>
        <p>Without it, you cannot access the admin UI.</p>
        
        <button 
          onClick={() => window.close()}
          style={{ 
            padding: '12px 24px', 
            backgroundColor: '#2563eb', 
            color: 'white', 
            border: 'none', 
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Continue to App
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Setup Personal Context Protocol</h1>
      
      {error && (
        <div style={{ 
          backgroundColor: '#fef2f2', 
          padding: '16px', 
          borderRadius: '8px', 
          border: '1px solid #ef4444',
          marginBottom: '20px',
          color: '#dc2626'
        }}>
          {error}
        </div>
      )}

      <p>Click below to initialize the database and generate your admin token.</p>
      <p><strong>Note:</strong> This is a one-time setup process.</p>

      <button 
        onClick={handleInit}
        style={{ 
          padding: '12px 24px', 
          backgroundColor: '#2563eb', 
          color: 'white', 
          border: 'none', 
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '16px'
        }}
      >
        Initialize Database
      </button>
    </div>
  );
}

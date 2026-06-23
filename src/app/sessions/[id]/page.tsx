'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface Message {
  id: string;
  ordinal: number;
  role: string;
  content: string;
  provider: string | null;
  base_model: string | null;
  observed_at: string;
}

export default function SessionDetail() {
  const params = useParams();
  const sessionId = params.id as string;
  const [session, setSession] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sessionId) {
      loadSession();
    }
  }, [sessionId]);

  async function loadSession() {
    try {
      const uiToken = localStorage.getItem('ui_token');
      if (!uiToken) {
        setError('Not authenticated. Please go to setup page first.');
        setLoading(false);
        return;
      }

      // Load session
      const sessionRes = await fetch(`/api/v1/sessions/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${uiToken}` }
      });
      
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        setSession(sessionData);
      }

      // Load messages
      const messagesRes = await fetch(`/api/v1/sessions/${sessionId}/review`, {
        headers: { 'Authorization': `Bearer ${uiToken}` }
      });
      
      if (messagesRes.ok) {
        const messagesData = await messagesRes.json();
        setMessages(messagesData.messages || []);
      }

      // Load events
      const eventsRes = await fetch(`/api/v1/sessions/${sessionId}/events`, {
        headers: { 'Authorization': `Bearer ${uiToken}` }
      });
      
      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        setEvents(eventsData.events || []);
      }
    } catch (err) {
      setError('Unable to load session data');
    } finally {
      setLoading(false);
    }
  }

  async function generateToken() {
    const name = prompt('Token name (e.g., "Claude session"):');
    if (!name) return;

    const canRename = confirm('Allow AI to suggest session titles? Click OK for yes.');

    try {
      const uiToken = localStorage.getItem('ui_token');
      const res = await fetch(`/api/v1/sessions/${sessionId}/tokens`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${uiToken}`
        },
        body: JSON.stringify({ name, can_rename_session: canRename })
      });

      const data = await res.json();
      if (data.token) {
        const instructions = `
AI Session Token Created!

APP_URL: ${window.location.origin}
SESSION_ID: ${sessionId}
SESSION_TOKEN: ${data.token}

Instructions for AI:
POST to: ${window.location.origin}/api/v1/sessions/${sessionId}/messages
Authorization: Bearer ${data.token}
Body: { "messages": [{ "role": "...", "content": "..." }] }

Rules:
- Do NOT include topic fields
- Messages are immutable (corrections = new messages)
- Only append to this session
        `;
        
        alert(instructions);
        navigator.clipboard.writeText(instructions);
      } else {
        setError(data.error || 'Failed to create token');
      }
    } catch (err) {
      setError('Unable to create token');
    }
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading session...</div>;
  if (error) return <div style={{ padding: '40px', color: 'red' }}>{error}</div>;
  if (!session) return <div style={{ padding: '40px' }}>Session not found</div>;

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <a href="/dashboard" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Dashboard</a>
          <h1>{session.title}</h1>
          <p style={{ color: '#6b7280' }}>
            Topic: {session.topic_title} • Created: {new Date(session.created_at).toLocaleString()}
          </p>
        </div>
        <button
          onClick={generateToken}
          style={{
            padding: '12px 24px',
            backgroundColor: '#8b5cf6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Generate AI Token
        </button>
      </div>

      <div style={{ 
        padding: '16px', 
        backgroundColor: '#f3f4f6', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ margin: '0 0 12px 0' }}>AI Agent Instructions</h3>
        <pre style={{ 
          margin: 0, 
          fontSize: '12px', 
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
{`POST ${window.location.origin}/api/v1/sessions/${sessionId}/messages
Authorization: Bearer <YOUR_TOKEN>

{
  "messages": [
    {
      "role": "user",
      "content": "User message",
      "provider": "unknown",
      "base_model": "unknown"
    },
    {
      "role": "assistant",
      "content": "Your response",
      "provider": "anthropic",
      "base_model": "claude-3-5-sonnet"
    }
  ]
}

⚠️ DO NOT:
- Include topic fields
- Edit/delete existing messages (append corrections instead)
- Access other sessions`}
        </pre>
      </div>

      <h2>Messages ({messages.length})</h2>
      {messages.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No messages yet. AI will append messages here.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                padding: '16px',
                borderRadius: '8px',
                backgroundColor: msg.role === 'user' ? '#dbeafe' : '#f0fdf4',
                border: '1px solid #e5e7eb',
                position: 'relative'
              }}
            >
              <div style={{ 
                position: 'absolute', 
                top: '8px', 
                right: '12px', 
                fontSize: '11px', 
                color: '#6b7280' 
              }}>
                #{msg.ordinal}
              </div>
              <div style={{ 
                fontWeight: 'bold', 
                marginBottom: '8px',
                color: msg.role === 'user' ? '#1d4ed8' : '#15803d'
              }}>
                {msg.role.toUpperCase()}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', marginBottom: '8px' }}>{msg.content}</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>
                {msg.provider && msg.base_model 
                  ? `${msg.provider}/${msg.base_model}` 
                  : 'unknown'}
                {' • '}
                {new Date(msg.observed_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: '40px' }}>Event Log ({events.length})</h2>
      {events.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No events yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {events.map((evt) => (
            <li key={evt.id} style={{ 
              padding: '12px', 
              marginBottom: '8px', 
              backgroundColor: '#f9fafb',
              borderRadius: '6px',
              fontSize: '14px'
            }}>
              <span style={{ fontWeight: 'bold' }}>{evt.action}</span>
              {' by '}{evt.actor}
              {' • '}{new Date(evt.created_at).toLocaleString()}
              {evt.detailsJson && Object.keys(evt.detailsJson).length > 0 && (
                <pre style={{ 
                  margin: '8px 0 0 0', 
                  fontSize: '12px', 
                  color: '#6b7280',
                  background: 'white',
                  padding: '8px',
                  borderRadius: '4px'
                }}>
                  {JSON.stringify(evt.detailsJson, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

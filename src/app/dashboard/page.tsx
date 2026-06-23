'use client';

import { useState, useEffect } from 'react';

interface Topic {
  id: string;
  title: string;
  description: string | null;
  archived: boolean;
  created_at: string;
  session_count: number;
}

interface Session {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string | null;
}

export default function Dashboard() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadTopics();
  }, []);

  useEffect(() => {
    if (selectedTopic) {
      loadSessions(selectedTopic.id);
    }
  }, [selectedTopic]);

  async function loadTopics() {
    try {
      const res = await fetch('/api/v1/topics');
      const data = await res.json();
      if (data.topics) {
        setTopics(data.topics);
      }
    } catch (err) {
      setError('Unable to load topics');
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions(topicId: string) {
    try {
      const res = await fetch(`/api/v1/topics/${topicId}/sessions`);
      const data = await res.json();
      if (data.sessions) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Load sessions error:', err);
    }
  }

  async function createTopic() {
    if (!newTopicTitle.trim()) return;
    
    try {
      const res = await fetch('/api/v1/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTopicTitle.trim() }),
      });
      
      const data = await res.json();
      if (data.success) {
        setNewTopicTitle('');
        loadTopics();
      } else {
        setError(data.error || 'Failed to create topic');
      }
    } catch (err) {
      setError('Unable to create topic');
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>Personal Context Protocol</h1>
      
      {error && (
        <div style={{ 
          backgroundColor: '#fef2f2', 
          padding: '12px', 
          borderRadius: '6px', 
          border: '1px solid #ef4444',
          marginBottom: '20px',
          color: '#dc2626'
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Topics sidebar */}
        <div style={{ width: '300px', borderRight: '1px solid #e5e7eb', paddingRight: '20px' }}>
          <h2>Topics</h2>
          
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              type="text"
              value={newTopicTitle}
              onChange={(e) => setNewTopicTitle(e.target.value)}
              placeholder="New topic name"
              style={{ 
                flex: 1, 
                padding: '8px', 
                border: '1px solid #d1d5db', 
                borderRadius: '4px'
              }}
              onKeyPress={(e) => e.key === 'Enter' && createTopic()}
            />
            <button
              onClick={createTopic}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: '#2563eb', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Add
            </button>
          </div>

          {loading ? (
            <p>Loading...</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {topics.map((topic) => (
                <li
                  key={topic.id}
                  onClick={() => setSelectedTopic(topic)}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: selectedTopic?.id === topic.id ? '#dbeafe' : '#f9fafb',
                    border: selectedTopic?.id === topic.id ? '1px solid #2563eb' : '1px solid #e5e7eb'
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{topic.title}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    {topic.session_count} {topic.session_count === 1 ? 'session' : 'sessions'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sessions panel */}
        <div style={{ flex: 1 }}>
          {selectedTopic ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2>{selectedTopic.title}</h2>
                <button
                  onClick={async () => {
                    const title = prompt('Session title:');
                    if (!title) return;
                    
                    try {
                      const res = await fetch(`/api/v1/topics/${selectedTopic.id}/sessions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        loadSessions(selectedTopic.id);
                      } else {
                        setError(data.error);
                      }
                    } catch (err) {
                      setError('Unable to create session');
                    }
                  }}
                  style={{ 
                    padding: '10px 20px', 
                    backgroundColor: '#22c55e', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Create Session
                </button>
              </div>

              {sessions.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No sessions yet. Create one to get started.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {sessions.map((session) => (
                    <li
                      key={session.id}
                      style={{
                        padding: '16px',
                        marginBottom: '12px',
                        borderRadius: '6px',
                        backgroundColor: '#f9fafb',
                        border: '1px solid #e5e7eb'
                      }}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>{session.title}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        Created: {new Date(session.created_at).toLocaleString()}
                        {session.last_message_at && ` • Last message: ${new Date(session.last_message_at).toLocaleString()}`}
                      </div>
                      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                        <button
                          onClick={async () => {
                            const tokenName = prompt('Token name (e.g., "Claude session"):');
                            if (!tokenName) return;
                            
                            const canRename = confirm('Allow AI to suggest session titles? Click OK for yes, Cancel for no.');
                            
                            try {
                              const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, {
                                method: 'POST',
                                headers: { 
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${localStorage.getItem('ui_token') || ''}`
                                },
                                body: JSON.stringify({ 
                                  name: tokenName,
                                  can_rename_session: canRename
                                }),
                              });
                              
                              const data = await res.json();
                              if (data.token) {
                                const instructions = `
AI Session Token Created!

Copy these details for your AI agent:

APP_URL: ${window.location.origin}
SESSION_ID: ${session.id}
SESSION_TOKEN: ${data.token}

Instructions for AI:
- POST messages to: ${window.location.origin}/api/v1/sessions/${session.id}/messages
- Include Authorization: Bearer ${data.token}
- Do NOT include topic fields
- Messages are immutable (corrections = new messages)
                                `;
                                
                                alert(instructions);
                                navigator.clipboard.writeText(instructions);
                              } else {
                                setError(data.error || 'Failed to create token');
                              }
                            } catch (err) {
                              setError('Unable to create token');
                            }
                          }}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#8b5cf6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          Generate Token
                        </button>
                        <button
                          onClick={() => {
                            // Navigate to session detail
                            window.location.href = `/sessions/${session.id}`;
                          }}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#6b7280',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          View
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
              <p>Select a topic to view sessions</p>
              <p style={{ fontSize: '12px' }}>Or create a new topic to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React from 'react';

interface StatusPanelProps {
  title?: string;
  message: string;
  tone?: 'default' | 'error' | 'success';
}

export default function StatusPanel({ title, message, tone = 'default' }: StatusPanelProps) {
  const className = tone === 'default' ? 'panel' : `alert alert-${tone}`;

  return (
    <div className={className}>
      {title ? <h2 style={{ marginTop: 0 }}>{title}</h2> : null}
      <p style={{ margin: 0 }}>{message}</p>
    </div>
  );
}

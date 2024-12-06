import { useState } from 'react';

export default function Home() {
  const [message, setMessage] = useState('');

  const runBot = async () => {
    setMessage('Running bot...');
    const response = await fetch('/api/bot');
    const data = await response.json();
    setMessage(data.message || 'No trades executed.');
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px' }}>
      <h1>Trading Bot Dashboard</h1>
      <button onClick={runBot}>Run Bot</button>
      <p>{message}</p>
    </div>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, position: 'relative', zIndex: 1 }}>
      <div className="card center" style={{ maxWidth: 460 }}>
        <div style={{ fontSize: '2.6rem', fontWeight: 800 }} className="mono">404</div>
        <h2 style={{ marginTop: 6 }}>That screen does not exist</h2>
        <p className="small">The page you were looking for has moved or never existed. The arena, however, is still open.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to="/app" className="btn primary">Back to the arena</Link>
          <Link to="/" className="btn ghost">Home</Link>
        </div>
      </div>
    </div>
  );
}

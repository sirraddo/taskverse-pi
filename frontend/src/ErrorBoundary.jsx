import { Component } from 'react';

/** Catches render crashes so users see a recovery screen instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('UI crash:', err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', fontFamily: 'sans-serif', backgroundColor: '#0F172A', color: '#e2e8f0' }}>
        <div style={{ fontSize: '2.2rem' }}>😕</div>
        <h2 style={{ margin: '10px 0 6px' }}>Something went wrong</h2>
        <p style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: '0.9rem' }}>Your account and balance are safe. Reload to continue.</p>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 22px', borderRadius: '10px', border: 'none', backgroundColor: '#059669', color: 'white', fontWeight: '700', cursor: 'pointer' }}>Reload</button>
      </div>
    );
  }
}

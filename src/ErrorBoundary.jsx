import { Component } from 'react';

// Last line of defence: if rendering throws, show a recoverable screen instead
// of a blank page. Raw data is never persisted, so the worst case is re-importing.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('FloSchmo crashed:', error, info?.componentStack);
  }

  resetAndReload = () => {
    try { localStorage.removeItem('floschmo.workspace.v1'); } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>
            FloSchmo hit an unexpected error. Your FCS files are untouched. Reloading usually fixes it, and your
            last session can be restored from the start screen.
          </p>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn btn-secondary" onClick={this.resetAndReload}>Clear saved session &amp; reload</button>
          </div>
        </div>
      </div>
    );
  }
}

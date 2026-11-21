import { useEffect, useMemo, useState } from 'react';
import Icon from './Icons';
import NumberField from './NumberField';
import { fluorChannels, parseSpillover, identity, computeSpillover, invert, isIdentity } from './compensation';

const shortName = (ch) => ch.replace(/-[AHW]$/, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Guess which loaded sample is the single-stain control for a channel, by name.
function guessControl(files, ch) {
  const s = esc(shortName(ch));
  const token = new RegExp(`(^|[_\\s.-])${s}([_\\s.-]|$)`, 'i');
  const hit = files.findIndex(f => token.test(f.name) && !/unstain/i.test(f.name));
  if (hit >= 0) return hit;
  return files.findIndex(f => f.name.toLowerCase().includes(shortName(ch).toLowerCase()) && !/unstain/i.test(f.name));
}

export default function CompensationDialog({ files, compensation, onChange, onClose }) {
  const first = files[0]?.parsed;
  const fileSpill = useMemo(() => {
    for (const f of files) {
      const s = parseSpillover(f.parsed.meta);
      if (s) return s;
    }
    return null;
  }, [files]);

  // Working copy so edits don't recompute every plot on each keystroke.
  const [draft, setDraft] = useState(() => {
    if (compensation) return structuredClone(compensation);
    const channels = fileSpill?.channels || (first ? fluorChannels(first) : []);
    return {
      enabled: false,
      channels,
      matrix: fileSpill?.matrix || identity(channels.length),
      source: fileSpill ? 'FCS SPILL keyword' : 'identity',
    };
  });

  const [controls, setControls] = useState(() =>
    Object.fromEntries(draft.channels.map(ch => [ch, guessControl(files, ch)])));
  const [unstainedIdx, setUnstainedIdx] = useState(() => files.findIndex(f => /unstain/i.test(f.name)));
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setCell = (i, j, pct) => {
    const v = parseFloat(pct);
    setDraft(d => {
      const m = d.matrix.map(r => [...r]);
      m[i][j] = Number.isFinite(v) ? v / 100 : 0;
      return { ...d, matrix: m, source: 'edited' };
    });
  };

  const compute = () => {
    setErr(null);
    const ctl = {};
    draft.channels.forEach(ch => { const i = controls[ch]; if (i >= 0) ctl[ch] = files[i].parsed; });
    const uns = unstainedIdx >= 0 ? files[unstainedIdx].parsed : null;
    try {
      const { matrix, report } = computeSpillover(draft.channels, ctl, uns);
      invert(matrix); // sanity check: must be invertible
      setDraft(d => ({ ...d, matrix, enabled: true, source: 'single-stain controls' }));
      setReport(report);
    } catch (e) { setErr(e.message); }
  };

  const apply = () => {
    try { invert(draft.matrix); } catch (e) { setErr(e.message); return; }
    onChange(draft);
    onClose();
  };

  const offDiag = draft.matrix.flatMap((r, i) => r.filter((_, j) => j !== i));
  const maxSpill = offDiag.length ? Math.max(...offDiag.map(Math.abs)) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Compensation">
        <div className="modal-head">
          <span className="modal-icon"><Icon name="matrix" size={17} /></span>
          <div>
            <div className="modal-title">Compensation</div>
            <div className="modal-sub">Spillover matrix · source: {draft.source}</div>
          </div>
          <label className="switch" title="Apply compensation to all samples">
            <input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} />
            <span className="switch-track"><span className="switch-thumb" /></span>
            <span>{draft.enabled ? 'On' : 'Off'}</span>
          </label>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={15} /></button>
        </div>

        <div className="modal-body">
          {draft.channels.length < 2 ? (
            <div className="panel-empty">Fewer than two fluorescence channels — nothing to compensate.</div>
          ) : (
            <>
              <section className="modal-section">
                <div className="modal-section-title">1 · Single-stain controls</div>
                <div className="ctl-grid">
                  {draft.channels.map(ch => (
                    <label key={ch} className="ctl-row">
                      <span className="ctl-ch">{shortName(ch)}</span>
                      <select value={controls[ch] ?? -1} onChange={e => setControls(c => ({ ...c, [ch]: +e.target.value }))}>
                        <option value={-1}>— none —</option>
                        {files.map((f, i) => <option key={i} value={i}>{f.name.replace(/\.fcs$/i, '')}</option>)}
                      </select>
                    </label>
                  ))}
                  <label className="ctl-row">
                    <span className="ctl-ch muted-ch">Unstained</span>
                    <select value={unstainedIdx} onChange={e => setUnstainedIdx(+e.target.value)}>
                      <option value={-1}>— none (use control's dim events) —</option>
                      {files.map((f, i) => <option key={i} value={i}>{f.name.replace(/\.fcs$/i, '')}</option>)}
                    </select>
                  </label>
                </div>
                <div className="modal-row">
                  <button className="btn btn-primary" onClick={compute}><Icon name="sliders" size={14} /> Compute from controls</button>
                  {report && (
                    <span className="compute-report">
                      {report.map(r => <span key={r.channel}><b>{shortName(r.channel)}</b> {r.status}</span>)}
                    </span>
                  )}
                </div>
              </section>

              <section className="modal-section">
                <div className="modal-section-title">
                  2 · Spillover matrix <span className="muted">(% of row fluorochrome detected in column channel — editable)</span>
                </div>
                <div className="matrix-scroll">
                  <table className="matrix-table">
                    <thead>
                      <tr>
                        <th>Fluorochrome ↓ / Detector →</th>
                        {draft.channels.map(ch => <th key={ch}>{shortName(ch)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.channels.map((chI, i) => (
                        <tr key={chI}>
                          <th>{shortName(chI)}</th>
                          {draft.channels.map((chJ, j) => {
                            const v = draft.matrix[i][j] * 100;
                            const heat = i === j ? 0 : Math.min(1, Math.abs(draft.matrix[i][j]) / Math.max(0.05, maxSpill));
                            return (
                              <td key={chJ} style={i === j ? undefined : { background: `rgba(21,151,184,${0.06 + heat * 0.28})` }}>
                                {i === j ? <span className="diag">100</span> : (
                                  <NumberField value={Number(v.toFixed(3))}
                                    aria-label={`${shortName(chI)} into ${shortName(chJ)}, percent`}
                                    onChange={n => setCell(i, j, n ?? 0)} />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="modal-row">
                  {fileSpill && (
                    <button className="btn btn-ghost" onClick={() => setDraft(d => ({ ...d, channels: fileSpill.channels, matrix: fileSpill.matrix, source: 'FCS SPILL keyword' }))}>
                      Load from FCS{isIdentity(fileSpill.matrix) ? ' (identity)' : ''}
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={() => setDraft(d => ({ ...d, matrix: identity(d.channels.length), source: 'identity' }))}>
                    <Icon name="reset" size={13} /> Reset to identity
                  </button>
                </div>
              </section>
              {err && <div className="error">{err}</div>}
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted">Applies to every sample. Gates keep their positions — re-check them after compensating.</span>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import Icon from './Icons';
import { MOD } from './platform';

const SHORTCUTS = [
  ['Gate tools', [
    [['R'], 'Rectangle gate'],
    [['P'], 'Polygon gate'],
    [['Q'], 'Quadrant gate'],
    [['L'], 'Range (linear) gate'],
    [['Esc'], 'Cancel a polygon in progress · close dialogs'],
    [['Del'], 'Delete the selected gate'],
  ]],
  ['Workspace', [
    [[MOD, 'Z'], 'Undo'],
    [[MOD, 'Shift', 'Z'], 'Redo'],
    [[MOD, 'S'], 'Save workspace'],
    [[MOD, 'O'], 'Open workspace'],
    [['?'], 'Show this help'],
  ]],
];

const STEPS = [
  ['Import', 'Drop .fcs files anywhere on the window, or use Import FCS. No files handy? Load the demo data.'],
  ['Gate', 'Pick a gate tool and draw on a plot. Drawing on a plot that is filtered by a gate creates a child gate.'],
  ['Explore', 'Add scatter plots, histograms and stacked overlays. Each plot can show any gate and use its own axes and scales.'],
  ['Compare', 'The Sample table applies your gating tree to every sample and exports the numbers as CSV.'],
  ['Export', 'Export single plots or a whole lettered figure panel as SVG/PNG, and save the workspace to pick up later.'],
];

export default function HelpDialog({ onClose, version }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal help-modal" role="dialog" aria-modal="true" aria-label="Help">
        <div className="modal-head">
          <span className="modal-icon"><Icon name="help" size={17} /></span>
          <div>
            <div className="modal-title">Help &amp; shortcuts</div>
            <div className="modal-sub">FloSchmo {version ? `v${version}` : ''}</div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} title="Close"><Icon name="close" size={15} /></button>
        </div>

        <div className="modal-body help-body">
          <section className="modal-section">
            <div className="modal-section-title">Quick start</div>
            <ol className="help-steps">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="help-step-n">{i + 1}</span>
                  <div><b>{title}</b><span>{text}</span></div>
                </li>
              ))}
            </ol>
          </section>

          <section className="modal-section">
            <div className="modal-section-title">Keyboard shortcuts</div>
            <div className="help-shortcuts">
              {SHORTCUTS.map(([group, rows]) => (
                <div key={group} className="help-sc-group">
                  <div className="help-sc-title">{group}</div>
                  {rows.map(([keys, label]) => (
                    <div key={label} className="help-sc-row">
                      <span>{label}</span>
                      <span className="kbd-combo">{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="modal-section">
            <div className="privacy-note">
              <Icon name="lock" size={16} />
              <div>
                <b>Your data stays on this computer.</b> FloSchmo runs entirely in your browser — FCS files are
                read locally and are never uploaded anywhere. Saved workspaces contain gates and settings only, not event data.
              </div>
            </div>
            <p className="help-fineprint">
              For research use only — not for clinical or diagnostic use. FloSchmo is an independent project and is not
              affiliated with, or endorsed by, FlowJo or BD.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { parseFCS } from './fcsParser';
import SchmoLogo from './Logo';
import HelpDialog from './HelpDialog';
import { generateDemoFiles, isDemoName } from './demoData';
import { MOD, modKey } from './platform';
import { sampleColor } from './palette';
import NumberField from './NumberField';
import { axisLimitProblem } from './scales';
import { computeCombinedMasks, countMask, computeStats, fmt, descendantIds, withParamNames, flattenGateTree } from './gateUtils';
import ScatterPlot from './ScatterPlot';
import Histogram from './Histogram';
import StackedHistogram from './StackedHistogram';
import SampleTable from './SampleTable';
import CompensationDialog from './CompensationDialog';
import { compensate, fluorChannels } from './compensation';
import { exportSvgElement, exportPngElement, exportFigure, downloadCsv, fileSlug } from './exportUtils';
import Icon from './Icons';
import './App.css';

const AUTOSAVE_KEY = 'floschmo.workspace.v1';
const THEME_KEY = 'floschmo.theme';
// The app was called "FlowSchmo" before v1.0 — keep reading what it saved.
const LEGACY_AUTOSAVE_KEY = 'flowschmo.workspace.v1';
const WORKSPACE_APP_IDS = ['FloSchmo', 'FlowSchmo'];
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
let plotCounter = 0;
let toastCounter = 0;
const newPlotId = (kind) => `${kind}-${++plotCounter}-${Date.now()}`;
const stripExt = (name) => name.replace(/\.fcs$/i, '');

export default function App() {
  const [files, setFiles] = useState([]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [plots, setPlots] = useState([]);
  const [cofactor, setCofactor] = useState(150);
  const [gates, setGates] = useState([]);
  const [activeGateId, setActiveGateId] = useState(null);
  const [drawTool, setDrawTool] = useState('rect');
  const [view, setView] = useState('analysis'); // 'analysis' | 'samples'
  // Which population the statistics panel summarises: 'all' (every event),
  // a gate id, or 'follow' (whatever gate is currently selected).
  const [statsSource, setStatsSource] = useState('all');
  const [showHelp, setShowHelp] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
  });
  const workspaceInputRef = useRef(null);

  // ---------- Toast notifications ----------
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((msg, type = 'info') => {
    const id = ++toastCounter;
    setToasts(t => [...t.slice(-3), { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 7000 : 3200);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }, [theme]);
  const [expectedSamples, setExpectedSamples] = useState([]); // sample names a loaded workspace refers to
  const [compensation, setCompensation] = useState(null); // { enabled, channels, matrix, source }
  const [savedSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || localStorage.getItem(LEGACY_AUTOSAVE_KEY) || 'null');
    } catch { return null; }
  });

  const [showComp, setShowComp] = useState(false);

  // Compensated view of every sample (raw `files` are kept untouched for re-computing).
  const effFiles = useMemo(() => {
    if (!compensation?.enabled) return files;
    return files.map(f => ({ ...f, parsed: compensate(f.parsed, compensation) }));
  }, [files, compensation]);

  const activeFile = effFiles[activeFileIdx];
  const parsed = activeFile?.parsed;

  // Every gate change goes through here so gates carry parameter *names*,
  // letting the same gating tree apply to samples with different param order.
  const setGatesNamed = (next) => setGates(prev => {
    const val = typeof next === 'function' ? next(prev) : next;
    return val.map(g => withParamNames(g, parsed));
  });

  // ---------- Undo / redo (gates + plots) ----------
  // Snapshots are taken whenever gates or plots change. Changes arriving in
  // quick succession (a drag, typing a name) collapse into one undo step.
  const hist = useRef({ past: [], future: [], present: null, lastPush: 0, applying: false, reset: false });
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    const h = hist.current;
    const prev = h.present;
    if (h.reset) {
      h.reset = false; h.past = []; h.future = []; h.lastPush = 0;
    } else if (prev && (prev.gates !== gates || prev.plots !== plots)) {
      if (h.applying) {
        h.applying = false;
      } else {
        const now = Date.now();
        if (now - h.lastPush > 500) {
          h.past.push(prev);
          if (h.past.length > 100) h.past.shift();
        }
        h.lastPush = now;
        h.future = [];
      }
    }
    h.present = { gates, plots };
    const next = { canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
    setHistState(s => (s.canUndo === next.canUndo && s.canRedo === next.canRedo) ? s : next);
  }, [gates, plots]);

  const applySnapshot = (snap) => {
    const h = hist.current;
    h.applying = true;
    h.lastPush = 0;
    setGates(snap.gates);
    setPlots(snap.plots);
    setActiveGateId(id => (id && snap.gates.some(g => g.id === id)) ? id : null);
  };
  const undo = () => {
    const h = hist.current;
    if (!h.past.length) return;
    const target = h.past.pop();
    h.future.push(h.present);
    applySnapshot(target);
  };
  const redo = () => {
    const h = hist.current;
    if (!h.future.length) return;
    const target = h.future.pop();
    h.past.push(h.present);
    applySnapshot(target);
  };

  // ---------- Workspace save / load ----------
  const sampleNames = files.map(f => f.name);
  const buildWorkspace = () => ({
    app: 'FloSchmo',
    version: 1,
    savedAt: new Date().toISOString(),
    samples: sampleNames.length ? sampleNames : expectedSamples,
    cofactor, drawTool, gates, plots, activeGateId, compensation, statsSource,
  });

  const applyWorkspace = (ws) => {
    if (!ws || !WORKSPACE_APP_IDS.includes(ws.app)) throw new Error('Not a FloSchmo workspace file');
    hist.current.reset = true; // a loaded workspace starts a fresh undo history
    setGates(ws.gates || []);
    setPlots(ws.plots || []);
    setCofactor(ws.cofactor ?? 150);
    setDrawTool(ws.drawTool || 'rect');
    setActiveGateId(ws.activeGateId ?? null);
    setCompensation(ws.compensation ?? null);
    setStatsSource(ws.statsSource ?? 'all');
    setExpectedSamples(ws.samples || []);
    setView('analysis');
    // A workspace built on the demo data can bring its own samples back.
    const names = ws.samples || [];
    if (names.length && names.every(isDemoName) && !names.every(n => sampleNames.includes(n))) {
      addSamples(generateDemoFiles(), { seed: false });
    }
  };

  const saveWorkspace = () => {
    if (!files.length && !gates.length) return;
    const ws = buildWorkspace();
    const base = stripExt(files[0]?.name || 'workspace').replace(/[^\w.-]+/g, '_');
    const blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${base}.floschmo.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify('Workspace saved', 'success');
  };

  const openWorkspaceFile = async (file) => {
    try {
      applyWorkspace(JSON.parse(await file.text()));
      notify(`Opened ${file.name}`, 'success');
    } catch (err) {
      notify(`Couldn't open workspace: ${err.message}`, 'error');
    }
  };

  const openWorkspace = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) openWorkspaceFile(file);
  };

  // Autosave the analysis (not the raw data) so a reload can restore it.
  useEffect(() => {
    if (!files.length && !gates.length) return;
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildWorkspace())); } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gates, plots, cofactor, compensation, files.length, activeGateId, statsSource]);

  const missingSamples = expectedSamples.filter(n => !sampleNames.includes(n));

  // ---------- Samples ----------
  // Add parsed samples. Re-adding a sample with the same name replaces it.
  // `seed` lays out a sensible first set of plots on a brand-new session.
  const addSamples = (out, { seed = true } = {}) => {
    if (!out.length) return;
    setFiles(prev => {
      const next = [...prev];
      for (const f of out) {
        const i = next.findIndex(p => p.name === f.name);
        if (i >= 0) next[i] = f; else next.push(f);
      }
      return next;
    });
    if (seed && files.length === 0 && plots.length === 0) {
      const params = out[0].parsed.params;
      const idx = (name) => params.findIndex(p => p.name === name);
      const fsc = idx('FSC-A'), fscH = idx('FSC-H'), ssc = idx('SSC-A');
      const fluor = fluorChannels(out[0].parsed).map(idx);
      const firstFluor = idx('GFP-A') >= 0 ? idx('GFP-A') : (fluor[0] ?? 0);
      const seeded = [
        { id: newPlotId('scatter'), kind: 'scatter', xParam: fsc >= 0 ? fsc : 0, yParam: ssc >= 0 ? ssc : Math.min(1, params.length - 1), xScale: 'linear', yScale: 'linear', gateId: null },
      ];
      if (fsc >= 0 && fscH >= 0) {
        seeded.push({ id: newPlotId('scatter'), kind: 'scatter', xParam: fsc, yParam: fscH, xScale: 'linear', yScale: 'linear', gateId: null });
      }
      seeded.push({ id: newPlotId('histogram'), kind: 'histogram', paramIndex: firstFluor, scale: 'biexp', gateId: null });
      if (fluor.length >= 2) {
        seeded.push({ id: newPlotId('scatter'), kind: 'scatter', xParam: fluor[0], yParam: fluor[1], xScale: 'biexp', yScale: 'biexp', gateId: null });
      }
      hist.current.reset = true;
      setPlots(seeded);
    }
  };

  const importFcsFiles = async (list, opts) => {
    if (!list.length) return;
    setBusy(true);
    const out = [], failed = [];
    for (const f of list) {
      try {
        out.push({ name: f.name, parsed: await parseFCS(f) });
      } catch (err) {
        console.error(err);
        failed.push(`${f.name} — ${err.message}`);
      }
    }
    setBusy(false);
    addSamples(out, opts);
    if (out.length) notify(`Imported ${out.length} sample${out.length === 1 ? '' : 's'}`, 'success');
    failed.forEach(m => notify(`Couldn't read ${m}`, 'error'));
  };

  const handleUpload = (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same files later
    importFcsFiles(list);
  };

  const loadDemo = () => {
    const demo = generateDemoFiles();
    const fresh = files.length === 0;
    addSamples(demo);
    if (fresh) setActiveFileIdx(demo.length - 1); // open on the dual-reporter library
    notify('Demo data loaded — 4 synthetic samples', 'success');
  };

  // Files dropped anywhere on the window: .fcs samples and/or a workspace .json
  const handleDroppedFiles = (list) => {
    const fcs = list.filter(f => /\.fcs$/i.test(f.name));
    const ws = list.find(f => /\.json$/i.test(f.name));
    if (!fcs.length && !ws) {
      notify('Drop .fcs files or a .floschmo.json workspace', 'error');
      return;
    }
    if (ws) openWorkspaceFile(ws);
    if (fcs.length) importFcsFiles(fcs, { seed: !ws });
  };

  const removeSample = (i) => {
    const name = files[i]?.name;
    setFiles(prev => prev.filter((_, k) => k !== i));
    setExpectedSamples(prev => prev.filter(n => n !== name));
    setActiveFileIdx(cur => (cur > i || (cur === i && cur === files.length - 1)) ? Math.max(0, cur - 1) : cur);
  };

  const gateMasks = useMemo(() => {
    if (!parsed) return {};
    return computeCombinedMasks(parsed, gates);
  }, [parsed, gates]);

  // % of parent for every gate — shown on the plots, FlowJo-style.
  const gatePct = useMemo(() => {
    if (!parsed) return {};
    const counts = Object.fromEntries(gates.map(g => [g.id, gateMasks[g.id] ? countMask(gateMasks[g.id]) : 0]));
    return Object.fromEntries(gates.map(g => {
      const parentN = g.parentId && counts[g.parentId] !== undefined ? counts[g.parentId] : parsed.totalEvents;
      return [g.id, parentN > 0 ? (counts[g.id] / parentN) * 100 : 0];
    }));
  }, [parsed, gates, gateMasks]);

  const activeMask = activeGateId ? gateMasks[activeGateId] : null;
  const activeGate = gates.find(g => g.id === activeGateId);

  // ---------- Statistics population ----------
  // Kept separate from the *selected* gate on purpose: selecting or drawing a
  // gate is for editing it, and must not change which numbers are on screen.
  const statsGate = statsSource === 'follow' ? activeGate
    : statsSource === 'all' ? undefined
    : gates.find(g => g.id === statsSource);
  const statsMask = statsGate ? gateMasks[statsGate.id] : null;
  // If the chosen gate no longer exists (deleted, or undone), fall back to all events.
  const statsSourceShown = (statsSource === 'all' || statsSource === 'follow' || statsGate) ? statsSource : 'all';

  // CSV of the statistics table: every parameter for the chosen population,
  // for the sample on screen ('sample') or for every loaded sample ('all').
  const exportStatsCsv = (scope) => {
    if (!parsed) return;
    const targets = scope === 'all' ? effFiles : [activeFile];
    const population = statsGate ? statsGate.name : 'All events';
    const round = (v) => (Number.isFinite(v) ? Number(v.toPrecision(7)) : null);
    const rows = [[
      'Sample', 'Population', 'Events', '% of parent', '% of total', 'Parameter',
      'Mean', 'Geo mean', 'Median', 'SD', 'CV %', 'rCV %', 'Min', 'Max',
    ]];
    for (const f of targets) {
      const p = f.parsed;
      let mask = null, n = p.totalEvents, pctParent = 100;
      if (statsGate) {
        const masks = f === activeFile ? gateMasks : computeCombinedMasks(p, gates);
        mask = masks[statsGate.id];
        n = countMask(mask);
        const parentMask = statsGate.parentId ? masks[statsGate.parentId] : null;
        const parentN = parentMask ? countMask(parentMask) : p.totalEvents;
        pctParent = parentN > 0 ? (n / parentN) * 100 : null;
      }
      const pctTotal = p.totalEvents > 0 ? (n / p.totalEvents) * 100 : null;
      p.params.forEach((param, i) => {
        const s = n > 0 ? computeStats(p, i, mask) : null;
        rows.push([
          stripExt(f.name), population, n, round(pctParent), round(pctTotal), param.name,
          ...(s ? [s.mean, s.geoMean, s.median, s.sd, s.cv, s.rcv, s.min, s.max].map(round) : Array(8).fill(null)),
        ]);
      });
    }
    const who = scope === 'all' ? 'all-samples' : fileSlug(stripExt(activeFile.name));
    downloadCsv(rows, `${who}_${fileSlug(population)}_statistics.csv`);
    notify(scope === 'all'
      ? `Statistics exported — ${targets.length} samples, “${population}”`
      : `Statistics exported — “${population}”`, 'success');
  };

  const updatePlot = (id, patch) => setPlots(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
  const removePlot = (id) => setPlots(ps => ps.filter(p => p.id !== id));
  const duplicatePlot = (id) => setPlots(ps => {
    const i = ps.findIndex(p => p.id === id);
    if (i < 0) return ps;
    const copy = { ...ps[i], id: newPlotId(ps[i].kind === 'stacked-histogram' ? 'stacked' : ps[i].kind) };
    return [...ps.slice(0, i + 1), copy, ...ps.slice(i + 1)];
  });
  const addScatter = () => {
    if (!parsed) return;
    setPlots(ps => [...ps, {
      id: newPlotId('scatter'), kind: 'scatter',
      xParam: 0, yParam: Math.min(1, parsed.params.length - 1),
      xScale: 'linear', yScale: 'linear', gateId: null,
    }]);
  };
  const addHistogram = () => {
    if (!parsed) return;
    setPlots(ps => [...ps, {
      id: newPlotId('histogram'), kind: 'histogram',
      paramIndex: 0, scale: 'biexp', gateId: null,
    }]);
  };
  const addStackedHistogram = () => {
    if (!parsed) return;
    setPlots(ps => [...ps, {
      id: newPlotId('stacked'), kind: 'stacked-histogram',
      paramName: parsed.params[0].name, scale: 'biexp', normalize: 'modal', gateId: null,
    }]);
  };

  const exportSVG = (plotId, filename) => {
    const svg = document.querySelector(`[data-plot-id="${plotId}"] > svg`);
    if (svg) exportSvgElement(svg, filename);
  };

  const exportPNG = (plotId, filename) => {
    const svg = document.querySelector(`[data-plot-id="${plotId}"] > svg`);
    if (svg) exportPngElement(svg, filename);
  };

  // Whole-figure export: every plot card, in on-screen order, laid out on a grid.
  const [figCols, setFigCols] = useState(2);
  const [plotSize, setPlotSize] = useState('M'); // responsive grid card min-width
  const PLOT_MIN = { S: 340, M: 460, L: 620 };
  const exportWholeFigure = (format) => {
    const items = [...document.querySelectorAll('.plot-wrap[data-plot-id]')].map(card => ({
      svg: card.querySelector(':scope > svg'),
      title: card.querySelector('.plot-title-main')?.textContent || '',
      subtitle: [activeFile?.name.replace(/\.fcs$/i, ''), card.querySelector('.plot-title-sub')?.textContent]
        .filter(Boolean).join(' · '),
    })).filter(it => it.svg);
    if (!items.length) return;
    const base = (activeFile?.name || 'figure').replace(/\.fcs$/i, '').replace(/[^\w.-]+/g, '_');
    exportFigure(items, { columns: figCols }, `${base}-figure`, format);
    notify(`Figure exported — ${items.length} panel${items.length === 1 ? '' : 's'} as ${format.toUpperCase()}`, 'success');
  };

  const deleteGate = (id) => {
    // Quadrants are a linked set of four — deleting one removes the whole set.
    const target = gates.find(g => g.id === id);
    const roots = target?.groupId ? gates.filter(g => g.groupId === target.groupId).map(g => g.id) : [id];
    const toRemove = new Set(roots.flatMap(r => descendantIds(r, gates)));
    setGates(gs => gs.filter(g => !toRemove.has(g.id)));
    if (toRemove.has(activeGateId)) setActiveGateId(null);
    if (toRemove.has(statsSource)) setStatsSource('all');
    setPlots(ps => ps.map(p => toRemove.has(p.gateId) ? { ...p, gateId: null } : p));
  };

  const renameGate = (id, name) => setGates(gs => gs.map(g => g.id === id ? { ...g, name } : g));

  const gateLabel = (g) => {
    const pn = (i, name) => name || parsed?.params[i]?.name || `P${i + 1}`;
    const xy = `${pn(g.xParam, g.xName)} × ${pn(g.yParam, g.yName)}`;
    if (g.type === 'rect') return `rect on ${xy}`;
    if (g.type === 'polygon') return `polygon on ${xy}`;
    if (g.type === 'quad') return `quadrant ${g.quadrant} on ${xy}`;
    if (g.type === 'linear') return `range on ${pn(g.paramIndex, g.paramName)}`;
    return g.type;
  };

  const toolHints = {
    rect: 'Drag on a scatter plot to draw a rectangle gate',
    polygon: 'Click to add vertices · click first point or double-click to close · Esc cancels',
    linear: 'Drag on a histogram to draw a 1D range gate',
    quad: 'Click on a scatter plot to place quadrants · drag the center handle to move · click a quadrant label to select it',
  };
  const rootGates = gates.filter(g => !g.parentId || !gates.find(p => p.id === g.parentId));

  // ---------- Global keyboard shortcuts + drag-and-drop ----------
  // Listeners are attached once; they read the latest handlers through this ref.
  const actions = useRef({});
  useEffect(() => {
    actions.current = {
      undo, redo, saveWorkspace, deleteGate, handleDroppedFiles,
      activeGateId, hasData: !!parsed,
      dialogOpen: showComp || showHelp,
      setTool: setDrawTool,
      openWorkspacePicker: () => workspaceInputRef.current?.click(),
      showHelp: () => setShowHelp(true),
    };
  }); // no dependency list: refresh after every render

  useEffect(() => {
    const onKey = (e) => {
      const a = actions.current;
      const t = e.target;
      const typing = t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

      if (modKey(e)) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); a.saveWorkspace(); }
        else if (k === 'o') { e.preventDefault(); a.openWorkspacePicker(); }
        else if (!typing && k === 'z') { e.preventDefault(); if (e.shiftKey) a.redo(); else a.undo(); }
        else if (!typing && k === 'y') { e.preventDefault(); a.redo(); }
        return;
      }
      if (typing || a.dialogOpen || e.altKey) return;

      const tool = { r: 'rect', p: 'polygon', q: 'quad', l: 'linear' }[e.key.toLowerCase()];
      if (tool && a.hasData) { a.setTool(tool); return; }
      if (e.key === '?') { a.showHelp(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && a.activeGateId) {
        e.preventDefault();
        a.deleteGate(a.activeGateId);
      }
    };

    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const onEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragActive(true); };
    const onOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const onLeave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragActive(false); };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      actions.current.handleDroppedFiles(Array.from(e.dataTransfer.files));
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="app">
      {/* ---------- Top application bar ---------- */}
      <header className="topbar">
        <div className="brand">
          <SchmoLogo size={30} />
          <div className="brand-text">
            <span className="brand-name">Flo<span>Schmo</span></span>
            <span className="brand-tag">flow analysis for any Jo Schmo</span>
          </div>
        </div>

        {parsed && (
          <div className="toolbar">
            <div className="toolbar-group">
              <span className="toolbar-label">Gate</span>
              <div className="segmented" role="radiogroup" aria-label="Drawing tool">
                {[
                  ['rect', 'rect', 'Rectangle'],
                  ['polygon', 'polygon', 'Polygon'],
                  ['quad', 'quad', 'Quadrant'],
                  ['linear', 'linear', 'Range'],
                ].map(([key, icon, label]) => (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={drawTool === key}
                    className={drawTool === key ? 'seg active' : 'seg'}
                    onClick={() => setDrawTool(key)}
                    title={toolHints[key]}
                  >
                    <Icon name={icon} size={15} /> {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="toolbar-divider" />

            <div className="toolbar-group">
              <span className="toolbar-label">Add</span>
              <button className="btn btn-ghost add-btn" onClick={addScatter} title="Add scatter plot"><Icon name="scatter" size={15} /> Scatter</button>
              <button className="btn btn-ghost add-btn" onClick={addHistogram} title="Add histogram"><Icon name="histogram" size={15} /> Histogram</button>
              <button className="btn btn-ghost add-btn" onClick={addStackedHistogram} title="Add stacked histogram (all samples)"><Icon name="stacked" size={15} /> Stacked</button>
            </div>

            <div className="toolbar-divider" />

            <label className="toolbar-group cofactor" title="asinh cofactor used by biexp axes">
              <span className="toolbar-label">Cofactor</span>
              <input type="number" value={cofactor} onChange={e => setCofactor(+e.target.value)} min="1" />
            </label>

            <div className="toolbar-divider" />

            <button className={compensation?.enabled ? 'btn btn-ghost comp-btn on' : 'btn btn-ghost comp-btn'}
              onClick={() => setShowComp(true)} title="Compensation (spillover matrix)">
              <Icon name="matrix" size={15} /> Comp
              {compensation?.enabled && <span className="comp-badge">ON</span>}
            </button>
          </div>
        )}

        <div className="topbar-actions">
          <div className="icon-group">
            <button className="btn btn-icon" onClick={undo} disabled={!histState.canUndo} title={`Undo (${MOD}+Z)`} aria-label="Undo">
              <Icon name="undo" size={16} />
            </button>
            <button className="btn btn-icon" onClick={redo} disabled={!histState.canRedo} title={`Redo (${MOD}+Shift+Z)`} aria-label="Redo">
              <Icon name="redo" size={16} />
            </button>
          </div>
          <div className="toolbar-divider" />
          <label className="btn btn-ghost" title={`Open a saved .floschmo.json workspace (${MOD}+O)`}>
            <Icon name="folder" size={15} /> Open
            <input ref={workspaceInputRef} type="file" accept=".json,application/json" onChange={openWorkspace} style={{ display: 'none' }} />
          </label>
          <button className="btn btn-ghost" onClick={saveWorkspace} disabled={!files.length && !gates.length}
            title={`Save gates, plots & settings to a .floschmo.json file (${MOD}+S)`}>
            <Icon name="save" size={15} /> Save
          </button>
          <div className="toolbar-divider" />
          <div className="icon-group">
            <button className="btn btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <button className="btn btn-icon" onClick={() => setShowHelp(true)} title="Help & keyboard shortcuts (?)" aria-label="Help">
              <Icon name="help" size={16} />
            </button>
          </div>
          <label className="btn btn-primary import-btn">
            <Icon name="upload" size={15} /> Import FCS
            <input type="file" accept=".fcs" multiple onChange={handleUpload} style={{ display: 'none' }} />
          </label>
        </div>
      </header>

      <div className="body">
        {/* ---------- Sidebar ---------- */}
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-head">
              <Icon name="file" size={14} />
              <span>Samples</span>
              <span className="count-pill">{files.length}</span>
            </div>
            {missingSamples.length > 0 && (
              <div className="missing-samples">
                <div className="missing-head"><Icon name="alert" size={13} /> Workspace expects {missingSamples.length} more sample{missingSamples.length === 1 ? '' : 's'} — import:</div>
                <ul>{missingSamples.map(n => <li key={n} title={n}>{n.replace(/\.fcs$/i, '')}</li>)}</ul>
              </div>
            )}
            {files.length === 0 ? (
              missingSamples.length === 0 && <div className="panel-empty">No samples loaded</div>
            ) : (
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={f.name} className={i === activeFileIdx ? 'active' : ''} onClick={() => setActiveFileIdx(i)} title={f.name}>
                    <span className="file-dot" style={{ '--dot': sampleColor(i) }} />
                    <span className="file-name">{stripExt(f.name)}</span>
                    <span className="file-count">{f.parsed.totalEvents.toLocaleString()}</span>
                    <button className="icon-btn danger file-remove" title="Remove sample"
                      onClick={(e) => { e.stopPropagation(); removeSample(i); }}>
                      <Icon name="close" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {busy && <div className="panel-empty busy-line"><span className="spinner" /> Reading files…</div>}
          </div>

          <div className="panel panel-grow">
            <div className="panel-head">
              <Icon name="gate" size={14} />
              <span>Gating hierarchy</span>
              <span className="count-pill">{gates.length}</span>
            </div>
            {parsed && (
              <div
                className={activeGateId ? 'gate-root' : 'gate-root active'}
                onClick={() => setActiveGateId(null)}
              >
                <span className="gate-root-name">All events</span>
                {!statsGate && <StatsMarker />}
                <span className="file-count">{parsed.totalEvents.toLocaleString()}</span>
              </div>
            )}
            {gates.length === 0 ? (
              <div className="panel-empty">
                {parsed ? 'Choose a gate tool in the toolbar and draw on a plot.' : 'Import samples to start gating.'}
              </div>
            ) : (
              <ul className="gate-list gate-tree">
                {rootGates.map(g => (
                  <GateNode
                    key={g.id}
                    gate={g}
                    gates={gates}
                    gateMasks={gateMasks}
                    parsed={parsed}
                    activeGateId={activeGateId}
                    statsGateId={statsGate?.id}
                    onActivate={setActiveGateId}
                    onRename={renameGate}
                    onDelete={deleteGate}
                    gateLabel={gateLabel}
                    depth={1}
                  />
                ))}
              </ul>
            )}
            {parsed && gates.length > 0 && (
              <div className="panel-foot">Drawing on a gated plot creates a child gate.</div>
            )}
          </div>
        </aside>

      <main className="main">
        {!parsed && (
          <div className="empty">
            <div className="empty-hero">
              <SchmoLogo size={92} />
              <h1>Flo<span>Schmo</span></h1>
              <p className="empty-sub">flow analysis for any Jo Schmo</p>
            </div>
            <div className="empty-actions">
              <label className="btn btn-primary btn-lg">
                <Icon name="upload" size={17} /> Import FCS files
                <input type="file" accept=".fcs" multiple onChange={handleUpload} style={{ display: 'none' }} />
              </label>
              <button className="btn btn-secondary btn-lg" onClick={loadDemo}>
                <Icon name="sparkle" size={17} /> Try the demo data
              </button>
              <label className="btn btn-secondary btn-lg">
                <Icon name="folder" size={17} /> Open workspace
                <input type="file" accept=".json,application/json" onChange={openWorkspace} style={{ display: 'none' }} />
              </label>
            </div>
            <p className="drop-hint"><Icon name="drop" size={14} /> or drop <b>.fcs</b> files anywhere on this window</p>
            {savedSession && !gates.length && !plots.length && (
              <button className="restore-card" onClick={() => applyWorkspace(savedSession)}>
                <Icon name="history" size={18} />
                <span>
                  <b>Restore last session</b>
                  <span className="muted">
                    {(savedSession.gates || []).length} gates · {(savedSession.plots || []).length} plots · {(savedSession.samples || []).length} samples
                    {savedSession.savedAt && ` · ${new Date(savedSession.savedAt).toLocaleString()}`}
                  </span>
                </span>
              </button>
            )}
            {expectedSamples.length > 0 && (
              <p className="muted">Workspace loaded — now import its FCS files ({expectedSamples.length}).</p>
            )}
            <div className="feature-grid">
              {[
                ['gate', 'Gate like you mean it', 'Rectangle, polygon, quadrant and range gates in a nested hierarchy, applied to every sample.'],
                ['scatter', 'Plots worth looking at', 'Pseudocolor density, contours, smoothed histograms and stacked overlays, on linear, log or biexp axes.'],
                ['table', 'Numbers and figures out', 'Per-sample statistics as CSV, and lettered multi-panel figures as editable SVG.'],
                ['lock', 'Private by design', 'Everything runs in your browser. Your FCS files never leave this computer.'],
              ].map(([icon, title, text]) => (
                <div key={title} className="feature-card">
                  <span className="feature-icon"><Icon name={icon} size={17} /></span>
                  <b>{title}</b>
                  <span>{text}</span>
                </div>
              ))}
            </div>
            <p className="muted">Reads FCS 3.0 / 3.1 · float, double and integer data · v{APP_VERSION}</p>
          </div>
        )}
        {parsed && (
          <>
            <div className="workspace-head">
              <div>
                <div className="workspace-title">{activeFile.name.replace(/\.fcs$/i, '')}</div>
                <div className="workspace-sub">
                  {parsed.totalEvents.toLocaleString()} events · {parsed.params.length} parameters · {plots.length} plot{plots.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="view-tabs" role="tablist">
                <button role="tab" aria-selected={view === 'analysis'} className={view === 'analysis' ? 'vtab active' : 'vtab'} onClick={() => setView('analysis')}>
                  <Icon name="scatter" size={14} /> Analysis
                </button>
                <button role="tab" aria-selected={view === 'samples'} className={view === 'samples' ? 'vtab active' : 'vtab'} onClick={() => setView('samples')}>
                  <Icon name="table" size={14} /> Sample table <span className="count-pill">{files.length}</span>
                </button>
              </div>
            </div>

            {view === 'samples' && (
              <SampleTable files={effFiles} gates={gates} activeFileIdx={activeFileIdx}
                onSelectFile={(i) => { setActiveFileIdx(i); }} />
            )}

            {view === 'analysis' && <>
            <div className="analysis-bar">
              <div className="tool-hint"><Icon name={drawTool} size={14} /> {toolHints[drawTool]}</div>
              {plots.length > 0 && (
                <div className="analysis-actions">
                <div className="size-picker" role="radiogroup" aria-label="Plot size" title="Plot size">
                  {['S', 'M', 'L'].map(s => (
                    <button key={s} role="radio" aria-checked={plotSize === s}
                      className={plotSize === s ? 'active' : ''} onClick={() => setPlotSize(s)}>{s}</button>
                  ))}
                </div>
                <div className="figure-export" title="Export every plot as one figure panel">
                  <Icon name="layout" size={14} />
                  <span>Figure</span>
                  <select value={figCols} onChange={e => setFigCols(+e.target.value)} title="Columns">
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} col{n > 1 ? 's' : ''}</option>)}
                  </select>
                  <button className="btn btn-secondary btn-sm" onClick={() => exportWholeFigure('svg')}>
                    <Icon name="download" size={13} /> SVG
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => exportWholeFigure('png')}>
                    <Icon name="image" size={13} /> PNG
                  </button>
                </div>
                </div>
              )}
            </div>

            <StatsPanel
              parsed={parsed}
              source={statsSourceShown}
              onSourceChange={setStatsSource}
              gate={statsGate}
              mask={statsMask}
              gates={gates}
              selectedGateName={activeGate?.name}
              parentName={statsGate?.parentId ? gates.find(g => g.id === statsGate.parentId)?.name : null}
              pctOfParent={statsGate ? gatePct[statsGate.id] : null}
              sampleCount={files.length}
              onExportCsv={exportStatsCsv}
            />

            <div className="plots-row" style={{ '--plot-min': `${PLOT_MIN[plotSize]}px` }}>
              {plots.map((plot) => (
                <PlotCard
                  key={plot.id}
                  plot={plot}
                  parsed={parsed}
                  files={effFiles}
                  cofactor={cofactor}
                  gates={gates}
                  gateMasks={gateMasks}
                  gatePct={gatePct}
                  activeGateId={activeGateId}
                  drawTool={drawTool}
                  onUpdate={(patch) => updatePlot(plot.id, patch)}
                  onRemove={() => removePlot(plot.id)}
                  onDuplicate={() => duplicatePlot(plot.id)}
                  onGatesChange={setGatesNamed}
                  onActiveGateChange={setActiveGateId}
                  onExportSVG={(filename) => exportSVG(plot.id, filename)}
                  onExportPNG={(filename) => exportPNG(plot.id, filename)}
                />
              ))}
              {plots.length === 0 && (
                <div className="plots-empty">
                  <Icon name="plus" size={20} />
                  <div>No plots yet — add a scatter or histogram from the toolbar.</div>
                </div>
              )}
            </div>
            </>}
          </>
        )}
      </main>
      </div>

      {/* ---------- Status bar ---------- */}
      <footer className="statusbar">
        <span className="status-item status-private" title="FCS files are read locally and never uploaded">
          <Icon name="lock" size={12} /> Local only · your data never leaves this computer
        </span>
        {parsed && (
          <>
            <span className="status-item">{stripExt(activeFile.name)}</span>
            <span className="status-item">
              {activeGate
                ? <>{activeGate.name}: <b>{countMask(activeMask).toLocaleString()}</b> of {parsed.totalEvents.toLocaleString()} events</>
                : <><b>{parsed.totalEvents.toLocaleString()}</b> events</>}
            </span>
            <span className="status-item">Compensation {compensation?.enabled ? 'on' : 'off'}</span>
          </>
        )}
        <span className="status-spacer" />
        <button className="status-link" onClick={() => setShowHelp(true)}><Icon name="keyboard" size={12} /> Shortcuts</button>
        <span className="status-item">FloSchmo v{APP_VERSION}</span>
      </footer>

      {showComp && files.length > 0 && (
        <CompensationDialog
          files={files}
          compensation={compensation}
          onChange={setCompensation}
          onClose={() => setShowComp(false)}
        />
      )}

      {showHelp && <HelpDialog version={APP_VERSION} onClose={() => setShowHelp(false)} />}

      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Icon name="drop" size={34} />
            <b>Drop to import</b>
            <span>.fcs samples or a .floschmo.json workspace</span>
          </div>
        </div>
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon name={t.type === 'error' ? 'alert' : t.type === 'success' ? 'check' : 'help'} size={15} />
            <span>{t.msg}</span>
            <button className="icon-btn" onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))} aria-label="Dismiss">
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Small badge marking the population the statistics panel is reading from.
function StatsMarker() {
  return (
    <span className="stats-marker" title="The statistics panel is showing this population">
      <Icon name="table" size={11} strokeWidth={2} />
    </span>
  );
}

function GateNode({ gate, gates, gateMasks, parsed, activeGateId, statsGateId, onActivate, onRename, onDelete, gateLabel, depth }) {
  const children = gates.filter(g => g.parentId === gate.id);
  const mask = gateMasks[gate.id];
  const count = mask ? countMask(mask) : 0;
  const parent = gate.parentId ? gates.find(g => g.id === gate.parentId) : null;
  const parentMask = parent ? gateMasks[parent.id] : null;
  const total = parsed?.totalEvents ?? 0;
  const parentCount = parentMask ? countMask(parentMask) : total;
  const hasData = !!parsed;
  const pctOfParent = parentCount > 0 ? (count / parentCount * 100).toFixed(2) : '0';
  const pctOfTotal = total > 0 ? (count / total * 100).toFixed(2) : '0';

  return (
    <>
      <li
        className={gate.id === activeGateId ? 'gate-item active' : 'gate-item'}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onActivate(gate.id)}
        title={`${gateLabel(gate)} · ${pctOfTotal}% of total`}
      >
        <div className="gate-row">
          <span className={`gate-type gate-type-${gate.type}`}>
            <Icon name={{ rect: 'rect', polygon: 'polygon', quad: 'quad' }[gate.type] || 'linear'} size={12} strokeWidth={2} />
          </span>
          <input
            className="gate-name"
            value={gate.name}
            onChange={e => onRename(gate.id, e.target.value)}
          />
          {gate.id === statsGateId && <StatsMarker />}
          <span className="gate-pct">{hasData ? `${pctOfParent}%` : '—'}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(gate.id); }}
            className="icon-btn danger"
            title="Delete gate (and children)"
          ><Icon name="close" size={13} /></button>
        </div>
        <div className="gate-meta">
          <span>{hasData ? `${count.toLocaleString()} events` : 'awaiting data'}</span>
          <span className="gate-bar"><span style={{ width: `${Math.min(100, +pctOfParent)}%` }} /></span>
        </div>
      </li>
      {children.map(c => (
        <GateNode
          key={c.id}
          gate={c}
          gates={gates}
          gateMasks={gateMasks}
          parsed={parsed}
          activeGateId={activeGateId}
          statsGateId={statsGateId}
          onActivate={onActivate}
          onRename={onRename}
          onDelete={onDelete}
          gateLabel={gateLabel}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function ScaleSelect({ value, onChange }) {
  return (
    <select value={value === 'asinh' ? 'biexp' : value} onChange={e => onChange(e.target.value)} title="Axis scale">
      <option value="linear">linear</option>
      <option value="log">log</option>
      <option value="biexp">biexp</option>
    </select>
  );
}

// Min / max boxes for one axis. Each change reports BOTH limits, so editing
// one never disturbs the other. A limit the scale can't use (e.g. 0 on a log
// axis) is flagged and ignored by the plot until it is corrected.
function AxisLimits({ label, min, max, scale, onChange }) {
  const problem = axisLimitProblem(scale, min, max);
  const isLog = scale === 'log';
  const outOfOrder = Number.isFinite(min) && Number.isFinite(max) && max <= min;
  const minBad = outOfOrder || (isLog && Number.isFinite(min) && min <= 0);
  const maxBad = outOfOrder || (isLog && Number.isFinite(max) && max <= 0);
  return (
    <span className="axis-limits">
      <span className="axis-label">{label}:</span>
      <NumberField placeholder="auto" value={min} invalid={minBad} title={minBad ? problem : `${label} axis minimum`}
        aria-label={`${label} axis minimum`} onChange={v => onChange({ min: v, max })} />
      <span className="axis-sep">–</span>
      <NumberField placeholder="auto" value={max} invalid={maxBad} title={maxBad ? problem : `${label} axis maximum`}
        aria-label={`${label} axis maximum`} onChange={v => onChange({ min, max: v })} />
      <button onClick={() => onChange({ min: undefined, max: undefined })} title="Reset to auto" className="icon-btn"><Icon name="reset" size={12} /></button>
      {problem && <span className="axis-problem" role="alert"><Icon name="alert" size={12} /> {problem}</span>}
    </span>
  );
}

function PlotCard({
  plot, parsed, files, cofactor, gates, gateMasks, gatePct, activeGateId, drawTool,
  onUpdate, onRemove, onDuplicate, onGatesChange, onActiveGateChange, onExportSVG, onExportPNG,
}) {
  const mask = plot.gateId ? gateMasks[plot.gateId] : null;
  const gateOptions = (
    <select value={plot.gateId || ''} onChange={e => onUpdate({ gateId: e.target.value || null })} title="Filter by gate">
      <option value="">no gate</option>
      {gates.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  );

  const baseFilename = `${plot.kind}-${plot.id}`;

  const kindLabel = plot.kind === 'scatter' ? 'Scatter'
    : plot.kind === 'histogram' ? 'Histogram'
    : 'Stacked histogram';

  const stackedGate = plot.kind === 'stacked-histogram' && plot.gateId
    ? gates.find(g => g.id === plot.gateId)
    : null;

  const title = plot.kind === 'scatter'
    ? `${parsed.params[plot.xParam]?.name} vs ${parsed.params[plot.yParam]?.name}`
    : plot.kind === 'histogram'
      ? parsed.params[plot.paramIndex]?.name
      : `${plot.paramName} · ${files.length} samples`;
  const gateName = plot.gateId ? gates.find(g => g.id === plot.gateId)?.name : null;
  const kindIcon = plot.kind === 'scatter' ? 'scatter' : plot.kind === 'histogram' ? 'histogram' : 'stacked';

  return (
    <div className={`plot-wrap plot-${plot.kind}`} data-plot-id={plot.id}>
      <div className="plot-titlebar">
        <span className="plot-kind-icon"><Icon name={kindIcon} size={15} /></span>
        <div className="plot-title">
          <span className="plot-title-main">{title}</span>
          <span className="plot-title-sub">{kindLabel}{gateName ? <> · gated on <b>{gateName}</b></> : ' · all events'}</span>
        </div>
        <div className="plot-actions">
          <button onClick={() => onExportSVG(`${baseFilename}.svg`)} title="Export SVG" className="icon-btn"><Icon name="download" size={14} /><span>SVG</span></button>
          <button onClick={() => onExportPNG(`${baseFilename}.png`)} title="Export PNG" className="icon-btn"><Icon name="image" size={14} /><span>PNG</span></button>
          <button onClick={onDuplicate} className="icon-btn" title="Duplicate plot"><Icon name="copy" size={14} /></button>
          <button onClick={onRemove} className="icon-btn danger" title="Remove plot"><Icon name="close" size={14} /></button>
        </div>
      </div>
      <div className="plot-header">
        <div className="param-controls">
          {plot.kind === 'scatter' && (
            <>
              <select value={plot.xParam} onChange={e => onUpdate({ xParam: +e.target.value })}>
                {parsed.params.map((p, i) => <option key={i} value={i}>X: {p.name}</option>)}
              </select>
              <ScaleSelect value={plot.xScale} onChange={v => onUpdate({ xScale: v })} />
              <select value={plot.yParam} onChange={e => onUpdate({ yParam: +e.target.value })}>
                {parsed.params.map((p, i) => <option key={i} value={i}>Y: {p.name}</option>)}
              </select>
              <ScaleSelect value={plot.yScale} onChange={v => onUpdate({ yScale: v })} />
              <select value={plot.display || 'density'} onChange={e => onUpdate({ display: e.target.value })} title="Display mode">
                <option value="density">pseudocolor</option>
                <option value="contour">contour</option>
                <option value="dots">dots</option>
              </select>
              {gateOptions}
            </>
          )}
          {plot.kind === 'histogram' && (
            <>
              <select value={plot.paramIndex} onChange={e => onUpdate({ paramIndex: +e.target.value })}>
                {parsed.params.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
              </select>
              <ScaleSelect value={plot.scale} onChange={v => onUpdate({ scale: v })} />
              {gateOptions}
            </>
          )}
          {plot.kind === 'stacked-histogram' && (
            <>
              <select value={plot.paramName} onChange={e => onUpdate({ paramName: e.target.value })}>
                {parsed.params.map((p, i) => <option key={i} value={p.name}>{p.name}</option>)}
              </select>
              <ScaleSelect value={plot.scale} onChange={v => onUpdate({ scale: v })} />
              <select value={plot.normalize} onChange={e => onUpdate({ normalize: e.target.value })} title="Normalization">
                <option value="modal">modal</option>
                <option value="area">area</option>
                <option value="counts">counts</option>
              </select>
              {gateOptions}
            </>
          )}
        </div>
      </div>

      <div className="plot-axes">
        <Icon name="sliders" size={13} className="axes-icon" />
        <AxisLimits label="X" min={plot.xMin} max={plot.xMax}
          scale={plot.kind === 'scatter' ? plot.xScale : plot.scale}
          onChange={patch => onUpdate({ xMin: patch.min, xMax: patch.max })} />
        {plot.kind === 'scatter' && (
          <AxisLimits label="Y" min={plot.yMin} max={plot.yMax} scale={plot.yScale}
            onChange={patch => onUpdate({ yMin: patch.min, yMax: patch.max })} />
        )}
      </div>

      {plot.kind === 'scatter' && (
        <ScatterPlot
          plotId={plot.id}
          parsed={parsed}
          xParam={plot.xParam}
          yParam={plot.yParam}
          xScale={plot.xScale}
          yScale={plot.yScale}
          xMin={plot.xMin} xMax={plot.xMax}
          yMin={plot.yMin} yMax={plot.yMax}
          cofactor={cofactor}
          mask={mask}
          displayMode={plot.display || 'density'}
          parentGateId={plot.gateId}
          gatePct={gatePct}
          gates={gates}
          activeGateId={activeGateId}
          onGatesChange={onGatesChange}
          onActiveGateChange={onActiveGateChange}
          drawTool={drawTool}
        />
      )}
      {plot.kind === 'histogram' && (
        <Histogram
          parsed={parsed}
          paramIndex={plot.paramIndex}
          scale={plot.scale}
          xMin={plot.xMin} xMax={plot.xMax}
          cofactor={cofactor}
          mask={mask}
          parentGateId={plot.gateId}
          gatePct={gatePct}
          drawTool={drawTool}
          gates={gates}
          activeGateId={activeGateId}
          onGatesChange={onGatesChange}
          onActiveGateChange={onActiveGateChange}
        />
      )}
      {plot.kind === 'stacked-histogram' && (
        <StackedHistogram
          files={files}
          paramName={plot.paramName}
          scale={plot.scale}
          xMin={plot.xMin} xMax={plot.xMax}
          cofactor={cofactor}
          normalize={plot.normalize}
          gate={stackedGate}
        />
      )}
    </div>
  );
}

// Statistics for one population: "All events" or a gate. The population is
// chosen in the panel's own header and stays put while gates are drawn,
// selected or edited (unless "follow" mode is picked).
//   source: 'all' | 'follow' | <gate id>      gate / mask: the resolved population
function StatsPanel({
  parsed, source, onSourceChange, gate, mask, gates, selectedGateName,
  parentName, pctOfParent, sampleCount, onExportCsv,
}) {
  const total = parsed.totalEvents;
  const n = useMemo(() => (mask ? countMask(mask) : total), [mask, total]);
  const empty = n === 0;

  const stats = useMemo(() => {
    if (empty) return [];
    return parsed.params.map((p, i) => ({
      param: p.name,
      stain: p.stain,
      stats: computeStats(parsed, i, mask),
    }));
  }, [parsed, mask, empty]);

  const tree = useMemo(() => flattenGateTree(gates), [gates]);
  const pctTotal = total > 0 ? (n / total * 100).toFixed(2) : '0';
  const [open, setOpen] = useState(true);

  return (
    <div className={open ? 'stats-panel' : 'stats-panel collapsed'}>
      <div className="stats-header">
        <button className="stats-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
          title={open ? 'Hide the statistics table' : 'Show the statistics table'}>
          <Icon name="chevron" size={14} className="chev" />
          <Icon name="table" size={15} />
          <strong>Statistics</strong>
        </button>
        <label className="stats-pop" title="Choose which population the statistics describe">
          <span>for</span>
          <select value={source} onChange={e => onSourceChange(e.target.value)} aria-label="Statistics population">
            <option value="all">All events</option>
            {tree.map(({ gate: g, depth }) => (
              <option key={g.id} value={g.id}>{' '.repeat(depth)}{depth > 0 ? '↳ ' : ''}{g.name}</option>
            ))}
            <option disabled>────────────</option>
            <option value="follow">Whichever gate is selected</option>
          </select>
          {source === 'follow' && (
            <span className="stats-follow">→ {selectedGateName || 'none selected, so all events'}</span>
          )}
        </label>
        <span className="stats-kpis">
          <span><b>{n.toLocaleString()}</b> events</span>
          {gate && parentName && Number.isFinite(pctOfParent) && (
            <span><b>{pctOfParent.toFixed(2)}%</b> of {parentName}</span>
          )}
          <span><b>{pctTotal}%</b> of total</span>
        </span>
        <span className="stats-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onExportCsv('sample')}
            title="Download this table as a CSV file (this sample)">
            <Icon name="download" size={13} /> CSV
          </button>
          {sampleCount > 1 && (
            <button className="btn btn-secondary btn-sm" onClick={() => onExportCsv('all')}
              title={`Download the same statistics for all ${sampleCount} samples in one CSV file`}>
              <Icon name="download" size={13} /> CSV · all {sampleCount} samples
            </button>
          )}
        </span>
      </div>

      {open && empty && (
        <div className="stats-empty" role="status">
          <span className="stats-empty-icon"><Icon name="alert" size={17} /></span>
          <div>
            <b>{gate ? `No events fall inside “${gate.name}” in this sample.` : 'This sample contains no events.'}</b>
            {gate && (
              <span>
                There is nothing to summarise, so no statistics are shown. That is normal for an empty gate, for
                example the double-positive quadrant of a single-colour control. Pick another population above.
              </span>
            )}
          </div>
          {gate && (
            <button className="btn btn-secondary" onClick={() => onSourceChange('all')}>Show all events</button>
          )}
        </div>
      )}

      {open && !empty && <div className="stats-scroll"><table className="stats-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Mean</th>
            <th>Geo mean</th>
            <th>Median</th>
            <th>SD</th>
            <th>CV %</th>
            <th>rCV %</th>
            <th>Min</th>
            <th>Max</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr key={i}>
              <td>{s.param}{s.stain && <span className="muted"> ({s.stain})</span>}</td>
              {s.stats ? (
                <>
                  <td>{fmt(s.stats.mean)}</td>
                  <td>{fmt(s.stats.geoMean)}</td>
                  <td>{fmt(s.stats.median)}</td>
                  <td>{fmt(s.stats.sd)}</td>
                  <td>{fmt(s.stats.cv)}</td>
                  <td>{fmt(s.stats.rcv)}</td>
                  <td>{fmt(s.stats.min)}</td>
                  <td>{fmt(s.stats.max)}</td>
                </>
              ) : (
                <td colSpan="8" className="muted">no events</td>
              )}
            </tr>
          ))}
        </tbody>
      </table></div>}
    </div>
  );
}

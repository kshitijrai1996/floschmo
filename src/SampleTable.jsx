import { useMemo, useState } from 'react';
import { computeCombinedMasks, countMask, computeStats, fmt, flattenGateTree } from './gateUtils';
import Icon from './Icons';
import { downloadCsv } from './exportUtils';

const STATS = [
  ['geoMean', 'Geo mean'],
  ['median', 'Median'],
  ['mean', 'Mean'],
  ['cv', 'CV %'],
  ['rcv', 'rCV %'],
];

export default function SampleTable({ files, gates, activeFileIdx, onSelectFile }) {
  const paramNames = useMemo(() => {
    const first = files[0]?.parsed.params.map(p => p.name) || [];
    return first.filter(n => files.every(f => f.parsed.params.some(p => p.name === n)));
  }, [files]);

  const defaultParam = paramNames.find(n => /GFP/i.test(n)) || paramNames[0] || '';
  const [paramName, setParamName] = useState(defaultParam);
  const [stat, setStat] = useState('geoMean');
  const param = paramNames.includes(paramName) ? paramName : defaultParam;
  const statLabel = STATS.find(s => s[0] === stat)[1];

  const ordered = useMemo(() => flattenGateTree(gates), [gates]);

  const rows = useMemo(() => files.map(f => {
    const parsed = f.parsed;
    const pIdx = parsed.params.findIndex(p => p.name === param);
    const masks = computeCombinedMasks(parsed, gates);
    const counts = Object.fromEntries(gates.map(g => [g.id, countMask(masks[g.id])]));
    const total = parsed.totalEvents;
    const allStat = pIdx >= 0 ? computeStats(parsed, pIdx, null)?.[stat] : NaN;
    const cells = ordered.map(({ gate }) => {
      const n = counts[gate.id];
      const parentN = gate.parentId && counts[gate.parentId] !== undefined ? counts[gate.parentId] : total;
      const s = pIdx >= 0 && n > 0 ? computeStats(parsed, pIdx, masks[gate.id])?.[stat] : NaN;
      return { n, pct: parentN > 0 ? (n / parentN) * 100 : NaN, stat: s };
    });
    return { name: f.name.replace(/\.fcs$/i, ''), total, allStat, cells };
  }), [files, gates, ordered, param, stat]);

  const exportCSV = () => {
    const num = (v, d) => Number.isFinite(v) ? v.toFixed(d) : '';
    const header = ['Sample', 'Total events', `All events ${statLabel} ${param}`];
    ordered.forEach(({ gate }) => {
      header.push(`${gate.name} % of parent`, `${gate.name} count`, `${gate.name} ${statLabel} ${param}`);
    });
    const table = [header];
    rows.forEach(r => {
      const vals = [r.name, r.total, num(r.allStat, 3)];
      r.cells.forEach(c => vals.push(num(c.pct, 2), c.n, num(c.stat, 3)));
      table.push(vals);
    });
    downloadCsv(table, `floschmo-samples-${param}-${stat}.csv`);
  };

  return (
    <div className="sample-table-panel">
      <div className="st-toolbar">
        <div className="st-title">
          <Icon name="table" size={15} />
          <strong>Sample table</strong>
          <span className="muted">{files.length} samples · {gates.length} gates · gating tree applied to every sample</span>
        </div>
        <div className="st-controls">
          <label>Statistic
            <select value={stat} onChange={e => setStat(e.target.value)}>
              {STATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>of
            <select value={param} onChange={e => setParamName(e.target.value)}>
              {paramNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn btn-secondary" onClick={exportCSV}><Icon name="download" size={14} /> Export CSV</button>
        </div>
      </div>

      <div className="st-scroll">
        <table className="st-table">
          <thead>
            <tr>
              <th rowSpan="2" className="st-sticky">Sample</th>
              <th rowSpan="2">Events</th>
              <th rowSpan="2" className="st-group-end">{statLabel}<div className="st-sub">all events</div></th>
              {ordered.map(({ gate, depth }) => (
                <th key={gate.id} colSpan="3" className="st-group st-group-end">
                  <span className="st-gate-name" style={{ paddingLeft: depth * 10 }}>
                    {depth > 0 && <span className="st-branch">↳ </span>}{gate.name}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {ordered.map(({ gate }) => [
                <th key={gate.id + 'p'} className="st-subhead">% parent</th>,
                <th key={gate.id + 'n'} className="st-subhead">Count</th>,
                <th key={gate.id + 's'} className="st-subhead st-group-end">{statLabel}</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === activeFileIdx ? 'active' : ''} onClick={() => onSelectFile(i)}>
                <td className="st-sticky st-name" title={r.name}>{r.name}</td>
                <td>{r.total.toLocaleString()}</td>
                <td className="st-group-end">{fmt(r.allStat)}</td>
                {r.cells.map((c, j) => [
                  <td key={j + 'p'} className="st-pct">
                    <span className="st-pct-bar" style={{ width: `${Number.isFinite(c.pct) ? Math.min(100, c.pct) : 0}%` }} />
                    <span className="st-pct-val">{Number.isFinite(c.pct) ? c.pct.toFixed(2) : '—'}</span>
                  </td>,
                  <td key={j + 'n'}>{c.n.toLocaleString()}</td>,
                  <td key={j + 's'} className="st-group-end">{fmt(c.stat)}</td>,
                ])}
              </tr>
            ))}
          </tbody>
        </table>
        {gates.length === 0 && (
          <div className="st-empty">Draw gates on any sample — they'll be applied to every sample here.</div>
        )}
      </div>
    </div>
  );
}

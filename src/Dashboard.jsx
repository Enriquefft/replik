// SCREEN — Dashboard (Ads Manager: Campañas · Conjuntos · Anuncios)
// Foco: monitoreo en vivo de las campañas que Replik está corriendo en Meta.

const Dashboard = ({ onAddProduct, onSelectProduct }) => {
  const m = MODE.live;
  const [tab, setTab] = React.useState('campaigns'); // campaigns | adsets | ads
  const [dateRange, setDateRange] = React.useState('7d');
  const [selected, setSelected] = React.useState({ campaigns: new Set(), adsets: new Set(), ads: new Set() });

  // Meta-style hierarchy: campaign > adset > ad
  // Following Marketing API field names where it makes sense (status, objective, optimization_goal, bid_strategy, daily_budget, etc.)
  const campaigns = [
    { id: 'c_001', name: 'Hidra · Demo+Pain · CBO',     product: 'Botella térmica 750 ml',    objective: 'OUTCOME_SALES',  status: 'ACTIVE',  bid: 'LOWEST_COST',  budget: 120, budgetType: 'CBO', spend: 524.30, results: 24, cpa: 21.84, reach: 18420, impr: 28104, roas: 3.10, ctr: 1.82, freq: 1.53, structure: 'CBO', winner: true },
    { id: 'c_002', name: 'Hidra · Lifestyle · ABO',     product: 'Botella térmica 750 ml',    objective: 'OUTCOME_SALES',  status: 'ACTIVE',  bid: 'COST_CAP',     budget: 90,  budgetType: 'ABO', spend: 343.10, results: 14, cpa: 24.51, reach: 12805, impr: 19460, roas: 2.40, ctr: 1.41, freq: 1.52, structure: 'ABO' },
    { id: 'c_003', name: 'Lámpara LED · CBO',           product: 'Lámpara LED táctil',         objective: 'OUTCOME_SALES',  status: 'ACTIVE',  bid: 'LOWEST_COST',  budget: 80,  budgetType: 'CBO', spend: 437.20, results: 14, cpa: 31.23, reach: 14210, impr: 22188, roas: 1.80, ctr: 1.05, freq: 1.56, structure: 'CBO' },
    { id: 'c_004', name: 'Organizador 6×1 · ABO',       product: 'Organizador de cocina 6×1', objective: 'OUTCOME_SALES',  status: 'ACTIVE',  bid: 'LOWEST_COST',  budget: 60,  budgetType: 'ABO', spend: 257.40, results: 9,  cpa: 28.60, reach: 9805,  impr: 14104, roas: 2.00, ctr: 1.34, freq: 1.44, structure: 'ABO' },
    { id: 'c_005', name: 'Auriculares BT · CBO',         product: 'Auriculares bluetooth Pro',  objective: 'OUTCOME_SALES',  status: 'PAUSED',  bid: 'LOWEST_COST',  budget: 70,  budgetType: 'CBO', spend: 192.40, results: 4,  cpa: 48.10, reach: 7220,  impr: 11280, roas: 0.80, ctr: 0.70, freq: 1.56, structure: 'CBO' },
  ];

  // Adsets — child of campaigns. Optimization goal, audience, placement, schedule.
  const adsets = [
    { id: 'as_001', campaign: 'c_001', name: 'Hidra · Lima 24-45 · Reels+Feed',         optGoal: 'OFFSITE_CONVERSIONS', billing: 'IMPRESSIONS', placement: 'Automático', audience: 'Lima · 24–45 · M+F · Lookalike 1%', spend: 524.30, results: 24, cpa: 21.84, reach: 18420, impr: 28104, ctr: 1.82, status: 'ACTIVE' },
    { id: 'as_002', campaign: 'c_002', name: 'Hidra Lifestyle · Lima fitness',           optGoal: 'OFFSITE_CONVERSIONS', billing: 'IMPRESSIONS', placement: 'Automático', audience: 'Lima · 22–38 · M+F · Intereses fitness', spend: 343.10, results: 14, cpa: 24.51, reach: 12805, impr: 19460, ctr: 1.41, status: 'ACTIVE' },
    { id: 'as_003', campaign: 'c_003', name: 'LED · Lima decoración',                     optGoal: 'OFFSITE_CONVERSIONS', billing: 'IMPRESSIONS', placement: 'Reels+Feed', audience: 'Lima · 25–55 · F · Hogar/Decoración',     spend: 437.20, results: 14, cpa: 31.23, reach: 14210, impr: 22188, ctr: 1.05, status: 'ACTIVE' },
    { id: 'as_004', campaign: 'c_004', name: 'Organizador · Mamás 28-50',                optGoal: 'OFFSITE_CONVERSIONS', billing: 'IMPRESSIONS', placement: 'Automático', audience: 'Lima+Callao · 28–50 · F',                  spend: 257.40, results: 9,  cpa: 28.60, reach: 9805,  impr: 14104, ctr: 1.34, status: 'ACTIVE' },
    { id: 'as_005', campaign: 'c_005', name: 'BT · Tech males',                            optGoal: 'OFFSITE_CONVERSIONS', billing: 'IMPRESSIONS', placement: 'Automático', audience: 'Lima · 18–35 · M · Tech',                  spend: 192.40, results: 4,  cpa: 48.10, reach: 7220,  impr: 11280, ctr: 0.70, status: 'PAUSED' },
  ];

  // Ads — child of adsets. Real ad creatives.
  const ads = [
    { id: 'ad_001', adset: 'as_001', name: 'Hidra · Demo 12hrs · Reel',           angle: 'demo',      preview: 'linear-gradient(135deg,#bfdbfe,#ddd6fe)', spend: 224.10, results: 12, cpa: 18.68, impr: 12400, ctr: 2.10, status: 'ACTIVE',   winner: true },
    { id: 'ad_002', adset: 'as_001', name: 'Hidra · Pain agua tibia · UGC',       angle: 'pain',      preview: 'linear-gradient(135deg,#fee2e2,#fde68a)', spend: 198.50, results: 9,  cpa: 22.06, impr: 10220, ctr: 1.74, status: 'ACTIVE' },
    { id: 'ad_003', adset: 'as_001', name: 'Hidra · Pack 3 oferta',                 angle: 'offer',     preview: 'linear-gradient(135deg,#fef3c7,#a7f3d0)', spend: 101.70, results: 3,  cpa: 33.90, impr: 5484,  ctr: 1.20, status: 'ACTIVE' },
    { id: 'ad_004', adset: 'as_002', name: 'Hidra · Lifestyle gym',                 angle: 'lifestyle', preview: 'linear-gradient(135deg,#fef3c7,#a7f3d0)', spend: 343.10, results: 14, cpa: 24.51, impr: 19460, ctr: 1.41, status: 'ACTIVE' },
    { id: 'ad_005', adset: 'as_003', name: 'LED · Demo táctil',                      angle: 'demo',      preview: 'linear-gradient(135deg,#bfdbfe,#ddd6fe)', spend: 280.10, results: 9,  cpa: 31.12, impr: 14080, ctr: 1.10, status: 'ACTIVE' },
    { id: 'ad_006', adset: 'as_003', name: 'LED · Cuarto teen',                      angle: 'lifestyle', preview: 'linear-gradient(135deg,#fef3c7,#a7f3d0)', spend: 157.10, results: 5,  cpa: 31.42, impr: 8108,  ctr: 0.94, status: 'ACTIVE' },
    { id: 'ad_007', adset: 'as_004', name: 'Organizador · Antes/Después',           angle: 'demo',      preview: 'linear-gradient(135deg,#bfdbfe,#ddd6fe)', spend: 188.30, results: 7,  cpa: 26.90, impr: 10420, ctr: 1.55, status: 'ACTIVE' },
    { id: 'ad_008', adset: 'as_004', name: 'Organizador · UGC mamás',                angle: 'pain',      preview: 'linear-gradient(135deg,#fee2e2,#fde68a)', spend: 69.10,  results: 2,  cpa: 34.55, impr: 3684,  ctr: 1.02, status: 'ACTIVE' },
    { id: 'ad_009', adset: 'as_005', name: 'BT · Demo audio',                          angle: 'demo',      preview: 'linear-gradient(135deg,#bfdbfe,#ddd6fe)', spend: 122.40, results: 3,  cpa: 40.80, impr: 7100,  ctr: 0.78, status: 'PAUSED' },
    { id: 'ad_010', adset: 'as_005', name: 'BT · UGC review',                          angle: 'pain',      preview: 'linear-gradient(135deg,#fee2e2,#fde68a)', spend: 70.00,  results: 1,  cpa: 70.00, impr: 4180,  ctr: 0.62, status: 'PAUSED' },
  ];

  // Aggregate KPIs
  const totals = campaigns.reduce((acc, c) => {
    if (c.status !== 'ACTIVE') return acc;
    acc.spend += c.spend; acc.results += c.results; acc.reach += c.reach; acc.impr += c.impr;
    return acc;
  }, { spend: 0, results: 0, reach: 0, impr: 0 });
  const avgCPA = totals.results ? totals.spend / totals.results : 0;

  const StatusPill = ({ s, structure }) => {
    const map = {
      ACTIVE:  { label: 'Activa',   color: MODE.web.accent, bg: MODE.web.badgeBg, fg: MODE.web.badgeFg },
      PAUSED:  { label: 'Pausada',  color: '#aeaeb2',       bg: 'rgba(0,0,0,0.06)', fg: '#6e6e73' },
      DELETED: { label: 'Eliminada',color: MODE.traffic.accent, bg: MODE.traffic.badgeBg, fg: MODE.traffic.badgeFg },
    };
    const v = map[s] || map.ACTIVE;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 100, background: v.bg, color: v.fg, fontSize: 11, fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: v.color }}/>{v.label}
      </span>
    );
  };

  const StructureChip = ({ s }) => (
    <span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: s === 'CBO' ? MODE.creative.badgeBg : MODE.system.badgeBg, color: s === 'CBO' ? MODE.creative.badgeFg : MODE.system.badgeFg, letterSpacing: 0.4 }}>{s}</span>
  );

  const Tab = ({ id, label, count, icon }) => {
    const active = tab === id;
    return (
      <button onClick={() => setTab(id)} style={{
        height: 38, padding: '0 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: active ? '#fff' : 'transparent',
        color: active ? '#1d1d1f' : '#6e6e73',
        fontWeight: 600, fontSize: 14, fontFamily: 'inherit',
        boxShadow: active ? '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' : 'none',
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}>
        <i data-lucide={icon} style={{ width: 14, height: 14, strokeWidth: 1.6 }}/>
        {label}
        <span style={{ fontSize: 11, fontFamily: '"SF Mono", monospace', padding: '1px 7px', borderRadius: 100, background: active ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.04)' }}>{count}</span>
      </button>
    );
  };

  const RangeBtn = ({ id, label }) => {
    const active = dateRange === id;
    return (
      <button onClick={() => setDateRange(id)} style={{
        height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid ' + (active ? m.accent : 'rgba(0,0,0,0.08)'),
        background: active ? m.badgeBg : '#fff', color: active ? m.badgeFg : '#6e6e73',
        fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
      }}>{label}</button>
    );
  };

  const fmtMoney = (v) => `S/ ${v.toFixed(2)}`;
  const fmtNum = (v) => v.toLocaleString('en-US');

  // Mini sparkline for campaign perf
  const Spark = ({ data, color }) => {
    const max = Math.max(...data), min = Math.min(...data);
    const W = 60, H = 18;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / (max - min || 1)) * H}`).join(' ');
    return <svg width={W} height={H}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  };

  // Header per tab
  const headers = {
    campaigns: ['', 'Campaña', 'Estado', 'Resultados', 'Alcance', 'Impresiones', 'CPA', 'Gastado', 'ROAS', 'Tendencia 7d'],
    adsets:    ['', 'Conjunto de anuncios', 'Estado', 'Audiencia', 'Resultados', 'CPA', 'Alcance', 'CTR', 'Gastado'],
    ads:       ['', 'Anuncio', 'Estado', 'Ángulo', 'Resultados', 'CPA', 'Impresiones', 'CTR', 'Gastado'],
  };

  const cols = {
    campaigns: '32px 2.4fr 110px 100px 100px 110px 100px 110px 80px 80px',
    adsets:    '32px 2.2fr 110px 1.6fr 100px 100px 100px 80px 110px',
    ads:       '32px 2.2fr 110px 110px 100px 100px 110px 80px 110px',
  };

  const Checkbox = ({ checked, onChange }) => (
    <div onClick={(e) => { e.stopPropagation(); onChange(!checked); }} style={{
      width: 18, height: 18, borderRadius: 4, border: checked ? `1.5px solid ${m.accent}` : '1.5px solid rgba(0,0,0,0.20)',
      background: checked ? m.accent : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    }}>{checked && <i data-lucide="check" style={{ width: 12, height: 12, color: '#fff', strokeWidth: 3 }}/>}</div>
  );

  const toggleSel = (kind, id) => {
    const next = new Set(selected[kind]);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected({ ...selected, [kind]: next });
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Eyebrow color={m.badgeFg}>Ads Manager</Eyebrow>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, color: '#1d1d1f', marginTop: 6 }}>Hola, Rodrigo 👋</div>
          <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: m.accent, boxShadow: `0 0 0 4px ${m.glow}` }}/>
            Sincronizado con Meta Business · hace 2m · <span style={{ fontFamily: '"SF Mono", monospace', color: '#1d1d1f' }}>act_2487291…</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginRight: 4 }}>Periodo</span>
          <RangeBtn id="today" label="Hoy"/>
          <RangeBtn id="7d" label="7 días"/>
          <RangeBtn id="30d" label="30 días"/>
          <RangeBtn id="custom" label="Personalizado"/>
          <Button variant="primary" mode="live" icon="plus" onClick={onAddProduct} style={{ height: 36, padding: '0 14px', fontSize: 13, marginLeft: 6 }}>Nuevo test</Button>
        </div>
      </div>

      {/* Aggregate stats — compact, Meta-style */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {[
          { l: 'Importe gastado', v: fmtMoney(totals.spend), d: '4 campañas activas',     color: '#1d1d1f' },
          { l: 'Resultados',       v: fmtNum(totals.results), d: 'Compras (Pixel + CAPI)', color: MODE.web.accent },
          { l: 'CPA promedio',     v: fmtMoney(avgCPA),       d: '↓ S/ 3.10 vs sem. ant.', color: m.accent },
          { l: 'Alcance',           v: fmtNum(totals.reach),   d: `${fmtNum(totals.impr)} impresiones`, color: '#1d1d1f' },
          { l: 'ROAS',              v: '2.7×',                  d: 'Promedio ponderado',     color: MODE.web.accent },
        ].map((s, i) => (
          <GlassCard key={i} padding={16}>
            <Eyebrow>{s.l}</Eyebrow>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4, color: s.color, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
            <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>{s.d}</div>
          </GlassCard>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, padding: 4, background: 'rgba(0,0,0,0.04)', borderRadius: 12, alignSelf: 'flex-start' }}>
        <Tab id="campaigns" label="Campañas"               count={campaigns.length} icon="megaphone"/>
        <Tab id="adsets"    label="Conjuntos de anuncios"   count={adsets.length}    icon="users"/>
        <Tab id="ads"       label="Anuncios"                count={ads.length}       icon="film"/>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontSize: 12, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><i data-lucide="filter" style={{ width: 12, height: 12 }}/>Filtros</button>
          <button style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontSize: 12, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><i data-lucide="layout-list" style={{ width: 12, height: 12 }}/>Columnas</button>
          <button style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontSize: 12, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><i data-lucide="arrow-down-up" style={{ width: 12, height: 12 }}/>Ordenar</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontSize: 12, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><i data-lucide="pause" style={{ width: 12, height: 12 }}/>Pausar</button>
          <button style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontSize: 12, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><i data-lucide="copy" style={{ width: 12, height: 12 }}/>Duplicar</button>
          <button style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontSize: 12, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><i data-lucide="download" style={{ width: 12, height: 12 }}/>Exportar</button>
        </div>
      </div>

      {/* Table */}
      <GlassCard padding={0}>
        {/* header row */}
        <div style={{ display: 'grid', gridTemplateColumns: cols[tab], padding: '12px 18px', fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6e6e73', borderBottom: '1px solid rgba(0,0,0,0.05)', background: 'rgba(0,0,0,0.015)' }}>
          {headers[tab].map((h, i) => <span key={i}>{h}</span>)}
        </div>

        {/* CAMPAIGNS */}
        {tab === 'campaigns' && campaigns.map((c, i) => {
          const sel = selected.campaigns.has(c.id);
          const trend = [3, 5, 4, 6, 5, 7, 6].map(v => v + Math.random()*1.5);
          return (
            <div key={c.id} onClick={() => onSelectProduct && onSelectProduct({ name: c.product }, 'creatives')} style={{
              display: 'grid', gridTemplateColumns: cols.campaigns, padding: '14px 18px', alignItems: 'center',
              borderBottom: i < campaigns.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
              cursor: 'pointer', background: sel ? m.badgeBg : 'transparent',
            }}>
              <Checkbox checked={sel} onChange={() => toggleSel('campaigns', c.id)}/>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {c.winner && <i data-lucide="trophy" style={{ width: 14, height: 14, color: MODE.web.accent, strokeWidth: 1.8, flexShrink: 0 }}/>}
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>{c.name}</span>
                  <StructureChip s={c.structure}/>
                </div>
                <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{c.product}</span>
                  <span style={{ width: 3, height: 3, borderRadius: 2, background: '#aeaeb2' }}/>
                  <span style={{ fontFamily: '"SF Mono", monospace' }}>{c.objective.replace('OUTCOME_', '').toLowerCase()}</span>
                  <span style={{ width: 3, height: 3, borderRadius: 2, background: '#aeaeb2' }}/>
                  <span style={{ fontFamily: '"SF Mono", monospace' }}>{fmtMoney(c.budget)}/día</span>
                </div>
              </div>
              <StatusPill s={c.status}/>
              <span style={{ fontSize: 14, fontFamily: '"SF Mono", monospace', fontWeight: 600, color: '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>{c.results}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(c.reach)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#6e6e73', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(c.impr)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 600, color: c.cpa < 28 ? MODE.web.badgeFg : (c.cpa < 40 ? '#1d1d1f' : MODE.traffic.accent), fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.cpa)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#1d1d1f', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.spend)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: c.roas >= 2 ? MODE.web.accent : (c.roas >= 1.5 ? '#1d1d1f' : MODE.traffic.accent) }}>{c.roas.toFixed(1)}×</span>
              <Spark data={trend} color={c.roas >= 2 ? MODE.web.accent : (c.roas >= 1.5 ? '#aeaeb2' : MODE.traffic.accent)}/>
            </div>
          );
        })}

        {/* ADSETS */}
        {tab === 'adsets' && adsets.map((a, i) => {
          const sel = selected.adsets.has(a.id);
          return (
            <div key={a.id} style={{
              display: 'grid', gridTemplateColumns: cols.adsets, padding: '14px 18px', alignItems: 'center',
              borderBottom: i < adsets.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
              background: sel ? m.badgeBg : 'transparent',
            }}>
              <Checkbox checked={sel} onChange={() => toggleSel('adsets', a.id)}/>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>{a.name}</div>
                <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: '"SF Mono", monospace' }}>{a.optGoal.replace(/_/g,' ').toLowerCase()}</span>
                  <span style={{ width: 3, height: 3, borderRadius: 2, background: '#aeaeb2' }}/>
                  <span>{a.placement}</span>
                </div>
              </div>
              <StatusPill s={a.status}/>
              <span style={{ fontSize: 12, color: '#1d1d1f', lineHeight: 1.4 }}>{a.audience}</span>
              <span style={{ fontSize: 14, fontFamily: '"SF Mono", monospace', fontWeight: 600, color: '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>{a.results}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 600, color: a.cpa < 28 ? MODE.web.badgeFg : (a.cpa < 40 ? '#1d1d1f' : MODE.traffic.accent) }}>{fmtMoney(a.cpa)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(a.reach)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#1d1d1f' }}>{a.ctr.toFixed(2)}%</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#1d1d1f', fontWeight: 600 }}>{fmtMoney(a.spend)}</span>
            </div>
          );
        })}

        {/* ADS */}
        {tab === 'ads' && ads.map((a, i) => {
          const sel = selected.ads.has(a.id);
          const angleColor = { demo: MODE.live.accent, pain: MODE.traffic.accent, lifestyle: MODE.creative.accent, offer: MODE.web.accent };
          return (
            <div key={a.id} style={{
              display: 'grid', gridTemplateColumns: cols.ads, padding: '14px 18px', alignItems: 'center',
              borderBottom: i < ads.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
              background: sel ? m.badgeBg : 'transparent',
            }}>
              <Checkbox checked={sel} onChange={() => toggleSel('ads', a.id)}/>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 44, borderRadius: 6, background: a.preview, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
                  <i data-lucide="play" style={{ position: 'absolute', inset: 0, margin: 'auto', width: 12, height: 12, color: '#1d1d1f', opacity: 0.65, strokeWidth: 2 }}/>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {a.winner && <i data-lucide="trophy" style={{ width: 12, height: 12, color: MODE.web.accent, strokeWidth: 1.8 }}/>}
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>{a.name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#aeaeb2', marginTop: 2, fontFamily: '"SF Mono", monospace' }}>{a.id}</div>
                </div>
              </div>
              <StatusPill s={a.status}/>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: angleColor[a.angle] }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: angleColor[a.angle] }}/>
                {a.angle === 'demo' ? 'Demo' : a.angle === 'pain' ? 'Dolor' : a.angle === 'lifestyle' ? 'Lifestyle' : 'Oferta'}
              </span>
              <span style={{ fontSize: 14, fontFamily: '"SF Mono", monospace', fontWeight: 600, color: '#1d1d1f' }}>{a.results}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 600, color: a.cpa < 28 ? MODE.web.badgeFg : (a.cpa < 40 ? '#1d1d1f' : MODE.traffic.accent) }}>{fmtMoney(a.cpa)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#6e6e73' }}>{fmtNum(a.impr)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#1d1d1f' }}>{a.ctr.toFixed(2)}%</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', color: '#1d1d1f', fontWeight: 600 }}>{fmtMoney(a.spend)}</span>
            </div>
          );
        })}

        {/* footer aggregate row */}
        <div style={{ display: 'grid', gridTemplateColumns: cols[tab], padding: '12px 18px', alignItems: 'center', background: 'rgba(0,0,0,0.02)', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <span/>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.4 }}>Totales · {tab === 'campaigns' ? campaigns.length : tab === 'adsets' ? adsets.length : ads.length} filas</span>
          <span/>
          {tab === 'campaigns' && (
            <>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{totals.results}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtNum(totals.reach)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtNum(totals.impr)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtMoney(avgCPA)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtMoney(totals.spend)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: MODE.web.accent }}>2.7×</span>
              <span/>
            </>
          )}
          {tab === 'adsets' && (
            <>
              <span/>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{adsets.reduce((s,a)=>s+a.results,0)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtMoney(adsets.reduce((s,a)=>s+a.spend,0)/adsets.reduce((s,a)=>s+a.results,0))}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtNum(adsets.reduce((s,a)=>s+a.reach,0))}</span>
              <span/>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtMoney(adsets.reduce((s,a)=>s+a.spend,0))}</span>
            </>
          )}
          {tab === 'ads' && (
            <>
              <span/>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{ads.reduce((s,a)=>s+a.results,0)}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtMoney(ads.reduce((s,a)=>s+a.spend,0)/ads.reduce((s,a)=>s+a.results,0))}</span>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtNum(ads.reduce((s,a)=>s+a.impr,0))}</span>
              <span/>
              <span style={{ fontSize: 13, fontFamily: '"SF Mono", monospace', fontWeight: 700, color: '#1d1d1f' }}>{fmtMoney(ads.reduce((s,a)=>s+a.spend,0))}</span>
            </>
          )}
        </div>
      </GlassCard>
    </div>
  );
};

window.Dashboard = Dashboard;

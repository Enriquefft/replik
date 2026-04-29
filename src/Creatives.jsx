// SCREEN 2 — Creative Discovery (PASO 2) — versión simplificada
// Foco: foto del producto arriba + ángulos visuales claros + grid limpio.

const CREATIVES = [
  // Pain — 5 (rojos/naranja)
  { id: 'p1', angle: 'pain', platform: 'fb',  brand: 'HidraBottle PE',   dur: '0:21', score: 92, hook: 'Mi botella sudaba dentro de la mochila. Hasta que probé esta.', bg: 'linear-gradient(135deg,#fee2e2,#fde68a)' },
  { id: 'p2', angle: 'pain', platform: 'tt',  brand: '@gymchalo',         dur: '0:18', score: 88, hook: 'Cansado del agua tibia al mediodía. Probé esto.',                bg: 'linear-gradient(135deg,#fef3c7,#fecaca)' },
  { id: 'p3', angle: 'pain', platform: 'fb',  brand: 'AquaCool',          dur: '0:24', score: 84, hook: 'Por qué tu botella es la razón por la que tomas poca agua.',     bg: 'linear-gradient(135deg,#fde68a,#fed7aa)' },
  { id: 'p4', angle: 'pain', platform: 'tt',  brand: '@runningnaty',      dur: '0:15', score: 79, hook: 'POV: tu última botella se derramó otra vez en el bus.',          bg: 'linear-gradient(135deg,#fee2e2,#fecaca)' },
  { id: 'p5', angle: 'pain', platform: 'fb',  brand: 'Termo Andes',        dur: '0:22', score: 76, hook: '12 horas después. Sigue helada.',                                bg: 'linear-gradient(135deg,#fef3c7,#fde68a)' },
  // Lifestyle — 4 (verdes/azules)
  { id: 'l1', angle: 'lifestyle', platform: 'tt',  brand: '@vivekita',     dur: '0:28', score: 90, hook: 'Etiqueta a la amiga que necesita esto para el gym.',             bg: 'linear-gradient(135deg,#dbeafe,#a7f3d0)' },
  { id: 'l2', angle: 'lifestyle', platform: 'fb',  brand: 'Active Lima',   dur: '0:32', score: 86, hook: 'Una mañana con la nueva 750 ml.',                                bg: 'linear-gradient(135deg,#d1fae5,#bfdbfe)' },
  { id: 'l3', angle: 'lifestyle', platform: 'tt',  brand: '@runclubpe',    dur: '0:19', score: 82, hook: 'Lo esencial del long run del domingo.',                          bg: 'linear-gradient(135deg,#ede9fe,#dbeafe)' },
  { id: 'l4', angle: 'lifestyle', platform: 'fb',  brand: 'YogaSur',        dur: '0:26', score: 78, hook: 'En el mat. En la mochila. En la oficina.',                       bg: 'linear-gradient(135deg,#fef3c7,#a7f3d0)' },
  // Demo — 5 (azules/morados)
  { id: 'd1', angle: 'demo', platform: 'tt',  brand: '@laboratorio_oz',    dur: '0:14', score: 94, hook: 'Le metimos agua hervida y esperamos 12 horas.',                  bg: 'linear-gradient(135deg,#bfdbfe,#ddd6fe)' },
  { id: 'd2', angle: 'demo', platform: 'fb',  brand: 'TermoLab',           dur: '0:20', score: 89, hook: 'Lado a lado: la nuestra vs. la marca barata.',                   bg: 'linear-gradient(135deg,#a7f3d0,#bfdbfe)' },
  { id: 'd3', angle: 'demo', platform: 'tt',  brand: '@cocinaconlaura',    dur: '0:23', score: 85, hook: 'Test de caída desde la mesada.',                                 bg: 'linear-gradient(135deg,#fde68a,#a7f3d0)' },
  { id: 'd4', angle: 'demo', platform: 'fb',  brand: 'HidroPro',           dur: '0:17', score: 81, hook: 'Acero por dentro. Mira la temperatura.',                          bg: 'linear-gradient(135deg,#dbeafe,#fde68a)' },
  { id: 'd5', angle: 'demo', platform: 'tt',  brand: '@gadgets_pe',        dur: '0:25', score: 77, hook: 'Unboxing del pack de 3 unidades.',                               bg: 'linear-gradient(135deg,#ede9fe,#fecaca)' },
];

const ANGLES = {
  pain:      { label: 'Dolor / Solución',  shortLabel: 'Dolor',     icon: 'alert-circle',   accent: '#ff453a', desc: 'El problema antes y la solución después.' },
  lifestyle: { label: 'Estilo de vida',    shortLabel: 'Lifestyle', icon: 'sun',            accent: '#ff9f0a', desc: 'Cómo se ve usándolo en el día a día.' },
  demo:      { label: 'Demostración',      shortLabel: 'Demo',      icon: 'flask-conical',  accent: '#0a84ff', desc: 'Pruebas, comparaciones, antes/después.' },
};

const PLATFORM = {
  fb: { label: 'Facebook', color: '#1877f2', icon: 'facebook' },
  tt: { label: 'TikTok',   color: '#000000', icon: 'music' },
};

const Creatives = ({ onNext, productLabel }) => {
  const m = MODE.creative;
  const [filter, setFilter] = React.useState('all'); // all | pain | lifestyle | demo
  const [selected, setSelected] = React.useState(new Set(['p1', 'l1', 'd1', 'd2', 'p2']));

  const toggle = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const filtered = CREATIVES.filter((c) => filter === 'all' || c.angle === filter);
  const byAngle = { pain: [], lifestyle: [], demo: [] };
  CREATIVES.forEach((c) => byAngle[c.angle].push(c));

  const Card = ({ c }) => {
    const sel = selected.has(c.id);
    const a = ANGLES[c.angle];
    const p = PLATFORM[c.platform];
    return (
      <div onClick={() => toggle(c.id)} style={{
        position: 'relative', cursor: 'pointer',
        borderRadius: 18,
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px) saturate(180%)',
        border: sel ? `2px solid ${m.accent}` : '1px solid rgba(255,255,255,0.80)',
        boxShadow: sel ? `0 4px 20px rgba(${m.rgb},0.30), inset 0 1px 0 rgba(255,255,255,0.90)` : '0 2px 8px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.90)',
        overflow: 'hidden',
        transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <div style={{ aspectRatio: '9/16', background: c.bg, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 70%, rgba(255,255,255,0.30), transparent 60%)' }}/>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
            <i data-lucide="play" style={{ width: 20, height: 20, color: '#fff', strokeWidth: 1.8 }} />
          </div>
          <div style={{
            position: 'absolute', top: 10, left: 10,
            width: 26, height: 26, borderRadius: '50%',
            background: sel ? m.accent : 'rgba(255,255,255,0.85)',
            border: sel ? 'none' : '1.5px solid rgba(255,255,255,1)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
          }}>
            {sel && <i data-lucide="check" style={{ width: 14, height: 14, color: '#fff', strokeWidth: 2.5 }}/>}
          </div>
          <div style={{ position: 'absolute', top: 10, right: 10, height: 22, padding: '0 7px', borderRadius: 100, background: c.platform === 'fb' ? 'rgba(24,119,242,0.95)' : 'rgba(0,0,0,0.85)', color: '#fff', fontSize: 10, fontWeight: 600, letterSpacing: 0.3, display: 'inline-flex', alignItems: 'center' }}>{p.label}</div>
          <div style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '2px 7px', borderRadius: 100, fontFamily: '"SF Mono", monospace' }}>{c.dur}</div>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ fontSize: 12, color: '#1d1d1f', lineHeight: 1.4, height: 50, overflow: 'hidden' }}>"{c.hook}"</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            <span style={{ fontSize: 11, color: '#6e6e73', fontWeight: 500 }}>{c.brand}</span>
            <span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', color: m.accent, fontWeight: 700 }}>★ {c.score}</span>
          </div>
        </div>
      </div>
    );
  };

  const AngleFilter = ({ id, count }) => {
    const active = filter === id;
    if (id === 'all') {
      return (
        <button onClick={() => setFilter('all')} style={{
          height: 36, padding: '0 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
          background: active ? '#1d1d1f' : 'rgba(255,255,255,0.85)',
          color: active ? '#fff' : '#1d1d1f',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>Todos <span style={{ fontSize: 11, opacity: 0.7, fontFamily: '"SF Mono", monospace' }}>{count}</span></button>
      );
    }
    const a = ANGLES[id];
    return (
      <button onClick={() => setFilter(id)} style={{
        height: 36, padding: '0 14px', borderRadius: 100, border: 'none', cursor: 'pointer',
        background: active ? a.accent : 'rgba(255,255,255,0.85)',
        color: active ? '#fff' : '#1d1d1f',
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        boxShadow: active ? `0 4px 12px ${a.accent}40` : 'none',
      }}>
        <i data-lucide={a.icon} style={{ width: 14, height: 14, strokeWidth: 1.8 }}/>
        {a.label}
        <span style={{ fontSize: 11, opacity: active ? 0.85 : 0.5, fontFamily: '"SF Mono", monospace' }}>{count}</span>
      </button>
    );
  };

  return (
    <div style={{ padding: 24, paddingBottom: 110, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Hero — foto del producto + título */}
      <GlassCard padding={0}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 0 }}>
          <div style={{ background: 'linear-gradient(135deg,#dbeafe,#a7f3d0)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '20px 0 0 20px' }}>
            <div style={{ width: 72, height: 72, borderRadius: 16, background: 'rgba(255,255,255,0.6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
              <i data-lucide="droplet" style={{ width: 36, height: 36, color: '#1d1d1f', strokeWidth: 1.2, opacity: 0.45 }}/>
            </div>
          </div>
          <div style={{ padding: '20px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
            <div>
              <Eyebrow color={m.badgeFg}>Paso 2 · Encontré los videos</Eyebrow>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, color: '#1d1d1f', marginTop: 6 }}>{productLabel || 'Botella térmica 750 ml'}</div>
              <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 4 }}>
                <span style={{ color: m.accent, fontWeight: 600 }}>14 videos</span> de los últimos 30 días en Facebook Ad Library y TikTok. Elige al menos 5.
              </div>
            </div>
            <Button variant="ghost" mode="creative" icon="refresh-cw">Buscar de nuevo</Button>
          </div>
        </div>
      </GlassCard>

      {/* Ángulos — explicación visual */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {Object.entries(ANGLES).map(([id, a]) => {
          const sel = filter === id;
          const total = byAngle[id].length;
          const selCount = byAngle[id].filter(c => selected.has(c.id)).length;
          return (
            <div key={id} onClick={() => setFilter(sel ? 'all' : id)} style={{
              padding: 16, borderRadius: 16, cursor: 'pointer',
              background: sel ? '#fff' : 'rgba(255,255,255,0.65)',
              border: sel ? `1.5px solid ${a.accent}` : '1px solid rgba(0,0,0,0.05)',
              boxShadow: sel ? `0 4px 16px ${a.accent}25` : '0 1px 3px rgba(0,0,0,0.03)',
              transition: 'all 200ms',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: a.accent + '1a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i data-lucide={a.icon} style={{ width: 22, height: 22, color: a.accent, strokeWidth: 1.6 }}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>{a.label}</span>
                  <span style={{ fontSize: 11, fontFamily: '"SF Mono", monospace', color: '#6e6e73' }}>{selCount}/{total}</span>
                </div>
                <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2, lineHeight: 1.4 }}>{a.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>Filtrar:</span>
        <AngleFilter id="all" count={CREATIVES.length}/>
        <AngleFilter id="pain" count={byAngle.pain.length}/>
        <AngleFilter id="lifestyle" count={byAngle.lifestyle.length}/>
        <AngleFilter id="demo" count={byAngle.demo.length}/>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {filtered.map((c) => <Card key={c.id} c={c}/>)}
      </div>

      {/* Sticky bar */}
      <div style={{
        position: 'fixed', bottom: 18, left: 'calc(240px + 24px)', right: 24,
        zIndex: 10, padding: '12px 16px 12px 20px',
        borderRadius: 16,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.85)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.95)',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: m.badgeBg, color: m.badgeFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{selected.size}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>{selected.size} videos elegidos</div>
            <div style={{ fontSize: 11, color: '#6e6e73' }}>
              {selected.size < 5 ? `Te faltan ${5 - selected.size} para continuar` : 'Listos para subtitular'}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 8 }}>
          {Object.entries(byAngle).map(([k, items]) => {
            const a = ANGLES[k];
            const sel = items.filter((c) => selected.has(c.id)).length;
            return (
              <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: '"SF Mono", monospace', color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  <span>{a.shortLabel}</span><span>{sel}/{items.length}</span>
                </div>
                <div style={{ height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                  <div style={{ width: `${(sel / items.length) * 100}%`, height: '100%', background: a.accent, transition: 'width 200ms' }}/>
                </div>
              </div>
            );
          })}
        </div>
        <Button variant="primary" mode="creative" icon="arrow-right" onClick={() => onNext(Array.from(selected))} disabled={selected.size < 5} style={{ height: 40, opacity: selected.size < 5 ? 0.5 : 1, cursor: selected.size < 5 ? 'not-allowed' : 'pointer' }}>Subtitular y editar</Button>
      </div>
    </div>
  );
};

window.Creatives = Creatives;
window.CREATIVES_DATA = CREATIVES;
window.ANGLES_DATA = ANGLES;
window.PLATFORM_DATA = PLATFORM;

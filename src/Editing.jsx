// SCREEN 3 — Creative Editing (PASO 3) — versión simplificada
// Lista a la izquierda con toggle subtítulos por video. Modal de status al confirmar.

const Editing = ({ selectedIds, onNext }) => {
  const m = MODE.creative;
  const items = (selectedIds && selectedIds.length ? selectedIds : ['p1','l1','d1','d2','p2'])
    .map((id) => CREATIVES_DATA.find((c) => c.id === id))
    .filter(Boolean);

  const [active, setActive] = React.useState(0);
  const [subs, setSubs] = React.useState(() => items.reduce((acc, c) => { acc[c.id] = true; return acc; }, {}));
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [statusStep, setStatusStep] = React.useState(0);

  const cur = items[active];
  const subsOnCount = Object.values(subs).filter(Boolean).length;

  const startProcess = () => {
    setStatusOpen(true);
    setStatusStep(0);
    const steps = [800, 1200, 1400, 900];
    let i = 0;
    const tick = () => {
      i += 1;
      setStatusStep(i);
      if (i < 4) setTimeout(tick, steps[i]);
      else setTimeout(() => { setStatusOpen(false); onNext(); }, 700);
    };
    setTimeout(tick, steps[0]);
  };

  const STATUS_STEPS = [
    { icon: 'download',     label: 'Descargando los videos elegidos',         detail: '5/5 videos en cola' },
    { icon: 'mic',          label: 'Transcribiendo audio en español',          detail: 'Whisper · es-PE' },
    { icon: 'type',         label: 'Generando subtítulos animados',            detail: `${subsOnCount}/${items.length} con subtítulos` },
    { icon: 'shuffle',      label: 'Creando variaciones para esquivar duplicados', detail: 'Bordes, ruido leve, ritmo' },
    { icon: 'check-circle-2', label: 'Listo — videos preparados', detail: 'Pasamos a la landing' },
  ];

  return (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, height: '100%' }}>
      {/* Lista con toggle por video */}
      <GlassCard padding={0} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
          <Eyebrow color={m.badgeFg}>Paso 3 · Subtítulos por video</Eyebrow>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1d1d1f', marginTop: 6 }}>Decide cuáles llevan subtítulos</div>
          <div style={{ fontSize: 12, color: '#6e6e73', marginTop: 2, lineHeight: 1.4 }}>Puedes activarlos o desactivarlos para cada uno.</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {items.map((c, i) => {
            const a = ANGLES_DATA[c.angle];
            const sel = i === active;
            const on = subs[c.id];
            return (
              <div key={c.id} onClick={() => setActive(i)} style={{
                display: 'flex', gap: 12, padding: 10, borderRadius: 12, cursor: 'pointer',
                background: sel ? 'rgba(255,255,255,0.95)' : 'transparent',
                border: sel ? `1.5px solid ${m.accent}` : '1.5px solid transparent',
                marginBottom: 4, alignItems: 'center',
                transition: 'all 150ms',
              }}>
                <div style={{ width: 38, height: 56, borderRadius: 8, background: c.bg, position: 'relative', flexShrink: 0 }}>
                  <i data-lucide="play" style={{ position: 'absolute', inset: 0, margin: 'auto', width: 14, height: 14, color: '#fff', strokeWidth: 2 }}/>
                  <span style={{ position: 'absolute', bottom: 3, right: 3, fontSize: 8, fontFamily: '"SF Mono", monospace', color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '1px 4px', borderRadius: 100 }}>{c.dur}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.brand}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: a.accent }}/>
                    <span style={{ fontSize: 10, color: '#6e6e73', fontWeight: 600 }}>{a.shortLabel}</span>
                  </div>
                </div>
                <div onClick={(e) => { e.stopPropagation(); setSubs({ ...subs, [c.id]: !on }); }}>
                  <Toggle on={on} mode="creative"/>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,159,10,0.05)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <i data-lucide="info" style={{ width: 14, height: 14, color: m.accent, strokeWidth: 1.5, flexShrink: 0, marginTop: 2 }}/>
            <div style={{ fontSize: 11, color: '#1d1d1f', lineHeight: 1.5 }}>
              {subsOnCount} de {items.length} videos con subtítulos. Las variaciones de subtítulo ayudan a no chocar con duplicados de Meta.
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Preview grande del activo */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        <GlassCard padding={20} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <Eyebrow>Vista previa · Video {String(active+1).padStart(2,'0')}</Eyebrow>
              <div style={{ fontSize: 17, fontWeight: 600, color: '#1d1d1f', marginTop: 4 }}>{cur.brand}</div>
              <div style={{ fontSize: 12, color: '#6e6e73', marginTop: 2 }}>
                {subs[cur.id] ? 'Con subtítulos' : 'Sin subtítulos · video original'} · {cur.dur}
              </div>
            </div>
            <ModeBadge mode={cur.angle === 'pain' ? 'traffic' : cur.angle === 'lifestyle' ? 'creative' : 'web'} dot>
              {ANGLES_DATA[cur.angle].label}
            </ModeBadge>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 420 }}>
            {/* Phone preview */}
            <div style={{ width: 240, aspectRatio: '9/19.5', borderRadius: 32, background: '#000', padding: 8, boxShadow: '0 16px 48px rgba(0,0,0,0.20)', position: 'relative' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 26, background: cur.bg, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 14 }}>
                <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 80, height: 22, background: '#000', borderRadius: 100, zIndex: 5 }}/>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i data-lucide="play" style={{ width: 22, height: 22, color: '#fff', strokeWidth: 1.8 }}/>
                  </div>
                </div>
                {subs[cur.id] && (
                  <div style={{ zIndex: 2, paddingBottom: 30, textAlign: 'center' }}>
                    <div style={{ display: 'inline-block', padding: '5px 11px', borderRadius: 6, background: '#000', color: '#fff', fontSize: 13, fontWeight: 700, boxShadow: '0 2px 6px rgba(0,0,0,0.3)', maxWidth: '90%' }}>{cur.hook.slice(0, 38)}</div>
                  </div>
                )}
                <div style={{ position: 'absolute', top: 38, right: 14, padding: '3px 8px', borderRadius: 100, background: cur.platform === 'fb' ? 'rgba(24,119,242,0.95)' : 'rgba(0,0,0,0.85)', color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: 0.3, zIndex: 3 }}>{PLATFORM_DATA[cur.platform].label}</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 14 }}>
            {items.map((_, i) => (
              <div key={i} onClick={() => setActive(i)} style={{ width: i === active ? 22 : 6, height: 6, borderRadius: 100, background: i === active ? m.accent : 'rgba(0,0,0,0.12)', cursor: 'pointer', transition: 'all 200ms' }}/>
            ))}
          </div>
        </GlassCard>

        <Button variant="primary" mode="web" icon="arrow-right" onClick={startProcess} fullWidth style={{ height: 54, fontSize: 15 }}>
          Subtitular y armar landing →
        </Button>
        <div style={{ textAlign: 'center', fontSize: 11, color: '#6e6e73' }}>
          Procesaré los {items.length} videos · {subsOnCount} con subtítulos · y luego pasamos a la landing
        </div>
      </div>

      {/* Status modal */}
      {statusOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            width: 480, borderRadius: 24,
            background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(30px) saturate(200%)',
            border: '1px solid rgba(255,255,255,0.9)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,1)',
            padding: 28,
          }}>
            <Eyebrow color={m.badgeFg}>Trabajando</Eyebrow>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, color: '#1d1d1f', marginTop: 6 }}>Preparando tus videos…</div>
            <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 4 }}>Tomará menos de un minuto.</div>

            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {STATUS_STEPS.map((s, i) => {
                const done = i < statusStep;
                const active = i === statusStep;
                const pending = i > statusStep;
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 12, background: active ? m.badgeBg : 'transparent', alignItems: 'center', transition: 'all 200ms' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                      background: done ? MODE.web.accent : active ? m.accent : 'rgba(0,0,0,0.05)',
                      color: pending ? '#aeaeb2' : '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {done ? (
                        <i data-lucide="check" style={{ width: 16, height: 16, strokeWidth: 3 }}/>
                      ) : active ? (
                        <div style={{ width: 14, height: 14, border: '2.5px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
                      ) : (
                        <i data-lucide={s.icon} style={{ width: 16, height: 16, strokeWidth: 1.6 }}/>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: pending ? '#aeaeb2' : '#1d1d1f' }}>{s.label}</div>
                      {!pending && <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2, fontFamily: '"SF Mono", monospace' }}>{s.detail}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
};

window.Editing = Editing;

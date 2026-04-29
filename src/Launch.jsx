// SCREEN 5 — Launch (PASO 5) — Configuración completa de campaña Meta
// Estructura Meta API: Campaign (objective + budget) > AdSet (audience + placement + schedule + opt_goal + bid) > Ad (creative)

const Launch = ({ onNext, productLabel }) => {
  const m = MODE.traffic;

  // ===== Campaign-level state =====
  const [objective, setObjective] = React.useState('OUTCOME_SALES');
  const [budgetType, setBudgetType] = React.useState('CBO'); // CBO | ABO
  const [budgetMode, setBudgetMode] = React.useState('daily'); // daily | lifetime
  const [budget, setBudget] = React.useState(120);
  const [bidStrategy, setBidStrategy] = React.useState('LOWEST_COST'); // LOWEST_COST | COST_CAP | BID_CAP
  const [bidAmount, setBidAmount] = React.useState(25);

  // ===== AdSet-level state =====
  const [optGoal, setOptGoal] = React.useState('OFFSITE_CONVERSIONS');
  const [conversionEvent, setConversionEvent] = React.useState('PURCHASE');
  const [destinationType, setDestinationType] = React.useState('WEBSITE'); // WEBSITE | WHATSAPP | MESSENGER
  const [attribution, setAttribution] = React.useState('7d_click_1d_view');

  // Audiencia
  const [countries, setCountries] = React.useState(['PE']);
  const [regions, setRegions] = React.useState(['Lima', 'Callao']);
  const [ageMin, setAgeMin] = React.useState(24);
  const [ageMax, setAgeMax] = React.useState(45);
  const [genders, setGenders] = React.useState(['all']); // all | male | female
  const [interests, setInterests] = React.useState(['Bienestar', 'Deportes', 'Hidratación']);
  const [audienceType, setAudienceType] = React.useState('detailed'); // detailed | lookalike | custom | broad
  const [advantageAudience, setAdvantageAudience] = React.useState(true);

  // Placements
  const [placementMode, setPlacementMode] = React.useState('auto'); // auto | manual
  const [placements, setPlacements] = React.useState({
    'fb_feed': true, 'fb_reels': true, 'fb_stories': true, 'fb_video': false, 'fb_marketplace': true,
    'ig_feed': true, 'ig_reels': true, 'ig_stories': true, 'ig_explore': true,
    'audience_network': false, 'messenger_stories': false,
  });
  const [devices, setDevices] = React.useState(['mobile']);

  // Schedule
  const [scheduleType, setScheduleType] = React.useState('continuous'); // continuous | dated
  const [startDate, setStartDate] = React.useState('2025-11-25');
  const [startTime, setStartTime] = React.useState('09:00');
  const [endDate, setEndDate] = React.useState('2025-12-09');

  // Pixel + tracking
  const [pixelId] = React.useState('487291038724501');
  const [capiEnabled, setCapiEnabled] = React.useState(true);
  const [utmEnabled, setUtmEnabled] = React.useState(true);

  const [metaConnected, setMetaConnected] = React.useState(false);
  const [expanded, setExpanded] = React.useState({ campaign: true, audience: true, placement: true, schedule: true, ads: true, tracking: false });

  // ===== Ad creatives =====
  const [adCopies, setAdCopies] = React.useState({
    0: { primary: '¿Cansado del agua tibia a las 11am? Esta botella la mantiene fría 12 horas. Doble pared de acero al vacío.', headline: 'Botella térmica 750ml', desc: 'Pago al recibir · Lima', cta: 'SHOP_NOW' },
    1: { primary: '+1,200 runners limeños ya la usan a diario. Pack de 3 con 29% de descuento, pago al recibir.',                headline: 'Pack 3 — Ahorra 29%',   desc: 'Stock limitado',         cta: 'SHOP_NOW' },
    2: { primary: 'Mira el test: 12 horas con hielo dentro, sin sudoración por fuera. Probada por miles en Lima.',             headline: '12hrs con hielo',         desc: 'Demostración real',       cta: 'LEARN_MORE' },
    3: { primary: 'Para tu mochila del gym, oficina o cualquier salida. Liviana, anti-derrames y elegante.',                    headline: 'Para todo el día',         desc: 'Tapa anti-derrame',      cta: 'SHOP_NOW' },
    4: { primary: 'Doble pared de acero inoxidable 304. Tapa con cierre hermético. Sin BPA, sin oxidación.',                    headline: 'Acero inoxidable 304',     desc: 'Sin BPA · Garantía 1 año', cta: 'ORDER_NOW' },
  });
  const ads = ['p1', 'l1', 'd1', 'd2', 'p2'].map((id) => CREATIVES_DATA.find((c) => c.id === id)).filter(Boolean);

  // ===== Estimaciones =====
  const dailyBudget = budgetMode === 'daily' ? budget : budget / 14;
  const estReach = Math.round(dailyBudget * 7 * 120);
  const estCPA = bidStrategy === 'COST_CAP' ? bidAmount : 26;
  const estResults = Math.round(dailyBudget * 7 / estCPA);
  const estROAS = (135 / estCPA).toFixed(1);

  // ===== Helpers =====
  const Section = ({ id, n, title, sub, children, badge }) => {
    const open = expanded[id];
    return (
      <GlassCard padding={0}>
        <div onClick={() => setExpanded({ ...expanded, [id]: !open })} style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, borderBottom: open ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: m.badgeBg, color: m.badgeFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, fontFamily: '"SF Mono", monospace' }}>{n}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f' }}>{title}</span>
              {badge}
            </div>
            <div style={{ fontSize: 12, color: '#6e6e73', marginTop: 2 }}>{sub}</div>
          </div>
          <i data-lucide={open ? 'chevron-up' : 'chevron-down'} style={{ width: 16, height: 16, color: '#6e6e73' }}/>
        </div>
        {open && <div style={{ padding: 20 }}>{children}</div>}
      </GlassCard>
    );
  };

  const Field = ({ label, hint, children, right, span = 1 }) => (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{label}</span>
        {right}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#aeaeb2', marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );

  const RadioCard = ({ value, current, onClick, icon, title, sub, disabled }) => {
    const sel = current === value;
    return (
      <div onClick={() => !disabled && onClick(value)} style={{
        padding: 12, borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
        background: sel ? '#fff' : 'rgba(255,255,255,0.65)',
        border: sel ? `1.5px solid ${m.accent}` : '1.5px solid rgba(0,0,0,0.06)',
        boxShadow: sel ? `0 4px 12px rgba(${m.rgb}, 0.15)` : 'none',
        opacity: disabled ? 0.5 : 1,
        display: 'flex', flexDirection: 'column', gap: 4, position: 'relative',
      }}>
        {sel && <div style={{ position: 'absolute', top: 10, right: 10, width: 16, height: 16, borderRadius: '50%', background: m.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i data-lucide="check" style={{ width: 10, height: 10, color: '#fff', strokeWidth: 3 }}/></div>}
        {icon && <i data-lucide={icon} style={{ width: 18, height: 18, color: sel ? m.accent : '#6e6e73', strokeWidth: 1.6 }}/>}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: '#6e6e73', lineHeight: 1.4 }}>{sub}</div>}
      </div>
    );
  };

  const Pill = ({ on, onClick, children }) => (
    <button onClick={onClick} style={{
      height: 30, padding: '0 12px', borderRadius: 100, border: '1px solid ' + (on ? m.accent : 'rgba(0,0,0,0.10)'),
      background: on ? m.badgeBg : '#fff', color: on ? m.badgeFg : '#6e6e73',
      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>{children}</button>
  );

  const Chip = ({ label, onRemove }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 4px 0 10px', borderRadius: 100, background: m.badgeBg, color: m.badgeFg, fontSize: 12, fontWeight: 600 }}>
      {label}
      {onRemove && <button onClick={onRemove} style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.08)', color: m.badgeFg, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        <i data-lucide="x" style={{ width: 10, height: 10, strokeWidth: 2.5 }}/>
      </button>}
    </span>
  );

  const objectives = [
    { id: 'OUTCOME_SALES',        label: 'Ventas',                  icon: 'shopping-cart',        sub: 'Optimiza por compras (lo que necesitas)', sel: true },
    { id: 'OUTCOME_LEADS',        label: 'Clientes potenciales',    icon: 'user-plus',            sub: 'Optimiza por formularios o WhatsApp' },
    { id: 'OUTCOME_TRAFFIC',      label: 'Tráfico',                 icon: 'mouse-pointer-click',  sub: 'Clicks al sitio. CPA más alto.' },
    { id: 'OUTCOME_AWARENESS',    label: 'Reconocimiento',          icon: 'eye',                  sub: 'Alcance e impresiones' },
    { id: 'OUTCOME_ENGAGEMENT',   label: 'Interacción',             icon: 'message-circle',       sub: 'Likes, comentarios, mensajes' },
    { id: 'OUTCOME_APP_PROMOTION',label: 'Promoción de app',         icon: 'smartphone',           sub: 'Instalaciones de app' },
  ];

  const placementGroups = [
    { name: 'Facebook',         items: [
      { id: 'fb_feed', label: 'Feed' }, { id: 'fb_reels', label: 'Reels' },
      { id: 'fb_stories', label: 'Historias' }, { id: 'fb_video', label: 'Video in-stream' },
      { id: 'fb_marketplace', label: 'Marketplace' },
    ]},
    { name: 'Instagram',        items: [
      { id: 'ig_feed', label: 'Feed' }, { id: 'ig_reels', label: 'Reels' },
      { id: 'ig_stories', label: 'Historias' }, { id: 'ig_explore', label: 'Explorar' },
    ]},
    { name: 'Otros',            items: [
      { id: 'audience_network', label: 'Audience Network' },
      { id: 'messenger_stories', label: 'Messenger · Historias' },
    ]},
  ];

  const ctaOptions = ['SHOP_NOW', 'LEARN_MORE', 'ORDER_NOW', 'GET_OFFER', 'BUY_NOW', 'SIGN_UP', 'SEND_MESSAGE', 'WHATSAPP_MESSAGE'];
  const ctaLabels = { SHOP_NOW: 'Comprar ahora', LEARN_MORE: 'Más información', ORDER_NOW: 'Ordenar ahora', GET_OFFER: 'Ver oferta', BUY_NOW: 'Comprar', SIGN_UP: 'Registrarse', SEND_MESSAGE: 'Enviar mensaje', WHATSAPP_MESSAGE: 'WhatsApp' };

  return (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, maxWidth: 1280, margin: '0 auto' }}>

      {/* MAIN COLUMN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <GlassCard>
          <Eyebrow color={m.badgeFg}>Paso 5 · Configuramos en Meta</Eyebrow>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, color: '#1d1d1f', marginTop: 6 }}>Configura tu campaña como en Ads Manager</div>
          <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 4 }}>{productLabel || 'Botella térmica 750 ml'} · 5 anuncios listos · landing publicada · Pixel verificado</div>
        </GlassCard>

        {!metaConnected && (
          <div style={{ padding: 16, borderRadius: 14, background: 'linear-gradient(135deg, rgba(24,119,242,0.08), rgba(255,69,58,0.06))', border: `1.5px solid ${m.accent}`, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1877f2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i data-lucide="facebook" style={{ width: 20, height: 20, color: '#fff', strokeWidth: 1.8 }}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>Conecta tu Meta Business</div>
              <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>Necesito permisos <span style={{ fontFamily: '"SF Mono", monospace' }}>ads_management</span> + <span style={{ fontFamily: '"SF Mono", monospace' }}>business_management</span> para crear campañas en tu cuenta.</div>
            </div>
            <Button variant="primary" mode="traffic" icon="link-2" onClick={() => setMetaConnected(true)}>Conectar</Button>
          </div>
        )}

        {/* SECTION 1 — Campaign */}
        <Section id="campaign" n="01" title="Campaña" sub="Objetivo, presupuesto y estrategia de puja"
          badge={<span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.05)', color: '#6e6e73' }}>CAMPAIGN</span>}>

          <Field label="Objetivo de campaña" hint="Meta optimizará la entrega para esta meta. Para test de productos en COD, usa Ventas con evento Compra.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {objectives.slice(0, 6).map((o) => (
                <RadioCard key={o.id} value={o.id} current={objective} onClick={setObjective} icon={o.icon} title={o.label} sub={o.sub}/>
              ))}
            </div>
          </Field>

          <div style={{ marginTop: 18 }}>
            <Field label="Estrategia de presupuesto" hint="CBO (Advantage+ Campaign Budget): Meta reparte. ABO: tú asignas por adset.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <RadioCard value="CBO" current={budgetType} onClick={setBudgetType} icon="layout-grid" title="CBO · Advantage Budget" sub="Meta reparte el presupuesto. Recomendado si <50 ventas en pixel."/>
                <RadioCard value="ABO" current={budgetType} onClick={setBudgetType} icon="sliders-horizontal" title="ABO · Por conjunto" sub="Tú controlas el budget por adset. Para testear ángulos aislados."/>
              </div>
            </Field>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Tipo de presupuesto">
              <div style={{ display: 'flex', gap: 6, padding: 4, background: 'rgba(0,0,0,0.04)', borderRadius: 10 }}>
                {[{ id: 'daily', label: 'Diario' }, { id: 'lifetime', label: 'Total' }].map((b) => (
                  <button key={b.id} onClick={() => setBudgetMode(b.id)} style={{
                    flex: 1, height: 34, borderRadius: 8, border: 'none', background: budgetMode === b.id ? '#fff' : 'transparent',
                    color: budgetMode === b.id ? '#1d1d1f' : '#6e6e73', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                    boxShadow: budgetMode === b.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>{b.label}</button>
                ))}
              </div>
            </Field>
            <Field label={`Presupuesto ${budgetMode === 'daily' ? 'diario' : 'total (14 días)'}`}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6e6e73', fontSize: 14, fontFamily: '"SF Mono", monospace' }}>S/</span>
                <input type="number" value={budget} onChange={(e) => setBudget(parseFloat(e.target.value)||0)} style={{
                  width: '100%', height: 44, paddingLeft: 38, paddingRight: 14, borderRadius: 12,
                  background: 'rgba(255,255,255,0.95)', border: '1.5px solid rgba(0,0,0,0.10)',
                  fontSize: 18, fontWeight: 700, fontFamily: '"SF Mono", monospace', color: '#1d1d1f', outline: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}/>
              </div>
              <input type="range" min={budgetMode === 'daily' ? 40 : 500} max={budgetMode === 'daily' ? 500 : 5000} step={budgetMode === 'daily' ? 10 : 100} value={budget} onChange={(e) => setBudget(parseFloat(e.target.value))} style={{ width: '100%', marginTop: 10, accentColor: m.accent }}/>
            </Field>
          </div>

          <div style={{ marginTop: 18 }}>
            <Field label="Estrategia de puja (bid strategy)" hint="Lowest cost: Meta gasta el budget para máximos resultados. Cost cap: pone un techo de CPA. Bid cap: pone un techo de puja por subasta.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <RadioCard value="LOWEST_COST" current={bidStrategy} onClick={setBidStrategy} icon="trending-down" title="Costo más bajo" sub="Meta busca máximos resultados con tu budget"/>
                <RadioCard value="COST_CAP"    current={bidStrategy} onClick={setBidStrategy} icon="target"          title="Tope de costo (Cost Cap)" sub="Define un CPA promedio máximo"/>
                <RadioCard value="BID_CAP"     current={bidStrategy} onClick={setBidStrategy} icon="gauge"           title="Tope de puja (Bid Cap)" sub="Define una puja máxima por subasta"/>
              </div>
            </Field>
            {(bidStrategy === 'COST_CAP' || bidStrategy === 'BID_CAP') && (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: m.badgeBg, border: `1px solid ${m.accent}30`, display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 12, color: m.badgeFg, fontWeight: 600 }}>{bidStrategy === 'COST_CAP' ? 'CPA objetivo' : 'Puja máxima'}</span>
                <div style={{ position: 'relative', flex: 1, maxWidth: 200 }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: m.badgeFg, fontSize: 13, fontFamily: '"SF Mono", monospace' }}>S/</span>
                  <input type="number" value={bidAmount} onChange={(e) => setBidAmount(parseFloat(e.target.value)||0)} style={{
                    width: '100%', height: 36, paddingLeft: 32, paddingRight: 12, borderRadius: 8,
                    background: '#fff', border: `1px solid ${m.accent}50`,
                    fontSize: 14, fontWeight: 700, fontFamily: '"SF Mono", monospace', color: '#1d1d1f', outline: 'none',
                  }}/>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* SECTION 2 — Audience */}
        <Section id="audience" n="02" title="Audiencia" sub="Quién verá los anuncios — ubicación, edad, intereses"
          badge={<span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.05)', color: '#6e6e73' }}>ADSET</span>}>

          <Field label="Tipo de audiencia">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <RadioCard value="detailed"  current={audienceType} onClick={setAudienceType} icon="filter"      title="Segmentación detallada" sub="Por intereses y demográficos"/>
              <RadioCard value="lookalike" current={audienceType} onClick={setAudienceType} icon="users"        title="Audiencia similar"        sub="Lookalike de tus compradores"/>
              <RadioCard value="custom"    current={audienceType} onClick={setAudienceType} icon="user-check"   title="Personalizada"            sub="Re-engagement, web visitors"/>
              <RadioCard value="broad"     current={audienceType} onClick={setAudienceType} icon="globe-2"      title="Amplia (Advantage+)"      sub="Sin filtros, Meta decide"/>
            </div>
          </Field>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Ubicación · Países" hint="Meta orienta basado en residencia reciente.">
              <div style={{ minHeight: 44, padding: 8, borderRadius: 12, background: 'rgba(255,255,255,0.85)', border: '1.5px solid rgba(0,0,0,0.10)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Chip label="🇵🇪 Perú"/>
                <input placeholder="Agregar país..." style={{ flex: 1, minWidth: 100, border: 'none', background: 'transparent', fontSize: 13, color: '#1d1d1f', outline: 'none', fontFamily: 'inherit' }}/>
              </div>
            </Field>
            <Field label="Regiones / Departamentos">
              <div style={{ minHeight: 44, padding: 8, borderRadius: 12, background: 'rgba(255,255,255,0.85)', border: '1.5px solid rgba(0,0,0,0.10)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Chip label="Lima"     onRemove={() => setRegions(regions.filter(r => r !== 'Lima'))}/>
                <Chip label="Callao"   onRemove={() => setRegions(regions.filter(r => r !== 'Callao'))}/>
                <input placeholder="Agregar región..." style={{ flex: 1, minWidth: 100, border: 'none', background: 'transparent', fontSize: 13, color: '#1d1d1f', outline: 'none', fontFamily: 'inherit' }}/>
              </div>
            </Field>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Edad" hint="Meta requiere mín. 18 para anunciantes globales.">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input type="number" value={ageMin} min="18" max="65" onChange={(e) => setAgeMin(parseInt(e.target.value)||18)} style={{ width: '100%', height: 44, paddingLeft: 14, paddingRight: 14, borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 15, fontWeight: 600, color: '#1d1d1f', outline: 'none', fontFamily: '"SF Mono", monospace' }}/>
                </div>
                <span style={{ color: '#6e6e73', fontSize: 13 }}>—</span>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input type="number" value={ageMax} min="18" max="65" onChange={(e) => setAgeMax(parseInt(e.target.value)||65)} style={{ width: '100%', height: 44, paddingLeft: 14, paddingRight: 14, borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 15, fontWeight: 600, color: '#1d1d1f', outline: 'none', fontFamily: '"SF Mono", monospace' }}/>
                </div>
                <span style={{ fontSize: 12, color: '#6e6e73' }}>años</span>
              </div>
            </Field>
            <Field label="Género">
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ id: 'all', label: 'Todos', icon: 'users' }, { id: 'male', label: 'Hombres', icon: 'user' }, { id: 'female', label: 'Mujeres', icon: 'user' }].map((g) => (
                  <Pill key={g.id} on={genders.includes(g.id)} onClick={() => setGenders([g.id])}>{g.label}</Pill>
                ))}
              </div>
            </Field>
          </div>

          <div style={{ marginTop: 18 }}>
            <Field label="Segmentación detallada — intereses y comportamientos" hint="Meta sugiere más basado en tu pixel y catálogo.">
              <div style={{ minHeight: 44, padding: 8, borderRadius: 12, background: 'rgba(255,255,255,0.85)', border: '1.5px solid rgba(0,0,0,0.10)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {interests.map((it) => <Chip key={it} label={it} onRemove={() => setInterests(interests.filter(i => i !== it))}/>)}
                <input placeholder='Buscar intereses (ej. "running", "vida sana")' style={{ flex: 1, minWidth: 200, border: 'none', background: 'transparent', fontSize: 13, color: '#1d1d1f', outline: 'none', fontFamily: 'inherit' }}/>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#aeaeb2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, alignSelf: 'center' }}>Sugerencias:</span>
                {['Running', 'Yoga', 'Vida sana', 'Productos sin BPA', 'Crossfit', 'Hidratación deportiva'].map((s) => (
                  <button key={s} onClick={() => !interests.includes(s) && setInterests([...interests, s])} style={{ height: 24, padding: '0 10px', borderRadius: 100, background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11, color: '#6e6e73', cursor: 'pointer', fontFamily: 'inherit' }}>+ {s}</button>
                ))}
              </div>
            </Field>
          </div>

          <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Toggle on={advantageAudience} onChange={setAdvantageAudience} mode="traffic"/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>Advantage+ Audience</div>
              <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>Permite a Meta expandir tu audiencia cuando encuentre conversiones afuera de tu segmentación.</div>
            </div>
          </div>
        </Section>

        {/* SECTION 3 — Optimization & Destination */}
        <Section id="placement" n="03" title="Optimización y ubicaciones" sub="Dónde y cómo se entregan los anuncios"
          badge={<span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.05)', color: '#6e6e73' }}>ADSET</span>}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Destino del anuncio" hint="Tu landing en Shopify es el destino. Cambia a WhatsApp si prefieres COD por chat.">
              <select value={destinationType} onChange={(e) => setDestinationType(e.target.value)} style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', background: 'rgba(255,255,255,0.95)', padding: '0 14px', fontSize: 14, fontFamily: 'inherit', color: '#1d1d1f' }}>
                <option value="WEBSITE">Sitio web (landing en Shopify)</option>
                <option value="WHATSAPP">WhatsApp Business</option>
                <option value="MESSENGER">Messenger</option>
                <option value="APP">App store</option>
              </select>
            </Field>
            <Field label="Evento de optimización" hint="Lo que el algoritmo persigue. Compra es el más caro pero el que más vende.">
              <select value={conversionEvent} onChange={(e) => setConversionEvent(e.target.value)} style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', background: 'rgba(255,255,255,0.95)', padding: '0 14px', fontSize: 14, fontFamily: 'inherit', color: '#1d1d1f' }}>
                <option value="PURCHASE">Compra (Purchase) · recomendado</option>
                <option value="ADD_TO_CART">Añadir al carrito</option>
                <option value="INITIATE_CHECKOUT">Iniciar pago</option>
                <option value="LEAD">Cliente potencial</option>
                <option value="VIEW_CONTENT">Ver contenido</option>
              </select>
            </Field>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Ventana de atribución">
              <select value={attribution} onChange={(e) => setAttribution(e.target.value)} style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', background: 'rgba(255,255,255,0.95)', padding: '0 14px', fontSize: 14, fontFamily: 'inherit', color: '#1d1d1f' }}>
                <option value="7d_click_1d_view">7 días click · 1 día view (recomendado)</option>
                <option value="1d_click">1 día click</option>
                <option value="7d_click">7 días click</option>
                <option value="1d_click_1d_view">1 día click · 1 día view</option>
              </select>
            </Field>
            <Field label="Pixel + CAPI" right={<span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', color: MODE.web.badgeFg, padding: '2px 6px', borderRadius: 4, background: MODE.web.badgeBg }}>VERIFICADO</span>}>
              <div style={{ height: 44, padding: '0 14px', borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1.5px solid rgba(0,0,0,0.10)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <i data-lucide="check-circle-2" style={{ width: 14, height: 14, color: MODE.web.accent }}/>
                <span style={{ fontSize: 13, color: '#1d1d1f', fontFamily: '"SF Mono", monospace' }}>{pixelId}</span>
                <span style={{ fontSize: 11, color: '#6e6e73', marginLeft: 'auto' }}>CAPI: {capiEnabled ? 'On' : 'Off'}</span>
              </div>
            </Field>
          </div>

          <div style={{ marginTop: 22 }}>
            <Field label="Ubicaciones (placements)" hint="Automático: Meta elige las mejores. Manual: tú decides dónde aparecer.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <RadioCard value="auto"   current={placementMode} onClick={setPlacementMode} icon="zap"     title="Advantage+ Placements" sub="Meta decide. Mejor CPA promedio."/>
                <RadioCard value="manual" current={placementMode} onClick={setPlacementMode} icon="settings-2" title="Ubicaciones manuales"  sub="Tú eliges Reels, Feed, Historias, etc."/>
              </div>
              {placementMode === 'manual' && (
                <div style={{ marginTop: 14, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(0,0,0,0.05)' }}>
                  {placementGroups.map((g) => (
                    <div key={g.name} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: '#6e6e73', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>{g.name}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {g.items.map((it) => (
                          <Pill key={it.id} on={placements[it.id]} onClick={() => setPlacements({ ...placements, [it.id]: !placements[it.id] })}>
                            {placements[it.id] && <i data-lucide="check" style={{ width: 12, height: 12, strokeWidth: 2.5 }}/>}
                            {it.label}
                          </Pill>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Field>
          </div>

          <div style={{ marginTop: 18 }}>
            <Field label="Dispositivos">
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ id: 'all', label: 'Todos', icon: 'monitor-smartphone' }, { id: 'mobile', label: 'Solo móvil', icon: 'smartphone' }, { id: 'desktop', label: 'Solo desktop', icon: 'monitor' }].map((d) => (
                  <Pill key={d.id} on={devices.includes(d.id)} onClick={() => setDevices([d.id])}>{d.label}</Pill>
                ))}
              </div>
            </Field>
          </div>
        </Section>

        {/* SECTION 4 — Schedule */}
        <Section id="schedule" n="04" title="Calendario" sub="Cuándo empieza y termina la entrega"
          badge={<span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.05)', color: '#6e6e73' }}>ADSET</span>}>

          <Field label="Tipo de programación">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <RadioCard value="continuous" current={scheduleType} onClick={setScheduleType} icon="play"          title="Continuamente" sub="Empieza ahora, sin fecha de fin"/>
              <RadioCard value="dated"      current={scheduleType} onClick={setScheduleType} icon="calendar-range" title="Fecha de inicio y fin" sub="Útil para promos limitadas"/>
            </div>
          </Field>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: scheduleType === 'dated' ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 16 }}>
            <Field label="Fecha de inicio">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: '100%', height: 44, paddingLeft: 14, paddingRight: 14, borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, fontFamily: 'inherit', color: '#1d1d1f', outline: 'none' }}/>
            </Field>
            <Field label="Hora">
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: '100%', height: 44, paddingLeft: 14, paddingRight: 14, borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, fontFamily: 'inherit', color: '#1d1d1f', outline: 'none' }}/>
            </Field>
            {scheduleType === 'dated' && (
              <Field label="Fecha de fin">
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: '100%', height: 44, paddingLeft: 14, paddingRight: 14, borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1.5px solid rgba(0,0,0,0.10)', fontSize: 14, fontFamily: 'inherit', color: '#1d1d1f', outline: 'none' }}/>
              </Field>
            )}
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: '#6e6e73', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i data-lucide="info" style={{ width: 14, height: 14 }}/>
            Zona horaria: <span style={{ fontFamily: '"SF Mono", monospace', color: '#1d1d1f' }}>America/Lima · UTC-5</span>
          </div>
        </Section>

        {/* SECTION 5 — Ads */}
        <Section id="ads" n="05" title={`Anuncios — ${ads.length} videos`} sub="Cada video es un Ad. Edita copy, headline, CTA por anuncio."
          badge={<span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.05)', color: '#6e6e73' }}>AD</span>}>

          {ads.map((c, i) => {
            const a = ANGLES_DATA[c.angle];
            const cp = adCopies[i];
            const setCp = (k, v) => setAdCopies({ ...adCopies, [i]: { ...cp, [k]: v } });
            return (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 16, padding: '14px 0', borderTop: i > 0 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                <div>
                  <div style={{ position: 'relative', aspectRatio: '9/16', borderRadius: 10, background: c.bg, overflow: 'hidden' }}>
                    <i data-lucide="play" style={{ position: 'absolute', inset: 0, margin: 'auto', width: 18, height: 18, color: '#fff', strokeWidth: 2 }}/>
                    <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 700, color: '#fff', padding: '2px 5px', borderRadius: 4, background: 'rgba(0,0,0,0.5)', fontFamily: '"SF Mono", monospace' }}>AD {String(i+1).padStart(2,'0')}</span>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 10, color: '#6e6e73', fontWeight: 600 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 3, background: a.accent }}/>{a.shortLabel}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Field label="Texto principal (primary text)" hint="125 caracteres recomendado. Aparece arriba del video.">
                    <textarea value={cp.primary} onChange={(e) => setCp('primary', e.target.value)} rows={2} maxLength={500} style={{ width: '100%', resize: 'none', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.95)', padding: 10, fontSize: 13, fontFamily: 'inherit', color: '#1d1d1f', outline: 'none', lineHeight: 1.5 }}/>
                    <div style={{ fontSize: 10, color: '#aeaeb2', textAlign: 'right', marginTop: 2, fontFamily: '"SF Mono", monospace' }}>{cp.primary.length} / 500</div>
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px', gap: 10 }}>
                    <Field label="Título (headline)">
                      <input value={cp.headline} onChange={(e) => setCp('headline', e.target.value)} style={{ width: '100%', height: 36, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.95)', padding: '0 10px', fontSize: 13, fontFamily: 'inherit', color: '#1d1d1f', outline: 'none' }}/>
                    </Field>
                    <Field label="Descripción (link description)">
                      <input value={cp.desc} onChange={(e) => setCp('desc', e.target.value)} style={{ width: '100%', height: 36, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.95)', padding: '0 10px', fontSize: 13, fontFamily: 'inherit', color: '#1d1d1f', outline: 'none' }}/>
                    </Field>
                    <Field label="CTA">
                      <select value={cp.cta} onChange={(e) => setCp('cta', e.target.value)} style={{ width: '100%', height: 36, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.95)', padding: '0 10px', fontSize: 13, fontFamily: 'inherit', color: '#1d1d1f' }}>
                        {ctaOptions.map((c) => <option key={c} value={c}>{ctaLabels[c]}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
              </div>
            );
          })}
        </Section>

        {/* SECTION 6 — Tracking */}
        <Section id="tracking" n="06" title="Pixel y tracking" sub="Pixel, CAPI, UTMs, eventos personalizados"
          badge={<span style={{ fontSize: 10, fontFamily: '"SF Mono", monospace', padding: '2px 6px', borderRadius: 4, background: MODE.web.badgeBg, color: MODE.web.badgeFg }}>OK</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Toggle on={capiEnabled} onChange={setCapiEnabled} mode="traffic"/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>Conversions API (CAPI)</div>
                <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>Recibe eventos server-side. Imprescindible con iOS 14+ tracking limitado.</div>
              </div>
              <span style={{ fontSize: 11, fontFamily: '"SF Mono", monospace', padding: '3px 8px', borderRadius: 100, background: MODE.web.badgeBg, color: MODE.web.badgeFg, fontWeight: 600 }}>EQM 9.4/10</span>
            </div>
            <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Toggle on={utmEnabled} onChange={setUtmEnabled} mode="traffic"/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>UTMs automáticos</div>
                <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>Añado <span style={{ fontFamily: '"SF Mono", monospace' }}>utm_source=fb&utm_campaign={'{{campaign.name}}'}&utm_content={'{{ad.id}}'}</span></div>
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* RIGHT — Sticky summary */}
      <div style={{ position: 'sticky', top: 16, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <GlassCard padding={0}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
            <Eyebrow color={m.badgeFg}>Resumen estimado · 7 días</Eyebrow>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Inversión</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1d1d1f', fontFamily: '"SF Mono", monospace', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5, marginTop: 2 }}>S/ {(dailyBudget * 7).toFixed(0)}</div>
              <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>S/ {dailyBudget.toFixed(0)}/día</div>
            </div>
            <div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }}/>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Alcance</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f', fontFamily: '"SF Mono", monospace', marginTop: 2 }}>~{Math.round(estReach/1000)}k</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Ventas</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: MODE.web.accent, fontFamily: '"SF Mono", monospace', marginTop: 2 }}>~{estResults}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>CPA</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: m.accent, fontFamily: '"SF Mono", monospace', marginTop: 2 }}>S/ {estCPA}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#6e6e73', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>ROAS</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: MODE.web.accent, fontFamily: '"SF Mono", monospace', marginTop: 2 }}>{estROAS}×</div>
              </div>
            </div>
            <div style={{ padding: 8, borderRadius: 8, background: m.badgeBg, fontSize: 11, color: m.badgeFg, lineHeight: 1.4 }}>
              <i data-lucide="info" style={{ width: 12, height: 12, marginRight: 4, verticalAlign: '-2px' }}/>
              Estimación basada en tu pixel + benchmarks de tu vertical en Perú.
            </div>
          </div>
        </GlassCard>

        {/* Config summary */}
        <GlassCard padding={0}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
            <Eyebrow>Configuración</Eyebrow>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            {[
              { l: 'Objetivo',      v: 'Ventas (Sales)' },
              { l: 'Estructura',    v: budgetType },
              { l: 'Puja',          v: bidStrategy === 'LOWEST_COST' ? 'Costo más bajo' : bidStrategy === 'COST_CAP' ? `Cost cap S/${bidAmount}` : `Bid cap S/${bidAmount}` },
              { l: 'Audiencia',      v: `Lima+Callao · ${ageMin}-${ageMax} · ${interests.length} intereses` },
              { l: 'Ubicaciones',   v: placementMode === 'auto' ? 'Advantage+' : `${Object.values(placements).filter(Boolean).length} manual` },
              { l: 'Destino',        v: destinationType === 'WEBSITE' ? 'Sitio web' : destinationType === 'WHATSAPP' ? 'WhatsApp' : 'Messenger' },
              { l: 'Pixel + CAPI',   v: capiEnabled ? 'Activo' : 'Solo Pixel' },
              { l: 'Anuncios',       v: `${ads.length} videos` },
            ].map((r) => (
              <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#6e6e73' }}>{r.l}</span>
                <span style={{ color: '#1d1d1f', fontWeight: 600, fontFamily: r.l === 'Estructura' || r.l === 'Pixel + CAPI' ? '"SF Mono", monospace' : 'inherit' }}>{r.v}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <Button variant="primary" mode="traffic" icon="rocket" onClick={onNext} fullWidth disabled={!metaConnected} style={{ height: 56, fontSize: 15, opacity: metaConnected ? 1 : 0.5, cursor: metaConnected ? 'pointer' : 'not-allowed' }}>
          {metaConnected ? `Lanzar · S/ ${budget}/día` : 'Conecta Meta primero'}
        </Button>
        <div style={{ textAlign: 'center', fontSize: 11, color: '#6e6e73', lineHeight: 1.4 }}>
          Yo creo la campaña como borrador en tu Meta Business. Tú das publish final desde Ads Manager.
        </div>
      </div>
    </div>
  );
};

window.Launch = Launch;

// Sidebar + TopBar — adapted for Replik flow (Onboarding → 5 steps → Dashboard)

const Sidebar = ({ activeMode, currentScreen, onNavigate, productName }) => {
  const sectionStyle = { padding: '14px 18px 6px', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: '#aeaeb2' };

  const NavItem = ({ icon, label, target, mode, badge, disabled }) => {
    const m = mode ? MODE[mode] : null;
    const active = currentScreen === target;
    const [hover, setHover] = React.useState(false);
    return (
      <div
        onClick={() => !disabled && onNavigate(target)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', margin: '2px 8px',
          borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.42 : 1,
          background: active ? 'rgba(255,255,255,0.92)' : (hover && !disabled ? 'rgba(0,0,0,0.04)' : 'transparent'),
          boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.90)' : 'none',
          border: active ? '1px solid rgba(255,255,255,0.80)' : '1px solid transparent',
          transition: 'background 150ms ease',
        }}>
        <i data-lucide={icon} style={{ width: 18, height: 18, strokeWidth: 1.5, color: active && m ? m.accent : (active ? '#1d1d1f' : '#6e6e73') }} />
        <span style={{ fontSize: 14, fontWeight: active ? 600 : 500, color: active && m ? m.accent : '#1d1d1f', flex: 1 }}>{label}</span>
        {badge && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: m ? m.badgeBg : 'rgba(0,0,0,0.06)', color: m ? m.badgeFg : '#6e6e73', fontVariantNumeric: 'tabular-nums' }}>{badge}</span>
        )}
      </div>
    );
  };

  return (
    <aside style={{
      width: 240, height: '100%',
      background: 'rgba(255,255,255,0.60)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderRight: '1px solid rgba(0,0,0,0.06)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      position: 'relative', zIndex: 2,
    }}>
      <div style={{ padding: '20px 18px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="assets/logo.svg" style={{ height: 22 }} alt="replik.ai"/>
      </div>

      <div style={sectionStyle}>Espacio de trabajo</div>
      <NavItem icon="layout-dashboard" label="Dashboard" target="dashboard" mode="live" badge="4" />
      <NavItem icon="plus-circle" label="Nuevo producto" target="add-product" />

      <div style={sectionStyle}>Producto actual</div>
      {productName ? (
        <div style={{ margin: '0 8px 4px', padding: '10px 12px', background: 'rgba(255,255,255,0.85)', borderRadius: 10, border: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{productName}</div>
          <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2, fontFamily: '"SF Mono", monospace' }}>Test #2026-04-29</div>
        </div>
      ) : (
        <div style={{ margin: '0 8px 4px', padding: '10px 12px', fontSize: 12, color: '#aeaeb2', fontStyle: 'italic' }}>Ningún producto seleccionado</div>
      )}
      <NavItem icon="film" label="Creativos" target="creatives" mode="creative" disabled={!productName} />
      <NavItem icon="store" label="Landing" target="landing" mode="web" disabled={!productName} />
      <NavItem icon="megaphone" label="Trafficker" target="launch" mode="traffic" disabled={!productName} />

      <div style={{ flex: 1 }} />

      <div style={sectionStyle}>Cuenta</div>
      <NavItem icon="link" label="Integraciones" target="integrations" />
      <NavItem icon="settings" label="Configuración" target="settings" />
      <div style={{ padding: 12, margin: '4px 8px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#5fb3ff,#0a84ff)', color: '#fff', fontWeight: 600, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>RP</div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>Rodrigo Paz</span>
          <span style={{ fontSize: 11, color: '#6e6e73' }}>Lima · Operador</span>
        </div>
      </div>
    </aside>
  );
};

const FLOW_STEPS = ['Producto', 'Creativos', 'Landing', 'Lanzar'];

const TopBar = ({ crumb, mode, currentStepIdx, onModeAction, actionLabel, actionIcon }) => {
  const m = mode ? MODE[mode] : MODE.live;
  const showSteps = currentStepIdx != null;
  return (
    <div style={{
      height: 56, flexShrink: 0,
      background: 'rgba(255,255,255,0.72)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      display: 'flex', alignItems: 'center', padding: '0 24px',
      position: 'relative', zIndex: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 240 }}>
        {mode && <ModeBadge mode={mode} dot />}
        {crumb && <i data-lucide="chevron-right" style={{ width: 14, height: 14, color: '#aeaeb2', strokeWidth: 1.5 }} />}
        {crumb && <span style={{ fontSize: 13, color: '#1d1d1f', fontWeight: 500 }}>{crumb}</span>}
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        {showSteps && <StepProgress steps={FLOW_STEPS} current={currentStepIdx} mode={mode || 'web'} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 240, justifyContent: 'flex-end' }}>
        <button style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)', background: 'rgba(255,255,255,0.85)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <i data-lucide="bell" style={{ width: 16, height: 16, strokeWidth: 1.5, color: '#1d1d1f' }} />
        </button>
        <button style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)', background: 'rgba(255,255,255,0.85)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <i data-lucide="help-circle" style={{ width: 16, height: 16, strokeWidth: 1.5, color: '#1d1d1f' }} />
        </button>
        {onModeAction && (
          <Button variant="primary" mode={mode || 'live'} icon={actionIcon || 'sparkles'} onClick={onModeAction} style={{ height: 36, padding: '0 14px', fontSize: 13 }}>{actionLabel || 'Replik'}</Button>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { Sidebar, TopBar, FLOW_STEPS });

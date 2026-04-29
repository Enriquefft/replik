// Shared UI primitives for Replik.ai
// Loaded as window globals so other JSX files can use them.

const Icon = ({ name, size = 16, color = 'currentColor', strokeWidth = 1.5, style = {} }) => (
  <i data-lucide={name} style={{ width: size, height: size, color, strokeWidth, display: 'inline-flex', ...style }} />
);

const MODE = {
  web:      { key: 'web',      label: 'Landing',    accent: '#30d158', rgb: '48,209,88',   badgeBg: 'rgba(48,209,88,0.12)',  badgeFg: '#1a7a34', glow: 'rgba(48,209,88,0.18)' },
  creative: { key: 'creative', label: 'Creativos',  accent: '#ff9f0a', rgb: '255,159,10',  badgeBg: 'rgba(255,159,10,0.12)', badgeFg: '#8a5200', glow: 'rgba(255,159,10,0.18)' },
  traffic:  { key: 'traffic',  label: 'Trafficker', accent: '#ff453a', rgb: '255,69,58',   badgeBg: 'rgba(255,69,58,0.10)',  badgeFg: '#a30f0a', glow: 'rgba(255,69,58,0.15)' },
  live:     { key: 'live',     label: 'En vivo',    accent: '#0a84ff', rgb: '10,132,255',  badgeBg: 'rgba(10,132,255,0.10)', badgeFg: '#0040aa', glow: 'rgba(10,132,255,0.15)' },
  system:   { key: 'system',   label: 'Sistema',    accent: '#bf5af2', rgb: '191,90,242',  badgeBg: 'rgba(191,90,242,0.12)', badgeFg: '#6b1f9a', glow: 'rgba(191,90,242,0.18)' },
};

const ModeBadge = ({ mode, children, dot, style = {} }) => {
  const m = MODE[mode];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px',
      borderRadius: 100, background: m.badgeBg, color: m.badgeFg,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)', ...style
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 3, background: m.accent }} />}
      {children || m.label}
    </span>
  );
};

const Button = ({ variant = 'primary', mode = 'live', children, onClick, icon, style = {}, fullWidth }) => {
  const m = MODE[mode];
  const base = {
    height: 44, padding: '0 20px', borderRadius: 12,
    fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    border: 'none', transition: 'transform 200ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease',
    width: fullWidth ? '100%' : 'auto',
  };
  const variants = {
    primary:   { background: m.accent, color: '#fff', boxShadow: `0 4px 12px rgba(${m.rgb},0.35)` },
    secondary: { background: 'rgba(0,0,0,0.05)', color: '#1d1d1f', border: '1px solid rgba(0,0,0,0.10)' },
    ghost:     { background: 'transparent', color: m.accent, border: `1.5px solid ${m.accent}` },
  };
  const [pressed, setPressed] = React.useState(false);
  return (
    <button onClick={onClick}
      style={{ ...base, ...variants[variant], transform: pressed ? 'scale(0.98)' : 'scale(1)', ...style }}
      onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)} onMouseLeave={() => setPressed(false)}>
      {icon && <Icon name={icon} size={16} />}{children}
    </button>
  );
};

const Input = ({ value, onChange, placeholder, mode = 'live', icon, style = {}, type = 'text' }) => {
  const m = MODE[mode];
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
      {icon && <i data-lucide={icon} style={{ position: 'absolute', left: 14, color: '#aeaeb2', width: 16, height: 16, strokeWidth: 1.5 }} />}
      <input
        type={type} value={value || ''} placeholder={placeholder}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          height: 44, width: '100%', borderRadius: 12, paddingLeft: icon ? 38 : 14, paddingRight: 14,
          background: 'rgba(255,255,255,0.90)',
          border: focused ? `1.5px solid ${m.accent}` : '1.5px solid rgba(0,0,0,0.10)',
          boxShadow: focused ? `0 0 0 3px ${m.badgeBg}` : 'none',
          fontSize: 15, color: '#1d1d1f', fontFamily: 'inherit', outline: 'none',
          transition: 'border-color 200ms ease, box-shadow 200ms ease',
        }}
      />
    </div>
  );
};

const Toggle = ({ on, onChange, mode = 'web' }) => {
  const m = MODE[mode];
  return (
    <div onClick={() => onChange && onChange(!on)}
      style={{
        width: 51, height: 31, borderRadius: 100, position: 'relative', flexShrink: 0,
        background: on ? m.accent : 'rgba(0,0,0,0.12)',
        cursor: 'pointer', transition: 'background 200ms ease',
      }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 22 : 2, width: 27, height: 27, borderRadius: '50%',
        background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        transition: 'left 250ms cubic-bezier(0.34,1.56,0.64,1)',
      }} />
    </div>
  );
};

const GlassCard = ({ children, style = {}, mode, padding = 20, onClick }) => (
  <div onClick={onClick} style={{
    position: 'relative',
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.80)',
    borderRadius: 20,
    padding,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.90)',
    cursor: onClick ? 'pointer' : 'default',
    ...style,
  }}>{children}</div>
);

const Orbs = ({ mode = 'web', secondary = 'creative' }) => {
  const m = MODE[mode], s = MODE[secondary];
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      <div style={{ position: 'absolute', width: 480, height: 480, borderRadius: '50%', filter: 'blur(160px)', opacity: 0.09, background: m.accent, top: -160, right: -120 }} />
      <div style={{ position: 'absolute', width: 360, height: 360, borderRadius: '50%', filter: 'blur(140px)', opacity: 0.05, background: s.accent, bottom: -160, left: -100 }} />
    </div>
  );
};

const Eyebrow = ({ children, color = '#6e6e73', style = {} }) => (
  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color, ...style }}>{children}</div>
);

const StepProgress = ({ steps, current, mode = 'web' }) => {
  const m = MODE[mode];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 100, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600,
                background: done ? m.badgeBg : (active ? m.accent : 'transparent'),
                color: done ? m.badgeFg : (active ? '#fff' : '#aeaeb2'),
                border: !done && !active ? '1.5px solid rgba(0,0,0,0.10)' : 'none',
                boxShadow: active ? `0 4px 12px rgba(${m.rgb},0.35)` : 'none',
                fontVariantNumeric: 'tabular-nums',
              }}>{done ? '✓' : i + 1}</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: done || active ? '#1d1d1f' : '#aeaeb2' }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ width: 32, height: 0, borderTop: '1px dashed rgba(0,0,0,0.15)', margin: '0 12px' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

Object.assign(window, { Icon, MODE, ModeBadge, Button, Input, Toggle, GlassCard, Orbs, Eyebrow, StepProgress });

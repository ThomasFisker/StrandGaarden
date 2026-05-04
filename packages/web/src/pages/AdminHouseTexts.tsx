export const AdminHouseTextsPage = () => (
  <main className="content">
    <p className="eyebrow">Administration</p>
    <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
      Hustekster
    </h1>
    <p className="lede">
      Hver hus kan i fase 1 skrive en kort tekst til bogen via siden "Mine billeder". Her får
      udvalget et samlet overblik.
    </p>
    <div
      style={{
        marginTop: '2rem',
        padding: '1.5rem 1.75rem',
        background: 'var(--paper-warm, #faf2e6)',
        borderLeft: '3px solid var(--copper, #b85a2a)',
      }}
    >
      <p style={{ margin: 0 }}>
        <strong>Aktiveres når fase 1 starter.</strong> Selve redigeringen sker hos husets medlemmer på
        siden "Mine billeder". Indtil da er der ikke noget at vise.
      </p>
    </div>
  </main>
);

import { Link } from 'react-router-dom';

/**
 * Help for the Bestyrelsen (Cognito group `board`) — meetings, documents
 * and user administration. Reached from the "Hjælp" card on /bestyrelse.
 * Kept out of the public /hjaelp so ordinary members aren't confused.
 */
export const BestyrelsenHelpPage = () => (
  <main className="content help-page">
    <p className="eyebrow">Bestyrelsen · hjælp</p>
    <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
      Hjælp til <em>Bestyrelsen</em>
    </h1>
    <p className="lede">
      Bestyrelsen står for møder, dokumenter og brugere — alt det, der ikke handler om billeder. Du
      finder værktøjerne under <Link to="/bestyrelse">Bestyrelsen</Link> i toppen.
    </p>

    <nav className="help-toc" style={{ margin: '2rem 0' }}>
      <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Indhold</p>
      <ol>
        <li><a href="#overblik">Overblik</a></li>
        <li><a href="#roller">Roller og adgang</a></li>
        <li><a href="#brugere">Brugere — opret og administrér</a></li>
        <li><a href="#moder">Møder</a></li>
        <li><a href="#dokumenter">Dokumenter</a></li>
        <li><a href="#kategorier">Dokument-kategorier</a></li>
        <li><a href="#privatliv">Privatliv — vigtigt før upload</a></li>
      </ol>
    </nav>

    <section id="overblik" style={{ marginTop: '2.5rem' }}>
      <h2>1. Overblik</h2>
      <p>
        Forsiden <Link to="/bestyrelse">Bestyrelsen</Link> samler opgaverne som kort: møder,
        dokumenter, brugere — og for administratorer også dokument-kategorier. Hvert kort viser et
        lille tal med, hvor meget der ligger.
      </p>
    </section>

    <section id="roller" style={{ marginTop: '2.5rem' }}>
      <h2>2. Roller og adgang</h2>
      <p>
        Hver bruger har en rolle, der bestemmer, hvad de kan. En bruger kan have flere roller — så
        gælder den højeste adgang. De fem roller er:
      </p>
      <table className="help-table">
        <thead>
          <tr><th>Rolle</th><th>Kan</th></tr>
        </thead>
        <tbody>
          <tr><td><strong>Kigger</strong></td><td>Se og søge i billederne. Kan ikke uploade.</td></tr>
          <tr><td><strong>Medlem</strong></td><td>Det almindelige medlem: uploade billeder, skrive hustekst, melde huset klar, se dokumenter.</td></tr>
          <tr><td><strong>Redaktion</strong></td><td>Alt det redaktionelle billedarbejde (gennemgang, bog, personer, kategorier, faser, hustekster).</td></tr>
          <tr><td><strong>Bestyrelse</strong></td><td>Møder, dokumenter og brugeradministration.</td></tr>
          <tr><td><strong>Administrator</strong></td><td>Alt — inkl. dokument-kategorier og systemindstillinger.</td></tr>
        </tbody>
      </table>
      <p className="help">
        De fleste menige medlemmer skal blot have rollen <strong>Medlem</strong>. Giv kun
        Redaktion/Bestyrelse til dem, der faktisk skal arbejde med værktøjerne.
      </p>
    </section>

    <section id="brugere" style={{ marginTop: '2.5rem' }}>
      <h2>3. Brugere — opret og administrér</h2>
      <p>
        Under <Link to="/admin/users">Brugere</Link> opretter og administrerer du medlemmerne.
      </p>
      <h3 style={{ marginTop: '1rem' }}>Opret en ny bruger</h3>
      <ol>
        <li>Klik <strong>Opret bruger</strong> og indtast e-mail, et login-navn (det viste navn) og vælg rolle.</li>
        <li>Giv en start-adgangskode (fx <code>Strandgaarden100</code>). Den skal være mindst 8 tegn og indeholde mindst ét tal.</li>
        <li>Fortæl medlemmet deres e-mail og start-adgangskode — fx i velkomstmailen. De kan selv skifte kode bagefter.</li>
      </ol>
      <h3 style={{ marginTop: '1rem' }}>Administrér en eksisterende bruger</h3>
      <ul>
        <li><strong>Skift rolle:</strong> giv eller fjern adgang (Kigger / Medlem / Redaktion / Bestyrelse / Administrator).</li>
        <li><strong>Tildel hus:</strong> sæt brugerens hus-nummer. Det styrer, hvilket hus de uploader til i fase 1, og hvilken hustekst de kan redigere. Flere medlemmer kan dele samme hus.</li>
        <li><strong>Omdøb login-navn:</strong> ret det viste navn.</li>
        <li>
          <strong>Nulstil adgangskode:</strong> sæt en ny kode. Den vises på skærmen, så du kan læse
          den højt eller sende den til medlemmet — der sendes ingen e-mail.
        </li>
        <li><strong>Slet:</strong> fjern brugeren helt.</li>
      </ul>
      <p className="help">
        Tip: hvis et medlem ikke kan logge ind og selvbetjeningen (<em>Glemt adgangskode</em>) driller,
        er den hurtigste hjælp at nulstille koden her og læse den nye kode op for dem.
      </p>
    </section>

    <section id="moder" style={{ marginTop: '2.5rem' }}>
      <h2>4. Møder</h2>
      <p>
        Under <Link to="/bestyrelse/moder">Møder</Link> opretter du bestyrelsesmøder og
        generalforsamlinger med dato og titel. Klik på et møde for at se og uploade de tilhørende
        dokumenter — referater, indkaldelser og bilag samles ét sted under mødet.
      </p>
    </section>

    <section id="dokumenter" style={{ marginTop: '2.5rem' }}>
      <h2>5. Dokumenter</h2>
      <p>
        Under <Link to="/bestyrelse/dokumenter">Dokumenter</Link> uploader du selvstændige dokumenter,
        der ikke hører til et bestemt møde — sange, historiske dokumenter, vedtægter, årsregnskaber osv.
      </p>
      <ul>
        <li>Vælg <strong>kategori</strong> og <strong>år</strong>, og knyt eventuelt dokumentet til et møde.</li>
        <li>Du kan tilføje en kort beskrivelse og nøgleord, så det er nemmere at finde.</li>
        <li>Medlemmer kan filtrere på år, kategori og møde, og åbne PDF&apos;er direkte i browseren eller hente dem ned.</li>
      </ul>
    </section>

    <section id="kategorier" style={{ marginTop: '2.5rem' }}>
      <h2>6. Dokument-kategorier <span className="subtle">(kun Administrator)</span></h2>
      <p>
        Under <Link to="/bestyrelse/dokument-kategorier">Dokument-kategorier</Link> kan administratorer
        tilføje, omdøbe eller slette de kategorier, der kan vælges, når man uploader et dokument.
      </p>
    </section>

    <section id="privatliv" style={{ marginTop: '2.5rem' }}>
      <h2>7. Privatliv — vigtigt før upload</h2>
      <p className="help">
        Dokumenter er synlige for <strong>alle medlemmer</strong>. Sørg derfor for, at personlige
        oplysninger er fjernet eller anonymiseret, før du uploader — fx navne i konfliktsager,
        kontonumre, CPR-numre og lignende. Er du i tvivl, så lad være med at uploade, og vend det med
        den øvrige bestyrelse først.
      </p>
    </section>

    <p style={{ marginTop: '2.5rem' }}>
      <Link to="/bestyrelse" className="btn-primary">← Tilbage til Bestyrelsen</Link>
    </p>
  </main>
);

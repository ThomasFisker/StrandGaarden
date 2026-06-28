import { Link } from 'react-router-dom';
import { useSession } from '../session';

/**
 * Public help page ("Sådan bruger du siden"). Visible whether or not the
 * caller is signed in, so the welcome email can link to it before the
 * recipient has logged in.
 *
 * Deliberately focused on what ordinary members need: logging in and
 * uploading photos for the jubilee book. Help for the Redaktionen and
 * Bestyrelsen tools lives behind the "Hjælp" card inside those sections
 * (/admin/hjaelp and /bestyrelse/hjaelp) — kept out of here so it doesn't
 * confuse ordinary members.
 */
export const HelpPage = () => {
  const { session } = useSession();
  const signedIn = !!session;

  return (
    <main className="content help-page">
      <p className="eyebrow">Strandgaarden · 100 års jubilæumsbog</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Sådan bruger du <em>siden</em>
      </h1>
      <p className="lede">
        Denne side er for alle medlemmer af Strandgaarden I/S. Læs fra toppen, eller spring til den
        sektion, der er relevant for dig.
      </p>

      <nav className="help-toc" style={{ margin: '2rem 0' }}>
        <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Indhold</p>
        <ol>
          <li><a href="#login">Sådan logger du ind</a></li>
          <li><a href="#first-time">Første gang du logger ind</a></li>
          <li><a href="#adgangskode">Adgangskode</a></li>
          <li><a href="#fase1">Fase 1 – det du skal gøre</a></li>
          <li><a href="#vigtigt">Vigtigt i Fase 1</a></li>
          <li><a href="#sporgsmaal">Spørgsmål?</a></li>
          <li><a href="#fase2">Fase 2 – Galleriet</a></li>
        </ol>
      </nav>

      <section id="login" style={{ marginTop: '2.5rem' }}>
        <h2>1. Sådan logger du ind</h2>
        <p>
          Du har fået en e-mail fra Strandgaarden med dit login (e-mail og start-adgangskode). Gå til
          forsiden og klik <strong>Log ind</strong> øverst.
        </p>
        <ul>
          <li><strong>E-mail:</strong> Den adresse, du fik din velkomstmail på.</li>
          <li><strong>Adgangskode:</strong> <code>Strandgaarden100</code>, hvis det er første gang.</li>
        </ul>
        <p>Du kan skifte adgangskode når som helst — se afsnit 3.</p>
        {!signedIn && (
          <p>
            <Link to="/login" className="btn-primary" style={{ marginTop: '0.5rem' }}>
              Gå til login
            </Link>
          </p>
        )}
      </section>

      <section id="first-time" style={{ marginTop: '2.5rem' }}>
        <h2>2. Første gang du logger ind</h2>
        <p>
          Første gang du logger ind, skal du læse og acceptere persondatapolitikken, før du kan komme
          videre. Du kan altid læse den igen under <em>Vilkår og samtykke</em>.
        </p>

        <h3 style={{ marginTop: '1rem' }}>GDPR og brug af billeder</h3>
        <p>
          <strong>Billeder i bogen.</strong> Bogen vil indeholde billeder fra fælles arrangementer
          samt jeres egne bidrag. Når du indsender et billede, giver du samtidig samtykke til, at det
          må bruges i bogen.
        </p>
        <p>
          Hvis der er andre personer på dine billeder, går vi ud fra, at de er indforståede med, at
          billedet deles og bruges i denne sammenhæng.
        </p>
        <p>
          Ønsker du generelt ikke at optræde på billeder taget af andre ved fælles arrangementer, må
          du gerne give os besked, så vi kan tage hensyn til det.
        </p>
        <p className="help">
          Vær dog opmærksom på, at det kan være svært at sikre i praksis. Det kræver, at vi kan
          genkende dig på tværs af mange billeder, situationer og aldre — også på billeder med flere
          personer. Vi gør naturligvis vores bedste, men kan desværre ikke garantere, at det altid
          lykkes.
        </p>
      </section>

      <section id="adgangskode" style={{ marginTop: '2.5rem' }}>
        <h2>3. Adgangskode</h2>
        <p>
          <strong>Skift adgangskode:</strong> Du kan vælge din egen kode i stedet for{' '}
          <code>Strandgaarden100</code>. Vælg <em>Sæt min egen</em> eller <em>Behold den jeg fik</em>.
          Du kan altid skifte senere via <em>Glemt adgangskode</em>.
        </p>
        <p><strong>Glemt adgangskode?</strong> Sådan får du en ny:</p>
        <ol>
          <li>Gå til login-siden.</li>
          <li>Klik <strong>Glemt adgangskode?</strong></li>
          <li>Indtast din e-mail — du får en 6-cifret kode (tjek også spam-mappen).</li>
          <li>Indtast koden og vælg en ny adgangskode (mindst 8 tegn og mindst 1 ciffer).</li>
        </ol>
        <p className="help">
          Kommer koden ikke inden for et par minutter, så send en SMS til Thomas Fisker
          (mob. 50 32 43 20).
        </p>
      </section>

      <section id="fase1" style={{ marginTop: '2.5rem' }}>
        <h2>4. Fase 1 – det du skal gøre</h2>
        <p>
          Vi indsamler billeder og tekst fra alle 23 huse og sætter derefter bogen sammen. Deadlines
          er faste og kan ikke forhandles:
        </p>
        <table className="help-table">
          <thead>
            <tr>
              <th>Hvad</th>
              <th>Deadline</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Husbilleder og tekst</td>
              <td>31. oktober 2026</td>
            </tr>
            <tr>
              <td>Jubilæumsbilleder fra festen den 10. juli 2027</td>
              <td>15. august 2027</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: '1.5rem' }}>Upload billeder</h3>
        <p>
          Bland gerne vandrette og lodrette billeder. Klik <strong>Upload billede</strong> for at dele
          et af dine egne billeder. Udfyld:
        </p>
        <ul>
          <li>
            <strong>Billedfil:</strong> JPEG, PNG, TIFF eller HEIC. Brug originalen (typisk over 2 MB)
            — mindst 800 pixel på den længste side, 1500+ anbefales for at komme med i bogen. Maks 100 MB.
          </li>
          <li>
            <strong>Hvad kan billederne vise?</strong>
            <ul>
              <li>Huset udefra</li>
              <li>Have/grund</li>
              <li>Særlige detaljer</li>
              <li>Stemningsbilleder med ejere og familie</li>
            </ul>
          </li>
          <li>Variation er bedre end mange ens billeder.</li>
          <li>
            Har du historiske, scannede billeder, så upload dem på samme måde — brug en så høj
            opløsning som muligt af papirbilledet.
          </li>
        </ul>

        <h3 style={{ marginTop: '1.5rem' }}>Mine billeder</h3>
        <p>
          Klik <strong>Mine billeder</strong> for at se alle dine egne uploads. I Fase 1 er der tre faner:
        </p>
        <ul>
          <li>
            <strong>Mine Hus Billeder:</strong> Billeder, hvor du har valgt dit hus. Brug pilene
            <em> ↑↓</em> til at rangere dine favoritter.
          </li>
          <li>
            <strong>Mine Kategori Billeder:</strong> Billeder, du har lagt i en fælleskategori.
          </li>
          <li>
            <strong>Min Hus Tekst:</strong> En kort tekst (max 2000 tegn, ca. 400 ord), som dit hus
            bidrager med. Bruges som tekst på jeres sider.
          </li>
        </ul>
        <p>
          På hvert billede er der en knap, <strong>Se detaljer / rediger</strong>. Klik for at rette
          beskrivelse, år eller personer — eller flytte billedet til en anden kategori.
        </p>
        <p>
          Du kan også <strong>slette dine egne billeder</strong> i Fase 1: klik <strong>Slet billede</strong>{' '}
          på billedet og bekræft. (I Fase 2 er siden låst, og når Galleriet er åbent, beder du i
          stedet Redaktionen om at fjerne et billede.)
        </p>
        <p className="help">
          <strong>Vigtigt:</strong> Vi forbeholder os retten til at lave små rettelser i din tekst
          (grammatik, afsnit og ordstilling) uden at ændre mening, tone eller ordvalg. Vi forbeholder
          os også retten til at vælge det antal billeder, der passer til opsætningen af din side, ud
          fra dine præferencer.
        </p>
      </section>

      <section id="vigtigt" style={{ marginTop: '2.5rem' }}>
        <h2>5. Vigtigt i Fase 1</h2>
        <ul>
          <li>
            <strong>GDPR:</strong> Ønsker du overhovedet ikke at være med på billeder, så udfyld
            anmodningen på hjemmesiden eller send en e-mail til Charlotte Jensen
            (charlottehjen@gmail.com).
          </li>
          <li>
            <strong>Husbilleder:</strong> Læg mellem 3 og 7 billeder ind til din side, i rækkefølge
            1–7 efter præference. Billederne kommer med efter plads — altså afhængigt af, hvor meget
            tekst du sender ind.
          </li>
          <li>
            <strong>Kategori-/fællesbilleder:</strong> Upload i de forskellige kategorier — fx
            aktiviteter (Sct. Hans, Vejdag osv.). Disse bruges som nøgleord i Fase 1.
          </li>
        </ul>
      </section>

      <section id="sporgsmaal" style={{ marginTop: '2.5rem' }}>
        <h2>6. Spørgsmål?</h2>
        <p>Har vi spørgsmål til dine billeder eller din tekst, kontakter vi dig.</p>
        <p>
          Har du selv spørgsmål til <strong>bog og indhold</strong>, så ring til Charlotte Jensen
          (23 20 33 22), så finder vi en løsning.
        </p>
        <p>
          Har du spørgsmål til det mere <strong>tekniske</strong>, så skriv en e-mail til Thomas på{' '}
          <a href="mailto:thomas.f.madsen@outlook.com">thomas.f.madsen@outlook.com</a> eller ring
          (50 32 43 20).
        </p>
      </section>

      <section id="fase2" style={{ marginTop: '2.5rem' }}>
        <h2>7. Fase 2 – Galleriet (efter jubilæumsbogen)</h2>
        <p>
          Når jubilæumsbogen er udgivet i efteråret 2027, åbner vi Galleriet. Her kan du lægge flere
          billeder ind og interagere med de andre. Sammen er I med til at skabe Strandgaardens
          hjemmeside med billeder, kommentarer, tekster og tagging af jeres kære — og I kan se alle de
          andre medlemmers billeder og tekster. Det er et fælles projekt fra fortiden og nutiden til
          fremtiden.
        </p>
        <p>
          I Fase 1 er Galleriet endnu ikke synligt. Du kan dog allerede nu udfylde følgende på dine
          egne billeder. Det kommer ikke med i billedbogen, men først i Galleriet senere:
        </p>
        <ul>
          <li><strong>Beskrivelse:</strong> Fortæl historien — hvor, hvornår, hvem og hvad der sker.</li>
          <li><strong>År:</strong> Ca.-årstal er fint, hvis du ikke kan huske præcist.</li>
          <li><strong>Tag personer:</strong> Vælg navne fra listen, eller foreslå nye.</li>
        </ul>
        <p className="help">
          Til info: Dokumenter tilføjer vi, når der er tid — måske i Fase 1, ellers i Fase 2. Det kan
          være referater, mødeindkaldelser, årsregnskaber, historiske dokumenter osv. Du kan filtrere
          på år, kategori og specifikt møde til den tid. Klik på et dokument for at se det — PDF'er
          vises direkte i browseren, og du kan også hente filen ned.
        </p>
      </section>

      <p style={{ marginTop: '2rem', color: 'var(--ink-soft)' }}>
        Tak fordi du er med til at fejre Strandgaardens 100 år.
      </p>

      <p className="help" style={{ marginTop: '2rem' }}>
        Er du med i <strong>Redaktionen</strong> eller <strong>Bestyrelsen</strong>? Så finder du
        vejledning til de værktøjer under <em>Hjælp</em>-kortet inde i din egen sektion
        (Redaktionen henholdsvis Bestyrelsen i toppen).
      </p>
    </main>
  );
};

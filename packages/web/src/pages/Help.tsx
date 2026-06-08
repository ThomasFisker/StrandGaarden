import { Link } from 'react-router-dom';
import { useSession } from '../session';

/**
 * Public help page. Visible whether or not the caller is signed in, so
 * the welcome email can link to it before the recipient has logged in.
 * One long page with an anchor list at the top — easiest for elderly
 * readers to scan; no role-gated subsections.
 */
export const HelpPage = () => {
  const { session } = useSession();
  const signedIn = !!session;
  return (
    <main className="content help-page">
      <p className="eyebrow">Hjælp</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Sådan bruger du <em>siden</em>
      </h1>
      <p className="lede">
        Denne side er for alle medlemmer af Strandgaarden Interessentskab — både Kikker, Medlem,
        Redaktion og Bestyrelse. Start fra toppen, eller spring direkte til den sektion der er
        relevant for dig.
      </p>

      <nav className="help-toc" style={{ margin: '2rem 0' }}>
        <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Indhold</p>
        <ol>
          <li><a href="#login">Sådan logger du ind</a></li>
          <li><a href="#first-time">Første gang du logger ind</a></li>
          <li><a href="#glemt">Glemt adgangskode</a></li>
          <li><a href="#medlem">Hvad kan du som medlem</a></li>
          <li><a href="#udvalg">Hvad kan Redaktionen</a></li>
          <li><a href="#bestyrelse">Hvad kan Bestyrelsen</a></li>
          <li><a href="#sporgsmaal">Spørgsmål?</a></li>
        </ol>
      </nav>

      <section id="login" style={{ marginTop: '2.5rem' }}>
        <h2>1. Sådan logger du ind</h2>
        <p>
          Du har modtaget en email fra Strandgaarden med din login-email og en start-adgangskode.
          Gå til forsiden og klik <strong>Log ind</strong> øverst.
        </p>
        <ul>
          <li><strong>E-mail:</strong> Den email du fik velkomst-mailen til.</li>
          <li><strong>Adgangskode:</strong> <code>Strandgaarden100</code> hvis det er din første gang.</li>
        </ul>
        <p>
          Du kan skifte adgangskode når som helst — se afsnit 3 nedenfor.
        </p>
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
        <p>To ting sker første gang:</p>
        <ol>
          <li>
            <strong>GDPR-tekst:</strong> Du skal læse og acceptere persondatapolitikken før du kan
            komme videre. Du kan altid læse den igen under <em>/samtykke</em>.
          </li>
          <li>
            <strong>Vil du skifte adgangskode?</strong> Vi tilbyder at du sætter din egen kode i stedet
            for <code>Strandgaarden100</code>. Du kan vælge <em>Sæt min egen</em> eller <em>Behold den jeg fik</em>.
            Beholder du den, kan du altid skifte senere via <em>Glemt adgangskode</em>.
          </li>
        </ol>
      </section>

      <section id="glemt" style={{ marginTop: '2.5rem' }}>
        <h2>3. Glemt adgangskode</h2>
        <p>Hvis du ikke kan huske din adgangskode:</p>
        <ol>
          <li>Gå til login-siden.</li>
          <li>Klik <strong>Glemt adgangskode?</strong>.</li>
          <li>Indtast din email — du modtager en 6-cifret kode (tjek også spam-mappen).</li>
          <li>Indtast koden + en ny adgangskode (mindst 8 tegn med mindst 1 ciffer).</li>
        </ol>
        <p className="help">
          Hvis koden ikke kommer inden for et par minutter, så kontakt Bestyrelsen.
        </p>
      </section>

      <section id="medlem" style={{ marginTop: '2.5rem' }}>
        <h2>4. Hvad kan du som medlem</h2>

        <p>
          <strong>Hvor er vi i forløbet?</strong> Lige nu er vi i fase 1, hvor vi <em>samler
          billeder ind</em> fra alle huse. Når vi har fået billeder nok, går vi i en kort fase 2,
          hvor Redaktionen gennemgår alt og siden låses for ændringer. Til sidst åbner fase 3, hvor
          billederne offentliggøres i <strong>Galleriet</strong> her på siden og udvalgte
          billeder samles i den trykte jubilæumsbog. Så lige nu handler det om at få jeres
          billeder med — galleriet kommer senere.
        </p>

        <p>Som medlem har du adgang til alt det her:</p>

        <h3 style={{ marginTop: '1rem' }}>Galleri</h3>
        <p>
          Når galleriet åbner (fase 3) kan du klikke <strong>Galleri</strong> i toppen for at se
          billeder andre medlemmer har uploadet og som Redaktionen har godkendt til hjemmesiden. Du
          kan filtrere på år, hus, person og kategori. I fase 1 og 2 er galleriet endnu ikke
          synligt — vi samler først, og åbner senere.
        </p>

        <h3 style={{ marginTop: '1rem' }}>Upload billede</h3>
        <p>
          Klik <strong>Upload billede</strong> for at dele et af dine egne billeder. Du skal udfylde:
        </p>
        <ul>
          <li><strong>Billedfil:</strong> JPEG, PNG, TIFF, HEIC (max 100 MB)</li>
          <li><strong>Beskrivelse:</strong> Fortæl historien — hvor, hvornår, hvem og hvad der sker.</li>
          <li><strong>År:</strong> Ca-årstal er fint hvis du ikke kan huske præcist.</li>
          <li>
            <strong>Tag personer:</strong> Vælg navne fra listen, eller foreslå nye (Redaktionen godkender
            nye navne).
          </li>
          <li>
            <strong>Hvor hører billedet til?</strong> I fase 1 vælger du enten <em>dit hus</em> (billedet
            tæller med i jeres del af jubilæumsbogen) eller <em>en kategori</em> (Sct. Hans, Vejdag,
            Fællesskabet osv. — fælles-billeder fra hele strandgården).
          </li>
        </ul>

        <h3 style={{ marginTop: '1rem' }}>Mine billeder</h3>
        <p>
          Klik <strong>Mine billeder</strong> for at se alle dine egne uploads. I fase 1 er der tre faner:
        </p>
        <ul>
          <li>
            <strong>Mine Hus Billeder:</strong> Billeder hvor du har valgt dit hus. Brug pilene
            <em> ↑↓</em> for at rangere hvilke der skal med i jubilæumsbogen først.
          </li>
          <li>
            <strong>Mine Kategori Billeder:</strong> Billeder du har lagt i en fælleskategori.
          </li>
          <li>
            <strong>Min Hus Tekst:</strong> En kort tekst (max 900 tegn) som dit hus bidrager med til
            bogen. Bruges som intro til jeres kapitel.
          </li>
        </ul>
        <p>
          På hvert billede er der en <strong>Se detaljer / rediger</strong>-knap. Klik for at rette
          beskrivelse, år, personer eller flytte billedet til en anden kategori.
        </p>

        <h3 style={{ marginTop: '1rem' }}>Dokumenter</h3>
        <p>
          Klik <strong>Dokumenter</strong> for at læse referater, mødeindkaldelser, årsregnskaber,
          historiske dokumenter osv. Du kan filtrere på år, kategori og specifikt møde. Klik på et
          dokument for at se det — PDF'er vises direkte i browseren; du kan også hente filen ned.
        </p>
      </section>

      <section id="udvalg" style={{ marginTop: '2.5rem' }}>
        <h2>5. Hvad kan Redaktionen</h2>
        <p>
          Redaktionen styrer alt det redaktionelle billede-arbejde. Som medlem af Redaktionen har du desuden
          adgang til alt det almindelige medlemmer kan. Klik <strong>Redaktionen</strong> i toppen — der er ni felter:
        </p>
        <ul>
          <li><strong>Fase:</strong> Sæt fasen for siden (1 indsamling / 2 frys / 3 offentlig) og rediger GDPR-teksten.</li>
          <li><strong>Gennemgang:</strong> Nye billeder afventer godkendelse. Beslut om hvert billede skal på web og/eller i bogen.</li>
          <li><strong>Kommentarer:</strong> Tilføjelser fra læsere — flet ind i beskrivelsen, vis som citat, eller afvis.</li>
          <li><strong>Fjernelser:</strong> GDPR-anmodninger om at slette et billede.</li>
          <li><strong>Bog:</strong> Billeder udvalgt til jubilæumsbogen. Eksportér enkelt eller som ZIP.</li>
          <li><strong>Kategorier:</strong> Aktiviteter (Sct. Hans, Vejdag osv.) — bruges som nøgleord i fase 1.</li>
          <li><strong>Personer:</strong> Godkend foreslåede navne, omdøb, eller slet personer fra billed-arkivet.</li>
          <li><strong>Hustekster:</strong> Se hvad alle 23 huse har skrevet til bogen.</li>
        </ul>
      </section>

      <section id="bestyrelse" style={{ marginTop: '2.5rem' }}>
        <h2>6. Hvad kan Bestyrelsen</h2>
        <p>
          Bestyrelsen styrer møder, dokumenter og brugere. Klik <strong>Bestyrelsen</strong> i toppen:
        </p>
        <ul>
          <li>
            <strong>Møder:</strong> Opret bestyrelsesmøder og generalforsamlinger med dato og titel.
            Klik på et møde for at se og uploade tilhørende dokumenter (referater, indkaldelser, bilag).
          </li>
          <li>
            <strong>Dokumenter:</strong> Upload selvstændige dokumenter (sange, historiske dokumenter,
            vedtægter osv.) der ikke hører til et bestemt møde.
          </li>
          <li>
            <strong>Brugere:</strong> Opret nye medlemmer, skift roller, omdøb, nulstil adgangskoder
            eller tildel hus-nummer.
          </li>
          <li>
            <strong>Dokument-kategorier</strong> (kun Administrator): Tilføj nye kategorier til dokument-uploadformularen,
            omdøb eller slet eksisterende.
          </li>
        </ul>
        <p className="help">
          Vigtigt: Inden du uploader bestyrelsesdokumenter — sørg for at personlige oplysninger
          (navne i konfliktsager, kontonumre osv.) er fjernet eller anonymiseret. Dokumenter er
          synlige for alle medlemmer.
        </p>
      </section>

      <section id="sporgsmaal" style={{ marginTop: '2.5rem' }}>
        <h2>7. Spørgsmål?</h2>
        <p>
          Hvis noget ikke virker som du forventer, eller du har idéer til forbedringer — kontakt
          Redaktionen (for billed-spørgsmål) eller Bestyrelsen (for alt andet). De har kontaktoplysninger
          i medlemslisten.
        </p>
        <p style={{ marginTop: '1rem', color: 'var(--ink-soft)' }}>
          Tak fordi du er med til at fejre Strandgaardens 100 år.
        </p>
      </section>
    </main>
  );
};

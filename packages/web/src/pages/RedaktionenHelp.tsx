import { Link } from 'react-router-dom';

/**
 * Help for the Redaktionen (Cognito group `admin`) — the editorial photo
 * workflow. Reached from the "Hjælp" card on /admin. Kept out of the
 * public /hjaelp so ordinary members aren't confused by tools they can't
 * use.
 */
export const RedaktionenHelpPage = () => (
  <main className="content help-page">
    <p className="eyebrow">Redaktionen · hjælp</p>
    <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
      Hjælp til <em>Redaktionen</em>
    </h1>
    <p className="lede">
      Redaktionen står for alt det redaktionelle billedarbejde: gennemgå nye billeder, sætte bogen
      sammen, holde styr på personer, kategorier og hustekster. Som medlem af Redaktionen kan du
      desuden alt det almindelige medlemmer kan. Du finder værktøjerne under{' '}
      <Link to="/admin">Redaktionen</Link> i toppen.
    </p>

    <nav className="help-toc" style={{ margin: '2rem 0' }}>
      <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Indhold</p>
      <ol>
        <li><a href="#overblik">Overblik og arbejdsgang</a></li>
        <li><a href="#fase">Fase — siden faser</a></li>
        <li><a href="#gennemgang">Gennemgang af nye billeder</a></li>
        <li><a href="#bog">Bog — udvælgelse og eksport</a></li>
        <li><a href="#hustekster">Hustekster</a></li>
        <li><a href="#kommentarer">Kommentarer</a></li>
        <li><a href="#fjernelser">Fjernelser (GDPR)</a></li>
        <li><a href="#kategorier">Kategorier</a></li>
        <li><a href="#personer">Personer</a></li>
      </ol>
    </nav>

    <section id="overblik" style={{ marginTop: '2.5rem' }}>
      <h2>1. Overblik og arbejdsgang</h2>
      <p>
        Forsiden <Link to="/admin">Redaktionen</Link> samler alle opgaver som kort. Hvert kort har et
        lille tal (badge), der viser, hvor meget der venter — fx hvor mange billeder der afventer
        gennemgang.
      </p>
      <p>En typisk arbejdsgang i indsamlingsfasen:</p>
      <ol>
        <li>Medlemmer uploader billeder og skriver hustekst.</li>
        <li>Du <strong>gennemgår</strong> nye billeder og beslutter, om de skal på web og/eller i bogen.</li>
        <li>Du <strong>udvælger</strong> billeder til bogen og <strong>eksporterer</strong> dem.</li>
        <li>Undervejs godkender du <strong>personer</strong> og besvarer <strong>kommentarer</strong> og <strong>fjernelses-anmodninger</strong>.</li>
      </ol>
      <p className="help">
        Bemærk: i frys-fasen (fase 2) er medlemmernes værktøjer låst, men Redaktionen kan stadig
        arbejde frit. Se næste afsnit om faser.
      </p>
    </section>

    <section id="fase" style={{ marginTop: '2.5rem' }}>
      <h2>2. Fase — siden faser</h2>
      <p>
        Under <Link to="/admin/fase">Fase</Link> styrer du, hvilken tilstand hele siden er i. Der er
        tre faser:
      </p>
      <table className="help-table">
        <thead>
          <tr><th>Fase</th><th>Hvad betyder det</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1 — Indsamling</strong></td>
            <td>Medlemmer uploader til deres eget hus eller en kategori. Galleriet er endnu ikke åbent for menige medlemmer.</td>
          </tr>
          <tr>
            <td><strong>2 — Frys</strong></td>
            <td>Alt er låst for medlemmer mens I færdiggør bogen — ingen uploads, kommentarer eller rettelser. Redaktionen og bestyrelsen kan stadig arbejde.</td>
          </tr>
          <tr>
            <td><strong>3 — Offentlig</strong></td>
            <td>Galleriet er åbent. Fri upload og adgang for alle medlemmer.</td>
          </tr>
        </tbody>
      </table>
      <p>På samme side kan du også justere:</p>
      <ul>
        <li><strong>Billeder pr. hus:</strong> hvor mange billed-pladser hvert hus har i bogen (standard 7).</li>
        <li><strong>Tekstlængde:</strong> hvor mange tegn en hustekst må fylde.</li>
        <li>
          <strong>GDPR-tekst:</strong> rediger samtykketeksten. Sæt hak i <em>ny version</em>, hvis
          ændringen er væsentlig — så bliver alle medlemmer bedt om at godkende den på ny ved næste
          login.
        </li>
      </ul>
      <p className="help">
        Skift fase med omtanke — fase 2 låser med det samme for alle menige medlemmer.
      </p>
    </section>

    <section id="gennemgang" style={{ marginTop: '2.5rem' }}>
      <h2>3. Gennemgang af nye billeder</h2>
      <p>
        Under <Link to="/review">Gennemgang</Link> ligger alle nye billeder, der afventer
        godkendelse. Et billede bevæger sig gennem tre tilstande:
      </p>
      <ul>
        <li><strong>Afventer / Under gennemgang:</strong> netop uploadet, ikke besluttet endnu.</li>
        <li><strong>Afgjort:</strong> du har truffet en beslutning.</li>
      </ul>
      <p>For hvert billede sætter du to flueben:</p>
      <ul>
        <li><strong>Vis på web:</strong> billedet må vises i Galleriet (fase 3).</li>
        <li><strong>Med i bog:</strong> billedet er kandidat til jubilæumsbogen.</li>
      </ul>
      <p>
        Et billede kan godt være kun til bogen (ikke web) eller omvendt. Når du gemmer beslutningen,
        flyttes billedet til <em>Afgjort</em>. Du kan altid finde det igen i Galleriet (sæt hak i{' '}
        <em>Vis alle billeder</em> for også at se dem, der kun er til bogen).
      </p>
      <p className="help">
        Billeder, der er for små til tryk, markeres automatisk. Du kan stadig vælge dem til web, men
        tænk dig om, før du sætter dem i bogen.
      </p>
    </section>

    <section id="bog" style={{ marginTop: '2.5rem' }}>
      <h2>4. Bog — udvælgelse og eksport</h2>
      <p>
        Under <Link to="/admin/bog">Bog</Link> ser du alle billeder, der er markeret <em>Med i bog</em>.
        Her samler I billederne til tryk.
      </p>
      <ul>
        <li>
          <strong>Sortér</strong> visningen efter ID, hus eller kategori, så du kan arbejde hus for
          hus. Med <em>Vis kun</em> kan du indsnævre til ét bestemt hus eller én kategori.
        </li>
        <li>
          <strong>Vælg</strong> de billeder, du vil hente — <em>Vælg alle</em> respekterer den
          aktuelle visning og filtrering.
        </li>
        <li>
          <strong>Eksportér</strong> de valgte billeder enten enkeltvis eller som en samlet ZIP-fil.
          Filerne er gjort trykklare (under 2 MB pr. billede).
        </li>
        <li>
          Klik <strong>Rediger / se detaljer</strong> på et kort for at åbne billedets side og rette
          beskrivelse, år eller personer.
        </li>
      </ul>
      <p className="help">
        Eksporterede filer ligger klar i et par dage og ryddes så automatisk — hent dem ned lokalt,
        når du eksporterer.
      </p>
    </section>

    <section id="hustekster" style={{ marginTop: '2.5rem' }}>
      <h2>5. Hustekster</h2>
      <p>
        Under <Link to="/admin/hustekster">Hustekster</Link> ser du alle 23 huse samlet — den tekst,
        hvert hus har skrevet til bogen. Øverst står en kort optælling af, hvor mange huse der har
        skrevet noget.
      </p>
      <p className="help">
        Husene redigerer selv deres tekst på <strong>Mine billeder</strong>. Her er visningen
        skrivebeskyttet og giver jer overblik, mens I sætter bogen sammen.
      </p>
    </section>

    <section id="kommentarer" style={{ marginTop: '2.5rem' }}>
      <h2>6. Kommentarer</h2>
      <p>
        Under <Link to="/admin/kommentarer">Kommentarer</Link> ligger tilføjelser, som læsere har
        sendt til et billede (typisk hjælp til at sætte navn på personer). For hver kommentar kan du:
      </p>
      <ul>
        <li><strong>Flet ind:</strong> indarbejd oplysningen direkte i billedets beskrivelse eller persontags.</li>
        <li><strong>Behold som citat:</strong> gem kommentaren som et tilføjet citat.</li>
        <li><strong>Afvis:</strong> fjern kommentaren, hvis den ikke skal bruges.</li>
      </ul>
    </section>

    <section id="fjernelser" style={{ marginTop: '2.5rem' }}>
      <h2>7. Fjernelser (GDPR)</h2>
      <p>
        Under <Link to="/admin/fjernelser">Fjernelser</Link> ligger anmodninger fra medlemmer om at få
        et billede fjernet. For hver anmodning:
      </p>
      <ul>
        <li>
          <strong>Godkend:</strong> billedet slettes permanent — både filen og oplysningerne — og der
          skrives en note i revisionssporet. Dette kan <em>ikke</em> fortrydes.
        </li>
        <li><strong>Afvis:</strong> billedet beholdes; anmodningen lukkes.</li>
      </ul>
      <p className="help">
        Tag dig god tid med godkendelser — sletning er endelig. Tal eventuelt med den der har sendt
        anmodningen først, hvis du er i tvivl.
      </p>
    </section>

    <section id="kategorier" style={{ marginTop: '2.5rem' }}>
      <h2>8. Kategorier</h2>
      <p>
        Under <Link to="/admin/aktiviteter">Kategorier</Link> styrer du de fælles nøgleord, som
        medlemmer kan lægge billeder under i fase 1 (fx Sct. Hans, Vejdag &amp; skovdag,
        Fællesskabet). Du kan oprette nye, omdøbe og ændre rækkefølgen.
      </p>
      <p className="help">
        Når du omdøber en kategori, beholder billederne deres tilknytning — kun det viste navn ændrer
        sig. Slet kun en kategori, hvis ingen billeder bruger den, ellers mister de deres mærkat.
      </p>
    </section>

    <section id="personer" style={{ marginTop: '2.5rem' }}>
      <h2>9. Personer</h2>
      <p>
        Under <Link to="/admin/personer">Personer</Link> vedligeholder du den fælles navneliste, som
        bruges, når medlemmer tagger personer på billeder. Listen er på forhånd fyldt med de kendte
        navne fra hushistorierne, så medlemmer kan vælge fra listen frem for at skrive nyt.
      </p>
      <ul>
        <li><strong>Godkend foreslåede navne:</strong> skriver et medlem et nyt navn, lander det her til godkendelse, så vi undgår mange stavemåder af samme person.</li>
        <li><strong>Omdøb:</strong> ret en stavemåde — alle billeder følger med.</li>
        <li><strong>Slet:</strong> fjern en person; navnet fjernes også fra de billeder, det var sat på.</li>
      </ul>
      <p className="help">
        Tip: godkend foreslåede navne løbende — så bliver det nemmere for det næste medlem at vælge
        det rigtige navn fra listen.
      </p>
    </section>

    <p style={{ marginTop: '2.5rem' }}>
      <Link to="/admin" className="btn-primary">← Tilbage til Redaktionen</Link>
    </p>
  </main>
);

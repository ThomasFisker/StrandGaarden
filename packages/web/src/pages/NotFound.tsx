import { Link } from 'react-router-dom';

export const NotFoundPage = () => (
  <main className="content not-found-center">
    <div>
      <p className="eyebrow">404</p>
      <h1 className="display"><em>Side</em> ikke fundet</h1>
      <p>
        Du er kommet på en adresse der ikke findes. Prøv <Link to="/galleri">galleriet</Link>.
      </p>
    </div>
  </main>
);

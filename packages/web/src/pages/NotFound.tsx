import { Link } from 'react-router-dom';

export const NotFoundPage = () => (
  <main className="content">
    <h1>Siden blev ikke fundet</h1>
    <p>
      Du er kommet på en adresse der ikke findes. Prøv <Link to="/">forsiden</Link>.
    </p>
  </main>
);

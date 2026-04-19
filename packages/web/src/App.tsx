import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/Login';
import { UploadPage } from './pages/Upload';
import { MinePage } from './pages/Mine';
import { ReviewPage } from './pages/Review';
import { NotFoundPage } from './pages/NotFound';

export const App = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Navigate to="/upload" replace />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/mine" element={<MinePage />} />
      </Route>
      <Route element={<ProtectedRoute requireGroup="admin" />}>
        <Route path="/review" element={<ReviewPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>
);

import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ProfileProvider } from './profile';
import { ForgotPasswordPage } from './pages/ForgotPassword';
import { LoginPage } from './pages/Login';
import { UploadPage } from './pages/Upload';
import { MinePage } from './pages/Mine';
import { ReviewPage } from './pages/Review';
import { GalleryPage } from './pages/Gallery';
import { GalleryPhotoPage } from './pages/GalleryPhoto';
import { AdminUsersPage } from './pages/AdminUsers';
import { AdminPersonsPage } from './pages/AdminPersons';
import { AdminCommentsPage } from './pages/AdminComments';
import { AdminRemovalsPage } from './pages/AdminRemovals';
import { AdminBookPage } from './pages/AdminBook';
import { AdminHomePage } from './pages/AdminHome';
import { AdminPhasePage } from './pages/AdminPhase';
import { AdminActivitiesPage } from './pages/AdminActivities';
import { AdminHouseTextsPage } from './pages/AdminHouseTexts';
import { NotFoundPage } from './pages/NotFound';
import { SamtykkePage } from './pages/Samtykke';
import { DocumentsPage } from './pages/Documents';
import { DocumentDetailPage } from './pages/DocumentDetail';
import { BestyrelsenPage } from './pages/Bestyrelsen';
import { BestyrelsenMeetingsPage } from './pages/BestyrelsenMeetings';
import { BestyrelsenMeetingDetailPage } from './pages/BestyrelsenMeetingDetail';
import { BestyrelsenDocumentsPage } from './pages/BestyrelsenDocuments';
import { BestyrelsenDocCategoriesPage } from './pages/BestyrelsenDocCategories';

export const App = () => (
  <ProfileProvider>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/glemt-adgangskode" element={<ForgotPasswordPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to="/galleri" replace />} />
          <Route path="/galleri" element={<GalleryPage />} />
          <Route path="/galleri/:id" element={<GalleryPhotoPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/mine" element={<MinePage />} />
          <Route path="/mine/kategori" element={<MinePage />} />
          <Route path="/mine/tekst" element={<MinePage />} />
          <Route path="/samtykke" element={<SamtykkePage />} />
        </Route>
        <Route element={<ProtectedRoute requireAny={['member', 'admin', 'board', 'administrator']} />}>
          <Route path="/dokumenter" element={<DocumentsPage />} />
          <Route path="/dokumenter/:id" element={<DocumentDetailPage />} />
        </Route>
        <Route element={<ProtectedRoute requireAny={['admin', 'administrator']} />}>
          <Route path="/admin" element={<AdminHomePage />} />
          <Route path="/admin/fase" element={<AdminPhasePage />} />
          <Route path="/admin/aktiviteter" element={<AdminActivitiesPage />} />
          <Route path="/admin/hustekster" element={<AdminHouseTextsPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/admin/personer" element={<AdminPersonsPage />} />
          <Route path="/admin/kommentarer" element={<AdminCommentsPage />} />
          <Route path="/admin/fjernelser" element={<AdminRemovalsPage />} />
          <Route path="/admin/bog" element={<AdminBookPage />} />
        </Route>
        <Route element={<ProtectedRoute requireAny={['board', 'administrator']} />}>
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/bestyrelse" element={<BestyrelsenPage />} />
          <Route path="/bestyrelse/moder" element={<BestyrelsenMeetingsPage />} />
          <Route path="/bestyrelse/moder/:id" element={<BestyrelsenMeetingDetailPage />} />
          <Route path="/bestyrelse/dokumenter" element={<BestyrelsenDocumentsPage />} />
        </Route>
        <Route element={<ProtectedRoute requireGroup="administrator" />}>
          <Route path="/bestyrelse/dokument-kategorier" element={<BestyrelsenDocCategoriesPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  </ProfileProvider>
);

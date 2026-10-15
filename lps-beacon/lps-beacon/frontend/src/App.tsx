// src/App.tsx
// The root component. It sets up login, the pages, and the navigation between them.

// BrowserRouter makes page switching work without reloading the browser.
// Routes and Route say which component to show for which address.
// Navigate sends the user somewhere else.
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AuthProvider from "./auth/AuthProvider";
import { ANALYSIS_ROLES, UPLOAD_ROLES } from "./auth/permissions";
import NavBar from "./components/NavBar";
import RequireAuth from "./components/RequireAuth";
import AnalysisPage from "./pages/AnalysisPage";
import ChatPage from "./pages/ChatPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import UploadPage from "./pages/UploadPage";
import UploadProvider from "./uploads/UploadProvider";

export default function App() {
  return (
    // basename lets the app also run from a sub-path (the GitHub Pages preview). At the normal root URL it is "/".
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* AuthProvider shares the login information with everything inside it. */}
      <AuthProvider>
        {/* UploadProvider keeps the uploaded-files list alive while you move between pages. */}
        <UploadProvider>
          {/* app-shell stacks the navigation bar on top and the current page below it. */}
          <div className="app-shell">
            <NavBar />
            <Routes>
              {/* The login page is the only page that doesn't need a login. */}
              <Route path="/login" element={<LoginPage />} />
              {/* RequireAuth wraps each page that needs a login. */}
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <ChatPage />
                  </RequireAuth>
                }
              />
              {/* The dashboard is open to every logged-in role; what it shows depends on the data the backend returns. */}
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <DashboardPage />
                  </RequireAuth>
                }
              />
              {/* The upload page also checks the role against UPLOAD_ROLES. */}
              <Route
                path="/upload"
                element={
                  <RequireAuth allowedRoles={UPLOAD_ROLES}>
                    <UploadPage />
                  </RequireAuth>
                }
              />
              {/* The Analysis page (the capacity plan) is limited to the roles in ANALYSIS_ROLES (finance). */}
              <Route
                path="/analysis"
                element={
                  <RequireAuth allowedRoles={ANALYSIS_ROLES}>
                    <AnalysisPage />
                  </RequireAuth>
                }
              />
              {/* Any other address sends the user to the chat (which sends them to login if needed). */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </UploadProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

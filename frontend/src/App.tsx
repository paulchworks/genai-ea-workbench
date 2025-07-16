import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  useParams,
} from "react-router-dom";
import "./styles/App.css";
import { JobPage } from "./components/JobPage";
import { UploadPage } from "./pages/UploadPage";
import { JobsListPage } from "./pages/JobsListPage";

// Wrapper to extract jobId from URL params
function JobPageWrapper() {
  const { jobId } = useParams<{ jobId: string }>();
  if (!jobId) {
    return <div>Job ID not found</div>;
  }
  return <JobPage jobId={jobId} />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/jobs" element={<JobsListPage />} />
        <Route path="/jobs/:jobId" element={<JobPageWrapper />} />
      </Routes>
    </Router>
  );
}

export default App;

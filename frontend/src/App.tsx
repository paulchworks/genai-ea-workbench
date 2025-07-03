import { useState, useEffect, useContext } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  useParams,
  Navigate,
  useLocation,
} from "react-router-dom";
import "./styles/App.css";
import { JobPage } from "./components/JobPage";
import { AuthContext } from "./contexts/AuthContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShieldAlt,
  faFileAlt,
  faStethoscope,
  faRobot,
  faFileMedical,
  faList,
  faCalendarAlt,
  faCheckCircle,
  faHourglassHalf,
  faExclamationCircle,
  faHeartbeat,
  faHome,
} from "@fortawesome/free-solid-svg-icons";

// Auth provider component
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true); // Add loading state

  useEffect(() => {
    // Check if token exists in localStorage
    const token = localStorage.getItem("auth_token");
    if (token) {
      setIsAuthenticated(true);
    }
    setIsLoading(false); // Mark initialization as complete
  }, []);

  const login = async (password: string) => {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      throw new Error("Invalid password");
    }

    const data = await response.json();
    localStorage.setItem("auth_token", data.token);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem("auth_token");
    setIsAuthenticated(false);
  };

  // Don't render anything while checking auth state
  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Login component
function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { login, isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation(); // Get current location

  // Get the returnTo parameter from the URL if it exists
  const searchParams = new URLSearchParams(location.search);
  const returnTo = searchParams.get("returnTo") || "/";

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate(returnTo); // Navigate to returnTo path instead of always to root
    }
  }, [isAuthenticated, navigate, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await login(password);
      navigate(returnTo); // Navigate to returnTo path after successful login
    } catch {
      setError("Invalid password");
    }
  };

  return (
    <div className="container">
      <h1>Login</h1>
      {error && <div className="error-message">{error}</div>}
      <form onSubmit={handleSubmit} className="login-form">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          className="password-input"
        />
        <button type="submit" className="login-button">
          Login
        </button>
      </form>
    </div>
  );
}

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useContext(AuthContext);
  const location = useLocation(); // Get current location

  if (!isAuthenticated) {
    // Include the current path as a returnTo query parameter
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  return <>{children}</>;
}

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insuranceType, setInsuranceType] = useState<
    "life" | "property_casualty"
  >("life");
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    setError(null);

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.includes("pdf")) {
      setError("Please select a PDF file");
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file first");
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("insuranceType", insuranceType);

    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/analyze-stream`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          logout();
          navigate("/login");
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const { analysisId } = await response.json();

      // Create URL for the PDF and store in sessionStorage for immediate viewing
      const pdfUrl = URL.createObjectURL(file);
      sessionStorage.setItem(`pdf_${analysisId}`, pdfUrl);

      // Redirect to the job page
      navigate(`/jobs/${analysisId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>
          <span className="header-logo">
            <FontAwesomeIcon icon={faShieldAlt} />
          </span>
          GenAI Underwriting Workbench
        </h1>
        <div className="header-controls">
          <div className="header-insurance-toggle">
            <label
              className={`option ${insuranceType === "life" ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="headerInsuranceType"
                value="life"
                checked={insuranceType === "life"}
                onChange={() => setInsuranceType("life")}
              />
              <span className="option-icon">
                <FontAwesomeIcon icon={faHeartbeat} />
              </span>
              <span>Life</span>
            </label>
            <label
              className={`option ${
                insuranceType === "property_casualty" ? "selected" : ""
              }`}
            >
              <input
                type="radio"
                name="headerInsuranceType"
                value="property_casualty"
                checked={insuranceType === "property_casualty"}
                onChange={() => setInsuranceType("property_casualty")}
              />
              <span className="option-icon">
                <FontAwesomeIcon icon={faHome} />
              </span>
              <span>P&C</span>
            </label>
          </div>
          <button onClick={logout} className="logout-button">
            Logout
          </button>
        </div>
      </div>

      <div className="description-section">
        <h2>
          {insuranceType === "life"
            ? "Streamline Your Life Insurance Underwriting"
            : "Streamline Your Property & Casualty Insurance Underwriting"}
        </h2>
        <p className="intro-text">
          {insuranceType === "life" ? (
            <span
              dangerouslySetInnerHTML={{
                __html:
                  "Transform complex life insurance applications and medical documents into actionable insights using advanced AI analysis powered by <strong>Amazon Bedrock</strong> and <strong>Claude 3.5 Sonnet</strong>. Purpose-built for life insurance underwriters to automatically extract, analyze, and evaluate risk factors from application packets.",
              }}
            />
          ) : (
            <span
              dangerouslySetInnerHTML={{
                __html:
                  "Transform complex property & casualty insurance applications and ACORD forms into actionable insights using advanced AI analysis powered by <strong>Amazon Bedrock</strong> and <strong>Claude 3.5 Sonnet</strong>. Purpose-built for P&C insurance underwriters to automatically extract, analyze, and evaluate property risk factors from application packets.",
              }}
            />
          )}
        </p>

        <div className="features-grid">
          <div className="feature-card">
            <h3>
              <FontAwesomeIcon icon={faFileAlt} />
              Document Analysis
            </h3>
            <ul>
              {insuranceType === "life" ? (
                <>
                  <li>Process complete life insurance application packets</li>
                  <li>Extract medical history and risk factors</li>
                  <li>Automatic classification of APS and lab reports</li>
                </>
              ) : (
                <>
                  <li>Process complete P&C insurance application packets</li>
                  <li>Extract property details and risk factors</li>
                  <li>Automatic classification of ACORD forms</li>
                </>
              )}
            </ul>
          </div>

          <div className="feature-card">
            <h3>
              <FontAwesomeIcon
                icon={insuranceType === "life" ? faStethoscope : faHome}
              />
              {insuranceType === "life"
                ? "Underwriter Analysis"
                : "Property Assessment"}
            </h3>
            <ul>
              {insuranceType === "life" ? (
                <>
                  <li>AI-driven mortality risk assessment</li>
                  <li>Medical history timeline construction</li>
                  <li>Cross-reference discrepancies across documents</li>
                  <li>Automated medical condition evaluation</li>
                </>
              ) : (
                <>
                  <li>AI-driven property risk assessment</li>
                  <li>Detailed property characteristics analysis</li>
                  <li>Cross-reference discrepancies across documents</li>
                  <li>Environmental and geographical risk evaluation</li>
                </>
              )}
            </ul>
          </div>

          <div className="feature-card">
            <h3>
              <FontAwesomeIcon icon={faRobot} />
              Interactive Assistant
            </h3>
            <ul>
              {insuranceType === "life" ? (
                <>
                  <li>Query complex medical histories</li>
                  <li>Instant access to policy-relevant details</li>
                  <li>Navigate multi-document applications</li>
                </>
              ) : (
                <>
                  <li>Query property details and risk factors</li>
                  <li>Instant access to policy-relevant details</li>
                  <li>Navigate complex ACORD forms</li>
                </>
              )}
            </ul>
          </div>
        </div>

        <div className="supported-documents">
          <h3>Supported Documents</h3>
          <div className="document-types">
            {insuranceType === "life" ? (
              <>
                <span className="document-type">
                  Life Insurance Applications
                </span>
                <span className="document-type">
                  Attending Physician Statements (APS)
                </span>
                <span className="document-type">Lab Reports</span>
                <span className="document-type">Pharmacy Records</span>
                <span className="document-type">Financial Disclosures</span>
                <span className="document-type">
                  Medical History Questionnaires
                </span>
                <span className="document-type">Supplemental Forms</span>
              </>
            ) : (
              <>
                <span className="document-type">ACORD Forms</span>
                <span className="document-type">Property Inspections</span>
                <span className="document-type">Claims History</span>
                <span className="document-type">Property Valuations</span>
                <span className="document-type">Flood Zone Certificates</span>
                <span className="document-type">Building Code Compliance</span>
                <span className="document-type">Security Documentation</span>
              </>
            )}
            <span className="document-type">And More</span>
          </div>
        </div>
      </div>

      <div className="upload-section">
        <h2>
          <FontAwesomeIcon
            icon={faFileMedical}
            style={{ marginRight: "10px", color: "#3b82f6" }}
          />
          Upload Document
        </h2>

        <div className="insurance-type-selector">
          <h3>Insurance Type</h3>
          <div className="insurance-options">
            <label
              className={`option ${insuranceType === "life" ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="insuranceType"
                value="life"
                checked={insuranceType === "life"}
                onChange={() => setInsuranceType("life")}
              />
              <span className="option-icon">
                <FontAwesomeIcon icon={faHeartbeat} />
              </span>
              <span className="option-label">Life Insurance</span>
            </label>
            <label
              className={`option ${
                insuranceType === "property_casualty" ? "selected" : ""
              }`}
            >
              <input
                type="radio"
                name="insuranceType"
                value="property_casualty"
                checked={insuranceType === "property_casualty"}
                onChange={() => setInsuranceType("property_casualty")}
              />
              <span className="option-icon">
                <FontAwesomeIcon icon={faHome} />
              </span>
              <span className="option-label">Property & Casualty</span>
            </label>
          </div>
        </div>

        <div className="file-input-container">
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            disabled={uploading}
            className="file-input"
          />
        </div>

        {file && (
          <div className="file-info">
            <p>Selected file: {file.name}</p>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="upload-button"
            >
              {uploading ? "Uploading..." : "Analyze Document"}
            </button>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  );
}

// Wrapper to extract jobId from URL params
function JobPageWrapper() {
  const params = useParams<{ jobId: string }>();
  return <JobPage jobId={params.jobId!} />;
}

// Add this new type definition
interface Job {
  job_id: string;
  filename: string;
  timestamp: number;
  status: "Complete" | "In Progress" | "Failed";
}

// Add the JobsList component
function JobsList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        logout();
        navigate("/login");
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/jobs`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          logout();
          navigate("/login");
          return;
        }
        throw new Error("Failed to fetch jobs");
      }

      const data = await response.json();
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Complete":
        return (
          <FontAwesomeIcon
            icon={faCheckCircle}
            className="status-icon complete"
          />
        );
      case "In Progress":
        return (
          <FontAwesomeIcon
            icon={faHourglassHalf}
            className="status-icon in-progress"
          />
        );
      case "Failed":
        return (
          <FontAwesomeIcon
            icon={faExclamationCircle}
            className="status-icon failed"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>
          <span className="header-logo">
            <FontAwesomeIcon icon={faShieldAlt} />
          </span>
          GenAI Underwriting Workbench
        </h1>
        <div className="header-controls">
          <button onClick={() => navigate("/")} className="nav-button">
            <FontAwesomeIcon icon={faFileMedical} /> Upload New
          </button>
          <button onClick={logout} className="logout-button">
            Logout
          </button>
        </div>
      </div>

      <div className="jobs-section">
        <h2>
          <FontAwesomeIcon icon={faList} style={{ marginRight: "10px" }} />
          Your Analysis Jobs
        </h2>

        {loading ? (
          <div className="loading">Loading jobs...</div>
        ) : error ? (
          <div className="error-message">
            {error}
            <button onClick={fetchJobs} className="refresh-button">
              Try Again
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="no-jobs">
            <p>You haven't uploaded any documents yet.</p>
            <button onClick={() => navigate("/")} className="upload-button">
              Upload Your First Document
            </button>
          </div>
        ) : (
          <div className="jobs-list">
            {jobs.map((job) => (
              <div
                key={job.job_id}
                className="job-card"
                onClick={() => navigate(`/jobs/${job.job_id}`)}
              >
                <div className="job-icon">
                  <FontAwesomeIcon icon={faFileAlt} />
                </div>
                <div className="job-details">
                  <h3 className="job-filename">{job.filename}</h3>
                  <div className="job-meta">
                    <div className="job-date">
                      <FontAwesomeIcon icon={faCalendarAlt} />
                      {formatDate(job.timestamp)}
                    </div>
                    <div
                      className={`job-status ${job.status
                        .toLowerCase()
                        .replace(" ", "-")}`}
                    >
                      {getStatusIcon(job.status)}
                      {job.status}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <UploadPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs"
            element={
              <ProtectedRoute>
                <JobsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/:jobId"
            element={
              <ProtectedRoute>
                <JobPageWrapper />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;

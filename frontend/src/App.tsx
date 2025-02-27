import { useState, useEffect, useContext } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom'
import './App.css'
import { JobPage } from './components/JobPage'
import { AuthContext, AuthContextType } from './contexts/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
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
  faExclamationCircle
} from '@fortawesome/free-solid-svg-icons'

// Auth provider component
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true); // Add loading state
  
  useEffect(() => {
    // Check if token exists in localStorage
    const token = localStorage.getItem('auth_token');
    if (token) {
      setIsAuthenticated(true);
    }
    setIsLoading(false); // Mark initialization as complete
  }, []);
  
  const login = async (password: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      
      if (!response.ok) {
        throw new Error('Invalid password');
      }
      
      const data = await response.json();
      localStorage.setItem('auth_token', data.token);
      setIsAuthenticated(true);
    } catch (error) {
      throw error;
    }
  };
  
  const logout = () => {
    localStorage.removeItem('auth_token');
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
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login, isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation(); // Get current location
  
  // Get the returnTo parameter from the URL if it exists
  const searchParams = new URLSearchParams(location.search);
  const returnTo = searchParams.get('returnTo') || '/';
  
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
    } catch (err) {
      setError('Invalid password');
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
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }
  
  return <>{children}</>;
}

function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { logout } = useContext(AuthContext);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    setError(null)
    
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.includes('pdf')) {
      setError('Please select a PDF file')
      return
    }

    setFile(selectedFile)
  }

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first')
      return
    }

    setUploading(true)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/analyze-stream`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      })

      if (!response.ok) {
        if (response.status === 401) {
          logout();
          navigate('/login');
          return;
        }
        const errorData = await response.json()
        throw new Error(errorData.error || 'Upload failed')
      }

      const { analysisId } = await response.json()
      
      // Create URL for the PDF and store in sessionStorage for immediate viewing
      const pdfUrl = URL.createObjectURL(file)
      sessionStorage.setItem(`pdf_${analysisId}`, pdfUrl)
      
      // Redirect to the job page
      navigate(`/jobs/${analysisId}`)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setUploading(false)
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>
          <span className="header-logo">
            <FontAwesomeIcon icon={faShieldAlt} />
          </span>
          Insurance Document Analysis
        </h1>
        <div className="header-controls">
          <button onClick={logout} className="logout-button">
            Logout
          </button>
        </div>
      </div>

      <div className="description-section">
        <h2>Streamline Your Life Insurance Underwriting</h2>
        <p className="intro-text">
          Transform complex life insurance applications and medical documents into actionable insights using advanced AI analysis powered by <a href="https://aws.amazon.com/bedrock/" target="_blank" rel="noopener noreferrer">Amazon Bedrock</a> and Claude 3.5 Sonnet.
          Purpose-built for life insurance underwriters to automatically extract, analyze, and evaluate risk factors from application packets.
        </p>
        
        <div className="features-grid">
          <div className="feature-card">
            <h3>
              <FontAwesomeIcon icon={faFileAlt} />
              Document Analysis
            </h3>
            <ul>
              <li>Process complete life insurance application packets</li>
              <li>Extract medical history and risk factors</li>
              <li>Automatic classification of APS and lab reports</li>
            </ul>
          </div>

          <div className="feature-card">
            <h3>
              <FontAwesomeIcon icon={faStethoscope} />
              Underwriter Analysis
            </h3>
            <ul>
              <li>AI-driven mortality risk assessment</li>
              <li>Medical history timeline construction</li>
              <li>Cross-reference discrepancies across documents</li>
              <li>Automated medical condition evaluation</li>
            </ul>
          </div>

          <div className="feature-card">
            <h3>
              <FontAwesomeIcon icon={faRobot} />
              Interactive Assistant
            </h3>
            <ul>
              <li>Query complex medical histories</li>
              <li>Instant access to policy-relevant details</li>
              <li>Navigate multi-document applications</li>
            </ul>
          </div>
        </div>

        <div className="supported-documents">
          <h3>Supported Documents</h3>
          <div className="document-types">
            <span className="document-type">Life Insurance Applications</span>
            <span className="document-type">Attending Physician Statements (APS)</span>
            <span className="document-type">Lab Reports</span>
            <span className="document-type">Pharmacy Records</span>
            <span className="document-type">Financial Disclosures</span>
            <span className="document-type">Medical History Questionnaires</span>
            <span className="document-type">Supplemental Forms</span>
            <span className="document-type">And More</span>
          </div>
        </div>
      </div>
      
      <div className="upload-section">
        <h2>
          <FontAwesomeIcon icon={faFileMedical} style={{ marginRight: '10px', color: '#3b82f6' }} />
          Upload Document
        </h2>
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
              {uploading ? 'Uploading...' : 'Analyze Document'}
            </button>
          </div>
        )}

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
        
        <div className="demo-link-container">
          <div className="demo-separator">
            <span>OR</span>
          </div>
          <a 
            href="https://djf1ozd9uc1n3.cloudfront.net/jobs/demodoc1" 
            target="_blank" 
            rel="noopener noreferrer"
            className="demo-button"
          >
            View Demo Document
          </a>
          <p className="demo-description">See an example of a fully processed insurance document analysis</p>
        </div>
      </div>
    </div>
  )
}

// Wrapper to extract jobId from URL params
function JobPageWrapper() {
  const params = useParams<{ jobId: string }>()
  return <JobPage jobId={params.jobId!} />
}

// Add this new type definition
interface Job {
  job_id: string;
  filename: string;
  timestamp: number;
  status: 'Complete' | 'In Progress' | 'Failed';
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
      const token = localStorage.getItem('auth_token');
      if (!token) {
        logout();
        navigate('/login');
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/jobs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          logout();
          navigate('/login');
          return;
        }
        throw new Error('Failed to fetch jobs');
      }

      const data = await response.json();
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Complete':
        return <FontAwesomeIcon icon={faCheckCircle} className="status-icon complete" />;
      case 'In Progress':
        return <FontAwesomeIcon icon={faHourglassHalf} className="status-icon in-progress" />;
      case 'Failed':
        return <FontAwesomeIcon icon={faExclamationCircle} className="status-icon failed" />;
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
          Insurance Document Analysis
        </h1>
        <div className="header-controls">
          <button onClick={() => navigate('/')} className="nav-button">
            <FontAwesomeIcon icon={faFileMedical} /> Upload New
          </button>
          <button onClick={logout} className="logout-button">
            Logout
          </button>
        </div>
      </div>

      <div className="jobs-section">
        <h2>
          <FontAwesomeIcon icon={faList} style={{ marginRight: '10px' }} /> 
          Your Analysis Jobs
        </h2>

        {loading ? (
          <div className="loading">Loading jobs...</div>
        ) : error ? (
          <div className="error-message">
            {error}
            <button 
              onClick={fetchJobs}
              className="refresh-button"
            >
              Try Again
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="no-jobs">
            <p>You haven't uploaded any documents yet.</p>
            <button 
              onClick={() => navigate('/')}
              className="upload-button"
            >
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
                    <div className={`job-status ${job.status.toLowerCase().replace(' ', '-')}`}>
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
          <Route path="/" element={
            <ProtectedRoute>
              <UploadPage />
            </ProtectedRoute>
          } />
          <Route path="/jobs" element={
            <ProtectedRoute>
              <JobsList />
            </ProtectedRoute>
          } />
          <Route path="/jobs/:jobId" element={
            <ProtectedRoute>
              <JobPageWrapper />
            </ProtectedRoute>
          } />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App

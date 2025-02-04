import { useState, useEffect, useContext } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, Navigate } from 'react-router-dom'
import './App.css'
import { JobPage } from './components/JobPage'
import { AuthContext, AuthContextType } from './contexts/AuthContext'

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
      const response = await fetch('/login', {
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
  
  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    try {
      await login(password);
      navigate('/');
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
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
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
      const response = await fetch('/analyze-stream', {
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
        <h1>Insurance Document Analysis</h1>
        <button onClick={logout} className="logout-button">
          Logout
        </button>
      </div>
      
      <div className="upload-section">
        <input
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          disabled={uploading}
          className="file-input"
        />
        
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
      </div>
    </div>
  )
}

// Wrapper to extract jobId from URL params
function JobPageWrapper() {
  const params = useParams<{ jobId: string }>()
  return <JobPage jobId={params.jobId!} />
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

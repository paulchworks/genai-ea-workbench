import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom'
import './styles/App.css'
import { JobPage } from './components/JobPage'
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
  faExclamationCircle,
  faHeartbeat,
  faHome,
  faSearch,
  faTimes,
} from '@fortawesome/free-solid-svg-icons'

function UploadPage() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insuranceType, setInsuranceType] = useState<'life' | 'property_casualty'>('property_casualty')
  const [uploadProgress, setUploadProgress] = useState<Record<string, string>>({})
  const navigate = useNavigate()

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || [])
    setError(null)
    
    if (selectedFiles.length === 0) {
      return
    }

    // Validate all files are PDFs
    const invalidFiles = selectedFiles.filter(file => !file.type.includes('pdf'))
    if (invalidFiles.length > 0) {
      setError(`Please select only PDF files. Invalid files: ${invalidFiles.map(f => f.name).join(', ')}`)
      return
    }

    setFiles(selectedFiles)
    setUploadProgress({})
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const droppedFiles = Array.from(event.dataTransfer.files)
    
    // Validate all files are PDFs
    const invalidFiles = droppedFiles.filter(file => !file.type.includes('pdf'))
    if (invalidFiles.length > 0) {
      setError(`Please select only PDF files. Invalid files: ${invalidFiles.map(f => f.name).join(', ')}`)
      return
    }

    setFiles(droppedFiles)
    setUploadProgress({})
    setError(null)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Please select at least one file')
      return
    }

    setUploading(true)
    setError(null)

    try {
      if (files.length === 1) {
        // Single file upload - use existing endpoint
        await uploadSingleFile(files[0])
      } else {
        // Multi-file upload - use batch endpoint
        await uploadMultipleFiles(files)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setUploading(false)
    }
  }

  const uploadSingleFile = async (file: File) => {
    setUploadProgress({ [file.name]: 'Getting upload URL...' })

    const presignedUrlResponse = await fetch(`${import.meta.env.VITE_API_URL}/documents/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        insuranceType: insuranceType
      }),
    })

    if (!presignedUrlResponse.ok) {
      if (presignedUrlResponse.status === 401) {
        throw new Error("Unauthorized: API access denied for generating upload URL.");
      } else {
        const errorData = await presignedUrlResponse.json().catch(() => ({ error: 'Failed to get upload URL.' }));
        throw new Error(errorData.error || `Failed to get upload URL: ${presignedUrlResponse.statusText}`);
      }
    }

    const { uploadUrl, jobId } = await presignedUrlResponse.json()
    if (!uploadUrl || !jobId) {
      throw new Error('Invalid response from upload URL generation endpoint.');
    }

    setUploadProgress({ [file.name]: 'Uploading to S3...' })

    const s3UploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
      },
      body: file,
    })

    if (!s3UploadResponse.ok) {
      throw new Error(`S3 Upload Failed for ${file.name}: ${s3UploadResponse.statusText}`)
    }

    setUploadProgress({ [file.name]: 'Uploaded successfully' })
    setUploading(false)
    setFiles([])
    navigate(`/jobs/${jobId}`)
  }

  const uploadMultipleFiles = async (files: File[]) => {
    // Step 1: Get batch upload URLs
    setUploadProgress(Object.fromEntries(files.map(f => [f.name, 'Getting upload URLs...'])))

    const batchResponse = await fetch(`${import.meta.env.VITE_API_URL}/documents/batch-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: files.map(f => ({ filename: f.name })),
        insuranceType: insuranceType
      }),
    })

    if (!batchResponse.ok) {
      if (batchResponse.status === 401) {
        throw new Error("Unauthorized: API access denied for batch upload.");
      } else {
        const errorData = await batchResponse.json().catch(() => ({ error: 'Failed to get batch upload URLs.' }));
        throw new Error(errorData.error || `Failed to get batch upload URLs: ${batchResponse.statusText}`);
      }
    }

    const { uploadUrls } = await batchResponse.json()
    if (!uploadUrls || !Array.isArray(uploadUrls)) {
      throw new Error('Invalid response from batch upload endpoint.');
    }

    // Step 2: Upload all files to S3
    const uploadPromises = files.map(async (file, index) => {
      const uploadInfo = uploadUrls.find(u => u.filename === file.name)
      if (!uploadInfo) {
        throw new Error(`No upload URL found for ${file.name}`)
      }

      setUploadProgress(prev => ({ ...prev, [file.name]: 'Uploading to S3...' }))

      const s3UploadResponse = await fetch(uploadInfo.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
        },
        body: file,
      })

      if (!s3UploadResponse.ok) {
        throw new Error(`S3 Upload Failed for ${file.name}: ${s3UploadResponse.statusText}`)
      }

      setUploadProgress(prev => ({ ...prev, [file.name]: 'Uploaded successfully' }))
    })

    await Promise.all(uploadPromises)
    
    setUploading(false)
    setFiles([])
    navigate('/jobs')
  }

  return (
    <div className="container">
      <div className="header">
        <h1>
          <span className="header-logo">
            <FontAwesomeIcon icon={faShieldAlt} />
          </span>
          GenAI Enterprise Architecture Workbench
        </h1>
        <div className="header-controls">
          {/*<div className="header-insurance-toggle">
            <label className={`option ${insuranceType === 'life' ? 'selected' : ''}`}>
              <input 
                type="radio" 
                name="headerInsuranceType" 
                value="life" 
                checked={insuranceType === 'life'}
                onChange={() => setInsuranceType('life')} 
              />
              <span className="option-icon"><FontAwesomeIcon icon={faHeartbeat} /></span>
              <span>Life</span>
            </label>
            <label className={`option ${insuranceType === 'property_casualty' ? 'selected' : ''}`}>
              <input 
                type="radio" 
                name="headerInsuranceType" 
                value="property_casualty" 
                checked={insuranceType === 'property_casualty'}
                onChange={() => setInsuranceType('property_casualty')} 
              />
              <span className="option-icon"><FontAwesomeIcon icon={faHome} /></span>
              <span>P&C</span>
            </label>
          </div>*/}
          <button
            type="button"
            onClick={() => navigate('/jobs')}
            className="nav-button"
          >
            <FontAwesomeIcon icon={faList} style={{ marginRight: '8px' }} />
            View All Jobs
          </button>
        </div>
      </div>

      <div className="description-section">
        <h2>
          {insuranceType === 'life' 
            ? 'Streamline Your Architecture Review & Documentation' 
            : 'Streamline Your Architecture Review & Documentation'}
        </h2>
        <p className="intro-text">
          {insuranceType === 'life' 
            ? <span>Accelerate safe delivery: reduce ARB cycle time by <strong>60–80%</strong>, lift standards compliance to <strong>~100% coverage</strong>, and prevent costly rework by catching risks pre-funding.</span>
            : <span>Accelerate safe delivery: reduce ARB cycle time by <strong>60–80%</strong>, lift standards compliance to <strong>~100% coverage</strong>, and prevent costly rework by catching risks pre-funding.</span>}
        </p>
        
        <div className="features-grid">
          <div className="feature-card">
            <h3>
              <FontAwesomeIcon icon={faFileAlt} />
              Document Analysis
            </h3>
            <ul>
              {insuranceType === 'life' ? (
                <>
                  <li><strong>Process end-to-end architecture packs</strong> (HLD, DFD, IaC, DPIA) into a single, auditable review workspace.</li>
                  <li><strong>Extract material risks and assumptions</strong> across security, privacy, reliability, and cost—mapped to enterprise standards.</li>
                  <li><strong>Auto-classify artifacts and evidence</strong> to ensure complete submissions, consistent checks, and faster approvals.</li>
                </>
              ) : (
                <>
                  <li><strong>Process end-to-end architecture packs</strong> (HLD, DFD, IaC, DPIA) into a single, auditable review workspace.</li>
                  <li><strong>Extract material risks and assumptions</strong> across security, privacy, reliability, and cost—mapped to enterprise standards.</li>
                  <li><strong>Auto-classify artifacts and evidence</strong> to ensure complete submissions, consistent checks, and faster approvals.</li>
                </>
              )}
            </ul>
          </div>

          <div className="feature-card">
            <h3>
              <FontAwesomeIcon icon={insuranceType === 'life' ? faStethoscope : faHome} />
              {insuranceType === 'life' ? 'Architecture Assessment' : 'Architecture Assessment'}
            </h3>
            <ul>
              {insuranceType === 'life' ? (
                <>
                  <li><strong>AI-driven architecture risk assessment</strong> across security, reliability, cost, and compliance—prioritized with actionable fixes.</li>
                  <li><strong>Solution timeline construction</strong> that reconstructs scope, data flows, and design changes from submitted artifacts.</li>
                  <li><strong>Cross-document discrepancy detection</strong> between HLD, IaC, BOM, and DPIA to catch issues before build.</li>
                  <li><strong>Automated control evaluation</strong> against enterprise standards (Well-Architected, IM8, PDPA, MAS-TRM) with clause-level citations.</li>
                </>
              ) : (
                <>
                  <li><strong>AI-driven architecture risk assessment</strong> across security, reliability, cost, and compliance—prioritized with actionable fixes.</li>
                  <li><strong>Solution timeline construction</strong> that reconstructs scope, data flows, and design changes from submitted artifacts.</li>
                  <li><strong>Cross-document discrepancy detection</strong> between HLD, IaC, BOM, and DPIA to catch issues before build.</li>
                  <li><strong>Automated control evaluation</strong> against enterprise standards (Well-Architected, IM8, PDPA, MAS-TRM) with clause-level citations.</li>
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
              {insuranceType === 'life' ? (
                <>
                  <li><strong>Query complex architecture histories</strong>—ask natural-language questions across prior designs, decisions, and changes.</li>
                  <li><strong>Instant access to policy-relevant details</strong>—surface applicable clauses, required controls, and exceptions for faster approval.</li>
                  <li><strong>Navigate multi-document submissions</strong>—jump between HLD, DFD, IaC, BOM, and DPIA with linked evidence and citations.</li>
                </>
              ) : (
                <>
                  <li><strong>Query complex architecture histories</strong>—ask natural-language questions across prior designs, decisions, and changes.</li>
                  <li><strong>Instant access to policy-relevant details</strong>—surface applicable clauses, required controls, and exceptions for faster approval.</li>
                  <li><strong>Navigate multi-document submissions</strong>—jump between HLD, DFD, IaC, BOM, and DPIA with linked evidence and citations.</li>
                </>
              )}
            </ul>
          </div>
        </div>

        <div className="supported-documents">
          <h3>Supported Documents</h3>
          <div className="document-types">
            {insuranceType === 'life' ? (
              <>
                <span className="document-type">Architecture Proposal / Solution Overview</span>
                <span className="document-type">High-Level Design (HLD)</span>
                <span className="document-type">Low-Level Design (LLD)</span>
                <span className="document-type">Data Flow / Sequence / Component Diagrams</span>
                <span className="document-type">Infrastructure as Code (CloudFormation / CDK / Terraform)</span>
                <span className="document-type">Network & Security Architecture (VPC, IAM, SGs, KMS)</span>
                <span className="document-type">Threat Model & Security Controls Matrix</span>
                <span className="document-type">Privacy / DPIA / PDPA Assessment</span>
                <span className="document-type">Architecture Decision Records (ADRs)</span>
                <span className="document-type">Bill of Materials & Cost Estimates</span>
                <span className="document-type">Operational Runbooks / SLOs / Monitoring Plans</span>
                <span className="document-type">Disaster Recovery & Backup (RTO/RPO)</span>
                <span className="document-type">API Specs & Integration Contracts (OpenAPI)</span>
                <span className="document-type">Data Models / ERDs / Classification</span>
                <span className="document-type">Compliance Evidence (Well-Architected, IM8, MAS-TRM)</span>
                <span className="document-type">Exception Requests / Risk Register Entries</span>
              </>
            ) : (
              <>
                <span className="document-type">Architecture Proposal / Solution Overview</span>
                <span className="document-type">High-Level Design (HLD)</span>
                <span className="document-type">Low-Level Design (LLD)</span>
                <span className="document-type">Data Flow / Sequence / Component Diagrams</span>
                <span className="document-type">Infrastructure as Code (CloudFormation / CDK / Terraform)</span>
                <span className="document-type">Network & Security Architecture (VPC, IAM, SGs, KMS)</span>
                <span className="document-type">Threat Model & Security Controls Matrix</span>
                <span className="document-type">Privacy / DPIA / PDPA Assessment</span>
                <span className="document-type">Architecture Decision Records (ADRs)</span>
                <span className="document-type">Bill of Materials & Cost Estimates</span>
                <span className="document-type">Operational Runbooks / SLOs / Monitoring Plans</span>
                <span className="document-type">Disaster Recovery & Backup (RTO/RPO)</span>
                <span className="document-type">API Specs & Integration Contracts (OpenAPI)</span>
                <span className="document-type">Data Models / ERDs / Classification</span>
                <span className="document-type">Compliance Evidence (Well-Architected, IM8, MAS-TRM)</span>
                <span className="document-type">Exception Requests / Risk Register Entries</span>
              </>
            )}
            <span className="document-type">And More</span>
          </div>
        </div>
      </div>
      
      <div className="upload-section">
        <h2>
          <FontAwesomeIcon icon={faFileMedical} style={{ marginRight: '10px', color: '#3b82f6' }} />
          Upload Documents
        </h2>
        
        {/*
        <div className="insurance-type-selector">
          <h3>Insurance Type</h3>
          <div className="insurance-options">
            <label className={`option ${insuranceType === 'life' ? 'selected' : ''}`}>
              <input 
                type="radio" 
                name="insuranceType" 
                value="life" 
                checked={insuranceType === 'life'}
                onChange={() => setInsuranceType('life')} 
              />
              <span className="option-icon"><FontAwesomeIcon icon={faHeartbeat} /></span>
              <span className="option-label">Life Insurance</span>
            </label>
            <label className={`option ${insuranceType === 'property_casualty' ? 'selected' : ''}`}>
              <input 
                type="radio" 
                name="insuranceType" 
                value="property_casualty" 
                checked={insuranceType === 'property_casualty'}
                onChange={() => setInsuranceType('property_casualty')} 
              />
              <span className="option-icon"><FontAwesomeIcon icon={faHome} /></span>
              <span className="option-label">Property & Casualty</span>
            </label>
          </div>
        </div>
        */}
        
        <div 
          className={`file-drop-zone ${files.length > 0 ? 'has-files' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <input
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileChange}
            disabled={uploading}
            className="file-input"
            id="file-input"
          />
          <label htmlFor="file-input" className="file-input-label">
            <FontAwesomeIcon icon={faFileMedical} size="2x" />
            <p>
              <strong>Click to select files</strong> or drag and drop PDF files here
            </p>
            <p className="file-hint">
              You can select multiple PDF files at once
            </p>
          </label>
        </div>
        
        {files.length > 0 && (
          <div className="selected-files">
            <h4>Selected Files ({files.length})</h4>
            <ul className="file-list">
              {files.map((file, index) => (
                <li key={index}>
                  {file.name}
                  {uploadProgress[file.name] && (
                    <span className="upload-status"> - {uploadProgress[file.name]}</span>
                  )}
                </li>
              ))}
            </ul>
            <button 
              onClick={handleUpload}
              disabled={uploading}
              className="upload-button"
            >
              {uploading ? 'Uploading...' : `Analyze ${files.length} Document${files.length > 1 ? 's' : ''}`}
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

// Add this new type definition
interface Job {
  jobId: string;
  originalFilename: string;
  uploadTimestamp: string;
  status: 'Complete' | 'In Progress' | 'Failed';
}

// Add the JobsList component
function JobsList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = () => {
    setSearchQuery(searchInput.trim());
  };

  const handleClear = () => {
    setSearchInput('');
    setSearchQuery('');
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const filteredJobs = searchQuery
  ? jobs.filter(job =>
      job.originalFilename.toLowerCase().includes(searchQuery.toLowerCase())
    )
  : jobs;


  useEffect(() => {
    fetchJobs();
    
    // Set up polling to refresh job statuses every 5 seconds
    const pollInterval = setInterval(() => {
      fetchJobs();
    }, 5000);
    
    // Cleanup interval on unmount
    return () => clearInterval(pollInterval);
  }, []);

  const toggleBatch = (batchId: string) => {
    const newCollapsed = new Set(collapsedBatches);
    if (newCollapsed.has(batchId)) {
      newCollapsed.delete(batchId);
    } else {
      newCollapsed.add(batchId);
    }
    setCollapsedBatches(newCollapsed);
  };

  const groupJobsByBatch = (jobs: Job[]) => {
    const grouped = jobs.reduce((acc, job) => {
      const batchId = job.batchId; // All jobs now have batchId
      if (!acc[batchId]) {
        acc[batchId] = [];
      }
      acc[batchId].push(job);
      return acc;
    }, {} as Record<string, Job[]>);
    return grouped;
  };

  const getShortBatchId = (batchId: string) => {
    return batchId.slice(-8);
  };

  const getBatchTimestamp = (jobs: Job[]) => {
    const timestamps = jobs.map(job => new Date(job.uploadTimestamp));
    const earliest = new Date(Math.min(...timestamps.map(d => d.getTime())));
    return earliest.toLocaleString();
  };

  const fetchJobs = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/jobs`);

      if (!response.ok) {
        if (response.status === 401) {
          setError("Unauthorized: API access denied.");
          setLoading(false);
          return;
        }
        throw new Error('Failed to fetch jobs');
      }

      const data = await response.json();
      setJobs(data.jobs || data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Invalid date';
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
          GenAI EA Workbench
        </h1>
        <div className="header-controls">
          <button onClick={() => navigate('/')} className="nav-button">
            <FontAwesomeIcon icon={faFileMedical} /> Upload New
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
          <>
            <div
              className="search-container"
              style={{ textAlign: 'center', margin: '20px 0' }}
            >
              <input
                type="text"
                placeholder="Search by filename"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ padding: '8px', width: '300px' }}
              />
              <button
                onClick={handleSearch}
                style={{
                  padding: '8px 12px',
                  marginLeft: '8px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                <FontAwesomeIcon icon={faSearch} style={{ marginRight: '5px' }} />
                Search
              </button>
              <button
                onClick={handleClear}
                style={{
                  padding: '8px 12px',
                  marginLeft: '8px',
                  background: 'linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%)',
                  color: '#333',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                <FontAwesomeIcon icon={faTimes} style={{ marginRight: '5px' }} />
                Clear
              </button>
            </div>
          <div className="jobs-list">
            {(() => {
              const grouped = groupJobsByBatch(filteredJobs);
              return Object.entries(grouped).map(([batchId, batchJobs]) => (
                <div key={batchId} className="batch-container">
                  <div className="batch-header" onClick={() => toggleBatch(batchId)}>
                    <h3>
                      <span className={`batch-toggle ${collapsedBatches.has(batchId) ? 'collapsed' : ''}`}>▼</span>
                      Batch ID: {getShortBatchId(batchId)}
                    </h3>
                    <p>Uploaded: {getBatchTimestamp(batchJobs)} • {batchJobs.length} document{batchJobs.length !== 1 ? 's' : ''}</p>
                  </div>
                  {!collapsedBatches.has(batchId) && batchJobs.map(job => (
                    <div
                      key={job.jobId}
                      className="job-card indented"
                      onClick={() => navigate(`/jobs/${job.jobId}`)}
                    >
                      <div className="job-icon">
                        <FontAwesomeIcon icon={faFileAlt} />
                      </div>
                      <div className="job-details">
                        <h3 className="job-filename">{job.originalFilename}</h3>
                        <div className="job-meta">
                          <div className="job-date">
                            <FontAwesomeIcon icon={faCalendarAlt} />
                            {formatDate(job.uploadTimestamp)}
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
              ));
            })()}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={
          <UploadPage />
        } />
        <Route path="/jobs" element={
          <JobsList />
        } />
        <Route path="/jobs/:jobId" element={
          <JobPageWrapper />
        } />
      </Routes>
    </Router>
  )
}

export default App

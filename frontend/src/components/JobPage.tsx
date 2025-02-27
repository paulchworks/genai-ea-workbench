import { useState, useEffect, CSSProperties, createContext, useContext } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import Split from 'react-split'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import '../styles/JobPage.css'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../contexts/AuthContext'
import { HowItWorksDrawer } from './HowItWorksDrawer'
// FontAwesome imports
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { 
  faFileAlt, 
  faFileContract, 
  faComments, 
  faChevronRight, 
  faChevronLeft, 
  faExpandAlt, 
  faCompressAlt, 
  faSearchPlus, 
  faSearchMinus,
  faInfoCircle,
  faFileMedical,
  faFileInvoiceDollar,
  faIdCard,
  faClipboardList,
  faUpload,
  faFileImage,
  faCog,
  faDatabase,
  faCheckCircle,
  faUserMd,
  faPills,
  faFlask,
  faHeartbeat,
  faVial,
  faLungs,
  faProcedures,
  faXRay,
  faStethoscope,
  faNotesMedical,
  faMicroscope,
  faHospital,
  faAllergies,
  faTooth,
  faEye,
  faBriefcaseMedical,
  faHistory,
  // P&C insurance related icons
  faHome,
  faCar,
  faBuilding,
  faUmbrella,
  faWater,
  faFire,
  faBalanceScale,
  faExclamationTriangle,
  faTruck,
  faHardHat,
  faIndustry,
  faCloudShowersHeavy,
  faWind,
  faRoad,
  faShieldAlt,
  faGavel,
  faList,
  faClipboardCheck
} from '@fortawesome/free-solid-svg-icons'

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`

interface PageAnalysis {
  [key: string]: string
}

interface UnderwriterAnalysis {
  RISK_ASSESSMENT: string
  DISCREPANCIES: string
  MEDICAL_TIMELINE: string
  FINAL_RECOMMENDATION: string
}

interface PageData {
  page_type: string;
  content: string;
}

// Add new interfaces for bookmarks
interface Bookmark {
  title: string;
  startPage: number;
  pages: number[];
}

interface AnalysisData {
  job_id: string;
  timestamp: string;
  filename: string;
  page_analysis: Record<string, PageData>;
  underwriter_analysis: Record<string, string>;
  status: string;
  pdf_url: string | null;
  insurance_type?: string;
}

interface AnalysisResponse extends Omit<AnalysisData, 'page_analysis' | 'underwriter_analysis' | 'pdf_url'> {
  page_analysis?: Record<string, PageData>;
  underwriter_analysis?: Record<string, string>;
  pdf_url?: string | null;
}

interface JobPageProps {
  jobId: string
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

// Add styles for the markdown content
const markdownStyles: Record<string, CSSProperties> = {
  p: { margin: '0.5em 0' },
  'h1,h2,h3,h4,h5,h6': { margin: '0.5em 0' },
  pre: { background: '#f1f5f9', padding: '0.5em', borderRadius: '4px' },
  code: { background: '#f1f5f9', padding: '0.2em 0.4em', borderRadius: '3px' },
  table: { borderCollapse: 'collapse', width: '100%' },
  'th,td': { border: '1px solid #e2e8f0', padding: '8px' },
  blockquote: { 
    borderLeft: '4px solid #e2e8f0', 
    margin: '0.5em 0', 
    padding: '0.5em 1em',
    background: '#f8fafc'
  }
}

// Add this new component before the JobPage component
const PageReference = ({ pageNum, text }: { pageNum: string, text: string }) => {
  const [currentPage, setCurrentPage] = useContext(PageContext)
  const [numPages] = useContext(NumPagesContext)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const page = parseInt(pageNum)
    if (!isNaN(page) && page > 0 && page <= (numPages || 0)) {
      setCurrentPage(page)
    }
  }

  return (
    <span className="page-reference" onClick={handleClick}>
      {text}
    </span>
  )
}

// Add these contexts before the JobPage component
const PageContext = createContext<[number, (page: number) => void]>([1, () => {}])
const NumPagesContext = createContext<[number | null, (pages: number | null) => void]>([null, () => {}])

// First, add a type for the tab options
type TabType = 'grouped' | 'underwriter' | 'chat';

// Add this function before the JobPage component
const getDocumentIcon = (documentType: string) => {
  // Match for medical types
  if (/medic(al|ation)|(health|disease)/i.test(documentType)) {
    return faFileMedical;
  }
  
  // Match for medical history
  if (/history|anamnesis/i.test(documentType)) {
    return faHistory;
  }
  
  // Match for pharmacy or medication
  if (/pharmac(y|eutical)|medication|drug|prescription/i.test(documentType)) {
    return faPills;
  }
  
  // Match for laboratory or clinical tests
  if (/lab(oratory)?|clinical|test|specimen/i.test(documentType)) {
    return faFlask;
  }
  
  // Match for doctor/physician
  if (/physician|doctor|practitioner|clinician|md\b/i.test(documentType)) {
    return faUserMd;
  }
  
  // Match for examination/paramedical
  if (/exam(ination)?|assessment|paramedical/i.test(documentType)) {
    return faStethoscope;
  }
  
  // Match for hospital/clinic
  if (/hospital|clinic|center|facility|institution/i.test(documentType)) {
    return faHospital;
  }
  
  // Match for X-Ray/imaging
  if (/x-ray|imaging|scan|radiolog(y|ical)|mri|ct scan/i.test(documentType)) {
    return faXRay;
  }
  
  // Match for surgical/procedure
  if (/surg(ery|ical)|procedure|operation/i.test(documentType)) {
    return faProcedures;
  }
  
  // Match for cardiology
  if (/cardio|heart|cardiac|pulse|ekg|ecg/i.test(documentType)) {
    return faHeartbeat;
  }
  
  // Match for pulmonary
  if (/pulmonary|lung|respiratory|breath/i.test(documentType)) {
    return faLungs;
  }
  
  // Match for allergy
  if (/allerg(y|ies)|immunolog(y|ical)/i.test(documentType)) {
    return faAllergies;
  }
  
  // Match for dental
  if (/dental|dentist|tooth|teeth|oral/i.test(documentType)) {
    return faTooth;
  }
  
  // Match for ophthalmology
  if (/eye|vision|ophthalm(ology|ologist)|optical/i.test(documentType)) {
    return faEye;
  }
  
  // Match for insurance/financial
  if (/insurance|financial|coverage|policy|premium|underwriter/i.test(documentType)) {
    return faFileInvoiceDollar;
  }
  
  // Match for forms/questionnaires
  if (/form|(question|survey)(naire)?|assessment/i.test(documentType)) {
    return faClipboardList;
  }
  
  // Match for detailed medical notes
  if (/note|report|summary|record/i.test(documentType)) {
    return faNotesMedical;
  }
  
  // Match for microscopic/detailed analysis
  if (/microscop(e|ic)|patholog(y|ical)|cytolog(y|ical)|histolog(y|ical)/i.test(documentType)) {
    return faMicroscope;
  }
  
  // Match for blood/specimen tests
  if (/blood|hematolog(y|ical)|serum|plasma|specimen/i.test(documentType)) {
    return faVial;
  }
  
  // Match for emergency/urgent care
  if (/emergency|urgent|trauma|ambulance|ems/i.test(documentType)) {
    return faBriefcaseMedical;
  }
  
  // Property & Casualty Insurance Documents
  
  // Match for home/property insurance
  if (/home|property|dwelling|real estate|building|structure/i.test(documentType)) {
    return faHome;
  }
  
  // Match for auto insurance
  if (/auto|car|vehicle|motorcycle|truck|collision/i.test(documentType)) {
    return faCar;
  }
  
  // Match for commercial property
  if (/commercial|business property|office|warehouse|retail/i.test(documentType)) {
    return faBuilding;
  }
  
  // Match for umbrella/liability policies
  if (/umbrella|liability|excess|protection/i.test(documentType)) {
    return faUmbrella;
  }
  
  // Match for flood insurance
  if (/flood|water damage|rising water|overflow/i.test(documentType)) {
    return faWater;
  }
  
  // Match for fire insurance/protection
  if (/fire|flame|burn|combustion|smoke/i.test(documentType)) {
    return faFire;
  }
  
  // Match for legal/liability documents
  if (/legal|liability|lawsuit|litigation|tort/i.test(documentType)) {
    return faBalanceScale;
  }
  
  // Match for hazard/risk documents
  if (/hazard|risk|danger|peril|warning/i.test(documentType)) {
    return faExclamationTriangle;
  }
  
  // Match for commercial auto/fleet
  if (/fleet|commercial auto|commercial vehicle|transport/i.test(documentType)) {
    return faTruck;
  }
  
  // Match for workers' compensation
  if (/workers comp|workers' compensation|workplace injury|occupational/i.test(documentType)) {
    return faHardHat;
  }
  
  // Match for industrial/manufacturing
  if (/industrial|manufacturing|factory|plant|production/i.test(documentType)) {
    return faIndustry;
  }
  
  // Match for storm/weather related
  if (/storm|hurricane|tornado|hail|weather damage/i.test(documentType)) {
    return faCloudShowersHeavy;
  }
  
  // Match for wind damage
  if (/wind|windstorm|gust|gale/i.test(documentType)) {
    return faWind;
  }
  
  // Match for roadway/traffic incidents
  if (/roadway|highway|traffic|intersection|accident|crash/i.test(documentType)) {
    return faRoad;
  }
  
  // Match for protection/security
  if (/protection|security|safeguard|defense|safety/i.test(documentType)) {
    return faShieldAlt;
  }
  
  // Match for claims/legal judgments
  if (/claim|judgment|settlement|adjudication|ruling/i.test(documentType)) {
    return faGavel;
  }
  
  // Default for contract/agreement
  if (/contract|agreement|terms|certificate/i.test(documentType)) {
    return faFileContract;
  }
  
  // Default fallback
  return faFileAlt;
};

export function JobPage({ jobId }: JobPageProps) {
  const [error, setError] = useState<string | null>(null)
  const [showError, setShowError] = useState(false)
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null)
  const [partialAnalysis, setPartialAnalysis] = useState<Record<string, PageData>>({})
  const [currentStep, setCurrentStep] = useState(1)
  const [currentPhase, setCurrentPhase] = useState<string>('Data Extraction')
  const [phaseDetails, setPhaseDetails] = useState<string>('Loading...')
  const [numPages, setNumPages] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [activeTab, setActiveTab] = useState<TabType>('grouped')
  const [streamConnected, setStreamConnected] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [insuranceType, setInsuranceType] = useState<'life' | 'property_casualty'>('life')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hi! I'm your AI assistant. I've analyzed this document and can help answer any questions you have about it.",
      sender: 'ai',
      timestamp: new Date()
    }
  ])
  const [newMessage, setNewMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [scale, setScale] = useState(1.0)
  const [isAnalysisPanelOpen, setIsAnalysisPanelOpen] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false)
  const [pdfWidth, setPdfWidth] = useState<number | undefined>(undefined)

  // Calculate PDF width based on container size
  useEffect(() => {
    const calculatePdfWidth = () => {
      const containerWidth = isAnalysisPanelOpen 
        ? window.innerWidth * 0.45 // When split view is active
        : window.innerWidth * 0.9; // When PDF is expanded
      
      // Set a maximum width to prevent the PDF from being too large
      const maxWidth = 1000;
      const width = Math.min(containerWidth, maxWidth);
      
      setPdfWidth(width);
    };

    // Calculate initially
    calculatePdfWidth();
    
    // Recalculate on window resize
    window.addEventListener('resize', calculatePdfWidth);
    
    // Clean up
    return () => {
      window.removeEventListener('resize', calculatePdfWidth);
    };
  }, [isAnalysisPanelOpen]);

  // Update initial greeting when insurance type is available
  useEffect(() => {
    if (analysisData?.insurance_type) {
      const insuranceType = analysisData.insurance_type;
      console.log("INSURANCE TYPE detected in JobPage:", insuranceType);
      let greeting = "Hi! I'm your AI assistant. I've analyzed this document and can help answer any questions you have about it.";
      
      if (insuranceType === 'property_casualty') {
        greeting = "Hello! I'm your Property & Casualty insurance underwriting assistant. I've analyzed this document and can help with questions about property details, risk factors, and coverage considerations.";
        console.log("Using P&C GREETING");
      } else {
        greeting = "Hello! I'm your Life Insurance underwriting assistant. I've analyzed this document and can help with questions about medical history, risk factors, and policy considerations.";
        console.log("Using LIFE GREETING");
      }
      
      setMessages([{
        id: '1',
        text: greeting,
        sender: 'ai',
        timestamp: new Date()
      }]);
    }
  }, [analysisData?.insurance_type]);

  // Update insurance type when analysis data is loaded
  useEffect(() => {
    if (analysisData?.insurance_type) {
      setInsuranceType(analysisData.insurance_type as 'life' | 'property_casualty');
    }
  }, [analysisData]);

  // Function to handle unauthorized responses
  const handleUnauthorized = () => {
    logout();
    navigate('/login');
  };

  // Function to fetch PDF and create blob URL
  const fetchPDF = async (jobId: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        handleUnauthorized();
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/pdf/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      })
      if (!response.ok) {
        if (response.status === 401) {
          handleUnauthorized();
          return;
        }
        throw new Error('Failed to fetch PDF')
      }
      
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      setPdfBlob(blob)
      setPdfUrl(blobUrl)
    } catch (err) {
      console.error('Error fetching PDF:', err)
      setError('Failed to load PDF')
    }
  }

  // Function to fetch completed analysis from DynamoDB
  const fetchAnalysis = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        handleUnauthorized();
        return false;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/analysis/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      });
      if (!response.ok) {
        if (response.status === 401) {
          handleUnauthorized();
          return false;
        }
        if (response.status === 404) {
          // Analysis not found - this is expected for in-progress jobs
          return false;
        }
        throw new Error('Failed to fetch analysis');
      }
      const data: AnalysisResponse = await response.json();
      // Ensure the data matches our expected type
      const analysisData: AnalysisData = {
        job_id: data.job_id,
        timestamp: data.timestamp,
        filename: data.filename,
        page_analysis: data.page_analysis || {},
        underwriter_analysis: data.underwriter_analysis || {},
        status: data.status,
        pdf_url: data.pdf_url || null,
        insurance_type: data.insurance_type
      };
      setAnalysisData(analysisData);
      setCurrentStep(3); // Analysis is complete
      setCurrentPhase('Complete');
      setPhaseDetails('Analysis complete');
      return true;
    } catch (err) {
      console.error('Error fetching analysis:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch analysis');
      return false;
    }
  };

  useEffect(() => {
    fetchAnalysis();
  }, [jobId]);

  // Function to establish streaming connection
  const connectToStream = (): EventSource | null => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      handleUnauthorized();
      return null;
    }

    const eventSource = new EventSource(`${import.meta.env.VITE_API_URL}/analyze-progress/${jobId}?token=${token}`)
    setStreamConnected(true)

    // Clear any existing errors when we start a new connection
    setError(null)
    setShowError(false)

    eventSource.onmessage = (event) => {
      try {
        const eventData = JSON.parse(event.data);
        if (eventData.type === 'batch_complete' && eventData.pages) {
          const newPages = eventData.pages as Record<string, PageData>;
          setPartialAnalysis(current => ({
            ...current,
            ...newPages
          }));
        } else if (eventData.type === 'phase1_complete') {
          setCurrentStep(2);
          setCurrentPhase('Underwriter Analysis');
          
          // Use different message based on insurance type
          const insuranceType = analysisData?.insurance_type || 'life';
          if (insuranceType === 'property_casualty') {
            setPhaseDetails('Analyzing property risk factors and liability exposures...');
          } else {
            setPhaseDetails('Analyzing medical history and mortality risk factors...');
          }
          
        } else if (eventData.type === 'complete') {
          setCurrentStep(3);
          setCurrentPhase('Complete');
          setPhaseDetails('Analysis complete');
          // Trigger a fetch of the final analysis
          void fetchAnalysis();
        } else if (eventData.type === 'error') {
          setError(eventData.message || 'An error occurred during analysis');
        } else if (eventData.type === 'progress') {
          setPhaseDetails(eventData.message);
        }
      } catch (err) {
        console.error('Error parsing event data:', err);
      }
    };

    eventSource.onerror = () => {
      console.log('EventSource failed.')
      eventSource.close()
      setStreamConnected(false)
    };

    return eventSource;
  }

  // Effect for initialization and cleanup
  useEffect(() => {
    let isSubscribed = true;
    let eventSource: EventSource | null = null;
    let currentBlobUrl: string | null = null;

    const init = async () => {
      try {
        // First try to fetch completed analysis
        const analysisExists = await fetchAnalysis();
        if (!analysisExists && isSubscribed) {
          eventSource = connectToStream();
        }

        // Fetch PDF
        await fetchPDF(jobId);
      } catch (err) {
        console.error('Error in initialization:', err);
        if (isSubscribed) {
          setError(err instanceof Error ? err.message : 'Failed to initialize');
        }
      }
    };

    init();

    return () => {
      isSubscribed = false;
      if (eventSource) {
        eventSource.close();
      }
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
      setStreamConnected(false);
    };
  }, [jobId]); // Only depend on jobId

  // Handle page navigation from links
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    console.log("in handleLinkClick")
    e.preventDefault()
    const href = e.currentTarget.getAttribute('href')
    console.log("href", href)
    if (href?.startsWith('/page/')) {
      const pageNum = href.split('/').pop()
      if (pageNum) {
        const page = parseInt(pageNum)
        if (!isNaN(page) && page > 0 && page <= (numPages || 0)) {
          setCurrentPage(page)
        }
      }
    }
  }

  const renderGroupedAnalysis = () => {
    const analysis = (partialAnalysis && Object.keys(partialAnalysis).length > 0) 
      ? partialAnalysis 
      : analysisData?.page_analysis

    if (!analysis || Object.keys(analysis).length === 0) {
        console.log("No analysis data available")
        return null
    }

    // Convert object entries to array
    const pages = Object.entries(analysis).map(([pageNum, pageData]) => {
      const { page_type, content } = pageData as PageData
      return {
        pageNum: parseInt(pageNum),
        pageType: page_type,
        content
      }
    })
    
    // Group pages by document type (text before any dash)
    const groups: Record<string, typeof pages> = {}
    
    pages.forEach(page => {
      // Get the document type (text before the dash)
      const dashIndex = page.pageType.indexOf('-')
      const docType = dashIndex > 0 
        ? page.pageType.substring(0, dashIndex).trim() 
        : page.pageType.trim()
      
      // Create the group if it doesn't exist
      if (!groups[docType]) {
        groups[docType] = []
      }
      
      // Add the page to its group
      groups[docType].push(page)
    })

    return (
      <div className="grouped-analysis">
        {Object.entries(groups).map(([groupTitle, groupPages]) => {
          // Sort pages by page number to ensure we get the first page of the section
          const sortedPages = [...groupPages].sort((a, b) => a.pageNum - b.pageNum);
          const firstPageInGroup = sortedPages[0]?.pageNum;
          
          return (
            <div 
              key={groupTitle}
              className={`analysis-group`}
            >
              <button 
                className={`group-header ${expandedGroups.has(groupTitle) ? 'expanded' : ''}`}
                onClick={(e) => {
                  // Toggle the expanded state
                  const updatedGroups = new Set(expandedGroups);
                  if (updatedGroups.has(groupTitle)) {
                    updatedGroups.delete(groupTitle);
                  } else {
                    updatedGroups.add(groupTitle);
                  }
                  setExpandedGroups(updatedGroups);
                  
                  // Navigate to the first page of the group
                  if (firstPageInGroup) {
                    setCurrentPage(firstPageInGroup);
                  }
                }}
              >
                <div className="group-title">
                  <FontAwesomeIcon icon={getDocumentIcon(groupTitle)} />
                  {groupTitle} ({groupPages.length} {groupPages.length === 1 ? 'page' : 'pages'})
                </div>
                <FontAwesomeIcon 
                  icon={expandedGroups.has(groupTitle) ? faChevronLeft : faChevronRight} 
                />
              </button>
              
              {expandedGroups.has(groupTitle) && (
                <div className="group-content">
                  {groupPages.map(page => (
                    <div 
                      key={page.pageNum}
                      className={`page-card ${currentPage === page.pageNum ? 'active' : ''}`}
                      onClick={() => setCurrentPage(page.pageNum)}
                    >
                      <div className="page-header">
                        <div className="page-number">Page {page.pageNum}</div>
                        <div className="page-type">{page.pageType}</div>
                      </div>
                      <div className="page-content">
                        {page.content.split('\n').map((line: string, i: number) => (
                          line.trim() !== '' && <div key={i} className="content-line">{line}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    )
  }

  const renderUnderwriterAnalysis = () => {
    if (!analysisData?.underwriter_analysis) return null;
    
    console.log("renderUnderwriterAnalysis - insurance type:", analysisData?.insurance_type);
    
    // Define the order of sections with appropriate icons based on insurance type
    const sectionConfig = (analysisData.insurance_type === 'property_casualty') 
      ? [
          { key: 'RISK_ASSESSMENT', icon: faClipboardCheck },
          { key: 'DISCREPANCIES', icon: faClipboardList },
          { key: 'PROPERTY_ASSESSMENT', icon: faHome },
          { key: 'FINAL_RECOMMENDATION', icon: faCheckCircle }
        ]
      : [
          { key: 'RISK_ASSESSMENT', icon: faBriefcaseMedical },
          { key: 'DISCREPANCIES', icon: faClipboardList },
          { key: 'MEDICAL_TIMELINE', icon: faHistory },
          { key: 'FINAL_RECOMMENDATION', icon: faCheckCircle }
        ];
    
    console.log("Using section config:", sectionConfig.map(s => s.key).join(', '));
    
    return (
      <div className="underwriter-analysis">
        {sectionConfig.map(({key, icon}) => {
          const content = analysisData.underwriter_analysis[key];
          if (!content) {
            console.log(`No content found for section: ${key}`);
            return null;
          }
          
          console.log(`Rendering section: ${key} with content length: ${content.length}`);
          
          return (
            <div key={key} className="analysis-section">
              <h3><FontAwesomeIcon icon={icon} /> {key.replace(/_/g, ' ')}</h3>
              <div className="analysis-content">
                {content.split('\n').map((line: string, i: number) => {
                  // Make page references clickable
                  const pageMatches = line.match(/\b(?:page|pg\.?|p\.?)\s*(\d+)\b/gi)
                  if (pageMatches) {
                    let lastIndex = 0
                    const parts: JSX.Element[] = []
                    
                    pageMatches.forEach((match: string) => {
                      const index = line.indexOf(match, lastIndex)
                      const pageNum = match.match(/\d+/)?.[0]
                      
                      // Add text before the match
                      if (index > lastIndex) {
                        parts.push(
                          <span key={`text-${i}-${index}`}>
                            {line.slice(lastIndex, index)}
                          </span>
                        )
                      }
                      
                      // Add the page reference
                      if (pageNum) {
                        parts.push(
                          <PageReference 
                            key={`ref-${i}-${index}`}
                            pageNum={pageNum}
                            text={match}
                          />
                        )
                      }
                      
                      lastIndex = index + match.length
                    })
                    
                    // Add any remaining text
                    if (lastIndex < line.length) {
                      parts.push(
                        <span key={`text-${i}-end`}>
                          {line.slice(lastIndex)}
                        </span>
                      )
                    }
                    
                    return <p key={i}>{parts}</p>
                  }
                  return <p key={i}>{line}</p>
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      text: newMessage.trim(),
      sender: 'user',
      timestamp: new Date()
    }

    // Add user message to history
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setNewMessage('')
    setIsTyping(true)

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        handleUnauthorized();
        return;
      }

      // Filter out the initial greeting when sending to backend
      const messagesToSend = updatedMessages.filter(msg => msg.id !== '1')
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/chat/${jobId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: messagesToSend
        }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          handleUnauthorized();
          return;
        }
        throw new Error('Failed to get response from AI')
      }

      const data = await response.json()
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: data.response,
        sender: 'ai',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, aiMessage])
    } catch (err) {
      // Add error message to chat
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "Sorry, I encountered an error while processing your message. Please try again.",
        sender: 'ai',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsTyping(false)
    }
  }

  // Wrap the main content in the contexts
  return (
    <PageContext.Provider value={[currentPage, setCurrentPage]}>
      <NumPagesContext.Provider value={[numPages, setNumPages]}>
        <div className="container">
          {/* Navigation buttons */}
          <div className="page-navigation">
            <button 
              onClick={() => navigate('/')} 
              className="nav-button"
            >
              <FontAwesomeIcon icon={faFileMedical} /> Upload New
            </button>
          </div>
          
          {/* How It Works Button */}
          <button 
            className="how-it-works-button"
            onClick={() => setIsHowItWorksOpen(!isHowItWorksOpen)}
          >
            <FontAwesomeIcon icon={faInfoCircle} /> How It Works
          </button>

          {/* Job info section with insurance type */}
          <div className="job-header">
            <h1>{analysisData?.filename}</h1>
            <div className="header-controls">
              {analysisData && (
                <div className="insurance-type-badge">
                  {insuranceType === 'property_casualty' ? (
                    <span className="badge p-and-c">
                      <FontAwesomeIcon icon={faHome} /> Property & Casualty
                    </span>
                  ) : (
                    <span className="badge life">
                      <FontAwesomeIcon icon={faBriefcaseMedical} /> Life Insurance
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {(currentStep < 3 || currentPhase !== 'Complete') && (
            <>
              <h1>Analysis Progress</h1>
              
              {error && showError && (
                <div className="error-message">
                  {error}
                  <button 
                    onClick={() => {
                      setError(null)
                      setShowError(false)
                      if (!streamConnected) connectToStream()
                    }}
                    className="upload-button"
                    style={{ marginLeft: '1rem' }}
                  >
                    Retry Connection
                  </button>
                </div>
              )}
              
              <div className="progress-container">
                <div className="progress-steps">
                  <div className={`progress-dot ${currentStep >= 1 ? 'active' : ''}`}>
                    {currentStep >= 1 && <FontAwesomeIcon icon={faUpload} className="progress-icon" />}
                  </div>
                  <div className={`progress-line ${currentStep >= 2 ? 'active' : ''}`} />
                  <div className={`progress-dot ${currentStep >= 2 ? 'active' : ''}`}>
                    {currentStep >= 2 && <FontAwesomeIcon icon={faCog} className="progress-icon" />}
                  </div>
                  <div className={`progress-line ${currentStep >= 3 ? 'active' : ''}`} />
                  <div className={`progress-dot ${currentStep >= 3 ? 'active' : ''}`}>
                    {currentStep >= 3 && <FontAwesomeIcon icon={faCheckCircle} className="progress-icon" />}
                  </div>
                </div>
                <div className="progress-label">{currentPhase}</div>
                <div className="progress-details">{phaseDetails}</div>
              </div>
            </>
          )}
          
          {error && showError && !(currentStep < 3 || currentPhase !== 'Complete') && (
            <div className="error-message">
              {error}
              <button 
                onClick={() => {
                  setError(null)
                  setShowError(false)
                  if (!streamConnected) connectToStream()
                }}
                className="upload-button"
                style={{ marginLeft: '1rem' }}
              >
                Retry Connection
              </button>
            </div>
          )}

          {(partialAnalysis || analysisData) && (
            <div style={{ position: 'relative' }}>
              <Split 
                className="split-view"
                sizes={isAnalysisPanelOpen ? [50, 50] : [100, 0]}
                minSize={[300, 0]}
                gutterSize={10}
              >
                <div className={`pdf-viewer ${!isAnalysisPanelOpen ? 'expanded' : ''}`}>
                  {pdfUrl && (
                    <>
                      <Document
                        file={pdfUrl}
                        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                        loading={<div>Loading PDF...</div>}
                        error={<div>Error loading PDF.</div>}
                      >
                        <div className="pdf-container">
                          <div className="pdf-controls">
                            <button 
                              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                              disabled={currentPage <= 1}
                            >
                              <FontAwesomeIcon icon={faChevronLeft} /> Previous
                            </button>
                            <span>{`Page ${currentPage} of ${numPages}`}</span>
                            <button 
                              onClick={() => setCurrentPage(p => Math.min(numPages || p, p + 1))}
                              disabled={currentPage >= (numPages || 1)}
                            >
                              Next <FontAwesomeIcon icon={faChevronRight} />
                            </button>
                            <div className="zoom-controls">
                              <button 
                                onClick={() => setScale(s => Math.max(0.5, s - 0.1))}
                                disabled={scale <= 0.5}
                              >
                                <FontAwesomeIcon icon={faSearchMinus} />
                              </button>
                              <span className="zoom-level">{`${Math.round(scale * 100)}%`}</span>
                              <button 
                                onClick={() => setScale(s => Math.min(2.0, s + 0.1))}
                                disabled={scale >= 2.0}
                              >
                                <FontAwesomeIcon icon={faSearchPlus} />
                              </button>
                            </div>
                          </div>
                          <Page 
                            pageNumber={currentPage} 
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            scale={scale}
                            width={pdfWidth}
                          />
                        </div>
                      </Document>
                    </>
                  )}
                </div>

                <div className={`analysis-viewer ${!isAnalysisPanelOpen ? 'collapsed' : ''}`}>
                  <div className="tabs">
                    <button 
                      className={`tab-button ${activeTab === 'grouped' ? 'active' : ''}`}
                      onClick={() => setActiveTab('grouped')}
                    >
                      <FontAwesomeIcon icon={faFileAlt} /> Document Analysis
                    </button>
                    <button 
                      className={`tab-button ${activeTab === 'underwriter' ? 'active' : ''}`}
                      onClick={() => setActiveTab('underwriter')}
                    >
                      <FontAwesomeIcon icon={faFileContract} /> Underwriter Analysis
                    </button>
                    <button 
                      className={`tab-button ${activeTab === 'chat' ? 'active' : ''}`}
                      onClick={() => setActiveTab('chat')}
                    >
                      <FontAwesomeIcon icon={faComments} /> 
                      Chat Assistant
                      {analysisData?.insurance_type && (
                        <span className={`chat-type-indicator ${analysisData.insurance_type === 'property_casualty' ? 'p-and-c' : 'life'}`}>
                          {analysisData.insurance_type === 'property_casualty' ? 'P&C' : 'Life'}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="tab-content">
                    {((): JSX.Element | null => {
                      switch(activeTab) {
                        case 'grouped':
                          return renderGroupedAnalysis();
                        case 'underwriter':
                          return renderUnderwriterAnalysis();
                        case 'chat':
                          return (
                            <div className="chat-interface">
                              <div className="chat-messages">
                                {messages.map(message => (
                                  <div 
                                    key={message.id} 
                                    className={`chat-message ${message.sender}`}
                                  >
                                    <div className={`chat-avatar ${message.sender}`}>
                                      {message.sender === 'user' ? 'U' : 'AI'}
                                    </div>
                                    <div className="chat-bubble">
                                      {message.sender === 'user' ? (
                                        message.text
                                      ) : (
                                        <ReactMarkdown 
                                          remarkPlugins={[remarkGfm]}
                                          components={{
                                            a: ({href, children}) => (
                                              <a 
                                                href={href} 
                                                onClick={handleLinkClick}
                                                className="page-reference"
                                              >
                                                {children}
                                              </a>
                                            ),
                                            p: ({children, ...props}) => (
                                              <p style={markdownStyles.p} {...props}>{children}</p>
                                            ),
                                            h1: ({children, ...props}) => (
                                              <h1 style={markdownStyles['h1,h2,h3,h4,h5,h6']} {...props}>{children}</h1>
                                            ),
                                            h2: ({children, ...props}) => (
                                              <h2 style={markdownStyles['h1,h2,h3,h4,h5,h6']} {...props}>{children}</h2>
                                            ),
                                            h3: ({children, ...props}) => (
                                              <h3 style={markdownStyles['h1,h2,h3,h4,h5,h6']} {...props}>{children}</h3>
                                            ),
                                            pre: ({node, ...props}) => <pre style={markdownStyles.pre} {...props} />,
                                            code: ({node, ...props}) => <code style={markdownStyles.code} {...props} />,
                                            table: ({node, ...props}) => <table style={markdownStyles.table} {...props} />,
                                            th: ({node, ...props}) => <th style={markdownStyles['th,td']} {...props} />,
                                            td: ({node, ...props}) => <td style={markdownStyles['th,td']} {...props} />,
                                            blockquote: ({node, ...props}) => <blockquote style={markdownStyles.blockquote} {...props} />,
                                          }}
                                        >
                                          {message.text}
                                        </ReactMarkdown>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {isTyping && (
                                  <div className="chat-message ai">
                                    <div className="chat-avatar ai">AI</div>
                                    <div className="chat-bubble">
                                      Typing...
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="chat-input-container">
                                <form className="chat-input-form" onSubmit={handleSendMessage}>
                                  <textarea
                                    className="chat-input"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Ask me anything about the document..."
                                    rows={1}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault()
                                        handleSendMessage(e)
                                      }
                                    }}
                                  />
                                  <button 
                                    type="submit" 
                                    className="chat-send"
                                    disabled={!newMessage.trim() || isTyping}
                                  >
                                    Send
                                  </button>
                                </form>
                              </div>
                            </div>
                          );
                        default:
                          return null;
                      }
                    })()}
                  </div>
                </div>
              </Split>
              <button 
                className="analysis-toggle"
                onClick={() => setIsAnalysisPanelOpen(!isAnalysisPanelOpen)}
                aria-label={isAnalysisPanelOpen ? "Hide Analysis" : "Show Analysis"}
              >
                <FontAwesomeIcon icon={isAnalysisPanelOpen ? faChevronLeft : faChevronRight} />
              </button>
            </div>
          )}
        </div>

        {/* How It Works Drawer */}
        {isHowItWorksOpen && <HowItWorksDrawer onClose={() => setIsHowItWorksOpen(false)} />}
      </NumPagesContext.Provider>
    </PageContext.Provider>
  )
} 
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShieldAlt,
  faFileAlt,
  faStethoscope,
  faRobot,
  faFileMedical,
  faHeartbeat,
  faHome,
} from "@fortawesome/free-solid-svg-icons";

export function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insuranceType, setInsuranceType] = useState<
    "life" | "property_casualty"
  >("life");
  const navigate = useNavigate();

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
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/analyze-stream`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
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
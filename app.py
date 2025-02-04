from flask import Flask, request, jsonify
import os
import tempfile
from werkzeug.utils import secure_filename
from extract import analyze_document, underwriter_analysis

app = Flask(__name__)

# Configure upload settings
ALLOWED_EXTENSIONS = {'pdf'}
UPLOAD_FOLDER = tempfile.gettempdir()  # Use system temp directory
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/analyze', methods=['POST'])
def analyze():
    # Check if a file was included in the request
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Only PDF files are allowed'}), 400

    try:
        # Get optional parameters
        batch_size = request.form.get('batch_size', default=3, type=int)
        page_limit = request.form.get('page_limit', default=None, type=int)

        # Save uploaded file to temp directory
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # Run analysis
        try:
            # Phase 1: Document analysis
            page_analysis = analyze_document(filepath, batch_size, page_limit)
            
            # Phase 2: Underwriter analysis
            final_analysis = underwriter_analysis(page_analysis, batch_size)

            # Prepare response
            response = {
                'success': True,
                'page_analysis': page_analysis,
                'underwriter_analysis': final_analysis
            }
            
            return jsonify(response)

        except Exception as e:
            return jsonify({
                'error': 'Analysis failed',
                'details': str(e)
            }), 500

    except Exception as e:
        return jsonify({
            'error': 'File processing failed',
            'details': str(e)
        }), 500

    finally:
        # Clean up: remove temporary file
        try:
            os.remove(filepath)
        except:
            pass  # Ignore cleanup errors

if __name__ == '__main__':
    app.run(debug=True) 
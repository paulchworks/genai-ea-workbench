const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    try {
      setIsUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('insuranceType', insuranceType);
      console.log(`Uploading file with insurance type: ${insuranceType}`);

      // First get an analysis ID
      const initResponse = await fetch(`${import.meta.env.VITE_API_URL}/analyze-stream`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData
      });

      if (!initResponse.ok) {
        throw new Error('Upload failed');
      }

      const { analysisId } = await initResponse.json();
      navigate(`/jobs/${analysisId}`);

    } catch (err) {
      console.error('Error uploading file:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during upload');
      setIsUploading(false);
    }
  }; 
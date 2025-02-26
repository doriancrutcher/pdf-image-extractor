import React, { useState, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFDict, PDFStream, PDFRawStream } from 'pdf-lib';
import './App.css';
import pako from 'pako';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

function App() {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [extractedImages, setExtractedImages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const canvasRef = React.useRef(null);

  // Function to render the current PDF page
  const renderPage = async (pageNumber) => {
    console.log('pdf document', pdfDocument)
    if (!pdfDocument) return;
    
    try {
      const page = await pdfDocument.getPage(pageNumber);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      // Set scale for better viewing
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      // Render PDF page
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
    } catch (error) {
      console.error('Error rendering page:', error);
    }
  };

  // Effect to render the current page when it changes
  useEffect(() => {
    const renderCurrentPage = async () => {
      if (pdfDocument) {
        console.log('Rendering page', currentPage, 'from document:', pdfDocument);
        try {
          await renderPage(currentPage);
        } catch (error) {
          console.error('Error in useEffect rendering page:', error);
        }
      }
    };
    
    renderCurrentPage();
  }, [pdfDocument, currentPage]);

  // Function to extract images from a PDF page
  const extractImagesFromPage = async (pageNumber, pdfDoc) => {
    // Use the passed pdfDoc instead of the state variable
    const docToUse = pdfDoc || pdfDocument;
    
    if (!docToUse) {
      console.error('No PDF document available');
      return;
    }
    
    try {
      console.log(`Getting page ${pageNumber}...`);
      const page = await docToUse.getPage(pageNumber);
      console.log(`Got page ${pageNumber}:`, page);
      
      // Get the operator list
      const operatorList = await page.getOperatorList();
      
      // Define valid image operators
      const validImageOperators = [
        pdfjsLib.OPS.paintImageXObject,
        pdfjsLib.OPS.paintImageXObjectRepeat,
        pdfjsLib.OPS.paintJpegXObject
      ];
      
      // Process each operator
      for (let i = 0; i < operatorList.fnArray.length; i++) {
        const op = operatorList.fnArray[i];
        
        if (validImageOperators.includes(op)) {
          const imageName = operatorList.argsArray[i][0];
          console.log(`Found image on page ${pageNumber}: ${imageName}`);
          
          try {
            // This is the key part - use the asynchronous approach first
            let imageObj;
            
            console.log('Using asynchronous approach first for image:', imageName);
            
            // Use the callback approach as the primary method
            await new Promise(resolve => {
              page.objs.get(imageName, (image) => {
                console.log('Got image via callback:', image);
                imageObj = image;
                resolve();
              });
            });
            
            // If the callback didn't work, try synchronous as fallback
            if (!imageObj) {
              try {
                console.log('Callback returned no image, trying synchronous approach');
                imageObj = page.objs.get(imageName);
                console.log('Got image synchronously:', imageObj);
              } catch (err) {
                console.log('Both approaches failed for image:', imageName);
              }
            }
            
            if (imageObj) {
              // Process the image if we got it
              processImage(imageObj, pageNumber, imageName);
            } else {
              console.warn(`Could not retrieve image ${imageName}`);
              createPlaceholder(pageNumber, imageName, "Image not available");
            }
          } catch (error) {
            console.error(`Error retrieving image ${imageName}:`, error);
            createPlaceholder(pageNumber, imageName, error.message);
          }
        }
      }
    } catch (error) {
      console.error(`Error extracting images from page ${pageNumber}:`, error);
    }
  };

  // Helper function to create a placeholder for missing images
  function createPlaceholder(pageNumber, imageName, errorMessage) {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'lightgray';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '14px Arial';
    ctx.fillText(`Image: ${imageName}`, 10, 50);
    ctx.fillText(`(${errorMessage})`, 10, 70);
    
    setExtractedImages(prev => [
      ...prev, 
      {
        dataUrl: canvas.toDataURL(),
        width: 200,
        height: 200,
        page: pageNumber,
        name: imageName,
        isPlaceholder: true
      }
    ]);
  }

  // Helper function to process an image
  function processImage(image, pageNumber, imageName) {
    try {
      console.log('Processing image:', {
        width: image.width,
        height: image.height,
        hasData: !!image.data,
        dataLength: image.data?.length,
        hasBitmap: !!image.bitmap,
        imageName
      });
      
      // Create a canvas to draw the image
      const canvas = document.createElement('canvas');
      canvas.width = image.width || 200;
      canvas.height = image.height || 200;
      const ctx = canvas.getContext('2d');
      
      let dataUrl;
      
      // Check if we have a bitmap (some PDF.js versions use this format)
      if (image.bitmap) {
        try {
          // Handle bitmap format
          const imageData = new Uint8ClampedArray(image.bitmap.width * image.bitmap.height * 4);
          
          // Copy bitmap data to imageData with alpha channel
          for (let j = 0, k = 0; j < image.bitmap.data.length; j += 3, k += 4) {
            imageData[k] = image.bitmap.data[j];     // R
            imageData[k + 1] = image.bitmap.data[j + 1]; // G
            imageData[k + 2] = image.bitmap.data[j + 2]; // B
            imageData[k + 3] = 255;           // Alpha
          }
          
          const imgData = new ImageData(imageData, image.bitmap.width, image.bitmap.height);
          ctx.putImageData(imgData, 0, 0);
          dataUrl = canvas.toDataURL();
        } catch (e) {
          console.error('Error processing bitmap:', e);
          createFallbackImage(ctx, canvas, imageName, "Bitmap processing error");
          dataUrl = canvas.toDataURL();
        }
      } else if (image.data && image.data.length > 0) {
        // Standard RGB to RGBA conversion (existing code)
        try {
          const imageData = new Uint8ClampedArray(image.width * image.height * 4);
          
          // Add alpha channel to RGB data
          for (let j = 0, k = 0; j < image.data.length; j += 3, k += 4) {
            imageData[k] = image.data[j];     // R
            imageData[k + 1] = image.data[j + 1]; // G
            imageData[k + 2] = image.data[j + 2]; // B
            imageData[k + 3] = 255;           // Alpha
          }
          
          const imgData = new ImageData(imageData, image.width, image.height);
          ctx.putImageData(imgData, 0, 0);
          dataUrl = canvas.toDataURL();
        } catch (e) {
          console.error('Error converting image data:', e);
          createFallbackImage(ctx, canvas, imageName, "Processing error");
          dataUrl = canvas.toDataURL();
        }
      } else {
        createFallbackImage(ctx, canvas, imageName, "No data available");
        dataUrl = canvas.toDataURL();
      }
      
      // Add to extracted images
      setExtractedImages(prev => [
        ...prev, 
        {
          dataUrl,
          width: image.width || image.bitmap?.width || 200,
          height: image.height || image.bitmap?.height || 200,
          page: pageNumber,
          name: imageName
        }
      ]);
    } catch (error) {
      console.error(`Error processing image ${imageName}:`, error);
      createPlaceholder(pageNumber, imageName, error.message);
    }
  }

  // Helper function for creating fallback images
  function createFallbackImage(ctx, canvas, imageName, message) {
    ctx.fillStyle = 'lightgray';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '14px Arial';
    ctx.fillText(`Image: ${imageName}`, 10, 50);
    ctx.fillText(`(${message})`, 10, 70);
  }

  // New function to extract images using pdf-lib
  const extractImagesWithPdfLib = async (arrayBuffer) => {
    try {
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const imagesInDoc = [];
      
      // First pass: collect all images
      pdfDoc.context.enumerateIndirectObjects().forEach(([pdfRef, pdfObject]) => {
        if (!(pdfObject instanceof PDFRawStream)) return;
        
        const { dict } = pdfObject;
        const smaskRef = dict.get(PDFName.of('SMask'));
        const colorSpace = dict.get(PDFName.of('ColorSpace'));
        const subtype = dict.get(PDFName.of('Subtype'));
        const width = dict.get(PDFName.of('Width'));
        const height = dict.get(PDFName.of('Height'));
        const filter = dict.get(PDFName.of('Filter'));
        
        if (subtype === PDFName.of('Image')) {
          imagesInDoc.push({
            pdfRef,
            smaskRef,
            colorSpace,
            width: width.numberValue,
            height: height.numberValue,
            data: pdfObject.contents,
            type: filter === PDFName.of('DCTDecode') ? 'jpg' : 'png'
          });
        }
      });
      
      // Second pass: link alpha layers
      imagesInDoc.forEach(image => {
        if (image.type === 'png' && image.smaskRef) {
          const smaskImg = imagesInDoc.find(sm => image.smaskRef === sm.pdfRef);
          if (smaskImg) {
            smaskImg.isAlphaLayer = true;
            image.alphaLayer = smaskImg;
          }
        }
      });
      
      // Process each image
      for (const image of imagesInDoc) {
        if (!image.isAlphaLayer) {
          try {
            let imageData;
            if (image.type === 'jpg') {
              // Handle JPEG directly
              const blob = new Blob([image.data], { type: 'image/jpeg' });
              const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
              });
              
              setExtractedImages(prev => [...prev, {
                dataUrl,
                width: image.width,
                height: image.height,
                type: 'jpg'
              }]);
            } else {
              // Handle PNG with potential alpha channel
              const isGrayscale = image.colorSpace === PDFName.of('DeviceGray');
              const colorPixels = pako.inflate(image.data);
              const alphaPixels = image.alphaLayer ? pako.inflate(image.alphaLayer.data) : undefined;
              
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const ctx = canvas.getContext('2d');
              
              const imageData = ctx.createImageData(image.width, image.height);
              let pixelIndex = 0;
              let colorIndex = 0;
              let alphaIndex = 0;
              
              // Fill pixel data
              while (pixelIndex < imageData.data.length) {
                if (isGrayscale) {
                  const gray = colorPixels[colorIndex++];
                  imageData.data[pixelIndex++] = gray;
                  imageData.data[pixelIndex++] = gray;
                  imageData.data[pixelIndex++] = gray;
                  imageData.data[pixelIndex++] = alphaPixels ? alphaPixels[alphaIndex++] : 255;
                } else {
                  imageData.data[pixelIndex++] = colorPixels[colorIndex++];
                  imageData.data[pixelIndex++] = colorPixels[colorIndex++];
                  imageData.data[pixelIndex++] = colorPixels[colorIndex++];
                  imageData.data[pixelIndex++] = alphaPixels ? alphaPixels[alphaIndex++] : 255;
                }
              }
              
              ctx.putImageData(imageData, 0, 0);
              
              setExtractedImages(prev => [...prev, {
                dataUrl: canvas.toDataURL(),
                width: image.width,
                height: image.height,
                type: 'png'
              }]);
            }
          } catch (error) {
            console.error('Error processing image:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error extracting images with pdf-lib:', error);
    }
  };

  // Update handleFileUpload to use both methods
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      alert('Please select a valid PDF file');
      return;
    }
    
    setIsLoading(true);
    setExtractedImages([]);
    
    try {
      // Create two separate array buffers
      const buffer1 = await file.arrayBuffer();
      const buffer2 = await file.arrayBuffer();
      
      // Load with PDF.js for viewing
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer1),
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/cmaps/',
        cMapPacked: true,
      });
      
      const pdf = await loadingTask.promise;
      setPdfDocument(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      
      // Extract images with pdf-lib using the second buffer
      await extractImagesWithPdfLib(buffer2);
      
      setIsLoading(false);
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Error loading PDF file: ' + error.message);
      setIsLoading(false);
    }
  };

  // Navigation functions
  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>PDF Viewer & Image Extractor</h1>
        
        <div className="upload-container">
          <input 
            type="file" 
            accept=".pdf" 
            onChange={handleFileUpload} 
            className="file-input"
          />
        </div>
        
        {isLoading && <div className="loading">Loading PDF and extracting images...</div>}
        
        {pdfDocument && (
          <div className="pdf-container">
            <div className="pdf-controls">
              <button 
                onClick={goToPreviousPage} 
                disabled={currentPage <= 1 || isLoading}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={goToNextPage} 
                disabled={currentPage >= totalPages || isLoading}
              >
                Next
              </button>
            </div>
            
            <canvas ref={canvasRef} className="pdf-canvas" />
          </div>
        )}
        
        {extractedImages.length > 0 && (
          <div className="images-container">
            <h2>Extracted Images ({extractedImages.length})</h2>
            <div className="image-grid">
              {extractedImages.map((image, index) => (
                <div key={index} className="image-item">
                  <div className="image-info">Page {image.page}</div>
                  <img 
                    src={image.dataUrl} 
                    alt={`Image ${index + 1} from page ${image.page}`} 
                    width={Math.min(300, image.width)}
                  />
                  <div className="image-dimensions">
                    {image.width} × {image.height}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </header>
    </div>
  );
}

export default App;

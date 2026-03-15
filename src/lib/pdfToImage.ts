/**
 * Convert PDF file to JPEG image using pdf.js in the browser
 * This runs client-side and converts the first page of a PDF to a JPEG image
 * Optimized for OCR: scale 1.5x, JPEG quality 0.85 to keep file size under 10MB
 */
export async function convertPdfToImage(pdfFile: File): Promise<File> {
  // Dynamic import of pdfjs-dist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = await import("pdfjs-dist") as any;

  // Configure worker - use local file from public folder
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }

  // Read PDF file as ArrayBuffer
  const arrayBuffer = await pdfFile.arrayBuffer();

  // Load PDF document
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDocument = await loadingTask.promise;

  // Get first page
  const page = await pdfDocument.getPage(1);

  // Scale 1.5x — good enough for OCR, keeps file size manageable
  const scale = 1.5;
  const viewport = page.getViewport({ scale });

  // Limit max dimension to 4000px to prevent memory issues
  let finalScale = scale;
  const maxDim = 4000;
  if (viewport.width > maxDim || viewport.height > maxDim) {
    const ratio = maxDim / Math.max(viewport.width, viewport.height);
    finalScale = scale * ratio;
  }
  const finalViewport = finalScale !== scale ? page.getViewport({ scale: finalScale }) : viewport;

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.width = finalViewport.width;
  canvas.height = finalViewport.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get canvas context");
  }

  // White background (for transparency in PDFs)
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Render PDF page to canvas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page.render as any)({
    canvasContext: context,
    viewport: finalViewport,
  }).promise;

  // Convert canvas to JPEG blob (much smaller than PNG)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not convert canvas to blob"));
      }
    }, "image/jpeg", 0.85);
  });

  console.log(`[PDF→Image] ${Math.round(finalViewport.width)}x${Math.round(finalViewport.height)}, ${(blob.size / 1024).toFixed(0)}KB JPEG`);

  // Create new File with JPEG extension
  const jpgFileName = pdfFile.name.replace(/\.pdf$/i, ".jpg");
  const jpgFile = new File([blob], jpgFileName, { type: "image/jpeg" });

  return jpgFile;
}

/**
 * Convert PDF file to PNG image using pdf.js in the browser
 * This runs client-side and converts the first page of a PDF to a PNG image
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

  // Set scale for good quality (2x for retina-like quality)
  const scale = 2;
  const viewport = page.getViewport({ scale });

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get canvas context");
  }

  // Render PDF page to canvas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page.render as any)({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  // Convert canvas to blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not convert canvas to blob"));
      }
    }, "image/png", 0.95);
  });

  // Create new File with PNG extension
  const pngFileName = pdfFile.name.replace(/\.pdf$/i, ".png");
  const pngFile = new File([blob], pngFileName, { type: "image/png" });

  return pngFile;
}

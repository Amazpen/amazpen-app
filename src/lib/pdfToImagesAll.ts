/**
 * Convert every page of a PDF file to a separate JPEG File using pdf.js in
 * the browser. Used by the "מסמכים סרוקים" flow on the OCR pages — the user
 * uploads one PDF that contains several distinct documents (one per page),
 * and we split it so each page becomes its own ocr_documents row and runs
 * through OCR independently.
 *
 * Mirrors pdfToImage.ts (single-page) but loops over all pages.
 */
export async function convertPdfToImages(
  pdfFile: File,
  onProgress?: (current: number, total: number) => void,
): Promise<File[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = await import("pdfjs-dist") as any;

  if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }

  const arrayBuffer = await pdfFile.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDocument = await loadingTask.promise;
  const total: number = pdfDocument.numPages;

  const out: File[] = [];
  const baseName = pdfFile.name.replace(/\.pdf$/i, "");

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    onProgress?.(pageNum, total);
    const page = await pdfDocument.getPage(pageNum);

    const scale = 1.5;
    let finalScale = scale;
    const viewport = page.getViewport({ scale });
    const maxDim = 4000;
    if (viewport.width > maxDim || viewport.height > maxDim) {
      const ratio = maxDim / Math.max(viewport.width, viewport.height);
      finalScale = scale * ratio;
    }
    const finalViewport = finalScale !== scale ? page.getViewport({ scale: finalScale }) : viewport;

    const canvas = document.createElement("canvas");
    canvas.width = finalViewport.width;
    canvas.height = finalViewport.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not get canvas context");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.render as any)({
      canvasContext: context,
      viewport: finalViewport,
    }).promise;

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not convert canvas to blob"))),
        "image/jpeg",
        0.85,
      );
    });

    const fileName = `${baseName}-page-${pageNum}.jpg`;
    out.push(new File([blob], fileName, { type: "image/jpeg" }));
  }

  return out;
}

/**
 * Upload a file to Supabase Storage via server-side API (bypasses CORS)
 */
export async function uploadFile(
  file: File,
  path: string,
  bucket: string = "assets"
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("path", path);
    formData.append("bucket", bucket);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || "שגיאה בהעלאה" };
    }

    return { success: true, publicUrl: data.publicUrl };
  } catch (error) {
    console.error("Upload error:", error);
    return { success: false, error: error instanceof Error ? error.message : "שגיאה בהעלאה" };
  }
}
